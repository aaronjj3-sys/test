/* POST /api/gmail/import-thread — pull an existing Gmail conversation into
   the tracker, for outreach the user sent on their own outside Knock.
   Body: { userId, email, name?, company?, title? }
   Finds the most recent Gmail thread with that address, stores it as a
   campaign_messages row (so reply monitoring and follow-ups pick it up),
   and returns the message + thread for the client to adopt.

   412 google_not_connected · 404 no_thread_found. */

import { randomUUID } from "node:crypto";
import { supabaseConfigured, sbInsert } from "../../lib/supabase/admin.js";
import { searchThreads, getThread } from "../../lib/gmail/client.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function nameFromHeader(from) {
  /* `Jane Doe <jane@x.com>` → `Jane Doe`; bare addresses → "" */
  const m = String(from || "").match(/^\s*"?([^"<]+?)"?\s*</);
  return m ? m[1].trim() : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, name = "", company = "", title = "" } = req.body || {};
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!validUuid(userId)) return res.status(400).json({ ok: false, error: "A real Supabase userId is required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "A valid email address is required" });
  }

  try {
    const threads = await searchThreads(userId, `(to:${email} OR from:${email}) -in:chat`, 3);
    if (!threads.length) {
      return res.status(404).json({
        ok: false,
        error: "no_thread_found",
        message: "No Gmail conversation with that address was found in your inbox.",
      });
    }

    const thread = await getThread(userId, threads[0].id);
    if (!thread.length) {
      return res.status(404).json({ ok: false, error: "no_thread_found", message: "That thread has no readable messages." });
    }

    const mine = thread.filter((m) => m.isFromMe);
    const theirs = thread.filter((m) => !m.isFromMe);
    const first = mine[0] || thread[0];
    const last = thread[thread.length - 1];
    const status = theirs.length ? "replied" : "sent";
    const toName = name.trim() || nameFromHeader(theirs[0]?.from) || "";
    const nowIso = new Date().toISOString();

    const row = {
      id: randomUUID(),
      user_id: userId,
      campaign_id: null,
      door_id: null,
      to_email: email,
      to_name: toName || null,
      subject: first.subject || last.subject || "(no subject)",
      body: mine[0]?.body || "",
      status,
      sent_at: mine[0]?.date || first.date || nowIso,
      gmail_thread_id: threads[0].id,
      gmail_message_id: mine[0]?.id || null,
      last_synced_at: nowIso,
      door_snapshot: {
        id: `manual_${email}`,
        source: "manual",
        name: toName,
        firstName: toName.split(" ")[0] || "",
        email,
        title: title.trim() || undefined,
        companyName: company.trim() || undefined,
      },
      created_at: nowIso,
      updated_at: nowIso,
    };

    let persisted = false;
    if (supabaseConfigured()) {
      const inserted = await sbInsert("campaign_messages", [row]);
      persisted = Boolean(inserted?.length);
    }

    return res.status(200).json({
      ok: true,
      persisted,
      message: {
        id: row.id,
        to: email,
        toName,
        name: toName,
        company: company.trim(),
        title: title.trim(),
        subject: row.subject,
        body: row.body,
        status,
        source: "manual",
        gmailThreadId: threads[0].id,
        gmailMessageId: row.gmail_message_id,
        sentAt: row.sent_at,
        createdAt: row.sent_at,
        updatedAt: last.date || nowIso,
      },
      threadMessages: thread.map((m) => ({
        from: m.from,
        date: m.date,
        body: m.body,
        subject: m.subject,
        isFromMe: Boolean(m.isFromMe),
      })),
    });
  } catch (err) {
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected" });
    }
    console.error("Thread import failed:", err.message);
    return res.status(502).json({ ok: false, error: err.message || "Thread import failed" });
  }
}
