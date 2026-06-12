/* GET /api/cron/monitor — daily Vercel cron (see vercel.json). Runs the
   send/reply/follow-up monitor for every connected Google user so Scout keeps
   working while the app is closed. Vercel sends Authorization: Bearer
   $CRON_SECRET automatically when that env var is set. */

import { supabaseConfigured, sbSelect } from "../../lib/supabase/admin.js";
import { syncUser } from "../../lib/gmail/sendQueue.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!supabaseConfigured()) {
    return res.status(200).json({ ok: false, error: "supabase_not_configured" });
  }

  const rows =
    (await sbSelect("oauth_connections", {
      filter: { provider: "google", status: "connected" },
      select: "user_id",
      limit: 50,
    })) || [];
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];

  const totals = { scheduledSent: 0, replies: 0, followupsSent: 0, draftsCreated: 0 };
  let errors = 0;

  for (const userId of userIds) {
    try {
      const result = await syncUser(userId);
      if (result.ok) {
        for (const key of Object.keys(totals)) totals[key] += result.counts?.[key] || 0;
      } else {
        errors += 1;
      }
    } catch (err) {
      console.error("Cron sync failed for a user:", err.message);
      errors += 1;
    }
  }

  return res.status(200).json({ ok: true, users: userIds.length, errors, counts: totals });
}
