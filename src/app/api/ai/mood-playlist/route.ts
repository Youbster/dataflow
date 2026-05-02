import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";
import { primeTokenCache } from "@/lib/spotify/token";
import type { SpotifyTrack, SpotifyArtist } from "@/types/spotify";

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

/** Maps a SpotifyTrack directly to a PlaylistTrack — no extra API calls needed. */
function resolveSpotifyTrack(
  t: SpotifyTrack,
  section: "anchor" | "groove",
  reason: string,
): PlaylistTrack {
  return {
    trackName:      t.name,
    artistName:     t.artists[0]?.name ?? "Unknown",
    section,
    reason,
    spotifyTrackId: t.id,
    spotifyUri:     t.uri,
    albumImageUrl:  t.album.images[0]?.url ?? null,
  };
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
  const resolved = await Promise.allSettled(
    artists.map(async ({ name, reason }) => {
      const artist = await spotify.searchArtist(name);
      if (!artist) return null;

      const topTracks = await spotify.getArtistTopTracks(artist.id, market);
      if (topTracks.length === 0) return null;

      const fresh = topTracks.filter(
        (t) => !recentSet.has(`${t.name}|||${t.artists[0]?.name ?? ""}`)
      );
      const pick: SpotifyTrack = (fresh.length > 0 ? fresh : topTracks)[0];

      return {
        trackName:      pick.name,
        artistName:     pick.artists[0]?.name ?? artist.name,
        section:        "discovery" as const,
        reason,
        spotifyTrackId: pick.id,
        spotifyUri:     `spotify:track:${pick.id}`,
        albumImageUrl:  pick.album.images[0]?.url ?? null,
      };
    })
  );

  const tracks: PlaylistTrack[] = [];
  for (const r of resolved) {
    if (r.status === "fulfilled" && r.value !== null) tracks.push(r.value);
  }
  return tracks;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // getSession() decodes the JWT from the cookie locally — zero HTTP round-trips.
  // (getUser() would make an HTTP call to Supabase auth server every request.)
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = session.user;

  // Supabase stores the Spotify access token in the session cookie right after
  // OAuth (session.provider_token). If it's still there, seed the in-process
  // token cache so the first Spotify API call skips the Supabase DB query
  // entirely. After ~1 hour the session refreshes without a new provider_token,
  // so this is a best-effort optimisation — the DB fallback handles the rest.
  // If the token turns out to be expired, SpotifyClient.request() detects the
  // 401 from Spotify, evicts the cache entry, and retries via DB automatically.
  if (session.provider_token) {
    // Spotify tokens last 1 hour. We don't know exactly when this one was
    // issued, so assume 30 minutes remaining — conservative but safe.
    primeTokenCache(user.id, session.provider_token, Date.now() + 30 * 60 * 1000);
  }

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

  const counts  = trackCount(sessionMinutes);
  const spotify = createSpotifyClient(user.id);

  try {
    // ── Fetch user data — direct Spotify calls, no Supabase data queries ──────
    //
    // Previously: 4 Supabase admin queries → cold-start Supabase free tier could
    // hang for 20-30s before returning.
    // Now: 4 parallel Spotify API calls — token is cached in-process (token.ts),
    // so only 1 DB hit happens (first call), subsequent calls use the cache.
    // Total expected latency: ~300-600 ms vs 5-30 s.
    const [
      shortTracksData,
      longTracksData,
      shortArtistsData,
      recentlyPlayedData,
    ] = await Promise.all([
      spotify.getTopTracks("short_term", 50).catch(() => ({ items: [] as SpotifyTrack[], total: 0, limit: 0, offset: 0, next: null })),
      spotify.getTopTracks("long_term",  50).catch(() => ({ items: [] as SpotifyTrack[], total: 0, limit: 0, offset: 0, next: null })),
      spotify.getTopArtists("short_term", 10).catch(() => ({ items: [] as SpotifyArtist[], total: 0, limit: 0, offset: 0, next: null })),
      spotify.getRecentlyPlayed(50).catch(() => ({ items: [], next: null, cursors: null })),
    ]);

    // ── Build recent set + play counts from recently-played ───────────────────
    const playCounts7d: Record<string, number> = {};
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const p of recentlyPlayedData.items ?? []) {
      // Spotify only returns ~50 recent plays — filter to the last 7 days
      if (new Date(p.played_at).getTime() < sevenDaysAgo) continue;
      const key = `${p.track.name}|||${p.track.artists[0]?.name ?? ""}`;
      playCounts7d[key] = (playCounts7d[key] ?? 0) + 1;
    }
    const recentSet = new Set(Object.keys(playCounts7d));

    // ── Build candidate pools directly from Spotify data ─────────────────────
    // SpotifyTrack always has an id — no need to filter for missing IDs.
    const shortCandidates = (shortTracksData.items ?? []).filter((t) => {
      const key = `${t.name}|||${t.artists[0]?.name ?? ""}`;
      return (playCounts7d[key] ?? 0) < 10; // skip if over-played this week
    });

    const longCandidates = (longTracksData.items ?? []).filter((t) => {
      const key = `${t.name}|||${t.artists[0]?.name ?? ""}`;
      return !recentSet.has(key);
    });

    // ── Taste profile ─────────────────────────────────────────────────────────
    const shortArtists  = shortArtistsData.items ?? [];
    const topArtists    = shortArtists.slice(0, 8).map((a) => a.name).join(", ");
    const allGenres     = [...new Set(shortArtists.flatMap((a) => a.genres ?? []))];
    const genreStr      = allGenres.slice(0, 6).join(", ");
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
    const hasData    = shortCandidates.length > 0 || longCandidates.length > 0;

    // ── FRESH / DISCOVERY MODE — all new artists ──────────────────────────────
    if (familiarity === "fresh" || !hasData) {
      const recentTracksStr = [...recentSet].slice(0, 20).map((k) => k.split("|||")[0]).join(", ");

      // Ask for artists as buffer in case some fail Spotify resolution.
      // Hard cap at 10: each artist = 2 Spotify calls (search + top-tracks).
      // 10 artists × 2 calls = 20 calls → stays well under Vercel's function timeout.
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

      // Use the user's Spotify market if known (stored during OAuth callback),
      // falling back to US. This ensures non-US artists have top tracks available.
      const userMarket: string = (user.user_metadata?.country as string | undefined) ?? "US";

      let tracks = await resolveDiscoveryArtists(
        freshResult.discovery ?? [],
        recentSet,
        spotify,
        userMarket,
      );

      // Fallback: direct Spotify keyword search when artist resolution
      // didn't fill the list. Much faster for niche genres (afro house, etc.).
      if (tracks.length < targetCount) {
        try {
          const knownArtistNorms = new Set(
            topArtists.toLowerCase().split(", ").filter(Boolean).map((s) => s.trim().replace(/[^a-z0-9]/g, ""))
          );
          const searchResult = await spotify.searchTracks(requestStr, 20);

          // First pass: prefer artists the user doesn't already know
          for (const track of searchResult.tracks.items) {
            if (tracks.length >= targetCount) break;
            const artistName = track.artists[0]?.name ?? "";
            const artistNorm = artistName.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (knownArtistNorms.has(artistNorm)) continue;
            if (recentSet.has(`${track.name}|||${artistName}`)) continue;
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

          // Second pass (last resort): if the genre is dominated by the user's
          // own top artists (common for niche tastes like Arabic pop, Afrobeats,
          // K-pop), relax the known-artist filter so we always return something.
          if (tracks.length === 0) {
            for (const track of searchResult.tracks.items) {
              if (tracks.length >= targetCount) break;
              const artistName = track.artists[0]?.name ?? "";
              if (recentSet.has(`${track.name}|||${artistName}`)) continue;
              if (tracks.some((t) => t.spotifyTrackId === track.id)) continue;
              tracks.push({
                trackName:      track.name,
                artistName,
                section:        "discovery",
                reason:         `Top result for "${requestStr}"`,
                spotifyTrackId: track.id,
                spotifyUri:     `spotify:track:${track.id}`,
                albumImageUrl:  track.album.images[0]?.url ?? null,
              });
            }
          }
        } catch { /* best effort */ }
      }

      if (tracks.length === 0) {
        return NextResponse.json(
          { error: "Couldn't find matching tracks on Spotify for this request. Try rephrasing or picking a different mood." },
          { status: 422 }
        );
      }

      return buildResponse(tracks.slice(0, targetCount), freshResult.intro, userPrompt, user.id);
    }

    // ── CURATOR MODE — AI-selected tracks from your library ──────────────────
    //
    // Previous approach: always picked the top-ranked tracks regardless of
    // mood → the same 3 anchor tracks appeared in every playlist.
    //
    // New approach: build a pool of up to 40 candidates from your library,
    // let gpt-4o-mini pick which ones best fit the mood/vibe. Falls back to
    // the rank-order algorithm if the AI call fails.
    // Added latency: ~400 ms (gpt-4o-mini returning just indices).

    const anchorTarget    = shortCandidates.length > 0 ? counts.anchor : 0;
    const grooveTarget    = longCandidates.length > 0
      ? Math.min(counts.groove, longCandidates.length) : 0;
    const discoveryTarget = familiarity === "familiar" ? 0 : counts.discovery;
    const needed          = anchorTarget + grooveTarget;

    // Build known-artist set for discovery filtering
    const knownArtistNorms = new Set(
      topArtists.toLowerCase().split(", ").filter(Boolean).map((s) => s.trim().replace(/[^a-z0-9]/g, ""))
    );

    // Deduplicated pool: recent tracks first (they become anchors), then
    // all-time favourites. Cap at 40 so the AI prompt stays small.
    const seenIds = new Set<string>();
    const pool: Array<{ track: SpotifyTrack; era: "recent" | "classic" }> = [];
    for (const t of shortCandidates) {
      if (pool.length >= 20) break;
      if (!seenIds.has(t.id)) { seenIds.add(t.id); pool.push({ track: t, era: "recent" }); }
    }
    for (const t of longCandidates) {
      if (pool.length >= 40) break;
      if (!seenIds.has(t.id)) { seenIds.add(t.id); pool.push({ track: t, era: "classic" }); }
    }

    let anchorRows: SpotifyTrack[] = [];
    let grooveRows: SpotifyTrack[] = [];

    if (pool.length > 0 && needed > 0) {
      // ── AI selection — ask which tracks fit the mood best ──────────────────
      let aiIndices: number[] | null = null;

      try {
        const trackList = pool
          .map((p, i) => `${i}: "${p.track.name}" – ${p.track.artists[0]?.name ?? "Unknown"}`)
          .join("\n");

        const selAI = await openai.chat.completions.create({
          model: FAST_MODEL,
          max_tokens: 160,
          messages: [
            {
              role: "system",
              content: "You are a DJ. Given a numbered track list, return ONLY a JSON array of indices.",
            },
            {
              role: "user",
              content:
                `Pick the ${needed} tracks from the list below that best fit this vibe: "${requestStr}"${intensityStr}${constraintsStr}\n\n` +
                `${trackList}\n\nReturn ONLY a JSON array like [0, 4, 7, …] — no explanation.`,
            },
          ],
        });

        const raw   = selAI.choices[0].message.content ?? "";
        const match = raw.match(/\[[^\]]+\]/)?.[0];
        if (match) {
          const parsed = JSON.parse(match) as unknown[];
          aiIndices = parsed
            .filter((v): v is number => typeof v === "number" && v >= 0 && v < pool.length)
            .slice(0, needed);
        }
      } catch {
        // AI failed — fall through to algorithmic fallback below
      }

      if (aiIndices && aiIndices.length >= Math.min(needed, 3)) {
        // Use AI-selected tracks. Preserve era distinction: first anchorTarget
        // items become anchors, remainder become groove. Sort AI picks to put
        // recent-era entries first so anchors skew toward what you've been playing.
        const sorted = [...aiIndices].sort((a, b) => {
          const eraA = pool[a].era === "recent" ? 0 : 1;
          const eraB = pool[b].era === "recent" ? 0 : 1;
          return eraA - eraB;
        });
        anchorRows = sorted.slice(0, anchorTarget).map((i) => pool[i].track);
        grooveRows = sorted.slice(anchorTarget, needed).map((i) => pool[i].track);
      } else {
        // Algorithmic fallback: shuffle both pools for variety
        const shuffledShort = [...shortCandidates].sort(() => Math.random() - 0.5);
        const shuffledLong  = [...longCandidates].sort(() => Math.random() - 0.5);
        anchorRows = shuffledShort.slice(0, anchorTarget);
        grooveRows = shuffledLong.slice(0, grooveTarget);
      }
    }

    // Discovery: Spotify keyword search for tracks that match the vibe
    // but aren't from artists the user already knows well.
    const discoveryTracks = await (
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
        : Promise.resolve([] as PlaylistTrack[])
    );

    const anchorTracks = anchorRows.map((t) => resolveSpotifyTrack(t, "anchor", "Picked for your vibe"));
    const grooveTracks = grooveRows.map((t) => resolveSpotifyTrack(t, "groove", "Fits perfectly with your mood"));
    const allTracks    = [...anchorTracks, ...grooveTracks, ...discoveryTracks];

    const moodLabel = requestStr.length < 60 ? `"${requestStr}"` : "your current vibe";
    const intro = familiarity === "familiar"
      ? `Your comfort playlist — the tracks that fit ${moodLabel}, ready to play.`
      : `Built for ${moodLabel}: tracks from your library that match the vibe${discoveryTracks.length > 0 ? ", plus a few fresh finds" : ""}.`;

    return buildResponse(allTracks, intro, userPrompt, user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ─── Respond immediately, persist in background ───────────────────────────────
//
// after() runs AFTER the response is sent — the DB save never adds to
// response latency. The client gets intro + tracks instantly; playlistId
// is null on the first render (the Save-to-Spotify button still works fine
// because the playlists endpoint creates its own record if needed).

function buildResponse(
  tracks: PlaylistTrack[],
  intro: string,
  promptUsed: string,
  userId: string,
): NextResponse {
  const response = NextResponse.json({ intro, tracks, playlistId: null });

  after(async () => {
    try {
      const admin = createAdminClient();
      const verifiedCount = tracks.filter((t) => t.spotifyTrackId).length;
      const coverImageUrl = tracks.find((t) => t.albumImageUrl)?.albumImageUrl ?? null;
      const nameLabel     = promptUsed.trim().slice(0, 40) || "Generated Playlist";
      const dateLabel     = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

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
  });

  return response;
}
