import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SPOTIFY_API_BASE, SPOTIFY_TOKEN_URL } from "@/lib/constants";

export const maxDuration = 30;

type TrackRow = {
  spotify_track_id: string;
  track_name: string;
  artist_names: string[] | null;
  artist_ids?: string[] | null;
  time_range?: string;
  rank?: number;
};

type PoolRow = TrackRow & {
  source: string;
  source_ref: string | null;
  popularity: number | null;
  affinity_score: number | string | null;
  novelty_score: number | string | null;
  last_recommended_at: string | null;
  blocked_until: string | null;
  updated_at: string | null;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function trackIdentity(trackName: string, artistName: string): string {
  return normalize(`${trackName}|||${artistName}`);
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function getSpotifyAppToken(): Promise<string | null> {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) return null;
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!response.ok) return null;
  return ((await response.json()) as { access_token: string }).access_token;
}

async function spotifyGet<T>(token: string | null, endpoint: string): Promise<T | null> {
  if (!token) return null;
  const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json() as Promise<T>;
}

function blockTrack(row: TrackRow, blockedIds: Set<string>, blockedNorms: Set<string>) {
  const artistName = row.artist_names?.[0] ?? "";
  if (row.spotify_track_id) blockedIds.add(row.spotify_track_id);
  if (row.track_name || artistName) blockedNorms.add(trackIdentity(row.track_name, artistName));
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token !== process.env.VERCEL_GIT_COMMIT_SHA) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: statuses, error: statusError } = await admin
    .from("user_sync_status")
    .select("user_id, updated_at, last_top_items_sync, last_history_sync, total_history_records")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (statusError || !statuses?.[0]) {
    return NextResponse.json({ error: statusError?.message ?? "No sync status found" }, { status: 500 });
  }

  const userId = statuses[0].user_id as string;
  const [{ data: poolRows }, { data: topTracks }, { data: historyRows }, { data: topArtists }] =
    await Promise.all([
      admin
        .from("escape_pool_tracks")
        .select("spotify_track_id, track_name, artist_names, source, source_ref, popularity, affinity_score, novelty_score, last_recommended_at, blocked_until, updated_at")
        .eq("user_id", userId)
        .limit(1000),
      admin
        .from("user_top_tracks")
        .select("spotify_track_id, track_name, artist_names, artist_ids, time_range, rank")
        .eq("user_id", userId)
        .in("time_range", ["short_term", "long_term"])
        .order("rank")
        .limit(120),
      admin
        .from("user_listening_history")
        .select("spotify_track_id, track_name, artist_names, played_at")
        .eq("user_id", userId)
        .gte("played_at", daysAgo(21))
        .order("played_at", { ascending: false })
        .limit(400),
      admin
        .from("user_top_artists")
        .select("spotify_artist_id, artist_name, genres, rank, time_range")
        .eq("user_id", userId)
        .in("time_range", ["short_term", "long_term"])
        .order("rank")
        .limit(40),
    ]);

  const blockedIds = new Set<string>();
  const blockedNorms = new Set<string>();
  for (const row of (topTracks ?? []) as TrackRow[]) blockTrack(row, blockedIds, blockedNorms);
  for (const row of (historyRows ?? []) as TrackRow[]) blockTrack(row, blockedIds, blockedNorms);

  const now = Date.now();
  const poolSources: Record<string, number> = {};
  const survivorSources: Record<string, number> = {};
  const rejection = {
    totalPoolRows: (poolRows ?? []).length,
    missingArtist: 0,
    blockedId: 0,
    blockedNorm: 0,
    blockedUntil: 0,
    recentlyRecommendedUnder14d: 0,
    survivesHardBlock: 0,
  };

  for (const row of (poolRows ?? []) as PoolRow[]) {
    poolSources[row.source] = (poolSources[row.source] ?? 0) + 1;
    const artistName = row.artist_names?.[0] ?? "";
    if (!row.spotify_track_id || !artistName) {
      rejection.missingArtist++;
      continue;
    }
    if (blockedIds.has(row.spotify_track_id)) {
      rejection.blockedId++;
      continue;
    }
    if (blockedNorms.has(trackIdentity(row.track_name, artistName))) {
      rejection.blockedNorm++;
      continue;
    }
    if (row.blocked_until && new Date(row.blocked_until).getTime() > now) {
      rejection.blockedUntil++;
      continue;
    }
    if (row.last_recommended_at && now - new Date(row.last_recommended_at).getTime() < 14 * 24 * 60 * 60 * 1000) {
      rejection.recentlyRecommendedUnder14d++;
    }
    rejection.survivesHardBlock++;
    survivorSources[row.source] = (survivorSources[row.source] ?? 0) + 1;
  }

  const spotifyToken = await getSpotifyAppToken();
  const artistIds = [...new Set(((topArtists ?? []) as Array<{ spotify_artist_id: string }>).map((a) => a.spotify_artist_id).filter(Boolean))].slice(0, 8);
  let rawArtistTopTracks = 0;
  let usableArtistTopTracks = 0;
  for (const artistId of artistIds) {
    const data = await spotifyGet<{ tracks: Array<{ id: string; name: string; artists: Array<{ name: string }> }> }>(
      spotifyToken,
      `/artists/${encodeURIComponent(artistId)}/top-tracks?market=US`,
    );
    for (const track of data?.tracks ?? []) {
      rawArtistTopTracks++;
      const artistName = track.artists[0]?.name ?? "";
      if (
        track.id &&
        artistName &&
        !blockedIds.has(track.id) &&
        !blockedNorms.has(trackIdentity(track.name, artistName))
      ) {
        usableArtistTopTracks++;
      }
    }
  }

  return NextResponse.json({
    user: {
      idPrefix: userId.slice(0, 8),
      latestSync: statuses[0],
    },
    dataShape: {
      escapePoolRows: (poolRows ?? []).length,
      topTracks: (topTracks ?? []).length,
      history21d: (historyRows ?? []).length,
      history7d: ((historyRows ?? []) as Array<{ played_at: string }>).filter((row) => new Date(row.played_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000).length,
      topArtists: (topArtists ?? []).length,
      blockedIds: blockedIds.size,
      blockedTrackIdentities: blockedNorms.size,
    },
    poolSources,
    survivorSources,
    rejection,
    spotifyCandidateProbe: {
      hasSpotifyAppToken: Boolean(spotifyToken),
      testedArtistIds: artistIds.length,
      rawArtistTopTracks,
      usableArtistTopTracks,
    },
  });
}
