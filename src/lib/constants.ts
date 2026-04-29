export const SPOTIFY_SCOPES = [
  "user-read-recently-played",
  "user-top-read",
  "user-library-read",
  "user-read-email",
  "user-read-private",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

export const CACHE_TTL = {
  TOP_ITEMS: 60 * 60 * 1000, // 1 hour
  HISTORY: 30 * 60 * 1000, // 30 minutes
  AI_INSIGHTS: 60 * 60 * 1000, // 1 hour
  SYNC_COOLDOWN: 5 * 60 * 1000, // 5 minutes
} as const;

export const STALENESS_THRESHOLDS = {
  FRESH: 25,
  FAMILIAR: 50,
  OVERPLAYED: 75,
  BURNT_OUT: 100,
} as const;

export const STALENESS_WEIGHTS = {
  FREQUENCY: 0.4,
  REPETITION: 0.3,
  TREND: 0.2,
  DURATION: 0.1,
} as const;

export const TIME_RANGES = ["short_term", "medium_term", "long_term"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  short_term: "Last 4 Weeks",
  medium_term: "Last 6 Months",
  long_term: "All Time",
};
