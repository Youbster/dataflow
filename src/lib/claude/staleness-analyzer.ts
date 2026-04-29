import { openai, FAST_MODEL } from "./client";
import {
  MUSIC_EXPERT_SYSTEM,
  buildStalenessPrompt,
  buildTasteProfile,
} from "./prompts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSpotifyClient } from "@/lib/spotify/client";

export interface StalenessAlternative {
  trackName: string;
  artistName: string;
  reason: string;
  spotifyTrackId?: string;
  spotifyUri?: string;
  albumImageUrl?: string;
}

export interface StalenessSuggestion {
  staleTrack: string;
  alternatives: StalenessAlternative[];
}

export async function suggestFreshAlternatives(
  userId: string,
  staleTracks: Array<{
    trackName: string;
    artistNames: string[];
    playCount: number;
    stalenessScore: number;
  }>
): Promise<StalenessSuggestion[]> {
  const supabase = createAdminClient();

  const [{ data: topTracks }, { data: topArtists }] = await Promise.all([
    supabase
      .from("user_top_tracks")
      .select("*")
      .eq("user_id", userId)
      .eq("time_range", "medium_term")
      .order("rank"),
    supabase
      .from("user_top_artists")
      .select("*")
      .eq("user_id", userId)
      .eq("time_range", "medium_term")
      .order("rank"),
  ]);

  const tasteProfile = buildTasteProfile(topTracks || [], topArtists || []);
  const prompt = buildStalenessPrompt(staleTracks, tasteProfile);

  const response = await openai.chat.completions.create({
    model: FAST_MODEL,
    max_tokens: 4096,
    messages: [
      { role: "system", content: MUSIC_EXPERT_SYSTEM },
      { role: "user", content: prompt },
    ],
  });

  const text = response.choices[0].message.content ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as {
    suggestions: StalenessSuggestion[];
  };

  const spotify = createSpotifyClient(userId);

  for (const suggestion of parsed.suggestions) {
    for (const alt of suggestion.alternatives) {
      try {
        const result = await spotify.searchTracks(
          `track:${alt.trackName} artist:${alt.artistName}`,
          1
        );
        const found = result.tracks.items[0];
        if (found) {
          alt.spotifyTrackId = found.id;
          alt.spotifyUri = found.uri;
          alt.albumImageUrl = found.album.images[0]?.url;
        }
      } catch {
        // Skip unverified tracks
      }
    }
    suggestion.alternatives = suggestion.alternatives.filter(
      (a) => a.spotifyTrackId
    );
  }

  return parsed.suggestions;
}
