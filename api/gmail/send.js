/* POST /api/gmail/send — send (or schedule) one outreach email from the
   user's own Gmail. Body:
   { userId,
     message: { id?, doorId?, campaignId?, to, toName?, subject, body,
                attachmentIds? },   // user_files ids: resume + up to 5 extras
     scheduleAt? }

   412 google_not_connected · 402 knock_limit_reached · 502 on Gmail failure. */

import { randomUUID } from "node:crypto";
import { supabaseConfigured, sbSelect, sbInsert, sbUpdate } from "../../lib/supabase/admin.js";
import { getGoogleConnection, sendEmail, getThread, loadAttachments } from "../../lib/gmail/client.js";
import { monthlySendCount, planLimit } from "../../lib/gmail/sendQueue.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function safeUserIdDiagnostic(userId) {
  return userId ? `${String(userId).slice(0, 8)}...` : null;
}

/* Update the existing row when the client passed a DB id; insert otherwise.
   Returns the message row id we ended up writing (or null if DB write failed). */
function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8000";
  return `${proto}://${host}`;
}

function threadHeaders(thread) {
  const ids = (thread || []).map((m) => m.messageIdHeader).filter(Boolean);
  return {
    inReplyTo: ids[ids.length - 1] || null,
    references: ids.join(" ") || null,
  };
}

function normalizeAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((a) => {
      const contentBase64 = String(a?.contentBase64 || "").replace(/^data:[^,]+,/i, "").replace(/\s+/g, "");
      const size = Number(a?.size || Math.ceil((contentBase64.length * 3) / 4));
      if (!contentBase64 || size > 5 * 1024 * 1024) return null;
      return {
        fileName: String(a.fileName || a.name || "attachment").replace(/[\r\n"]/g, "").slice(0, 180),
        mimeType: String(a.mimeType || a.type || "application/octet-stream"),
        contentBase64,
        size,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function stripHtml(value = "") {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeHtml(value = "") {
  const allowed = new Set(["b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "br", "p", "div"]);
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (all, slash, tag, attrs) => {
      const t = tag.toLowerCase();
      if (!allowed.has(t)) return "";
      if (slash) return `</${t}>`;
      if (t !== "a") return `<${t}>`;
      const href = String(attrs || "").match(/\shref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const url = href && (href[1] || href[2] || href[3] || "");
      return /^(https?:|mailto:)/i.test(url) ? `<a href="${url.replace(/"/g, "&quot;")}">` : "<a>";
    })
    .trim();
}

async function persistMessage(userId, message, fields, options = {}) {
  const contentFields = options.preserveContent ? {} : {
    subject: message.subject,
    body: message.body,
  };
  const base = {
    to_email: message.to,
    to_name: message.toName || null,
    updated_at: new Date().toISOString(),
    ...contentFields,
    ...fields,
  };
  const attempt = async (data) => {
    if (validUuid(message.id)) {
      const updated = await sbUpdate("campaign_messages", { id: message.id, user_id: userId }, data);
      if (updated?.length) return message.id;
    }
    const row = {
      id: validUuid(message.id) ? message.id : randomUUID(),
      user_id: userId,
      campaign_id: validUuid(message.campaignId) ? message.campaignId : null,
      door_id: validUuid(message.doorId) ? message.doorId : null,
      created_at: new Date().toISOString(),
      ...data,
    };
    let inserted = await sbInsert("campaign_messages", [row]);
    if (!inserted) {
      /* door/campaign may only exist client-side — retry without the FKs */
      inserted = await sbInsert("campaign_messages", [{ ...row, door_id: null, campaign_id: null }]);
    }
    return inserted?.[0]?.id || null;
  };
  let id = await attempt(base);
  if (!id && "attachments" in base) {
    /* migration 005 (attachments column) may not be applied yet */
    const { attachments, ...withoutAttachments } = base;
    id = await attempt(withoutAttachments);
  }
  return id;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, scheduleAt } = req.body || {};
  const rawMessage = req.body?.message || {};
  const htmlBody = sanitizeHtml(rawMessage.bodyHtml || rawMessage.htmlBody || "");
  const message = {
    ...rawMessage,
    to: String(rawMessage.to || "").trim(),
    subject: String(rawMessage.subject || "").trim(),
    body: String(rawMessage.body || stripHtml(htmlBody) || "").trim(),
    bodyHtml: htmlBody,
    kind: String(rawMessage.kind || "").trim(),
  };
  if (!userId) return res.status(400).json({ error: "userId is required" });
  const missing = ["to", "subject", "body"].filter((field) => !message[field]);
  if (missing.length) {
    return res.status(400).json({
      ok: false,
      error: "missing_message_fields",
      missing,
      message: `Email is missing ${missing.map((field) => `message.${field}`).join(", ")}.`,
    });
  }

  const connection = await getGoogleConnection(userId);
  if (!connection) {
    return res.status(412).json({
      ok: false,
      error: "google_not_connected",
      userIdReceived: safeUserIdDiagnostic(userId),
    });
  }

  const dbReady = supabaseConfigured();
  const existingRows = dbReady && validUuid(message.id)
    ? await sbSelect("campaign_messages", {
      filter: { id: message.id, user_id: userId },
      limit: 1,
      select: "*",
    })
    : [];
  const existing = existingRows?.[0] || null;
  const isThreadReply = ["reply", "followup"].includes(message.kind);
  const attachmentIds = Array.isArray(rawMessage.attachmentIds)
    ? rawMessage.attachmentIds.filter(validUuid)
    : [];
  const savedAttachments = attachmentIds.length ? await loadAttachments(userId, attachmentIds.map((fileId) => ({ fileId }))) : [];
  const attachments = [
    ...savedAttachments,
    ...normalizeAttachments(rawMessage.attachments || req.body?.attachments),
  ].slice(0, 6);

  /* plan guard: knocks sent this calendar month */
  if (dbReady && !isThreadReply) {
    const limit = await planLimit(userId);
    const used = await monthlySendCount(userId);
    if (used >= limit) {
      return res.status(402).json({ ok: false, error: "knock_limit_reached", limit });
    }
  }

  /* schedule for later instead of sending now: attachments persist on the
     row so the monitor attaches them when the scheduled send fires */
  if (scheduleAt && Date.parse(scheduleAt) > Date.now()) {
    let messageId = message.id || null;
    if (dbReady) {
      messageId = await persistMessage(userId, message, {
        status: "scheduled",
        scheduled_at: new Date(Date.parse(scheduleAt)).toISOString(),
        attachments: attachmentIds.length
          ? attachmentIds.map((fileId) => ({ fileId }))
          : null,
      });
    }
    return res.status(200).json({ ok: true, status: "scheduled", messageId, scheduledAt: scheduleAt });
  }

  try {
    let threadId = rawMessage.threadId || null;
    let inReplyTo = rawMessage.inReplyTo || null;
    let references = rawMessage.references || null;
    if (!threadId && existing?.gmail_thread_id && (isThreadReply || /^re:/i.test(message.subject))) {
      threadId = existing.gmail_thread_id;
      try {
        const thread = await getThread(userId, threadId);
        ({ inReplyTo, references } = threadHeaders(thread));
      } catch (err) {
        console.error("Thread headers unavailable:", err.message);
      }
    }

    const trackOpenUrl = null;

    const sent = await sendEmail({
      userId,
      to: message.to,
      toName: message.toName,
      subject: message.subject,
      body: message.body,
      bodyHtml: message.bodyHtml,
      threadId,
      inReplyTo,
      references,
      attachments,
      trackOpenUrl,
    });

    let messageId = message.id || null;
    if (dbReady) {
      const status = message.kind === "followup"
        ? "followup_sent"
        : isThreadReply
          ? (existing?.status === "meeting" ? "meeting" : "replied")
          : "sent";
      const rememberedAvailability = isThreadReply && existing?.suggested_reply?.availabilityOptions?.length
        ? {
          ...(existing?.reply_classification || {}),
          availabilityOptions: existing.suggested_reply.availabilityOptions,
        }
        : existing?.reply_classification || null;
      messageId = await persistMessage(userId, message, {
        status,
        sent_at: existing?.sent_at || new Date().toISOString(),
        last_followup_at: message.kind === "followup" ? new Date().toISOString() : existing?.last_followup_at || null,
        followup_count: message.kind === "followup" ? Number(existing?.followup_count || 0) + 1 : existing?.followup_count || 0,
        gmail_message_id: sent.gmailMessageId,
        gmail_thread_id: sent.threadId,
        reply_classification: rememberedAvailability,
        suggested_reply: null,
        gmail_draft_id: null,
        last_synced_at: null,
      }, { preserveContent: isThreadReply });
      if (messageId) {
        await sbInsert("email_events", [
          {
            user_id: userId,
            message_id: messageId,
            event_type: message.kind === "followup" ? "followup_sent" : "sent",
            metadata: { campaignId: message.campaignId || null, doorId: message.doorId || null, kind: message.kind || "first_touch" },
          },
        ]);
      }
    }

    return res.status(200).json({
      ok: true,
      status: isThreadReply ? (message.kind === "followup" ? "followup_sent" : "replied") : "sent",
      messageId,
      gmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.threadId,
    });
  } catch (err) {
    console.error("Gmail send failed:", err.message);
    if (err.message === "google_not_connected") {
      return res.status(412).json({
        ok: false,
        error: "google_not_connected",
        userIdReceived: safeUserIdDiagnostic(userId),
      });
    }
    if (dbReady && validUuid(message.id)) {
      await sbUpdate(
        "campaign_messages",
        { id: message.id, user_id: userId },
        { status: "failed", updated_at: new Date().toISOString() }
      );
    }
    return res.status(502).json({ ok: false, status: "failed", error: err.message });
  }
}
