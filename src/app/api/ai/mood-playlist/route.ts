import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";
import { primeTokenCache } from "@/lib/spotify/token";
import { markEscapePoolRecommended, refreshEscapePool, selectEscapePoolTracks } from "@/lib/escape-pool";
import { SPOTIFY_API_BASE, SPOTIFY_TOKEN_URL } from "@/lib/constants";
import type { SpotifyTrack, SpotifyArtist, SpotifySearchResult } from "@/types/spotify";

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

interface PlaylistIntent {
  mood: string[];
  activity: string | null;
  energy: "low" | "mid" | "high";
  freshness: "familiar" | "mixed" | "fresh";
  genres: string[];
  avoid: string[];
  keywords: string[];
  flow: "steady" | "build" | "cooldown" | "peak" | null;
}

interface CandidateTrack {
  track: SpotifyTrack;
  era: "recent" | "classic";
}

interface CachedTopTrackRow {
  spotify_track_id: string;
  track_name: string;
  artist_names: string[] | null;
  artist_ids: string[] | null;
  album_name: string | null;
  album_image_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  popularity: number | null;
  rank: number;
}

interface CachedTopArtistRow {
  spotify_artist_id: string;
  artist_name: string;
  genres: string[] | null;
  image_url: string | null;
  popularity: number | null;
  follower_count: number | null;
  rank: number;
}

interface CachedHistoryRow {
  spotify_track_id: string;
  track_name: string;
  artist_names: string[] | null;
  album_name: string | null;
  album_image_url: string | null;
  played_at: string;
}

interface ScoreContext {
  intent: PlaylistIntent;
  requestTokens: Set<string>;
  genreTokens: Set<string>;
  knownArtistNorms: Set<string>;
  artistGenreMap: Map<string, string[]>;
  playCounts7d: Record<string, number>;
}

interface CachedPlaylist {
  intro: string;
  tracks: PlaylistTrack[];
  playlistId: null;
  expiresAt: number;
}

interface SpotifyAlbumItem {
  id: string;
  name: string;
  release_date: string;
  images: SpotifyTrack["album"]["images"];
}

interface SpotifyAlbumTracksResponse {
  items: Array<{
    id: string | null;
    name: string;
    uri: string;
    artists: SpotifyTrack["artists"];
    duration_ms: number;
    preview_url: string | null;
  }>;
}

type GenerationGoal = "build_vibe" | "break_loop";
type BreakLoopMode = "near_taste" | "new_lane" | "energy_shift" | "surprise";

const PLAYLIST_CACHE = new Map<string, CachedPlaylist>();
const PLAYLIST_CACHE_TTL_MS = 15 * 60 * 1000;
const PLAYLIST_CACHE_MAX_ENTRIES = 80;
let SPOTIFY_APP_TOKEN: { token: string; expiresAt: number } | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function trackCount(sessionMinutes: number) {
  // ~3.5 min/track average
  if (sessionMinutes <= 20) return { total: 6,  anchor: 2, groove: 2, discovery: 2 };
  if (sessionMinutes <= 60) return { total: 18, anchor: 3, groove: 11, discovery: 4 };
  return                           { total: 30, anchor: 4, groove: 18, discovery: 8 };
}

function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function trackIdentity(trackName: string, artistName: string): string {
  return normalizeForCompare(`${trackName}|||${artistName}`);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function getSpotifyAppToken(): Promise<string> {
  if (SPOTIFY_APP_TOKEN && SPOTIFY_APP_TOKEN.expiresAt > Date.now() + 60_000) {
    return SPOTIFY_APP_TOKEN.token;
  }

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    throw new Error(`Spotify app token failed: ${await response.text()}`);
  }

  const tokenResponse = (await response.json()) as { access_token: string; expires_in: number };
  SPOTIFY_APP_TOKEN = {
    token: tokenResponse.access_token,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000,
  };
  return tokenResponse.access_token;
}

async function searchTracksForGeneration(
  spotify: ReturnType<typeof createSpotifyClient>,
  query: string,
  limit: number,
): Promise<SpotifySearchResult> {
  try {
    return await spotify.searchTracks(query, limit);
  } catch (userTokenErr) {
    const token = await getSpotifyAppToken();
    const response = await fetch(
      `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
      const message = await response.text();
      console.warn("[mood-playlist] Spotify generation search failed", {
        query,
        userTokenError: userTokenErr instanceof Error ? userTokenErr.message : String(userTokenErr),
        appTokenError: message,
      });
      throw new Error(`Spotify search failed: ${message}`);
    }

    return response.json();
  }
}

async function spotifyAppGet<T>(endpoint: string): Promise<T> {
  const token = await getSpotifyAppToken();
  const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Spotify app GET ${endpoint} failed: ${await response.text()}`);
  }

  return response.json();
}

async function getArtistCatalogTracks(artistIds: string[]): Promise<SpotifyTrack[]> {
  const uniqueArtistIds = [...new Set(artistIds.filter(Boolean))].slice(0, 8);
  if (uniqueArtistIds.length === 0) return [];

  const albumResponses = await Promise.allSettled(
    uniqueArtistIds.map((artistId) =>
      spotifyAppGet<{ items: SpotifyAlbumItem[] }>(
        `/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single&market=US&limit=6`,
      )
    )
  );
  const albumIds = [
    ...new Set(
      albumResponses
        .filter((result): result is PromiseFulfilledResult<{ items: SpotifyAlbumItem[] }> => result.status === "fulfilled")
        .flatMap((result) => result.value.items)
        .sort((a, b) => (b.release_date ?? "").localeCompare(a.release_date ?? ""))
        .map((album) => album.id)
        .filter(Boolean)
    ),
  ].slice(0, 18);

  if (albumIds.length === 0) return [];

  const albumTrackResponses = await Promise.allSettled(
    albumIds.map((albumId) =>
      spotifyAppGet<SpotifyAlbumTracksResponse>(
        `/albums/${encodeURIComponent(albumId)}/tracks?market=US&limit=20`,
      )
    )
  );
  const trackIds = [
    ...new Set(
      albumTrackResponses
        .filter((result): result is PromiseFulfilledResult<SpotifyAlbumTracksResponse> => result.status === "fulfilled")
        .flatMap((result) => result.value.items)
        .map((track) => track.id)
        .filter((id): id is string => Boolean(id))
    ),
  ].slice(0, 120);

  if (trackIds.length === 0) return [];

  const trackResponses = await Promise.allSettled(
    chunkArray(trackIds, 50).map((ids) =>
      spotifyAppGet<{ tracks: Array<SpotifyTrack | null> }>(
        `/tracks?market=US&ids=${ids.map(encodeURIComponent).join(",")}`,
      )
    )
  );

  return trackResponses
    .filter((result): result is PromiseFulfilledResult<{ tracks: Array<SpotifyTrack | null> }> => result.status === "fulfilled")
    .flatMap((result) => result.value.tracks)
    .filter((track): track is SpotifyTrack => track !== null);
}

function cachedTrackToSpotifyTrack(row: CachedTopTrackRow | CachedHistoryRow): SpotifyTrack {
  const artistNames = row.artist_names ?? [];
  const artistIds = "artist_ids" in row ? row.artist_ids ?? [] : [];
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
    duration_ms: "duration_ms" in row ? row.duration_ms ?? 0 : 0,
    popularity: "popularity" in row ? row.popularity ?? 50 : 50,
    preview_url: "preview_url" in row ? row.preview_url ?? null : null,
  };
}

function cachedArtistToSpotifyArtist(row: CachedTopArtistRow): SpotifyArtist {
  return {
    id: row.spotify_artist_id,
    name: row.artist_name,
    uri: `spotify:artist:${row.spotify_artist_id}`,
    genres: row.genres ?? [],
    images: row.image_url ? [{ url: row.image_url, width: 640, height: 640 }] : [],
    popularity: row.popularity ?? 50,
    followers: { total: row.follower_count ?? 0 },
  };
}

function deriveArtistsFromTopTracks(
  rows: CachedTopTrackRow[],
  existingArtists: SpotifyArtist[],
): SpotifyArtist[] {
  const seen = new Set(existingArtists.map((artist) => artist.id).filter(Boolean));
  const derived: SpotifyArtist[] = [];

  for (const row of rows) {
    const names = row.artist_names ?? [];
    const ids = row.artist_ids ?? [];
    for (let index = 0; index < Math.min(names.length, ids.length, 3); index++) {
      const id = ids[index];
      const name = names[index];
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      derived.push({
        id,
        name,
        uri: `spotify:artist:${id}`,
        genres: [],
        images: [],
        popularity: 50,
        followers: { total: 0 },
      });
      if (derived.length >= 20) return derived;
    }
  }

  return derived;
}

