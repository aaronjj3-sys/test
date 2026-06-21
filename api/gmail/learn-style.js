/* POST /api/gmail/learn-style
   Learns writing style from the user's own sent Gmail messages.
   The route analyzes style only: raw Gmail bodies are never stored, returned,
   or logged. */

import { getSentMessagesForStyle } from "../../lib/gmail/client.js";
import { analyzeStyleFromTexts } from "../profile/analyze-style.js";

const MAX_MESSAGES = 25;
const MIN_USABLE_MESSAGES = 5;
const MIN_BODY_CHARS = 80;
const MAX_TOTAL_CHARS = 30_000;
const QUERY = "in:sent newer_than:2y -category:promotions";

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function cleanText(value = "") {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripSignatureAndDisclaimers(text = "") {
  const lines = cleanText(text).split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^--\s*$/.test(trimmed)) break;
    if (/^(sent from my|sent via|get outlook for|download outlook)/i.test(trimmed)) break;
    if (/^(confidentiality notice|privileged and confidential|this email and any attachments)/i.test(trimmed)) break;
    if (/^(unsubscribe|manage preferences|view this email in your browser)/i.test(trimmed)) break;
    if (/^_{6,}$/.test(trimmed)) break;
    out.push(line);
  }
  return cleanText(out.join("\n"));
}

function stripForwardedBlocks(text = "") {
  return cleanText(text)
    .replace(/^-{2,}\s*Forwarded message\s*-{2,}[\s\S]*$/im, "")
    .replace(/^Begin forwarded message:[\s\S]*$/im, "")
    .replace(/^-{2,}\s*Original Message\s*-{2,}[\s\S]*$/im, "");
}

function looksAutomated({ subject = "", body = "" } = {}) {
  const hay = `${subject}\n${body}`.toLowerCase();
  return [
    "do not reply",
    "do-not-reply",
    "noreply",
    "no-reply",
    "this is an automated",
    "automatically generated",
    "auto-generated",
    "unsubscribe",
    "manage your preferences",
    "receipt",
    "invoice",
    "calendar invitation",
  ].some((needle) => hay.includes(needle));
}

function extractCommonPhrases(styleProfile = {}) {
  const notes = String(styleProfile.vocabularyNotes || "");
  const phrases = notes
    .split(/[;,]\s*/)
    .map((s) => s.replace(/^["']|["']$/g, "").trim())
    .filter((s) => s.length >= 3 && s.length <= 60);
  return [...new Set(phrases)].slice(0, 8);
}

function normalizeStyleProfile(styleProfile = {}) {
  const commonPhrases = Array.isArray(styleProfile.commonPhrases)
    ? styleProfile.commonPhrases
    : extractCommonPhrases(styleProfile);
  const avoid = Array.isArray(styleProfile.avoid) ? styleProfile.avoid : [];
  const exampleRules = Array.isArray(styleProfile.exampleRules)
    ? styleProfile.exampleRules
    : (styleProfile.quirks || []).slice(0, 4);
  return {
    tone: styleProfile.energy || styleProfile.tone || "",
    sentenceLength: styleProfile.sentenceLength || "",
    openingStyle: styleProfile.openingStyle || styleProfile.greetingStyle || "",
    closingStyle: styleProfile.closingStyle || styleProfile.signoffStyle || "",
    formality: styleProfile.formality || "",
    commonPhrases,
    avoid,
    exampleRules,
    ...styleProfile,
    source: styleProfile.source || "gmail",
    learnedFrom: "gmail_sent",
  };
}

function cleanSentSample(message) {
  if (!message?.body) return "";
  if (looksAutomated({ subject: message.subject, body: message.body })) return "";
  const text = stripSignatureAndDisclaimers(stripForwardedBlocks(message.body));
  if (text.length < MIN_BODY_CHARS) return "";
  return text.slice(0, 4_000);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const { userId } = req.body || {};
  const mode = String(req.body?.mode || "manual");
  const maxMessages = Math.min(Math.max(Number(req.body?.maxMessages || MAX_MESSAGES), 1), MAX_MESSAGES);
  if (!validUuid(userId)) {
    return res.status(400).json({ ok: false, error: "real_user_required" });
  }
  if (!["manual", "auto"].includes(mode)) {
    return res.status(400).json({ ok: false, error: "invalid_mode" });
  }

  try {
    const { providerEmail, messages } = await getSentMessagesForStyle(userId, {
      query: QUERY,
      maxResults: maxMessages,
    });

    const samples = [];
    let total = 0;
    for (const message of messages) {
      const sample = cleanSentSample(message);
      if (!sample) continue;
      const room = MAX_TOTAL_CHARS - total;
      if (room <= 0) break;
      const clipped = sample.slice(0, room);
      samples.push(clipped);
      total += clipped.length;
    }

    if (samples.length < MIN_USABLE_MESSAGES) {
      return res.status(200).json({
        ok: false,
        error: "not_enough_sent_email",
        messageCount: samples.length,
      });
    }

    const result = await analyzeStyleFromTexts(samples, { maxSampleChars: MAX_TOTAL_CHARS });
    if (!result.ok || !result.styleProfile) {
      return res.status(200).json({
        ok: false,
        error: "not_enough_sent_email",
        messageCount: samples.length,
      });
    }

    return res.status(200).json({
      ok: true,
      mode,
      providerEmail,
      messageCount: samples.length,
      styleProfile: normalizeStyleProfile(result.styleProfile),
    });
  } catch (err) {
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected" });
    }
    console.error("Gmail style learning failed:", err?.message || err);
    return res.status(502).json({ ok: false, error: "learn_style_failed" });
  }
}
