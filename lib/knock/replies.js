/* Reply-handling helpers for the Gmail sync/cron pipeline. These three
   signatures are a contract consumed by the inbox-sync code; do not change
   them. Every function returns null on any LLM failure so callers can skip
   or retry, and every string field comes back em-dash-sanitized (handled
   inside openaiJSON). threadMessages = [{ from, date, body, subject? }],
   oldest first. */

import { openaiJSON, openaiConfigured, MODELS } from "./openai.js";
import {
  classifyReplyPrompt,
  replyDraftPrompt,
  followupPrompt,
  EMAIL_JSON_SCHEMA,
  REPLY_CLASSIFICATION_SCHEMA,
} from "./prompts.js";

/** "Re: <base>" with any existing Re: prefixes stripped first. */
function reSubject(base, fallback) {
  const s = String(base || fallback || "").trim().replace(/^(\s*re:\s*)+/i, "").trim();
  return `Re: ${s || "your note"}`;
}

const derivedSubject = (door) => `quick question about ${door?.companyName || "your company"}`;

/** Classify the recipient's latest message in a thread.
    → { type, wantsCall, sentiment, summary } or null. */
export async function classifyReply({ profile, door, threadMessages }) {
  if (!openaiConfigured() || !Array.isArray(threadMessages) || !threadMessages.length) return null;
  const { system, prompt } = classifyReplyPrompt({ door, threadMessages });
  const out = await openaiJSON({
    system,
    prompt,
    schema: REPLY_CLASSIFICATION_SCHEMA,
    model: MODELS.classify,
    maxTokens: 600,
    effort: "minimal",
  });
  if (!out?.type) return null;
  return {
    type: out.type,
    wantsCall: Boolean(out.wantsCall),
    sentiment: out.sentiment || "neutral",
    summary: out.summary || "",
  };
}

/** Draft the auto-reply to a classified response.
    meetLink: string URL or { url, when }. → { subject, body } or null. */
export async function draftReply({ profile, door, threadMessages, classification, tone, styleProfile, meetLink }) {
  if (!openaiConfigured() || !Array.isArray(threadMessages) || !threadMessages.length) return null;
  const { system, prompt } = replyDraftPrompt({ profile, door, threadMessages, classification, tone, styleProfile, meetLink });
  const out = await openaiJSON({
    system,
    prompt,
    schema: EMAIL_JSON_SCHEMA,
    model: MODELS.draft,
    maxTokens: 1200,
    effort: "low",
  });
  if (!out?.body) return null;
  const original = threadMessages[0]?.subject || out.subject || derivedSubject(door);
  return { subject: reSubject(original, derivedSubject(door)), body: out.body.trim() };
}

/** Draft polite nudge #followupNumber (1 or 2, max 2 per door).
    previousMessage: { subject, body } or a plain body string.
    → { subject, body } or null. */
export async function draftFollowup({ profile, door, previousMessage, followupNumber = 1, tone, styleProfile }) {
  if (!openaiConfigured() || !previousMessage) return null;
  const prev = typeof previousMessage === "string" ? { subject: "", body: previousMessage } : previousMessage;
  const { system, prompt } = followupPrompt({ profile, door, previousMessage: prev, followupNumber, tone, styleProfile });
  const out = await openaiJSON({
    system,
    prompt,
    schema: EMAIL_JSON_SCHEMA,
    model: MODELS.draft,
    maxTokens: 800,
    effort: "low",
  });
  if (!out?.body) return null;
  const base = prev.subject || out.subject || derivedSubject(door);
  return { subject: reSubject(base, derivedSubject(door)), body: out.body.trim() };
}
