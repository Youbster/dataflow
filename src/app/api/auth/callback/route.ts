import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { encrypt } from "@/lib/spotify/token";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const session = data.session;
  const providerToken = session.provider_token;
  const providerRefreshToken = session.provider_refresh_token;

  if (providerToken && providerRefreshToken) {
    try {
      const spotifyProfile = await fetch("https://api.spotify.com/v1/me", {
        headers: { Authorization: `Bearer ${providerToken}` },
      }).then((r) => r.json());

      const admin = createAdminClient();

      await admin.from("user_profiles").upsert(
        {
          id: session.user.id,
          spotify_id: spotifyProfile.id,
          display_name:
            spotifyProfile.display_name || spotifyProfile.id,
          email: spotifyProfile.email,
          avatar_url: spotifyProfile.images?.[0]?.url ?? null,
          spotify_product: spotifyProfile.product,
          country: spotifyProfile.country,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

      const encryptedRefreshToken = encrypt(providerRefreshToken);
      const encryptedAccessToken = encrypt(providerToken);

      await admin.from("user_preferences").upsert(
        {
          user_id: session.user.id,
          spotify_refresh_token_encrypted: encryptedRefreshToken,
          spotify_access_token_encrypted: encryptedAccessToken,
          token_expires_at: new Date(
            Date.now() + 3600 * 1000
          ).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      await admin.from("user_sync_status").upsert(
        {
          user_id: session.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    } catch (err) {
      console.error("Error during OAuth callback setup:", err);
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}
