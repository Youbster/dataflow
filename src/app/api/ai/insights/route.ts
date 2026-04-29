import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateInsights } from "@/lib/claude/insights";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const insights = await generateInsights(user.id);
    return NextResponse.json({ insights });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Insight generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
