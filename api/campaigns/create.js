/* POST /api/campaigns/create — queue a campaign from approved doors.
   No emails are sent here; sending goes through /api/gmail/send and the
   monitor in lib/gmail/sendQueue.js. With Supabase configured AND a real
   userId, the campaign + per-door messages persist server-side
   (meta.persisted: "supabase"); otherwise the queued campaign is returned
   for the client to persist (meta.persisted: "client"). Message ids are the
   same in both modes — the client correlates by id. */

import { randomUUID } from "node:crypto";
import { supabaseConfigured, sbInsert } from "../../lib/supabase/admin.js";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

async function persistCampaign({ userId, campaign, messages, doors, sendPrefs, scheduleAt, now }) {
  const inserted = await sbInsert("campaigns", [
    {
      id: campaign.id,
      user_id: userId,
      name: campaign.name,
      status: campaign.status,
      selected_door_ids: campaign.selectedDoorIds,
      created_at: now,
      updated_at: now,
    },
  ]);
  if (!inserted) return false;

  const rows = messages.map((m, i) => ({
    id: m.id,
    user_id: userId,
    campaign_id: campaign.id,
    door_id: validUuid(doors[i].id) ? doors[i].id : null,
    subject: m.subject,
    body: m.body,
    to_email: doors[i].email || null,
    to_name: doors[i].name || null,
    door_snapshot: doors[i],
    status: m.status,
    scheduled_at: scheduleAt || null,
    created_at: now,
    updated_at: now,
  }));

  let savedMessages = await sbInsert("campaign_messages", rows);
  if (!savedMessages) {
    /* door rows may only exist client-side — retry without the FK */
    savedMessages = await sbInsert(
      "campaign_messages",
      rows.map((r) => ({ ...r, door_id: null }))
    );
  }
  return Boolean(savedMessages);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { doors = [], name, userId, sendPrefs, scheduleAt } = req.body || {};
  if (!Array.isArray(doors) || doors.length === 0) {
    return res.status(400).json({ error: "Select at least one door before launching" });
  }

  const now = new Date().toISOString();
  const validSchedule = scheduleAt && !Number.isNaN(Date.parse(scheduleAt)) ? scheduleAt : null;
  const campaign = {
    id: randomUUID(),
    name: name || `Campaign · ${new Date().toLocaleDateString()}`,
    status: "queued",
    selectedDoorIds: doors.map((d) => d.id),
    sendPrefs: sendPrefs || null,
    createdAt: now,
    updatedAt: now,
  };
  const messages = doors.map((d) => ({
    id: randomUUID(),
    campaignId: campaign.id,
    doorId: d.id,
    toEmail: d.email || null,
    toName: d.name || null,
    subject: d.draft?.subject || "quick question",
    body: d.draft?.body || d.draft?.preview || "",
    status: "queued",
    scheduledAt: validSchedule,
    createdAt: now,
  }));

  let persisted = "client";
  if (supabaseConfigured() && validUuid(userId)) {
    const saved = await persistCampaign({
      userId,
      campaign,
      messages,
      doors,
      sendPrefs,
      scheduleAt: validSchedule,
      now,
    });
    if (saved) persisted = "supabase";
  }

  return res.status(200).json({
    campaign,
    messages,
    meta: {
      sent: false,
      note:
        persisted === "supabase"
          ? "Campaign queued and saved. Scout sends and monitors from here."
          : "Campaign queued. Connect Google to send from your own inbox.",
      persisted,
    },
  });
}
