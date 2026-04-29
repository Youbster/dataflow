"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { SpotifyImage } from "@/components/shared/spotify-image";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Sparkles, Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";
import type { StalenessResult } from "@/lib/staleness/types";

const levelColors: Record<string, string> = {
  fresh: "text-green-400",
  familiar: "text-yellow-400",
  overplayed: "text-orange-400",
  burnt_out: "text-red-400",
};

const levelBg: Record<string, string> = {
  fresh: "bg-green-400",
  familiar: "bg-yellow-400",
  overplayed: "bg-orange-400",
  burnt_out: "bg-red-400",
};

const trendIcons = {
  increasing: TrendingUp,
  decreasing: TrendingDown,
  stable: Minus,
};

export default function StalenessPage() {
  const [scores, setScores] = useState<StalenessResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestingFor, setSuggestingFor] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<
    Record<
      string,
      Array<{
        trackName: string;
        artistName: string;
        reason: string;
        albumImageUrl?: string;
      }>
    >
  >({});

  useEffect(() => {
    syncThenFetch();
  }, []);

  async function syncThenFetch() {
    try {
      await fetch("/api/spotify/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: false }) });
    } catch {
      // non-fatal — proceed to fetch whatever's in DB
    }
    await fetchScores();
  }

  async function fetchScores() {
    try {
      const res = await fetch("/api/ai/staleness");
      if (res.ok) {
        const data = await res.json();
        setScores(data.scores);
      }
    } catch {
      toast.error("Failed to load staleness data");
    } finally {
      setLoading(false);
    }
  }

  async function getSuggestions(track: StalenessResult) {
    setSuggestingFor(track.spotifyTrackId);
    try {
      const res = await fetch("/api/ai/staleness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staleTracks: [
            {
              trackName: track.trackName,
              artistNames: track.artistNames,
              playCount: track.totalPlays,
              stalenessScore: track.stalenessScore,
            },
          ],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const alts =
          data.suggestions?.[0]?.alternatives || [];
        setSuggestions((prev) => ({
          ...prev,
          [track.spotifyTrackId]: alts,
        }));
      }
    } catch {
      toast.error("Failed to get suggestions");
    } finally {
      setSuggestingFor(null);
    }
  }

  const staleCount = scores.filter((s) => s.stalenessScore > 50).length;

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-xl" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : scores.length === 0 ? (
        <EmptyState
          title="No overplayed tracks found"
          description="This works best once you've listened to the same songs a few times. Come back after a few days of listening — we'll show you which tracks you're burning out on."
        />
      ) : (
        <>
          <Card>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 rounded-lg bg-orange-500/10">
                <AlertTriangle className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <p className="font-semibold">
                  {staleCount} {staleCount === 1 ? "song" : "songs"} getting stale
                </p>
                <p className="text-sm text-muted-foreground">
                  {scores.length} {scores.length === 1 ? "track" : "tracks"} analyzed from your listening history
                </p>
              </div>
            </CardContent>
          </Card>

          {staleCount === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <p className="font-medium text-foreground">Your ears are fresh 🎧</p>
              <p className="text-sm mt-1">No overplayed tracks detected. Come back after a few more listening sessions.</p>
            </div>
          )}

          <div className="space-y-3">
            {scores.filter((s) => s.stalenessScore > 25).map((track) => {
              const TrendIcon = trendIcons[track.trend];
              const alts = suggestions[track.spotifyTrackId];

              return (
                <Card key={track.spotifyTrackId}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <SpotifyImage
                        src={track.albumImageUrl}
                        alt={track.trackName}
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">
                          {track.trackName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {track.artistNames.join(", ")}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <div className="flex-1">
                            <Progress
                              value={track.stalenessScore}
                              className="h-2"
                            />
                          </div>
                          <span
                            className={`text-xs font-medium ${levelColors[track.level]}`}
                          >
                            {track.stalenessScore}%
                          </span>
                          <TrendIcon className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span>{track.totalPlays} total plays</span>
                          <span>{track.playsLast7Days} this week</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-xs ${levelBg[track.level]} text-black font-medium`}
                          >
                            {track.level.replace("_", " ")}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => getSuggestions(track)}
                        disabled={
                          suggestingFor === track.spotifyTrackId
                        }
                      >
                        {suggestingFor === track.spotifyTrackId ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" />
                        )}
                      </Button>
                    </div>

                    {alts && alts.length > 0 && (
                      <div className="mt-3 pl-16 space-y-2">
                        <p className="text-xs font-medium text-primary">
                          Fresh alternatives:
                        </p>
                        {alts.map((alt, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-sm"
                          >
                            <SpotifyImage
                              src={alt.albumImageUrl}
                              alt={alt.trackName}
                              size="sm"
                            />
                            <div>
                              <span className="font-medium">
                                {alt.trackName}
                              </span>
                              <span className="text-muted-foreground">
                                {" "}
                                by {alt.artistName}
                              </span>
                              <p className="text-xs text-muted-foreground">
                                {alt.reason}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
