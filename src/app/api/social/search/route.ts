import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface SocialSearchProfile {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  isFollowing: boolean;
}

function cleanSearchTerm(value: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[%_]/g, "")
    .slice(0, 60);
}

function mergeProfiles(
  rows: Array<{
    id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    bio: string | null;
  }>,
  followedIds: Set<string>,
): SocialSearchProfile[] {
  const seen = new Set<string>();
  const profiles: SocialSearchProfile[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    profiles.push({ ...row, isFollowing: followedIds.has(row.id) });
  }

  return profiles.slice(0, 10);
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = cleanSearchTerm(request.nextUrl.searchParams.get("q"));
  if (q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const admin = createAdminClient();
  const selectColumns = "id, display_name, username, avatar_url, bio";

  const [{ data: usernameRows }, { data: displayNameRows }, { data: follows }] = await Promise.all([
    admin
      .from("user_profiles")
      .select(selectColumns)
      .eq("is_public", true)
      .neq("id", user.id)
      .ilike("username", `%${q}%`)
      .limit(10),
    admin
      .from("user_profiles")
      .select(selectColumns)
      .eq("is_public", true)
      .neq("id", user.id)
      .ilike("display_name", `%${q}%`)
      .limit(10),
    admin
      .from("user_followers")
      .select("following_id")
      .eq("follower_id", user.id),
  ]);

  const followedIds = new Set((follows ?? []).map((row) => row.following_id as string));
  const users = mergeProfiles(
    [...(usernameRows ?? []), ...(displayNameRows ?? [])],
    followedIds,
  );

  return NextResponse.json({ users });
}
