/* POST /api/profile/parse-resume
   Input:  { fileName, contentBase64 }  (or { text } if already extracted)
   Output: { ok, parsed: {...facts}, textExtracted, source: "openai"|"claude"|"claude_pdf"|"deterministic" }
   Claude Haiku is tried first when ANTHROPIC_API_KEY is set, then OpenAI when
   CHATGPT_API_KEY is set, then deterministic extraction. Never stores the file
   server-side. */

import { extractText } from "../../lib/resume/extract.js";
import { extractResumeFacts } from "../../lib/resume/facts.js";
import { claudeJSON, claudeConfigured, RESUME_V2_SCHEMA } from "../../lib/knock/claude.js";
import { openaiJSON, openaiConfigured, MODELS } from "../../lib/knock/openai.js";
import { resumeSystem, RESUME_V2_JSON_SCHEMA } from "../../lib/knock/prompts.js";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 24_000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { fileName = "", contentBase64, text: rawText } = req.body || {};

  let text = (rawText || "").trim();
  let buf = null;
  if (!text && contentBase64) {
    try { buf = Buffer.from(contentBase64, "base64"); }
    catch { return res.status(400).json({ error: "contentBase64 is not valid base64" }); }
    if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: "File too large (6MB max)" });
    try { text = extractText(fileName, buf); }
    catch { text = ""; }
  }
  text = text.slice(0, MAX_TEXT_CHARS);

  const isPdf = /\.pdf$/i.test(fileName) || buf?.subarray(0, 5).toString() === "%PDF-";
  if (!text && isPdf && contentBase64 && claudeConfigured()) {
    const parsed = await claudeJSON({
      system: resumeSystem(),
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: contentBase64,
          },
        },
        { type: "text", text: "Parse this resume PDF. Preserve the resume's original sections and return only structured JSON." },
      ],
      schema: RESUME_V2_SCHEMA,
      maxTokens: 3500,
    });
    if (parsed) {
      return res.status(200).json({
        ok: true,
        textExtracted: false,
        documentParsed: true,
        source: "claude_pdf",
        parsed,
        note: "",
      });
    }
  }

  if (!text) {
    const ext = (fileName || "").toLowerCase().split(".").pop();
    return res.status(200).json({
      ok: false,
      textExtracted: false,
      parsed: null,
      note: ext === "doc"
        ? "Legacy .doc files are not reliably readable in this build. Save it as .docx or PDF and upload again."
        : "Could not read text from this file. For scanned PDFs, make sure ANTHROPIC_API_KEY is set so Scout can use Claude's PDF reader.",
    });
  }

  const deterministic = extractResumeFacts(text);

  let parsed = null;
  let source = "deterministic";
  if (claudeConfigured()) {
    parsed = await claudeJSON({
      system: "You parse resumes into structured profile data for a cold-outreach product. Be faithful to the document: keep the person's numbers and phrasing in wins and bullets, fix obvious typos in proper nouns (school and company names), and never invent facts.",
      prompt: `Parse this resume:\n\n${text}`,
      schema: RESUME_V2_SCHEMA,
      maxTokens: 3500,
    });
    if (parsed) source = "claude";
  }
  if (!parsed && openaiConfigured()) {
    parsed = await openaiJSON({
      system: resumeSystem(),
      prompt: `Parse this resume:\n\n${text}`,
      schema: RESUME_V2_JSON_SCHEMA,
      model: MODELS.draft,
      maxTokens: 3500,
      effort: "low",
    });
    if (parsed) source = "openai";
  }

  const merged = parsed
    ? {
      ...parsed,
      sections: Array.isArray(parsed.sections) && parsed.sections.length ? parsed.sections : deterministic.sections || [],
      skills: [...new Set([...(parsed.skills || []), ...deterministic.skills])].slice(0, 14),
    }
    : { fullName: "", extraContext: "", ...deterministic };

  return res.status(200).json({
    ok: true,
    textExtracted: true,
    source,
    parsed: merged,
    note: source === "deterministic"
      ? "AI parser unavailable; deterministic resume extraction ran instead."
      : "",
  });
}
