/* POST /api/knock/draft
   Input:  { profile, door, tone?, styleProfile? }
   Output: { ok: true, draft: { subject, body, preview }, source: "openai"|"template" }
   Builds the full first-touch email with OpenAI (MODELS.draft) when the key
   is set; on any LLM failure falls back to the deterministic template in
   lib/knock/drafts.js, so this route always returns a usable draft. */

import { openaiJSON, openaiConfigured, MODELS } from "../../lib/knock/openai.js";
import { draftEmailPrompt, EMAIL_JSON_SCHEMA } from "../../lib/knock/prompts.js";
import { generateDraftPreview } from "../../lib/knock/drafts.js";

const PREVIEW_CHARS = 90;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { profile = {}, door, tone, styleProfile } = req.body || {};
  if (!door || typeof door !== "object") return res.status(400).json({ error: "door is required" });

  const effTone = tone || profile.tone;
  const effStyle = styleProfile || profile.styleProfile;

  if (openaiConfigured()) {
    const { system, prompt } = draftEmailPrompt({ profile, door, tone: effTone, styleProfile: effStyle });
    const out = await openaiJSON({
      system,
      prompt,
      schema: EMAIL_JSON_SCHEMA,
      model: MODELS.draft,
      maxTokens: 1200,
      effort: "low",
    });
    if (out?.subject && out?.body) {
      let body = out.body.trim();
      /* the body must end with the user's signoff; append if the model dropped it */
      const signoff = (profile.signoff || `- ${(profile.fullName || "Me").split(" ")[0]}`).replace(/^-\s*/, "");
      if (!body.slice(-120).includes(signoff)) body = `${body}\n\n${signoff}`;
      return res.status(200).json({
        ok: true,
        source: "openai",
        draft: { subject: out.subject.trim(), body, preview: body.slice(0, PREVIEW_CHARS) },
      });
    }
  }

  /* deterministic fallback: same tone + style shaping as the sourcing flow */
  const d = generateDraftPreview({ ...profile, tone: effTone, styleProfile: effStyle }, door);
  return res.status(200).json({
    ok: true,
    source: "template",
    draft: { subject: d.subject, body: d.body, preview: d.preview },
  });
}
