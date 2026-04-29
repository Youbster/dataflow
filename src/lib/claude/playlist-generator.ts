import { claude, FAST_MODEL } from "./client";
import {
  MUSIC_EXPERT_SYSTEM,
  buildPlaylistPrompt,
  buildTasteProfile,
} from "./prompts";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSpotifyClient } from "@/lib/spotify/client";

interface GeneratedTrack {
  trackName: string;
  artistName: string;
  reason: string;
  spotifyTrackId?: string;
  spotifyUri?: string;
  albumName?: string;
  albumImageUrl?: string;
  durationMs?: number;
}

export async function generatePlaylist(
  userId: string,
  userPrompt: string,
  trackCount: number = 20
): Promise<{
  tracks: GeneratedTrack[];
  reasoning: string;
  playlistId: string;
}> {
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
  const prompt = buildPlaylistPrompt(tasteProfile, userPrompt, trackCount);

  const response = await claude.messages.create({
    model: FAST_MODEL,
    max_tokens: 4096,
    system: MUSIC_EXPERT_SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  const textContent = response.content.find((c) => c.type === "text");
  const jsonMatch = textContent?.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse Claude response");

  const parsed = JSON.parse(jsonMatch[0]) as {
    tracks: Array<{ trackName: string; artistName: string; reason: string }>;
  };

  const spotify = createSpotifyClient(userId);
  const verifiedTracks: GeneratedTrack[] = [];

  for (const track of parsed.tracks) {
    try {
      const searchResult = await spotify.searchTracks(
        `track:${track.trackName} artist:${track.artistName}`,
        1
      );
      const found = searchResult.tracks.items[0];
      if (found) {
        verifiedTracks.push({
          ...track,
          spotifyTrackId: found.id,
          spotifyUri: found.uri,
          albumName: found.album.name,
          albumImageUrl: found.album.images[0]?.url,
          durationMs: found.duration_ms,
        });
      }
    } catch {
      // Track not found on Spotify — skip
    }
  }

  const { data: playlist } = await supabase
    .from("generated_playlists")
    .insert({
      user_id: userId,
      name: `AI: ${userPrompt.slice(0, 60)}`,
      description: `Generated based on: "${userPrompt}"`,
      prompt_used: userPrompt,
      claude_reasoning: textContent?.text.slice(0, 2000),
      mood_tags: extractMoodTags(userPrompt),
      track_count: verifiedTracks.length,
    })
    .select("id")
    .single();

  if (playlist && verifiedTracks.length > 0) {
    const trackRows = verifiedTracks.map((t, i) => ({
      playlist_id: playlist.id,
      spotify_track_id: t.spotifyTrackId!,
      track_name: t.trackName,
      artist_names: [t.artistName],
      album_name: t.albumName ?? null,
      album_image_url: t.albumImageUrl ?? null,
      duration_ms: t.durationMs ?? null,
      position: i + 1,
      claude_note: t.reason,
    }));

    await supabase.from("playlist_tracks").insert(trackRows);
  }

  return {
    tracks: verifiedTracks,
    reasoning: textContent?.text || "",
    playlistId: playlist?.id || "",
  };
}

function extractMoodTags(prompt: string): string[] {
  const moods = [
    "chill", "energetic", "happy", "sad", "focus", "workout",
    "party", "romantic", "melancholy", "upbeat", "dark", "dreamy",
    "aggressive", "peaceful", "nostalgic", "summer", "rainy",
  ];
  const lower = prompt.toLowerCase();
  return moods.filter((m) => lower.includes(m));
}
