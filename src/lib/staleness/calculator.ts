import { createAdminClient } from "@/lib/supabase/admin";
import { STALENESS_WEIGHTS } from "@/lib/constants";
import type { StalenessResult, StalenessHealth } from "./types";

function isLateNight(dateMs: number): boolean {
  const hour = new Date(dateMs).getHours();
  return hour >= 23 || hour < 7;
}

function buildWhyStale(
  plays7dConscious: number,
  totalPlays: number,
  trend: "increasing" | "stable" | "decreasing",
  level: StalenessResult["level"]
): string {
  if (level === "burnt_out") {
    if (trend === "increasing") {
      return `${plays7dConscious}× this week and accelerating — your brain is starting to tune this out.`;
    }
    return `${totalPlays} plays total, ${plays7dConscious}× this week. You've maxed out on this one.`;
  }
  if (level === "overplayed") {
    if (trend === "increasing") {
      return `${plays7dConscious}× this week and climbing — entering overplay territory fast.`;
    }
    return `${plays7dConscious}× this week across ${totalPlays} total plays. You're wearing this one out.`;
  }
  if (level === "familiar") {
    if (trend === "increasing") {
      return `${plays7dConscious}× this week and trending up — keep an eye on this one.`;
    }
    return `${plays7dConscious} plays this week. You know it well, but still safe.`;
  }
  return `${plays7dConscious} plays this week. Still fresh.`;
}

export async function calculateStalenessScores(
  userId: string
): Promise<{ results: StalenessResult[]; health: StalenessHealth }> {
  const supabase = createAdminClient();

  const { data: history } = await supabase
    .from("user_listening_history")
    .select(
      "spotify_track_id, track_name, artist_names, album_image_url, played_at"
    )
    .eq("user_id", userId)
    .order("played_at", { ascending: false });

  if (!history || history.length === 0) {
    return {
      results: [],
      health: {
        healthScore: 10,
        totalPlays: 0,
        uniqueTracks: 0,
        coverageDays: 0,
        topThreeConcentration: 0,
        artistBurnout: null,
        coverageNote: "No listening history yet.",
      },
    };
  }

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
      plays7dConscious: number;
      plays30d: number;
      playsFirstHalf: number;
      playsSecondHalf: number;
      firstPlayed: number;
      lastPlayed: number;
    }
  >();

  for (const entry of history) {
    const playedAt = new Date(entry.played_at).getTime();
    const lateNight = isLateNight(playedAt);
    const existing = trackMap.get(entry.spotify_track_id);

    if (existing) {
      existing.totalPlays++;
      if (playedAt >= sevenDaysAgo) {
        existing.plays7d++;
        if (!lateNight) existing.plays7dConscious++;
      }
      if (playedAt >= thirtyDaysAgo) {
        existing.plays30d++;
        if (playedAt < fifteenDaysAgo) existing.playsFirstHalf++;
        else existing.playsSecondHalf++;
      }
      if (playedAt < existing.firstPlayed) existing.firstPlayed = playedAt;
      if (playedAt > existing.lastPlayed) existing.lastPlayed = playedAt;
    } else {
      trackMap.set(entry.spotify_track_id, {
        trackName: entry.track_name,
        artistNames: entry.artist_names,
        albumImageUrl: entry.album_image_url,
        totalPlays: 1,
        plays7d: playedAt >= sevenDaysAgo ? 1 : 0,
        plays7dConscious:
          playedAt >= sevenDaysAgo && !lateNight ? 1 : 0,
        plays30d: playedAt >= thirtyDaysAgo ? 1 : 0,
        playsFirstHalf:
          playedAt >= thirtyDaysAgo && playedAt < fifteenDaysAgo ? 1 : 0,
        playsSecondHalf: playedAt >= fifteenDaysAgo ? 1 : 0,
        firstPlayed: playedAt,
        lastPlayed: playedAt,
      });
    }
  }

  const uniqueTracksIn30d = Array.from(trackMap.values()).filter(
    (t) => t.plays30d > 0
  ).length;

  // ─── Health computation ──────────────────────────────────────────────────

  const oldestPlay = Math.min(
    ...Array.from(trackMap.values()).map((t) => t.firstPlayed)
  );
  const coverageDays = Math.max(
    1,
    Math.round((now - oldestPlay) / (24 * 60 * 60 * 1000))
  );

  const total7dConscious = Array.from(trackMap.values()).reduce(
    (sum, t) => sum + t.plays7dConscious,
    0
  );

  const sorted7d = Array.from(trackMap.values())
    .filter((t) => t.plays7dConscious > 0)
    .sort((a, b) => b.plays7dConscious - a.plays7dConscious);

  const top3Plays = sorted7d
    .slice(0, 3)
    .reduce((sum, t) => sum + t.plays7dConscious, 0);

  const topThreeConcentration =
    total7dConscious > 0
      ? Math.round((top3Plays / total7dConscious) * 100)
      : 0;

  // Artist burnout: dominant artist > 28% of conscious 7d plays
  const artistMap = new Map<string, number>();
  for (const t of trackMap.values()) {
    if (t.plays7dConscious === 0) continue;
    for (const artist of t.artistNames) {
      artistMap.set(artist, (artistMap.get(artist) ?? 0) + t.plays7dConscious);
    }
  }

  let artistBurnout: StalenessHealth["artistBurnout"] = null;
  for (const [artistName, playCount] of artistMap) {
    if (total7dConscious > 0) {
      const pct = Math.round((playCount / total7dConscious) * 100);
      if (pct > 28 && (!artistBurnout || pct > artistBurnout.pct)) {
        artistBurnout = { artistName, playCount, pct };
      }
    }
  }

  // Health score: 0–10, penalised for concentration + artist burnout
  let healthScore = 10 - topThreeConcentration / 12;
  if (artistBurnout) healthScore -= artistBurnout.pct / 25;
  healthScore = Math.max(0, Math.min(10, Math.round(healthScore * 10) / 10));

  const coverageNote =
    coverageDays < 7
      ? `Only ${coverageDays} day${coverageDays !== 1 ? "s" : ""} of data — scores will sharpen over time.`
      : coverageDays < 14
      ? `${coverageDays} days of listening history.`
      : `${coverageDays} days of listening history — solid coverage.`;

  const health: StalenessHealth = {
    healthScore,
    totalPlays: history.length,
    uniqueTracks: trackMap.size,
    coverageDays,
    topThreeConcentration,
    artistBurnout,
    coverageNote,
  };

  // ─── Staleness scores ────────────────────────────────────────────────────

  const results: StalenessResult[] = [];

  for (const [trackId, data] of trackMap) {
    if (data.totalPlays < 2) continue;

    const frequencyScore = Math.min(
      100,
      (data.plays7dConscious / 7) * 50
    );

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

    const daysSinceFirst =
      (now - data.firstPlayed) / (24 * 60 * 60 * 1000);
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
      playFrequencyPerWeek: data.plays7dConscious,
      trend,
      level,
      lastPlayedAt: new Date(data.lastPlayed).toISOString(),
      whyStale: buildWhyStale(
        data.plays7dConscious,
        data.totalPlays,
        trend,
        level
      ),
    });
  }

  results.sort((a, b) => b.stalenessScore - a.stalenessScore);
  return { results, health };
}
