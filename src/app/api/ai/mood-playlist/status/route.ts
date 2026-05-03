import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const { data: job, error } = await createAdminClient()
    .from("playlist_generation_jobs")
    .select("id, status, result_json, error, created_at, updated_at, completed_at")
    .eq("id", jobId)
    .eq("user_id", session.user.id)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Playlist generation job not found" }, { status: 404 });
  }

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    result: job.result_json ?? null,
    error: job.error ?? null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  });
}
