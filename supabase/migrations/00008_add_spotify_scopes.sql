-- Add spotify_scopes to track which Spotify OAuth scopes the stored token has.
-- Populated on token refresh and on the reconnect flow.
-- Used to pre-flight check playlist write access before touching Spotify.
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS spotify_scopes TEXT;
