/* POST /api/profile/extract-text
   Input: { fileName, contentBase64 }
   Output: { ok, text }
   Lightweight server-side text extraction for writing samples. */

import { extractText } from "../../lib/resume/extract.js";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { fileName = "", contentBase64 } = req.body || {};
  if (!contentBase64) return res.status(400).json({ error: "contentBase64 is required" });

  let buf;
  try { buf = Buffer.from(contentBase64, "base64"); }
  catch { return res.status(400).json({ error: "contentBase64 is not valid base64" }); }
  if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: "File too large (6MB max)" });

  let text = "";
  try { text = extractText(fileName, buf); }
  catch { text = ""; }

  return res.status(200).json({
    ok: Boolean(text.trim()),
    text: text.trim().slice(0, MAX_TEXT_CHARS),
  });
}
