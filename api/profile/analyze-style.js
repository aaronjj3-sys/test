/* POST /api/profile/analyze-style
   Input:  { samples: [string], story? }
   Output: { ok, styleProfile, source: "openai"|"claude"|"deterministic" }
   Learns the user's writing voice from their own samples. Deterministic
   metrics always run; OpenAI refines first when CHATGPT_API_KEY is set,
   then Claude (legacy path) when ANTHROPIC_API_KEY is set.
   All paths return the deep breakdown (greetingStyle, signoffStyle,
   punctuationHabits, vocabularyNotes, averageSentenceWords, warmth), with
   OpenAI/Claude refining the deterministic baseline when configured. */

import { analyzeWritingStyle } from "../../lib/knock/analyzeStyle.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { samples = [], story = "" } = req.body || {};
  const styleProfile = await analyzeWritingStyle(samples, { story });
  if (!styleProfile) {
    return res.status(200).json({ ok: false, styleProfile: null, note: "No writing samples to learn from yet." });
  }

  return res.status(200).json({ ok: true, source: styleProfile.source, styleProfile });
}
