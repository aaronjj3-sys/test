/* Scout's send/monitor orchestrator. syncUser(userId) is the single pass the
   app calls while open (api/gmail/sync.js) and the daily cron calls off-hours
   (api/cron/monitor.js):

   1. Send due scheduled messages (plan-guarded).
   2. Detect replies on sent threads → classify → draft a reply (Meet link if
      they want a call). Review-first by default: the reply is stored as a
      suggestion + Gmail draft; auto-send only when autonomy.review === false.
   3. Send polite follow-ups: 3 days after send, max 2, weekends respected.

   Work is bounded per invocation (max ~20 Gmail thread fetches). */

import { supabaseConfigured, sbSelect, sbInsert, sbUpdate } from "../supabase/admin.js";
import { getGoogleConnection, sendEmail, getThread, createDraft, loadAttachments } from "./client.js";
import { createMeetEvent } from "../google/calendar.js";

/* lib/knock/replies.js + openai.js are loaded lazily so scheduled sends and
   the plan guard keep working even if the LLM layer isn't deployed yet. */
async function loadLlm() {
  try {
    const [replies, openai] = await Promise.all([
      import("../knock/replies.js"),
      import("../knock/openai.js"),
    ]);
    return openai.openaiConfigured() ? replies : null;
  } catch (err) {
    console.error("LLM reply layer unavailable:", err.message);
    return null;
  }
}

export const MONTHLY_LIMITS = { free: 15, pro: 200 };
const MAX_THREAD_FETCHES = 20;
const MAX_SCHEDULED_PER_RUN = 10;
const MAX_FOLLOWUPS_PER_RUN = 10;
const FOLLOWUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_FOLLOWUPS = 2;
const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

export function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function monthlySendCount(userId) {
  const rows = await sbSelect("campaign_messages", {
    filter: {
      user_id: userId,
      status: "in.(sent,followup_sent,replied)",
      sent_at: `gte.${monthStartIso()}`,
    },
    select: "id",
  });
  return rows ? rows.length : 0;
}

export async function planLimit(userId) {
  const rows = await sbSelect("profiles", { filter: { user_id: userId }, select: "plan", limit: 1 });
  const plan = rows?.[0]?.plan === "pro" ? "pro" : "free";
  return MONTHLY_LIMITS[plan];
}

function isWeekend(date = new Date()) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function afterSentAt(thread, sentAtIso) {
  const sentAt = sentAtIso ? Date.parse(sentAtIso) : 0;
  return thread.filter((m) => {
    if (m.isFromMe) return false;
    const ts = Date.parse(m.date);
    return Number.isNaN(ts) ? true : ts > sentAt;
  });
}

function threadHeaders(thread) {
  const ids = thread.map((m) => m.messageIdHeader).filter(Boolean);
  return {
    inReplyTo: ids[ids.length - 1] || null,
    references: ids.join(" ") || null,
  };
}

function doorFromRow(row) {
  return (
    row.door_snapshot || {
      id: row.door_id,
      name: row.to_name,
      firstName: (row.to_name || "").split(" ")[0],
      email: row.to_email,
    }
  );
}

async function logEvent(userId, messageId, eventType, metadata = {}) {
  await sbInsert("email_events", [
    { user_id: userId, message_id: messageId, event_type: eventType, metadata },
  ]);
}

