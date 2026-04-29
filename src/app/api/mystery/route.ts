import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai, FAST_MODEL } from "@/lib/claude/client";
import { MUSIC_EXPERT_SYSTEM } from "@/lib/claude/prompts";
import { createSpotifyClient } from "@/lib/spotify/client";

function artistMatches(returned: string, requested: string): boolean {
  const a = returned.toLowerCase();
  const b = requested.toLowerCase();
  if (a === b) return true;
  // Accept if either name contains the first word of the other (handles "Cedric Gervais" vs "Cedric")
  const aWord = a.split(" ")[0];
  const bWord = b.split(" ")[0];
  return a.includes(bWord) || b.includes(aWord);
}

async function verifyOnSpotify(
  userId: string,
  trackName: string,
  artistName: string
): Promise<{ trackName: string; artistName: string } | null> {
  try {
    const spotify = createSpotifyClient(userId);

    // Exact field search
    const result = await spotify.searchTracks(`track:${trackName} artist:${artistName}`, 5);
    const tracks = result.tracks?.items ?? [];
    const exact = tracks.find(t =>
      t.artists.some(a => artistMatches(a.name, artistName))
    );
    if (exact) return { trackName: exact.name, artistName: exact.artists[0]?.name ?? artistName };

    // Broader fallback — only accept if artist name actually matches
    const fallback = await spotify.searchTracks(`${trackName} ${artistName}`, 8);
    const fbTracks = fallback.tracks?.items ?? [];
    const match = fbTracks.find(t =>
      t.artists.some(a => artistMatches(a.name, artistName))
    );
    if (match) return { trackName: match.name, artistName: match.artists[0]?.name ?? artistName };

    // Completely different artist returned — reject
    return null;
  } catch {
    return null;
  }
}

async function generateSuggestion(prompt: string): Promise<{ trackName: string; artistName: string; reason: string } | null> {
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
  if (!match) return null;
  return JSON.parse(match);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const admin = createAdminClient();
    const today = new Date().toISOString().split("T")[0];

    // Return today's box if already generated
    const { data: existing } = await admin
      .from("mystery_boxes")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
      .single();

    if (existing) return NextResponse.json(existing);

    // Compute streak
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

    const buildPrompt = (excludeExtra: string[] = []) => {
      const avoidList = [...allKnownArtists, ...excludeExtra].join(", ");
      return isGolden
        ? `GOLDEN BOX — Day ${streakCount} streak reward.

This listener's top artists: ${topArtistNames.slice(0, 8).join(", ")}
Their top genres: ${topGenres}
Artists to AVOID (they know all of these): ${avoidList}

Find ONE track from an artist they have NEVER heard of (not in the avoid list) that is a near-perfect match to their musical DNA. This is their hidden soulmate artist. Make it feel like a revelation.

IMPORTANT: Only suggest tracks you are certain exist on Spotify. Stick to real, well-documented tracks.

Return ONLY valid JSON:
{ "trackName": "...", "artistName": "...", "reason": "2-3 sentences about the sonic DNA match" }`
        : `Generate ONE mystery track for this listener.

Their top genres: ${topGenres}
Their top tracks: ${topTracks}
Their top artists: ${topArtistNames.slice(0, 8).join(", ")}
Artists to AVOID: ${avoidList}

Suggest ONE real Spotify track that creates "familiar novelty" — aligned with their taste but something they likely haven't heard. Prefer well-known tracks by less-known artists over obscure tracks. Do NOT invent song titles.

IMPORTANT: Only suggest tracks you are highly confident exist on Spotify with this exact name.

Return ONLY valid JSON:
{ "trackName": "...", "artistName": "...", "reason": "2-3 sentences about why this fits them" }`;
    };

    // Try up to 3 times, verifying against Spotify each time
    let verified: { trackName: string; artistName: string } | null = null;
    let finalReason = "";
    const failedArtists: string[] = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      const suggestion = await generateSuggestion(buildPrompt(failedArtists));
      if (!suggestion) continue;

      const found = await verifyOnSpotify(user.id, suggestion.trackName, suggestion.artistName);
      if (found) {
        verified = found;
        finalReason = suggestion.reason;
        break;
      }
      // Track failed artist so next attempt avoids it
      failedArtists.push(suggestion.artistName);
    }

    if (!verified) throw new Error("Could not find a verified track on Spotify after 3 attempts");

    const { data: inserted, error } = await admin
      .from("mystery_boxes")
      .insert({
        user_id: user.id,
        date: today,
        track_name: verified.trackName,
        artist_name: verified.artistName,
        reason: finalReason,
        is_golden: isGolden,
        streak_count: streakCount,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(inserted);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
