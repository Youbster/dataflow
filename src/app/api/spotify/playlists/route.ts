import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidSpotifyToken, invalidateTokenCache } from "@/lib/spotify/token";
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
    const body = await res.text();
    // Log the real Spotify error so it's visible in Vercel function logs
    console.error(`[playlists] Spotify ${res.status} on ${url}:`, body);
    throw new Error(`SPOTIFY_${res.status}: ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { playlistId, name, description, trackUris } = await request.json();

    // ── Pre-flight scope check — avoids creating an empty playlist we can't fill ──
    // getValidSpotifyToken may have just refreshed and stored fresh scopes, so query now.
    const admin = createAdminClient();
    const { data: prefs } = await admin
      .from("user_preferences")
      .select("spotify_scopes")
      .eq("user_id", session.user.id)
      .single();

    if (prefs?.spotify_scopes) {
      const granted = prefs.spotify_scopes.split(" ");
      const canWrite =
        granted.includes("playlist-modify-public") ||
        granted.includes("playlist-modify-private");
      if (!canWrite) {
        return NextResponse.json(
          {
            error: "Spotify playlist access not granted. Reconnect your Spotify account to fix this.",
            code: "scope_missing",
          },
          { status: 403 }
        );
      }
    }

    // Reconnect may have just written a wider-scope token. Evict any old
    // in-memory token so playlist writes don't reuse a pre-reconnect token.
    if (prefs?.spotify_scopes) {
      invalidateTokenCache(session.user.id);
    }
    const token = await getValidSpotifyToken(session.user.id);

    // Use /me/playlists — simpler and avoids user ID mismatch issues
    const playlist = await spotifyFetch("/me/playlists", token, {
      method: "POST",
      body: JSON.stringify({ name, description: description || "", public: false }),
    }) as { id: string; external_urls: { spotify: string } };

    // Add tracks — if this fails, delete the empty playlist so Spotify stays clean
    const batchSize = 100;
    try {
      for (let i = 0; i < trackUris.length; i += batchSize) {
        await spotifyFetch(`/playlists/${playlist.id}/tracks`, token, {
          method: "POST",
          body: JSON.stringify({ uris: trackUris.slice(i, i + batchSize) }),
        });
      }
    } catch (trackErr) {
      // Best-effort cleanup: unfollow (delete) the empty playlist before re-throwing
      try {
        await spotifyFetch(`/playlists/${playlist.id}/followers`, token, { method: "DELETE" });
      } catch { /* ignore cleanup error */ }
      throw trackErr;
    }

    if (playlistId) {
      await admin
        .from("generated_playlists")
        .update({ spotify_playlist_id: playlist.id, is_saved_to_spotify: true })
        .eq("id", playlistId)
        .eq("user_id", session.user.id);
    }

    return NextResponse.json({
      spotifyPlaylistId: playlist.id,
      url: playlist.external_urls.spotify,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create playlist";

    if (message.startsWith("SPOTIFY_403")) {
      return NextResponse.json(
        {
          error: "Spotify playlist access not granted. Reconnect your Spotify account in Settings.",
          code: "scope_missing",
          detail: message,
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
