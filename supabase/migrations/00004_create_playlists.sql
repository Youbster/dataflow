CREATE TABLE public.generated_playlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  spotify_playlist_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  prompt_used TEXT NOT NULL,
  claude_reasoning TEXT,
  mood_tags TEXT[],
  track_count INTEGER NOT NULL DEFAULT 0,
  is_saved_to_spotify BOOLEAN DEFAULT false,
  cover_image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_playlists_user ON public.generated_playlists(user_id, created_at DESC);

CREATE TABLE public.playlist_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id UUID NOT NULL REFERENCES public.generated_playlists(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artist_names TEXT[] NOT NULL,
  album_name TEXT,
  album_image_url TEXT,
  duration_ms INTEGER,
  position INTEGER NOT NULL,
  claude_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_playlist_tracks_playlist ON public.playlist_tracks(playlist_id, position);
