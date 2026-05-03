import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM, buildTasteProfile, buildWrappedPrompt } from "@/lib/claude/prompts";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthName = `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    const admin = createAdminClient();

    const [{ data: history }, { data: shortArtists }, { data: shortTracks }] = await Promise.all([
      admin.from("user_listening_history").select("*").eq("user_id", user.id).gte("played_at", monthStart).order("played_at"),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank"),
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank"),
    ]);

    const plays = history ?? [];

    // Track play counts
    const trackCounts: Record<string, { name: string; artist: string; count: number; imgUrl: string | null }> = {};
    const artistCounts: Record<string, number> = {};
    const dayCounts: Record<number, number> = {};
    const weekCounts: Record<number, { plays: number; tracks: Record<string, number> }> = { 1:{plays:0,tracks:{}}, 2:{plays:0,tracks:{}}, 3:{plays:0,tracks:{}}, 4:{plays:0,tracks:{}} };
    const uniqueArtistSet = new Set<string>();

    for (const p of plays) {
      // Track counts
      if (!trackCounts[p.spotify_track_id]) {
        trackCounts[p.spotify_track_id] = { name: p.track_name, artist: p.artist_names?.[0] ?? "", count: 0, imgUrl: p.album_image_url };
      }
      trackCounts[p.spotify_track_id].count++;

      // Artist counts
      for (const a of p.artist_names ?? []) {
        artistCounts[a] = (artistCounts[a] ?? 0) + 1;
        uniqueArtistSet.add(a);
      }

      // Day of week
      const d = new Date(p.played_at);
      dayCounts[d.getDay()] = (dayCounts[d.getDay()] ?? 0) + 1;

      // Week of month
      const weekNum = Math.min(4, Math.ceil(d.getDate() / 7));
      weekCounts[weekNum].plays++;
      const tid = p.spotify_track_id;
      weekCounts[weekNum].tracks[tid] = (weekCounts[weekNum].tracks[tid] ?? 0) + 1;
    }

    const topTrackEntry = Object.entries(trackCounts).sort((a, b) => b[1].count - a[1].count)[0];
    const topTrack = topTrackEntry ? { trackName: topTrackEntry[1].name, artistName: topTrackEntry[1].artist, playCount: topTrackEntry[1].count, albumImageUrl: topTrackEntry[1].imgUrl } : null;

    const topArtistEntry = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0];
    const topArtist = topArtistEntry ? { name: topArtistEntry[0], playCount: topArtistEntry[1] } : null;

    const mostActiveDay = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
    const mostActiveDayName = mostActiveDay ? DAYS[parseInt(mostActiveDay[0])] : "Unknown";

    const top5Tracks = Object.entries(trackCounts)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([, v]) => ({ trackName: v.name, artistName: v.artist, playCount: v.count, albumImageUrl: v.imgUrl }));

    const top5Artists = Object.entries(artistCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => {
        const artistData = shortArtists?.find((a) => a.artist_name === name);
        return { name, playCount: count, genres: artistData?.genres?.slice(0, 2) ?? [], imageUrl: artistData?.image_url ?? null };
      });

    const topGenres = [...new Set((shortArtists ?? []).flatMap((a) => a.genres))].slice(0, 5);

    const weekBreakdown = [1, 2, 3, 4].map((w) => {
      const topWeekTrackId = Object.entries(weekCounts[w].tracks).sort((a, b) => b[1] - a[1])[0]?.[0];
      return { week: w, plays: weekCounts[w].plays, topTrack: topWeekTrackId ? (trackCounts[topWeekTrackId]?.name ?? "") : "" };
    });

    const stats = {
      totalPlays: plays.length,
      uniqueTracks: Object.keys(trackCounts).length,
      uniqueArtists: uniqueArtistSet.size,
      estimatedMinutes: Math.round(plays.length * 3.5),
      mostActiveDay: mostActiveDayName,
      topGenres,
    };

    const tasteProfile = buildTasteProfile(shortTracks ?? [], shortArtists ?? []);
    const prompt = buildWrappedPrompt(monthName, stats, topTrack, topArtist, weekBreakdown, tasteProfile);

    const aiRes = await getOpenAI().chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 800,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const text = aiRes.choices[0].message.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/)?.[0];
    const ai = jsonMatch ? JSON.parse(jsonMatch) : { monthWord: "Eclectic", archetypeName: "The Music Explorer", description: "A month of diverse listening.", moodNarrative: "Your taste evolved throughout the month.", standoutStat: `You played ${stats.uniqueArtists} unique artists.` };

    return NextResponse.json({ monthName, stats, topTrack, topArtist, top5Tracks, top5Artists, weekBreakdown, ai });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wrapped generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
