import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface ArtistRow {
  user_id: string;
  artist_name: string;
  genres: string[] | null;
  rank: number;
}

interface FriendProfile {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
}

function norm(value: string): string {
  return value.toLowerCase().trim();
}

function overlapPct(a: Set<string>, b: Set<string>): number {
  const unionSize = new Set([...a, ...b]).size;
  if (unionSize === 0) return 0;
  const intersectionSize = [...a].filter((item) => b.has(item)).length;
  return Math.round((intersectionSize / unionSize) * 100);
}

function topGenres(artists: ArtistRow[], limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const artist of artists) {
    for (const genre of artist.genres ?? []) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([genre]) => genre);
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: follows } = await admin
    .from("user_followers")
    .select("following_id")
    .eq("follower_id", user.id);

  const ids = [...new Set((follows ?? []).map((follow) => follow.following_id as string))];
  if (ids.length === 0) {
    return NextResponse.json({ following: [], closest: null, mostDifferent: null });
  }

  const [{ data: profiles }, { data: myArtists }, { data: friendArtists }] = await Promise.all([
    admin
      .from("user_profiles")
      .select("id, display_name, username, avatar_url, bio")
      .in("id", ids),
    admin
      .from("user_top_artists")
      .select("user_id, artist_name, genres, rank")
      .eq("user_id", user.id)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(50),
    admin
      .from("user_top_artists")
      .select("user_id, artist_name, genres, rank")
      .in("user_id", ids)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(500),
  ]);

  const mine = (myArtists ?? []) as ArtistRow[];
  const myArtistSet = new Set(mine.map((artist) => norm(artist.artist_name)));
  const myGenreSet = new Set(mine.flatMap((artist) => artist.genres ?? []).map(norm));
  const friendRows = (friendArtists ?? []) as ArtistRow[];

  const following = ((profiles ?? []) as FriendProfile[])
    .map((profile) => {
      const artists = friendRows
        .filter((artist) => artist.user_id === profile.id)
        .sort((a, b) => a.rank - b.rank);
      const artistSet = new Set(artists.map((artist) => norm(artist.artist_name)));
      const genreList = topGenres(artists);
      const genreSet = new Set(artists.flatMap((artist) => artist.genres ?? []).map(norm));
      const artistOverlap = overlapPct(myArtistSet, artistSet);
      const genreOverlap = overlapPct(myGenreSet, genreSet);
      const compatibilityScore = Math.round(artistOverlap * 0.55 + genreOverlap * 0.45);
      const uniqueArtists = artists
        .filter((artist) => !myArtistSet.has(norm(artist.artist_name)))
        .slice(0, 3)
        .map((artist) => artist.artist_name);
      const uniqueGenres = genreList.filter((genre) => !myGenreSet.has(norm(genre))).slice(0, 3);

      return {
        id: profile.id,
        displayName: profile.display_name,
        username: profile.username,
        avatarUrl: profile.avatar_url,
        bio: profile.bio,
        topGenres: genreList,
        compatibilityScore,
        uniqueArtists,
        uniqueGenres,
      };
    })
    .sort((a, b) => b.compatibilityScore - a.compatibilityScore);

  return NextResponse.json({
    following,
    closest: following[0] ?? null,
    mostDifferent: [...following].sort((a, b) => a.compatibilityScore - b.compatibilityScore)[0] ?? null,
  });
}
