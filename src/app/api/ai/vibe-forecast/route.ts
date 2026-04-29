import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import {
  MUSIC_EXPERT_SYSTEM,
  buildTasteProfile,
  buildVibeForecastPrompt,
  buildPaletteCleanserPrompt,
} from "@/lib/claude/prompts";

const SEASONS: Record<number, string> = {
  0: "Winter", 1: "Winter", 2: "Spring", 3: "Spring", 4: "Spring",
  5: "Summer", 6: "Summer", 7: "Summer", 8: "Autumn", 9: "Autumn",
  10: "Autumn", 11: "Winter",
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function getWeather(city: string): Promise<{
  tempC: number; condition: string; isRaining: boolean; humidity: number;
} | null> {
  try {
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      { next: { revalidate: 1800 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data.current_condition?.[0];
    if (!cur) return null;
    const condition: string = cur.weatherDesc?.[0]?.value ?? "Clear";
    return {
      tempC: parseInt(cur.temp_C ?? "15"),
      condition,
      isRaining: /rain|drizzle|shower|thunder/i.test(condition),
      humidity: parseInt(cur.humidity ?? "50"),
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const [
      { data: mediumTracks },
      { data: mediumArtists },
      { data: recentHistory },
    ] = await Promise.all([
      admin.from("user_top_tracks").select("*").eq("user_id", user.id).eq("time_range", "medium_term").order("rank"),
      admin.from("user_top_artists").select("*").eq("user_id", user.id).eq("time_range", "medium_term").order("rank"),
      admin.from("user_listening_history").select("*").eq("user_id", user.id).gte("played_at", threeDaysAgo).order("played_at", { ascending: false }),
    ]);

    // --- Burnout Detection ---
    const playCounts: Record<string, { count: number; trackName: string; artistName: string }> = {};
    const totalRecent = recentHistory?.length ?? 0;

    for (const play of recentHistory ?? []) {
      if (!playCounts[play.spotify_track_id]) {
        playCounts[play.spotify_track_id] = {
          count: 0,
          trackName: play.track_name,
          artistName: play.artist_names?.[0] ?? "Unknown",
        };
      }
      playCounts[play.spotify_track_id].count++;
    }

    // Dynamic threshold: flag if >20% of recent plays AND at least max(8, total*0.12) plays
    const hardFloor = Math.max(8, Math.round(totalRecent * 0.12));
    const burnoutTrack = Object.entries(playCounts)
      .filter(([, v]) => v.count >= hardFloor && totalRecent > 0 && v.count / totalRecent > 0.2)
      .sort((a, b) => b[1].count - a[1].count)[0] ?? null;

    // --- Location & Weather ---
    const city = decodeURIComponent(request.headers.get("x-vercel-ip-city") ?? "London");
    const country = request.headers.get("x-vercel-ip-country") ?? "GB";
    const weather = await getWeather(city);
    const weatherData = {
      city,
      country,
      tempC: weather?.tempC ?? 18,
      condition: weather?.condition ?? "Clear",
      isRaining: weather?.isRaining ?? false,
      humidity: weather?.humidity ?? 50,
    };

    const tasteProfile = buildTasteProfile(mediumTracks ?? [], mediumArtists ?? []);
    const dayOfWeek = DAYS[now.getDay()];
    const season = SEASONS[now.getMonth()];

    // Run forecast + optional cleanser in parallel
    const forecastPromise = openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 1200,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: buildVibeForecastPrompt(tasteProfile, weatherData, dayOfWeek, season) },
      ],
    });

    const cleanserPromise = burnoutTrack
      ? openai.chat.completions.create({
          model: FAST_MODEL,
          max_tokens: 600,
          messages: [
            { role: "system", content: MUSIC_EXPERT_SYSTEM },
            {
              role: "user",
              content: buildPaletteCleanserPrompt(
                {
                  trackName: burnoutTrack[1].trackName,
                  artistName: burnoutTrack[1].artistName,
                  playCount: burnoutTrack[1].count,
                  pct: Math.round((burnoutTrack[1].count / totalRecent) * 100),
                },
                tasteProfile
              ),
            },
          ],
        })
      : Promise.resolve(null);

    const [forecastRes, cleanserRes] = await Promise.all([forecastPromise, cleanserPromise]);

    const forecastText = forecastRes.choices[0].message.content ?? "";
    const forecastJson = forecastText.match(/\{[\s\S]*\}/)?.[0];
    const forecast = forecastJson ? JSON.parse(forecastJson) : null;

    let burnoutResult = null;
    if (burnoutTrack && cleanserRes) {
      const cleanserText = cleanserRes.choices[0].message.content ?? "";
      const cleanserJson = cleanserText.match(/\{[\s\S]*\}/)?.[0];
      if (cleanserJson) {
        const parsed = JSON.parse(cleanserJson);
        burnoutResult = {
          trackName: burnoutTrack[1].trackName,
          artistName: burnoutTrack[1].artistName,
          playCount: burnoutTrack[1].count,
          pct: Math.round((burnoutTrack[1].count / totalRecent) * 100),
          totalRecent,
          ...parsed,
        };
      }
    }

    return NextResponse.json({ forecast, weather: weatherData, burnout: burnoutResult });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Forecast failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
