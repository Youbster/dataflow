import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") || "tracks";
  const timeRange = searchParams.get("time_range") || "medium_term";

  const table = type === "artists" ? "user_top_artists" : "user_top_tracks";

  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", user.id)
    .eq("time_range", timeRange)
    .order("rank", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: data });
}
