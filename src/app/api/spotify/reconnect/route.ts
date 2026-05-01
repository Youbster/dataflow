import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SPOTIFY_SCOPES } from "@/lib/constants";

/**
 * Initiates a direct Spotify OAuth reconnect — bypasses Supabase's
 * signInWithOAuth so the callback can store fresh tokens unconditionally.
 *
 * GET /api/spotify/reconnect
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  // Encode user ID in `state` so the callback knows whose tokens to update
  const state = Buffer.from(JSON.stringify({ userId: user.id, ts: Date.now() })).toString("base64url");

  const params = new URLSearchParams({
    client_id:     process.env.SPOTIFY_CLIENT_ID!,
    response_type: "code",
    redirect_uri:  `${origin}/api/spotify/reconnect/callback`,
    scope:         SPOTIFY_SCOPES,
    show_dialog:   "true",   // Forces Spotify to show the permissions dialog
    state,
  });

  return NextResponse.redirect(`https://accounts.spotify.com/authorize?${params}`);
}
