import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidSpotifyToken, invalidateTokenCache } from "@/lib/spotify/token";
import { SPOTIFY_API_BASE } from "@/lib/constants";

class SpotifyApiError extends Error {
  status: number;
  body: string;
  url: string;

  constructor(status: number, body: string, url: string) {
    super(`SPOTIFY_${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

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
    throw new SpotifyApiError(res.status, body, url);
  }
  return res.status === 204 ? null : res.json();
}

function cleanTrackUris(trackUris: unknown): string[] {
  if (!Array.isArray(trackUris)) return [];

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const uri of trackUris) {
    if (typeof uri !== "string") continue;
    if (!/^spotify:track:[A-Za-z0-9]+$/.test(uri)) continue;
    if (seen.has(uri)) continue;
    seen.add(uri);
    cleaned.push(uri);
  }
  return cleaned;
}

async function addTracksToSpotifyPlaylist(
  playlistId: string,
  trackUris: string[],
  token: string,
) {
  const batchSize = 100;
  for (let i = 0; i < trackUris.length; i += batchSize) {
    await spotifyFetch(`/playlists/${playlistId}/items`, token, {
      method: "POST",
      body: JSON.stringify({ uris: trackUris.slice(i, i + batchSize) }),
    });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { playlistId, name, description, trackUris } = await request.json();
    const playableUris = cleanTrackUris(trackUris);

    if (playableUris.length === 0) {
      return NextResponse.json(
        {
          error: "This generated playlist has no verified Spotify tracks to save. Generate a new playlist and try again.",
          code: "no_playable_tracks",
        },
        { status: 400 }
      );
    }

    // ── Pre-flight scope check — avoids creating an empty playlist we can't fill ──
    // getValidSpotifyToken may have just refreshed and stored fresh scopes, so query now.
    const admin = createAdminClient();
    const { data: prefs } = await admin
      .from("user_preferences")
      .select("spotify_scopes")
      .eq("user_id", user.id)
      .single();

    let canCreatePrivate = true;
    let canCreatePublic = true;

    if (prefs?.spotify_scopes) {
      const granted = prefs.spotify_scopes.split(" ");
      canCreatePrivate = granted.includes("playlist-modify-private");
      canCreatePublic = granted.includes("playlist-modify-public");
      if (!canCreatePrivate && !canCreatePublic) {
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
      invalidateTokenCache(user.id);
    }
    let token = await getValidSpotifyToken(user.id);

    // Use /me/playlists — simpler and avoids user ID mismatch issues
    const makePublic = !canCreatePrivate && canCreatePublic;
    const playlist = await spotifyFetch("/me/playlists", token, {
      method: "POST",
      body: JSON.stringify({ name, description: description || "", public: makePublic }),
    }) as { id: string; external_urls: { spotify: string } };

    // Add tracks — if this fails, delete the empty playlist so Spotify stays clean
    try {
      try {
        await addTracksToSpotifyPlaylist(playlist.id, playableUris, token);
      } catch (trackErr) {
        if (trackErr instanceof SpotifyApiError && trackErr.status === 403) {
          invalidateTokenCache(user.id);
          token = await getValidSpotifyToken(user.id);
          await addTracksToSpotifyPlaylist(playlist.id, playableUris, token);
        } else {
          throw trackErr;
        }
      }
    } catch (trackErr) {
      // Best-effort cleanup: unfollow (delete) the empty playlist before re-throwing
      try {
        await spotifyFetch(`/playlists/${playlist.id}/followers`, token, { method: "DELETE" });
      } catch { /* ignore cleanup error */ }

      if (trackErr instanceof SpotifyApiError) {
        return NextResponse.json(
          {
            error: "Spotify created the playlist, but rejected adding the tracks.",
            code: "track_add_failed",
            detail: trackErr.body,
            spotifyStatus: trackErr.status,
          },
          { status: 502 }
        );
      }

      throw trackErr;
    }

    if (playlistId) {
      await admin
        .from("generated_playlists")
        .update({ spotify_playlist_id: playlist.id, is_saved_to_spotify: true })
        .eq("id", playlistId)
        .eq("user_id", user.id);
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
