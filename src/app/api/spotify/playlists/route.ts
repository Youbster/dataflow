import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidSpotifyToken } from "@/lib/spotify/token";
import { SPOTIFY_API_BASE } from "@/lib/constants";

async function spotifyFetch(url: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${SPOTIFY_API_BASE}${url}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const error = await res.text();
    if (res.status === 403) {
      // Almost always means the token lacks playlist scopes — user must reconnect
      throw new Error("SCOPE_MISSING");
    }
    throw new Error(`Spotify API error ${res.status}: ${error}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const token = await getValidSpotifyToken(session.user.id);
    const { playlistId, name, description, trackUris } = await request.json();

    const admin = createAdminClient();

    const { data: profile } = await admin
      .from("user_profiles")
      .select("spotify_id")
      .eq("id", session.user.id)
      .single();

    const spotifyUserId =
      profile?.spotify_id ??
      ((await spotifyFetch("/me", token)) as { id: string }).id;

    const playlist = await spotifyFetch(`/users/${spotifyUserId}/playlists`, token, {
      method: "POST",
      body: JSON.stringify({ name, description: description || "", public: false }),
    }) as { id: string; external_urls: { spotify: string } };

    const batchSize = 100;
    for (let i = 0; i < trackUris.length; i += batchSize) {
      await spotifyFetch(`/playlists/${playlist.id}/tracks`, token, {
        method: "POST",
        body: JSON.stringify({ uris: trackUris.slice(i, i + batchSize) }),
      });
    }

    if (playlistId) {
      await admin
        .from("generated_playlists")
        .update({
          spotify_playlist_id: playlist.id,
          is_saved_to_spotify: true,
        })
        .eq("id", playlistId)
        .eq("user_id", session.user.id);
    }

    return NextResponse.json({
      spotifyPlaylistId: playlist.id,
      url: playlist.external_urls.spotify,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create playlist";
    if (message === "SCOPE_MISSING") {
      return NextResponse.json(
        { error: "Spotify playlist access not granted. Reconnect your Spotify account in Settings to fix this.", code: "scope_missing" },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
