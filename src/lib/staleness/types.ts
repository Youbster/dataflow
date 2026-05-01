export interface StalenessResult {
  spotifyTrackId: string;
  trackName: string;
  artistNames: string[];
  albumImageUrl: string | null;
  stalenessScore: number;
  totalPlays: number;
  playsLast7Days: number;
  playsLast30Days: number;
  playFrequencyPerWeek: number;
  trend: "increasing" | "stable" | "decreasing";
  level: "fresh" | "familiar" | "overplayed" | "burnt_out";
  lastPlayedAt: string;   // ISO string of most recent play
  whyStale: string;       // plain-English explanation
}

export interface StalenessHealth {
  healthScore: number;           // 0–10 variety score
  totalPlays: number;
  uniqueTracks: number;
  coverageDays: number;
  topThreeConcentration: number; // % of 7-day plays from top 3 tracks
  artistBurnout: {
    artistName: string;
    playCount: number;
    pct: number;
  } | null;
  coverageNote: string;
}
