-- Adds metadata used by the Google Gmail/Calendar connection flow.
-- Run this after 001_init.sql if your Supabase project was already created.

alter table public.oauth_connections
  add column if not exists expires_at timestamptz;

comment on column public.oauth_connections.provider is
  'google | gmail | google_calendar | outlook | linkedin';
