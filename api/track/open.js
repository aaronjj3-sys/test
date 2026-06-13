/* GET /api/track/open?m=message_id&u=user_id
   Transparent 1x1 pixel used for best-effort email open tracking. */

import { sbInsert, sbSelect, sbUpdate, supabaseConfigured } from "../../lib/supabase/admin.js";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

function sendPixel(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.end(PIXEL);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end("GET only");
  }
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const messageId = url.searchParams.get("m");
  const userId = url.searchParams.get("u");
  if (!supabaseConfigured() || !validUuid(messageId) || !validUuid(userId)) return sendPixel(res);

  try {
    const rows = await sbSelect("campaign_messages", {
      filter: { id: messageId, user_id: userId },
      limit: 1,
      select: "id,status",
    });
    const row = rows?.[0];
    if (row) {
      await sbInsert("email_events", [
        { user_id: userId, message_id: messageId, event_type: "opened", metadata: { source: "tracking_pixel" } },
      ]);
      if (["sent", "followup_sent"].includes(row.status)) {
        await sbUpdate("campaign_messages", { id: messageId, user_id: userId }, {
          status: "opened",
          updated_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    /* Never break image loading because tracking failed. */
  }
  return sendPixel(res);
}
