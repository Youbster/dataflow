import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM, buildTasteProfile } from "@/lib/claude/prompts";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: shortTracks }, { data: shortArtists }, { data: history7d }, { data: history3d }, { data: profileData }] = await Promise.all([
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(15),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(15),
      admin.from("user_listening_history").select("spotify_track_id, track_name, artist_names, album_image_url, played_at").eq("user_id", user.id).gte("played_at", sevenDaysAgo).order("played_at", { ascending: false }),
      admin.from("user_listening_history").select("spotify_track_id, track_name, artist_names").eq("user_id", user.id).gte("played_at", threeDaysAgo),
      admin.from("user_profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
    ]);

    const plays7d = history7d ?? [];
    const plays3d = history3d ?? [];

    // Stats
    const uniqueArtists = new Set(plays7d.flatMap(p => p.artist_names ?? [])).size;
    const genreCounts: Record<string, number> = {};
    for (const a of shortArtists ?? []) {
      for (const g of a.genres ?? []) genreCounts[g] = (genreCounts[g] ?? 0) + 1;
    }
    const sortedGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
    const topGenre  = sortedGenres[0]?.[0] ?? null;
    const topGenres = sortedGenres.slice(0, 4).map(([g]) => g);
    const topArtist = (shortArtists ?? [])[0]?.artist_name ?? null;

    // Recent top tracks (this week, deduplicated by play count)
    const trackCounts: Record<string, { id: string; name: string; artist: string; count: number; img: string | null }> = {};
    for (const p of plays7d) {
      if (!trackCounts[p.spotify_track_id]) {
        trackCounts[p.spotify_track_id] = { id: p.spotify_track_id, name: p.track_name, artist: p.artist_names?.[0] ?? "", count: 0, img: p.album_image_url };
      }
      trackCounts[p.spotify_track_id].count++;
    }
    const recentTopTracks = Object.values(trackCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(t => ({ spotifyTrackId: t.id, trackName: t.name, artistName: t.artist, albumImageUrl: t.img, playCount: t.count }));

    // Burnout detection (no AI needed — pure math)
    const playCounts3d: Record<string, { count: number; trackName: string; artistName: string }> = {};
    const total3d = plays3d.length;
    for (const p of plays3d) {
      if (!playCounts3d[p.spotify_track_id]) {
        playCounts3d[p.spotify_track_id] = { count: 0, trackName: p.track_name, artistName: p.artist_names?.[0] ?? "" };
      }
      playCounts3d[p.spotify_track_id].count++;
    }
    const hardFloor = Math.max(8, Math.round(total3d * 0.12));
    const burnoutEntry = Object.entries(playCounts3d)
      .filter(([, v]) => v.count >= hardFloor && total3d > 0 && v.count / total3d > 0.2)
      .sort((a, b) => b[1].count - a[1].count)[0] ?? null;
    const burnout = burnoutEntry
      ? { trackName: burnoutEntry[1].trackName, artistName: burnoutEntry[1].artistName, pct: Math.round((burnoutEntry[1].count / total3d) * 100) }
      : null;

    const stats = {
      playsThisWeek: plays7d.length,
      estimatedMinutes: Math.round(plays7d.length * 3.5),
      uniqueArtists,
      topGenre,
    };

    // AI vibe — only if we have enough data
    let vibe = null;
    if ((shortArtists?.length ?? 0) > 0) {
      const tasteProfile = buildTasteProfile(shortTracks ?? [], shortArtists ?? []);
      const topArtistNames = tasteProfile.topArtists.slice(0, 5).map(a => a.name).join(", ");
      try {
        const aiRes = await getOpenAI().chat.completions.create({
          model: FAST_MODEL,
          max_tokens: 150,
          messages: [
            { role: "system", content: MUSIC_EXPERT_SYSTEM },
            {
              role: "user",
              content: `This listener played ${plays7d.length} tracks this week. Top artists: ${topArtistNames}. Top genre: ${topGenre ?? "varied"}.

Write ONE short sentence (max 18 words) capturing their musical vibe this week. Be specific and evocative — reference their actual artists or genre. Also give ONE word summing up their energy (e.g. Introspective, Electric, Restless, Mellow, Untethered).

Return ONLY valid JSON: { "word": "...", "sentence": "..." }`,
            },
          ],
        });
        const text = aiRes.choices[0].message.content ?? "";
        const match = text.match(/\{[\s\S]*\}/)?.[0];
        if (match) vibe = JSON.parse(match);
      } catch { /* vibe is optional */ }
    }

    return NextResponse.json({
      stats,
      topGenres,
      topArtist,
      profile: profileData
        ? { displayName: profileData.display_name as string, avatarUrl: (profileData.avatar_url as string | null) ?? null }
        : null,
      recentTopTracks,
      vibe,
      burnout,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
