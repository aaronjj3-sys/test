/* POST /api/gmail/sync — on-demand monitor pass for one user. The app polls
   this while open; api/cron/monitor.js covers off-hours. Body: { userId }.
   Returns { ok, updates: [...], counts } from lib/gmail/sendQueue.syncUser. */

import { syncUser } from "../../lib/gmail/sendQueue.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId } = req.body || {};
  if (!validUuid(userId)) {
    return res.status(400).json({
      ok: false,
      error: "real_user_required",
      message: "Sign in with Google to refresh Gmail threads.",
    });
  }

  try {
    const result = await syncUser(userId);
    if (!result.ok && result.error === "google_not_connected") {
      return res.status(412).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    console.error("Sync failed:", err.message);
    return res.status(500).json({ ok: false, error: "sync_failed" });
  }
}
