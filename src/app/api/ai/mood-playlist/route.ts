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

const ENVIRONMENT_NOTES: Record<string, string> = {
  headphones:
    "Environment: Headphones. Intimate, detailed listening. Complex arrangements, subtle dynamics, and quiet passages all land — the listener catches everything. Great for introspective or layered production.",
  speaker:
    "Environment: Home speaker. Open room listening. Music should feel comfortable at volume. Can handle more dynamic range and variety.",
  car:
    "Environment: Car stereo. Bass and rhythm translate best. Tracks with strong pulse and clear melody win. Great for lyrics to sing along to. Avoid very quiet or delicate tracks.",
  outside:
    "Environment: Outside / open air. Music competes with ambient noise. Choose tracks with strong energy, clear melody, or distinctive rhythm. Avoid very quiet or heavily nuanced production — it won't land.",
};

const FAMILIARITY_PCT: Record<string, number> = {
  familiar: 85,
  mix: -1, // -1 = use mood default
  fresh: 0, // fully suppressed — handled structurally in the prompt
};

const STARTING_POINT_NOTES: Record<string, string> = {
  low: "EMOTIONAL STARTING POINT — NOT FEELING IT YET: This user is not currently in the mood. ISO principle is critical here — the anchor section MUST start gentle and accessible, even if the overall mood is high-energy. The playlist must earn the energy gradually. Never assume the user is already there. Ease in.",
  neutral:
    "EMOTIONAL STARTING POINT — NEUTRAL/READY: User is open and ready. Normal arc applies — trust the mood and intensity settings.",
  flow: "EMOTIONAL STARTING POINT — ALREADY IN THE FLOW: User is already fully in the mood. Skip the warm-up. Start the anchor section at the TARGET energy immediately. Don't waste tracks on build-up — they're already there.",
};

