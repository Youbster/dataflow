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
    if (!res.ok) return NextResponse.json({ devices: [] });
    const data = await res.json();
    return NextResponse.json({ devices: data.devices ?? [] });
  } catch {
    return NextResponse.json({ devices: [] });
  }
}
