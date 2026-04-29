import { createAdminClient } from "@/lib/supabase/admin";
import { STALENESS_WEIGHTS } from "@/lib/constants";
import type { StalenessResult } from "./types";

export async function calculateStalenessScores(
  userId: string
): Promise<StalenessResult[]> {
  const supabase = createAdminClient();

  const { data: history } = await supabase
    .from("user_listening_history")
    .select("spotify_track_id, track_name, artist_names, album_image_url, played_at")
    .eq("user_id", userId)
    .order("played_at", { ascending: false });

  if (!history || history.length === 0) return [];

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const fifteenDaysAgo = now - 15 * 24 * 60 * 60 * 1000;

  const trackMap = new Map<
    string,
    {
      trackName: string;
      artistNames: string[];
      albumImageUrl: string | null;
      totalPlays: number;
      plays7d: number;
      plays30d: number;
      playsFirstHalf: number;
      playsSecondHalf: number;
      firstPlayed: number;
    }
  >();

  for (const entry of history) {
    const playedAt = new Date(entry.played_at).getTime();
    const existing = trackMap.get(entry.spotify_track_id);

    if (existing) {
      existing.totalPlays++;
      if (playedAt >= sevenDaysAgo) existing.plays7d++;
      if (playedAt >= thirtyDaysAgo) {
        existing.plays30d++;
        if (playedAt < fifteenDaysAgo) existing.playsFirstHalf++;
        else existing.playsSecondHalf++;
      }
      if (playedAt < existing.firstPlayed) existing.firstPlayed = playedAt;
    } else {
      trackMap.set(entry.spotify_track_id, {
        trackName: entry.track_name,
        artistNames: entry.artist_names,
        albumImageUrl: entry.album_image_url,
        totalPlays: 1,
        plays7d: playedAt >= sevenDaysAgo ? 1 : 0,
        plays30d: playedAt >= thirtyDaysAgo ? 1 : 0,
        playsFirstHalf:
          playedAt >= thirtyDaysAgo && playedAt < fifteenDaysAgo ? 1 : 0,
        playsSecondHalf: playedAt >= fifteenDaysAgo ? 1 : 0,
        firstPlayed: playedAt,
      });
    }
  }

  const uniqueTracksIn30d = Array.from(trackMap.values()).filter(
    (t) => t.plays30d > 0
  ).length;

  const results: StalenessResult[] = [];

  for (const [trackId, data] of trackMap) {
    if (data.totalPlays < 2) continue;

    const frequencyScore = Math.min(100, (data.plays7d / 7) * 50);

    const repetitionScore = Math.min(
      100,
      uniqueTracksIn30d > 0
        ? (data.plays30d / uniqueTracksIn30d) * 200
        : 0
    );

    let trendScore: number;
    let trend: "increasing" | "stable" | "decreasing";
    if (data.playsSecondHalf > data.playsFirstHalf * 1.3) {
      trendScore = 80;
      trend = "increasing";
    } else if (data.playsSecondHalf < data.playsFirstHalf * 0.7) {
      trendScore = 10;
      trend = "decreasing";
    } else {
      trendScore = 30;
      trend = "stable";
    }

    const daysSinceFirst = (now - data.firstPlayed) / (24 * 60 * 60 * 1000);
    const durationPenalty = Math.min(100, (daysSinceFirst / 14) * 30);

    const rawScore =
      frequencyScore * STALENESS_WEIGHTS.FREQUENCY +
      repetitionScore * STALENESS_WEIGHTS.REPETITION +
      trendScore * STALENESS_WEIGHTS.TREND +
      durationPenalty * STALENESS_WEIGHTS.DURATION;

    const stalenessScore = Math.round(Math.max(0, Math.min(100, rawScore)));

    let level: StalenessResult["level"];
    if (stalenessScore <= 25) level = "fresh";
    else if (stalenessScore <= 50) level = "familiar";
    else if (stalenessScore <= 75) level = "overplayed";
    else level = "burnt_out";

    results.push({
      spotifyTrackId: trackId,
      trackName: data.trackName,
      artistNames: data.artistNames,
      albumImageUrl: data.albumImageUrl,
      stalenessScore,
      totalPlays: data.totalPlays,
      playsLast7Days: data.plays7d,
      playsLast30Days: data.plays30d,
      playFrequencyPerWeek: data.plays7d,
      trend,
      level,
    });
  }

  results.sort((a, b) => b.stalenessScore - a.stalenessScore);
  return results;
}
