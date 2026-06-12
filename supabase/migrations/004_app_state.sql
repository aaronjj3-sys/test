-- Cross-device app state sync. Additive only — safe to run on a live project
-- after 001_init.sql, 002_google_oauth.sql, and 003_sending.sql.

alter table public.profiles
  add column if not exists app_state jsonb;

comment on column public.profiles.app_state is
  'Synced client state blob (doors, campaigns, messages, knocks, filters) for cross-device continuity. Read and written directly by the client under RLS.';

-- RLS check: 001_init.sql creates the "own rows" policy on public.profiles as
-- FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id),
-- which already covers owner SELECT, INSERT, UPDATE, and DELETE. No additional
-- policy is required for the client to read/write app_state on its own row.
