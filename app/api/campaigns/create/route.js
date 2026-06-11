/* Next.js App Router adapter — queue a campaign; never sends email. */
import { randomUUID } from "node:crypto";

export async function POST(req) {
  const { doors = [], name } = await req.json().catch(() => ({}));
  if (!Array.isArray(doors) || doors.length === 0) {
    return Response.json({ error: "Select at least one door before launching" }, { status: 400 });
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
  return Response.json({
    campaign,
    messages,
    meta: {
      sent: false,
      note: "Campaign queued. Gmail sending is not connected yet — nothing was sent.",
      persisted: "client",
    },
  });
}