function uniqueStrings(values: string[], limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = normalizeToken(value);
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function tokensFromText(text: string): string[] {
  const stop = new Set([
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from",
    "give", "great", "i", "in", "into", "is", "it", "like", "make", "me",
    "more", "music", "my", "of", "on", "or", "playlist", "some", "song",
    "songs", "that", "the", "this", "to", "track", "tracks", "with",
  ]);

  return uniqueStrings(
    normalizeToken(text)
      .split(/\s+/)
      .filter((token) => token.length > 2 && !stop.has(token)),
    16
  );
}

function buildFallbackIntent(
  requestStr: string,
  familiarity: "familiar" | "mixed" | "fresh",
  intensity: "low" | "mid" | "high",
  genreLock: string | null,
  artistLock: string | null,
): PlaylistIntent {
  const requestTokens = tokensFromText(requestStr);
  const genres = genreLock ? tokensFromText(genreLock) : [];
  const artistTokens = artistLock ? tokensFromText(artistLock) : [];

  return {
    mood: requestTokens.slice(0, 4),
    activity: null,
    energy: intensity,
    freshness: familiarity,
    genres,
    avoid: [],
    keywords: uniqueStrings([...requestTokens, ...genres, ...artistTokens], 14),
    flow: intensity === "high" ? "build" : intensity === "low" ? "cooldown" : "steady",
  };
}

function coerceIntent(
  value: unknown,
  fallback: PlaylistIntent,
): PlaylistIntent {
  if (!value || typeof value !== "object") return fallback;
  const obj = value as Record<string, unknown>;
  const energy = obj.energy === "low" || obj.energy === "high" || obj.energy === "mid"
    ? obj.energy
    : fallback.energy;
  const freshness =
    obj.freshness === "familiar" || obj.freshness === "mixed" || obj.freshness === "fresh"
      ? obj.freshness
      : fallback.freshness;
  const flow =
    obj.flow === "steady" || obj.flow === "build" || obj.flow === "cooldown" || obj.flow === "peak"
      ? obj.flow
      : fallback.flow;
  const asStringArray = (input: unknown, fallbackValues: string[]) =>
    Array.isArray(input)
      ? uniqueStrings(input.filter((v): v is string => typeof v === "string"))
      : fallbackValues;

  return {
    mood: asStringArray(obj.mood, fallback.mood),
    activity: typeof obj.activity === "string" && obj.activity.trim() ? normalizeToken(obj.activity) : fallback.activity,
    energy,
    freshness,
    genres: asStringArray(obj.genres, fallback.genres),
    avoid: asStringArray(obj.avoid, fallback.avoid),
    keywords: uniqueStrings(
      [
        ...asStringArray(obj.keywords, fallback.keywords),
        ...asStringArray(obj.mood, fallback.mood),
        ...asStringArray(obj.genres, fallback.genres),
      ],
      16
    ),
    flow,
  };
}

async function parsePlaylistIntent(
  requestStr: string,
  familiarity: "familiar" | "mixed" | "fresh",
  intensity: "low" | "mid" | "high",
  constraintsStr: string,
  genreLock: string | null,
  artistLock: string | null,
): Promise<PlaylistIntent> {
  const fallback = buildFallbackIntent(requestStr, familiarity, intensity, genreLock, artistLock);

  try {
    const aiPromise = getOpenAI().chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content:
            "You convert playlist requests into compact JSON. Return only valid JSON with no markdown.",
        },
        {
          role: "user",
          content: `Request: "${requestStr}"
Familiarity: ${familiarity}
Intensity: ${intensity}${constraintsStr}

Return this exact shape:
{
  "mood": ["short mood words"],
  "activity": "activity or null",
  "energy": "low|mid|high",
  "freshness": "familiar|mixed|fresh",
  "genres": ["genre hints"],
  "avoid": ["things to avoid"],
  "keywords": ["search/scoring words"],
  "flow": "steady|build|cooldown|peak"
}`,
        },
      ],
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Intent parse timed out")), 2_500)
    );
    const response = await Promise.race([aiPromise, timeout]);
    const text = response.choices[0].message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/)?.[0];
    if (!match) return fallback;
    return coerceIntent(JSON.parse(match), fallback);
  } catch {
    return fallback;
  }
}

function buildCacheKey(
  userId: string,
  body: {
    prompt: string;
    sessionMinutes: number;
    familiarity: string;
    intensity: string;
    goal: GenerationGoal;
    breakLoopMode: BreakLoopMode;
    breakLoopTarget: string;
    vocals: string;
    language: string;
    genreLock: string | null;
    artistLock: string | null;
  },
): string {
  return JSON.stringify({
    userId,
    prompt: normalizeToken(body.prompt),
    sessionMinutes: body.sessionMinutes,
    familiarity: body.familiarity,
    intensity: body.intensity,
    goal: body.goal,
    breakLoopMode: body.breakLoopMode,
    breakLoopTarget: normalizeToken(body.breakLoopTarget),
    vocals: body.vocals,
    language: body.language,
    genreLock: normalizeToken(body.genreLock ?? ""),
    artistLock: normalizeToken(body.artistLock ?? ""),
  });
}

function getCachedPlaylist(cacheKey: string): CachedPlaylist | null {
  const cached = PLAYLIST_CACHE.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    PLAYLIST_CACHE.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedPlaylist(cacheKey: string, value: Omit<CachedPlaylist, "expiresAt">) {
  if (PLAYLIST_CACHE.size >= PLAYLIST_CACHE_MAX_ENTRIES) {
    const oldestKey = PLAYLIST_CACHE.keys().next().value as string | undefined;
    if (oldestKey) PLAYLIST_CACHE.delete(oldestKey);
  }
  PLAYLIST_CACHE.set(cacheKey, {
    ...value,
    expiresAt: Date.now() + PLAYLIST_CACHE_TTL_MS,
  });
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

function scoreCandidateTrack(candidate: CandidateTrack, ctx: ScoreContext): number {
  const { track, era } = candidate;
  const artistName = track.artists[0]?.name ?? "";
  const key = `${track.name}|||${artistName}`;
  const artistNorm = normalizeForCompare(artistName);
  const haystack = normalizeToken(
    `${track.name} ${artistName} ${track.album.name} ${(ctx.artistGenreMap.get(artistNorm) ?? []).join(" ")}`
  );
  const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));

  let score = era === "recent" ? 26 : 18;

  const popularity = track.popularity ?? 50;
  if (popularity >= 35 && popularity <= 82) score += 12;
  else if (popularity > 82 && ctx.intent.freshness === "fresh") score -= 8;
  else if (popularity < 20) score -= 4;

  for (const token of ctx.requestTokens) {
    if (haystackTokens.has(token)) score += 8;
    else if (haystack.includes(token)) score += 4;
  }

  for (const token of ctx.intent.keywords) {
    if (haystackTokens.has(token)) score += 7;
    else if (haystack.includes(token)) score += 3;
  }

  for (const token of ctx.genreTokens) {
    if (haystack.includes(token)) score += 9;
  }

  const avoidTokens = new Set(ctx.intent.avoid.flatMap(tokensFromText));
  for (const token of avoidTokens) {
    if (haystack.includes(token)) score -= 14;
  }

  const knownArtist = ctx.knownArtistNorms.has(artistNorm);
  if (ctx.intent.freshness === "familiar" && knownArtist) score += 10;
  if (ctx.intent.freshness === "mixed" && era === "classic") score += 5;

  const lowSignals = /\b(acoustic|piano|ambient|sleep|slow|soft|lullaby|intro)\b/;
  const highSignals = /\b(club|dance|remix|edit|party|workout|hype|banger)\b/;
  if (ctx.intent.energy === "low") {
    if (lowSignals.test(haystack)) score += 6;
    if (highSignals.test(haystack)) score -= 8;
  }
  if (ctx.intent.energy === "high") {
    if (highSignals.test(haystack)) score += 6;
    if (lowSignals.test(haystack)) score -= 8;
  }

  score -= Math.min(24, (ctx.playCounts7d[key] ?? 0) * 4);

  return score;
}

function selectRankedTracks(
  candidates: CandidateTrack[],
  target: number,
  ctx: ScoreContext,
  blockedIds: Set<string> = new Set(),
): SpotifyTrack[] {
  const picked: SpotifyTrack[] = [];
  const artistCounts = new Map<string, number>();
  const ranked = candidates
    .filter((candidate) => !blockedIds.has(candidate.track.id))
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreCandidateTrack(candidate, ctx),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  for (const item of ranked) {
    if (picked.length >= target) break;
    const artistNorm = normalizeForCompare(item.candidate.track.artists[0]?.name ?? "");
    const count = artistCounts.get(artistNorm) ?? 0;
    if (count >= 2) continue;
    picked.push(item.candidate.track);
    blockedIds.add(item.candidate.track.id);
    artistCounts.set(artistNorm, count + 1);
  }

  if (picked.length < target) {
    for (const item of ranked) {
      if (picked.length >= target) break;
      if (blockedIds.has(item.candidate.track.id)) continue;
      picked.push(item.candidate.track);
      blockedIds.add(item.candidate.track.id);
    }
  }

  return picked;
}

function sequencePlaylist(tracks: PlaylistTrack[], flow: PlaylistIntent["flow"]): PlaylistTrack[] {
  const anchors = tracks.filter((t) => t.section === "anchor");
  const grooves = tracks.filter((t) => t.section === "groove");
  const discoveries = tracks.filter((t) => t.section === "discovery");
  const ordered: PlaylistTrack[] = [];

  if (flow === "peak") {
    ordered.push(...anchors.slice(0, 1));
    ordered.push(...discoveries.slice(0, 1));
    ordered.push(...grooves);
    ordered.push(...anchors.slice(1));
    ordered.push(...discoveries.slice(1));
  } else if (flow === "cooldown") {
    ordered.push(...anchors);
    ordered.push(...grooves);
    ordered.push(...discoveries);
  } else {
    ordered.push(...anchors.slice(0, 2));
    let discoveryIndex = 0;
    grooves.forEach((track, index) => {
      ordered.push(track);
      if ((index + 1) % 4 === 0 && discoveryIndex < discoveries.length) {
        ordered.push(discoveries[discoveryIndex]);
        discoveryIndex++;
      }
    });
    ordered.push(...anchors.slice(2));
    ordered.push(...discoveries.slice(discoveryIndex));
  }

  for (let i = 1; i < ordered.length; i++) {
    if (normalizeForCompare(ordered[i].artistName) !== normalizeForCompare(ordered[i - 1].artistName)) continue;
    const swapIndex = ordered.findIndex(
      (track, index) =>
        index > i &&
        normalizeForCompare(track.artistName) !== normalizeForCompare(ordered[i - 1].artistName)
    );
    if (swapIndex > i) {
      const current = ordered[i];
      ordered[i] = ordered[swapIndex];
      ordered[swapIndex] = current;
    }
  }

  return ordered;
}

