import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";

function getTimeContext() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const timeLabel =
    hour < 5  ? "late night" :
    hour < 12 ? "morning"    :
    hour < 17 ? "afternoon"  :
    hour < 21 ? "evening"    : "late night";
  const dayLabel =
    day === 0 ? "Sunday" :
    day === 1 ? "Monday — start of the week" :
    day === 5 ? "Friday — end of the week" :
    day === 6 ? "Saturday" :
    days[day];
  return { hour, timeLabel, dayLabel, isWeekend: day === 0 || day === 6 };
}

function trackCount(sessionMinutes: number) {
  if (sessionMinutes <= 20) return { total: 6,  anchor: 2, groove: 2, discovery: 2 };
  if (sessionMinutes <= 60) return { total: 10, anchor: 2, groove: 5, discovery: 3 };
  return                           { total: 14, anchor: 3, groove: 7, discovery: 4 };
}

function detectNonEnglishLanguages(genres: string[]): string[] {
  const joined = genres.join(" ").toLowerCase();
  const detected: string[] = [];
  if (/arabic|khaleeji|rai|mahraganat|sha.?bi/.test(joined))         detected.push("Arabic");
  if (/french|chanson|vari/.test(joined))                            detected.push("French");
  if (/latin|reggaeton|bachata|flamenco|salsa|cumbia|corrido/.test(joined)) detected.push("Spanish/Latin");
  if (/k-pop|korean|k-indie/.test(joined))                           detected.push("Korean");
  if (/afrobeats|afropop|afro|naija|highlife/.test(joined))          detected.push("Afrobeats");
  if (/bollywood|hindi|desi|filmi/.test(joined))                     detected.push("Hindi");
  if (/turkish|arabesk/.test(joined))                                detected.push("Turkish");
  if (/portuguese|mpb|brazilian|samba|bossa/.test(joined))           detected.push("Portuguese/Brazilian");
  return detected;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const userPrompt: string = body.prompt ?? "";
  const seedTrack: { trackName: string; artistName: string } | null = body.seedTrack ?? null;
  const sessionMinutes: number = body.sessionMinutes ?? 60;
  const familiarity: "familiar" | "mixed" | "fresh" = body.familiarity ?? "mixed";
  const intensity:   "low" | "mid" | "high"         = body.intensity   ?? "mid";
  const vocals:      "any" | "lyrics" | "instrumental" = body.vocals   ?? "any";
  const language:    "any" | "english" | "match"     = body.language   ?? "any";
  const genreLock:   string | null = body.genreLock  ?? null;
  const artistLock:  string | null = body.artistLock ?? null;

  if (!userPrompt.trim() && !seedTrack && familiarity !== "fresh") {
    return NextResponse.json({ error: "Provide a description or seed track" }, { status: 400 });
  }

  const timeCtx = getTimeContext();
  const counts  = trackCount(sessionMinutes);

  try {
    const admin = createAdminClient();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: shortTracks }, { data: shortArtists },
      { data: longTracks  },
      { data: history3d   }, { data: history7d },
    ] = await Promise.all([
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(15),
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(30),
      admin.from("user_listening_history").select("track_name, artist_names, played_at").eq("user_id", user.id).gte("played_at", threeDaysAgo),
      admin.from("user_listening_history").select("track_name, artist_names").eq("user_id", user.id).gte("played_at", sevenDaysAgo),
    ]);

    // ── Overplayed blocklist ─────────────────────────────────────────────────
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

    const topArtists      = (shortArtists ?? []).slice(0, 8).map(a => a.artist_name).join(", ");
    const allGenres       = [...new Set((shortArtists ?? []).flatMap(a => a.genres ?? []))];
    const genreStr        = allGenres.slice(0, 6).join(", ");
    const nativeLanguages = detectNonEnglishLanguages(allGenres);

    // Time note
    let timeNote = "";
    if (timeCtx.timeLabel === "late night")            timeNote = "Late night — even energetic requests should have depth and texture.";
    else if (timeCtx.dayLabel.includes("Monday"))      timeNote = "Monday — user is setting the tone for their week.";
    else if (timeCtx.dayLabel.includes("Friday"))      timeNote = "Friday — week wrapping up, joy and release are welcome.";
    else if (timeCtx.isWeekend)                        timeNote = "Weekend — more emotional openness, playlists can breathe.";

    // Intensity hint
    const intensityStr =
      intensity === "high" ? "\nINTENSITY: HIGH — Everything driving, energetic, upbeat. No slow moments." :
      intensity === "low"  ? "\nINTENSITY: LOW — Keep everything calm, gentle, ambient throughout." :
      "";

    // Familiarity note (mixed/familiar — fresh is handled by a separate prompt path)
    const familiarityNote = familiarity === "familiar"
      ? "\nFAMILIAR MODE: Keep it comfortable — heavy on tracks they already know and love, very few discoveries."
      : "";

    // Advanced constraints
    const constraints: string[] = [];
    if (vocals === "lyrics")       constraints.push("VOCALS: Only tracks WITH lyrics/vocals — no instrumentals");
    if (vocals === "instrumental") constraints.push("VOCALS: Only INSTRUMENTAL tracks — absolutely no vocals");
    if (language === "english")    constraints.push("LANGUAGE: Only English-language tracks");
    if (language === "match" && nativeLanguages.length > 0)
                                   constraints.push(`LANGUAGE: Mix in tracks in the user's preferred languages: ${nativeLanguages.join(", ")}`);
    if (genreLock)                 constraints.push(`GENRE LOCK: All tracks must be within or closely related to: ${genreLock}`);
    if (artistLock)                constraints.push(`ARTIST PREFERENCE: ${artistLock}`);
    const constraintsStr = constraints.length > 0
      ? "\nADDITIONAL CONSTRAINTS (hard rules, do not violate):\n" + constraints.map(c => `- ${c}`).join("\n")
      : "";

    // Build the request description for Claude
    const requestLines: string[] = [];
    if (userPrompt.trim()) requestLines.push(`"${userPrompt.trim()}"`);
    if (seedTrack) requestLines.push(
      `Build the playlist around this as the anchor: "${seedTrack.trackName}" by ${seedTrack.artistName}`
    );
    const requestStr = requestLines.join("\n") || "Discover new music matching my taste";

    // ── Fresh / Discovery mode prompt ─────────────────────────────────────────
    const recentTracksStr = [...recentSet].slice(0, 20).map(k => k.split("|||")[0]).join(", ");

    const prompt = familiarity === "fresh"
      ? `Generate ${counts.total} all-new discovery tracks for this listener.

WHAT THEY WANT: ${requestStr}
TIME: ${timeCtx.timeLabel}, ${timeCtx.dayLabel}${intensityStr}

THEIR TASTE DNA (style/genre guide only — do NOT suggest any of these artists):
- Core genres: ${genreStr || "varied"}
${nativeLanguages.length > 0 ? `- Also appreciates: ${nativeLanguages.join(", ")} music` : ""}
- Artists they already know (EXCLUDE ALL): ${topArtists || "none"}
- Recently played tracks (EXCLUDE ALL): ${recentTracksStr || "none"}

DISCOVERY MODE RULES:
- ALL ${counts.total} tracks MUST be by artists completely new to this listener
- Match their genre DNA but find lesser-known acts, cult favourites, underground gems
- Every track should feel like "How did I not know this artist?"
- SPOTIFY ACCURACY: 100% certain the track exists on Spotify with exact title + artist${constraintsStr}

Return ONLY valid JSON:
{
  "intro": "2 sentences. Hype these hand-picked discoveries curated from their exact taste DNA.",
  "tracks": [
    {
      "trackName": "exact Spotify track name",
      "artistName": "exact primary artist name",
      "section": "discovery",
      "reason": "one sentence — why this artist fits their taste perfectly"
    }
  ]
}`
      // ── Normal / Familiar mode prompt ─────────────────────────────────────────
      : `Generate a ${counts.total}-track playlist.

WHAT THE USER WANTS:
${requestStr}

TIME CONTEXT: ${timeCtx.timeLabel}, ${timeCtx.dayLabel}${timeNote ? ` — ${timeNote}` : ""}
SESSION: ~${sessionMinutes} min → ${counts.total} tracks${intensityStr}${familiarityNote}

THEIR TASTE PROFILE:
- Current top artists: ${topArtists || "no data yet"}
- Active genres: ${genreStr || "no data yet"}
${nativeLanguages.length > 0 ? `- They also listen to: ${nativeLanguages.join(", ")} music` : ""}

PLAYLIST STRUCTURE — three-section arc:

SECTION 1 — "Setting the tone" (${counts.anchor} tracks, type: "anchor")
${seedTrack
  ? `MUST open with "${seedTrack.trackName}" by ${seedTrack.artistName}${counts.anchor > 1 ? `, then ${counts.anchor - 1} more track(s) that flow naturally from it` : ""}.`
  : `Open with tracks they KNOW and have strong feelings about — immediate familiarity. Choose from: ${anchorCandidates || "their top artists/genres"}`
}

SECTION 2 — "Finding your groove" (${counts.groove} tracks, type: "groove")
${seedTrack
  ? `Tracks sharing the energy and texture of "${seedTrack.trackName}" — adjacent artists and sounds that feel like a natural extension.`
  : `Deep cuts from artists they love but haven't played recently. From their history: ${deepCuts || "their long-term artists"}`
}

