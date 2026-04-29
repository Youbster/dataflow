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

export function buildWrappedPrompt(
  monthName: string,
  stats: {
    totalPlays: number;
    uniqueTracks: number;
    uniqueArtists: number;
    estimatedMinutes: number;
    mostActiveDay: string;
    topGenres: string[];
  },
  topTrack: { trackName: string; artistName: string; playCount: number } | null,
  topArtist: { name: string; playCount: number } | null,
  weekBreakdown: { week: number; plays: number; topTrack: string }[],
  tasteProfile: TasteProfile
): string {
  return `Write a listener's Monthly Wrapped narrative for ${monthName}.

THEIR MONTH IN NUMBERS:
- Total plays: ${stats.totalPlays}
- Unique tracks: ${stats.uniqueTracks}
- Unique artists: ${stats.uniqueArtists}
- Estimated minutes: ${stats.estimatedMinutes}
- Most active day: ${stats.mostActiveDay}
- Top genres: ${stats.topGenres.join(", ")}
${topTrack ? `- #1 track: "${topTrack.trackName}" by ${topTrack.artistName} (${topTrack.playCount} plays)` : ""}
${topArtist ? `- #1 artist: ${topArtist.name} (${topArtist.playCount} plays)` : ""}

WEEK BY WEEK:
${weekBreakdown.map((w) => `- Week ${w.week}: ${w.plays} plays${w.topTrack ? `, top track: "${w.topTrack}"` : ""}`).join("\n")}

THEIR BROADER TASTE:
- Top artists overall: ${tasteProfile.topArtists.slice(0, 8).map((a) => a.name).join(", ")}

Be specific, personal, and vivid. Reference their actual artists. Make it feel like a music journalist wrote it about them specifically.

Return ONLY valid JSON:
{
  "monthWord": "Single evocative word capturing this month's energy (e.g. 'Untethered', 'Electric', 'Searching', 'Restless')",
  "archetypeName": "Their music identity for THIS month — 3-4 words (different from a general archetype, specific to this period)",
  "description": "2-3 sentences about who they were musically this month. Reference their specific top artists and what it says about them.",
  "moodNarrative": "2-3 sentences tracing the month's musical arc — how it started, shifted, and ended. Was energy rising or falling? Any notable patterns?",
  "standoutStat": "One surprising or interesting stat observation (e.g. 'You discovered 3 new artists every week' or 'Your listening peaked every Wednesday at midnight')"
}`;
}

export function buildVibeForecastPrompt(
  tasteProfile: TasteProfile,
  weather: { city: string; country: string; tempC: number; condition: string; isRaining: boolean; humidity: number },
  dayOfWeek: string,
  season: string
): string {
  const topGenres = Object.entries(tasteProfile.genreDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([g]) => g)
    .join(", ");

  return `You are predicting this listener's musical week based on their taste, current weather, and context.

WEATHER RIGHT NOW in ${weather.city}, ${weather.country}:
- Condition: ${weather.condition}
- Temperature: ${weather.tempC}°C
- Raining: ${weather.isRaining}
- Humidity: ${weather.humidity}%

CONTEXT:
- Today: ${dayOfWeek}
- Season: ${season}

THEIR TASTE:
- Top artists: ${tasteProfile.topArtists.slice(0, 12).map((a) => a.name).join(", ")}
- Top genres: ${topGenres}
- Favourite tracks: ${tasteProfile.topTracks.slice(0, 8).map((t) => `"${t.name}" by ${t.artist}`).join("; ")}

Predict their Weekly Soundtrack. Make the weather connection feel vivid and specific — don't be generic. Reference their actual artists.

Return ONLY valid JSON:
{
  "weekTheme": "Poetic 3-6 word phrase for the week's sonic mood (e.g. 'Grey skies, heavier grooves', 'Sun-drunk & restless')",
  "weeklyMood": "Single evocative word (e.g. 'Introspective', 'Untethered', 'Electric')",
  "weatherInsight": "2 sentences connecting today's weather to their predicted musical cravings. Be creative and specific to their genres.",
  "predictedGenres": ["genre1", "genre2", "genre3"],
  "predictions": [
    { "trackName": "real Spotify track", "artistName": "real artist", "reason": "why this fits THIS week specifically — reference weather or context" },
    { "trackName": "real Spotify track", "artistName": "real artist", "reason": "..." },
    { "trackName": "real Spotify track", "artistName": "real artist", "reason": "..." },
    { "trackName": "real Spotify track", "artistName": "real artist", "reason": "..." },
    { "trackName": "real Spotify track", "artistName": "real artist", "reason": "..." }
  ]
}`;
}

export function buildPaletteCleanserPrompt(
  burnoutTrack: { trackName: string; artistName: string; playCount: number; pct: number },
  tasteProfile: TasteProfile
): string {
  const topGenres = Object.entries(tasteProfile.genreDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g)
    .join(", ");

  return `This user has played "${burnoutTrack.trackName}" by ${burnoutTrack.artistName} ${burnoutTrack.playCount} times in the last 3 days — that's ${burnoutTrack.pct}% of ALL their listening. Classic burnout territory.

Their broader taste:
- Artists they love: ${tasteProfile.topArtists.slice(0, 8).map((a) => a.name).join(", ")}
- Genres: ${topGenres}

Find them ONE perfect "Sonic Palate Cleanser" — a real Spotify track that:
1. Shares musical DNA with "${burnoutTrack.trackName}" (similar energy, mood, or emotional texture)
2. But is different enough to break the loop (different artist, shifted genre, new sonic texture)
3. Feels like a refreshing twist, not an abrupt change

Return ONLY valid JSON:
{
  "cleanser": {
    "trackName": "real Spotify track name",
    "artistName": "real artist name",
    "sharedDNA": "What sonic quality it shares with the overplayed track (be specific: tempo, mood, texture, chord quality)",
    "freshElement": "What makes it feel refreshingly different",
    "reasoning": "1-2 sentence explanation of why this is the perfect reset track for them"
  },
  "burnoutInsight": "A witty, warm, non-judgmental 1-sentence observation about playing a song ${burnoutTrack.playCount} times in 3 days"
}`;
}

export function buildDiscoverPrompt(
  tasteProfile: TasteProfile,
  patterns: {
    peakHour: number;
    peakDay: string;
    topHours: { hour: number; count: number }[];
    topDays: { day: string; count: number }[];
    totalPlays: number;
    uniqueTracks: number;
  },
  hiddenGems: { trackName: string; artistName: string; popularity: number; playCount: number }[],
  shortTermArtists: string[],
  longTermArtists: string[]
): string {
  const newArtists = shortTermArtists.filter((a) => !longTermArtists.includes(a)).slice(0, 5);
  const loyalArtists = shortTermArtists.filter((a) => longTermArtists.includes(a)).slice(0, 5);
  const timeLabel = (h: number) =>
    h < 6 ? "late night" : h < 12 ? "morning" : h < 18 ? "afternoon" : h < 22 ? "evening" : "night";

  return `You are analyzing someone's Spotify listening data to write a deeply personal music story about them. Be specific, surprising, and insightful — not generic. Reference their actual artists and patterns.

TASTE PROFILE:
- Top artists: ${tasteProfile.topArtists.slice(0, 15).map((a) => `${a.name} (${a.genres.slice(0, 2).join(", ")})`).join("; ")}
- Top tracks: ${tasteProfile.topTracks.slice(0, 10).map((t) => `"${t.name}" by ${t.artist}`).join("; ")}
- Top genres: ${Object.entries(tasteProfile.genreDistribution).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g).join(", ")}

