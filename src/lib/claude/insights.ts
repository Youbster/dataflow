import { getOpenAI, FAST_MODEL } from "./client";
import {
  MUSIC_EXPERT_SYSTEM,
  buildInsightsPrompt,
  buildTasteProfile,
} from "./prompts";
import { createAdminClient } from "@/lib/supabase/admin";

export interface Insight {
  text: string;
  category: string;
}

export async function generateInsights(userId: string): Promise<Insight[]> {
  const supabase = createAdminClient();

  const [{ data: topTracks }, { data: topArtists }] = await Promise.all([
    supabase
      .from("user_top_tracks")
      .select("*")
      .eq("user_id", userId)
      .eq("time_range", "medium_term")
      .order("rank"),
    supabase
      .from("user_top_artists")
      .select("*")
      .eq("user_id", userId)
      .eq("time_range", "medium_term")
      .order("rank"),
  ]);

  if (!topTracks?.length && !topArtists?.length) {
    return [
      {
        text: "Connect your Spotify and listen to some music to unlock AI insights!",
        category: "habit",
      },
    ];
  }

  const tasteProfile = buildTasteProfile(topTracks || [], topArtists || []);
  const uniqueArtists = new Set(
    (topTracks || []).flatMap((t) => t.artist_names)
  ).size;
  const prompt = buildInsightsPrompt(
    tasteProfile,
    topTracks?.length || 0,
    uniqueArtists
  );

  const response = await getOpenAI().chat.completions.create({
    model: FAST_MODEL,
    max_tokens: 1024,
    messages: [
      { role: "system", content: MUSIC_EXPERT_SYSTEM },
      { role: "user", content: prompt },
    ],
  });

  const text = response.choices[0].message.content ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]) as { insights: Insight[] };
  return parsed.insights;
}