const LANGUAGE_NOTES: Record<string, string> = {
  any: "No language restriction — recommend music from their taste regardless of language.",
  english:
    "Strongly prefer English-language tracks. Only include non-English music if it is clearly part of their established listening history.",
  other:
    "Actively include non-English music from their taste profile. If they listen to Arabic, French, Spanish, or any other language artists, feature them. Don't default to English-only.",
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

function detectNonEnglishLanguages(genres: string[]): string[] {
  const joined = genres.join(" ").toLowerCase();
  const detected: string[] = [];
  if (/arabic|khaleeji|rai|mahraganat|sha.?bi/.test(joined)) detected.push("Arabic");
  if (/french|chanson|vari/.test(joined)) detected.push("French");
  if (/latin|reggaeton|bachata|flamenco|salsa|cumbia|corrido/.test(joined)) detected.push("Spanish/Latin");
  if (/k-pop|korean|k-indie/.test(joined)) detected.push("Korean");
  if (/afrobeats|afropop|afro|naija|highlife/.test(joined)) detected.push("Afrobeats");
  if (/bollywood|hindi|desi|filmi/.test(joined)) detected.push("Hindi");
  if (/turkish|arabesk/.test(joined)) detected.push("Turkish");
  if (/portuguese|mpb|brazilian|samba|bossa/.test(joined)) detected.push("Portuguese/Brazilian");
  return detected;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const mood: string = body.mood ?? "surprise";
  const intensity: string = body.intensity ?? "medium";
  const sessionMinutes: number = body.sessionMinutes ?? 60;
  // New params
  const environment: string | null = body.environment ?? null;
  const startingPoint: "low" | "neutral" | "flow" = body.startingPoint ?? "neutral";
  const familiarity: "familiar" | "mix" | "fresh" = body.familiarity ?? "mix";
  const vocalPref: "any" | "instrumental" = body.vocalPref ?? "any";
  const language: "any" | "english" | "other" = body.language ?? "any";

  const config = MOOD_CONFIG[mood] ?? MOOD_CONFIG.surprise;
  const timeCtx = getTimeContext();
  const counts = trackCount(sessionMinutes);

  // Resolve familiarity %
  const familiarityPct =
    FAMILIARITY_PCT[familiarity] === -1
      ? config.familiarityPct
      : FAMILIARITY_PCT[familiarity];

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

    // Build overplayed blocklist
    const playCounts3d: Record<string, { count: number; name: string; artist: string; lateNightOnly: boolean }> = {};
    for (const p of history3d ?? []) {
      const hour = new Date(p.played_at).getHours();
      const isLateNight = hour >= 23 || hour < 7;
      const key = `${p.track_name}|||${p.artist_names?.[0]}`;
      if (!playCounts3d[key]) playCounts3d[key] = { count: 0, name: p.track_name, artist: p.artist_names?.[0] ?? "", lateNightOnly: true };
      if (!isLateNight) playCounts3d[key].lateNightOnly = false;
      playCounts3d[key].count++;
    }
    const blocklist = Object.values(playCounts3d)
      .filter(v => v.count >= 5 && !v.lateNightOnly)
      .map(v => `"${v.name}" by ${v.artist}`)
      .join(", ");

    const recentSet = new Set((history7d ?? []).map(p => `${p.track_name}|||${p.artist_names?.[0]}`));

    const anchorCandidates = (shortTracks ?? [])
      .filter(t => {
        const key = `${t.track_name}|||${t.artist_names?.[0]}`;
        return !playCounts3d[key] || playCounts3d[key].count < 5 || playCounts3d[key].lateNightOnly;
      })
      .slice(0, 12)
      .map(t => `"${t.track_name}" by ${t.artist_names?.[0] ?? "Unknown"}`)
      .join("; ");

    const deepCuts = (longTracks ?? [])
      .filter(t => !recentSet.has(`${t.track_name}|||${t.artist_names?.[0]}`))
      .slice(0, 15)
      .map(t => `"${t.track_name}" by ${t.artist_names?.[0] ?? "Unknown"}`)
      .join("; ");

    const topArtists = (shortArtists ?? []).slice(0, 8).map(a => a.artist_name).join(", ");
    const allGenres = [...new Set((shortArtists ?? []).flatMap(a => a.genres ?? []))];
    const genreStr = allGenres.slice(0, 6).join(", ");

    // Detect non-English languages in their taste for context
    const nativeLanguages = detectNonEnglishLanguages(allGenres);

    // Build context notes
    const intensityNote =
      intensity === "low"
        ? `LOW intensity — start subtle, build slowly. Don't open at full power.`
        : intensity === "high"
        ? `HIGH intensity — go hard from track 1. No warm-up needed.`
        : `MEDIUM intensity — natural progression is good.`;

    let timeNote = "";
    if (timeCtx.timeLabel === "late night") timeNote = "Late night session — even energetic moods should have depth and texture.";
    else if (timeCtx.dayLabel.includes("Monday")) timeNote = "Monday — user is likely setting the tone for their week.";
    else if (timeCtx.dayLabel.includes("Friday")) timeNote = "Friday — week is wrapping up, more joy and release is welcome.";
    else if (timeCtx.isWeekend) timeNote = "Weekend — more emotional openness, playlists can breathe.";

    // Vocal note: user's explicit choice overrides mood default
    const vocalNote =
      vocalPref === "instrumental"
        ? "INSTRUMENTAL STRONGLY PREFERRED — user explicitly chose no lyrics. Only include vocal tracks if they are iconic for this mood and vocals are extremely minimal/ambient. Prioritise instrumentals."
        : config.vocalNote;

    // Language note
    const languageNote =
      language === "other" && nativeLanguages.length > 0
        ? `Actively include non-English music — detected languages in their taste: ${nativeLanguages.join(", ")}. Feature these artists.`
        : LANGUAGE_NOTES[language];

    const isFresh = familiarity === "fresh";

    const prompt = isFresh
      ? `Generate a ${counts.total}-track FULL DISCOVERY playlist for a ${mood.toUpperCase()} mood.

USER CONTEXT:
- Time: ${timeCtx.timeLabel}, ${timeCtx.dayLabel}
- Mood: ${mood} | Intensity: ${intensity.toUpperCase()}
- Session: ~${sessionMinutes} min → ${counts.total} tracks
${timeNote ? `- Time note: ${timeNote}` : ""}
- ${intensityNote}
${environment ? `\nENVIRONMENT: ${ENVIRONMENT_NOTES[environment] ?? ""}` : ""}

EMOTIONAL STARTING POINT:
${STARTING_POINT_NOTES[startingPoint]}

THEIR TASTE SIGNATURE (use ONLY as a map to find NEW territory — do NOT suggest these tracks):
- Artists they already know: ${topArtists || "no data yet"}
- Genres they like: ${genreStr || "no data yet"}
- Language: ${languageNote}

⚠️ FULL DISCOVERY MODE — CRITICAL RULES:
- DO NOT suggest any track the user already knows or has played
- DO NOT use any of these tracks: ${anchorCandidates || "none listed"} — these are already known to the user
- DO NOT use any of these tracks: ${deepCuts || "none listed"} — these are already in their history
- DO NOT suggest tracks by artists they already follow — find ADJACENT artists instead
- Every single track must be a genuine discovery: a real song they have almost certainly never heard
- Use their taste as a compass, not a destination — navigate to new territory that borders their world

PLAYLIST STRUCTURE — all sections are discovery-mode:

SECTION 1 — "Gateway" (${counts.anchor} tracks, type: "anchor")
Artists/tracks that are the closest stylistic neighbours to what they know — the most accessible entry point to new music. Someone hearing these would immediately feel "this fits me" even though they've never heard it.

SECTION 2 — "Deeper" (${counts.groove} tracks, type: "groove")
More niche within their taste territory. Artists that are a little further from the mainstream of their listening. Still fits — but pushes them slightly.

SECTION 3 — "Wildcard" (${counts.discovery} tracks, type: "discovery")
True surprises — genre-adjacent but genuinely unexpected. Artists or tracks they'd never find on their own but would love.

HARD RULES:
${blocklist ? `- NEVER include these overplayed songs: ${blocklist}` : ""}
- Vocal preference: ${vocalNote}
- Energy arc: ${config.energyArc}
- BPM guidance: ${config.bpmHint}
- Track duration: ${config.durationHint}
- NO jarring energy jumps
- 0% familiar — every track must be genuinely new to them
- SPOTIFY ACCURACY: Only suggest tracks you are 100% certain exist on Spotify with this exact name and artist. Never invent titles. When in doubt between versions, pick the most well-known studio release. Avoid obscure remixes, regional exclusives, or live versions unless you are certain they are on Spotify.

Return ONLY valid JSON:
{
  "intro": "2 sentences — tell them this is a full discovery session and what sonic territory you're taking them into based on their taste.",
  "tracks": [
    {
      "trackName": "exact track name",
      "artistName": "exact artist name",
      "section": "anchor" | "groove" | "discovery",
      "reason": "one sentence — what connects this to their taste even though it's new"
    }
  ]
}`
      : `Generate a ${counts.total}-track ${mood.toUpperCase()} mood playlist.

USER CONTEXT:
- Time: ${timeCtx.timeLabel}, ${timeCtx.dayLabel}
- Mood: ${mood} | Intensity: ${intensity.toUpperCase()}
- Session: ~${sessionMinutes} min → ${counts.total} tracks
${timeNote ? `- Time note: ${timeNote}` : ""}
- ${intensityNote}
${environment ? `\nENVIRONMENT: ${ENVIRONMENT_NOTES[environment] ?? ""}` : ""}

EMOTIONAL STARTING POINT:
${STARTING_POINT_NOTES[startingPoint]}

THEIR TASTE PROFILE:
- Current top artists: ${topArtists || "no data yet"}
- Active genres: ${genreStr || "no data yet"}

PLAYLIST STRUCTURE — follow this arc exactly:

SECTION 1 — "Setting the tone" (${counts.anchor} tracks, type: "anchor")
Open with songs they KNOW and have strong emotional attachment to. Immediate trust.
${startingPoint === "flow" ? "Start at TARGET energy — they are already there." : startingPoint === "low" ? "Start GENTLE — they need to be eased in even if the mood is energetic." : ""}
Choose from: ${anchorCandidates || "use your best judgment from their artists/genres"}

SECTION 2 — "Finding your groove" (${counts.groove} tracks, type: "groove")
Deep cuts from artists they love but haven't played recently. The bridge.
Long-term loved but recently unplayed: ${deepCuts || "use their long-term artists for deep cuts"}

SECTION 3 — "This one's for you" (${counts.discovery} tracks, type: "discovery")
Genuine discoveries — new to them but perfectly matching their taste + this mood.
${familiarity === "familiar" ? "Keep discoveries very safe and minimal — user wants comfort, not surprises. Stick almost entirely to known artists." : ""}

HARD RULES:
${blocklist ? `- NEVER include these overplayed songs: ${blocklist}` : "- Nothing flagged as overplayed"}
- Vocal preference: ${vocalNote}
- Energy arc: ${config.energyArc}
- BPM guidance: ${config.bpmHint}
- Track duration: ${config.durationHint}
- NO jarring energy jumps between consecutive tracks
- Familiarity ratio: ~${familiarityPct}% familiar / ${100 - familiarityPct}% new
- Language: ${languageNote}
- SPOTIFY ACCURACY: Only suggest tracks you are 100% certain exist on Spotify with this exact name and artist. Never invent titles. When in doubt between versions, pick the most well-known studio release. Avoid obscure remixes, regional exclusives, or live versions unless you are certain they are on Spotify.

Return ONLY valid JSON:
{
  "intro": "2 sentences — what this arc does and why it fits their mood + context right now. Be warm and specific.",
  "tracks": [
    {
      "trackName": "exact track name",
      "artistName": "exact artist name",
      "section": "anchor" | "groove" | "discovery",
      "reason": "one sentence — why THIS track for THIS mood at THIS time for someone with their taste"
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

    // Verify tracks on Spotify in parallel — artist-validated
    const spotify = createSpotifyClient(user.id);
    const verified = await Promise.allSettled(
      result.tracks.map(async (track) => {
        const found = await spotify.findTrack(track.trackName, track.artistName);
        return {
          ...track,
          spotifyTrackId: found?.id ?? null,
          spotifyUri: found ? `spotify:track:${found.id}` : null,
          albumImageUrl: found?.album.images[0]?.url ?? null,
        };
      })
    );

    // Fix: use index `i` so failed tracks keep their own name/artist, not track[0]
    const tracks = verified.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { ...result.tracks[i], spotifyTrackId: null, spotifyUri: null, albumImageUrl: null }
    );

    // ── Option B: auto-replace tracks that failed Spotify verification ────────
    const failedEntries = tracks
      .map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.spotifyTrackId);

    if (failedEntries.length > 0) {
      try {
        const failedList = failedEntries
          .map(({ t }, n) => `${n + 1}. "${t.trackName}" by ${t.artistName} (section: ${t.section})`)
          .join("\n");

        const replRes = await openai.chat.completions.create({
          model: FAST_MODEL,
          max_tokens: 800,
          messages: [
            { role: "system", content: MUSIC_EXPERT_SYSTEM },
            {
              role: "user",
              content: `${failedEntries.length} track(s) from a ${mood} playlist couldn't be found on Spotify. Replace each with a DIFFERENT real track that:
- Fills the same mood/energy role (same section type)
- You are 100% certain exists on Spotify with this EXACT name and artist
- Prefer well-known studio releases over live, remix, or obscure versions

Tracks to replace:
${failedList}

Return ONLY valid JSON — same number of entries in the same order:
{
  "replacements": [
    { "trackName": "exact Spotify track name", "artistName": "exact primary artist", "reason": "one sentence" }
  ]
}`,
            },
          ],
        });

        const replText = replRes.choices[0].message.content ?? "";
        const replMatch = replText.match(/\{[\s\S]*\}/)?.[0];
        if (replMatch) {
          const replParsed = JSON.parse(replMatch) as {
            replacements: { trackName: string; artistName: string; reason: string }[];
          };

          // Verify replacements in parallel
          const replVerified = await Promise.allSettled(
            replParsed.replacements.map(async (r) => ({
              ...r,
              found: await spotify.findTrack(r.trackName, r.artistName),
            }))
          );

          // Slot verified replacements back in at the correct positions
          for (let n = 0; n < failedEntries.length; n++) {
            const slot = failedEntries[n];
            const repl = replVerified[n];
            if (repl?.status === "fulfilled" && repl.value.found) {
              const f = repl.value.found;
              tracks[slot.i] = {
                ...tracks[slot.i],
                trackName: repl.value.trackName,
                artistName: repl.value.artistName,
                reason: repl.value.reason,
                spotifyTrackId: f.id,
                spotifyUri: `spotify:track:${f.id}`,
                albumImageUrl: f.album.images[0]?.url ?? null,
              };
            }
          }
        }
      } catch (replErr) {
        // Non-fatal — keep whatever tracks were already verified
        console.error("[mood-playlist] Replacement call failed:", replErr);
      }
    }

    // Persist to generated_playlists so the Playlists page can show history
    let playlistId: string | null = null;
    try {
      const moodLabel = mood.charAt(0).toUpperCase() + mood.slice(1);
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const coverImageUrl = tracks.find((t) => t.spotifyTrackId && t.albumImageUrl)?.albumImageUrl ?? null;
      const verifiedCount = tracks.filter((t) => t.spotifyTrackId).length;

      const { data: pl } = await admin
        .from("generated_playlists")
        .insert({
          user_id: user.id,
          name: `${moodLabel} — ${dateLabel}`,
          description: result.intro,
          prompt_used: `${mood} | ${intensity} | ${sessionMinutes}min | env:${environment ?? "any"} | familiarity:${familiarity}`,
          mood_tags: [mood],
          track_count: verifiedCount,
          cover_image_url: coverImageUrl,
        })
        .select("id")
        .single();

      if (pl?.id) {
        playlistId = pl.id;
        const trackRows = tracks
          .filter((t) => t.spotifyTrackId)
          .map((t, i) => ({
            playlist_id: pl.id,
            spotify_track_id: t.spotifyTrackId!,
            track_name: t.trackName,
            artist_names: [t.artistName],
            album_image_url: t.albumImageUrl ?? null,
            position: i,
            claude_note: t.reason,
          }));
        if (trackRows.length > 0) {
          await admin.from("playlist_tracks").insert(trackRows);
        }
      }
    } catch (dbErr) {
      // Don't fail the request — playlist still works without history
      console.error("[mood-playlist] DB save failed:", dbErr);
    }

    return NextResponse.json({ intro: result.intro, tracks, playlistId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
