/* POST /api/gmail/attachment
   Fetch a small Gmail attachment owned by the connected user for in-app
   preview. Returns base64 content only to the authenticated app session that
   already owns the Gmail token. */

import { getAttachment } from "../../lib/gmail/client.js";

const MAX_PREVIEW_BYTES = 6 * 1024 * 1024;

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const { userId, gmailMessageId, messageId, attachmentId, fileName, filename, mimeType, size } = req.body || {};
  if (!validUuid(userId)) return res.status(400).json({ ok: false, error: "A real Supabase userId is required" });
  if (!gmailMessageId && !messageId) return res.status(400).json({ ok: false, error: "gmailMessageId is required" });
  if (!attachmentId) return res.status(400).json({ ok: false, error: "attachmentId is required" });
  if (Number(size || 0) > MAX_PREVIEW_BYTES) {
    return res.status(413).json({ ok: false, error: "Attachment is too large to preview" });
  }

  try {
    const file = await getAttachment(userId, gmailMessageId || messageId, attachmentId);
    if (file.size > MAX_PREVIEW_BYTES) {
      return res.status(413).json({ ok: false, error: "Attachment is too large to preview" });
    }
    return res.status(200).json({
      ok: true,
      fileName: fileName || filename || "attachment",
      mimeType: mimeType || "application/octet-stream",
      size: file.size || size || 0,
      contentBase64: file.contentBase64,
    });
  } catch (err) {
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected" });
    }
    console.error("Gmail attachment fetch failed:", err.message);
    return res.status(502).json({ ok: false, error: "attachment_fetch_failed" });
  }
}
