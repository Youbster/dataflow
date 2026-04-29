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
}
