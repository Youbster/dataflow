"use client";

import { useState, useEffect, use } from "react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PlayOnSpotify } from "@/components/shared/play-on-spotify";
import { ArrowLeft, Check, ExternalLink, Heart, Loader2, Music, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface CompareResult {
  targetUser: {
    id: string;
    displayName: string;
    username: string | null;
    avatarUrl: string | null;
  };
  similarityScore: number;
  compatibilityLabel: string;
  compatibilityDesc: string;
  matchBreakdown: { artists: number; genres: number; tracks: number };
  sharedArtists: { artistName: string; imageUrl: string | null }[];
  sharedTracks: { trackName: string; artistName: string; albumImageUrl: string | null }[];
  myUniqueArtists: string[];
  theirUniqueArtists: string[];
  sharedGenres: string[];
  myTopGenres: string[];
  theirTopGenres: string[];
  theirUniqueGenres: string[];
  friendBreakTarget: string;
  friendBreakPrompt: string;
}

interface CurrentUser {
  displayName: string;
  avatarUrl: string | null;
}

interface PlaylistTrack {
  trackName: string;
  artistName: string;
  section: "anchor" | "groove" | "discovery";
  reason: string;
  spotifyTrackId?: string | null;
  spotifyUri?: string | null;
  albumImageUrl?: string | null;
}

interface GeneratedPlaylist {
  intro: string;
  tracks: PlaylistTrack[];
  playlistId?: string | null;
}

// Score → ring color
function scoreColor(score: number) {
  if (score >= 60) return "#1DB954"; // green
  if (score >= 35) return "#f59e0b"; // amber
  return "#6b7280";                  // grey
}

// Score → ring SVG (half-filled circle feel via stroke-dasharray)
function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg className="absolute inset-0 -rotate-90" width="144" height="144" viewBox="0 0 144 144">
        {/* track */}
        <circle cx="72" cy="72" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted/30" />
        {/* fill */}
        <circle
          cx="72" cy="72" r={r} fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="text-center z-10">
        <p className="text-3xl font-bold leading-none" style={{ color }}>{score}%</p>
        <p className="text-[11px] text-muted-foreground mt-1">match</p>
      </div>
    </div>
  );
}

