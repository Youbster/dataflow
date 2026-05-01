import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";

interface MoodConfig {
  familiarityPct: number;
  vocalNote: string;
  energyArc: string;
  bpmHint: string;
  durationHint: string;
}

const MOOD_CONFIG: Record<string, MoodConfig> = {
  uplift: {
    familiarityPct: 50,
    vocalNote: "vocals and lyrics are great — uplifting words help",
    energyArc: "start at medium energy, build toward high, sustain the peak",
    bpmHint: "100–140 BPM range works well",
    durationHint: "standard 3–4 min tracks",
  },
  focus: {
    familiarityPct: 65,
    vocalNote: "strongly prefer instrumental or minimal vocals — lyrics compete with concentration",
    energyArc: "consistent, steady energy throughout — NO sudden peaks or drops",
    bpmHint: "70–110 BPM sweet spot for deep work",
    durationHint: "longer tracks (4+ min) preferred — fewer transitions = less distraction",
  },
  gym: {
    familiarityPct: 40,
    vocalNote: "high-energy vocals and hype lyrics actively help performance",
    energyArc: "build to peak by track 3, sustain hard through track N-1, brief cooldown on final track",
    bpmHint: "128–165 BPM, the harder the better",
    durationHint: "3–4 min punchy tracks to keep momentum",
  },
  unwind: {
    familiarityPct: 65,
    vocalNote: "soft vocals or instrumental both fine — nothing jarring",
    energyArc: "gradual descent in energy, each track slightly more relaxed than the last",
    bpmHint: "60–95 BPM, slow and fluid",
    durationHint: "longer tracks (4–6 min) feel more immersive",
  },
  sad: {
    familiarityPct: 75,
    vocalNote: "emotional vocals that mirror the feeling are perfect — this isn't about forcing happiness",
    energyArc: "meet the emotional state, hold it, then very gently move toward resolution by the end",
    bpmHint: "50–90 BPM, let it breathe",
    durationHint: "any length — emotional weight matters more than duration",
  },
  party: {
    familiarityPct: 35,
    vocalNote: "sing-along lyrics and high energy vocals are essential",
    energyArc: "build hard, peak early, sustain peak energy — never let it drop",
    bpmHint: "120–160 BPM, dance floor ready",
    durationHint: "3–4 min for maximum momentum",
  },
  throwback: {
    familiarityPct: 90,
    vocalNote: "classic vocal hooks from their past are the whole point",
    energyArc: "nostalgic journey — mix eras within their long-term taste history",
    bpmHint: "match the era being recalled — don't force modern BPM",
    durationHint: "any length — nostalgia doesn't care about runtime",
  },
  surprise: {
    familiarityPct: 20,
    vocalNote: "anything goes — this is a full exploration mode",
    energyArc: "varied and unpredictable — surprise them with each track",
    bpmHint: "any BPM — variety is the point",
    durationHint: "mix of lengths to keep it unpredictable",
  },
};

function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const timeLabel =
    hour < 5 ? "late night" :
    hour < 12 ? "morning" :
    hour < 17 ? "afternoon" :
    hour < 21 ? "evening" : "late night";
  const dayLabel =
    day === 0 ? "Sunday" :
    day === 1 ? "Monday — start of the week" :
    day === 5 ? "Friday — end of the week" :
    day === 6 ? "Saturday" :
    days[day];
  return { hour, timeLabel, dayLabel, isWeekend: day === 0 || day === 6 };
}

