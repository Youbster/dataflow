CREATE TABLE public.user_top_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artist_names TEXT[] NOT NULL,
  artist_ids TEXT[] NOT NULL,
  album_name TEXT,
  album_image_url TEXT,
  duration_ms INTEGER,
  preview_url TEXT,
  popularity INTEGER,
  time_range TEXT NOT NULL CHECK (time_range IN ('short_term', 'medium_term', 'long_term')),
  rank INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, spotify_track_id, time_range)
);

CREATE INDEX idx_top_tracks_user_time ON public.user_top_tracks(user_id, time_range, fetched_at DESC);
CREATE INDEX idx_top_tracks_user_rank ON public.user_top_tracks(user_id, time_range, rank);

CREATE TABLE public.user_top_artists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  spotify_artist_id TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  genres TEXT[] NOT NULL,
  image_url TEXT,
  popularity INTEGER,
  follower_count INTEGER,
  time_range TEXT NOT NULL CHECK (time_range IN ('short_term', 'medium_term', 'long_term')),
  rank INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, spotify_artist_id, time_range)
);

CREATE INDEX idx_top_artists_user_time ON public.user_top_artists(user_id, time_range, fetched_at DESC);

CREATE TABLE public.user_listening_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artist_names TEXT[] NOT NULL,
  album_name TEXT,
  album_image_url TEXT,
  played_at TIMESTAMPTZ NOT NULL,
  context_type TEXT,
  context_uri TEXT,
  UNIQUE(user_id, spotify_track_id, played_at)
);

CREATE INDEX idx_history_user_played ON public.user_listening_history(user_id, played_at DESC);
CREATE INDEX idx_history_user_track ON public.user_listening_history(user_id, spotify_track_id);
