const QUOTED_MARKERS = [
  /^On\s.+(?:wrote:|<[^>]+>)/i,
  /^wrote:$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^_{5,}$/,
  /^From:\s.+/i,
  /^Sent:\s.+/i,
  /^To:\s.+/i,
  /^Subject:\s.+/i,
  /^Date:\s.+/i,
  /^-{5,}\s*Forwarded message\s*-{5,}$/i,
  /^Begin forwarded message:/i,
];

const AUTO_PATTERNS = [
  /\bdo not reply\b/i,
  /\bthis is an automated\b/i,
  /\bverification code\b/i,
  /\bconfirm your email\b/i,
  /\bcalendar invitation\b/i,
  /\binvitation from google calendar\b/i,
  /\bunsubscribe\b/i,
  /\bprivacy policy\b/i,
];

const SIGNATURE_HINTS = [
  /^sent from my (iphone|ipad|android|mobile)/i,
  /^get outlook for/i,
  /^confidentiality notice/i,
  /^this message and any attachments/i,
  /^the information contained in this email/i,
  /^please consider the environment/i,
  /^unsubscribe\b/i,
];

function decodeEntity(entity) {
  const value = entity.toLowerCase();
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
  };
  if (named[value]) return named[value];
  if (value.startsWith("#x")) {
    const code = Number.parseInt(value.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
  }
  if (value.startsWith("#")) {
    const code = Number.parseInt(value.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${entity};`;
  }
  return `&${entity};`;
}

function normalizeWhitespace(text = "") {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToPlainText(html = "") {
  return normalizeWhitespace(
    String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<div[^>]+class=["'][^"']*(?:gmail_quote|yahoo_quoted|gmail_signature)[^"']*["'][\s\S]*?<\/div>/gi, "\n")
      .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&([a-z0-9#]+);/gi, (_all, entity) => decodeEntity(entity))
  );
}

export function stripQuotedText(text = "") {
  const lines = normalizeWhitespace(text).split("\n");
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const hasContent = out.some((l) => l.trim());
    if (trimmed.startsWith(">")) {
      if (hasContent) break;
      continue;
    }
    if (hasContent && QUOTED_MARKERS.some((re) => re.test(trimmed))) break;
    if (/^[-_]{8,}$/.test(trimmed) && hasContent) break;
    out.push(line);
  }
  return normalizeWhitespace(out.join("\n"));
}

export function stripSignature(text = "") {
  const lines = normalizeWhitespace(text).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "--" || trimmed === "-- ") break;
    if (SIGNATURE_HINTS.some((re) => re.test(trimmed))) break;
    const remaining = lines.length - i;
    const signatureLike =
      remaining <= 8 &&
      (/^[-\s]*(best|thanks|thank you|cheers|sincerely|regards|warmly)[,!]?$/i.test(trimmed) ||
        /\b(linkedin|twitter|x\.com|phone|mobile|www\.|http|@)\b/i.test(trimmed));
    if (signatureLike && out.some((l) => l.trim()) && remaining > 2) break;
    out.push(lines[i]);
  }
  return normalizeWhitespace(out.join("\n"));
}

export function cleanEmailBody(rawBody = "") {
  const raw = String(rawBody || "");
  const plain = /<\/?[a-z][\s\S]*>/i.test(raw) ? htmlToPlainText(raw) : raw;
  return normalizeWhitespace(
    stripSignature(stripQuotedText(plain))
      .replace(/\[image:[^\]]+\]/gi, "")
      .replace(/\bhttps?:\/\/\S+/gi, (url) => (url.length > 80 ? "" : url))
      .replace(/\n?\s*(unsubscribe|manage preferences|view in browser)\b[\s\S]*$/i, "")
  );
}

function words(text = "") {
  return String(text || "").match(/[A-Za-z0-9']+/g) || [];
}

function mostlyUrls(text = "") {
  const urls = String(text || "").match(/https?:\/\/\S+/gi) || [];
  const urlChars = urls.reduce((sum, url) => sum + url.length, 0);
  return urlChars > 0 && urlChars / Math.max(String(text || "").length, 1) > 0.35;
}

function isNoReplyAddress(value = "") {
  return /\b(no-?reply|notification|mailer-daemon|calendar-notification|donotreply)\b/i.test(String(value || ""));
}

export function isUsefulWritingSample(text = "", meta = {}) {
  const cleaned = cleanEmailBody(text);
  const wordCount = words(cleaned).length;
  const subject = String(meta.subject || "");
  const from = String(meta.from || "");
  const to = String(meta.to || "");
  if (wordCount < 25 || wordCount > 1200) return false;
  if (mostlyUrls(cleaned)) return false;
  if (isNoReplyAddress(from) || isNoReplyAddress(to)) return false;
  if (/^(accepted|declined|tentatively accepted|updated invitation|canceled):/i.test(subject)) return false;
  if (/\.(ics|vcf)\b/i.test(subject)) return false;
  if (AUTO_PATTERNS.filter((re) => re.test(cleaned) || re.test(subject)).length >= 2) return false;
  if (/^thanks[!.]?$/i.test(cleaned.trim())) return false;
  if (/^sent from my/i.test(cleaned.trim())) return false;
  return true;
}

export function classifySample(meta = {}, body = "", threadContext = null) {
  const subject = String(meta.subject || "");
  const text = `${subject}\n${body}`.toLowerCase();
  if (/^re:/i.test(subject) || threadContext) return "reply";
  if (/\b(available|availability|calendar|schedule|next week|this week|monday|tuesday|wednesday|thursday|friday|meet|call|zoom|google meet|time works)\b/i.test(text)) {
    return "scheduling";
  }
  if (/\b(following up|wanted to follow up|checking in|bumping|float this)\b/i.test(text)) return "follow_up";
  if (/\b(thank you|thanks again|really appreciate|appreciate you)\b/i.test(text)) return "thank_you";
  if (/\b(introduce myself|reaching out|came across|saw your|quick question)\b/i.test(text)) return "cold_intro";
  return "general";
}

export function wordCount(text = "") {
  return words(text).length;
}
