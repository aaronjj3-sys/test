/* POST /api/profile/analyze-style
   Input:  { samples: [string], story? }
   Output: { ok, styleProfile, source: "openai"|"claude"|"deterministic" }
   Learns the user's writing voice from their own samples. Deterministic
   metrics always run; OpenAI refines first when CHATGPT_API_KEY is set,
   then Claude (legacy path) when ANTHROPIC_API_KEY is set. */

import { analyzeStyleDeterministic } from "../../lib/knock/style.js";
import { claudeJSON, claudeConfigured, STYLE_SCHEMA } from "../../lib/knock/claude.js";
import { openaiJSON, openaiConfigured, MODELS } from "../../lib/knock/openai.js";
import { stylePrompt, STYLE_JSON_SCHEMA } from "../../lib/knock/prompts.js";

const MAX_SAMPLE_CHARS = 12_000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { samples = [], story = "" } = req.body || {};
  const texts = [story, ...samples].filter((s) => typeof s === "string" && s.trim());

  const deterministic = analyzeStyleDeterministic(texts);
  if (!deterministic) {
    return res.status(200).json({ ok: false, styleProfile: null, note: "No writing samples to learn from yet." });
  }

  const corpus = texts.join("\n\n---\n\n").slice(0, MAX_SAMPLE_CHARS);

  let refined = null;
  let refinedSource = null;
  if (openaiConfigured()) {
    const { system, prompt } = stylePrompt(corpus);
    refined = await openaiJSON({
      system,
      prompt,
      schema: STYLE_JSON_SCHEMA,
      model: MODELS.draft,
      maxTokens: 800,
      effort: "low",
    });
    if (refined) refinedSource = "openai";
  }
  if (!refined && claudeConfigured()) {
    refined = await claudeJSON({
      system: "You analyze writing samples to capture someone's natural voice so an outreach tool can draft emails that sound like them. Describe how they actually write, not how they should.",
      prompt: `Writing samples from one person:\n\n${corpus}`,
      schema: STYLE_SCHEMA,
      maxTokens: 800,
    });
    if (refined) refinedSource = "claude";
  }

  const styleProfile = refined
    ? { ...refined, quirks: (refined.quirks || []).slice(0, 4), source: refinedSource }
    : deterministic;

  return res.status(200).json({ ok: true, source: styleProfile.source, styleProfile });
}
