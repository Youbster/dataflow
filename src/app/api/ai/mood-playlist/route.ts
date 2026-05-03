import { NextRequest, NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";
import { primeTokenCache } from "@/lib/spotify/token";
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

type GenerationGoal = "build_vibe" | "break_loop";
type BreakLoopMode = "near_taste" | "new_lane" | "energy_shift" | "surprise";
type PlaylistJobStatus = "queued" | "processing" | "completed" | "failed";

const PLAYLIST_CACHE = new Map<string, CachedPlaylist>();
const PLAYLIST_CACHE_TTL_MS = 15 * 60 * 1000;
const PLAYLIST_CACHE_MAX_ENTRIES = 80;

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

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

async function updatePlaylistJob(
  jobId: string,
  values: {
    status: PlaylistJobStatus;
    result_json?: unknown;
    error?: string | null;
    started_at?: string;
    completed_at?: string;
  },
) {
  await createAdminClient()
    .from("playlist_generation_jobs")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function runPlaylistGenerationJob({
  origin,
  cookie,
  body,
  jobId,
}: {
  origin: string;
  cookie: string;
  body: Record<string, unknown>;
  jobId: string;
}) {
  await updatePlaylistJob(jobId, {
    status: "processing",
    started_at: new Date().toISOString(),
    error: null,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 29_000);

  try {
    const response = await fetch(`${origin}/api/ai/mood-playlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": cookie,
        "x-playlist-worker": "1",
        "x-playlist-job-id": jobId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const message = result && typeof result === "object" && "error" in result
        ? String((result as { error?: unknown }).error)
        : `Playlist generation failed (${response.status})`;
      throw new Error(message);
    }

    await updatePlaylistJob(jobId, {
      status: "completed",
      result_json: result,
      completed_at: new Date().toISOString(),
      error: null,
    });
  } catch (err) {
    clearTimeout(timeout);
    const message = err instanceof Error && err.name === "AbortError"
      ? "Generation worker hit the Vercel time limit. Try 20 min or a more specific genre."
      : err instanceof Error
      ? err.message
      : "Playlist generation failed";

    await updatePlaylistJob(jobId, {
      status: "failed",
      error: message,
      completed_at: new Date().toISOString(),
    });
  }
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
        spotify.searchTracks(query, 30).then((result) => ({ query, result }))
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
    .filter((item): item is PromiseFulfilledResult<{ query: string; result: Awaited<ReturnType<typeof spotify.searchTracks>> }> => item.status === "fulfilled")
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
  const isWorkerRequest = request.headers.get("x-playlist-worker") === "1";
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

  if (!isWorkerRequest) {
    const { data: job, error } = await createAdminClient()
      .from("playlist_generation_jobs")
      .insert({
        user_id: user.id,
        status: "queued",
        request_body: body,
      })
      .select("id")
      .single();

    if (error || !job?.id) {
      console.error("[mood-playlist] Job create failed:", error);
      return NextResponse.json(
        { error: "Couldn't start playlist generation. Try again in a moment." },
        { status: 500 },
      );
    }

    const cookie = request.headers.get("cookie") ?? "";
    const origin = new URL(request.url).origin;
    const jobId = String(job.id);

    after(async () => {
      await runPlaylistGenerationJob({
        origin,
        cookie,
        body: body as Record<string, unknown>,
        jobId,
      });
    });

    return NextResponse.json({ jobId, status: "queued" }, { status: 202 });
  }

  try {
    // ── Fetch user data — direct Spotify calls, no Supabase data queries ──────
    //
    // Previously: 4 Supabase admin queries → cold-start Supabase free tier could
    // hang for 20-30s before returning.
    // Now: 4 parallel Spotify API calls — token is cached in-process (token.ts),
    // so only 1 DB hit happens (first call), subsequent calls use the cache.
    // Total expected latency: ~300-600 ms vs 5-30 s.
    type TopTracksPage = Awaited<ReturnType<typeof spotify.getTopTracks>>;
    type TopArtistsPage = Awaited<ReturnType<typeof spotify.getTopArtists>>;
    type RecentPage = Awaited<ReturnType<typeof spotify.getRecentlyPlayed>>;
    const emptyTracksPage: TopTracksPage = { items: [], total: 0, limit: 0, offset: 0, next: null };
    const emptyArtistsPage: TopArtistsPage = { items: [], total: 0, limit: 0, offset: 0, next: null };
    const emptyRecentPage: RecentPage = { items: [], next: null, cursors: null };
    const spotifyProfilePromise = Promise.all([
      spotify.getTopTracks("short_term", 50).catch(() => emptyTracksPage),
      spotify.getTopTracks("long_term",  50).catch(() => emptyTracksPage),
      spotify.getTopArtists("short_term", 10).catch(() => emptyArtistsPage),
      spotify.getRecentlyPlayed(50).catch(() => emptyRecentPage),
    ]) as Promise<[TopTracksPage, TopTracksPage, TopArtistsPage, RecentPage]>;
    const [
      shortTracksData,
      longTracksData,
      shortArtistsData,
      recentlyPlayedData,
    ] = await withTimeout(
      spotifyProfilePromise,
      generationGoal === "break_loop" ? 5_500 : 6_500,
      [emptyTracksPage, emptyTracksPage, emptyArtistsPage, emptyRecentPage],
    );

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

    if (!hasData) {
      const targetCount = counts.total;
      const starterTracks = await buildFastSearchPlaylist({
        spotify,
        requestStr: breakLoopTarget || genreLock || requestStr,
        allGenres,
        intent: fallbackIntent,
        intensity,
        targetCount,
        recentSet,
        knownArtistNorms,
        avoidKnownArtists: false,
      });

      if (starterTracks.length === 0) {
        return NextResponse.json(
          { error: "Spotify did not return enough tracks yet. Try adding a genre or mood like 'afro house workout'." },
          { status: 422 },
        );
      }

      const starterLabel = generationGoal === "break_loop" ? "starter loop reset" : "starter playlist";
      const intro = `Built a ${starterLabel} from your request while your Spotify taste profile warms up. Sync more listening history and the next one will get more personal.`;
      return buildResponse(
        sequencePlaylist(starterTracks, fallbackIntent.flow),
        intro,
        requestStr,
        user.id,
        cacheKey,
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
      const addResetTrack = (track: SpotifyTrack, query: string, strict: boolean) => {
        const artistName = track.artists[0]?.name ?? "";
        const artistNorm = normalizeForCompare(artistName);
        if (!artistNorm) return false;
        if (existingIds.has(track.id) || blockedTrackIds.has(track.id)) return false;
        if (blockedTrackNorms.has(trackIdentity(track.name, artistName))) return false;
        if (strict && repeatedArtistNorms.has(artistNorm)) return false;
        if (strict && modeConfig.strictBlocksKnownArtists && knownArtistNorms.has(artistNorm)) return false;
        if ((artistPickCounts.get(artistNorm) ?? 0) >= 2) return false;
        existingIds.add(track.id);
        artistPickCounts.set(artistNorm, (artistPickCounts.get(artistNorm) ?? 0) + 1);
        resetCandidates.push({ track, query, strict });
        return true;
      };

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
          console.error("[break-loop] AI reset fallback failed:", err);
          return [] as SpotifyTrack[];
        }),
        10_000,
        [] as SpotifyTrack[],
      );

      const searchBatch = async (queries: string[], limit: number) => {
        const results = await withTimeout(
          Promise.allSettled(
            queries.map((query) =>
              spotify.searchTracks(query, limit).then((result) => ({ query, result }))
            )
          ),
          8_000,
          [],
        );

        return results
          .filter((item): item is PromiseFulfilledResult<{ query: string; result: Awaited<ReturnType<typeof spotify.searchTracks>> }> => item.status === "fulfilled")
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
        const relaxedResults = await searchBatch(strictQueries.slice(0, 6), 25);
        for (const { track, query } of relaxedResults) {
          if (resetCandidates.length >= counts.total) break;
          addResetTrack(track, query, false);
        }
      }

      if (resetCandidates.length === 0) {
        const broadResults = await searchBatch(["new music friday", "fresh finds", "indie pop", "dance hits", "alternative hits", "electronic hits"], 30);
        for (const { track, query } of broadResults) {
          if (resetCandidates.length >= counts.total) break;
          addResetTrack(track, query, false);
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

      if (allTracks.length === 0) {
        return NextResponse.json(
          { error: "Couldn't build a loop reset yet. Reconnect Spotify or sync more listening history, then try again." },
          { status: 422 },
        );
      }

      const dominantArtist = [...recentArtistCounts.values()].sort((a, b) => b.count - a.count)[0]?.name ?? null;
      const intro = dominantArtist
        ? `Your ${modeConfig.label.toLowerCase()} loop reset steps away from ${dominantArtist}${breakLoopTarget ? ` toward ${breakLoopTarget}` : ""}: safe anchors, bridges, and fresh breakers.`
        : `Your ${modeConfig.label.toLowerCase()} loop reset${breakLoopTarget ? ` toward ${breakLoopTarget}` : ""} mixes safe anchors, bridges, and fresh tracks outside your repeats.`;

      return buildResponse(allTracks, intro, requestStr, user.id, cacheKey);
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
      const targetCount = familiarity === "fresh" ? counts.total : counts.discovery;
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
            const sr = await spotify.searchTracks(query, 30);
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
        ? spotify.searchTracks(discoveryQuery, 25).then((r) => {
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
