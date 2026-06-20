import { analyzeStyleDeterministic } from "./style.js";
import { claudeJSON, claudeConfigured, STYLE_SCHEMA } from "./claude.js";
import { openaiJSON, openaiConfigured, MODELS } from "./openai.js";
import { stylePrompt, STYLE_JSON_SCHEMA } from "./prompts.js";

const MAX_SAMPLE_CHARS = 12_000;

function sampleText(sample) {
  if (typeof sample === "string") return sample;
  if (!sample || typeof sample !== "object") return "";
  return sample.body || sample.text || sample.bodyPreview || "";
}

function cleanMetaValue(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

export async function analyzeWritingStyle(samples = [], options = {}) {
  const story = typeof options.story === "string" ? options.story : "";
  const texts = [story, ...(Array.isArray(samples) ? samples : [samples]).map(sampleText)]
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim());

  const deterministic = analyzeStyleDeterministic(texts);
  if (!deterministic) return null;

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

  const base = refined
    ? {
        ...deterministic,
        ...refined,
        quirks: (refined.quirks || deterministic.quirks || []).slice(0, 4),
        averageSentenceWords: Number.isFinite(refined.averageSentenceWords)
          ? Math.max(1, Math.round(refined.averageSentenceWords))
          : deterministic.averageSentenceWords,
        source: refinedSource,
      }
    : deterministic;

  return {
    ...base,
    learnedFrom: cleanMetaValue(options.learnedFrom, base.learnedFrom),
    sampleCount: cleanMetaValue(options.sampleCount, texts.length),
    learnedAt: cleanMetaValue(options.learnedAt, base.learnedAt),
  };
}

export { MAX_SAMPLE_CHARS };
