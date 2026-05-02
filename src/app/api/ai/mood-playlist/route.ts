import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";
import type { SpotifyTrack } from "@/types/spotify";

// Give Vercel up to 30 seconds for this function (Pro plan).
// Hobby plan is capped at 10s regardless; the client-side AbortController
// handles the "never-resolves" case if the limit is hit.
export const maxDuration = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaylistTrack {
  trackName: string;
  artistName: string;
  section: "anchor" | "groove" | "discovery";
  reason: string;
  spotifyTrackId: string | null;
  spotifyUri: string | null;
  albumImageUrl: string | null;
}

interface DbTrack {
  track_name: string;
  artist_names: string[] | null;
  spotify_track_id: string | null;
  album_image_url: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trackCount(sessionMinutes: number) {
  // ~3.5 min/track average
  if (sessionMinutes <= 20) return { total: 6,  anchor: 2, groove: 2, discovery: 2 };
  if (sessionMinutes <= 60) return { total: 18, anchor: 3, groove: 11, discovery: 4 };
  return                           { total: 30, anchor: 4, groove: 18, discovery: 8 };
}

function detectNonEnglishLanguages(genres: string[]): string[] {
  const joined = genres.join(" ").toLowerCase();
  const detected: string[] = [];
  if (/arabic|khaleeji|rai|mahraganat|sha.?bi/.test(joined))              detected.push("Arabic");
  if (/french|chanson|vari/.test(joined))                                 detected.push("French");
  if (/latin|reggaeton|bachata|flamenco|salsa|cumbia|corrido/.test(joined)) detected.push("Spanish/Latin");
  if (/k-pop|korean|k-indie/.test(joined))                               detected.push("Korean");
  if (/afrobeats|afropop|afro|naija|highlife/.test(joined))               detected.push("Afrobeats");
  if (/bollywood|hindi|desi|filmi/.test(joined))                          detected.push("Hindi");
  if (/turkish|arabesk/.test(joined))                                     detected.push("Turkish");
  if (/portuguese|mpb|brazilian|samba|bossa/.test(joined))                detected.push("Portuguese/Brazilian");
  return detected;
}

/**
 * Resolves discovery artists to real Spotify tracks.
 * For each artist: search Spotify → get their top tracks → pick the best
 * track the user hasn't heard recently.
 * Returns only successfully resolved tracks (skips failures silently).
 */
async function resolveDiscoveryArtists(
  artists: { name: string; reason: string }[],
  recentSet: Set<string>,
  spotify: ReturnType<typeof createSpotifyClient>,
  market = "US",
): Promise<PlaylistTrack[]> {
  // Resolve all artists in parallel: search + top-tracks
  const resolved = await Promise.allSettled(
    artists.map(async ({ name, reason }) => {
      const artist = await spotify.searchArtist(name);
      if (!artist) return null;

      const topTracks = await spotify.getArtistTopTracks(artist.id, market);
      if (topTracks.length === 0) return null;

      // Prefer tracks the user hasn't heard recently; fall back to most popular
      const fresh = topTracks.filter(
        (t) => !recentSet.has(`${t.name}|||${t.artists[0]?.name}`)
      );
      const pick: SpotifyTrack = (fresh.length > 0 ? fresh : topTracks)[0];

      return {
        trackName: pick.name,
        artistName: pick.artists[0]?.name ?? artist.name,
        section: "discovery" as const,
        reason,
        spotifyTrackId: pick.id,
        spotifyUri: `spotify:track:${pick.id}`,
        albumImageUrl: pick.album.images[0]?.url ?? null,
      };
    })
  );

  const tracks: PlaylistTrack[] = [];
  for (const r of resolved) {
    if (r.status === "fulfilled" && r.value !== null) tracks.push(r.value);
  }
  return tracks;
}

/**
 * Converts a DB track row into a PlaylistTrack.
 * If the track has no stored Spotify ID, falls back to findTrack().
 */
async function resolveDbTrack(
  t: DbTrack,
  section: "anchor" | "groove",
  reason: string,
  spotify: ReturnType<typeof createSpotifyClient>,
): Promise<PlaylistTrack> {
  let trackId = t.spotify_track_id ?? null;
  let albumImg = t.album_image_url ?? null;

  // Fallback search if ID missing from DB
  if (!trackId) {
    const found = await spotify.findTrack(t.track_name, t.artist_names?.[0] ?? "");
    if (found) {
      trackId = found.id;
      albumImg = found.album.images[0]?.url ?? null;
    }
  }

  return {
    trackName: t.track_name,
    artistName: t.artist_names?.[0] ?? "Unknown",
    section,
    reason,
    spotifyTrackId: trackId,
    spotifyUri: trackId ? `spotify:track:${trackId}` : null,
    albumImageUrl: albumImg,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const userPrompt: string    = body.prompt        ?? "";
  const sessionMinutes: number                     = body.sessionMinutes ?? 60;
  const familiarity: "familiar" | "mixed" | "fresh" = body.familiarity ?? "mixed";
  const intensity:   "low" | "mid" | "high"        = body.intensity   ?? "mid";
  const vocals:      "any" | "lyrics" | "instrumental" = body.vocals  ?? "any";
  const language:    "any" | "english" | "match"   = body.language    ?? "any";
  const genreLock:   string | null = body.genreLock  ?? null;
  const artistLock:  string | null = body.artistLock ?? null;

  if (!userPrompt.trim() && familiarity !== "fresh") {
    return NextResponse.json({ error: "Provide a description or pick a mood" }, { status: 400 });
  }

  const counts = trackCount(sessionMinutes);

  try {
    const admin = createAdminClient();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // ── Fetch user data ───────────────────────────────────────────────────────
    const [
      { data: shortTracksRaw }, { data: shortArtists },
      { data: longTracksRaw },
      { data: history3d },
      { data: history7d },
      { data: profileData },
    ] = await Promise.all([
      admin.from("user_top_tracks")
        .select("track_name, artist_names, spotify_track_id, album_image_url")
        .eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(30),
      admin.from("user_top_artists")
        .select("artist_name, genres")
        .eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(15),
      admin.from("user_top_tracks")
        .select("track_name, artist_names, spotify_track_id, album_image_url")
        .eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(50),
      admin.from("user_listening_history")
        .select("track_name, artist_names, played_at")
        .eq("user_id", user.id).gte("played_at", threeDaysAgo),
      admin.from("user_listening_history")
        .select("track_name, artist_names")
        .eq("user_id", user.id).gte("played_at", sevenDaysAgo),
      admin.from("user_profiles")
        .select("country")
        .eq("id", user.id).maybeSingle(),
    ]);

    // User's Spotify market (country code) — used for artist top-tracks lookup
    const userMarket: string = (profileData as { country?: string } | null)?.country ?? "US";

    // ── Build blocklist + recent set ──────────────────────────────────────────
    const playCounts3d: Record<string, { count: number; lateNightOnly: boolean }> = {};
    for (const p of history3d ?? []) {
      const hour = new Date(p.played_at).getHours();
      const key = `${p.track_name}|||${p.artist_names?.[0]}`;
      if (!playCounts3d[key]) playCounts3d[key] = { count: 0, lateNightOnly: true };
      if (!(hour >= 23 || hour < 7)) playCounts3d[key].lateNightOnly = false;
      playCounts3d[key].count++;
    }
    const recentSet = new Set((history7d ?? []).map(
      (p) => `${p.track_name}|||${p.artist_names?.[0]}`
    ));

    // ── Filter candidates ─────────────────────────────────────────────────────
    const shortCandidates = (shortTracksRaw as DbTrack[] ?? []).filter((t) => {
      const key = `${t.track_name}|||${t.artist_names?.[0]}`;
      const pc = playCounts3d[key];
      return !pc || pc.count < 5 || pc.lateNightOnly;
    });

    const longCandidates = (longTracksRaw as DbTrack[] ?? []).filter(
      (t) => !recentSet.has(`${t.track_name}|||${t.artist_names?.[0]}`)
    );

    // ── Taste profile ─────────────────────────────────────────────────────────
    const topArtists = (shortArtists ?? []).slice(0, 8).map((a) => a.artist_name).join(", ");
    const allGenres  = [...new Set((shortArtists ?? []).flatMap((a) => a.genres ?? []))];
    const genreStr   = allGenres.slice(0, 6).join(", ");
    const nativeLanguages = detectNonEnglishLanguages(allGenres);

    // ── Shared constraint strings ─────────────────────────────────────────────
    const intensityStr =
      intensity === "high"
        ? "\nINTENSITY: HIGH — high-energy, driving, upbeat throughout. Reject any slow or low-key tracks."
        : intensity === "low"
        ? "\nINTENSITY: LOW — calm, gentle, slow-tempo only. No hype, no drops, no high-energy moments. Every track must feel relaxing."
        : "";

    const constraints: string[] = [];
    if (vocals === "lyrics")       constraints.push("Only tracks WITH lyrics — no instrumentals");
    if (vocals === "instrumental") constraints.push("Only INSTRUMENTAL tracks — no vocals");
    if (language === "english")    constraints.push("Only English-language tracks");
    if (language === "match" && nativeLanguages.length > 0)
      constraints.push(`Mix in tracks in: ${nativeLanguages.join(", ")}`);
    if (genreLock)  constraints.push(`Genre must be within: ${genreLock}`);
    if (artistLock) constraints.push(`Artist preference: ${artistLock}`);
    const constraintsStr = constraints.length > 0
      ? "\nHARD CONSTRAINTS (never violate):\n" + constraints.map((c) => `- ${c}`).join("\n")
      : "";

    const requestStr = userPrompt.trim() || "Discover great music matching my taste";
    const spotify    = createSpotifyClient(user.id);
    const hasData    = shortCandidates.length > 0 || longCandidates.length > 0;

    // ── FRESH / DISCOVERY MODE — all new artists ──────────────────────────────
    if (familiarity === "fresh" || !hasData) {
      const recentTracksStr = [...recentSet].slice(0, 20).map((k) => k.split("|||")[0]).join(", ");

      // Ask for artists as buffer in case some fail Spotify resolution.
      // Hard cap at 10: each artist = 2 Spotify calls (search + top-tracks).
      // 10 artists × 2 calls = 20 calls → stays well under Vercel's function timeout.
      // More artists doesn't help for niche genres — the AI starts hallucinating names.
      const targetCount = familiarity === "fresh" ? counts.total : counts.discovery;
      const askFor      = Math.min(Math.ceil(targetCount * 1.5), 10);

      const freshPrompt = `You are curating a discovery playlist for a music lover.

REQUEST: "${requestStr}"${intensityStr}

THEIR TASTE DNA:
- Core genres: ${genreStr || "varied"}
- Known artists — DO NOT suggest any of these: ${topArtists || "none"}
- Recently played — DO NOT suggest: ${recentTracksStr || "none"}
${nativeLanguages.length > 0 ? `- Also appreciates: ${nativeLanguages.join(", ")} music` : ""}
${constraintsStr}

Name ${askFor} ARTISTS that are completely new to this listener but match their taste and this request perfectly.
Think: lesser-known gems, cult favourites, underground artists — tracks that make someone say "how did I not know this?"

Return ONLY valid JSON:
{
  "intro": "2 sentences — hype these hand-picked discoveries tailored to the user's taste",
  "discovery": [
    { "name": "Exact artist name as known on Spotify", "reason": "one sentence why they fit" }
  ]
}`;

      const freshAI = await openai.chat.completions.create({
        model: FAST_MODEL, max_tokens: 600,
        messages: [
          { role: "system", content: MUSIC_EXPERT_SYSTEM },
          { role: "user",   content: freshPrompt },
        ],
      });

      const freshText  = freshAI.choices[0].message.content ?? "";
      const freshMatch = freshText.match(/\{[\s\S]*\}/)?.[0];
      if (!freshMatch) throw new Error("AI returned invalid response");

      const freshResult = JSON.parse(freshMatch) as {
        intro: string;
        discovery: { name: string; reason: string }[];
      };

      let tracks = await resolveDiscoveryArtists(
        freshResult.discovery ?? [],
        recentSet,
        spotify,
        userMarket,
      );

      // Fallback: direct Spotify keyword search — runs whenever artist resolution
      // didn't fill the list. Much faster and more reliable than asking the AI for
      // specific track names (which it hallucinates for niche genres like "afro house").
      // One search call returns 20 real, verified tracks in ~200 ms.
      if (tracks.length < targetCount) {
        try {
          const knownArtistNorms = new Set(
            topArtists.toLowerCase().split(", ").map((s) => s.trim().replace(/[^a-z0-9]/g, ""))
          );
          const searchResult = await spotify.searchTracks(requestStr, 20);
          for (const track of searchResult.tracks.items) {
            if (tracks.length >= targetCount) break;
            const artistName  = track.artists[0]?.name ?? "";
            const artistNorm  = artistName.toLowerCase().replace(/[^a-z0-9]/g, "");
            // Skip known artists and recently-played tracks
            if (knownArtistNorms.has(artistNorm)) continue;
            if (recentSet.has(`${track.name}|||${artistName}`)) continue;
            // Skip duplicates already in our list
            if (tracks.some((t) => t.spotifyTrackId === track.id)) continue;
            tracks.push({
              trackName:      track.name,
              artistName,
              section:        "discovery",
              reason:         `Fresh ${requestStr} track`,
              spotifyTrackId: track.id,
              spotifyUri:     `spotify:track:${track.id}`,
              albumImageUrl:  track.album.images[0]?.url ?? null,
            });
          }
        } catch { /* best effort — we may already have partial results */ }
      }

      if (tracks.length === 0) {
        return NextResponse.json(
          { error: "Couldn't find matching tracks on Spotify for this request. Try rephrasing or picking a different mood." },
          { status: 422 }
        );
      }

      return buildResponse(
        tracks.slice(0, targetCount),
        freshResult.intro,
        userPrompt,
        admin,
        user.id,
      );
    }

    // ── CURATOR MODE — algorithmic selection, no AI call ─────────────────────
    //
    // Removing the AI call from this path cuts response time from ~8s to ~1.5s.
    // Track selection is still personalised — anchor uses the user's most-played
    // recent tracks, groove shuffles their all-time favourites, discovery comes
    // from a direct Spotify keyword search filtered to exclude known artists.
    // Only Fresh mode (above) uses the AI, where naming new artists is the
    // entire point.

    const anchorTarget    = shortCandidates.length > 0 ? counts.anchor : 0;
    const grooveTarget    = longCandidates.length > 0
      ? Math.min(counts.groove, longCandidates.length) : 0;
    const discoveryTarget = familiarity === "familiar" ? 0 : counts.discovery;

    // Anchor: top-ranked recent tracks (already sorted by rank in the DB query)
    const anchorRows = shortCandidates.slice(0, anchorTarget);

    // Groove: shuffle all-time favourites so the playlist feels fresh each time
    const shuffledLong = [...longCandidates].sort(() => Math.random() - 0.5);
    const grooveRows   = shuffledLong.slice(0, grooveTarget);

    // Resolve anchor + groove + discovery in parallel ─────────────────────────
    const knownArtistNorms = new Set(
      topArtists.toLowerCase().split(", ").map((s) => s.trim().replace(/[^a-z0-9]/g, ""))
    );

    const [anchorTracks, grooveTracks, discoveryTracks] = await Promise.all([
      Promise.all(anchorRows.map((t) =>
        resolveDbTrack(t, "anchor", "One of your most-played recent tracks", spotify)
      )),
      Promise.all(grooveRows.map((t) =>
        resolveDbTrack(t, "groove", "A favourite from your all-time listens", spotify)
      )),
      // Discovery: one fast Spotify search — returns real tracks instantly
      discoveryTarget > 0
        ? spotify.searchTracks(requestStr, 20).then((r) => {
            const out: PlaylistTrack[] = [];
            for (const track of r.tracks.items) {
              if (out.length >= discoveryTarget) break;
              const artistName = track.artists[0]?.name ?? "";
              const artistNorm = artistName.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (knownArtistNorms.has(artistNorm)) continue;
              if (recentSet.has(`${track.name}|||${artistName}`)) continue;
              out.push({
                trackName:      track.name,
                artistName,
                section:        "discovery",
                reason:         `Matches "${requestStr}"`,
                spotifyTrackId: track.id,
                spotifyUri:     `spotify:track:${track.id}`,
                albumImageUrl:  track.album.images[0]?.url ?? null,
              });
            }
            return out;
          }).catch(() => [] as PlaylistTrack[])
        : Promise.resolve([] as PlaylistTrack[]),
    ]);

    const allTracks = [...anchorTracks, ...grooveTracks, ...discoveryTracks];

    // Simple intro — no AI needed
    const moodLabel = requestStr.length < 60 ? `"${requestStr}"` : "your current vibe";
    const intro = familiarity === "familiar"
      ? `Your comfort playlist — the tracks you know and love, ready to play.`
      : `Built for ${moodLabel}: your recent favourites set the tone, your all-time listens carry the journey${discoveryTracks.length > 0 ? ", and a few fresh finds to keep it interesting" : ""}.`;

    return buildResponse(allTracks, intro, userPrompt, admin, user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Persist + respond ────────────────────────────────────────────────────────

async function buildResponse(
  tracks: PlaylistTrack[],
  intro: string,
  promptUsed: string,
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  // Save to generated_playlists
  let playlistId: string | null = null;
  try {
    const verifiedCount  = tracks.filter((t) => t.spotifyTrackId).length;
    const coverImageUrl  = tracks.find((t) => t.albumImageUrl)?.albumImageUrl ?? null;
    const nameLabel      = promptUsed.trim().slice(0, 40) || "Generated Playlist";
    const dateLabel      = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const { data: pl } = await admin
      .from("generated_playlists")
      .insert({
        user_id:         userId,
        name:            `${nameLabel} — ${dateLabel}`,
        description:     intro,
        prompt_used:     promptUsed.trim(),
        mood_tags:       [],
        track_count:     verifiedCount,
        cover_image_url: coverImageUrl,
      })
      .select("id")
      .single();

    if (pl?.id) {
      playlistId = pl.id;
      const trackRows = tracks
        .filter((t) => t.spotifyTrackId)
        .map((t, i) => ({
          playlist_id:      pl.id,
          spotify_track_id: t.spotifyTrackId!,
          track_name:       t.trackName,
          artist_names:     [t.artistName],
          album_image_url:  t.albumImageUrl ?? null,
          position:         i,
          claude_note:      t.reason,
        }));
      if (trackRows.length > 0) {
        await admin.from("playlist_tracks").insert(trackRows);
      }
    }
  } catch (dbErr) {
    console.error("[mood-playlist] DB save failed:", dbErr);
  }

  return NextResponse.json({ intro, tracks, playlistId });
}
