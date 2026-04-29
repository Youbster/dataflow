import type { UserTopTrack, UserTopArtist } from "@/types/database";

export const MUSIC_EXPERT_SYSTEM = `You are DataFlow's music intelligence engine. You are an expert musicologist with deep knowledge of artists, genres, subgenres, music history, and the connections between them. You analyze Spotify listening data and provide insights, recommendations, and playlist curation.

IMPORTANT CONSTRAINTS:
- Only recommend real, existing tracks that are available on Spotify.
- Always include both track name AND primary artist name.
- When suggesting alternatives, explain WHY the suggestion fits based on musical qualities.
- Be specific about genres and subgenres, not just "rock" or "pop".
- Consider the user's listening patterns, not just what's popular.
- Return all responses as valid JSON.`;

export interface TasteProfile {
  topArtists: Array<{ name: string; genres: string[]; rank: number }>;
  topTracks: Array<{ name: string; artist: string; rank: number }>;
  genreDistribution: Record<string, number>;
}

export function buildTasteProfile(
  topTracks: UserTopTrack[],
  topArtists: UserTopArtist[]
): TasteProfile {
  const genreDistribution: Record<string, number> = {};
  for (const artist of topArtists) {
    for (const genre of artist.genres) {
      genreDistribution[genre] = (genreDistribution[genre] || 0) + 1;
    }
  }

  return {
    topArtists: topArtists.map((a) => ({
      name: a.artist_name,
      genres: a.genres,
      rank: a.rank,
    })),
    topTracks: topTracks.map((t) => ({
      name: t.track_name,
      artist: t.artist_names[0] || "Unknown",
      rank: t.rank,
    })),
    genreDistribution,
  };
}

export function buildPlaylistPrompt(
  tasteProfile: TasteProfile,
  userPrompt: string,
  trackCount: number
): string {
  return `The user wants a playlist: "${userPrompt}"

Their taste profile:
- Top artists: ${tasteProfile.topArtists
    .slice(0, 15)
    .map((a) => `${a.name} (${a.genres.slice(0, 3).join(", ")})`)
    .join("; ")}
- Top genres: ${Object.entries(tasteProfile.genreDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([g, c]) => `${g} (${c})`)
    .join(", ")}
- Top tracks: ${tasteProfile.topTracks
    .slice(0, 10)
    .map((t) => `"${t.name}" by ${t.artist}`)
    .join("; ")}

Generate exactly ${trackCount} tracks. For each track provide:
- trackName: exact Spotify track name
- artistName: primary artist
- reason: 1-sentence explanation of why this fits

Mix familiar artists from their taste with discoveries they'd enjoy.
Ensure good flow — consider energy, tempo, and mood progression.

Return as JSON: { "tracks": [{ "trackName": "...", "artistName": "...", "reason": "..." }] }`;
}

export function buildInsightsPrompt(
  tasteProfile: TasteProfile,
  totalTracks: number,
  uniqueArtists: number
): string {
  const topGenres = Object.entries(tasteProfile.genreDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  return `Analyze this listening data and generate 4-5 concise, interesting insights:

- Top genres: ${topGenres.map(([g, c]) => `${g} (${c})`).join(", ")}
- Top artists: ${tasteProfile.topArtists
    .slice(0, 15)
    .map((a) => a.name)
    .join(", ")}
- Total tracks in rotation: ${totalTracks}
- Unique artists: ${uniqueArtists}
- Diversity ratio: ${uniqueArtists > 0 ? (uniqueArtists / Math.max(totalTracks, 1)).toFixed(2) : "N/A"}

Be conversational, surprising, and specific. Avoid generic observations.
Reference specific artists and genres. Each insight should be 1-2 sentences.

Return as JSON: { "insights": [{ "text": "...", "category": "genre|discovery|habit|mood|trend" }] }`;
}

export function buildStalenessPrompt(
  staleTracks: Array<{
    trackName: string;
    artistNames: string[];
    playCount: number;
    stalenessScore: number;
  }>,
  tasteProfile: TasteProfile
): string {
  return `These tracks have become overplayed for this user:
${staleTracks
  .map(
    (t) =>
      `- "${t.trackName}" by ${t.artistNames.join(", ")} (played ${t.playCount} times, staleness: ${t.stalenessScore}/100)`
  )
  .join("\n")}

Their taste profile:
- Top genres: ${Object.entries(tasteProfile.genreDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([g]) => g)
    .join(", ")}
- Top artists: ${tasteProfile.topArtists
    .slice(0, 10)
    .map((a) => a.name)
    .join(", ")}

For each stale track, suggest 2-3 fresh alternatives that:
- Have similar musical qualities (genre, energy, mood)
- Are NOT already in their top tracks
- Include at least one lesser-known artist they haven't heard

Return as JSON: { "suggestions": [{ "staleTrack": "...", "alternatives": [{ "trackName": "...", "artistName": "...", "reason": "..." }] }] }`;
}
