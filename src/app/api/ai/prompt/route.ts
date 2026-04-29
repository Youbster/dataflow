import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM, buildTasteProfile } from "@/lib/claude/prompts";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const message: string = body.message ?? "";
  if (!message.trim()) return NextResponse.json({ error: "No message provided" }, { status: 400 });

  try {
    const admin = createAdminClient();
    const [{ data: shortTracks }, { data: shortArtists }] = await Promise.all([
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
    ]);

    const tasteProfile = buildTasteProfile(shortTracks ?? [], shortArtists ?? []);
    const topArtists = tasteProfile.topArtists.slice(0, 10).map(a => `${a.name} (${a.genres.slice(0, 2).join(", ")})`).join("; ");
    const topGenres = Object.entries(tasteProfile.genreDistribution).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g]) => g).join(", ");
    const topTracks = tasteProfile.topTracks.slice(0, 8).map(t => `"${t.name}" by ${t.artist}`).join("; ");

    const aiRes = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 900,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        {
          role: "user",
          content: `The user says: "${message}"

Their Spotify taste profile:
- Top artists: ${topArtists || "not enough data yet"}
- Top genres: ${topGenres || "not enough data yet"}
- Top tracks: ${topTracks || "not enough data yet"}

Respond to whatever they asked. Rules:
- If they want songs, a playlist, or music for a mood/activity → type "tracks" with 5-8 real Spotify tracks
- If they want an insight, explanation, or something conversational → type "insight" with no tracks
- Always be specific to their actual taste — reference their artists/genres when relevant
- "message" is a warm 1-2 sentence response to what they asked

Return ONLY valid JSON:
{
  "type": "tracks" | "insight",
  "message": "...",
  "tracks": [{ "trackName": "...", "artistName": "...", "reason": "one sentence why this fits them specifically" }]
}

If type is "insight", omit the tracks field entirely.`,
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
