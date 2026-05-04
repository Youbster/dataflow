import { SPOTIFY_API_BASE } from "@/lib/constants";
import { getValidSpotifyToken, invalidateTokenCache } from "./token";
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
    options: RequestInit = {},
    isRetry = false,
  ): Promise<T> {
    rateLimiter.acquire(); // sync — never blocks
    const token = await getValidSpotifyToken(this.userId);

    const response = await fetch(`${SPOTIFY_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (response.status === 401 && !isRetry) {
      // Cached token was rejected — evict it and retry once with a fresh DB fetch.
      // This handles the case where session.provider_token was primed into the
      // cache but had already expired by the time we used it.
      invalidateTokenCache(this.userId);
      return this.request<T>(endpoint, options, true);
    }

    if (response.status === 429) {
      const retryAfter = parseInt(
        response.headers.get("Retry-After") || "5",
        10
      );
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfter * 1000)
      );
      return this.request<T>(endpoint, options, isRetry);
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

  /** Find an artist by name — returns their Spotify ID and canonical name, or null. */
  async searchArtist(name: string): Promise<{ id: string; name: string } | null> {
    try {
      const encoded = encodeURIComponent(name);
      const result = await this.request<{
        artists: { items: Array<{ id: string; name: string }> };
      }>(`/search?q=${encoded}&type=artist&limit=3`);
      return result.artists.items[0] ?? null;
    } catch {
      return null;
    }
  }

  /** Get an artist's top tracks. Tries the supplied market first, falls back to US. */
  async getArtistTopTracks(artistId: string, market = "US"): Promise<SpotifyTrack[]> {
    const tryMarket = async (m: string) => {
      try {
        const result = await this.request<{ tracks: SpotifyTrack[] }>(
          `/artists/${artistId}/top-tracks?market=${m}`
        );
        return result.tracks ?? [];
      } catch {
        return [] as SpotifyTrack[];
      }
    };

    const tracks = await tryMarket(market);
    // If the primary market returned nothing, fall back to US
    if (tracks.length === 0 && market !== "US") return tryMarket("US");
    return tracks;
  }

  async getRelatedArtists(artistId: string): Promise<SpotifyArtist[]> {
    try {
      const result = await this.request<{ artists: SpotifyArtist[] }>(
        `/artists/${artistId}/related-artists`
      );
      return result.artists ?? [];
    } catch {
      return [];
    }
  }

  async getRecommendations(params: {
    seedArtists?: string[];
    seedTracks?: string[];
    seedGenres?: string[];
    limit?: number;
    market?: string;
  }): Promise<SpotifyTrack[]> {
    const seedArtists = [...new Set((params.seedArtists ?? []).filter(Boolean))].slice(0, 5);
    const seedTracks = [...new Set((params.seedTracks ?? []).filter(Boolean))].slice(0, 5);
    const seedGenres = [...new Set((params.seedGenres ?? []).filter(Boolean))].slice(0, 5);
    const query = new URLSearchParams();
    if (seedArtists.length > 0) query.set("seed_artists", seedArtists.join(","));
    if (seedTracks.length > 0) query.set("seed_tracks", seedTracks.join(","));
    if (seedGenres.length > 0) query.set("seed_genres", seedGenres.join(","));
    query.set("limit", String(Math.min(params.limit ?? 20, 100)));
    if (params.market) query.set("market", params.market);

    try {
      const result = await this.request<{ tracks: SpotifyTrack[] }>(
        `/recommendations?${query.toString()}`
      );
      return result.tracks ?? [];
    } catch {
      return [];
    }
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

    // Strip common variant suffixes so "Song (feat. X)" matches "Song",
    // "Song - Remastered" matches "Song", "[Radio Edit]" matches the original, etc.
    const stripVariants = (s: string) =>
      s
        .replace(/\s*\([^)]*\)/g, "")   // remove (feat. X), (Remastered 2011), etc.
        .replace(/\s*\[[^\]]*\]/g, "")  // remove [Radio Edit], [Bonus Track], etc.
        .replace(
          /\s*-\s*(remaster|radio|extended|original|club|live|acoustic|demo|instrumental|bonus|single|edit|version|mix).*/i,
          ""
        )
        .trim();

    const artistNorm = normalize(artistName);
    const trackNorm = normalize(trackName);
    const trackNormCore = normalize(stripVariants(trackName));

    function artistMatches(track: SpotifyTrack): boolean {
      return track.artists.some((a) => {
        const n = normalize(a.name);
        // Either direction substring: "&ME" ↔ "me", "A$AP Rocky" ↔ "aap"
        return n.includes(artistNorm) || artistNorm.includes(n);
      });
    }

    function trackMatches(track: SpotifyTrack): boolean {
      const n = normalize(track.name);
      const nCore = normalize(stripVariants(track.name));
      // Full normalized match (substring either direction)
      if (n.includes(trackNorm) || trackNorm.includes(n)) return true;
      // Core match after stripping variants — handles mismatches like
      // AI returns "Song (Original Mix)" but Spotify has "Song", or vice versa
      if (nCore.includes(trackNormCore) || trackNormCore.includes(nCore)) return true;
      return false;
    }

    // Strategy 1: Spotify field-filter search (most precise)
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

    // Strategy 3: stripped track name (catches AI adding remix suffixes the
    // real Spotify track doesn't have, e.g. "Song (Club Mix)" → search "Song")
    if (trackNormCore !== trackNorm) {
      try {
        const r3 = await this.searchTracks(
          `${stripVariants(trackName)} ${artistName}`,
          5
        );
        const match3 = r3.tracks.items.find(
          (t) => artistMatches(t) && trackMatches(t)
        );
        if (match3) return match3;
      } catch {
        /* fall through */
      }
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
