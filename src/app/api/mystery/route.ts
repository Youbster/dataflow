import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().split("T")[0];

    // Return today's box if it already exists
    const { data: existing } = await admin
      .from("mystery_boxes")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
      .single();

    if (existing) return NextResponse.json(existing);

    // Compute streak from yesterday
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { data: yesterdayBox } = await admin
      .from("mystery_boxes")
      .select("streak_count, claimed")
      .eq("user_id", user.id)
      .eq("date", yesterday.toISOString().split("T")[0])
      .single();

    const streakCount = yesterdayBox?.claimed ? (yesterdayBox.streak_count ?? 0) + 1 : 1;
    const isGolden = streakCount > 0 && streakCount % 7 === 0;

    // Fetch taste data
    const [{ data: shortTracks }, { data: shortArtists }, { data: longArtists }] = await Promise.all([
      admin.from("user_top_tracks").select("track_name, artist_names").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name, genres").eq("user_id", user.id).eq("time_range", "short_term").order("rank").limit(20),
      admin.from("user_top_artists").select("artist_name").eq("user_id", user.id).eq("time_range", "long_term").order("rank").limit(30),
    ]);

    const topArtistNames = (shortArtists ?? []).map(a => a.artist_name);
    const allKnownArtists = [...new Set([...topArtistNames, ...(longArtists ?? []).map(a => a.artist_name)])];
    const topGenres = [...new Set((shortArtists ?? []).flatMap(a => a.genres ?? []))].slice(0, 6).join(", ");
    const topTracks = (shortTracks ?? []).slice(0, 8).map(t => `"${t.track_name}" by ${t.artist_names?.[0]}`).join("; ");

    const prompt = isGolden
      ? `GOLDEN BOX — Day ${streakCount} streak reward.

This listener's top artists: ${topArtistNames.slice(0, 8).join(", ")}
Their top genres: ${topGenres}
Known artists to AVOID: ${allKnownArtists.slice(0, 20).join(", ")}

Find them ONE track from an artist they have NEVER heard of (not in the avoid list at all) that is a near-perfect match to their musical DNA. This is their hidden soulmate artist — someone who sounds exactly like their taste but they've never discovered. Make it feel like a revelation.

Return ONLY valid JSON:
{
  "trackName": "...",
  "artistName": "...",
  "reason": "2-3 sentences explaining why this unknown artist is their perfect match — be specific about the sonic DNA, reference their actual taste"
}`
      : `Generate ONE mystery track for this listener.

Their top genres: ${topGenres}
Their top tracks: ${topTracks}
Their top artists: ${topArtistNames.slice(0, 8).join(", ")}
Artists to AVOID (they already know these): ${topArtistNames.join(", ")}

Create "familiar novelty" — suggest ONE real Spotify track that feels deeply aligned with their taste but is something they haven't heard. It could be a lesser-known artist in their genre, a different era of a genre they love, or a subtle sonic sibling to what they already play. Not a mainstream hit they definitely know.

Return ONLY valid JSON:
{
  "trackName": "...",
  "artistName": "...",
  "reason": "2-3 sentences explaining why this feels like them — reference their actual genres and artists, be specific and personal"
}`;

    const aiRes = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 300,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const text = aiRes.choices[0].message.content ?? "";
    const match = text.match(/\{[\s\S]*\}/)?.[0];
    if (!match) throw new Error("AI returned invalid response");
    const { trackName, artistName, reason } = JSON.parse(match);

    const { data: inserted, error } = await admin
      .from("mystery_boxes")
      .insert({ user_id: user.id, date: today, track_name: trackName, artist_name: artistName, reason, is_golden: isGolden, streak_count: streakCount })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(inserted);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