LISTENING PATTERNS:
- Total plays analyzed: ${patterns.totalPlays}
- Unique tracks in rotation: ${patterns.uniqueTracks}
- Peak listening hour: ${patterns.peakHour}:00 (${timeLabel(patterns.peakHour)})
- Peak day: ${patterns.peakDay}
- Top listening hours: ${patterns.topHours.slice(0, 4).map((h) => `${h.hour}:00 (${h.count} plays)`).join(", ")}

HIDDEN GEMS (tracks they love that most people haven't heard):
${hiddenGems.length > 0 ? hiddenGems.map((g) => `- "${g.trackName}" by ${g.artistName} (popularity: ${g.popularity}/100, played ${g.playCount}x)`).join("\n") : "- No low-popularity tracks found — they may lean mainstream"}

TASTE EVOLUTION:
- Artists NEW in recent rotation (last 4 weeks): ${newArtists.length ? newArtists.join(", ") : "Stable — no major new artists"}
- Artists they've stayed loyal to over time: ${loyalArtists.length ? loyalArtists.join(", ") : "Constantly evolving taste"}

Return ONLY valid JSON:
{
  "archetype": {
    "name": "3-4 word unique archetype (e.g. 'The Late-Night Excavator', 'The Genre Shapeshifter', 'The Loyal Wanderer')",
    "tagline": "One punchy sentence that captures their music identity",
    "description": "2-3 sentences that feel like a journalist who really knows them. Reference specific artists and patterns. Make it surprising.",
    "traits": ["Trait 1", "Trait 2", "Trait 3", "Trait 4"]
  },
  "listeningStory": "2-3 sentences about WHEN and HOW they listen — time of day, day of week, what this says about their lifestyle. Be specific.",
  "evolutionNarrative": "2-3 sentences about how their taste has shifted — what they've gravitated toward, what they've stayed loyal to, what this suggests about them as a person.",
  "hiddenGemInsight": "1-2 sentences about what their relationship with obscure vs mainstream music reveals about them."
}`;
}

export function buildArtistDivePrompt(
  artistName: string,
  tasteProfile: TasteProfile
): string {
  return `Create a personalized exploration guide for the artist "${artistName}" tailored to this listener.

Their taste profile:
- Top genres: ${Object.entries(tasteProfile.genreDistribution).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([g]) => g).join(", ")}
- Top artists they already love: ${tasteProfile.topArtists.slice(0, 8).map((a) => a.name).join(", ")}

Create a curated path through ${artistName}'s music that feels like a knowledgeable friend guiding them. Include:
- The perfect starting point for someone with their taste
- 2-3 essential tracks that define the artist
- 1-2 deep cuts most fans miss
- The best album to start with and why

Return ONLY valid JSON:
{
  "artistName": "${artistName}",
  "hook": "One sentence on why this artist fits their taste specifically",
  "startingPoint": { "trackName": "...", "reason": "..." },
  "essentials": [{ "trackName": "...", "note": "..." }, { "trackName": "...", "note": "..." }],
  "deepCuts": [{ "trackName": "...", "note": "..." }],
  "bestAlbum": { "albumName": "...", "reason": "..." },
  "vibe": "2-sentence description of what makes this artist special and what era/mood of theirs to explore first"
}`;
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
