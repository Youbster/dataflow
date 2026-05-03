import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOpenAI, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const [{ data: longTracks }, { data: longArtists }] = await Promise.all([
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(15),
    ]);

    const trackList = (longTracks ?? []).map(t => `"${t.track_name}" by ${t.artist_names?.[0] ?? "Unknown"}`).join("; ");
    const artistList = (longArtists ?? []).slice(0, 8).map(a => a.artist_name).join(", ");

    const aiRes = await getOpenAI().chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 800,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        {
          role: "user",
          content: `Generate a "Flashback Playlist" for this listener based on their all-time listening DNA.

All-time top tracks: ${trackList || "not enough data"}
All-time top artists: ${artistList || "not enough data"}

Create 8 tracks that feel like a time capsule of who they were musically before now. Mix tracks directly from their history with tracks that feel like they belong to that era of their taste. For each track, write a short note that captures the feeling or era it represents.

Return ONLY valid JSON:
{
  "tracks": [
    { "trackName": "...", "artistName": "...", "note": "one nostalgic sentence about what this song/era felt like" }
  ]
}`,
        },
      ],
    });

    const text = aiRes.choices[0].message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/)?.[0];
    const result = match ? JSON.parse(match) : { tracks: [] };

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
