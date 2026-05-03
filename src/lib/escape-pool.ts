import type { createAdminClient } from "@/lib/supabase/admin";
import type { createSpotifyClient } from "@/lib/spotify/client";
import type { SpotifyTrack } from "@/types/spotify";

type AdminClient = ReturnType<typeof createAdminClient>;
type SpotifyClient = ReturnType<typeof createSpotifyClient>;

export interface EscapePoolRow {
  spotify_track_id: string;
  track_name: string;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_name: string | null;
  album_image_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  popularity: number | null;
  source: string;
  source_ref: string | null;
  genres: string[] | null;
  mood_tags: string[] | null;
  affinity_score: number | string | null;
  novelty_score: number | string | null;
  last_recommended_at: string | null;
  blocked_until: string | null;
  updated_at: string | null;
}

export interface EscapePoolSelectionContext {
  targetCount: number;
  requestText: string;
  mode: "break_loop" | "build_vibe" | "friend_taste";
  breakLoopMode?: "near_taste" | "new_lane" | "energy_shift" | "surprise";
  intensity: "low" | "mid" | "high";
  genreHints: string[];
  blockedTrackIds: Set<string>;
  blockedTrackNorms: Set<string>;
  repeatedArtistNorms?: Set<string>;
  knownArtistNorms?: Set<string>;
}

