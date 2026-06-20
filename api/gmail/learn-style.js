/* POST /api/gmail/learn-style
   Explicit opt-in voice learning from the authenticated user's own Gmail
   Sent Mail. Scans bounded sent messages only, cleans bodies, selects a
   small representative set, analyzes voice, and merges it into profile_json. */

import { supabaseConfigured, sbSelect, sbUpsert } from "../../lib/supabase/admin.js";
import { getGoogleConnection, searchMessages, getMessage, getThread } from "../../lib/gmail/client.js";
import { cleanEmailBody, isUsefulWritingSample, classifySample, wordCount } from "../../lib/gmail/cleanEmail.js";
import { analyzeWritingStyle } from "../../lib/knock/analyzeStyle.js";

const MAX_MESSAGES = 100;
const MAX_STORED_SAMPLES = 20;
const MAX_VOICE_EXAMPLES = 8;
const MAX_TOTAL_SAMPLE_CHARS = 18_000;
const MAX_BODY_CHARS = 2_500;
const THREAD_CONTEXT_LIMIT = 25;
const CATEGORY_ORDER = ["scheduling", "reply", "cold_intro", "follow_up", "thank_you", "general"];

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

function boundedInteger(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function preview(text = "", max = 220) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function gmailSentQuery(months) {
  return [
    "in:sent",
    `newer_than:${months}m`,
    "-from:noreply",
    "-from:no-reply",
    "-from:notifications",
    "-to:noreply",
    "-to:no-reply",
    "-to:notifications",
  ].join(" ");
}

async function mapLimit(items, limit, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    out.push(...await Promise.all(batch.map(fn)));
  }
  return out;
}

function priorInboundFor(message, thread = []) {
  if (!thread.length) return null;
  const sentTs = Date.parse(message.date || "") || Number(message.internalDate || 0) || 0;
  const sentIndex = thread.findIndex((m) => m.id === message.id);
  const before = sentIndex >= 0
    ? thread.slice(0, sentIndex)
    : thread.filter((m) => {
        const ts = Date.parse(m.date || "") || 0;
        return sentTs ? ts < sentTs : true;
      });
  const inbound = [...before].reverse().find((m) => !m.isFromMe && cleanEmailBody(m.body || m.bodyHtml || ""));
  if (!inbound) return null;
  return {
    subject: inbound.subject || "",
    date: inbound.date || null,
    bodyPreview: preview(cleanEmailBody(inbound.body || inbound.bodyHtml || ""), 260),
  };
}

function candidateScore(sample) {
  const categoryBonus = {
    scheduling: 40,
    reply: 34,
    cold_intro: 30,
    follow_up: 26,
    thank_you: 20,
    general: 12,
  }[sample.category] || 0;
  const words = Math.min(sample.wordCount, 350);
  const recent = Date.parse(sample.date || "") || 0;
  return categoryBonus + words / 12 + recent / 10_000_000_000_000;
}

function selectBestSamples(candidates) {
  const byCategory = new Map();
  for (const category of CATEGORY_ORDER) byCategory.set(category, []);
  for (const sample of candidates) {
    const bucket = byCategory.get(sample.category) || byCategory.get("general");
    bucket.push(sample);
  }
  for (const bucket of byCategory.values()) {
    bucket.sort((a, b) => candidateScore(b) - candidateScore(a));
  }

  const selected = [];
  const seen = new Set();
  let chars = 0;
  const add = (sample) => {
    if (!sample || seen.has(sample.gmailMessageId) || selected.length >= MAX_STORED_SAMPLES) return;
    const body = sample.body.slice(0, MAX_BODY_CHARS);
    if (chars + body.length > MAX_TOTAL_SAMPLE_CHARS) return;
    selected.push({ ...sample, body });
    seen.add(sample.gmailMessageId);
    chars += body.length;
  };

  let madeProgress = true;
  while (madeProgress && selected.length < MAX_STORED_SAMPLES) {
    madeProgress = false;
    for (const category of CATEGORY_ORDER) {
      const next = byCategory.get(category)?.shift();
      if (next) {
        add(next);
        madeProgress = true;
      }
    }
  }
  return selected;
}

function categoryCounts(samples) {
  return samples.reduce((acc, sample) => {
    acc[sample.category] = (acc[sample.category] || 0) + 1;
    return acc;
  }, {});
}

function compactExample(sample) {
  return {
    source: sample.source,
    gmailMessageId: sample.gmailMessageId,
    gmailThreadId: sample.gmailThreadId,
    subject: sample.subject,
    category: sample.category,
    date: sample.date,
    wordCount: sample.wordCount,
    body: sample.body.slice(0, 1200),
    bodyPreview: sample.bodyPreview,
  };
}

function samplePreview(sample) {
  return {
    id: sample.gmailMessageId,
    category: sample.category,
    subject: sample.subject,
    bodyPreview: sample.bodyPreview,
    wordCount: sample.wordCount,
    date: sample.date,
  };
}

function profileFromRow(row = {}, fallbackEmail = "") {
  return row.profile_json || {
    fullName: row.full_name || "",
    email: row.email || fallbackEmail || "",
    school: row.school || "",
    location: row.location || "",
    story: row.story || "",
    tone: row.tone || "Sharp",
  };
}