function trackCount(sessionMinutes: number) {
  if (sessionMinutes <= 20) return { total: 6, anchor: 2, groove: 2, discovery: 2 };
  if (sessionMinutes <= 60) return { total: 10, anchor: 2, groove: 5, discovery: 3 };
  return { total: 14, anchor: 3, groove: 7, discovery: 4 };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mood: string = body.mood ?? "surprise";
  const intensity: string = body.intensity ?? "medium";
  const sessionMinutes: number = body.sessionMinutes ?? 60;

  const config = MOOD_CONFIG[mood] ?? MOOD_CONFIG.surprise;
  const timeCtx = getTimeContext();
  const counts = trackCount(sessionMinutes);

  try {
    const admin = createAdminClient();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: shortTracks }, { data: shortArtists },
      { data: longTracks },
      { data: history3d }, { data: history7d },
    ] = await Promise.all([
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(15),
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(30),
      admin.from("user_listening_history").select("track_name, artist_names, played_at").eq("user_id", user.id).gte("played_at", threeDaysAgo),
      admin.from("user_listening_history").select("track_name, artist_names").eq("user_id", user.id).gte("played_at", sevenDaysAgo),
    ]);

    // Build overplayed blocklist — skip late-night plays (likely sleep/ambient)
    const playCounts3d: Record<string, { count: number; name: string; artist: string; lateNightOnly: boolean }> = {};
    for (const p of history3d ?? []) {
      const hour = new Date(p.played_at).getHours();
      const isLateNight = hour >= 23 || hour < 7;
      const key = `${p.track_name}|||${p.artist_names?.[0]}`;
      if (!playCounts3d[key]) playCounts3d[key] = { count: 0, name: p.track_name, artist: p.artist_names?.[0] ?? "", lateNightOnly: true };
      if (!isLateNight) playCounts3d[key].lateNightOnly = false;
      playCounts3d[key].count++;
    }
    // Only block tracks played frequently during conscious listening hours
    const blocklist = Object.values(playCounts3d)
      .filter(v => v.count >= 5 && !v.lateNightOnly)
      .map(v => `"${v.name}" by ${v.artist}`)
      .join(", ");

    // Songs played in the last 7 days (for deep cut detection)
    const recentSet = new Set((history7d ?? []).map(p => `${p.track_name}|||${p.artist_names?.[0]}`));

    // Anchor candidates: top short-term tracks, not overplayed
    const anchorCandidates = (shortTracks ?? [])
      .filter(t => {
        const key = `${t.track_name}|||${t.artist_names?.[0]}`;
        return !playCounts3d[key] || playCounts3d[key].count < 5 || playCounts3d[key].lateNightOnly;
      })
      .slice(0, 12)
      .map(t => `"${t.track_name}" by ${t.artist_names?.[0] ?? "Unknown"}`)
      .join("; ");

    // Deep cut candidates: long-term loved songs not played recently
    const deepCuts = (longTracks ?? [])
      .filter(t => !recentSet.has(`${t.track_name}|||${t.artist_names?.[0]}`))
      .slice(0, 15)
      .map(t => `"${t.track_name}" by ${t.artist_names?.[0] ?? "Unknown"}`)
      .join("; ");

    const topArtists = (shortArtists ?? []).slice(0, 8).map(a => a.artist_name).join(", ");
    const genres = [...new Set((shortArtists ?? []).flatMap(a => a.genres ?? []))].slice(0, 6).join(", ");

    // Intensity context
    const intensityNote =
      intensity === "low"
        ? `LOW intensity — user is at the gentle end of ${mood}. Start subtle, build slowly. Don't open at full power.`
        : intensity === "high"
        ? `HIGH intensity — user is fully committed to ${mood}. No warm-up needed. Go hard from track 1.`
        : `MEDIUM intensity — natural progression is good.`;

    // Time/day context note
    let timeNote = "";
    if (timeCtx.timeLabel === "late night") timeNote = "Late night session — even energetic moods should have depth and texture, not just raw aggression.";
    else if (timeCtx.dayLabel.includes("Monday")) timeNote = "Monday — user is likely setting the tone for their week.";
    else if (timeCtx.dayLabel.includes("Friday")) timeNote = "Friday — week is wrapping up. Even work playlists can have more joy and release.";
    else if (timeCtx.isWeekend) timeNote = "Weekend — more emotional openness, less pressure. Playlists can breathe more.";

    const prompt = `Generate a ${counts.total}-track ${mood.toUpperCase()} mood playlist.

USER CONTEXT:
- Time: ${timeCtx.timeLabel}, ${timeCtx.dayLabel}
- Mood: ${mood} | Intensity: ${intensity.toUpperCase()}
- Session length: ~${sessionMinutes} min → ${counts.total} tracks
${timeNote ? `- Time note: ${timeNote}` : ""}
- ${intensityNote}

THEIR TASTE PROFILE:
- Current top artists: ${topArtists || "no data yet"}
- Active genres: ${genres || "no data yet"}

PLAYLIST STRUCTURE — follow this arc exactly:

SECTION 1 — "Setting the tone" (${counts.anchor} tracks, type: "anchor")
Open with songs they KNOW and have strong emotional attachment to. These build immediate trust.
Choose from their known anchors: ${anchorCandidates || "use your best judgment from their artists/genres"}

SECTION 2 — "Finding your groove" (${counts.groove} tracks, type: "groove")
Deep cuts from artists they love but haven't played recently, OR artists that sit directly adjacent to their taste.
Songs they might recognize but haven't overplayed. The bridge between familiar and new.
Long-term loved but recently unplayed: ${deepCuts || "use their long-term artists for deep cuts"}

SECTION 3 — "This one's for you" (${counts.discovery} tracks, type: "discovery")
Genuine discoveries — artists or songs they've likely never heard — but that perfectly match their taste signature and THIS mood.
These are the "gift" tracks. They should feel like a natural extension of their sound, not a departure.

HARD RULES:
${blocklist ? `- NEVER include these overplayed songs (blocked): ${blocklist}` : "- Nothing flagged as overplayed"}
- Vocal preference: ${config.vocalNote}
- Energy arc: ${config.energyArc}
- BPM guidance: ${config.bpmHint}
- Track duration: ${config.durationHint}
- NO jarring energy jumps between consecutive tracks — each transition should feel intentional
- Discovery tracks must be genre-adjacent to their taste — don't send them somewhere completely foreign
- Familiarity ratio: ~${config.familiarityPct}% familiar / ${100 - config.familiarityPct}% new

ACCURACY REQUIREMENTS:
- Only suggest real, existing songs on Spotify
- Artist and track names must be spelled correctly
- Reasons must be specific to THIS user's taste, NOT generic descriptions

Return ONLY valid JSON:
{
  "intro": "2 sentences max — what this arc does and why it fits their mood + taste right now. Be specific and warm.",
  "tracks": [
    {
      "trackName": "exact track name",
      "artistName": "exact artist name",
      "section": "anchor" | "groove" | "discovery",
      "reason": "one specific sentence — why THIS track for THIS mood at THIS time for someone with their taste"
    }
  ]
}`;

    const aiRes = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 2500,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const text = aiRes.choices[0].message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/)?.[0];
    if (!match) throw new Error("AI returned invalid response");

    const result = JSON.parse(match) as {
      intro: string;
      tracks: { trackName: string; artistName: string; section: string; reason: string }[];
    };

    // Verify tracks on Spotify in parallel — attach IDs so the client can play directly
    const spotify = createSpotifyClient(user.id);
    const verified = await Promise.allSettled(
      result.tracks.map(async (track) => {
        try {
          const res = await spotify.searchTracks(
            `track:${track.trackName} artist:${track.artistName}`,
            1
          );
          const found = res.tracks.items[0];
          return {
            ...track,
            spotifyTrackId: found?.id ?? null,
            spotifyUri: found ? `spotify:track:${found.id}` : null,
            albumImageUrl: found?.album.images[0]?.url ?? null,
          };
        } catch {
          return { ...track, spotifyTrackId: null, spotifyUri: null, albumImageUrl: null };
        }
      })
    );

    const tracks = verified.map((r) =>
      r.status === "fulfilled" ? r.value : { ...result.tracks[0], spotifyTrackId: null, spotifyUri: null, albumImageUrl: null }
    );

    return NextResponse.json({ intro: result.intro, tracks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