export interface EscapePlaylistTrack {
  trackName: string;
  artistName: string;
  section: "anchor" | "groove" | "discovery";
  reason: string;
  spotifyTrackId: string | null;
  spotifyUri: string | null;
  albumImageUrl: string | null;
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokensFromText(value: string | null | undefined): string[] {
  return normalizeToken(value ?? "")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function trackIdentity(trackName: string, artistName: string): string {
  return normalizeForCompare(`${trackName}|||${artistName}`);
}

function numericScore(value: number | string | null | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function escapeRowToTrack(row: EscapePoolRow): SpotifyTrack {
  const artistNames = row.artist_names ?? [];
  const artistIds = row.artist_ids ?? [];
  return {
    id: row.spotify_track_id,
    name: row.track_name,
    uri: `spotify:track:${row.spotify_track_id}`,
    artists: artistNames.map((name, index) => ({
      id: artistIds[index] ?? "",
      name,
    })),
    album: {
      id: "",
      name: row.album_name ?? "",
      images: row.album_image_url
        ? [{ url: row.album_image_url, width: 640, height: 640 }]
        : [],
    },
    duration_ms: row.duration_ms ?? 0,
    popularity: row.popularity ?? 50,
    preview_url: row.preview_url ?? null,
  };
}

function trackToPoolRow(
  userId: string,
  track: SpotifyTrack,
  source: string,
  sourceRef: string,
  affinityScore: number,
  noveltyScore: number,
  genres: string[] = [],
) {
  return {
    user_id: userId,
    spotify_track_id: track.id,
    track_name: track.name,
    artist_names: track.artists.map((artist) => artist.name),
    artist_ids: track.artists.map((artist) => artist.id),
    album_name: track.album.name,
    album_image_url: track.album.images[0]?.url ?? null,
    duration_ms: track.duration_ms,
    preview_url: track.preview_url,
    popularity: track.popularity,
    source,
    source_ref: sourceRef,
    genres,
    affinity_score: affinityScore,
    novelty_score: noveltyScore,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function safeUpsertPoolRows(admin: AdminClient, rows: ReturnType<typeof trackToPoolRow>[]) {
  if (rows.length === 0) return { inserted: 0 };

  const { error } = await admin
    .from("escape_pool_tracks")
    .upsert(rows, { onConflict: "user_id,spotify_track_id" });

  if (error) {
    console.warn("[escape-pool] upsert skipped:", error.message);
    return { inserted: 0 };
  }

  return { inserted: rows.length };
}

export async function refreshEscapePool(
  userId: string,
  spotify: SpotifyClient,
  admin: AdminClient,
) {
  const [{ data: topTracks }, { data: topArtists }] = await Promise.all([
    admin
      .from("user_top_tracks")
      .select("spotify_track_id, track_name, artist_names, artist_ids, album_name, album_image_url, duration_ms, preview_url, popularity, rank, time_range")
      .eq("user_id", userId)
      .in("time_range", ["short_term", "long_term"])
      .order("rank")
      .limit(80),
    admin
      .from("user_top_artists")
      .select("spotify_artist_id, artist_name, genres, rank, time_range")
      .eq("user_id", userId)
      .in("time_range", ["short_term", "long_term"])
      .order("rank")
      .limit(30),
  ]);

  const rows: ReturnType<typeof trackToPoolRow>[] = [];
  const seen = new Set<string>();

  for (const item of topTracks ?? []) {
    const track = escapeRowToTrack({
      spotify_track_id: item.spotify_track_id,
      track_name: item.track_name,
      artist_names: item.artist_names,
      artist_ids: item.artist_ids,
      album_name: item.album_name,
      album_image_url: item.album_image_url,
      duration_ms: item.duration_ms,
      preview_url: item.preview_url,
      popularity: item.popularity,
      source: "top_track",
      source_ref: item.time_range,
      genres: [],
      mood_tags: [],
      affinity_score: Math.max(30, 96 - (item.rank ?? 50)),
      novelty_score: item.time_range === "long_term" ? 22 : 8,
      last_recommended_at: null,
      blocked_until: null,
      updated_at: null,
    });
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    rows.push(trackToPoolRow(userId, track, "top_track", item.time_range, Math.max(30, 96 - (item.rank ?? 50)), item.time_range === "long_term" ? 22 : 8));
  }

  const artists = (topArtists ?? []).slice(0, 10);
  const genres = [...new Set(artists.flatMap((artist) => artist.genres ?? []))].slice(0, 10);
  const searchQueries = [
    ...artists.slice(0, 4).flatMap((artist) => [
      `${artist.artist_name} radio`,
      `${artist.artist_name} deep cuts`,
    ]),
    ...genres.slice(0, 4).map((genre) => `${genre.replace(/-/g, " ")} fresh`),
  ].slice(0, 12);

  const searchResults = await Promise.allSettled(
    searchQueries.map((query) =>
      withTimeout(
        spotify.searchTracks(query, 12).then((result) => ({ query, result })),
        2_800,
        null,
      )
    )
  );

  for (const result of searchResults) {
    if (result.status !== "fulfilled" || result.value === null) continue;
    for (const track of result.value.result.tracks.items.slice(0, 12)) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      rows.push(trackToPoolRow(userId, track, "taste_search", result.value.query, 54, 58, genres));
    }
  }

  return safeUpsertPoolRows(admin, rows.slice(0, 180));
}

export async function selectEscapePoolTracks(
  userId: string,
  admin: AdminClient,
  context: EscapePoolSelectionContext,
): Promise<EscapePlaylistTrack[]> {
  const { data, error } = await admin
    .from("escape_pool_tracks")
    .select("spotify_track_id, track_name, artist_names, artist_ids, album_name, album_image_url, duration_ms, preview_url, popularity, source, source_ref, genres, mood_tags, affinity_score, novelty_score, last_recommended_at, blocked_until, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(350);

  if (error) {
    console.warn("[escape-pool] select skipped:", error.message);
    return [];
  }

  const rows = (data ?? []) as EscapePoolRow[];
  const now = Date.now();
  const requestTokens = new Set(tokensFromText(context.requestText));
  const genreTokens = new Set(context.genreHints.flatMap(tokensFromText));
  const artistCounts = new Map<string, number>();
  const seenIds = new Set<string>();
  const scored = rows
    .map((row, index) => {
      const artistName = row.artist_names?.[0] ?? "";
      const artistNorm = normalizeForCompare(artistName);
      const trackNorm = trackIdentity(row.track_name, artistName);
      if (!row.spotify_track_id || !artistNorm) return null;
      if (context.blockedTrackIds.has(row.spotify_track_id)) return null;
      if (context.blockedTrackNorms.has(trackNorm)) return null;
      if (row.blocked_until && new Date(row.blocked_until).getTime() > now) return null;

      const haystack = normalizeToken(
        `${row.track_name} ${artistName} ${row.album_name ?? ""} ${(row.genres ?? []).join(" ")} ${(row.mood_tags ?? []).join(" ")} ${row.source_ref ?? ""}`
      );
      let score = numericScore(row.affinity_score) + numericScore(row.novelty_score);
      if (context.mode === "break_loop") score += 30;
      if (context.breakLoopMode === "near_taste") score += row.source === "top_track" ? -35 : 12;
      if (context.breakLoopMode === "new_lane" || context.breakLoopMode === "surprise") {
        if (context.knownArtistNorms?.has(artistNorm)) score -= 24;
      }
      if (context.repeatedArtistNorms?.has(artistNorm)) score -= 20;
      for (const token of requestTokens) if (haystack.includes(token)) score += 10;
      for (const token of genreTokens) if (haystack.includes(token)) score += 8;
      if (context.intensity === "high" && /\b(dance|club|remix|workout|edit|upbeat)\b/.test(haystack)) score += 10;
      if (context.intensity === "low" && /\b(chill|soft|acoustic|ambient|slow|piano)\b/.test(haystack)) score += 10;
      if (row.last_recommended_at) {
        const ageDays = (now - new Date(row.last_recommended_at).getTime()) / 86_400_000;
        if (ageDays < 14) score -= 80;
        else score -= Math.max(0, 20 - ageDays);
      }
      score -= Math.max(0, (row.popularity ?? 50) - 86);

      return { row, index, artistNorm, score };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const picked: EscapePlaylistTrack[] = [];
  for (const item of scored) {
    if (picked.length >= context.targetCount) break;
    if (seenIds.has(item.row.spotify_track_id)) continue;
    if ((artistCounts.get(item.artistNorm) ?? 0) >= (context.breakLoopMode === "near_taste" ? 3 : 2)) continue;
    const section =
      picked.length < Math.max(1, Math.round(context.targetCount * 0.25))
        ? "anchor"
        : picked.length < Math.max(2, Math.round(context.targetCount * 0.7))
        ? "groove"
        : "discovery";
    picked.push({
      trackName: item.row.track_name,
      artistName: item.row.artist_names?.[0] ?? "Unknown",
      section,
      reason:
        section === "anchor"
          ? "Escape Pool anchor - close to your taste, outside your blocked loop"
          : section === "groove"
          ? "Escape Pool bridge - familiar lane, different track"
          : "Escape Pool discovery - a fresher edge from your taste map",
      spotifyTrackId: item.row.spotify_track_id,
      spotifyUri: `spotify:track:${item.row.spotify_track_id}`,
      albumImageUrl: item.row.album_image_url ?? null,
    });
    seenIds.add(item.row.spotify_track_id);
    artistCounts.set(item.artistNorm, (artistCounts.get(item.artistNorm) ?? 0) + 1);
  }

  return picked;
}

export async function markEscapePoolRecommended(
  userId: string,
  admin: AdminClient,
  spotifyTrackIds: string[],
) {
  const ids = [...new Set(spotifyTrackIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { error } = await admin
    .from("escape_pool_tracks")
    .update({ last_recommended_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .in("spotify_track_id", ids);

  if (error) console.warn("[escape-pool] mark recommended skipped:", error.message);
}
