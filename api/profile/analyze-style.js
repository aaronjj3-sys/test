/* POST /api/profile/analyze-style
   Input:  { samples: [string], story? }
   Output: { ok, styleProfile, source }
   Learns the user's writing voice from their own samples. Deterministic
   metrics always run; Claude (haiku) refines when a key is configured. */

import { analyzeStyleDeterministic } from "../../lib/knock/style.js";
import { claudeJSON, claudeConfigured, STYLE_SCHEMA } from "../../lib/knock/claude.js";

const MAX_SAMPLE_CHARS = 12_000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { samples = [], story = "" } = req.body || {};
  const texts = [story, ...samples].filter((s) => typeof s === "string" && s.trim());

  const deterministic = analyzeStyleDeterministic(texts);
  if (!deterministic) {
    return res.status(200).json({ ok: false, styleProfile: null, note: "No writing samples to learn from yet." });
  }

  let refined = null;
  if (claudeConfigured()) {
    const corpus = texts.join("\n\n---\n\n").slice(0, MAX_SAMPLE_CHARS);
    refined = await claudeJSON({
      system: "You analyze writing samples to capture someone's natural voice so an outreach tool can draft emails that sound like them. Describe how they actually write, not how they should.",
      prompt: `Writing samples from one person:\n\n${corpus}`,
      schema: STYLE_SCHEMA,
      maxTokens: 800,
    });
  }

  const styleProfile = refined
    ? { ...refined, source: "claude" }
    : deterministic;

  return res.status(200).json({ ok: true, source: styleProfile.source, styleProfile });
}
