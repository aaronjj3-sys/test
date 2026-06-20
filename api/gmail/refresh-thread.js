/* POST /api/gmail/refresh-thread
   Body: { userId, messageId }
   Force-pulls the full Gmail thread for one Knock campaign message and
   returns normalized messages for the in-app Inbox. */

import { sbSelect, sbUpdate, supabaseConfigured } from "../../lib/supabase/admin.js";
import { getThread } from "../../lib/gmail/client.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

function latestInbound(thread = []) {
  return [...thread].reverse().find((m) => !m.isFromMe) || null;
}

function newestIsInbound(thread = []) {
  const newest = thread[thread.length - 1];
  return Boolean(newest && !newest.isFromMe);
}

function statusSuggestion(row, thread) {
  if (row.status === "meeting") return "meeting";
  if (!newestIsInbound(thread)) return row.status || "sent";
  if (row.suggested_reply) return "needs_review";
  return "replied";
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

  const { userId, messageId } = req.body || {};
  if (!validUuid(userId) || !validUuid(messageId)) {
    return res.status(400).json({ ok: false, error: "A real userId and messageId are required" });
  }

  const rows = await sbSelect("campaign_messages", {
    filter: { id: messageId, user_id: userId },
    limit: 1,
    select: "*",
  });
  const row = rows?.[0];
  if (!row) return res.status(404).json({ ok: false, error: "message_not_found" });
  if (!row.gmail_thread_id) return res.status(409).json({ ok: false, error: "missing_gmail_thread_id", message: "This message has not been sent through Gmail yet." });

  try {
    const thread = await getThread(userId, row.gmail_thread_id);
    const inbound = latestInbound(thread);
    const nowIso = new Date().toISOString();
    const suggestion = statusSuggestion(row, thread);
    await updateThreadState(userId, row, {
      status: suggestion,
      last_reply_at: inbound?.date || row.last_reply_at || null,
      last_synced_at: nowIso,
      updated_at: nowIso,
    });

    const threadMessages = thread.map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      date: m.date,
      body: m.body,
      subject: m.subject,
      isFromMe: Boolean(m.isFromMe),
      attachments: m.attachments || [],
    }));
    const attachments = threadMessages.flatMap((m) => (m.attachments || []).map((a) => ({ ...a, messageId: m.id })));

    return res.status(200).json({
      ok: true,
      gmailThreadId: row.gmail_thread_id,
      gmailMessageId: row.gmail_message_id || null,
      threadMessages,
      lastReplyAt: inbound?.date || null,
      attachments,
      statusSuggestion: suggestion,
      archivedAt: row.archived_at || null,
      deletedAt: row.deleted_at || null,
      flagged: Boolean(row.flagged),
    });
  } catch (err) {
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected" });
    }
    console.error("Thread refresh failed:", err.message);
    return res.status(502).json({ ok: false, error: err.message || "refresh_failed" });
  }
}
