import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM, buildTasteProfile, buildDiscoverPrompt } from "@/lib/claude/prompts";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();

    const [
      { data: shortTracks },
      { data: longTracks },
      { data: shortArtists },
      { data: longArtists },
      { data: history },
    ] = await Promise.all([
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank"),
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "long_term").order("rank"),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank"),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "long_term").order("rank"),
      admin.from("user_listening_history").select("*").eq("user_id", user.id).order("played_at", { ascending: false }).limit(500),
    ]);

    // Compute hour and day distributions from listening history
    const hourCounts: Record<number, number> = {};
    const dayCounts: Record<number, number> = {};
    const playCounts: Record<string, number> = {};

    for (const play of history ?? []) {
      const date = new Date(play.played_at);
      const hour = date.getHours();
      const day = date.getDay();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      dayCounts[day] = (dayCounts[day] || 0) + 1;
      playCounts[play.spotify_track_id] = (playCounts[play.spotify_track_id] || 0) + 1;
    }

    const topHours = Object.entries(hourCounts)
      .map(([h, c]) => ({ hour: parseInt(h), count: c }))
      .sort((a, b) => b.count - a.count);

    const topDays = Object.entries(dayCounts)
      .map(([d, c]) => ({ day: DAY_NAMES[parseInt(d)], dayIndex: parseInt(d), count: c }))
      .sort((a, b) => b.count - a.count);

    const peakHour = topHours[0]?.hour ?? 12;
    const peakDay = topDays[0]?.day ?? "Monday";

    // Hidden gems: low-popularity tracks the user actually listens to
    const hiddenGems = (shortTracks ?? [])
      .filter((t) => (t.popularity ?? 100) < 50)
      .map((t) => ({
        trackName: t.track_name,
        artistName: t.artist_names[0] ?? "",
        popularity: t.popularity ?? 0,
        playCount: playCounts[t.spotify_track_id] ?? 1,
        albumImageUrl: t.album_image_url,
        artistNames: t.artist_names,
      }))
      .sort((a, b) => a.popularity - b.popularity)
      .slice(0, 6);

    const tasteProfile = buildTasteProfile(shortTracks ?? [], shortArtists ?? []);

    const prompt = buildDiscoverPrompt(
      tasteProfile,
      {
        peakHour,
        peakDay,
        topHours: topHours.slice(0, 5),
        topDays,
        totalPlays: history?.length ?? 0,
        uniqueTracks: Object.keys(playCounts).length,
      },
      hiddenGems,
      (shortArtists ?? []).map((a) => a.artist_name),
      (longArtists ?? []).map((a) => a.artist_name)
    );

    const response = await getOpenAI().chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 1500,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const text = response.choices[0].message.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse AI response");

    const profile = JSON.parse(jsonMatch[0]);

    // Full hour array (0-23) for the heatmap
    const allHours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      count: hourCounts[i] ?? 0,
    }));

    // Full day array (ordered Mon-Sun for display)
    const allDays = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
      day: DAY_NAMES[d].slice(0, 3),
      count: dayCounts[d] ?? 0,
    }));

    return NextResponse.json({
      profile,
      hiddenGems,
      patterns: { allHours, allDays, peakHour, peakDay, totalPlays: history?.length ?? 0 },
      evolution: {
        shortTermArtists: (shortArtists ?? []).slice(0, 6).map((a) => ({ name: a.artist_name, genres: a.genres.slice(0, 2) })),
        longTermArtists: (longArtists ?? []).slice(0, 6).map((a) => ({ name: a.artist_name, genres: a.genres.slice(0, 2) })),
        shortTermGenres: [...new Set((shortArtists ?? []).flatMap((a) => a.genres))].slice(0, 5),
        longTermGenres: [...new Set((longArtists ?? []).flatMap((a) => a.genres))].slice(0, 5),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate discover profile";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
