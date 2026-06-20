/* POST /api/gmail/refresh-thread
   Body: { userId, messageId?, gmailThreadId?, gmailMessageId?, toEmail?, subject? }
   Force-pulls the full Gmail thread for one Knock conversation. The thread can
   be identified by a persisted campaign_messages row or by a Gmail thread id
   for older/local-only app_state messages. */

import { sbSelect, sbUpdate, supabaseConfigured } from "../../lib/supabase/admin.js";
import { getThread } from "../../lib/gmail/client.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

function clean(value) {
  return String(value || "").trim();
}

function latestInbound(thread = []) {
  return [...thread].reverse().find((m) => !m.isFromMe) || null;
}

function newestIsInbound(thread = []) {
  const newest = thread[thread.length - 1];
  return Boolean(newest && !newest.isFromMe);
}

function statusSuggestion(row, thread) {
  if (row?.status === "meeting") return "meeting";
  if (!newestIsInbound(thread)) return row?.status || "sent";
  if (row?.suggested_reply) return "needs_review";
  return "replied";
}

function normalizeThread(thread = []) {
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

async function findRow(userId, { messageId, gmailThreadId, gmailMessageId }) {
  const attempts = [];
  if (validUuid(messageId)) attempts.push({ id: messageId, user_id: userId });
  if (gmailThreadId) attempts.push({ gmail_thread_id: gmailThreadId, user_id: userId });
  if (gmailMessageId) attempts.push({ gmail_message_id: gmailMessageId, user_id: userId });

  for (const filter of attempts) {
    const rows = await sbSelect("campaign_messages", {
      filter,
      limit: 1,
      select: "*",
    });
    if (rows?.[0]) return rows[0];
  }
  return null;
}

async function updateThreadState(userId, row, patch) {
  const full = await sbUpdate("campaign_messages", { id: row.id, user_id: userId }, patch);
  if (full) return full;
  if ("last_reply_at" in patch) {
    const { last_reply_at, ...fallback } = patch;
    return sbUpdate("campaign_messages", { id: row.id, user_id: userId }, fallback);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!supabaseConfigured()) return res.status(503).json({ ok: false, error: "supabase_not_configured" });

  const body = req.body || {};
  const userId = clean(body.userId);
  const messageId = clean(body.messageId);
  const gmailThreadId = clean(body.gmailThreadId);
  const gmailMessageId = clean(body.gmailMessageId);
  const toEmail = clean(body.toEmail);
  const subject = clean(body.subject);

  if (!validUuid(userId)) {
    return res.status(400).json({ ok: false, error: "invalid_user", message: "A real Supabase userId is required." });
  }

  const row = await findRow(userId, { messageId, gmailThreadId, gmailMessageId });
  const threadId = row?.gmail_thread_id || gmailThreadId;
  if (!threadId) {
    return res.status(409).json({
      ok: false,
      error: "missing_thread_reference",
      message: "This thread is not tracked yet.",
    });
  }

  try {
    const thread = await getThread(userId, threadId);
    const inbound = latestInbound(thread);
    const nowIso = new Date().toISOString();
    const suggestion = statusSuggestion(row, thread);
    const threadMessages = normalizeThread(thread);
    const latest = threadMessages[threadMessages.length - 1] || null;
    const attachments = threadMessages.flatMap((m) =>
      (m.attachments || []).map((a) => ({ ...a, messageId: a.messageId || m.id }))
    );

    if (row) {
      await updateThreadState(userId, row, {
        status: suggestion,
        last_reply_at: inbound?.date || row.last_reply_at || null,
        last_synced_at: nowIso,
        updated_at: nowIso,
      });
    }

    return res.status(200).json({
      ok: true,
      messageId: row?.id || messageId || null,
      gmailThreadId: threadId,
      gmailMessageId: row?.gmail_message_id || gmailMessageId || latest?.id || null,
      toEmail: row?.to_email || toEmail || null,
      subject: row?.subject || subject || latest?.subject || null,
      threadMessages,
      lastReplyAt: inbound?.date || null,
      latestThreadMessageId: latest?.id || null,
      latestThreadMessageAt: latest?.date || null,
      attachments,
      statusSuggestion: suggestion,
      archivedAt: row?.archived_at || null,
      deletedAt: row?.deleted_at || null,
      flagged: Boolean(row?.flagged),
      dbTracked: Boolean(row),
    });
  } catch (err) {
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected", message: "Google is not connected." });
    }
    console.error("Thread refresh failed:", err.message);
    return res.status(502).json({ ok: false, error: err.message || "refresh_failed" });
  }
}
