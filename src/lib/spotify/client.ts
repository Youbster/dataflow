import { SPOTIFY_API_BASE } from "@/lib/constants";
import { getValidSpotifyToken } from "./token";
import { rateLimiter } from "./rate-limiter";
import type {
  SpotifyTrack,
  SpotifyArtist,
  SpotifyRecentlyPlayed,
  SpotifyTopItems,
  SpotifySearchResult,
  SpotifyPlaylist,
  SpotifyUser,
} from "@/types/spotify";

class SpotifyClient {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await rateLimiter.acquire();
    const token = await getValidSpotifyToken(this.userId);

    const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get("Retry-After") || "5",
        10
      );
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfter * 1000)
      );
      return this.request<T>(endpoint, options);
    }

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Spotify API error ${response.status}: ${error}`
      );
    }

    return response.json();
  }

  async getMe(): Promise<SpotifyUser> {
    return this.request<SpotifyUser>("/me");
  }

  async getTopTracks(
    timeRange: string,
    limit: number = 50
  ): Promise<SpotifyTopItems<SpotifyTrack>> {
    return this.request<SpotifyTopItems<SpotifyTrack>>(
      `/me/top/tracks?time_range=${timeRange}&limit=${limit}`
    );
  }

  async getTopArtists(
    timeRange: string,
    limit: number = 50
  ): Promise<SpotifyTopItems<SpotifyArtist>> {
    return this.request<SpotifyTopItems<SpotifyArtist>>(
      `/me/top/artists?time_range=${timeRange}&limit=${limit}`
    );
  }

  async getRecentlyPlayed(
    limit: number = 50,
    after?: string
  ): Promise<SpotifyRecentlyPlayed> {
    let url = `/me/player/recently-played?limit=${limit}`;
    if (after) url += `&after=${after}`;
    return this.request<SpotifyRecentlyPlayed>(url);
  }

  async searchTracks(query: string, limit: number = 5): Promise<SpotifySearchResult> {
    const encoded = encodeURIComponent(query);
    return this.request<SpotifySearchResult>(
      `/search?q=${encoded}&type=track&limit=${limit}`
    );
  }

  async createPlaylist(
    spotifyUserId: string,
    name: string,
    description: string
  ): Promise<SpotifyPlaylist> {
    return this.request<SpotifyPlaylist>(`/users/${spotifyUserId}/playlists`, {
      method: "POST",
      body: JSON.stringify({ name, description, public: false }),
    });
  }

  async addTracksToPlaylist(
    playlistId: string,
    trackUris: string[]
  ): Promise<void> {
    const batchSize = 100;
    for (let i = 0; i < trackUris.length; i += batchSize) {
      const batch = trackUris.slice(i, i + batchSize);
      await this.request(`/playlists/${playlistId}/tracks`, {
        method: "POST",
        body: JSON.stringify({ uris: batch }),
      });
    }
  }
}

export function createSpotifyClient(userId: string): SpotifyClient {
  return new SpotifyClient(userId);
}
