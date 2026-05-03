-- Async playlist generation jobs keep long Spotify/OpenAI work out of the
-- browser request path, which is important on Vercel's free 30s function cap.
create table if not exists public.playlist_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  request_body jsonb not null default '{}'::jsonb,
  result_json jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists playlist_generation_jobs_user_created_idx
  on public.playlist_generation_jobs(user_id, created_at desc);

alter table public.playlist_generation_jobs enable row level security;

drop policy if exists "Users can view own playlist generation jobs"
  on public.playlist_generation_jobs;

create policy "Users can view own playlist generation jobs"
  on public.playlist_generation_jobs
  for select
  using (auth.uid() = user_id);
