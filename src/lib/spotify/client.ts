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

  /**
   * Find a specific track by name + artist with artist validation.
   * Uses two strategies so special characters in artist names (e.g. &ME, A$AP)
   * don't silently match the wrong song.
   *
   * Strategy 1: Spotify field-filter search, validate artist from top 5 results.
   * Strategy 2: Plain-text search, same validation (catches &, $, etc. that break filters).
   * Returns null if no validated match is found.
   */
  async findTrack(
    trackName: string,
    artistName: string
  ): Promise<SpotifyTrack | null> {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]/g, "");

    const artistNorm = normalize(artistName);
    const trackNorm = normalize(trackName);

    function artistMatches(track: SpotifyTrack): boolean {
      return track.artists.some((a) => {
        const n = normalize(a.name);
        // Either direction substring: "&ME" ↔ "me", "A$AP Rocky" ↔ "aap"
        return n.includes(artistNorm) || artistNorm.includes(n);
      });
    }

    function trackMatches(track: SpotifyTrack): boolean {
      const n = normalize(track.name);
      // Substring in either direction handles "(feat. X)", "- Remastered", etc.
      return n.includes(trackNorm) || trackNorm.includes(n);
    }

    // Strategy 1: field-filter search (works for most names)
    try {
      const r1 = await this.searchTracks(
        `track:${trackName} artist:${artistName}`,
        5
      );
      const match1 = r1.tracks.items.find(
        (t) => artistMatches(t) && trackMatches(t)
      );
      if (match1) return match1;
    } catch {
      /* fall through */
    }

    // Strategy 2: plain text search (handles special chars like &, $, etc.)
    try {
      const r2 = await this.searchTracks(`${trackName} ${artistName}`, 5);
      const match2 = r2.tracks.items.find(
        (t) => artistMatches(t) && trackMatches(t)
      );
      if (match2) return match2;
    } catch {
      /* fall through */
    }

    return null;
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
