CREATE TABLE public.escape_pool_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  spotify_track_id TEXT NOT NULL,
  track_name TEXT NOT NULL,
  artist_names TEXT[] NOT NULL DEFAULT '{}',
  artist_ids TEXT[] NOT NULL DEFAULT '{}',
  album_name TEXT,
  album_image_url TEXT,
  duration_ms INTEGER,
  preview_url TEXT,
  popularity INTEGER,
  source TEXT NOT NULL DEFAULT 'sync',
  source_ref TEXT,
  genres TEXT[] NOT NULL DEFAULT '{}',
  mood_tags TEXT[] NOT NULL DEFAULT '{}',
  affinity_score NUMERIC NOT NULL DEFAULT 0,
  novelty_score NUMERIC NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ DEFAULT now(),
  last_recommended_at TIMESTAMPTZ,
  blocked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, spotify_track_id)
);

CREATE INDEX idx_escape_pool_user_scores
  ON public.escape_pool_tracks(user_id, affinity_score DESC, novelty_score DESC, updated_at DESC);

CREATE INDEX idx_escape_pool_user_recent_recommended
  ON public.escape_pool_tracks(user_id, last_recommended_at DESC NULLS FIRST);

CREATE INDEX idx_escape_pool_user_blocked
  ON public.escape_pool_tracks(user_id, blocked_until);

ALTER TABLE public.escape_pool_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own escape pool"
  ON public.escape_pool_tracks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own escape pool"
  ON public.escape_pool_tracks FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can insert own escape pool"
  ON public.escape_pool_tracks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own escape pool"
  ON public.escape_pool_tracks FOR DELETE
  USING (auth.uid() = user_id);
