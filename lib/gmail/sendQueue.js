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
import { availabilityOptions, createMeetEvent, DEFAULT_TZ, parseRequestedMeetingTime } from "../google/calendar.js";

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

export const MONTHLY_LIMITS = { free: 15, pro: 200, unlimited: 9999 };
const MAX_THREAD_FETCHES = 20;
const MAX_SCHEDULED_PER_RUN = 10;
const MAX_FOLLOWUPS_PER_RUN = 10;
const FOLLOWUP_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_FOLLOWUPS = 2;
const SYNC_COOLDOWN_MS = 12 * 1000;

export function monthStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export async function monthlySendCount(userId) {
  const rows = await sbSelect("campaign_messages", {
    filter: {
      user_id: userId,
      status: "in.(sent,followup_sent,opened,replied,needs_review,meeting)",
      sent_at: `gte.${monthStartIso()}`,
    },
    select: "id",
  });
  return rows ? rows.length : 0;
}

export async function planLimit(userId) {
  const rows = await sbSelect("profiles", { filter: { user_id: userId }, select: "plan", limit: 1 });
  const plan = rows?.[0]?.plan === "unlimited" ? "unlimited" : rows?.[0]?.plan === "pro" ? "pro" : "free";
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

function latestUnhandledInbound(thread, row) {
  const inbound = thread.filter((m) => !m.isFromMe);
  const latest = inbound[inbound.length - 1];
  if (!latest) return null;
  const latestOutbound = [...thread].reverse().find((m) => m.isFromMe);
  if (latestOutbound) {
    const inTs = Date.parse(latest.date);
    const outTs = Date.parse(latestOutbound.date);
    if (Number.isFinite(inTs) && Number.isFinite(outTs) && inTs <= outTs) return null;
  }
  const handledId = row.reply_classification?.lastInboundId || row.suggested_reply?.lastInboundId || null;
  if (latest.id && handledId === latest.id) return null;
  return latest;
}

function fallbackClassification(body = "") {
  const text = String(body || "").toLowerCase();
  if (/\b(first|1st|one|second|2nd|two|third|3rd|three)\b/.test(text) && /\b(work|works|good|fine|great|perfect|yes|yep|sure)\b/.test(text)) {
    return {
      type: "positive_meeting",
      wantsCall: true,
      sentiment: "positive",
      summary: "They accepted one of the proposed times.",
      scheduling: { intent: "confirms_time", timeText: body.slice(0, 180), dateTime: "" },
    };
  }
  const hasTime = /\b(?:today|tomorrow|next week|mon(?:day)?|tue(?:sday|s)?|wed(?:nesday)?|thu(?:rsday|rs)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/.test(text) &&
    /\b(?:at\s+)?(?:1[0-2]|0?[1-9])(?::[0-5]\d)?\s*(?:am|pm)?\b/.test(text);
  if (hasTime) {
    return {
      type: "positive_meeting",
      wantsCall: true,
      sentiment: "positive",
      summary: "They proposed a time to meet.",
      scheduling: { intent: "proposes_time", timeText: body.slice(0, 180), dateTime: "" },
    };
  }
  if (/\b(availability|available|free|when works|what works|next week|this week)\b/.test(text)) {
    return {
      type: "positive_meeting",
      wantsCall: true,
      sentiment: "positive",
      summary: "They asked for availability.",
      scheduling: { intent: "asks_availability", timeText: body.slice(0, 180), dateTime: "" },
    };
  }
  return null;
}

function optionAcceptedFromReply(body = "", options = []) {
  const text = String(body || "").toLowerCase();
  const n =
    /\b(first|1st|option 1|one)\b/.test(text) ? 0 :
      /\b(second|2nd|option 2|two)\b/.test(text) ? 1 :
        /\b(third|3rd|option 3|three)\b/.test(text) ? 2 :
          -1;
  return n >= 0 ? options[n] || null : null;
}

function trackingBaseUrl() {
  if (process.env.PUBLIC_APP_URL) return process.env.PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

function openTrackingUrl(userId, messageId) {
  return null;
}

function threadHeaders(thread) {
  const ids = thread.map((m) => m.messageIdHeader).filter(Boolean);
  return {
    inReplyTo: ids[ids.length - 1] || null,
    references: ids.join(" ") || null,
  };
}

function normalizeThreadMessages(thread = []) {
  return thread.map((m) => ({
    id: m.id,
    from: m.from,
    to: m.to,
    date: m.date,
    body: m.body,
    subject: m.subject,
    isFromMe: Boolean(m.isFromMe),
    attachments: m.attachments || [],
  }));
}

function latestInboundMessage(threadMessages = []) {
  return [...threadMessages].reverse().find((m) => !m.isFromMe) || null;
}

function flattenThreadAttachments(threadMessages = []) {
  return threadMessages.flatMap((m) =>
    (m.attachments || []).map((a) => ({ ...a, messageId: a.messageId || m.id }))
  );
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

  const limit = MONTHLY_LIMITS[profileRow.plan] || MONTHLY_LIMITS.free;
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
        trackOpenUrl: openTrackingUrl(userId, row.id),
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
        status: "in.(sent,followup_sent,opened,replied,needs_review,meeting)",
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
    const door = doorFromRow(row);
    const threadMessages = normalizeThreadMessages(thread);
    const latestThreadMessage = threadMessages[threadMessages.length - 1] || null;
    const latestInboundSeen = latestInboundMessage(threadMessages);
    const basePatch = {
      last_synced_at: nowIso,
      last_reply_at: latestInboundSeen?.date || row.last_reply_at || null,
      updated_at: nowIso,
    };
    await sbUpdate("campaign_messages", { id: row.id, user_id: userId }, basePatch);

    const update = {
      messageId: row.id,
      doorId: door.id,
      status: row.status,
      statusDetail: "syncing",
      threadMessages,
      lastReplyAt: latestInboundSeen?.date || null,
      latestThreadMessageId: latestThreadMessage?.id || null,
      latestThreadMessageAt: latestThreadMessage?.date || null,
      attachments: flattenThreadAttachments(threadMessages),
    };

    const latestInbound = latestUnhandledInbound(thread, row);
    if (!latestInbound) {
      updates.push(update);
      continue;
    }

    let classification = null;
    if (replies) {
      try {
        classification = await replies.classifyReply({ profile, door, threadMessages });
      } catch (err) {
        console.error("Reply classification failed:", err.message);
      }
    }
    classification = classification || fallbackClassification(latestInbound.body) || {
      type: "other",
      wantsCall: false,
      sentiment: "neutral",
      summary: "They replied to the thread.",
      scheduling: { intent: "none", timeText: "", dateTime: "" },
    };
    classification.lastInboundId = latestInbound.id || `${latestInbound.date || ""}:${latestInbound.body?.slice(0, 40) || ""}`;

    counts.replies += 1;
    const patch = {
      ...basePatch,
      status: "replied",
      reply_classification: classification,
      reply_summary: classification?.summary || null,
      last_reply_at: latestInbound.date || null,
    };
    update.status = "replied";
    update.statusDetail = repliesAllowed && replies ? "Scout drafting response" : "Reply received";
    update.lastReplyAt = latestInbound.date || null;
    update.newInbound = true;
    if (classification) update.classification = classification;
    await logEvent(userId, row.id, "replied", {
      type: classification?.type || null,
      sentiment: classification?.sentiment || null,
    });

    if (repliesAllowed && replies) {
      let meetLink = null;
      let calendarEvent = null;
      let options = [];
      const scheduleIntent = classification?.scheduling?.intent || "none";
      const rememberedOptions = row.reply_classification?.availabilityOptions || row.suggested_reply?.availabilityOptions || [];
      const concreteTime = ["proposes_time", "confirms_time"].includes(scheduleIntent)
        ? parseRequestedMeetingTime(`${classification.scheduling.dateTime || ""} ${classification.scheduling.timeText || ""} ${latestInbound.body || ""}`, { tz: DEFAULT_TZ }) ||
          optionAcceptedFromReply(latestInbound.body, rememberedOptions)
        : optionAcceptedFromReply(latestInbound.body, rememberedOptions);

      if (concreteTime) {
        const event = await createMeetEvent({
          userId,
          summary: `Intro call with ${door.name || row.to_name || "Knock"}`,
          description: "Scheduled by Scout via Knock.",
          attendeeEmail: row.to_email,
          start: concreteTime.start,
          end: concreteTime.end,
          tz: DEFAULT_TZ,
        });
        if (event?.eventId) {
          meetLink = event.meetLink ? { url: event.meetLink, when: event.start } : null;
          calendarEvent = { ...event, label: concreteTime.label };
          update.meetLink = event.meetLink || null;
          update.calendarLink = event.calendarLink || null;
          update.calendarEvent = calendarEvent;
          update.statusDetail = "Meeting booked";
          patch.status = "meeting";
          update.status = "meeting";
          await logEvent(userId, row.id, "meeting_created", {
            eventId: event.eventId,
            start: event.start,
          });
        }
      } else if (classification?.wantsCall || scheduleIntent === "asks_availability") {
        try {
          options = await availabilityOptions({ userId, text: latestInbound.body || classification.scheduling?.timeText || "", tz: DEFAULT_TZ });
          if (options.length) update.availabilityOptions = options;
        } catch (err) {
          console.error("Availability lookup failed:", err.message);
        }
      }

      let reply = null;
      try {
        reply = await replies.draftReply({
          profile,
          door,
          threadMessages,
          classification,
          tone,
          styleProfile,
          meetLink,
          availabilityOptions: options,
          calendarEvent,
        });
      } catch (err) {
        console.error("Reply drafting failed:", err.message);
      }

      if (reply) {
        const { inReplyTo, references } = threadHeaders(thread);
        if (review) {
          patch.suggested_reply = {
            kind: "reply",
            subject: reply.subject,
            body: reply.body,
            meetLink,
            calendarEvent,
            availabilityOptions: options,
            lastInboundId: classification.lastInboundId,
          };
          if (patch.status !== "meeting") {
            patch.status = "needs_review";
            update.status = "needs_review";
          }
          update.suggestedReply = patch.suggested_reply;
          update.statusDetail = "Draft ready for review";
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
              trackOpenUrl: openTrackingUrl(userId, row.id),
            });
            await logEvent(userId, row.id, "sent", { kind: "auto_reply", gmailMessageId: sent.gmailMessageId });
            update.autoReplied = true;
            update.statusDetail = "Auto-replied";
            patch.gmail_message_id = sent.gmailMessageId;
            patch.gmail_thread_id = sent.threadId || row.gmail_thread_id;
            update.threadMessages = [
              ...threadMessages,
              {
                id: sent.gmailMessageId,
                from: profile.email || profile.fullName || "You",
                to: row.to_email,
                date: nowIso,
                subject: reply.subject,
                body: reply.body,
                isFromMe: true,
                attachments: [],
              },
            ];
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
          status: "in.(sent,opened,followup_sent)",
          followup_count: `lt.${MAX_FOLLOWUPS}`,
        },
        limit: MAX_FOLLOWUPS_PER_RUN,
      })) || [];

    for (const row of candidates) {
      const lastTouch = row.last_followup_at || row.sent_at;
      if (!lastTouch || lastTouch > followupDue) continue;
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
        if (latestUnhandledInbound(thread, row)) continue; // reply pass picks it up
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
            trackOpenUrl: openTrackingUrl(userId, row.id),
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