function buildFreshSearchQueries(
  requestStr: string,
  allGenres: string[],
  intent: PlaylistIntent,
  intensity: "low" | "mid" | "high",
): string[] {
  const requestTokens = tokensFromText(requestStr);
  const genreQueries = allGenres
    .slice(0, 5)
    .map((g) => g.replace(/-/g, " ").split(/\s+/).slice(0, 3).join(" ").trim());
  const queries = [
    intent.keywords.slice(0, 3).join(" "),
    requestTokens.slice(0, 2).join(" "),
    requestTokens[0] ?? "",
    ...genreQueries,
  ];

  if (requestTokens.includes("house") || intent.genres.some((g) => g.includes("house"))) {
    queries.push(
      intensity === "low" ? "deep house" : "house",
      intensity === "high" ? "workout house" : "deep house",
      "tech house",
      "dance house"
    );
  }

  if (requestTokens.includes("workout") || intent.activity === "workout") {
    queries.push("workout dance", "gym house", "dance");
  }

  queries.push("dance", "indie dance", "electronic", "alternative");

  return queries.filter((q, i, arr) => q.length > 0 && arr.indexOf(q) === i);
}

async function buildFastSearchPlaylist({
  spotify,
  requestStr,
  allGenres,
  intent,
  intensity,
  targetCount,
  recentSet,
  knownArtistNorms,
  avoidKnownArtists,
  blockedTrackIds,
  blockedTrackNorms,
}: {
  spotify: ReturnType<typeof createSpotifyClient>;
  requestStr: string;
  allGenres: string[];
  intent: PlaylistIntent;
  intensity: "low" | "mid" | "high";
  targetCount: number;
  recentSet: Set<string>;
  knownArtistNorms: Set<string>;
  avoidKnownArtists: boolean;
  blockedTrackIds?: Set<string>;
  blockedTrackNorms?: Set<string>;
}): Promise<PlaylistTrack[]> {
  const genericStop = new Set(["break", "spotify", "loop", "reset", "refresh", "discover", "music", "playlist"]);
  const cleanQuery = (query: string) =>
    normalizeToken(query)
      .split(/\s+/)
      .filter((token) => token.length > 2 && !genericStop.has(token))
      .join(" ");
  const primaryQueries = buildFreshSearchQueries(requestStr, allGenres, intent, intensity)
    .map(cleanQuery)
    .filter(Boolean);
  const queries = uniqueStrings(
    [
      intent.keywords.slice(0, 3).map(cleanQuery).filter(Boolean).join(" "),
      ...intent.genres,
      ...primaryQueries,
      ...allGenres.slice(0, 5),
      intensity === "high" ? "workout dance" : "",
      intensity === "low" ? "chill electronic" : "",
      "fresh finds",
      "new music friday",
      "indie pop",
      "electronic",
      "alternative",
    ],
    10,
  );
  const searchResults = await withTimeout(
    Promise.allSettled(
      queries.map((query) =>
        searchTracksForGeneration(spotify, query, 30).then((result) => ({ query, result }))
      )
    ),
    9_000,
    [],
  );

  const picked: PlaylistTrack[] = [];
  const seenIds = new Set<string>();
  const artistCounts = new Map<string, number>();
  const addTrack = (track: SpotifyTrack, query: string, relaxKnownArtists: boolean) => {
    if (picked.length >= targetCount || seenIds.has(track.id)) return;
    const artistName = track.artists[0]?.name ?? "";
    const artistNorm = normalizeForCompare(artistName);
    if (!artistNorm) return;
    if (recentSet.has(`${track.name}|||${artistName}`)) return;
    if (blockedTrackIds?.has(track.id)) return;
    if (blockedTrackNorms?.has(trackIdentity(track.name, artistName))) return;
    if (avoidKnownArtists && !relaxKnownArtists && knownArtistNorms.has(artistNorm)) return;
    if ((artistCounts.get(artistNorm) ?? 0) >= 2) return;

    const section =
      picked.length < Math.max(1, Math.round(targetCount * 0.2))
        ? "anchor"
        : picked.length < Math.max(2, Math.round(targetCount * 0.65))
        ? "groove"
        : "discovery";

    seenIds.add(track.id);
    artistCounts.set(artistNorm, (artistCounts.get(artistNorm) ?? 0) + 1);
    picked.push(
      section === "discovery"
        ? resolveSpotifyDiscoveryTrack(track, `Fresh find from "${query}"`)
        : resolveSpotifyTrack(
            track,
            section,
            section === "anchor" ? `Starter anchor from "${query}"` : `Keeps the vibe moving from "${query}"`,
          )
    );
  };

  const rows = searchResults
    .filter((item): item is PromiseFulfilledResult<{ query: string; result: SpotifySearchResult }> => item.status === "fulfilled")
    .flatMap(({ value }) => (value.result.tracks?.items ?? []).map((track) => ({ track, query: value.query })));

  for (const { track, query } of rows) addTrack(track, query, false);
  if (picked.length < Math.ceil(targetCount * 0.5)) {
    for (const { track, query } of rows) addTrack(track, query, true);
  }

  return picked.slice(0, targetCount);
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

function resolveSpotifyDiscoveryTrack(t: SpotifyTrack, reason: string): PlaylistTrack {
  return {
    trackName:      t.name,
    artistName:     t.artists[0]?.name ?? "Unknown",
    section:        "discovery",
    reason,
    spotifyTrackId: t.id,
    spotifyUri:     t.uri,
    albumImageUrl:  t.album.images[0]?.url ?? null,
  };
}

function playlistTrackToSpotifyTrack(track: PlaylistTrack): SpotifyTrack {
  return {
    id: track.spotifyTrackId ?? "",
    name: track.trackName,
    uri: track.spotifyUri ?? (track.spotifyTrackId ? `spotify:track:${track.spotifyTrackId}` : ""),
    artists: [
      {
        id: "",
        name: track.artistName,
      },
    ],
    album: {
      id: "",
      name: "",
      images: track.albumImageUrl
        ? [{ url: track.albumImageUrl, width: 640, height: 640 }]
        : [],
    },
    duration_ms: 0,
    popularity: 50,
    preview_url: null,
  };
}

/**
 * Resolves AI-suggested (track, artist) pairs to real Spotify tracks using
 * spotify.findTrack() — which has 3 strategies + fuzzy artist matching.
 *
 * Why this replaces the old "suggest artist → getArtistTopTracks" approach:
 *  - findTrack hits ~85%+ of real track names vs ~50% for artist resolution
 *  - AI picks tracks that ACTUALLY fit the mood, not just an artist's #1 hit
 *  - All resolutions run in parallel → no sequential bottleneck
 */
async function resolveDiscoveryTracks(
  suggestions: { track: string; artist: string; reason: string }[],
  recentSet: Set<string>,
  knownArtistNorms: Set<string>,
  spotify: ReturnType<typeof createSpotifyClient>,
): Promise<PlaylistTrack[]> {
  const results = await Promise.allSettled(
    suggestions.map(async ({ track, artist, reason }) => {
      const found = await spotify.findTrack(track, artist);
      if (!found) return null;

      // Skip if by a known artist (fresh mode wants new discoveries only)
      const artistNorm = (found.artists[0]?.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (knownArtistNorms.size > 0 && knownArtistNorms.has(artistNorm)) return null;

      // Skip if recently played
      const recentKey = `${found.name}|||${found.artists[0]?.name ?? ""}`;
      if (recentSet.has(recentKey)) return null;

      return {
        trackName:      found.name,
        artistName:     found.artists[0]?.name ?? artist,
        section:        "discovery" as const,
        reason,
        spotifyTrackId: found.id,
        spotifyUri:     found.uri,
        albumImageUrl:  found.album.images[0]?.url ?? null,
      } satisfies PlaylistTrack;
    })
  );

  const tracks: PlaylistTrack[] = [];
  const seenIds = new Set<string>();
  for (const r of results) {
    if (r.status === "fulfilled" && r.value !== null) {
      const id = r.value.spotifyTrackId ?? "";
      if (!seenIds.has(id)) {
        seenIds.add(id);
        tracks.push(r.value);
      }
    }
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
  const generationGoal: GenerationGoal = body.goal === "break_loop" ? "break_loop" : "build_vibe";
  const breakLoopMode: BreakLoopMode =
    body.breakLoopMode === "new_lane" ||
    body.breakLoopMode === "energy_shift" ||
    body.breakLoopMode === "surprise"
      ? body.breakLoopMode
      : "near_taste";
  const breakLoopTarget: string = typeof body.breakLoopTarget === "string"
    ? body.breakLoopTarget.trim().slice(0, 80)
    : "";
  const vocals:      "any" | "lyrics" | "instrumental" = body.vocals  ?? "any";
  const language:    "any" | "english" | "match"   = body.language    ?? "any";
  const genreLock:   string | null = body.genreLock  ?? null;
  const artistLock:  string | null = body.artistLock ?? null;

  if (!userPrompt.trim() && familiarity !== "fresh" && generationGoal !== "break_loop") {
    return NextResponse.json({ error: "Provide a description or pick a mood" }, { status: 400 });
  }

  const counts  = trackCount(sessionMinutes);
  // Create the client once; individual branches decide whether to call Spotify.
  const spotify = createSpotifyClient(user.id);
  const cacheKey = buildCacheKey(user.id, {
    prompt: userPrompt,
    sessionMinutes,
    familiarity,
    intensity,
    goal: generationGoal,
    breakLoopMode,
    breakLoopTarget,
    vocals,
    language,
    genreLock,
    artistLock,
  });
  const cached = getCachedPlaylist(cacheKey);
  if (cached) {
    return NextResponse.json({
      intro: cached.intro,
      tracks: cached.tracks,
      playlistId: null,
      cached: true,
    });
  }

  try {
    // ── Fetch taste data from Supabase cache, not live Spotify ───────────────
    //
    // Generation must be fast and predictable on Vercel. The dashboard/sync
    // pipeline owns the expensive Spotify profile reads; playlist generation
    // consumes those cached rows and only uses Spotify later for focused search.
    const admin = createAdminClient();
    const cachedTastePromise = Promise.all([
      admin
        .from("user_top_tracks")
        .select("spotify_track_id, track_name, artist_names, artist_ids, album_name, album_image_url, duration_ms, preview_url, popularity, rank")
        .eq("user_id", user.id)
        .eq("time_range", "short_term")
        .order("rank")
        .limit(50)
        .then(({ data }) => (data ?? []) as CachedTopTrackRow[]),
      admin
        .from("user_top_tracks")
        .select("spotify_track_id, track_name, artist_names, artist_ids, album_name, album_image_url, duration_ms, preview_url, popularity, rank")
        .eq("user_id", user.id)
        .eq("time_range", "long_term")
        .order("rank")
        .limit(50)
        .then(({ data }) => (data ?? []) as CachedTopTrackRow[]),
      admin
        .from("user_top_artists")
        .select("spotify_artist_id, artist_name, genres, image_url, popularity, follower_count, rank")
        .eq("user_id", user.id)
        .eq("time_range", "short_term")
        .order("rank")
        .limit(25)
        .then(({ data }) => (data ?? []) as CachedTopArtistRow[]),
      admin
        .from("user_listening_history")
        .select("spotify_track_id, track_name, artist_names, album_name, album_image_url, played_at")
        .eq("user_id", user.id)
        .order("played_at", { ascending: false })
        .limit(80)
        .then(({ data }) => (data ?? []) as CachedHistoryRow[]),
    ]);
    const [shortTrackRows, longTrackRows, shortArtistRows, recentlyPlayedRows] = await withTimeout(
      cachedTastePromise,
      2_500,
      [
        [] as CachedTopTrackRow[],
        [] as CachedTopTrackRow[],
        [] as CachedTopArtistRow[],
        [] as CachedHistoryRow[],
      ],
    );
    const shortTracksData = { items: shortTrackRows.map(cachedTrackToSpotifyTrack) };
    const longTracksData = { items: longTrackRows.map(cachedTrackToSpotifyTrack) };
    const cachedArtists = shortArtistRows.map(cachedArtistToSpotifyArtist);
    const shortArtistsData = {
      items: [
        ...cachedArtists,
        ...deriveArtistsFromTopTracks([...shortTrackRows, ...longTrackRows], cachedArtists),
      ].slice(0, 25),
    };
    const recentlyPlayedData = {
      items: recentlyPlayedRows.map((row) => ({
        track: cachedTrackToSpotifyTrack(row),
        played_at: row.played_at,
        context: null,
      })),
    };

    // ── Build recent set + play counts from recently-played ───────────────────
    const playCounts7d: Record<string, number> = {};
    const recentArtistCounts = new Map<string, { name: string; count: number }>();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const p of recentlyPlayedData.items ?? []) {
      // Spotify only returns ~50 recent plays — filter to the last 7 days
      if (new Date(p.played_at).getTime() < sevenDaysAgo) continue;
      const artistName = p.track.artists[0]?.name ?? "";
      const key = `${p.track.name}|||${artistName}`;
      playCounts7d[key] = (playCounts7d[key] ?? 0) + 1;
      const artistNorm = normalizeForCompare(artistName);
      if (artistNorm) {
        const current = recentArtistCounts.get(artistNorm) ?? { name: artistName, count: 0 };
        current.count++;
        recentArtistCounts.set(artistNorm, current);
      }
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

    const requestStr = userPrompt.trim()
      || (generationGoal === "break_loop" ? "Break my Spotify loop" : "Discover great music matching my taste");
    const hasData    = shortCandidates.length > 0 || longCandidates.length > 0;
    const fallbackIntent = buildFallbackIntent(requestStr, familiarity, intensity, genreLock, artistLock);
    const knownArtistNorms = new Set(
      topArtists.toLowerCase().split(", ").filter(Boolean).map((s) => normalizeForCompare(s.trim()))
    );

    // ── Fast-path on Vercel Hobby: Escape Pool only ──────────────────────────
    //
    // On free Vercel, long-running Spotify/OpenAI work frequently hits
    // FUNCTION_INVOCATION_TIMEOUT (504). The Escape Pool is refreshed during
    // /api/spotify/sync and gives us a high-quality cached candidate set.
    //
    // We use it for:
    // - build_vibe (familiar/mixed): accurate, taste-aligned, avoids recent repeats
    // - fresh: discovery-first (strongly filters known artists)
    //
    // break_loop already prefers Escape Pool, but may still do top-ups; keep that
    // logic below for now.
    const blockedTrackIds = new Set<string>();
    const blockedTrackNorms = new Set<string>();
    for (const item of recentlyPlayedRows ?? []) {
      const id = (item.spotify_track_id as string | null) ?? "";
      if (id) blockedTrackIds.add(id);
      const artistName = ((item.artist_names as string[] | null)?.[0]) ?? "";
      const trackName = (item.track_name as string | null) ?? "";
      if (trackName || artistName) blockedTrackNorms.add(trackIdentity(trackName ?? "", artistName ?? ""));
    }

    if (generationGoal !== "break_loop") {
      // Fresh mode should avoid "already know well" artists AND avoid top-track repeats.
      if (familiarity === "fresh") {
        for (const row of [...shortTrackRows, ...longTrackRows]) {
          if (row.spotify_track_id) blockedTrackIds.add(row.spotify_track_id);
          const artistName = (row.artist_names?.[0]) ?? "";
          if (row.track_name || artistName) blockedTrackNorms.add(trackIdentity(row.track_name ?? "", artistName ?? ""));
        }
      }

      const escapeMode = familiarity === "fresh" ? "fresh" : "build_vibe";
      const escapeTracks = await withTimeout(
        selectEscapePoolTracks(user.id, admin, {
          targetCount: counts.total,
          requestText: requestStr,
          mode: escapeMode,
          intensity,
          genreHints: [
            genreLock ?? "",
            artistLock ?? "",
            ...allGenres,
            ...(familiarity === "fresh" ? ["fresh", "new", "underrated", "deep cuts"] : []),
          ],
          blockedTrackIds,
          blockedTrackNorms,
          knownArtistNorms,
        }).catch(() => []),
        1_800,
        [],
      );

      // If the pool is thin (new user or hasn't synced recently), fail fast with a clear message
      // rather than timing out on slow Spotify search/LLM fallbacks.
      const minOk = Math.min(counts.total, familiarity === "fresh" ? 8 : 10);
      if (escapeTracks.length < Math.min(3, minOk)) {
        return NextResponse.json(
          { error: "Not enough cached tracks yet. Tap Sync, then try again in ~15 seconds." },
          { status: 503 },
        );
      }

      const intro =
        familiarity === "fresh"
          ? `Fresh picks for "${requestStr}" — pulled from your Escape Pool while blocking recent and known-artist repeats.`
          : `Built for "${requestStr}" from your Escape Pool — taste-aligned tracks while avoiding your recent repeats.`;
      return buildResponse(
        sequencePlaylist(escapeTracks.slice(0, counts.total), familiarity === "fresh" ? "build" : fallbackIntent.flow),
        intro,
        requestStr,
        user.id,
        cacheKey,
      );
    }

    if (!hasData) {
      // Keep a fast failure on free-tier rather than running slow Spotify search
      // while the taste profile is empty.
      return NextResponse.json(
        { error: "Sync your Spotify first (Dashboard → Sync). Generation uses cached taste data on free tier." },
        { status: 503 },
      );
    }

    // ── BREAK MY LOOP MODE ───────────────────────────────────────────────────
    //
    // Goal: solve the "Spotify keeps feeding me the same stuff" problem without
    // losing the listener's taste. The first version reused top-track pools for
    // anchors/bridges; that can repackage the loop. This mode now builds from
    // Spotify search against the user's taste DNA while hard-blocking recent
    // history plus short-term and long-term top tracks.
    if (generationGoal === "break_loop") {
      const spotify = createSpotifyClient(user.id);
      const modeConfig = {
        near_taste: {
          label: "Near Taste",
          comfortPct: 0.35,
          bridgePct: 0.25,
          strictBlocksKnownArtists: false,
          aiDirection: "Stay close to their taste and genres, but use different tracks and mostly adjacent artists.",
          queryBoosts: ["deep cuts", "underrated", "radio", "mix"],
        },
        new_lane: {
          label: "New Lane",
          comfortPct: 0.2,
          bridgePct: 0.25,
          strictBlocksKnownArtists: true,
          aiDirection: "Move one genre lane away from their current taste while keeping the same emotional feel.",
          queryBoosts: ["adjacent genre", "new wave", "underground", "crossover"],
        },
        energy_shift: {
          label: "Energy Switch",
          comfortPct: 0.2,
          bridgePct: 0.2,
          strictBlocksKnownArtists: false,
          aiDirection: intensity === "low"
            ? "Switch the energy downward: calmer, smoother, less intense than their usual loop."
            : intensity === "high"
            ? "Switch the energy upward: more driving, physical, and energetic than their usual loop."
            : "Shift the energy away from the user's loop while keeping it playable.",
          queryBoosts: intensity === "low"
            ? ["chill", "downtempo", "late night", "soft"]
            : ["upbeat", "dance", "driving", "workout"],
        },
        surprise: {
          label: "Surprise",
          comfortPct: 0.1,
          bridgePct: 0.15,
          strictBlocksKnownArtists: true,
          aiDirection: "Take a bigger but still tasteful jump. Prioritize novelty and discovery over familiarity.",
          queryBoosts: ["fresh finds", "left field", "global", "indie"],
        },
      }[breakLoopMode];
      const targetDirection = breakLoopTarget
        ? `User target direction: ${breakLoopTarget}. Treat this as the strongest direction signal.`
        : "";
      const comfortTarget   = Math.max(1, Math.round(counts.total * modeConfig.comfortPct));
      const forgottenTarget = Math.max(1, Math.round(counts.total * modeConfig.bridgePct));
      const modeRequestStr = [
        requestStr,
        modeConfig.label,
        targetDirection,
      ].filter(Boolean).join(" — ");
      const breakIntent = buildFallbackIntent(
        modeRequestStr,
        "mixed",
        intensity,
        genreLock ?? breakLoopTarget,
        artistLock,
      );
      const breakArtistGenreMap = new Map<string, string[]>();
      for (const artist of shortArtists) {
        breakArtistGenreMap.set(normalizeForCompare(artist.name), artist.genres ?? []);
      }

      const blockedTrackIds = new Set<string>();
      const blockedTrackNorms = new Set<string>();
      const blockedTrackLabels: string[] = [];
      const blockTrack = (trackName: string, artistName: string, id?: string | null) => {
        if (id) blockedTrackIds.add(id);
        if (trackName && artistName && blockedTrackLabels.length < 40) {
          const label = `"${trackName}" by ${artistName}`;
          if (!blockedTrackLabels.includes(label)) blockedTrackLabels.push(label);
        }
        if (trackName || artistName) blockedTrackNorms.add(trackIdentity(trackName, artistName));
      };

      for (const key of recentSet) {
        const [trackName, artistName] = key.split("|||");
        blockTrack(trackName ?? "", artistName ?? "");
      }
      for (const track of [...(shortTracksData.items ?? []), ...(longTracksData.items ?? [])]) {
        blockTrack(track.name, track.artists[0]?.name ?? "", track.id);
      }

      const loopHistory = await withTimeout(
        (async () => {
          const historySince = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
          const { data } = await createAdminClient()
            .from("user_listening_history")
            .select("spotify_track_id, track_name, artist_names")
            .eq("user_id", user.id)
            .gte("played_at", historySince)
            .limit(300);
          return data ?? [];
        })().catch(() => []),
        2_500,
        [],
      );

      for (const item of loopHistory) {
        blockTrack(
          (item.track_name as string | null) ?? "",
          ((item.artist_names as string[] | null)?.[0]) ?? "",
          (item.spotify_track_id as string | null) ?? null,
        );
      }

      const repeatedArtistNorms = new Set(
        [...recentArtistCounts.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 4)
          .filter(([, value]) => value.count >= 3)
          .map(([norm]) => norm)
      );

      const minimumPoolTracks = Math.min(counts.total, sessionMinutes <= 20 ? 6 : 10);
      let escapePoolTracks = await selectEscapePoolTracks(user.id, admin, {
        targetCount: counts.total,
        requestText: `${modeRequestStr} ${breakLoopTarget}`,
        mode: "break_loop",
        breakLoopMode,
        intensity,
        genreHints: [genreLock ?? "", breakLoopTarget, ...allGenres, ...modeConfig.queryBoosts],
        blockedTrackIds,
        blockedTrackNorms,
        repeatedArtistNorms,
        knownArtistNorms,
      });
      let bestBreakTracks: PlaylistTrack[] = escapePoolTracks;

      if (escapePoolTracks.length < minimumPoolTracks) {
        const topUpRequest = [
          breakLoopTarget,
          genreLock,
          breakLoopMode === "near_taste" ? `${topArtists} radio deep cuts` : "",
          breakLoopMode === "new_lane" ? "adjacent genre fresh finds crossover" : "",
          breakLoopMode === "energy_shift" && intensity === "high" ? "upbeat dance workout fresh" : "",
          breakLoopMode === "energy_shift" && intensity === "low" ? "chill downtempo soft fresh" : "",
          breakLoopMode === "surprise" ? "fresh finds global indie alternative left field" : "",
          ...modeConfig.queryBoosts,
          ...allGenres.slice(0, 6),
          requestStr,
        ].filter(Boolean).join(" ");
        const topUpTracks = await withTimeout(
          buildFastSearchPlaylist({
            spotify,
            requestStr: topUpRequest,
            allGenres,
            intent: breakIntent,
            intensity,
            targetCount: counts.total,
            recentSet,
            knownArtistNorms,
            avoidKnownArtists: breakLoopMode === "new_lane" || breakLoopMode === "surprise",
            blockedTrackIds,
            blockedTrackNorms,
          }).catch((err) => {
            console.warn("[break-loop] Escape Pool top-up skipped:", err);
            return [] as PlaylistTrack[];
          }),
          7_000,
          [] as PlaylistTrack[],
        );
        const catalogTopUpTracks = escapePoolTracks.length + topUpTracks.length < minimumPoolTracks
          ? await withTimeout(
              getArtistCatalogTracks(shortArtists.map((artist) => artist.id)).then((tracks) => {
                const out: PlaylistTrack[] = [];
                const seenArtists = new Map<string, number>();
                for (const track of tracks) {
                  if (out.length >= counts.total) break;
                  const artistName = track.artists[0]?.name ?? "";
                  const artistNorm = normalizeForCompare(artistName);
                  if (!artistNorm) continue;
                  if (blockedTrackIds.has(track.id)) continue;
                  if (blockedTrackNorms.has(trackIdentity(track.name, artistName))) continue;
                  if ((seenArtists.get(artistNorm) ?? 0) >= 2) continue;
                  seenArtists.set(artistNorm, (seenArtists.get(artistNorm) ?? 0) + 1);
                  const section =
                    out.length < Math.max(1, Math.round(counts.total * 0.25))
                      ? "anchor"
                      : out.length < Math.max(2, Math.round(counts.total * 0.7))
                      ? "groove"
                      : "discovery";
                  out.push(
                    section === "discovery"
                      ? resolveSpotifyDiscoveryTrack(track, "Catalog escape - a non-repeat from your wider taste map")
                      : resolveSpotifyTrack(
                          track,
                          section,
                          section === "anchor"
                            ? "Catalog anchor - familiar artist, different track"
                            : "Catalog bridge - outside your blocked repeats",
                        )
                  );
                }
                return out;
              }).catch((err) => {
                console.warn("[break-loop] Catalog top-up skipped:", err);
                return [] as PlaylistTrack[];
              }),
              7_000,
              [] as PlaylistTrack[],
            )
          : [];
        const seenTopUpIds = new Set(escapePoolTracks.map((track) => track.spotifyTrackId).filter(Boolean));
        const combinedTracks = [...escapePoolTracks];
        for (const track of [...topUpTracks, ...catalogTopUpTracks]) {
          if (combinedTracks.length >= counts.total) break;
          if (!track.spotifyTrackId || seenTopUpIds.has(track.spotifyTrackId)) continue;
          seenTopUpIds.add(track.spotifyTrackId);
          combinedTracks.push(track);
        }
        bestBreakTracks = combinedTracks.length > bestBreakTracks.length ? combinedTracks : bestBreakTracks;

        console.info("[break-loop] Escape Pool selection", {
          mode: breakLoopMode,
          poolTracks: escapePoolTracks.length,
          topUpTracks: topUpTracks.length,
          catalogTopUpTracks: catalogTopUpTracks.length,
          combinedTracks: combinedTracks.length,
          minimumPoolTracks,
        });

        if (combinedTracks.length >= counts.total) {
          after(async () => {
            await refreshEscapePool(user.id, spotify, admin).catch((err) => {
              console.warn("[break-loop] Background Escape Pool refresh skipped:", err);
            });
          });
          const intro = `Your ${modeConfig.label.toLowerCase()} loop reset used your Escape Pool plus a fresh top-up, with recent plays and top repeats blocked.`;
          return buildResponse(
            sequencePlaylist(combinedTracks.slice(0, counts.total), "build"),
            intro,
            requestStr,
            user.id,
            cacheKey,
          );
        }

        await withTimeout(
          refreshEscapePool(user.id, spotify, admin).catch((err) => {
            console.warn("[break-loop] Escape Pool refresh skipped:", err);
            return { inserted: 0 };
          }),
          3_500,
          { inserted: 0 },
        );
        escapePoolTracks = await selectEscapePoolTracks(user.id, admin, {
          targetCount: counts.total,
          requestText: `${modeRequestStr} ${breakLoopTarget}`,
          mode: "break_loop",
          breakLoopMode,
          intensity,
          genreHints: [genreLock ?? "", breakLoopTarget, ...allGenres, ...modeConfig.queryBoosts],
          blockedTrackIds,
          blockedTrackNorms,
          repeatedArtistNorms,
          knownArtistNorms,
        });
        bestBreakTracks = escapePoolTracks.length > bestBreakTracks.length ? escapePoolTracks : bestBreakTracks;
      }

      if (escapePoolTracks.length >= counts.total) {
        const intro = `Your ${modeConfig.label.toLowerCase()} loop reset came from your Escape Pool: tracks already mapped to your taste, with recent plays and top repeats blocked.`;
        return buildResponse(
          sequencePlaylist(escapePoolTracks.slice(0, counts.total), "build"),
          intro,
          requestStr,
          user.id,
          cacheKey,
        );
      }

      after(async () => {
        await refreshEscapePool(user.id, spotify, admin).catch((err) => {
          console.warn("[break-loop] Background Escape Pool refresh skipped:", err);
        });
      });

      if (bestBreakTracks.length >= counts.total) {
        const intro = `Your ${modeConfig.label.toLowerCase()} loop reset used the best non-repeat matches available while your Escape Pool keeps filling in the background.`;
        return buildResponse(
          sequencePlaylist(bestBreakTracks.slice(0, counts.total), "build"),
          intro,
          requestStr,
          user.id,
          cacheKey,
        );
      }

      const rescueTracks = await withTimeout(
        buildFastSearchPlaylist({
          spotify,
          requestStr: [breakLoopTarget, genreLock, topArtists, ...modeConfig.queryBoosts, requestStr]
            .filter(Boolean)
            .join(" "),
          allGenres,
          intent: breakIntent,
          intensity,
          targetCount: counts.total,
          recentSet,
          knownArtistNorms,
          avoidKnownArtists: false,
          blockedTrackIds,
          blockedTrackNorms,
        }).catch((err) => {
          console.warn("[break-loop] Rescue search skipped:", err);
          return [] as PlaylistTrack[];
        }),
        7_000,
        [] as PlaylistTrack[],
      );

      if (rescueTracks.length >= counts.total) {
        const intro = `Your ${modeConfig.label.toLowerCase()} loop reset used a fresh Spotify search while your Escape Pool keeps filling in the background.`;
        return buildResponse(
          sequencePlaylist(rescueTracks, "build"),
          intro,
          requestStr,
          user.id,
          cacheKey,
        );
      }

      const breakScoreContext: ScoreContext = {
        intent: { ...breakIntent, freshness: "mixed" },
        requestTokens: new Set(tokensFromText(`${modeRequestStr} ${genreStr} refresh discovery ${modeConfig.queryBoosts.join(" ")}`)),
        genreTokens: new Set([
          ...tokensFromText(genreStr),
          ...tokensFromText(breakLoopTarget),
          ...breakIntent.genres.flatMap(tokensFromText),
        ]),
        knownArtistNorms,
        artistGenreMap: breakArtistGenreMap,
        playCounts7d,
      };

      type ResetCandidate = { track: SpotifyTrack; query: string; strict: boolean };
      const resetCandidates: ResetCandidate[] = [];
      const existingIds = new Set<string>();
      const artistPickCounts = new Map<string, number>();
      const maxPicksPerArtist = breakLoopMode === "near_taste" ? 3 : 2;
      const addResetTrack = (track: SpotifyTrack, query: string, strict: boolean) => {
        const artistName = track.artists[0]?.name ?? "";
        const artistNorm = normalizeForCompare(artistName);
        if (!artistNorm) return false;
        if (existingIds.has(track.id) || blockedTrackIds.has(track.id)) return false;
        if (blockedTrackNorms.has(trackIdentity(track.name, artistName))) return false;
        if (strict && repeatedArtistNorms.has(artistNorm)) return false;
        if (strict && modeConfig.strictBlocksKnownArtists && knownArtistNorms.has(artistNorm)) return false;
        if ((artistPickCounts.get(artistNorm) ?? 0) >= maxPicksPerArtist) return false;
        existingIds.add(track.id);
        artistPickCounts.set(artistNorm, (artistPickCounts.get(artistNorm) ?? 0) + 1);
        resetCandidates.push({ track, query, strict });
        return true;
      };

      for (const track of bestBreakTracks.slice(0, counts.total)) {
        addResetTrack(playlistTrackToSpotifyTrack(track), "escape pool seed", false);
      }
      for (const track of rescueTracks.slice(0, counts.total)) {
        addResetTrack(playlistTrackToSpotifyTrack(track), "rescue search seed", false);
      }

      const resetQueryStop = new Set(["break", "spotify", "loop", "reset", "refresh", "playlist", "music", "song", "songs", "track", "tracks"]);
      const cleanResetQuery = (query: string) =>
        normalizeToken(query)
          .split(/\s+/)
          .filter((token) => token.length > 2 && !resetQueryStop.has(token))
          .join(" ");
      const tasteQueries = uniqueStrings(
        [
          genreLock ?? "",
          breakLoopTarget,
          ...breakIntent.genres,
          ...breakIntent.keywords.map(cleanResetQuery),
          ...modeConfig.queryBoosts,
          ...allGenres.slice(0, 8),
          genreStr.split(",")[0] ?? "",
          "indie dance",
          "alternative",
          "electronic",
        ],
        14,
      );
      const breakerQueries = buildFreshSearchQueries(
        `${modeRequestStr} ${tasteQueries.slice(0, 4).join(" ")}`,
        allGenres,
        breakIntent,
        intensity,
      );
      const strictQueries = [...tasteQueries, ...breakerQueries]
        .map((q) => q.trim())
        .filter((q, index, arr) => q.length > 0 && arr.indexOf(q) === index)
        .slice(0, 8);
      const nearTasteArtistQueries = breakLoopMode === "near_taste"
        ? uniqueStrings(
            shortArtists.slice(0, 8).flatMap((artist) => [
              `${artist.name} deep cuts`,
              `${artist.name} radio`,
              `${artist.name} remix`,
              `${artist.name} underrated`,
            ]),
            12,
          )
        : [];
      const aiAskFor = Math.min(14, Math.max(counts.total, 10));
      const resetPrompt = `You are building a Spotify playlist to break a user's repetitive listening loop.

REQUEST: "${requestStr}"
MODE: ${modeConfig.label}
DIRECTION: ${modeConfig.aiDirection}
${targetDirection}${intensityStr}

LISTENER TASTE DNA:
- Core genres: ${genreStr || "varied"}
- Favorite artists to use only as reference, not suggestions: ${topArtists || "none"}
- Hard-block these tracks completely: ${blockedTrackLabels.join("; ") || "none"}${constraintsStr}

Suggest ${aiAskFor} real Spotify tracks that follow the MODE and DIRECTION, fit the user's taste, and stay outside the blocked list.

Return ONLY valid JSON:
{
  "tracks": [
    { "track": "Exact Spotify track title", "artist": "Exact Spotify artist name", "reason": "short reason" }
  ]
}`;

      const aiResetPromise = withTimeout(
        (async () => {
          const aiReset = await getOpenAI().chat.completions.create({
            model: FAST_MODEL,
            max_tokens: 900,
            messages: [
              { role: "system", content: MUSIC_EXPERT_SYSTEM },
              { role: "user", content: resetPrompt },
            ],
          });
          const text = aiReset.choices[0].message.content ?? "";
          const match = text.match(/\{[\s\S]*\}/)?.[0];
          const suggestions = match
            ? (JSON.parse(match) as { tracks?: { track: string; artist: string; reason?: string }[] }).tracks ?? []
            : [];
          const resolved = await Promise.allSettled(
            suggestions.slice(0, 8).map((suggestion) => spotify.findTrack(suggestion.track, suggestion.artist))
          );
          return resolved
            .filter((result): result is PromiseFulfilledResult<SpotifyTrack | null> => result.status === "fulfilled")
            .map((result) => result.value)
            .filter((track): track is SpotifyTrack => track !== null);
        })().catch((err) => {
          console.warn("[break-loop] AI reset fallback failed:", err);
          return [] as SpotifyTrack[];
        }),
        4_000,
        [] as SpotifyTrack[],
      );

      const searchBatch = async (queries: string[], limit: number) => {
        const results = await withTimeout(
          Promise.allSettled(
            queries.map((query) =>
              searchTracksForGeneration(spotify, query, limit).then((result) => ({ query, result }))
            )
          ),
          4_500,
          [],
        );

        return results
          .filter((item): item is PromiseFulfilledResult<{ query: string; result: SpotifySearchResult }> => item.status === "fulfilled")
          .flatMap(({ value }) => (value.result.tracks?.items ?? []).map((track) => ({ track, query: value.query })));
      };

      const strictResults = await searchBatch(strictQueries, 25);
      for (const { track, query } of strictResults) {
        if (resetCandidates.length >= counts.total) break;
        addResetTrack(track, query, true);
      }

      if (resetCandidates.length < Math.min(counts.total, 10)) {
        const aiTracks = await aiResetPromise;
        for (const track of aiTracks) {
          if (resetCandidates.length >= counts.total) break;
          if (!addResetTrack(track, "curated reset", true)) {
            addResetTrack(track, "curated reset", false);
          }
        }
      }

      // Relax artist familiarity only after the hard track blockers have done
      // their job. This keeps niche tastes from returning too few songs while
      // still refusing recent/top-track repeats.
      if (resetCandidates.length < Math.ceil(counts.total * 0.75)) {
        const relaxedResults = await searchBatch(strictQueries.slice(0, 4), 20);
        for (const { track, query } of relaxedResults) {
          if (resetCandidates.length >= counts.total) break;
          addResetTrack(track, query, false);
        }
      }

      if (resetCandidates.length < counts.total && nearTasteArtistQueries.length > 0) {
        const nearTasteResults = await searchBatch(nearTasteArtistQueries, 35);
        for (const { track, query } of nearTasteResults) {
          if (resetCandidates.length >= counts.total) break;
          addResetTrack(track, query, false);
        }
      }

      if (resetCandidates.length < Math.min(counts.total, 12)) {
        const catalogTracks = await withTimeout(
          getArtistCatalogTracks(shortArtists.map((artist) => artist.id)).catch((err) => {
            console.warn("[break-loop] Artist catalog fallback failed:", err);
            return [] as SpotifyTrack[];
          }),
          5_500,
          [] as SpotifyTrack[],
        );
        for (const track of catalogTracks) {
          if (resetCandidates.length >= counts.total) break;
          addResetTrack(track, "deep catalog from your taste", false);
        }
      }

      if (resetCandidates.length === 0) {
        const broadResults = await searchBatch(["fresh finds", "indie pop", "dance hits", "electronic hits"], 25);
        for (const { track, query } of broadResults) {
          if (resetCandidates.length >= counts.total) break;
          addResetTrack(track, query, false);
        }
      }

      if (resetCandidates.length === 0) {
        const fallbackTracks = await buildFastSearchPlaylist({
          spotify,
          requestStr: [
            breakLoopTarget,
            genreLock,
            allGenres[0],
            intensity === "high" ? "upbeat fresh finds" : "",
            intensity === "low" ? "chill fresh finds" : "",
            "fresh finds",
            requestStr,
          ].filter(Boolean).join(" "),
          allGenres,
          intent: breakIntent,
          intensity,
          targetCount: counts.total,
          recentSet,
          knownArtistNorms,
          avoidKnownArtists: false,
          blockedTrackIds,
          blockedTrackNorms,
        });

        if (fallbackTracks.length > 0) {
          const intro = `Your ${modeConfig.label.toLowerCase()} loop reset uses a wider fallback lane because Spotify did not return enough strict reset candidates. It still blocks your recent plays and top repeats while giving you fresh tracks to move with.`;
          return buildResponse(
            sequencePlaylist(fallbackTracks, "build"),
            intro,
            requestStr,
            user.id,
            cacheKey,
          );
        }
      }

      const rankedResetRows = resetCandidates
        .map((item, index) => ({
          ...item,
          index,
          score: scoreCandidateTrack({ track: item.track, era: "classic" }, breakScoreContext)
            + (item.strict ? 10 : 0)
            - Math.max(0, (item.track.popularity ?? 50) - 85),
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, counts.total);

      const comfortTracks = rankedResetRows.slice(0, comfortTarget).map(({ track, query }) => ({
        ...resolveSpotifyTrack(track, "anchor", "Comfort anchor — shares your taste DNA without replaying your recent loop"),
        reason: `Comfort anchor — adjacent to "${query}", not a recent/top repeat`,
      }));
      const forgottenTracks = rankedResetRows.slice(comfortTarget, comfortTarget + forgottenTarget).map(({ track, query }) => ({
        ...resolveSpotifyTrack(track, "groove", "Taste bridge — familiar genre lane, fresh track choice"),
        reason: `Taste bridge — close to your ${query} lane, but outside your blocked repeats`,
      }));
      const breakerTracks = rankedResetRows.slice(comfortTarget + forgottenTarget).map(({ track, query }) => ({
        ...resolveSpotifyDiscoveryTrack(track, `Loop breaker — fresh edge from "${query}"`),
      }));
      const allTracks = sequencePlaylist(
        [...comfortTracks, ...forgottenTracks, ...breakerTracks].slice(0, counts.total),
        "build",
      );
      let finalTracks = allTracks;

      if (finalTracks.length < counts.total) {
        const broadResetTracks = await withTimeout(
          buildFastSearchPlaylist({
            spotify,
            requestStr: [
              breakLoopTarget,
              genreLock,
              allGenres[0] ?? "",
              ...modeConfig.queryBoosts,
              requestStr,
            ].filter(Boolean).join(" "),
            allGenres,
            intent: breakIntent,
            intensity,
            targetCount: counts.total - finalTracks.length,
            recentSet,
            knownArtistNorms: new Set(),
            avoidKnownArtists: false,
            blockedTrackIds,
            blockedTrackNorms,
          }).catch((err) => {
            console.warn("[break-loop] Broad fallback search skipped:", err);
            return [] as PlaylistTrack[];
          }),
          6_000,
          [] as PlaylistTrack[],
        );

        const seenIds = new Set(finalTracks.map((track) => track.spotifyTrackId).filter(Boolean));
        const filledTracks = [...finalTracks];
        for (const track of broadResetTracks) {
          if (filledTracks.length >= counts.total) break;
          if (!track.spotifyTrackId || seenIds.has(track.spotifyTrackId)) continue;
          seenIds.add(track.spotifyTrackId);
          filledTracks.push(track);
        }
        finalTracks = sequencePlaylist(filledTracks.slice(0, counts.total), "build");
      }

      if (finalTracks.length < counts.total) {
        const broadQueries = uniqueStrings(
          [
            breakLoopTarget,
            genreLock ?? "",
            allGenres[0] ?? "",
            ...modeConfig.queryBoosts,
            "fresh finds",
            "indie dance",
            "electronic",
            "alternative",
            "dance hits",
            "afro house",
            "house",
          ].filter(Boolean),
          8,
        );
        const broadSearchResults = await withTimeout(
          Promise.allSettled(
            broadQueries.map((query) =>
              searchTracksForGeneration(spotify, query, 25).then((result) => ({ query, result }))
            )
          ),
          7_000,
          [],
        );

        const seenIds = new Set(finalTracks.map((track) => track.spotifyTrackId).filter(Boolean));
        const artistCounts = new Map<string, number>();
        for (const track of finalTracks) {
          const artistNorm = normalizeForCompare(track.artistName);
          artistCounts.set(artistNorm, (artistCounts.get(artistNorm) ?? 0) + 1);
        }

        for (const item of broadSearchResults) {
          if (item.status !== "fulfilled") continue;
          for (const track of item.value.result.tracks?.items ?? []) {
            if (finalTracks.length >= counts.total) break;
            const artistName = track.artists[0]?.name ?? "";
            const artistNorm = normalizeForCompare(artistName);
            if (!artistNorm) continue;
            if (blockedTrackIds.has(track.id)) continue;
            if (blockedTrackNorms.has(trackIdentity(track.name, artistName))) continue;
            if ((artistCounts.get(artistNorm) ?? 0) >= (breakLoopMode === "near_taste" ? 3 : 2)) continue;
            if (seenIds.has(track.id)) continue;
            seenIds.add(track.id);
            artistCounts.set(artistNorm, (artistCounts.get(artistNorm) ?? 0) + 1);
            const section =
              finalTracks.length < Math.max(1, Math.round(counts.total * 0.25))
                ? "anchor"
                : finalTracks.length < Math.max(2, Math.round(counts.total * 0.7))
                ? "groove"
                : "discovery";
            finalTracks.push(
              section === "discovery"
                ? resolveSpotifyDiscoveryTrack(track, `Broad search fallback — "${item.value.query}"`)
                : resolveSpotifyTrack(
                    track,
                    section,
                    section === "anchor"
                      ? `Broad search anchor — "${item.value.query}"`
                      : `Broad search bridge — "${item.value.query}"`,
                  )
            );
          }
        }
        finalTracks = sequencePlaylist(finalTracks.slice(0, counts.total), "build");
      }

      if (finalTracks.length === 0) {
        return NextResponse.json(
          {
            error:
              "Spotify could not find enough non-repeat tracks for this reset. Try adding a direction like afro house, indie dance, or chill R&B.",
          },
          { status: 502 },
        );
      }

      const dominantArtist = [...recentArtistCounts.values()].sort((a, b) => b.count - a.count)[0]?.name ?? null;
      const intro = dominantArtist
        ? `Your ${modeConfig.label.toLowerCase()} loop reset steps away from ${dominantArtist}${breakLoopTarget ? ` toward ${breakLoopTarget}` : ""}: safe anchors, bridges, and fresh breakers.`
        : `Your ${modeConfig.label.toLowerCase()} loop reset${breakLoopTarget ? ` toward ${breakLoopTarget}` : ""} mixes safe anchors, bridges, and fresh tracks outside your repeats.`;

      return buildResponse(finalTracks, intro, requestStr, user.id, cacheKey);
    }

    // ── FRESH / DISCOVERY MODE ────────────────────────────────────────────────
    //
    // Design: AI suggests specific (track, artist) pairs → parallel findTrack()
    //
    // Old approach: AI suggested artist names → searchArtist → getArtistTopTracks
    //   • Fragile: obscure/hallucinated artists don't resolve → 0 tracks
    //   • Quality issue: an artist's "top track" has nothing to do with the mood
    //
    // New approach: ask AI for exact (track, artist) pairs → findTrack with 3
    //   fallback strategies + fuzzy matching → ~85%+ success rate per suggestion
    //   → tracks genuinely fit the requested vibe, not just an artist's biggest hit
    if (familiarity === "fresh" || !hasData) {
      if (familiarity === "fresh") {
        const intent = await parsePlaylistIntent(
          requestStr,
          familiarity,
          intensity,
          constraintsStr,
          genreLock,
          artistLock,
        );
        const tracks = await buildFastSearchPlaylist({
          spotify,
          requestStr: `${requestStr} ${genreLock ?? ""} ${allGenres.slice(0, 4).join(" ")}`,
          allGenres,
          intent,
          intensity,
          targetCount: counts.total,
          recentSet,
          knownArtistNorms,
          avoidKnownArtists: true,
        });

        if (tracks.length === 0) {
          return NextResponse.json(
            { error: "Spotify did not return fresh tracks for this request. Try adding a clearer genre or mood." },
            { status: 422 },
          );
        }

        const sequenced = sequencePlaylist(tracks, intent.flow ?? fallbackIntent.flow);
        return buildResponse(
          sequenced,
          `Fresh picks for "${requestStr}" using your cached taste as direction while avoiding recent plays.`,
          userPrompt,
          user.id,
          cacheKey,
        );
      }

      const targetCount = counts.discovery;
      // Ask for a capped buffer so free-tier Vercel/OpenAI usage stays predictable.
      // Spotify search fallbacks can still fill longer playlists if needed.
      const askFor = Math.min(Math.ceil(targetCount * 1.5), 16);
      const intent = await parsePlaylistIntent(
        requestStr,
        familiarity,
        intensity,
        constraintsStr,
        genreLock,
        artistLock,
      );

      const recentTracksList = [...recentSet].slice(0, 15)
        .map((k) => {
          const [t, a] = k.split("|||");
          return `"${t}" by ${a}`;
        })
        .join("; ");

      // Known artist norms for post-resolution filtering
      const freshKnownNorms = new Set(
        topArtists.toLowerCase().split(", ").filter(Boolean).map((s) => s.trim().replace(/[^a-z0-9]/g, ""))
      );

      const freshPrompt = `You are an expert music curator building a discovery playlist.

REQUEST: "${requestStr}"${intensityStr}

LISTENER TASTE DNA:
- Core genres: ${genreStr || "varied"}
- Artists they already know well — DO NOT suggest ANY of these artists: ${topArtists || "none"}
- Recently played — skip these exact tracks: ${recentTracksList || "none"}
${nativeLanguages.length > 0 ? `- Also loves: ${nativeLanguages.join(", ")} music — include some if it fits the request` : ""}${constraintsStr}

Your mission: Find ${askFor} SPECIFIC TRACKS that:
1. Perfectly match the REQUEST above in mood, energy, and vibe
2. Come from artists the listener has NEVER heard (not in the "already know well" list)
3. Are real tracks available on Spotify RIGHT NOW
4. Would make them say "how did I not know this artist?!"

Think: critically acclaimed but underrated gems, cult classics, artists one degree away from what they love.

CRITICAL: Use the EXACT track title and artist name exactly as they appear on Spotify.

Return ONLY valid JSON (no markdown, no extra text):
{
  "intro": "2 vibrant sentences hyping these picks — tie them to the listener's taste AND the mood request",
  "tracks": [
    { "track": "Exact Spotify track title", "artist": "Exact Spotify artist name", "reason": "One sentence: why this track fits the request perfectly" }
  ]
}`;

      const freshAI = await getOpenAI().chat.completions.create({
        model: FAST_MODEL,
        max_tokens: 1000,
        messages: [
          { role: "system", content: MUSIC_EXPERT_SYSTEM },
          { role: "user",   content: freshPrompt },
        ],
      });

      const freshText  = freshAI.choices[0].message.content ?? "";
      const freshMatch = freshText.match(/\{[\s\S]*\}/)?.[0];
      if (!freshMatch) throw new Error("AI returned invalid JSON for fresh discovery");

      const freshResult = JSON.parse(freshMatch) as {
        intro: string;
        tracks: { track: string; artist: string; reason: string }[];
      };

      const aiTracks = freshResult.tracks ?? [];
      console.log(`[fresh-discovery] AI suggested ${aiTracks.length} tracks — resolving via findTrack...`);

      // Resolve all suggestions in parallel using findTrack (3 strategies + fuzzy matching)
      const tracks = await resolveDiscoveryTracks(aiTracks, recentSet, freshKnownNorms, spotify);

      console.log(`[fresh-discovery] findTrack resolved: ${tracks.length}/${aiTracks.length}`);

      // ── Multi-tier fallback ───────────────────────────────────────────────────
      // Each tier is independently caught so one failure doesn't block the rest.
      // Spotify search matches track/artist/album NAME — not natural language.
      // Build real keyword queries: user's words > top genre > safe defaults.
      if (tracks.length < targetCount) {
        const existingIds = new Set(tracks.map((t) => t.spotifyTrackId));

        // Tier-1 queries: use normalized music terms, genre hints, and safe
        // electronic/dance fallbacks. Spotify search matches names, not prose.
        const tierQueries = buildFreshSearchQueries(requestStr, allGenres, intent, intensity);
        const fallbackErrors: string[] = [];

        for (const query of tierQueries) {
          if (tracks.length >= targetCount) break;

          console.log(`[fresh-discovery] fallback tier — query: "${query}", need ${targetCount - tracks.length} more`);

          try {
            const sr = await searchTracksForGeneration(spotify, query, 30);
            const items = sr.tracks?.items ?? [];
            console.log(`[fresh-discovery] "${query}" → ${items.length} results`);

            // Pass 1: skip known artists and recently played
            for (const track of items) {
              if (tracks.length >= targetCount) break;
              const artistName = track.artists[0]?.name ?? "";
              const artistNorm = artistName.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (freshKnownNorms.size > 0 && freshKnownNorms.has(artistNorm)) continue;
              if (recentSet.has(`${track.name}|||${artistName}`)) continue;
              if (existingIds.has(track.id)) continue;
              existingIds.add(track.id);
              tracks.push({
                trackName:      track.name,
                artistName,
                section:        "discovery",
                reason:         `Matches "${query}"`,
                spotifyTrackId: track.id,
                spotifyUri:     `spotify:track:${track.id}`,
                albumImageUrl:  track.album.images[0]?.url ?? null,
              });
            }

            // Pass 2: relax known-artist filter (handles niche genres where the
            // user's top artists dominate the search results — Arabic pop, K-pop, etc.)
            if (tracks.length < Math.ceil(targetCount * 0.4)) {
              for (const track of items) {
                if (tracks.length >= targetCount) break;
                const artistName = track.artists[0]?.name ?? "";
                if (recentSet.has(`${track.name}|||${artistName}`)) continue;
                if (existingIds.has(track.id)) continue;
                existingIds.add(track.id);
                tracks.push({
                  trackName:      track.name,
                  artistName,
                  section:        "discovery",
                  reason:         `Fresh find — "${query}"`,
                  spotifyTrackId: track.id,
                  spotifyUri:     `spotify:track:${track.id}`,
                  albumImageUrl:  track.album.images[0]?.url ?? null,
                });
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            fallbackErrors.push(`${query}: ${message}`);
            console.error(`[fresh-discovery] fallback "${query}" error:`, err);
          }
        }

        if (tracks.length === 0 && fallbackErrors.length > 0) {
          return NextResponse.json(
            {
              error: "Spotify search failed while finding fresh tracks. Reconnect Spotify, then try again.",
              debug: {
                aiTracksCount: aiTracks.length,
                topArtists: topArtists || "none",
                genres: genreStr || "none",
                userPrompt: userPrompt || "(empty)",
                fallbackErrors: fallbackErrors.slice(0, 3),
              },
            },
            { status: 502 }
          );
        }
      }

      console.log(`[fresh-discovery] final: ${tracks.length} tracks (target: ${targetCount})`);

      if (tracks.length === 0) {
        return NextResponse.json(
          {
            error: "Couldn't find matching tracks on Spotify for this request. Try rephrasing or picking a different mood.",
            debug: {
              aiTracksCount: aiTracks.length,
              topArtists: topArtists || "none",
              genres: genreStr || "none",
              userPrompt: userPrompt || "(empty)",
            },
          },
          { status: 422 }
        );
      }

      const sequenced = sequencePlaylist(tracks.slice(0, targetCount), intent.flow ?? fallbackIntent.flow);
      return buildResponse(sequenced, freshResult.intro, userPrompt, user.id, cacheKey);
    }

    // ── CURATOR MODE — free-tier hybrid ranking ───────────────────────────────
    //
    // One tiny AI call parses the user's vague vibe into structured intent.
    // Deterministic scoring then ranks verified Spotify tracks locally. This is
    // cheaper, faster, and more debuggable than asking AI to pick every track.

    const anchorTarget    = shortCandidates.length > 0 ? counts.anchor : 0;
    const grooveTarget    = longCandidates.length > 0
      ? Math.min(counts.groove, longCandidates.length) : 0;
    const discoveryTarget = familiarity === "familiar" ? 0 : counts.discovery;

    const intent = await parsePlaylistIntent(
      requestStr,
      familiarity,
      intensity,
      constraintsStr,
      genreLock,
      artistLock,
    );
    const artistGenreMap = new Map<string, string[]>();
    for (const artist of shortArtists) {
      artistGenreMap.set(normalizeForCompare(artist.name), artist.genres ?? []);
    }
    const requestTokens = new Set(tokensFromText(requestStr));
    const genreTokens = new Set([
      ...tokensFromText(genreStr),
      ...intent.genres.flatMap(tokensFromText),
    ]);
    const scoreContext: ScoreContext = {
      intent,
      requestTokens,
      genreTokens,
      knownArtistNorms,
      artistGenreMap,
      playCounts7d,
    };

    const blockedIds = new Set<string>();
    const anchorRows = selectRankedTracks(
      shortCandidates.slice(0, 30).map((track) => ({ track, era: "recent" })),
      anchorTarget,
      scoreContext,
      blockedIds,
    );
    const grooveRows = selectRankedTracks(
      longCandidates.slice(0, 50).map((track) => ({ track, era: "classic" })),
      grooveTarget,
      scoreContext,
      blockedIds,
    );

    // Discovery portion: search Spotify for tracks matching the vibe that
    // aren't from artists the user already knows.
    //
    // IMPORTANT: Spotify search matches track/artist/album names — it does NOT
    // understand natural language. "Discover great music matching my taste"
    // returns 0 results. Use the user's actual words (first 4) or top genre.
    const discoveryQuery = intent.keywords.length > 0
      ? intent.keywords.slice(0, 3).join(" ")
      : userPrompt.trim()
      ? userPrompt.trim().split(/\s+/).slice(0, 4).join(" ")
      : genreStr.split(",")[0]?.trim() || allGenres[0] || "indie";

    const discoveryTracks = await (
      discoveryTarget > 0
        ? searchTracksForGeneration(spotify, discoveryQuery, 25).then((r) => {
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
                reason:         `Matches "${discoveryQuery}"`,
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
    const allTracks    = sequencePlaylist([...anchorTracks, ...grooveTracks, ...discoveryTracks], intent.flow);

    const moodLabel = requestStr.length < 60 ? `"${requestStr}"` : "your current vibe";
    const intro = familiarity === "familiar"
      ? `Your comfort playlist — the tracks that fit ${moodLabel}, ready to play.`
      : `Built for ${moodLabel}: tracks from your library that match the vibe${discoveryTracks.length > 0 ? ", plus a few fresh finds" : ""}.`;

    return buildResponse(allTracks, intro, userPrompt, user.id, cacheKey);
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
  cacheKey?: string,
): NextResponse {
  const body = { intro, tracks, playlistId: null };
  if (cacheKey) setCachedPlaylist(cacheKey, body);
  const response = NextResponse.json(body);

  after(async () => {
    try {
      const admin = createAdminClient();
      const verifiedCount = tracks.filter((t) => t.spotifyTrackId).length;
      await markEscapePoolRecommended(
        userId,
        admin,
        tracks.map((track) => track.spotifyTrackId).filter((id): id is string => Boolean(id)),
      );
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
