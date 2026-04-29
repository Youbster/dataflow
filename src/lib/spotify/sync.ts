import { createAdminClient } from "@/lib/supabase/admin";
import { createSpotifyClient } from "./client";
import { TIME_RANGES } from "@/lib/constants";
import type { SpotifyTrack, SpotifyArtist } from "@/types/spotify";

interface SyncOptions {
  force?: boolean;
  topItems?: boolean;
  history?: boolean;
}

export async function syncUserData(
  userId: string,
  options: SyncOptions = { topItems: true, history: true }
) {
  const supabase = createAdminClient();

  const { data: syncStatus } = await supabase
    .from("user_sync_status")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (syncStatus?.sync_in_progress && !options.force) {
    return { success: false, message: "Sync already in progress" };
  }

  await supabase
    .from("user_sync_status")
    .update({ sync_in_progress: true, last_sync_error: null, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  const spotify = createSpotifyClient(userId);

  try {
    if (options.topItems) {
      await syncTopItems(userId, spotify, supabase);
      await supabase
        .from("user_sync_status")
        .update({ last_top_items_sync: new Date().toISOString() })
        .eq("user_id", userId);
    }

    if (options.history) {
      const cursor = syncStatus?.last_history_cursor ?? undefined;
      const newCursor = await syncListeningHistory(
        userId,
        spotify,
        supabase,
        cursor
      );

      const { count } = await supabase
        .from("user_listening_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      await supabase
        .from("user_sync_status")
        .update({
          last_history_sync: new Date().toISOString(),
          last_history_cursor: newCursor,
          total_history_records: count ?? 0,
        })
        .eq("user_id", userId);
    }

    await supabase
      .from("user_sync_status")
      .update({ sync_in_progress: false, updated_at: new Date().toISOString() })
      .eq("user_id", userId);

    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    await supabase
      .from("user_sync_status")
      .update({
        sync_in_progress: false,
        last_sync_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    throw err;
  }
}

async function syncTopItems(
  userId: string,
  spotify: ReturnType<typeof createSpotifyClient>,
  supabase: ReturnType<typeof createAdminClient>
) {
  for (const timeRange of TIME_RANGES) {
    const [tracksData, artistsData] = await Promise.all([
      spotify.getTopTracks(timeRange),
      spotify.getTopArtists(timeRange),
    ]);

    await supabase
      .from("user_top_tracks")
      .delete()
      .eq("user_id", userId)
      .eq("time_range", timeRange);

    if (tracksData.items.length > 0) {
      const trackRows = tracksData.items.map(
        (track: SpotifyTrack, index: number) => ({
          user_id: userId,
          spotify_track_id: track.id,
          track_name: track.name,
          artist_names: track.artists.map((a) => a.name),
          artist_ids: track.artists.map((a) => a.id),
          album_name: track.album.name,
          album_image_url: track.album.images[0]?.url ?? null,
          duration_ms: track.duration_ms,
          preview_url: track.preview_url,
          popularity: track.popularity,
          time_range: timeRange,
          rank: index + 1,
          fetched_at: new Date().toISOString(),
        })
      );

      await supabase.from("user_top_tracks").insert(trackRows);
    }

    await supabase
      .from("user_top_artists")
      .delete()
      .eq("user_id", userId)
      .eq("time_range", timeRange);

    if (artistsData.items.length > 0) {
      const artistRows = artistsData.items.map(
        (artist: SpotifyArtist, index: number) => ({
          user_id: userId,
          spotify_artist_id: artist.id,
          artist_name: artist.name,
          genres: artist.genres,
          image_url: artist.images[0]?.url ?? null,
          popularity: artist.popularity,
          follower_count: artist.followers.total,
          time_range: timeRange,
          rank: index + 1,
          fetched_at: new Date().toISOString(),
        })
      );

      await supabase.from("user_top_artists").insert(artistRows);
    }
  }
}

async function syncListeningHistory(
  userId: string,
  spotify: ReturnType<typeof createSpotifyClient>,
  supabase: ReturnType<typeof createAdminClient>,
  afterCursor?: string
): Promise<string | undefined> {
  const data = await spotify.getRecentlyPlayed(50, afterCursor);

  if (data.items.length === 0) {
    return afterCursor;
  }

  const historyRows = data.items.map((item) => ({
    user_id: userId,
    spotify_track_id: item.track.id,
    track_name: item.track.name,
    artist_names: item.track.artists.map((a) => a.name),
    album_name: item.track.album.name,
    album_image_url: item.track.album.images[0]?.url ?? null,
    played_at: item.played_at,
    context_type: item.context?.type ?? null,
    context_uri: item.context?.uri ?? null,
  }));

  await supabase
    .from("user_listening_history")
    .upsert(historyRows, {
      onConflict: "user_id,spotify_track_id,played_at",
      ignoreDuplicates: true,
    });

  const latestPlayedAt = data.items
    .map((i) => new Date(i.played_at).getTime())
    .reduce((max, t) => Math.max(max, t), 0);

  return latestPlayedAt ? String(latestPlayedAt) : afterCursor;
}
