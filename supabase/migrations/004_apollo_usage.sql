-- Per-user Apollo usage counters. This keeps the sidebar widget honest across
-- logout/login and avoids relying on browser localStorage.

create table if not exists public.apollo_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_key text not null,
  month_key text not null,
  api_calls_today int default 0,
  people_searched_month int default 0,
  enrich_credits_month int default 0,
  updated_at timestamptz default now(),
  unique (user_id)
);

alter table public.apollo_usage enable row level security;

drop policy if exists "own rows" on public.apollo_usage;
create policy "own rows" on public.apollo_usage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