SECTION 3 — "This one's for you" (${counts.discovery} tracks, type: "discovery")
Genuine discoveries — new to them but perfectly matching their taste and this specific request.

HARD RULES:
${blocklist ? `- NEVER include these overplayed songs: ${blocklist}` : ""}
- Read the user's description carefully — match the energy, emotion, and context they described precisely
- NO jarring energy jumps between consecutive tracks
- SPOTIFY ACCURACY: Only suggest tracks you are 100% certain exist on Spotify with this exact name and artist. Never invent titles. Prefer well-known studio releases over remixes, live versions, or obscure editions.${constraintsStr}

Return ONLY valid JSON:
{
  "intro": "2 sentences — what this playlist does and why it fits the user's request. Be warm and specific to what they described.",
  "tracks": [
    {
      "trackName": "exact track name",
      "artistName": "exact artist name",
      "section": "anchor" | "groove" | "discovery",
      "reason": "one sentence — why this track for this specific request and moment"
    }
  ]
}`;

    const aiRes = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 2500,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user",   content: prompt },
      ],
    });

    const text  = aiRes.choices[0].message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/)?.[0];
    if (!match) throw new Error("AI returned invalid response");

    const result = JSON.parse(match) as {
      intro: string;
      tracks: { trackName: string; artistName: string; section: string; reason: string }[];
    };

    // ── Verify tracks on Spotify ─────────────────────────────────────────────
    const spotify  = createSpotifyClient(user.id);
    const verified = await Promise.allSettled(
      result.tracks.map(async (track) => {
        const found = await spotify.findTrack(track.trackName, track.artistName);
        return {
          ...track,
          spotifyTrackId: found?.id ?? null,
          spotifyUri:     found ? `spotify:track:${found.id}` : null,
          albumImageUrl:  found?.album.images[0]?.url ?? null,
        };
      })
    );

    const tracks = verified.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { ...result.tracks[i], spotifyTrackId: null, spotifyUri: null, albumImageUrl: null }
    );

    // ── Auto-replace tracks that failed Spotify verification ─────────────────
    const failedEntries = tracks.map((t, i) => ({ t, i })).filter(({ t }) => !t.spotifyTrackId);

    if (failedEntries.length > 0) {
      try {
        const failedList    = failedEntries
          .map(({ t }, n) => `${n + 1}. "${t.trackName}" by ${t.artistName} (section: ${t.section})`)
          .join("\n");
        const contextDesc   = userPrompt.trim()
          || (seedTrack ? `a playlist around "${seedTrack.trackName}"` : "this playlist");

        const replRes = await openai.chat.completions.create({
          model:      FAST_MODEL,
          max_tokens: 800,
          messages: [
            { role: "system", content: MUSIC_EXPERT_SYSTEM },
            {
              role: "user",
              content: `${failedEntries.length} track(s) from a playlist couldn't be found on Spotify. The user requested: ${contextDesc}

