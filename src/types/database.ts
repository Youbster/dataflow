export interface UserProfile {
  id: string;
  spotify_id: string;
  display_name: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  spotify_product: string | null;
  country: string | null;
  is_public: boolean;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  spotify_refresh_token_encrypted: string | null;
  spotify_access_token_encrypted: string | null;
  token_expires_at: string | null;
  sync_frequency_minutes: number;
  notification_staleness: boolean;
  notification_new_recommendations: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserTopTrack {
  id: string;
  user_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_names: string[];
  artist_ids: string[];
  album_name: string | null;
  album_image_url: string | null;
  duration_ms: number | null;
  preview_url: string | null;
  popularity: number | null;
  time_range: "short_term" | "medium_term" | "long_term";
  rank: number;
  fetched_at: string;
}

export interface UserTopArtist {
  id: string;
  user_id: string;
  spotify_artist_id: string;
  artist_name: string;
  genres: string[];
  image_url: string | null;
  popularity: number | null;
  follower_count: number | null;
  time_range: "short_term" | "medium_term" | "long_term";
  rank: number;
  fetched_at: string;
}

export interface UserListeningHistory {
  id: string;
  user_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_names: string[];
  album_name: string | null;
  album_image_url: string | null;
  played_at: string;
  context_type: string | null;
  context_uri: string | null;
}

export interface GeneratedPlaylist {
  id: string;
  user_id: string;
  spotify_playlist_id: string | null;
  name: string;
  description: string | null;
  prompt_used: string;
  claude_reasoning: string | null;
  mood_tags: string[] | null;
  track_count: number;
  is_saved_to_spotify: boolean;
  cover_image_url: string | null;
  created_at: string;
}

export interface PlaylistTrack {
  id: string;
  playlist_id: string;
  spotify_track_id: string;
  track_name: string;
  artist_names: string[];
  album_name: string | null;
  album_image_url: string | null;
  duration_ms: number | null;
  position: number;
  claude_note: string | null;
  created_at: string;
}

export interface UserFollower {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface SharedDashboard {
  id: string;
  user_id: string;
  share_id: string;
  title: string;
  description: string | null;
  snapshot_data: Record<string, unknown>;
  time_range: string;
  is_active: boolean;
  view_count: number;
  expires_at: string | null;
  created_at: string;
}

export interface UserSyncStatus {
  id: string;
  user_id: string;
  last_top_items_sync: string | null;
  last_history_sync: string | null;
  last_history_cursor: string | null;
  sync_in_progress: boolean;
  last_sync_error: string | null;
  total_history_records: number;
  created_at: string;
  updated_at: string;
}
