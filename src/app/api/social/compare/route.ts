import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { targetUserId } = await request.json();
  if (!targetUserId) return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  if (targetUserId === user.id) return NextResponse.json({ error: "Cannot compare with yourself" }, { status: 400 });

  const admin = createAdminClient();

  // Validate target user exists and is public
  const { data: targetProfile } = await admin
    .from("user_profiles")
    .select("id, display_name, username, avatar_url, is_public")
    .eq("id", targetUserId)
    .single();

  if (!targetProfile) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!targetProfile.is_public) return NextResponse.json({ error: "This profile is private" }, { status: 403 });

  // Fetch both users' top artists/tracks (medium_term = last ~6 months)
  const [{ data: myArtists }, { data: theirArtists }, { data: myTracks }, { data: theirTracks }] = await Promise.all([
    admin
      .from("user_top_artists")
      .select("artist_name, genres, image_url, rank")
      .eq("user_id", user.id)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(50),
    admin
      .from("user_top_artists")
      .select("artist_name, genres, image_url, rank")
      .eq("user_id", targetUserId)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(50),
    admin
      .from("user_top_tracks")
      .select("track_name, artist_names, album_image_url, rank")
      .eq("user_id", user.id)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(50),
    admin
      .from("user_top_tracks")
      .select("track_name, artist_names, album_image_url, rank")
      .eq("user_id", targetUserId)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(50),
  ]);

  const myList = myArtists ?? [];
  const theirList = theirArtists ?? [];
  const myTrackList = myTracks ?? [];
  const theirTrackList = theirTracks ?? [];

  // Normalise names for comparison (case-insensitive)
  const norm = (s: string) => s.toLowerCase().trim();
  const trackKey = (trackName: string, artistName: string) => norm(`${trackName}|||${artistName}`);
  const overlapPct = (a: Set<string>, b: Set<string>) => {
    const unionSize = new Set([...a, ...b]).size;
    if (unionSize === 0) return 0;
    const intersectionSize = [...a].filter((item) => b.has(item)).length;
    return Math.round((intersectionSize / unionSize) * 100);
  };
  const myNameSet = new Set(myList.map((a) => norm(a.artist_name)));
  const theirNameSet = new Set(theirList.map((a) => norm(a.artist_name)));

  // Shared artists (preserve image + original name from my list)
  const sharedArtists = myList
    .filter((a) => theirNameSet.has(norm(a.artist_name)))
    .slice(0, 8)
    .map((a) => ({ artistName: a.artist_name, imageUrl: a.image_url ?? null }));

  // Unique to each side (top 5, names only)
  const myUniqueArtists = myList
    .filter((a) => !theirNameSet.has(norm(a.artist_name)))
    .slice(0, 5)
    .map((a) => a.artist_name);

  const theirUniqueArtists = theirList
    .filter((a) => !myNameSet.has(norm(a.artist_name)))
    .slice(0, 5)
    .map((a) => a.artist_name);

  // Genre sets
  const myGenres = [...new Set(myList.flatMap((a) => a.genres ?? []))];
  const theirGenres = [...new Set(theirList.flatMap((a) => a.genres ?? []))];
  const myGenreSet = new Set(myGenres.map(norm));
  const theirGenreSet = new Set(theirGenres.map(norm));
  const sharedGenres = myGenres.filter((g) => theirGenreSet.has(norm(g))).slice(0, 8);
  const theirUniqueGenres = theirGenres.filter((g) => !myGenreSet.has(norm(g))).slice(0, 5);

  const myTrackSet = new Set(myTrackList.map((t) => trackKey(t.track_name, t.artist_names?.[0] ?? "")));
  const theirTrackSet = new Set(theirTrackList.map((t) => trackKey(t.track_name, t.artist_names?.[0] ?? "")));
  const sharedTracks = myTrackList
    .filter((t) => theirTrackSet.has(trackKey(t.track_name, t.artist_names?.[0] ?? "")))
    .slice(0, 5)
    .map((t) => ({
      trackName: t.track_name,
      artistName: t.artist_names?.[0] ?? "",
      albumImageUrl: t.album_image_url ?? null,
    }));

  const artistOverlap = overlapPct(myNameSet, theirNameSet);
  const genreOverlap = overlapPct(new Set(myGenres.map(norm)), theirGenreSet);
  const trackOverlap = overlapPct(myTrackSet, theirTrackSet);
  const similarityScore = Math.round(artistOverlap * 0.5 + genreOverlap * 0.35 + trackOverlap * 0.15);
  const friendBreakTarget = [
    ...theirUniqueGenres.slice(0, 3),
    ...theirUniqueArtists.slice(0, 4),
  ].join(", ");
  const friendBreakPrompt = `Break my Spotify loop using ${targetProfile.display_name}'s taste as direction: ${friendBreakTarget || theirList.slice(0, 5).map((a) => a.artist_name).join(", ")}`;

  // Human description of compatibility
  function compatibilityLabel(score: number): string {
    if (score >= 70) return "Musical twins";
    if (score >= 50) return "Strong overlap";
    if (score >= 30) return "Solid common ground";
    if (score >= 15) return "Some crossover";
    return "Opposite ends of the spectrum";
  }

  function compatibilityDesc(score: number, theirName: string): string {
    if (score >= 70)
      return `You and ${theirName} could swap playlists and neither of you would notice. Your tastes are almost identical.`;
    if (score >= 50)
      return `You share a lot of the same artists — there's real common ground here, with just enough difference to keep things interesting.`;
    if (score >= 30)
      return `You've got a solid overlap in taste. You'd enjoy each other's music, but you'd also discover new things from each other's side.`;
    if (score >= 15)
      return `Your tastes touch in places, but you're mostly exploring different sounds. A great combination for broadening each other's world.`;
    return `You and ${theirName} are on opposite ends of the musical spectrum — but that's what makes the crossover moments so surprising.`;
  }

  return NextResponse.json({
    targetUser: {
      id: targetProfile.id,
      displayName: targetProfile.display_name,
      username: targetProfile.username,
      avatarUrl: targetProfile.avatar_url,
    },
    similarityScore,
    compatibilityLabel: compatibilityLabel(similarityScore),
    compatibilityDesc: compatibilityDesc(similarityScore, targetProfile.display_name),
    sharedArtists,
    sharedTracks,
    myUniqueArtists,
    theirUniqueArtists,
    sharedGenres,
    myTopGenres: myGenres.slice(0, 5),
    theirTopGenres: theirGenres.slice(0, 5),
    theirUniqueGenres,
    matchBreakdown: {
      artists: artistOverlap,
      genres: genreOverlap,
      tracks: trackOverlap,
    },
    friendBreakTarget,
    friendBreakPrompt,
  });
}
