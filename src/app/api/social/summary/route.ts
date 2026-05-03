import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface ArtistRow {
  user_id: string;
  artist_name: string;
  genres: string[] | null;
  rank: number;
}

interface TrackRow {
  user_id: string;
  track_name: string;
  artist_names: string[] | null;
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
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  return [...a].filter((item) => item && b.has(item)).length;
}

function overlapScore(count: number, pointsEach: number): number {
  return Math.min(100, count * pointsEach);
}

function trackKey(trackName: string, artistName: string): string {
  return norm(`${trackName}|||${artistName}`);
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

  const [{ data: profiles }, { data: myArtists }, { data: friendArtists }, { data: myTracks }, { data: friendTracks }] = await Promise.all([
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
    admin
      .from("user_top_tracks")
      .select("user_id, track_name, artist_names, rank")
      .eq("user_id", user.id)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(50),
    admin
      .from("user_top_tracks")
      .select("user_id, track_name, artist_names, rank")
      .in("user_id", ids)
      .eq("time_range", "medium_term")
      .order("rank")
      .limit(500),
  ]);

  const mine = (myArtists ?? []) as ArtistRow[];
  const myTrackRows = (myTracks ?? []) as TrackRow[];
  const myArtistSet = new Set(mine.map((artist) => norm(artist.artist_name)));
  const myTrackArtistSet = new Set(myTrackRows.flatMap((track) => track.artist_names ?? []).map(norm));
  const myCombinedArtistSet = new Set([...myArtistSet, ...myTrackArtistSet]);
  const myGenreSet = new Set(mine.flatMap((artist) => artist.genres ?? []).map(norm));
  const myTrackSet = new Set(myTrackRows.map((track) => trackKey(track.track_name, track.artist_names?.[0] ?? "")));
  const friendRows = (friendArtists ?? []) as ArtistRow[];
  const friendTrackRows = (friendTracks ?? []) as TrackRow[];

  const following = ((profiles ?? []) as FriendProfile[])
    .map((profile) => {
      const artists = friendRows
        .filter((artist) => artist.user_id === profile.id)
        .sort((a, b) => a.rank - b.rank);
      const artistSet = new Set(artists.map((artist) => norm(artist.artist_name)));
      const tracks = friendTrackRows
        .filter((track) => track.user_id === profile.id)
        .sort((a, b) => a.rank - b.rank);
      const trackArtistSet = new Set(tracks.flatMap((track) => track.artist_names ?? []).map(norm));
      const combinedArtistSet = new Set([...artistSet, ...trackArtistSet]);
      const trackSet = new Set(tracks.map((track) => trackKey(track.track_name, track.artist_names?.[0] ?? "")));
      const genreList = topGenres(artists);
      const genreSet = new Set(artists.flatMap((artist) => artist.genres ?? []).map(norm));
      const sharedArtistCount = countOverlap(myCombinedArtistSet, combinedArtistSet);
      const sharedGenreCount = countOverlap(myGenreSet, genreSet);
      const sharedTrackCount = countOverlap(myTrackSet, trackSet);
      const artistOverlap = overlapScore(sharedArtistCount, 10);
      const genreOverlap = overlapScore(sharedGenreCount, 14);
      const trackOverlap = overlapScore(sharedTrackCount, 18);
      const compatibilityScore = Math.min(
        100,
        Math.max(
          sharedTrackCount > 0 ? 10 : 0,
          sharedArtistCount > 0 ? 8 : 0,
          Math.round(artistOverlap * 0.45 + genreOverlap * 0.25 + trackOverlap * 0.3),
        ),
      );
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
