import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";

interface ArtistRow { artist_name: string; genres: string[] }

function computeGenrePct(artists: ArtistRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of artists) {
    for (const g of a.genres ?? []) counts[g] = (counts[g] ?? 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  const pct: Record<string, number> = {};
  for (const [g, c] of Object.entries(counts)) pct[g] = Math.round((c / total) * 100);
  return pct;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const [{ data: shortArtists }, { data: longArtists }, { data: longTracks }] = await Promise.all([
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(30),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(30),
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(10),
    ]);

    const sArtists = shortArtists ?? [];
    const lArtists = longArtists ?? [];

    const shortNames = new Set(sArtists.map(a => a.artist_name));
    const longNames = new Set(lArtists.map(a => a.artist_name));

    const newArrivals = sArtists.filter(a => !longNames.has(a.artist_name)).slice(0, 5).map(a => a.artist_name);
    const fadedAway = lArtists.filter(a => !shortNames.has(a.artist_name)).slice(0, 5).map(a => a.artist_name);
    const loyal = sArtists.filter(a => longNames.has(a.artist_name)).slice(0, 5).map(a => a.artist_name);

    const nowPct = computeGenrePct(sArtists);
    const thenPct = computeGenrePct(lArtists);

    const allGenres = [...new Set([...Object.keys(nowPct), ...Object.keys(thenPct)])];
    const genreDNA = allGenres
      .map(g => ({ genre: g, thenPct: thenPct[g] ?? 0, nowPct: nowPct[g] ?? 0, delta: (nowPct[g] ?? 0) - (thenPct[g] ?? 0) }))
      .filter(g => g.thenPct > 3 || g.nowPct > 3)
      .sort((a, b) => Math.max(b.thenPct, b.nowPct) - Math.max(a.thenPct, a.nowPct))
      .slice(0, 6);

    const flashbackTracks = (longTracks ?? []).slice(0, 5).map(t => ({
      trackName: t.track_name,
      artistName: t.artist_names?.[0] ?? "Unknown",
    }));

    // AI narrative
    let narrative = "";
    let shiftLabel = "";

    if (sArtists.length > 0 && lArtists.length > 0) {
      const shortTop = sArtists.slice(0, 3).map(a => a.artist_name).join(", ");
      const longTop = lArtists.slice(0, 3).map(a => a.artist_name).join(", ");
      const rising = [...genreDNA].sort((a, b) => b.delta - a.delta)[0]?.genre ?? null;
      const fading = [...genreDNA].sort((a, b) => a.delta - b.delta)[0]?.genre ?? null;

      try {
        const aiRes = await openai.chat.completions.create({
          model: FAST_MODEL,
          max_tokens: 200,
          messages: [
            { role: "system", content: MUSIC_EXPERT_SYSTEM },
            {
              role: "user",
              content: `A listener's music taste has evolved over time.

All-time top artists: ${longTop}
Current top artists: ${shortTop}
Rising genre: ${rising ?? "n/a"}
Fading genre: ${fading ?? "n/a"}
New artists in rotation: ${newArrivals.slice(0, 3).join(", ") || "none"}
Artists drifted from: ${fadedAway.slice(0, 3).join(", ") || "none"}

Write:
1. "narrative": 2 specific, personal sentences about their musical journey. Reference actual artists and genres. Make it feel like a music journalist who really knows them.
2. "shiftLabel": 4-8 word phrase capturing the arc (e.g. "From indie nostalgia to electronic present")

Return ONLY valid JSON: { "narrative": "...", "shiftLabel": "..." }`,
            },
          ],
        });
        const text = aiRes.choices[0].message.content ?? "";
        const match = text.match(/\{[\s\S]*\}/)?.[0];
        if (match) { const p = JSON.parse(match); narrative = p.narrative ?? ""; shiftLabel = p.shiftLabel ?? ""; }
      } catch { /* narrative is optional */ }
    }

    return NextResponse.json({ genreDNA, newArrivals, fadedAway, loyal, flashbackTracks, narrative, shiftLabel });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
