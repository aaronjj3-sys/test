/* POST /api/messages/organize
   Knock-level thread organization. This does not archive/delete anything in
   Gmail; it only updates campaign_messages fields used by the Knock Inbox. */

import { sbDelete, sbUpdate, supabaseConfigured } from "../../lib/supabase/admin.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  if (!supabaseConfigured()) return res.status(503).json({ ok: false, error: "supabase_not_configured" });

  const { userId, messageId, action = "organize" } = req.body || {};
  if (!validUuid(userId) || !validUuid(messageId)) {
    return res.status(400).json({ ok: false, error: "A real userId and messageId are required" });
  }

  if (action === "delete") {
    const deleted = await sbDelete("campaign_messages", { id: messageId, user_id: userId });
    if (!deleted) return res.status(502).json({ ok: false, error: "Could not delete the thread from Knock" });
    return res.status(200).json({ ok: true, deleted: true });
  }

  const patch = {
    archived_at: req.body.archivedAt || null,
    deleted_at: req.body.deletedAt || null,
    flagged: Boolean(req.body.flagged),
    updated_at: new Date().toISOString(),
  };
  const updated = await sbUpdate("campaign_messages", { id: messageId, user_id: userId }, patch);
  if (!updated) {
    return res.status(502).json({ ok: false, error: "Could not save organization fields. Run migration 006_inbox_organization.sql." });
  }
  return res.status(200).json({ ok: true });
}
