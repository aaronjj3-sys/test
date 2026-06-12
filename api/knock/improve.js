/* POST /api/knock/improve
   Input:  { profile, door, subject, body }
   Output: { ok: true, draft: { subject, body }, source: "openai" }
   Premium pass: MODELS.improve elevates clarity, specificity, and hook
   strength while preserving the user's voice, facts, ask, and length.
   Unlike /api/knock/draft there is no template fallback; without the
   OpenAI key this feature simply is not available (503). */

import { openaiJSON, openaiConfigured, MODELS } from "../../lib/knock/openai.js";
import { improvePrompt, EMAIL_JSON_SCHEMA } from "../../lib/knock/prompts.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { profile = {}, door = {}, subject = "", body } = req.body || {};
  if (!body || typeof body !== "string") {
    return res.status(400).json({ error: "body (the draft email text) is required" });
  }
  if (!openaiConfigured()) {
    return res.status(503).json({ ok: false, error: "AI improve requires the OpenAI key (CHATGPT_API_KEY)" });
  }

  const { system, prompt } = improvePrompt({ profile, door, subject, body });
  const out = await openaiJSON({
    system,
    prompt,
    schema: EMAIL_JSON_SCHEMA,
    model: MODELS.improve,
    maxTokens: 1500,
    effort: "medium",
  });
  if (!out?.subject || !out?.body) {
    return res.status(502).json({ ok: false, error: "AI improve failed, please try again" });
  }

  return res.status(200).json({
    ok: true,
    source: "openai",
    draft: { subject: out.subject.trim(), body: out.body.trim() },
  });
}
