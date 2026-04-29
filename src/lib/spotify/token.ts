import crypto from "crypto";
import { SPOTIFY_TOKEN_URL } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SpotifyTokenResponse } from "@/types/spotify";

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

export async function getValidSpotifyToken(userId: string): Promise<string> {
  const supabase = createAdminClient();

  const { data: prefs } = await supabase
    .from("user_preferences")
    .select(
      "spotify_access_token_encrypted, spotify_refresh_token_encrypted, token_expires_at"
    )
    .eq("user_id", userId)
    .single();

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
    return decrypt(prefs.spotify_access_token_encrypted);
  }

  const refreshToken = decrypt(prefs.spotify_refresh_token_encrypted);
  const tokenResponse = await refreshSpotifyToken(refreshToken);

  const newAccessTokenEncrypted = encrypt(tokenResponse.access_token);
  const newExpiresAt = new Date(
    Date.now() + tokenResponse.expires_in * 1000
  ).toISOString();

  const updateData: Record<string, string> = {
    spotify_access_token_encrypted: newAccessTokenEncrypted,
    token_expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  };

  if (tokenResponse.refresh_token) {
    updateData.spotify_refresh_token_encrypted = encrypt(
      tokenResponse.refresh_token
    );
  }

  await supabase
    .from("user_preferences")
    .update(updateData)
    .eq("user_id", userId);

  return tokenResponse.access_token;
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
