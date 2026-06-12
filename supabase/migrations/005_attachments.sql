-- Email attachments (resume + up to 5 extra files per send) and manual
-- contact imports. Additive only — safe to run on a live project after
-- 001_init.sql through 004_app_state.sql.

-- ============ user_files: uploaded attachments ============
-- Files are small (5MB cap, enforced in /api/files) so they live as base64
-- in the row. Only the server (service role) reads data_base64; the client
-- never receives file bytes back, just metadata.
create table if not exists public.user_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null default 'attachment',     -- 'resume' | 'attachment'
  name text not null,
  mime text,
  size_bytes integer,
  data_base64 text not null,
  created_at timestamptz default now()
);

create index if not exists user_files_user_idx on public.user_files (user_id, kind);

-- The client talks to /api/files (service role) rather than PostgREST, so RLS
-- here is belt-and-braces: enable it with no policies → anon/auth roles get
-- nothing, service role bypasses.
alter table public.user_files enable row level security;

-- ============ campaign_messages: attachments on a send ============
alter table public.campaign_messages
  add column if not exists attachments jsonb;  -- [{ fileId, name }] queued with the message

comment on column public.campaign_messages.attachments is
  'Files attached to this send: [{ fileId, name }]. fileId references user_files; resolved server-side at send time (including scheduled sends).';
