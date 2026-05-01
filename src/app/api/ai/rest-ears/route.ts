import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateStalenessScores } from "@/lib/staleness/calculator";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM, buildTasteProfile } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = createAdminClient();

    // Get stale tracks + taste profile in parallel
    const [{ results: scores }, { data: topTracks }, { data: topArtists }] =
      await Promise.all([
        calculateStalenessScores(user.id),
        db
          .from("user_top_tracks")
          .select("*")
          .eq("user_id", user.id)
          .eq("time_range", "medium_term")
          .order("rank")
          .limit(30),
        db
          .from("user_top_artists")
          .select("*")
          .eq("user_id", user.id)
          .eq("time_range", "medium_term")
          .order("rank")
          .limit(20),
      ]);

    const staleList = scores
      .filter((s) => s.stalenessScore > 40)
      .slice(0, 20);

    const tasteProfile = buildTasteProfile(topTracks ?? [], topArtists ?? []);

    const blocklist = staleList
      .map((s) => `"${s.trackName}" by ${s.artistNames[0]}`)
      .join(", ");

    const topGenres = Object.entries(tasteProfile.genreDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([g]) => g)
      .join(", ");

    const prompt = `This listener has been overplaying these tracks and needs a break:
OVERPLAYED (DO NOT SUGGEST THESE OR ANYTHING TOO SIMILAR): ${blocklist || "none identified yet"}

Their taste:
- Favourite artists: ${tasteProfile.topArtists.slice(0, 12).map((a) => a.name).join(", ")}
- Top genres: ${topGenres}
- Favourite tracks (can use same artists but NOT the same songs): ${tasteProfile.topTracks.slice(0, 8).map((t) => `"${t.name}" by ${t.artist}`).join("; ")}

Create a "Rest My Ears" playlist — 12 tracks that:
1. Feel fresh and give mental breathing room
2. Still fit their taste (same artists are fine, just NOT the overplayed tracks themselves)
3. Include a mix of familiar comfort tracks AND 3-4 genuine discoveries
4. Have good flow — start gentle, build energy naturally
5. SPOTIFY ACCURACY: Only suggest tracks you are 100% certain exist on Spotify with this exact name and artist. Never invent titles. Pick the most well-known studio release when in doubt. Avoid obscure remixes, live versions, or regional exclusives.

Return ONLY valid JSON:
{
  "intro": "One warm sentence about why these tracks will give their ears a break",
  "tracks": [
    { "trackName": "exact Spotify name", "artistName": "primary artist", "reason": "why this feels fresh right now" }
  ]
}`;

    const response = await openai.chat.completions.create({
      model: FAST_MODEL,
      max_tokens: 3000,
      messages: [
        { role: "system", content: MUSIC_EXPERT_SYSTEM },
        { role: "user", content: prompt },
      ],
    });

    const text = response.choices[0].message.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 500 }
      );
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      intro: string;
      tracks: { trackName: string; artistName: string; reason: string }[];
    };

    // Verify tracks on Spotify in parallel — artist-validated to avoid wrong matches
    const spotify = createSpotifyClient(user.id);
    const results = await Promise.allSettled(
      parsed.tracks.map(async (track) => {
        const found = await spotify.findTrack(track.trackName, track.artistName);
        if (!found) return null;
        return {
          ...track,
          spotifyTrackId: found.id,
          albumImageUrl: found.album.images[0]?.url ?? null,
        };
      })
    );

    const verified = results
      .flatMap((r) => (r.status === "fulfilled" && r.value !== null ? [r.value] : []));

    return NextResponse.json({ intro: parsed.intro, tracks: verified });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Rest-ears generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
