import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidSpotifyToken } from "@/lib/spotify/token";

const BASE = "https://api.spotify.com/v1/me/player";

async function spotifyFetch(url: string, token: string, options: RequestInit = {}) {
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = await getValidSpotifyToken(user.id);
    const res = await spotifyFetch(BASE, token);
    if (res.status === 204) return NextResponse.json(null);
    if (!res.ok) {
      const body = await res.text();
      console.error("[player GET]", res.status, body);
      return NextResponse.json({ error: res.status, detail: body }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    console.error("[player GET] exception:", err);
    return NextResponse.json(null);
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await request.json().catch(() => ({}));
  const { action, trackId, uris, device_id } = payload;

  try {
    const token = await getValidSpotifyToken(user.id);

    let url = "";
    let method = "PUT";
    let fetchBody: string | undefined;

    switch (action) {
      case "play":
        url = `${BASE}/play`;
        if (trackId) fetchBody = JSON.stringify({ uris: [`spotify:track:${trackId}`] });
        break;

      case "play_uris":
        if (!Array.isArray(uris) || uris.length === 0) {
          return NextResponse.json({ error: "uris required" }, { status: 400 });
        }
        url = `${BASE}/play${device_id ? `?device_id=${encodeURIComponent(device_id)}` : ""}`;
        fetchBody = JSON.stringify({ uris });
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

    const res = await spotifyFetch(url, token, { method, body: fetchBody });

    if (res.status === 403) {
      const body = await res.text();
      const isPremium = body.toLowerCase().includes("premium");
      return NextResponse.json(
        { error: isPremium ? "premium_required" : "scope_missing" },
        { status: 403 }
      );
    }
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
