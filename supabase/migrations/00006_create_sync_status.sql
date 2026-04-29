CREATE TABLE public.user_sync_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  last_top_items_sync TIMESTAMPTZ,
  last_history_sync TIMESTAMPTZ,
  last_history_cursor TEXT,
  sync_in_progress BOOLEAN DEFAULT false,
  last_sync_error TEXT,
  total_history_records INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sync_status_user ON public.user_sync_status(user_id);
