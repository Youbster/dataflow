import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { timeRange = "medium_term" } = await request.json();
    const admin = createAdminClient();

    const [{ data: topTracks }, { data: topArtists }] = await Promise.all([
      admin
        .from("user_top_tracks")
        .select("track_name, artist_names, album_image_url, rank, popularity")
        .eq("user_id", user.id)
        .eq("time_range", timeRange)
        .order("rank")
        .limit(20),
      admin
        .from("user_top_artists")
        .select("artist_name, genres, image_url, rank, popularity")
        .eq("user_id", user.id)
        .eq("time_range", timeRange)
        .order("rank")
        .limit(20),
    ]);

    const genreDistribution: Record<string, number> = {};
    for (const artist of topArtists || []) {
      for (const genre of artist.genres) {
        genreDistribution[genre] = (genreDistribution[genre] || 0) + 1;
      }
    }

    const snapshotData = {
      topTracks: topTracks || [],
      topArtists: topArtists || [],
      genreDistribution,
      generatedAt: new Date().toISOString(),
    };

    const { data: shared, error } = await admin
      .from("shared_dashboards")
      .insert({
        user_id: user.id,
        snapshot_data: snapshotData,
        time_range: timeRange,
      })
      .select("share_id")
      .single();

    if (error) throw error;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    return NextResponse.json({ url: `${appUrl}/share/${shared.share_id}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Share failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
