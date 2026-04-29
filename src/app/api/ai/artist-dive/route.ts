import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM, buildTasteProfile, buildArtistDivePrompt } from "@/lib/claude/prompts";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { artistName } = await request.json();
    if (!artistName?.trim()) return NextResponse.json({ error: "Artist name required" }, { status: 400 });

    const admin = createAdminClient();
    const [{ data: tracks }, { data: artists }] = await Promise.all([
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "medium_term").order("rank"),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "medium_term").order("rank"),
    ]);

    const tasteProfile = buildTasteProfile(tracks ?? [], artists ?? []);
    const prompt = buildArtistDivePrompt(artistName.trim(), tasteProfile);

    const response = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 1000,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const text = response.choices[0].message.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Failed to parse AI response");

    return NextResponse.json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate artist guide";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
