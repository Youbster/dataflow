import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generatePlaylist } from "@/lib/claude/playlist-generator";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { prompt, trackCount } = await request.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 }
      );
    }

    const result = await generatePlaylist(
      user.id,
      prompt,
      Math.min(trackCount || 20, 50)
    );

    return NextResponse.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Playlist generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