function mergeProfile(profile, { selected, voiceExamples, styleProfile, voiceLearning, learnedAt }) {
  const existingWriting = Array.isArray(profile.writingSamples) ? profile.writingSamples : [];
  const nonGmailWriting = existingWriting.filter((s) => !(s && typeof s === "object" && s.source === "gmail_sent"));
  const existingExamples = Array.isArray(profile.voiceExamples) ? profile.voiceExamples : [];
  const nonGmailExamples = existingExamples.filter((s) => !(s && typeof s === "object" && s.source === "gmail_sent"));

  return {
    ...profile,
    styleProfile,
    writingSamples: [...selected, ...nonGmailWriting].slice(0, 30),
    voiceExamples: [...voiceExamples, ...nonGmailExamples].slice(0, 30),
    voiceLearning,
    updatedAt: learnedAt,
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  const { userId } = req.body || {};
  if (!validUuid(userId) || userId === "dev") {
    return res.status(400).json({
      ok: false,
      error: "real_user_required",
      message: "Sign in to Knock first.",
    });
  }
  if (!supabaseConfigured()) {
    return res.status(503).json({ ok: false, error: "supabase_not_configured", message: "Profile storage is not configured yet." });
  }

  const maxMessages = boundedInteger(req.body?.maxMessages, MAX_MESSAGES, 10, MAX_MESSAGES);
  const months = boundedInteger(req.body?.months, 12, 1, 24);
  const includeReplyPairs = req.body?.includeReplyPairs !== false;
  const learnedAt = new Date().toISOString();

  try {
    const connection = await getGoogleConnection(userId);
    if (!connection) {
      return res.status(412).json({ ok: false, error: "google_not_connected", message: "Connect Google first." });
    }

    const ids = await searchMessages(userId, gmailSentQuery(months), maxMessages);
    const messages = (await mapLimit(ids, 5, async (m) => {
      try {
        return await getMessage(userId, m.id);
      } catch (err) {
        console.error("Voice learning message fetch failed:", err.message);
        return null;
      }
    })).filter(Boolean);

    const threadContexts = new Map();
    if (includeReplyPairs) {
      const replyMessages = messages
        .filter((m) => /^re:/i.test(m.subject || "") && m.threadId)
        .slice(0, THREAD_CONTEXT_LIMIT);
      await mapLimit(replyMessages, 3, async (m) => {
        try {
          const thread = await getThread(userId, m.threadId);
          threadContexts.set(m.id, priorInboundFor(m, thread));
        } catch (err) {
          console.error("Voice learning thread fetch failed:", err.message);
        }
      });
    }

    const candidates = [];
    for (const message of messages) {
      const body = cleanEmailBody(message.body || message.bodyHtml || "");
      if (!isUsefulWritingSample(body, message)) continue;
      const threadContext = threadContexts.get(message.id) || null;
      const category = classifySample(message, body, threadContext);
      const sample = {
        source: "gmail_sent",
        gmailMessageId: message.id,
        gmailThreadId: message.threadId,
        subject: (message.subject || "").slice(0, 180),
        category,
        date: message.date || null,
        wordCount: wordCount(body),
        body,
        bodyPreview: preview(body, 220),
      };
      candidates.push(sample);
    }

    if (!candidates.length) {
      return res.status(200).json({
        ok: false,
        error: "no_samples",
        message: "Scout could not find enough sent emails to learn from yet.",
        source: "gmail",
        scanned: messages.length,
        usableSamples: 0,
      });
    }

    const selected = selectBestSamples(candidates);
    if (!selected.length) {
      return res.status(200).json({
        ok: false,
        error: "no_samples",
        message: "Scout could not find enough sent emails to learn from yet.",
        source: "gmail",
        scanned: messages.length,
        usableSamples: candidates.length,
      });
    }

    const styleProfile = await analyzeWritingStyle(selected, {
      learnedFrom: "gmail_sent",
      sampleCount: selected.length,
      learnedAt,
    });
    if (!styleProfile) {
      return res.status(200).json({
        ok: false,
        error: "no_samples",
        message: "Scout could not find enough sent emails to learn from yet.",
        source: "gmail",
        scanned: messages.length,
        usableSamples: candidates.length,
      });
    }

    const counts = categoryCounts(selected);
    const voiceExamples = selected.slice(0, MAX_VOICE_EXAMPLES).map(compactExample);
    const voiceLearning = {
      enabled: true,
      source: "gmail_sent",
      sampleCount: selected.length,
      scannedCount: messages.length,
      selectedCount: selected.length,
      categories: counts,
      learnedAt,
      months,
      status: "ready",
    };

    const rows = await sbSelect("profiles", { filter: { user_id: userId }, limit: 1 });
    const row = rows?.[0] || {};
    const profile = profileFromRow(row, connection.provider_email || "");
    const nextProfile = mergeProfile(profile, { selected, voiceExamples, styleProfile, voiceLearning, learnedAt });
    const saved = await sbUpsert("profiles", [{
      user_id: userId,
      email: nextProfile.email || connection.provider_email || null,
      profile_json: nextProfile,
      style_profile: styleProfile,
      updated_at: learnedAt,
    }], "user_id");
    if (!saved) {
      return res.status(503).json({ ok: false, error: "profile_save_failed", message: "Scout learned your voice, but could not save it yet." });
    }

    return res.status(200).json({
      ok: true,
      source: "gmail",
      scanned: messages.length,
      usableSamples: candidates.length,
      selectedSamples: selected.length,
      styleProfile,
      voiceLearning,
      samplesPreview: selected.map(samplePreview),
    });
  } catch (err) {
    if (err.message === "google_not_connected") {
      return res.status(412).json({ ok: false, error: "google_not_connected", message: "Connect Google first." });
    }
    console.error("Voice learning failed:", err.message);
    return res.status(502).json({ ok: false, error: "learn_style_failed", message: "Scout could not learn from Gmail yet. Try again in a minute." });
  }
}
