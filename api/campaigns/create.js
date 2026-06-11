/* POST /api/campaigns/create — queue a campaign from approved doors.
   No emails are sent here. Gmail sending is a separate, later integration.
   Without a database configured, the queued campaign is returned for the
   client to persist; with Supabase env vars set, this is where it inserts. */

import { randomUUID } from "node:crypto";

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { doors = [], name } = req.body || {};
  if (!Array.isArray(doors) || doors.length === 0) {
    return res.status(400).json({ error: "Select at least one door before launching" });
  }

  const now = new Date().toISOString();
  const campaign = {
    id: randomUUID(),
    name: name || `Campaign · ${new Date().toLocaleDateString()}`,
    status: "queued",
    selectedDoorIds: doors.map((d) => d.id),
    createdAt: now,
    updatedAt: now,
  };
  const messages = doors.map((d) => ({
    id: randomUUID(),
    campaignId: campaign.id,
    doorId: d.id,
    subject: d.draft?.subject || "quick question",
    body: d.draft?.body || d.draft?.preview || "",
    status: "queued",
    createdAt: now,
  }));

  return res.status(200).json({
    campaign,
    messages,
    meta: {
      sent: false,
      note: "Campaign queued. Gmail sending is not connected yet, so nothing was sent.",
      persisted: "client", // becomes "supabase" once the DB is wired
    },
  });
}
