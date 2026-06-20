-- Inbox organization + last reply tracking.
-- Additive only. Safe to run after 005_attachments.sql.

alter table public.campaign_messages
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists flagged boolean default false,
  add column if not exists last_reply_at timestamptz;

comment on column public.campaign_messages.archived_at is
  'Knock-level archive timestamp. Does not archive the Gmail thread.';
comment on column public.campaign_messages.deleted_at is
  'Knock-level hidden/deleted timestamp. Does not delete from Gmail.';
comment on column public.campaign_messages.flagged is
  'Knock-level flag/star for inbox organization.';
comment on column public.campaign_messages.last_reply_at is
  'Latest inbound Gmail message timestamp detected for this thread.';

comment on column public.profiles.plan is
  'free | pro | unlimited';

create index if not exists campaign_messages_inbox_org_idx
  on public.campaign_messages (user_id, deleted_at, archived_at, flagged, last_reply_at);
