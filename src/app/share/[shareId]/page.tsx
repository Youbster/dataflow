import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Music } from "lucide-react";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ shareId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { shareId } = await params;
  return {
    title: `Shared Dashboard — DataFlow`,
    description: `Check out this music dashboard on DataFlow`,
    openGraph: {
      title: "DataFlow — Shared Music Dashboard",
      description: "See what they've been listening to!",
    },
  };
}

export default async function SharedDashboardPage({ params }: PageProps) {
  const { shareId } = await params;
  const supabase = createAdminClient();

  const { data: dashboard } = await supabase
    .from("shared_dashboards")
    .select("*")
    .eq("share_id", shareId)
    .eq("is_active", true)
    .single();

  if (!dashboard) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Dashboard not found</h1>
          <p className="text-muted-foreground">
            This shared dashboard may have expired or been removed.
          </p>
        </div>
      </div>
    );
  }

  await supabase
    .from("shared_dashboards")
    .update({ view_count: (dashboard.view_count || 0) + 1 })
    .eq("id", dashboard.id);

  const snapshot = dashboard.snapshot_data as {
    topTracks: Array<{
      track_name: string;
      artist_names: string[];
      album_image_url: string;
      rank: number;
    }>;
    topArtists: Array<{
      artist_name: string;
      genres: string[];
      image_url: string;
      rank: number;
    }>;
    genreDistribution: Record<string, number>;
    generatedAt: string;
  };

  const topGenres = Object.entries(snapshot.genreDistribution || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Music className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold">DataFlow</h1>
          </div>
          <h2 className="text-lg text-muted-foreground">
            {dashboard.title || "Shared Music Dashboard"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Shared on{" "}
            {new Date(dashboard.created_at).toLocaleDateString()} ·{" "}
            {dashboard.view_count} views
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Artists</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {snapshot.topArtists?.slice(0, 10).map((artist, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 text-xs text-muted-foreground text-right">
                      {artist.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {artist.artist_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {artist.genres?.slice(0, 3).join(", ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Tracks</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {snapshot.topTracks?.slice(0, 10).map((track, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-5 text-xs text-muted-foreground text-right">
                      {track.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {track.track_name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {track.artist_names?.join(", ")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {topGenres.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top Genres</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {topGenres.map(([genre, count]) => (
                  <span
                    key={genre}
                    className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm"
                  >
                    {genre} ({count})
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Powered by DataFlow — AI-powered Spotify insights
        </p>
      </div>
    </div>
  );
}
