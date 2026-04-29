import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSpotifyClient } from "@/lib/spotify/client";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { playlistId, name, description, trackUris } = await request.json();

    const admin = createAdminClient();
    const { data: profile } = await admin
      .from("user_profiles")
      .select("spotify_id")
      .eq("id", user.id)
      .single();

    if (!profile?.spotify_id) {
      return NextResponse.json(
        { error: "Spotify profile not found" },
        { status: 404 }
      );
    }

    const spotify = createSpotifyClient(user.id);

    const playlist = await spotify.createPlaylist(
      profile.spotify_id,
      name,
      description || ""
    );

    await spotify.addTracksToPlaylist(playlist.id, trackUris);

    if (playlistId) {
      await admin
        .from("generated_playlists")
        .update({
          spotify_playlist_id: playlist.id,
          is_saved_to_spotify: true,
        })
        .eq("id", playlistId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({
      spotifyPlaylistId: playlist.id,
      url: playlist.external_urls.spotify,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create playlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
