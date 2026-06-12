-- Gmail sending + reply monitoring columns. Additive only — safe to run on a
-- live project after 001_init.sql and 002_google_oauth.sql.

-- ============ campaign_messages: send/monitor state ============
alter table public.campaign_messages
  add column if not exists to_email text,
  add column if not exists to_name text,
  add column if not exists followup_count int default 0,
  add column if not exists last_followup_at timestamptz,
  add column if not exists reply_classification jsonb,
  add column if not exists reply_summary text,
  add column if not exists suggested_reply jsonb,
  add column if not exists gmail_draft_id text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists door_snapshot jsonb; -- door object at send time, drafting context

-- ============ profiles: plan + agent preferences ============
alter table public.profiles
  add column if not exists plan text default 'free',          -- free | pro
  add column if not exists autonomy jsonb,                    -- { review, followups, replies, weekends }
  add column if not exists send_prefs jsonb,
  add column if not exists style_profile jsonb,
  add column if not exists profile_json jsonb;                -- full client profile blob

-- ============ status values ============
-- 001_init.sql documents statuses in comments only (no CHECK constraint), so
-- the expanded set needs no recreate. Drop defensively in case a constraint
-- was added out-of-band, then document the allowed set.
alter table public.campaign_messages drop constraint if exists campaign_messages_status_check;
comment on column public.campaign_messages.status is
  'draft | queued | scheduled | sending | sent | followup_sent | replied | needs_review | failed';

-- email_events has no CHECK constraint either; document the expanded set.
alter table public.email_events drop constraint if exists email_events_event_type_check;
comment on column public.email_events.event_type is
  'queued | sent | opened | replied | bounced | followup_sent | meeting_created';

create index if not exists campaign_messages_monitor_idx
  on public.campaign_messages (user_id, status, scheduled_at);
