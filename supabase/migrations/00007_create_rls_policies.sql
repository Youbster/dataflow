ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_top_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_top_artists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_listening_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sync_status ENABLE ROW LEVEL SECURITY;

-- user_profiles
CREATE POLICY "Users can read own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Public profiles are readable"
  ON public.user_profiles FOR SELECT
  USING (is_public = true);

CREATE POLICY "Users can update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- user_preferences (sensitive — owner only)
CREATE POLICY "Users can manage own preferences"
  ON public.user_preferences FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- user_top_tracks
CREATE POLICY "Users can read own top tracks"
  ON public.user_top_tracks FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own top tracks"
  ON public.user_top_tracks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own top tracks"
  ON public.user_top_tracks FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Public user top tracks are readable"
  ON public.user_top_tracks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = user_top_tracks.user_id AND user_profiles.is_public = true
    )
  );

-- user_top_artists
CREATE POLICY "Users can read own top artists"
  ON public.user_top_artists FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own top artists"
  ON public.user_top_artists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own top artists"
  ON public.user_top_artists FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Public user top artists are readable"
  ON public.user_top_artists FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_profiles.id = user_top_artists.user_id AND user_profiles.is_public = true
    )
  );

-- user_listening_history (private)
CREATE POLICY "Users can manage own listening history"
  ON public.user_listening_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- generated_playlists
CREATE POLICY "Users can manage own playlists"
  ON public.generated_playlists FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- playlist_tracks
CREATE POLICY "Users can manage tracks of own playlists"
  ON public.playlist_tracks FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.generated_playlists
      WHERE generated_playlists.id = playlist_tracks.playlist_id
        AND generated_playlists.user_id = auth.uid()
    )
  );

-- user_followers
CREATE POLICY "Users can see own follow relationships"
  ON public.user_followers FOR SELECT
  USING (auth.uid() = follower_id OR auth.uid() = following_id);

CREATE POLICY "Users can follow others"
  ON public.user_followers FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON public.user_followers FOR DELETE
  USING (auth.uid() = follower_id);

-- shared_dashboards
CREATE POLICY "Users can manage own shared dashboards"
  ON public.shared_dashboards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Active shared dashboards are publicly readable"
  ON public.shared_dashboards FOR SELECT
  USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- user_sync_status
CREATE POLICY "Users can manage own sync status"
  ON public.user_sync_status FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
