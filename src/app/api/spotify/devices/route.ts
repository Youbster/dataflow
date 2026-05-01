import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidSpotifyToken } from "@/lib/spotify/token";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const token = await getValidSpotifyToken(user.id);
    const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      console.error("[devices] Spotify error", res.status, body);
      // Expose the status so the client can show a useful message
      return NextResponse.json(
        { devices: [], error: res.status, detail: body },
        { status: 200 } // keep 200 so the client handles it gracefully
      );
    }

    // 204 = no active devices
    if (res.status === 204) {
      return NextResponse.json({ devices: [] });
    }

    const data = await res.json();
    console.log("[devices]", data.devices?.length ?? 0, "device(s) found");
    return NextResponse.json({ devices: data.devices ?? [] });
  } catch (err) {
    console.error("[devices] exception:", err);
    return NextResponse.json({ devices: [] });
  }
}
