/* Writing-style analysis from the user's own samples.
   The deterministic analyzer reads measurable signals (sentence length,
   contractions, punctuation energy, formality markers); when an
   ANTHROPIC_API_KEY is configured the API route layers Claude on top.
   The output shape is the styleProfile stored on the user's profile and
   consumed by lib/knock/drafts.js. */

const FORMAL_MARKERS = /\b(furthermore|moreover|therefore|regarding|pursuant|accordingly|sincerely|respectfully|whom|hereby)\b/gi;
const CASUAL_MARKERS = /\b(hey|gonna|wanna|btw|lol|super|honestly|kinda|stuff|awesome|cool)\b/gi;
const CONTRACTIONS = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/g;

export function analyzeStyleDeterministic(samples = []) {
  const text = samples.filter(Boolean).join("\n\n").trim();
  if (!text) return null;

  const sentences = text.split(/[.!?]+\s/).map((s) => s.trim()).filter((s) => s.length > 2);
  const words = text.split(/\s+/).filter(Boolean);
  const avgLen = sentences.length ? words.length / sentences.length : 14;

  const contractionRate = (text.match(CONTRACTIONS) || []).length / Math.max(sentences.length, 1);
  const exclaimRate = (text.match(/!/g) || []).length / Math.max(sentences.length, 1);
  const formalHits = (text.match(FORMAL_MARKERS) || []).length;
  const casualHits = (text.match(CASUAL_MARKERS) || []).length;

  const quirks = [];
  if (exclaimRate > 0.15) quirks.push("uses exclamation points freely");
  if (/^\s*(hey|hi|hello)\b/im.test(text)) quirks.push("opens with a direct greeting");
  if (/\?\s*$/m.test(text)) quirks.push("likes ending on a question");
  if (avgLen < 11) quirks.push("punchy, short sentences");
  if (/—|--/.test(text)) quirks.push("uses dashes for asides");

  return {
    source: "deterministic",
    sentenceLength: avgLen < 11 ? "short" : avgLen > 19 ? "long" : "medium",
    usesContractions: contractionRate > 0.25,
    formality: casualHits > formalHits + 1 ? "casual" : formalHits > casualHits + 1 ? "formal" : "neutral",
    energy: exclaimRate > 0.12 || casualHits > 2 ? "upbeat" : exclaimRate > 0.03 ? "warm" : "calm",
    quirks: quirks.slice(0, 4),
    sampleOpener: "",
  };
}
