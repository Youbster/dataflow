import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidSpotifyToken } from "@/lib/spotify/token";

const BASE = "https://api.spotify.com/v1/me/player";

async function spotifyFetch(url: string, token: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers },
  });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = await getValidSpotifyToken(user.id);
    const res = await spotifyFetch(BASE, token);
    if (res.status === 204) return NextResponse.json(null); // nothing playing
    if (!res.ok) return NextResponse.json(null);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(null);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action, trackId } = await request.json().catch(() => ({}));

  try {
    const token = await getValidSpotifyToken(user.id);

    let url = "";
    let method = "PUT";
    let body: string | undefined;

    switch (action) {
      case "play":
        url = `${BASE}/play`;
        if (trackId) body = JSON.stringify({ uris: [`spotify:track:${trackId}`] });
        break;
      case "pause":
        url = `${BASE}/pause`;
        break;
      case "next":
        url = `${BASE}/next`;
        method = "POST";
        break;
      case "previous":
        url = `${BASE}/previous`;
        method = "POST";
        break;
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const res = await spotifyFetch(url, token, { method, body });
    if (res.status === 403) return NextResponse.json({ error: "scope_missing" }, { status: 403 });
    if (!res.ok && res.status !== 204) {
      const err = await res.text();
      return NextResponse.json({ error: err }, { status: res.status });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Playback control failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