export async function syncUser(userId) {
  if (!supabaseConfigured()) return { ok: false, error: "supabase_not_configured" };

  const connection = await getGoogleConnection(userId);
  if (!connection) return { ok: false, error: "google_not_connected" };

  const profileRows = await sbSelect("profiles", { filter: { user_id: userId }, limit: 1 });
  const profileRow = profileRows?.[0] || {};
  const profile = profileRow.profile_json || {
    fullName: profileRow.full_name,
    email: profileRow.email,
    school: profileRow.school,
    story: profileRow.story,
    tone: profileRow.tone,
  };
  const autonomy = profileRow.autonomy || {};
  const review = autonomy.review !== false; // review-before-sending, default TRUE
  const followupsAllowed = autonomy.followups !== false;
  const repliesAllowed = autonomy.replies !== false;
  const tone = profile.tone || profileRow.tone || "Sharp";
  const styleProfile = profileRow.style_profile || profile.styleProfile || null;
  const replies = await loadLlm();

  const nowIso = new Date().toISOString();
  const counts = { scheduledSent: 0, replies: 0, followupsSent: 0, draftsCreated: 0 };
  const updates = [];
  let threadFetches = 0;

  const limit = profileRow.plan === "pro" ? MONTHLY_LIMITS.pro : MONTHLY_LIMITS.free;
  let remaining = Math.max(0, limit - (await monthlySendCount(userId)));

  /* ---- b. due scheduled sends ---- */
  const due =
    (await sbSelect("campaign_messages", {
      filter: { user_id: userId, status: "scheduled", scheduled_at: `lte.${nowIso}` },
      limit: MAX_SCHEDULED_PER_RUN,
    })) || [];

  for (const row of due) {
    if (remaining <= 0) break;
    const doorId = doorFromRow(row).id;
    try {
      const attachments = Array.isArray(row.attachments) && row.attachments.length
        ? await loadAttachments(userId, row.attachments)
        : [];
      const sent = await sendEmail({
        userId,
        to: row.to_email,
        toName: row.to_name,
        subject: row.subject,
        body: row.body,
        attachments,
      });
      await sbUpdate(
        "campaign_messages",
        { id: row.id, user_id: userId },
        {
          status: "sent",
          sent_at: nowIso,
          gmail_message_id: sent.gmailMessageId,
          gmail_thread_id: sent.threadId,
          updated_at: nowIso,
        }
      );
      await logEvent(userId, row.id, "sent", { source: "scheduled" });
      remaining -= 1;
      counts.scheduledSent += 1;
      updates.push({ messageId: row.id, doorId, status: "sent" });
    } catch (err) {
      console.error("Scheduled send failed:", err.message);
      await sbUpdate(
        "campaign_messages",
        { id: row.id, user_id: userId },
        { status: "failed", updated_at: nowIso }
      );
      updates.push({ messageId: row.id, doorId, status: "failed" });
    }
  }

  /* ---- c. reply detection ---- */
  const cooledOff = new Date(Date.now() - SYNC_COOLDOWN_MS).toISOString();
  const watching =
    (await sbSelect("campaign_messages", {
      filter: {
        user_id: userId,
        status: "in.(sent,followup_sent)",
        gmail_thread_id: "not.is.null",
      },
      limit: 40,
    })) || [];

  const toCheck = watching
    .filter((r) => !r.last_synced_at || r.last_synced_at < cooledOff)
    .slice(0, MAX_THREAD_FETCHES);

  for (const row of toCheck) {
    if (threadFetches >= MAX_THREAD_FETCHES) break;
    threadFetches += 1;

    let thread;
    try {
      thread = await getThread(userId, row.gmail_thread_id);
    } catch (err) {
      console.error("Thread fetch failed:", err.message);
      continue;
    }
    await sbUpdate(
      "campaign_messages",
      { id: row.id, user_id: userId },
      { last_synced_at: nowIso, updated_at: nowIso }
    );

    const inbound = afterSentAt(thread, row.sent_at);
    if (!inbound.length) continue;

    const door = doorFromRow(row);
    const threadMessages = thread.map((m) => ({
      from: m.from,
      date: m.date,
      body: m.body,
      subject: m.subject,
      isFromMe: Boolean(m.isFromMe),
    }));

    let classification = null;
    if (replies) {
      try {
        classification = await replies.classifyReply({ profile, door, threadMessages });
      } catch (err) {
        console.error("Reply classification failed:", err.message);
      }
    }

    counts.replies += 1;
    const patch = {
      status: "replied",
      reply_classification: classification,
      reply_summary: classification?.summary || null,
      updated_at: nowIso,
    };
    const update = { messageId: row.id, doorId: door.id, status: "replied", threadMessages: threadMessages.slice(-8) };
    if (classification) update.classification = classification;
    await logEvent(userId, row.id, "replied", {
      type: classification?.type || null,
      sentiment: classification?.sentiment || null,
    });

    if (repliesAllowed && replies) {
      let meetLink = null;
      if (classification?.wantsCall) {
        const event = await createMeetEvent({
          userId,
          summary: `Intro call — ${door.name || row.to_name || "Knock"}`,
          description: "Scheduled by Scout via Knock.",
          attendeeEmail: row.to_email,
        });
        if (event?.meetLink) {
          meetLink = { url: event.meetLink, when: event.start };
          update.meetLink = meetLink;
          await logEvent(userId, row.id, "meeting_created", {
            eventId: event.eventId,
            start: event.start,
          });
        }
      }

      let reply = null;
      try {
        reply = await replies.draftReply({ profile, door, threadMessages, classification, tone, styleProfile, meetLink });
      } catch (err) {
        console.error("Reply drafting failed:", err.message);
      }

      if (reply) {
        const { inReplyTo, references } = threadHeaders(thread);
        if (review) {
          patch.suggested_reply = { kind: "reply", subject: reply.subject, body: reply.body, meetLink };
          update.suggestedReply = patch.suggested_reply;
          try {
            const draftId = await createDraft({
              userId,
              to: row.to_email,
              toName: row.to_name,
              subject: reply.subject,
              body: reply.body,
              threadId: row.gmail_thread_id,
              inReplyTo,
              references,
            });
            if (draftId) {
              patch.gmail_draft_id = draftId;
              counts.draftsCreated += 1;
            }
          } catch (err) {
            console.error("Gmail draft create failed:", err.message);
          }
        } else {
          try {
            const sent = await sendEmail({
              userId,
              to: row.to_email,
              toName: row.to_name,
              subject: reply.subject,
              body: reply.body,
              threadId: row.gmail_thread_id,
              inReplyTo,
              references,
            });
            await logEvent(userId, row.id, "sent", { kind: "auto_reply", gmailMessageId: sent.gmailMessageId });
            update.autoReplied = true;
          } catch (err) {
            console.error("Auto-reply send failed:", err.message);
          }
        }
      }
    }

    await sbUpdate("campaign_messages", { id: row.id, user_id: userId }, patch);
    updates.push(update);
  }

  /* ---- d. follow-ups ---- */
  const weekendBlocked = autonomy.weekends === false && isWeekend();
  if (followupsAllowed && replies && !weekendBlocked) {
    const followupDue = new Date(Date.now() - FOLLOWUP_AFTER_MS).toISOString();
    const candidates =
      (await sbSelect("campaign_messages", {
        filter: {
          user_id: userId,
          status: "sent",
          sent_at: `lte.${followupDue}`,
          followup_count: `lt.${MAX_FOLLOWUPS}`,
        },
        limit: MAX_FOLLOWUPS_PER_RUN,
      })) || [];

    for (const row of candidates) {
      if (row.last_followup_at && row.last_followup_at > followupDue) continue;
      const door = doorFromRow(row);

      /* Confirm no reply slipped past the watcher before nudging. */
      let thread = [];
      if (row.gmail_thread_id) {
        if (threadFetches >= MAX_THREAD_FETCHES) break;
        threadFetches += 1;
        try {
          thread = await getThread(userId, row.gmail_thread_id);
        } catch (err) {
          console.error("Follow-up thread check failed:", err.message);
          continue;
        }
        if (afterSentAt(thread, row.sent_at).length) continue; // reply pass picks it up
      }

      const followupNumber = (row.followup_count || 0) + 1;
      let followup = null;
      try {
        followup = await replies.draftFollowup({
          profile,
          door,
          previousMessage: { subject: row.subject, body: row.body, sentAt: row.sent_at },
          followupNumber,
          tone,
          styleProfile,
        });
      } catch (err) {
        console.error("Follow-up drafting failed:", err.message);
      }
      if (!followup) continue;

      const { inReplyTo, references } = threadHeaders(thread);

      if (review) {
        const patch = {
          status: "needs_review",
          suggested_reply: { kind: "followup", subject: followup.subject, body: followup.body, followupNumber },
          updated_at: nowIso,
        };
        try {
          const draftId = await createDraft({
            userId,
            to: row.to_email,
            toName: row.to_name,
            subject: followup.subject,
            body: followup.body,
            threadId: row.gmail_thread_id,
            inReplyTo,
            references,
          });
          if (draftId) {
            patch.gmail_draft_id = draftId;
            counts.draftsCreated += 1;
          }
        } catch (err) {
          console.error("Follow-up draft create failed:", err.message);
        }
        await sbUpdate("campaign_messages", { id: row.id, user_id: userId }, patch);
        updates.push({
          messageId: row.id,
          doorId: door.id,
          status: "needs_review",
          suggestedReply: patch.suggested_reply,
          followupNumber,
        });
      } else {
        try {
          const sent = await sendEmail({
            userId,
            to: row.to_email,
            toName: row.to_name,
            subject: followup.subject,
            body: followup.body,
            threadId: row.gmail_thread_id,
            inReplyTo,
            references,
          });
          await sbUpdate(
            "campaign_messages",
            { id: row.id, user_id: userId },
            {
              status: "followup_sent",
              followup_count: followupNumber,
              last_followup_at: nowIso,
              updated_at: nowIso,
            }
          );
          await logEvent(userId, row.id, "followup_sent", {
            followupNumber,
            gmailMessageId: sent.gmailMessageId,
          });
          counts.followupsSent += 1;
          updates.push({ messageId: row.id, doorId: door.id, status: "followup_sent", followupNumber });
        } catch (err) {
          console.error("Follow-up send failed:", err.message);
        }
      }
    }
  }

  return { ok: true, updates, counts };
}
