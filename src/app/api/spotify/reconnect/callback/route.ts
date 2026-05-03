import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, invalidateTokenCache, primeTokenCache } from "@/lib/spotify/token";

/**
 * Handles the Spotify OAuth callback for the reconnect flow.
 * Exchanges the auth code for fresh tokens and stores them directly,
 * bypassing Supabase's session — guarantees tokens with the correct scopes.
 *
 * GET /api/spotify/reconnect/callback
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(`${origin}/settings?reconnect=failed`);
  }

  // Decode state to get userId
  let userId: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    userId = parsed.userId as string;
    if (!userId) throw new Error("missing userId");
  } catch {
    return NextResponse.redirect(`${origin}/settings?reconnect=failed`);
  }

  // Exchange auth code for tokens directly with Spotify
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:   "authorization_code",
      code,
      redirect_uri: `${origin}/api/spotify/reconnect/callback`,
      client_id:    process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("[reconnect] Spotify token exchange failed:", err);
    return NextResponse.redirect(`${origin}/settings?reconnect=failed`);
  }

  const { access_token, refresh_token, expires_in, scope } = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };

  // Log granted scopes (visible in Vercel function logs)
  console.log("[reconnect] Granted scopes:", scope);

  // Store fresh tokens AND the granted scope list — this overwrites whatever was there before
  const admin = createAdminClient();
  const updateData: Record<string, string> = {
    user_id:                         userId,
    spotify_access_token_encrypted:  encrypt(access_token),
    token_expires_at:                new Date(Date.now() + expires_in * 1000).toISOString(),
    spotify_scopes:                  scope,
    updated_at:                      new Date().toISOString(),
  };

  if (refresh_token) {
    updateData.spotify_refresh_token_encrypted = encrypt(refresh_token);
  }

  await admin.from("user_preferences").upsert(
    updateData,
    { onConflict: "user_id" }
  );

  invalidateTokenCache(userId);
  primeTokenCache(userId, access_token, Date.now() + expires_in * 1000);

  return NextResponse.redirect(`${origin}/settings?reconnect=success`);
}