export default function ComparePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = use(params);

  const [result, setResult] = useState<CompareResult | null>(null);
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatingFriendReset, setGeneratingFriendReset] = useState(false);
  const [friendPlaylist, setFriendPlaylist] = useState<GeneratedPlaylist | null>(null);
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const [savedPlaylist, setSavedPlaylist] = useState(false);

  useEffect(() => {
    loadComparison();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function loadComparison() {
    setLoading(true);
    setError(null);
    try {
      // Get current user's display info
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("user_profiles")
          .select("display_name, avatar_url")
          .eq("id", user.id)
          .single();
        if (profile) {
          setMe({ displayName: profile.display_name, avatarUrl: profile.avatar_url });
        }
      }

      // Run comparison
      const res = await fetch("/api/social/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Comparison failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load comparison");
    } finally {
      setLoading(false);
    }
  }

  async function generateFriendReset() {
    if (!result || generatingFriendReset) return;
    setGeneratingFriendReset(true);
    setSavedPlaylist(false);
    try {
      const res = await fetch("/api/ai/mood-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: "break_loop",
          prompt: result.friendBreakPrompt,
          sessionMinutes: 60,
          familiarity: "mixed",
          intensity: "mid",
          breakLoopMode: "new_lane",
          breakLoopTarget: result.friendBreakTarget,
          vocals: "any",
          language: "any",
          genreLock: null,
          artistLock: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate playlist");
      setFriendPlaylist(data as GeneratedPlaylist);
      toast.success("Friend-powered reset ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate playlist");
    } finally {
      setGeneratingFriendReset(false);
    }
  }

  async function saveFriendPlaylist() {
    if (!friendPlaylist || savingPlaylist || savedPlaylist) return;
    const playableUris = friendPlaylist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!);
    if (playableUris.length === 0) return;
    setSavingPlaylist(true);
    try {
      const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const name = `${result?.targetUser.displayName.split(" ")[0] ?? "Friend"} Taste Reset — ${dateLabel}`;
      const res = await fetch("/api/spotify/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: friendPlaylist.playlistId ?? null,
          name,
          description: friendPlaylist.intro,
          trackUris: playableUris,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setSavedPlaylist(true);
      toast.success("Playlist saved to Spotify");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save playlist");
    } finally {
      setSavingPlaylist(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/social"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Social
      </Link>

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={loadComparison}
            className="mt-3 text-xs text-muted-foreground hover:text-foreground underline transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Header — two users + score */}
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              {/* Me */}
              <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                <Avatar className="w-14 h-14 ring-2 ring-border">
                  <AvatarImage src={me?.avatarUrl ?? undefined} />
                  <AvatarFallback>{me?.displayName?.charAt(0) ?? "?"}</AvatarFallback>
                </Avatar>
                <p className="text-sm font-medium text-center truncate w-full">{me?.displayName ?? "You"}</p>
              </div>

              {/* Score ring */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                <ScoreRing score={result.similarityScore} />
                <p className="text-xs font-semibold tracking-wide text-center" style={{ color: scoreColor(result.similarityScore) }}>
                  {result.compatibilityLabel}
                </p>
              </div>

              {/* Them */}
              <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                <Avatar className="w-14 h-14 ring-2 ring-border">
                  <AvatarImage src={result.targetUser.avatarUrl ?? undefined} />
                  <AvatarFallback>{result.targetUser.displayName.charAt(0)}</AvatarFallback>
                </Avatar>
                <p className="text-sm font-medium text-center truncate w-full">{result.targetUser.displayName}</p>
              </div>
            </div>

            <p className="text-sm text-muted-foreground text-center mt-5 leading-relaxed">
              {result.compatibilityDesc}
            </p>

            <div className="grid grid-cols-3 divide-x divide-border/60 border-y border-border/60 py-3 mt-5 text-center">
              <div>
                <p className="text-sm font-bold">{result.matchBreakdown.artists}%</p>
                <p className="text-[10px] text-muted-foreground">artists</p>
              </div>
              <div>
                <p className="text-sm font-bold">{result.matchBreakdown.genres}%</p>
                <p className="text-[10px] text-muted-foreground">genres</p>
              </div>
              <div>
                <p className="text-sm font-bold">{result.matchBreakdown.tracks}%</p>
                <p className="text-[10px] text-muted-foreground">tracks</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Break your loop with {result.targetUser.displayName.split(" ")[0]}&apos;s taste
                </h2>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Uses their unique artists and genres as direction while still blocking your recent repeats.
                </p>
              </div>
              <Button size="sm" onClick={generateFriendReset} disabled={generatingFriendReset}>
                {generatingFriendReset ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                Generate
              </Button>
            </div>
            {result.friendBreakTarget && (
              <div className="flex flex-wrap gap-1.5">
                {result.friendBreakTarget.split(", ").slice(0, 8).map((item) => (
                  <span key={item} className="text-[10px] px-2 py-0.5 rounded-full border border-primary/20 bg-background/50 text-primary">
                    {item}
                  </span>
                ))}
              </div>
            )}
          </div>

          {friendPlaylist && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold">Friend-powered reset</h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{friendPlaylist.intro}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {friendPlaylist.tracks.some((t) => t.spotifyUri) && (
                    <PlayOnSpotify uris={friendPlaylist.tracks.filter((t) => t.spotifyUri).map((t) => t.spotifyUri!)} label="Play" />
                  )}
                  <Button size="sm" variant="outline" onClick={saveFriendPlaylist} disabled={savingPlaylist || savedPlaylist}>
                    {savingPlaylist ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : savedPlaylist ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Heart className="w-3.5 h-3.5 mr-1.5" />}
                    {savedPlaylist ? "Saved" : "Save"}
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                {friendPlaylist.tracks.map((track, index) => (
                  <a
                    key={`${track.spotifyTrackId ?? track.trackName}-${index}`}
                    href={track.spotifyTrackId ? `https://open.spotify.com/track/${track.spotifyTrackId}` : `https://open.spotify.com/search/${encodeURIComponent(`${track.trackName} ${track.artistName}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl bg-accent/30 hover:bg-accent border border-transparent hover:border-border/60 p-2.5 transition-all group"
                  >
                    {track.albumImageUrl ? (
                      <img src={track.albumImageUrl} alt={track.trackName} className="w-9 h-9 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-md bg-primary/15 text-primary flex items-center justify-center text-xs font-bold shrink-0">{index + 1}</div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm group-hover:text-primary transition-colors leading-snug truncate">
                        {track.trackName} <span className="text-muted-foreground font-normal">· {track.artistName}</span>
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5 italic truncate">{track.reason}</p>
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground/30 group-hover:text-primary shrink-0 transition-colors" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Shared artists */}
          {result.sharedArtists.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">You both love</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Artists you share in your top listening</p>
              </div>
              <div className="flex flex-wrap gap-3">
                {result.sharedArtists.map((a) => (
                  <div key={a.artistName} className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5">
                    {a.imageUrl ? (
                      <img src={a.imageUrl} alt={a.artistName} className="w-5 h-5 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        <Music className="w-2.5 h-2.5 text-primary" />
                      </div>
                    )}
                    <span className="text-xs font-medium text-primary">{a.artistName}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.sharedTracks.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">Shared repeats</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Tracks that appear in both of your top listening</p>
              </div>
              <div className="space-y-2">
                {result.sharedTracks.map((track) => (
                  <div key={`${track.trackName}-${track.artistName}`} className="flex items-center gap-3">
                    {track.albumImageUrl ? (
                      <img src={track.albumImageUrl} alt={track.trackName} className="w-9 h-9 rounded-md object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-md bg-accent flex items-center justify-center shrink-0">
                        <Music className="w-4 h-4 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{track.trackName}</p>
                      <p className="text-xs text-muted-foreground truncate">{track.artistName}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.sharedArtists.length === 0 && (
            <div className="rounded-2xl border border-dashed border-border p-5 text-center">
              <p className="text-sm font-medium">No artists in common</p>
              <p className="text-xs text-muted-foreground mt-1">
                You&apos;re exploring completely different musical worlds.
              </p>
            </div>
          )}

          {/* Unique taste — two columns */}
          <div className="grid grid-cols-2 gap-4">
            {/* My unique */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Your sound</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Artists only you listen to</p>
              </div>
              {result.myUniqueArtists.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">All your artists are shared!</p>
              ) : (
                <div className="space-y-2">
                  {result.myUniqueArtists.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                      <span className="text-sm truncate">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Their unique */}
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">{result.targetUser.displayName.split(" ")[0]}&apos;s sound</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Artists only they listen to</p>
              </div>
              {result.theirUniqueArtists.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">All their artists are shared!</p>
              ) : (
                <div className="space-y-2">
                  {result.theirUniqueArtists.map((name) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                      <span className="text-sm truncate">{name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Shared genres */}
          {result.sharedGenres.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
              <div>
                <h2 className="text-sm font-semibold">Shared sounds</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Genres you both gravitate toward</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.sharedGenres.map((g) => (
                  <span
                    key={g}
                    className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 capitalize"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
