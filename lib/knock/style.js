/* Writing-style analysis from the user's own samples.
   The deterministic analyzer reads measurable signals (sentence length,
   contractions, punctuation energy, formality markers, greeting/signoff
   style); when LLM keys are configured the shared analyzer layers AI on top.
   The output shape is the styleProfile stored on the user's profile and
   consumed by lib/knock/drafts.js. */

const FORMAL_MARKERS = /\b(furthermore|moreover|therefore|regarding|pursuant|accordingly|sincerely|respectfully|whom|hereby)\b/gi;
const CASUAL_MARKERS = /\b(hey|gonna|wanna|btw|lol|super|honestly|kinda|stuff|awesome|cool)\b/gi;
const CONTRACTIONS = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/g;

function mostCommon(values = []) {
  const counts = new Map();
  for (const value of values.map((v) => String(v || "").trim()).filter(Boolean)) {
    const key = value.toLowerCase();
    counts.set(key, { value, count: (counts.get(key)?.count || 0) + 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.value || "";
}

function firstContentLine(block = "") {
  return String(block || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
}

function inferGreeting(samples = []) {
  const greetings = samples
    .map(firstContentLine)
    .filter((line) => /^(hi|hey|hello|dear)\b/i.test(line))
    .map((line) => line.replace(/\b[A-Z][a-z]+(?=,|\b)/, "<name>").slice(0, 80));
  const common = mostCommon(greetings);
  if (common) return common;
  return samples.some((s) => /^(hi|hey|hello|dear)\b/im.test(s)) ? "direct greeting" : "often jumps straight in";
}

function inferSignoff(samples = []) {
  const closers = [];
  for (const sample of samples) {
    const lines = String(sample || "").split("\n").map((l) => l.trim()).filter(Boolean);
    const tail = lines.slice(-5);
    const idx = tail.findIndex((line) => /^(thanks|thank you|best|cheers|sincerely|appreciate it|warmly|regards|building)[,!]?$/i.test(line));
    if (idx >= 0) {
      const next = tail[idx + 1] ? ` ${tail[idx + 1]}` : "";
      closers.push(`${tail[idx]}${next}`.slice(0, 80));
    } else if (tail.length) {
      const last = tail[tail.length - 1];
      if (/^-?\s*[A-Z][a-z]+$/.test(last) || /^-?\s*[A-Z]$/.test(last)) closers.push(last.replace(/^-\s*/, ""));
    }
  }
  return mostCommon(closers) || "";
}

function inferPunctuation(text, avgLen, exclaimRate) {
  const habits = [];
  if (exclaimRate > 0.12) habits.push("uses exclamation points freely");
  else if (exclaimRate > 0.03) habits.push("uses occasional exclamation points");
  if (/\?\s*$/m.test(text)) habits.push("often ends with a question");
  if (/--|—/.test(text)) habits.push("uses dashes for asides");
  if (avgLen < 11) habits.push("short, punchy sentence rhythm");
  if (/\n\n[A-Z][^.!?]{8,80}\n\n/.test(text)) habits.push("uses short standalone paragraphs");
  return habits.join("; ") || "clean, restrained punctuation";
}

function inferVocabulary(text) {
  const phrases = [];
  const candidates = [
    "quick context", "happy to", "would love", "thanks so much", "really appreciate",
    "wanted to", "figured", "totally", "super", "no worries", "sounds good",
  ];
  const lower = text.toLowerCase();
  for (const phrase of candidates) {
    if (lower.includes(phrase)) phrases.push(phrase);
  }
  return phrases.length ? phrases.slice(0, 5).join(", ") : "";
}

export function analyzeStyleDeterministic(samples = []) {
  const normalizedSamples = samples.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  const text = normalizedSamples.join("\n\n").trim();
  if (!text) return null;

  const sentences = text.split(/[.!?]+\s/).map((s) => s.trim()).filter((s) => s.length > 2);
  const words = text.split(/\s+/).filter(Boolean);
  const avgLen = sentences.length ? words.length / sentences.length : 14;

  const contractionRate = (text.match(CONTRACTIONS) || []).length / Math.max(sentences.length, 1);
  const exclaimRate = (text.match(/!/g) || []).length / Math.max(sentences.length, 1);
  const formalHits = (text.match(FORMAL_MARKERS) || []).length;
  const casualHits = (text.match(CASUAL_MARKERS) || []).length;
  const warmthHits = (text.match(/\b(thanks|thank you|appreciate|grateful|happy to|would love|glad)\b/gi) || []).length;

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
    sampleOpener: firstContentLine(normalizedSamples[0] || ""),
    greetingStyle: inferGreeting(normalizedSamples),
    signoffStyle: inferSignoff(normalizedSamples),
    punctuationHabits: inferPunctuation(text, avgLen, exclaimRate),
    vocabularyNotes: inferVocabulary(text),
    averageSentenceWords: Math.max(1, Math.round(avgLen)),
    warmth: warmthHits > Math.max(4, sentences.length * 0.2) ? "effusive" : warmthHits > 0 || exclaimRate > 0.03 ? "warm" : "reserved",
  };
}
