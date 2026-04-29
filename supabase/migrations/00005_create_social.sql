CREATE TABLE public.user_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(follower_id, following_id),
  CHECK(follower_id != following_id)
);

CREATE INDEX idx_followers_follower ON public.user_followers(follower_id);
CREATE INDEX idx_followers_following ON public.user_followers(following_id);

CREATE TABLE public.shared_dashboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  share_id TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(12), 'hex'),
  title TEXT DEFAULT 'My Music Dashboard',
  description TEXT,
  snapshot_data JSONB NOT NULL,
  time_range TEXT DEFAULT 'medium_term',
  is_active BOOLEAN DEFAULT true,
  view_count INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_shared_dashboards_share_id ON public.shared_dashboards(share_id);
CREATE INDEX idx_shared_dashboards_user ON public.shared_dashboards(user_id);
