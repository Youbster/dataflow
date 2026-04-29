"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotifyImage } from "@/components/shared/spotify-image";
import { EmptyState } from "@/components/shared/empty-state";
import { Sparkles, Loader2, ExternalLink, Save } from "lucide-react";
import { toast } from "sonner";
import type { GeneratedPlaylist, PlaylistTrack } from "@/types/database";

export default function PlaylistsPage() {
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [previewTracks, setPreviewTracks] = useState<
    Array<{
      trackName: string;
      artistName: string;
      reason: string;
      spotifyUri?: string;
      albumImageUrl?: string;
    }>
  >([]);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<string | null>(
    null
  );
  const [playlists, setPlaylists] = useState<
    (GeneratedPlaylist & { tracks?: PlaylistTrack[] })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPlaylists();
  }, []);

  async function loadPlaylists() {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("generated_playlists")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    setPlaylists(data || []);
    setLoading(false);
  }

  async function handleGenerate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setPreviewTracks([]);

    try {
      const res = await fetch("/api/ai/playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, trackCount: 20 }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error);
      }

      const data = await res.json();
      setPreviewTracks(data.tracks);
      setCurrentPlaylistId(data.playlistId);
      toast.success(`Generated ${data.tracks.length} tracks!`);
      await loadPlaylists();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Generation failed"
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleSaveToSpotify() {
    if (!currentPlaylistId || previewTracks.length === 0) return;
    setSaving(true);

    try {
      const trackUris = previewTracks
        .filter((t) => t.spotifyUri)
        .map((t) => t.spotifyUri!);

      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: currentPlaylistId,
          name: `DataFlow: ${prompt.slice(0, 50)}`,
          description: `AI-generated playlist: "${prompt}"`,
          trackUris,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");

      toast.success("Playlist saved to Spotify!");

      if (data.url) {
        window.open(data.url, "_blank");
      }
      await loadPlaylists();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save to Spotify");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Generate a Playlist
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Describe a mood, vibe, or theme... e.g. 'chill lo-fi for studying'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              disabled={generating}
              className="flex-1"
            />
            <Button
              onClick={handleGenerate}
              disabled={generating || !prompt.trim()}
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
              ) : (
                <Sparkles className="w-4 h-4 mr-1.5" />
              )}
              {generating ? "Generating..." : "Generate"}
            </Button>
          </div>

          {previewTracks.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Preview ({previewTracks.length} tracks)
                </p>
                <Button
                  size="sm"
                  onClick={handleSaveToSpotify}
                  disabled={saving}
                  className="bg-[#1DB954] hover:bg-[#1ed760] text-white"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Save className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Save to Spotify
                </Button>
              </div>
              <div className="divide-y divide-border rounded-lg border">
                {previewTracks.map((track, i) => (
                  <div key={i} className="flex items-center gap-3 p-3">
                    <span className="w-5 text-xs text-muted-foreground text-right">
                      {i + 1}
                    </span>
                    <SpotifyImage
                      src={track.albumImageUrl}
                      alt={track.trackName}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {track.trackName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {track.artistName}
                      </p>
                      <p className="text-xs text-primary/80 mt-0.5">
                        {track.reason}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-4">Your Playlists</h2>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : playlists.length === 0 ? (
          <EmptyState
            title="No playlists yet"
            description="Generate your first AI-powered playlist using the form above!"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {playlists.map((pl) => (
              <Card key={pl.id} className="hover:border-primary/30 transition-colors">
                <CardContent className="p-4">
                  <h3 className="font-medium text-sm truncate">{pl.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {pl.prompt_used}
                  </p>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-xs text-muted-foreground">
                      {pl.track_count} tracks
                    </span>
                    <div className="flex items-center gap-2">
                      {pl.mood_tags?.map((tag) => (
                        <span
                          key={tag}
                          className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                        >
                          {tag}
                        </span>
                      ))}
                      {pl.is_saved_to_spotify && (
                        <ExternalLink className="w-3.5 h-3.5 text-[#1DB954]" />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
