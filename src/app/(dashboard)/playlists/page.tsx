"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { SpotifyImage } from "@/components/shared/spotify-image";
import { EmptyState } from "@/components/shared/empty-state";
import { PlayOnSpotify } from "@/components/shared/play-on-spotify";
import {
  ListMusic, ExternalLink, ChevronDown, ChevronUp,
  Loader2, Heart, Check, Music,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import type { GeneratedPlaylist, PlaylistTrack } from "@/types/database";

// ─── Mood display map ────────────────────────────────────────────────────────
const MOOD_META: Record<string, { emoji: string; label: string; color: string }> = {
  uplift:    { emoji: "🚀", label: "Uplift",      color: "text-amber-400"   },
  focus:     { emoji: "🎯", label: "Deep Focus",  color: "text-blue-400"    },
  gym:       { emoji: "💪", label: "Workout",     color: "text-red-400"     },
  unwind:    { emoji: "🌊", label: "Unwind",      color: "text-teal-400"    },
  sad:       { emoji: "🌧️", label: "Feel It",     color: "text-indigo-400"  },
  party:     { emoji: "🎉", label: "Party",       color: "text-pink-400"    },
  throwback: { emoji: "⏪", label: "Throwback",   color: "text-violet-400"  },
  surprise:  { emoji: "✨", label: "Surprise Me", color: "text-emerald-400" },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return mins <= 1 ? "Just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

// ─── Card ─────────────────────────────────────────────────────────────────────
interface PlaylistCardProps {
  pl: GeneratedPlaylist;
  /** Pre-loaded Spotify URIs for instant Play button */
  uris: string[];
}

function PlaylistCard({ pl, uris }: PlaylistCardProps) {
  const [expanded, setExpanded]   = useState(false);
  const [tracks, setTracks]       = useState<PlaylistTrack[] | null>(null);
  const [loadingTracks, setLoading] = useState(false);
  const [saved, setSaved]         = useState(pl.is_saved_to_spotify);
  const [saving, setSaving]       = useState(false);

  const mood = pl.mood_tags?.[0] ?? "";
  const meta = MOOD_META[mood];

  async function loadFullTracks() {
    if (tracks !== null) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("playlist_tracks")
        .select("*")
        .eq("playlist_id", pl.id)
        .order("position");
      setTracks(data ?? []);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle() {
    if (!expanded && tracks === null) await loadFullTracks();
    setExpanded((v) => !v);
  }

  async function handleSaveToSpotify() {
    if (saving || saved || uris.length === 0) return;
    setSaving(true);
    try {
      const dateLabel = new Date(pl.created_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      });
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: pl.id,
          name: pl.name ?? `${meta?.label ?? "Playlist"} — ${dateLabel}`,
          description: pl.description ?? "",
          trackUris: uris,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSaved(true);
      toast.success("Playlist saved to Spotify!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save to Spotify");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden hover:border-border/60 transition-colors">
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 bg-accent flex items-center justify-center">
          {pl.cover_image_url ? (
            <SpotifyImage src={pl.cover_image_url} alt={pl.name} size="md" />
          ) : (
            <Music className="w-6 h-6 text-muted-foreground/40" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
            {meta && <span className="text-xs">{meta.emoji}</span>}
            {meta && (
              <span className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>
                {meta.label}
              </span>
            )}
            {saved && (
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[#1DB954]/15 text-[#1DB954] font-medium">
                On Spotify
              </span>
            )}
          </div>
          <p className="text-sm font-semibold leading-snug truncate">{pl.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{pl.track_count} tracks</span>
            <span className="text-muted-foreground/30 text-xs">·</span>
            <span className="text-xs text-muted-foreground">{timeAgo(pl.created_at)}</span>
          </div>
        </div>
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2 px-4 pb-3 flex-wrap">
        {uris.length > 0 && (
          <PlayOnSpotify uris={uris} size="sm" label="Play" />
        )}

        <button
          onClick={handleSaveToSpotify}
          disabled={saving || saved || uris.length === 0}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
            saved
              ? "border-[#1DB954]/40 text-[#1DB954] cursor-default"
              : uris.length === 0
              ? "border-border/40 text-muted-foreground/40 cursor-not-allowed"
              : "border-border text-muted-foreground hover:text-[#1DB954] hover:border-[#1DB954]/40"
          }`}
        >
          {saving ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : saved ? (
            <Check className="w-3 h-3" />
          ) : (
            <Heart className="w-3 h-3" />
          )}
          {saved ? "Saved" : "Save to Spotify"}
        </button>

        <button
          onClick={handleToggle}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <><ChevronUp className="w-3.5 h-3.5" /> Hide tracks</>
          ) : (
            <><ChevronDown className="w-3.5 h-3.5" /> Show tracks</>
          )}
        </button>
      </div>

      {/* Expanded track list */}
      {expanded && (
        <div className="border-t border-border">
          {loadingTracks ? (
            <div className="p-4 space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))}
            </div>
          ) : !tracks || tracks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No tracks stored
            </p>
          ) : (
            <div className="divide-y divide-border/40 max-h-80 overflow-y-auto">
              {tracks.map((t, i) => (
                <a
                  key={t.id}
                  href={`https://open.spotify.com/track/${t.spotify_track_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/40 transition-colors group"
                >
                  <span className="w-4 text-[11px] text-muted-foreground/50 text-right shrink-0">
                    {i + 1}
                  </span>
                  {t.album_image_url ? (
                    <img
                      src={t.album_image_url}
                      alt={t.track_name}
                      className="w-8 h-8 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded bg-accent shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                      {t.track_name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {t.artist_names?.join(", ")}
                    </p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary shrink-0 transition-colors" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PlaylistsPage() {
  const [playlists, setPlaylists]               = useState<GeneratedPlaylist[]>([]);
  const [playlistUris, setPlaylistUris]         = useState<Record<string, string[]>>({});
  const [loading, setLoading]                   = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString();

    // 1. Fetch playlists from last 30 days
    const { data: pls } = await supabase
      .from("generated_playlists")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false });

    const plList = pls ?? [];
    setPlaylists(plList);

    // 2. Batch-fetch all track IDs for those playlists (one query)
    if (plList.length > 0) {
      const { data: allTracks } = await supabase
        .from("playlist_tracks")
        .select("playlist_id, spotify_track_id")
        .in("playlist_id", plList.map((p) => p.id))
        .order("position");

      const uriMap: Record<string, string[]> = {};
      for (const row of allTracks ?? []) {
        if (!uriMap[row.playlist_id]) uriMap[row.playlist_id] = [];
        uriMap[row.playlist_id].push(`spotify:track:${row.spotify_track_id}`);
      }
      setPlaylistUris(uriMap);
    }

    setLoading(false);
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListMusic className="w-6 h-6 text-primary" />
            Generated Playlists
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your recent AI-curated sessions · kept for 30 days
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-xs text-primary hover:text-primary/80 underline underline-offset-2 transition-colors whitespace-nowrap"
        >
          + New playlist
        </Link>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          description="Head to the Dashboard and use 'What do you need right now?' to generate your first AI playlist."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {playlists.map((pl) => (
            <PlaylistCard
              key={pl.id}
              pl={pl}
              uris={playlistUris[pl.id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
