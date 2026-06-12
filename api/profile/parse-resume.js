/* POST /api/profile/parse-resume
   Input:  { fileName, contentBase64 }  (or { text } if already extracted)
   Output: { ok, parsed: {...facts}, textExtracted, source: "openai"|"claude"|"deterministic" }
   OpenAI (MODELS.draft, structured JSON) is tried first when CHATGPT_API_KEY
   is set, then Claude (legacy path) when ANTHROPIC_API_KEY is set, then
   deterministic extraction. Never stores the file server-side. */

import { extractText } from "../../lib/resume/extract.js";
import { extractResumeFacts } from "../../lib/resume/facts.js";
import { claudeJSON, claudeConfigured, RESUME_SCHEMA } from "../../lib/knock/claude.js";
import { openaiJSON, openaiConfigured, MODELS } from "../../lib/knock/openai.js";
import { resumeSystem, RESUME_JSON_SCHEMA } from "../../lib/knock/prompts.js";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 24_000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { fileName = "", contentBase64, text: rawText } = req.body || {};

  let text = (rawText || "").trim();
  if (!text && contentBase64) {
    let buf;
    try { buf = Buffer.from(contentBase64, "base64"); }
    catch { return res.status(400).json({ error: "contentBase64 is not valid base64" }); }
    if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: "File too large (6MB max)" });
    try { text = extractText(fileName, buf); }
    catch { text = ""; }
  }
  text = text.slice(0, MAX_TEXT_CHARS);

  if (!text) {
    return res.status(200).json({
      ok: false,
      textExtracted: false,
      parsed: null,
      note: "Could not read text from this file. Scanned/image PDFs aren't supported yet; export as a text PDF or .docx, or paste the text.",
    });
  }

  const deterministic = extractResumeFacts(text);

  let parsed = null;
  let source = "deterministic";
  if (openaiConfigured()) {
    parsed = await openaiJSON({
      system: resumeSystem(),
      prompt: `Parse this resume:\n\n${text}`,
      schema: RESUME_JSON_SCHEMA,
      model: MODELS.draft,
      maxTokens: 2500,
      effort: "low",
    });
    if (parsed) source = "openai";
  }
  if (!parsed && claudeConfigured()) {
    parsed = await claudeJSON({
      system: "You parse resumes into structured profile data for a cold-outreach product. Be faithful to the document: keep the person's numbers and phrasing in wins and bullets, fix obvious typos in proper nouns (school and company names), and never invent facts.",
      prompt: `Parse this resume:\n\n${text}`,
      schema: RESUME_SCHEMA,
      maxTokens: 2500,
    });
    if (parsed) source = "claude";
  }

  const merged = parsed
    ? { ...parsed, skills: [...new Set([...(parsed.skills || []), ...deterministic.skills])].slice(0, 14) }
    : { fullName: "", extraContext: "", ...deterministic };

  return res.status(200).json({
    ok: true,
    textExtracted: true,
    source,
    parsed: merged,
  });
}
