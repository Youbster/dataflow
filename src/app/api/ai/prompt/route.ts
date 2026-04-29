import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";

function fmt(tracks: { track_name: string; artist_names: string[] }[], limit = 15) {
  return tracks.slice(0, limit).map(t => `"${t.track_name}" by ${t.artist_names[0] ?? "Unknown"}`).join("; ");
}
function fmtArtists(artists: { artist_name: string; genres: string[] }[], limit = 12) {
  return artists.slice(0, limit).map(a => `${a.artist_name} (${(a.genres ?? []).slice(0, 2).join(", ")})`).join("; ");
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const message: string = body.message ?? "";
  if (!message.trim()) return NextResponse.json({ error: "No message provided" }, { status: 400 });

  try {
    const admin = createAdminClient();

    // Fetch all three time ranges in parallel for full historical context
    const [
      { data: shortTracks }, { data: shortArtists },
      { data: mediumTracks }, { data: mediumArtists },
      { data: longTracks }, { data: longArtists },
      { data: recentHistory },
    ] = await Promise.all([
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(15),
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "medium_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "medium_term").order("rank").limit(15),
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(15),
      admin.from("user_listening_history").select("track_name, artist_names, played_at").eq("user_id", user.id).order("played_at", { ascending: false }).limit(100),
    ]);

    // Build a recent play summary (last 100 plays, most replayed first)
    const playCounts: Record<string, { name: string; artist: string; count: number }> = {};
    for (const p of recentHistory ?? []) {
      const key = p.track_name + p.artist_names?.[0];
      if (!playCounts[key]) playCounts[key] = { name: p.track_name, artist: p.artist_names?.[0] ?? "", count: 0 };
      playCounts[key].count++;
    }
    const mostReplayedRecently = Object.values(playCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map(t => `"${t.name}" by ${t.artist} (${t.count}×)`)
      .join("; ");

    const aiRes = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 1000,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        {
          role: "user",
          content: `The user asks: "${message}"

THEIR FULL SPOTIFY LISTENING HISTORY (all time ranges):

Last 4 weeks (recent taste):
- Tracks: ${fmt(shortTracks ?? []) || "no data"}
- Artists: ${fmtArtists(shortArtists ?? []) || "no data"}

Last 6 months (medium-term taste):
- Tracks: ${fmt(mediumTracks ?? []) || "no data"}
- Artists: ${fmtArtists(mediumArtists ?? []) || "no data"}

All-time / long-term (years of history — use this for nostalgia questions about past years):
- Tracks: ${fmt(longTracks ?? []) || "no data"}
- Artists: ${fmtArtists(longArtists ?? []) || "no data"}

Most replayed recently (from actual play logs):
${mostReplayedRecently || "no play log data yet"}

IMPORTANT: Spotify's "long_term" data covers several years of listening history. Use it to answer questions about what they used to listen to, their all-time favourites, or nostalgia questions. Be honest if exact year-by-year data isn't available but infer from the long-term data what they likely listened to most in the past.

Rules:
- Songs/playlist/mood/activity request → type "tracks", 5-8 real Spotify tracks
- Insight/explanation/nostalgia answer/conversational → type "insight"
- Always reference their actual data — don't be generic
- "message": warm 1-2 sentence response

Return ONLY valid JSON:
{
  "type": "tracks" | "insight",
  "message": "...",
  "tracks": [{ "trackName": "...", "artistName": "...", "reason": "one sentence specific to them" }]
}
If type is "insight", omit tracks entirely.`,
        },
      ],
    });

    const text = aiRes.choices[0].message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/)?.[0];
    const result = match
      ? JSON.parse(match)
      : { type: "insight", message: "I couldn't quite parse that. Try asking for a playlist or song recommendations." };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
