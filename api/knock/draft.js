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
const MAX_SAMPLE_TOTAL_CHARS = 3600; // shared budget across editedSamples + writingSamples + voiceExamples
const MAX_SAMPLES_EACH = 10;

/** Whitelist the user's voice samples through to the prompt builders:
    up to 10 entries per array (newest first), total body chars capped. */
function capVoiceSamples(profile = {}) {
  let budget = MAX_SAMPLE_TOTAL_CHARS;
  const textOf = (s) => typeof s === "string" ? s : s?.body || s?.text || s?.bodyPreview || "";
  const cap = (arr) => (Array.isArray(arr) ? arr : [])
    .filter((s) => String(textOf(s) || "").trim())
    .slice(0, MAX_SAMPLES_EACH)
    .map((s) => {
      if (budget <= 0) return "";
      const t = String(textOf(s)).slice(0, budget);
      budget -= t.length;
      return typeof s === "string" ? t : { ...s, body: t };
    })
    .filter(Boolean);
  return {
    editedSamples: cap(profile.editedSamples),
    voiceExamples: cap(profile.voiceExamples),
    writingSamples: cap(profile.writingSamples),
    writingSampleTexts: cap(profile.writingSampleTexts),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { profile = {}, door, tone, styleProfile } = req.body || {};
  if (!door || typeof door !== "object") return res.status(400).json({ error: "door is required" });

  const effTone = tone || profile.tone;
  const effStyle = styleProfile || profile.styleProfile;
  const effProfile = { ...profile, ...capVoiceSamples(profile) };

  if (openaiConfigured()) {
    const { system, prompt } = draftEmailPrompt({ profile: effProfile, door, tone: effTone, styleProfile: effStyle });
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
  const d = generateDraftPreview({ ...effProfile, tone: effTone, styleProfile: effStyle }, door);
  return res.status(200).json({
    ok: true,
    source: "template",
    draft: { subject: d.subject, body: d.body, preview: d.preview },
  });
}
