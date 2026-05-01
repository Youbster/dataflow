import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculateStalenessScores } from "@/lib/staleness/calculator";
import { suggestFreshAlternatives } from "@/lib/claude/staleness-analyzer";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { results, health } = await calculateStalenessScores(user.id);
    return NextResponse.json({ scores: results, health });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Staleness calculation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { staleTracks } = await request.json();
    const suggestions = await suggestFreshAlternatives(user.id, staleTracks);
    return NextResponse.json({ suggestions });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Suggestion generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
