"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { TimeRangeSelector } from "@/components/dashboard/time-range-selector";
import { StatCard } from "@/components/dashboard/stat-card";
import { TopArtistsChart } from "@/components/dashboard/top-artists-chart";
import { GenreDistribution } from "@/components/dashboard/genre-distribution";
import { TopTracksList } from "@/components/dashboard/top-tracks-list";
import { RecentPlays } from "@/components/dashboard/recent-plays";
import { AiInsightsCard } from "@/components/dashboard/ai-insights-card";
import { ListeningTimeline } from "@/components/dashboard/listening-timeline";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Music, Users, Disc3, Clock } from "lucide-react";
import { toast } from "sonner";
import type { TimeRange } from "@/lib/constants";
import type {
  UserTopTrack,
  UserTopArtist,
  UserListeningHistory,
} from "@/types/database";

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>("medium_term");
  const [topTracks, setTopTracks] = useState<UserTopTrack[]>([]);
  const [topArtists, setTopArtists] = useState<UserTopArtist[]>([]);
  const [history, setHistory] = useState<UserListeningHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return;

    const [tracksRes, artistsRes, historyRes] = await Promise.all([
      supabase
        .from("user_top_tracks")
        .select("*")
        .eq("user_id", user.id)
        .eq("time_range", timeRange)
        .order("rank"),
      supabase
        .from("user_top_artists")
        .select("*")
        .eq("user_id", user.id)
        .eq("time_range", timeRange)
        .order("rank"),
      supabase
        .from("user_listening_history")
        .select("*")
        .eq("user_id", user.id)
        .order("played_at", { ascending: false })
        .limit(200),
    ]);

    setTopTracks(tracksRes.data || []);
    setTopArtists(artistsRes.data || []);
    setHistory(historyRes.data || []);
    setLoading(false);
  }, [timeRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/spotify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      if (res.ok) {
        toast.success("Data synced from Spotify!");
        await fetchData();
      } else {
        const data = await res.json();
        toast.error(data.error || "Sync failed");
      }
    } catch {
      toast.error("Failed to sync");
    } finally {
      setSyncing(false);
    }
  }

  const uniqueArtists = new Set(topTracks.flatMap((t) => t.artist_names)).size;
  const totalMinutes = Math.round(
    topTracks.reduce((sum, t) => sum + (t.duration_ms || 0), 0) / 60000
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`}
          />
          {syncing ? "Syncing..." : "Sync Now"}
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Top Tracks"
              value={topTracks.length}
              icon={Music}
            />
            <StatCard
              label="Unique Artists"
              value={uniqueArtists}
              icon={Users}
            />
            <StatCard
              label="Recent Plays"
              value={history.length}
              icon={Disc3}
            />
            <StatCard
              label="Est. Minutes"
              value={totalMinutes.toLocaleString()}
              icon={Clock}
              subtext="in top tracks"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <TopArtistsChart artists={topArtists} />
            <GenreDistribution artists={topArtists} />
          </div>

          <ListeningTimeline history={history} />
          <AiInsightsCard />

          <div className="grid gap-6 lg:grid-cols-2">
            <TopTracksList tracks={topTracks} />
            <RecentPlays history={history} />
          </div>
        </>
      )}
    </div>
  );
}
