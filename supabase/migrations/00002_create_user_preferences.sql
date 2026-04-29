CREATE TABLE public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  spotify_refresh_token_encrypted TEXT,
  spotify_access_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  sync_frequency_minutes INTEGER DEFAULT 60,
  notification_staleness BOOLEAN DEFAULT true,
  notification_new_recommendations BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_user_preferences_user_id ON public.user_preferences(user_id);
CREATE INDEX idx_user_preferences_token_expires ON public.user_preferences(token_expires_at);
