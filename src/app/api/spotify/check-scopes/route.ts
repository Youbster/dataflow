import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidSpotifyToken } from "@/lib/spotify/token";
import { SPOTIFY_API_BASE } from "@/lib/constants";

/**
 * GET /api/spotify/check-scopes
 * Returns the scopes the current token actually has by calling /me
 * and attempting a GET /me/playlists. Used to diagnose 403 errors.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = await getValidSpotifyToken(session.user.id);

    // Call /me — check basic token validity
    const meRes = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meBody = await meRes.text();

    if (!meRes.ok) {
      return NextResponse.json({ step: "GET /me", status: meRes.status, body: meBody });
    }

    const me = JSON.parse(meBody) as { id: string; display_name: string };

    // Try GET /me/playlists — requires playlist-read-private
    const plRes = await fetch(`${SPOTIFY_API_BASE}/me/playlists?limit=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const plBody = await plRes.text();

    return NextResponse.json({
      user: me.id,
      displayName: me.display_name,
      getPlaylists: { status: plRes.status, ok: plRes.ok, body: plRes.ok ? "(ok)" : plBody },
      tokenPreview: `${token.slice(0, 8)}…`,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