Replace each with a DIFFERENT real track that:
- Fills the same mood/energy role (same section type)
- You are 100% certain exists on Spotify with this EXACT name and artist
- Prefer well-known studio releases over live, remix, or obscure versions

Tracks to replace:
${failedList}

Return ONLY valid JSON:
{
  "replacements": [
    { "trackName": "exact Spotify track name", "artistName": "exact primary artist", "reason": "one sentence" }
  ]
}`,
            },
          ],
        });

        const replText  = replRes.choices[0].message.content ?? "";
        const replMatch = replText.match(/\{[\s\S]*\}/)?.[0];
        if (replMatch) {
          const replParsed = JSON.parse(replMatch) as {
            replacements: { trackName: string; artistName: string; reason: string }[];
          };

          const replVerified = await Promise.allSettled(
            replParsed.replacements.map(async (r) => ({
              ...r,
              found: await spotify.findTrack(r.trackName, r.artistName),
            }))
          );

          for (let n = 0; n < failedEntries.length; n++) {
            const slot = failedEntries[n];
            const repl = replVerified[n];
            if (repl?.status === "fulfilled" && repl.value.found) {
              const f = repl.value.found;
              tracks[slot.i] = {
                ...tracks[slot.i],
                trackName:      repl.value.trackName,
                artistName:     repl.value.artistName,
                reason:         repl.value.reason,
                spotifyTrackId: f.id,
                spotifyUri:     `spotify:track:${f.id}`,
                albumImageUrl:  f.album.images[0]?.url ?? null,
              };
            }
          }
        }
      } catch (replErr) {
        console.error("[mood-playlist] Replacement call failed:", replErr);
      }
    }

    // ── Persist to generated_playlists ───────────────────────────────────────
    let playlistId: string | null = null;
    try {
      const nameLabel    = userPrompt.trim()
        ? userPrompt.trim().slice(0, 40) + (userPrompt.trim().length > 40 ? "…" : "")
        : seedTrack
        ? `Built around "${seedTrack.trackName}"`
        : "Generated Playlist";
      const dateLabel    = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const coverImageUrl = tracks.find((t) => t.spotifyTrackId && t.albumImageUrl)?.albumImageUrl ?? null;
      const verifiedCount = tracks.filter((t) => t.spotifyTrackId).length;

      const { data: pl } = await admin
        .from("generated_playlists")
        .insert({
          user_id:        user.id,
          name:           `${nameLabel} — ${dateLabel}`,
          description:    result.intro,
          prompt_used:    userPrompt.trim() || (seedTrack ? `seed: "${seedTrack.trackName}" by ${seedTrack.artistName}` : ""),
          mood_tags:      [],
          track_count:    verifiedCount,
          cover_image_url: coverImageUrl,
        })
        .select("id")
        .single();

      if (pl?.id) {
        playlistId = pl.id;
        const trackRows = tracks
          .filter((t) => t.spotifyTrackId)
          .map((t, i) => ({
            playlist_id:     pl.id,
            spotify_track_id: t.spotifyTrackId!,
            track_name:      t.trackName,
            artist_names:    [t.artistName],
            album_image_url: t.albumImageUrl ?? null,
            position:        i,
            claude_note:     t.reason,
          }));
        if (trackRows.length > 0) {
          await admin.from("playlist_tracks").insert(trackRows);
        }
      }
    } catch (dbErr) {
      console.error("[mood-playlist] DB save failed:", dbErr);
    }

    return NextResponse.json({ intro: result.intro, tracks, playlistId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
