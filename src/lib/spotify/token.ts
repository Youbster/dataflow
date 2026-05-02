import crypto from "crypto";
import { SPOTIFY_TOKEN_URL } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SpotifyTokenResponse } from "@/types/spotify";

// ─── In-process token cache ───────────────────────────────────────────────────
// Serverless function instances are short-lived but may handle several
// concurrent requests. Without this, every Spotify API call triggers a
// separate Supabase DB query — 20 parallel calls = 20 DB hits = 2-4s wasted.
//
// Two-layer defence:
//   1. Resolved cache (TOKEN_CACHE): return immediately if token is valid.
//   2. In-flight dedup (TOKEN_INFLIGHT): if a refresh is already in progress,
//      wait for it instead of issuing a second DB query / token refresh.

const TOKEN_CACHE = new Map<string, { token: string; expiresAt: number }>();
const TOKEN_INFLIGHT = new Map<string, Promise<string>>();

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string");
  }
  return Buffer.from(key, "hex");
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Seed the in-process cache with a known-good token.
 * Called from the API route with session.provider_token (Spotify token stored
 * in the Supabase session cookie right after OAuth). This lets the first
 * Spotify call in a request skip the Supabase DB query entirely.
 */
export function primeTokenCache(
  userId: string,
  token: string,
  expiresAtMs: number,
): void {
  // Only prime if the token has at least 90 seconds of life left
  if (expiresAtMs > Date.now() + 90_000) {
    TOKEN_CACHE.set(userId, { token, expiresAt: expiresAtMs });
  }
}

/**
 * Evict a user's token from the cache.
 * Called by SpotifyClient when Spotify returns 401 so the next call
 * fetches a fresh token from DB.
 */
export function invalidateTokenCache(userId: string): void {
  TOKEN_CACHE.delete(userId);
  TOKEN_INFLIGHT.delete(userId);
}

export async function getValidSpotifyToken(userId: string): Promise<string> {
  // 1. Check resolved cache — valid for 4 minutes (token lifetime is ~1 hour)
  const cached = TOKEN_CACHE.get(userId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  // 2. Deduplicate in-flight fetches — if a DB/refresh call is already
  //    running for this user, wait for it rather than spawning a duplicate.
  const inflight = TOKEN_INFLIGHT.get(userId);
  if (inflight) return inflight;

  const promise = (async (): Promise<string> => {
    try {
      const supabase = createAdminClient();

      // Wrap the DB query with an 8-second timeout.
      // Without this, a slow/paused Supabase free-tier project hangs the
      // entire serverless function for 30 s (the Vercel function timeout).
      const queryPromise = supabase
        .from("user_preferences")
        .select(
          "spotify_access_token_encrypted, spotify_refresh_token_encrypted, token_expires_at"
        )
        .eq("user_id", userId)
        .single();

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Supabase token fetch timed out (8 s)")), 8_000)
      );

      const { data: prefs } = await Promise.race([queryPromise, timeoutPromise]);

      if (!prefs?.spotify_refresh_token_encrypted) {
        throw new Error("No Spotify refresh token found for user");
      }

      const expiresAt = prefs.token_expires_at
        ? new Date(prefs.token_expires_at)
        : new Date(0);
      const bufferMs = 5 * 60 * 1000;

      if (
        prefs.spotify_access_token_encrypted &&
        expiresAt.getTime() > Date.now() + bufferMs
      ) {
        const token = decrypt(prefs.spotify_access_token_encrypted);
        TOKEN_CACHE.set(userId, { token, expiresAt: expiresAt.getTime() });
        return token;
      }

      // Token expired — refresh it
      const refreshToken = decrypt(prefs.spotify_refresh_token_encrypted);
      const tokenResponse = await refreshSpotifyToken(refreshToken);

      const newAccessTokenEncrypted = encrypt(tokenResponse.access_token);
      const newExpiresAt = new Date(
        Date.now() + tokenResponse.expires_in * 1000
      ).toISOString();

      const updateData: Record<string, string> = {
        spotify_access_token_encrypted: newAccessTokenEncrypted,
        token_expires_at:               newExpiresAt,
        updated_at:                     new Date().toISOString(),
      };

      if (tokenResponse.refresh_token) {
        updateData.spotify_refresh_token_encrypted = encrypt(tokenResponse.refresh_token);
      }
      if (tokenResponse.scope) {
        updateData.spotify_scopes = tokenResponse.scope;
      }

      await supabase
        .from("user_preferences")
        .update(updateData)
        .eq("user_id", userId);

      // Cache for just under the token's actual lifetime
      TOKEN_CACHE.set(userId, {
        token:     tokenResponse.access_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1000,
      });

      return tokenResponse.access_token;
    } finally {
      TOKEN_INFLIGHT.delete(userId);
    }
  })();

  TOKEN_INFLIGHT.set(userId, promise);
  return promise;
}

async function refreshSpotifyToken(
  refreshToken: string
): Promise<SpotifyTokenResponse> {
  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.SPOTIFY_CLIENT_ID!,
      client_secret: process.env.SPOTIFY_CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spotify token refresh failed: ${error}`);
  }

  return response.json();
}
