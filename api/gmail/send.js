/* POST /api/gmail/send — send (or schedule) one outreach email from the
   user's own Gmail. Body:
   { userId, message: { id?, doorId?, campaignId?, to, toName?, subject, body }, scheduleAt? }

   412 google_not_connected · 402 knock_limit_reached · 502 on Gmail failure. */

import { randomUUID } from "node:crypto";
import { supabaseConfigured, sbSelect, sbInsert, sbUpdate } from "../../lib/supabase/admin.js";
import { getGoogleConnection, sendEmail } from "../../lib/gmail/client.js";
import { monthlySendCount, planLimit } from "../../lib/gmail/sendQueue.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

/* Update the existing row when the client passed a DB id; insert otherwise.
   Returns the message row id we ended up writing (or null if DB write failed). */
async function persistMessage(userId, message, fields) {
  const base = {
    to_email: message.to,
    to_name: message.toName || null,
    subject: message.subject,
    body: message.body,
    updated_at: new Date().toISOString(),
    ...fields,
  };
  if (validUuid(message.id)) {
    const updated = await sbUpdate("campaign_messages", { id: message.id, user_id: userId }, base);
    if (updated?.length) return message.id;
  }
  const row = {
    id: validUuid(message.id) ? message.id : randomUUID(),
    user_id: userId,
    campaign_id: validUuid(message.campaignId) ? message.campaignId : null,
    door_id: validUuid(message.doorId) ? message.doorId : null,
    created_at: new Date().toISOString(),
    ...base,
  };
  let inserted = await sbInsert("campaign_messages", [row]);
  if (!inserted) {
    /* door/campaign may only exist client-side — retry without the FKs */
    inserted = await sbInsert("campaign_messages", [{ ...row, door_id: null, campaign_id: null }]);
  }
  return inserted?.[0]?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, message, scheduleAt } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId is required" });
  if (!message?.to || !message?.subject || !message?.body) {
    return res.status(400).json({ error: "message.to, message.subject and message.body are required" });
  }

  const connection = await getGoogleConnection(userId);
  if (!connection) {
    return res.status(412).json({ ok: false, error: "google_not_connected" });
  }

  const dbReady = supabaseConfigured();

  /* plan guard: knocks sent this calendar month */
  if (dbReady) {
    const limit = await planLimit(userId);
    const used = await monthlySendCount(userId);
    if (used >= limit) {
      return res.status(402).json({ ok: false, error: "knock_limit_reached", limit });
    }
  }

  /* schedule for later instead of sending now */
  if (scheduleAt && Date.parse(scheduleAt) > Date.now()) {
    let messageId = message.id || null;
    if (dbReady) {
      messageId = await persistMessage(userId, message, {
        status: "scheduled",
        scheduled_at: new Date(Date.parse(scheduleAt)).toISOString(),
      });
    }
    return res.status(200).json({ ok: true, status: "scheduled", messageId, scheduledAt: scheduleAt });
  }

  try {
    const sent = await sendEmail({
      userId,
      to: message.to,
      toName: message.toName,
      subject: message.subject,
      body: message.body,
    });

    let messageId = message.id || null;
    if (dbReady) {
      messageId = await persistMessage(userId, message, {
        status: "sent",
        sent_at: new Date().toISOString(),
        gmail_message_id: sent.gmailMessageId,
        gmail_thread_id: sent.threadId,
      });
      if (messageId) {
        await sbInsert("email_events", [
          {
            user_id: userId,
            message_id: messageId,
            event_type: "sent",
            metadata: { campaignId: message.campaignId || null, doorId: message.doorId || null },
          },
        ]);
      }
    }

    return res.status(200).json({
      ok: true,
      status: "sent",
      messageId,
      gmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.threadId,
    });
  } catch (err) {
    console.error("Gmail send failed:", err.message);
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected" });
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
