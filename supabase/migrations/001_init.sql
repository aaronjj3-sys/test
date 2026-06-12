-- Knock MVP schema. Run in the Supabase SQL editor (or supabase db push).
-- All user-owned tables get RLS so users can only touch their own rows.

create extension if not exists "pgcrypto";

-- ============ profiles ============
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text,
  email text,
  school text,
  location text,
  story text,
  target text,
  resume_text text,
  goals jsonb default '[]',
  industries jsonb default '[]',
  target_roles jsonb default '[]',
  target_companies jsonb default '[]',
  tone text default 'sharp',
  quantified_wins jsonb default '[]',
  skills jsonb default '[]',
  outreach_angles jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id)
);

-- ============ doors ============
create table if not exists public.doors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text default 'apollo',
  status text default 'found', -- found | drafted | approved | queued | sent | opened | replied | archived
  apollo_person_id text,
  apollo_organization_id text,
  name text not null,
  first_name text,
  last_name text,
  title text,
  company_name text,
  company_domain text,
  linkedin_url text,
  email text,
  email_status text,
  location text,
  photo_url text,
  seniority text,
  match_score int default 0,
  match_reasons jsonb default '[]',
  signals jsonb default '{}',
  draft_subject text,
  draft_preview text,
  draft_body text,
  raw jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists doors_user_idx on public.doors (user_id, status);

-- ============ campaigns ============
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  status text default 'queued', -- draft | queued | sending | paused | completed
  selected_door_ids jsonb default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ campaign_messages ============
create table if not exists public.campaign_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  door_id uuid references public.doors(id) on delete set null,
  subject text,
  body text,
  status text default 'queued', -- draft | queued | sent | failed | replied
  scheduled_at timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ oauth_connections (Gmail / Calendar / LinkedIn identity) ============
create table if not exists public.oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null, -- google | gmail | google_calendar | outlook | linkedin
  provider_email text,
  provider_user_id text,
  scopes jsonb default '[]',
  status text default 'connected',
  -- tokens are stored encrypted server-side only; never readable by the client
  access_token_encrypted text,
  refresh_token_encrypted text,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, provider)
);

-- ============ email_events ============
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.campaign_messages(id) on delete cascade,
  event_type text, -- queued | sent | opened | replied | bounced
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- ============ RLS ============
alter table public.profiles enable row level security;
alter table public.doors enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_messages enable row level security;
alter table public.oauth_connections enable row level security;
alter table public.email_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','doors','campaigns','campaign_messages','oauth_connections','email_events'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t
    );
  end loop;
end $$;

-- oauth tokens must never be readable from the client even on own rows:
drop policy if exists "own rows" on public.oauth_connections;
create policy "own rows read" on public.oauth_connections
  for select using (auth.uid() = user_id);
create policy "own rows write" on public.oauth_connections
  for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.oauth_connections
  for update using (auth.uid() = user_id);
revoke select (access_token_encrypted, refresh_token_encrypted) on public.oauth_connections from anon, authenticated;
