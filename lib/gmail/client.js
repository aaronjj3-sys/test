/* Gmail integration — real implementation over the user's own OAuth tokens
   stored in oauth_connections (see api/google/connect.js + callback.js).
   Mail is sent from the user's real address via the Gmail REST API; threads
   are read with gmail.readonly for reply detection. Tokens never leave the
   server and are never logged. */

import { sbSelect, sbUpdate } from "../supabase/admin.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/* ---- connection + token lifecycle ---- */

export async function getGoogleConnection(userId) {
  if (!userId) return null;
  const rows = await sbSelect("oauth_connections", {
    filter: { user_id: userId, provider: "google", status: "connected" },
    limit: 1,
  });
  return rows?.[0] || null;
}

export async function getAccessToken(connection) {
  if (!connection) throw new Error("google_not_connected");

  const expiresAt = connection.expires_at ? Date.parse(connection.expires_at) : 0;
  const freshFor = expiresAt - Date.now();
  if (connection.access_token_encrypted && freshFor > 2 * 60 * 1000) {
    return connection.access_token_encrypted;
  }

  if (!gmailConfigured()) throw new Error("Google OAuth is not configured on the server");
  if (!connection.refresh_token_encrypted) {
    throw new Error("Google connection is missing a refresh token — reconnect Google in Settings");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: connection.refresh_token_encrypted,
      grant_type: "refresh_token",
    }),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.access_token) {
    console.error("Google token refresh failed:", tokens.error || response.status);
    throw new Error("Could not refresh Google access — reconnect Google in Settings");
  }

  const newExpiresAt = new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString();
  await sbUpdate(
    "oauth_connections",
    { id: connection.id },
    {
      access_token_encrypted: tokens.access_token,
      expires_at: newExpiresAt,
      updated_at: new Date().toISOString(),
    }
  );
  connection.access_token_encrypted = tokens.access_token;
  connection.expires_at = newExpiresAt;
  return tokens.access_token;
}

/* ---- RFC 2822 message building ---- */

function encodeHeaderWord(value) {
  const v = String(value || "");
  if (/^[\x20-\x7e]*$/.test(v)) return v; // pure ASCII, no encoding needed
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`; // RFC 2047
}

function formatAddress(email, name) {
  if (!name) return email;
  const encoded = encodeHeaderWord(name);
  const display = encoded === name ? `"${name.replace(/["\\]/g, "")}"` : encoded;
  return `${display} <${email}>`;
}

function boundary(label) {
  return `knock_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function wrapBase64(value) {
  return String(value || "").replace(/\s+/g, "").replace(/.{1,76}/g, "$&\r\n").trim();
}

function cleanFileName(name) {
  return String(name || "attachment").replace(/[\r\n"]/g, "").slice(0, 180) || "attachment";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function htmlBodyFromText(text, trackOpenUrl) {
  const body = escapeHtml(text).replace(/\n/g, "<br>");
  const pixel = trackOpenUrl
    ? `<img src="${escapeHtml(trackOpenUrl)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0;opacity:0">`
    : "";
  return `<html><body><div>${body}</div>${pixel}</body></html>`;
}

function sanitizeHtmlBody(html) {
  const allowed = new Set(["b", "strong", "i", "em", "u", "a", "ul", "ol", "li", "br", "p", "div"]);
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\s+on\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (all, slash, tag, attrs) => {
      const t = tag.toLowerCase();
      if (!allowed.has(t)) return "";
      if (slash) return `</${t}>`;
      if (t !== "a") return `<${t}>`;
      const href = String(attrs || "").match(/\shref=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const url = href && (href[1] || href[2] || href[3] || "");
      return /^(https?:|mailto:)/i.test(url) ? `<a href="${escapeHtml(url)}">` : "<a>";
    })
    .trim();
}

function htmlBody(body, html, trackOpenUrl) {
  const safe = sanitizeHtmlBody(html);
  const content = safe || escapeHtml(body).replace(/\n/g, "<br>");
  const pixel = trackOpenUrl
    ? `<img src="${escapeHtml(trackOpenUrl)}" width="1" height="1" alt="" style="display:none;width:1px;height:1px;border:0;opacity:0">`
    : "";
  return `<html><body><div>${content}</div>${pixel}</body></html>`;
}

function normalizeAttachments(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((a) => {
      const content = String(a?.contentBase64 || a?.dataBase64 || "").replace(/^data:[^,]+,/i, "").replace(/\s+/g, "");
      if (!content) return null;
      return {
        fileName: cleanFileName(a.fileName || a.name),
        mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType || a.type || a.mime || "") ? (a.mimeType || a.type || a.mime) : "application/octet-stream",
        contentBase64: content,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function buildAlternativePart({ body, bodyHtml, trackOpenUrl, boundaryId }) {
  return [
    `--${boundaryId}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body || "",
    `--${boundaryId}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    htmlBody(body || "", bodyHtml || "", trackOpenUrl),
    `--${boundaryId}--`,
  ].join("\r\n");
}

function buildRawMessage({ from, to, toName, subject, body, bodyHtml, inReplyTo, references, attachments, trackOpenUrl }) {
  const files = normalizeAttachments(attachments);
  const headers = [
    `From: ${from}`,
    `To: ${formatAddress(to, toName)}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    "MIME-Version: 1.0",
  ];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  let mime;
  if (!files.length && !trackOpenUrl && !bodyHtml) {
    mime = `${[
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit",
    ].join("\r\n")}\r\n\r\n${body || ""}`;
  } else if (!files.length) {
    const alt = boundary("alt");
    mime = `${[
      ...headers,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
    ].join("\r\n")}\r\n\r\n${buildAlternativePart({ body, bodyHtml, trackOpenUrl, boundaryId: alt })}`;
  } else {
    const mixed = boundary("mixed");
    const alt = boundary("alt");
    const parts = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      buildAlternativePart({ body, bodyHtml, trackOpenUrl, boundaryId: alt }),
      ...files.flatMap((file) => [
        `--${mixed}`,
        `Content-Type: ${file.mimeType}; name="${file.fileName}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${file.fileName}"`,
        "",
        wrapBase64(file.contentBase64),
      ]),
      `--${mixed}--`,
    ];
    mime = parts.join("\r\n");
  }
  return Buffer.from(mime, "utf8").toString("base64url");
}

async function gmailFetch(token, path, options = {}) {
  const response = await fetch(`${GMAIL_API}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Gmail API ${path.split("?")[0]} failed:`, response.status);
    const reason = data?.error?.message || `Gmail API error (${response.status})`;
    throw new Error(reason);
  }
  return data;
}

/* ---- sending ---- */

export async function sendEmail({ userId, to, toName, subject, body, bodyHtml, threadId, inReplyTo, references, attachments, trackOpenUrl }) {
  if (!to) throw new Error("Recipient email is required");
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_not_connected");
  const token = await getAccessToken(connection);

  const payload = {
    raw: buildRawMessage({
      from: connection.provider_email,
      to,
      toName,
      subject,
      body,
      bodyHtml,
      inReplyTo,
      references,
      attachments,
      trackOpenUrl,
    }),
  };
  if (threadId) payload.threadId = threadId;

  const data = await gmailFetch(token, "messages/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return { gmailMessageId: data.id, threadId: data.threadId };
}

export async function createDraft({ userId, to, toName, subject, body, threadId, inReplyTo, references }) {
  if (!to) throw new Error("Recipient email is required");
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_not_connected");
  const token = await getAccessToken(connection);

  const message = {
    raw: buildRawMessage({
      from: connection.provider_email,
      to,
      toName,
      subject,
      body,
      inReplyTo,
      references,
    }),
  };
  if (threadId) message.threadId = threadId;

  const data = await gmailFetch(token, "drafts", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return data.id;
}

/* ---- attachment loading (user_files rows → MIME parts) ---- */

const MAX_SEND_ATTACHMENTS = 6; // resume + 5 extras
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Resolve [{ fileId }] (or raw id strings) against user_files, owner-checked. */
export async function loadAttachments(userId, refs = []) {
  const ids = [...new Set(
    refs.map((r) => (typeof r === "string" ? r : r?.fileId)).filter(Boolean)
  )].slice(0, MAX_SEND_ATTACHMENTS);
  if (!ids.length) return [];
  const rows = await sbSelect("user_files", {
    filter: { user_id: userId, id: `in.(${ids.join(",")})` },
  });
  let total = 0;
  const attachments = [];
  for (const row of rows || []) {
    total += row.size_bytes || 0;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) break;
    attachments.push({ name: row.name, mime: row.mime, dataBase64: row.data_base64 });
  }
  return attachments;
}

/* ---- thread reading ---- */

function headerValue(payload, name) {
  const lower = name.toLowerCase();
  return payload?.headers?.find((h) => h.name?.toLowerCase() === lower)?.value || "";
}

function decodeBody(data) {
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<div[^>]+class=["'][^"']*(?:gmail_quote|yahoo_quoted)[^"']*["'][\s\S]*$/i, "")
    .replace(/<div[^>]+(?:gmail_quote|yahoo_quoted|moz-cite-prefix)[\s\S]*$/i, "")
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripQuotedText(text) {
  const lines = String(text || "").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const hasContent = out.some((l) => l.trim());
    if (hasContent && /^On\s.+(?:wrote:|<[^>]+>)/i.test(trimmed)) break;
    if (hasContent && /^wrote:$/i.test(trimmed)) break;
    if (/^On .+ wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break;
    if (/^(From|Sent|To|Cc|Subject|Date):\s/i.test(trimmed) && out.some((l) => l.trim())) break;
    if (/^>/.test(trimmed)) {
      if (out.some((l) => l.trim())) break;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractAttachments(payload, messageId) {
  const out = [];
  const walk = (part) => {
    if (!part) return;
    const filename = part.filename || "";
    const attachmentId = part.body?.attachmentId || null;
    const disposition = headerValue(part, "Content-Disposition");
    const contentId = headerValue(part, "Content-ID");
    if (filename || attachmentId) {
      out.push({
        filename,
        fileName: filename || "inline attachment",
        mimeType: part.mimeType || "application/octet-stream",
        size: part.body?.size || 0,
        attachmentId,
        messageId,
        inline: /inline/i.test(disposition) || Boolean(contentId),
      });
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };
  walk(payload);
  return out;
}

function extractBody(payload) {
  let html = null;
  const stack = [payload];
  while (stack.length) {
    const part = stack.shift();
    if (!part) continue;
    if (part.mimeType === "text/plain" && part.body?.data) return stripQuotedText(decodeBody(part.body.data));
    if (part.mimeType === "text/html" && part.body?.data && html === null) html = decodeBody(part.body.data);
    if (Array.isArray(part.parts)) stack.push(...part.parts);
  }
  if (html) return stripQuotedText(stripHtml(html));
  return "";
}

export async function getThread(userId, threadId) {
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_not_connected");
  const token = await getAccessToken(connection);

  const data = await gmailFetch(token, `threads/${encodeURIComponent(threadId)}?format=full`);
  const myEmail = (connection.provider_email || "").toLowerCase();

  const messages = (data.messages || []).map((m) => {
    const from = headerValue(m.payload, "From");
    const internal = Number(m.internalDate || 0);
    return {
      id: m.id,
      from,
      to: headerValue(m.payload, "To"),
      date: internal
        ? new Date(internal).toISOString()
        : headerValue(m.payload, "Date") || null,
      subject: headerValue(m.payload, "Subject"),
      body: extractBody(m.payload),
      attachments: extractAttachments(m.payload, m.id),
      messageIdHeader: headerValue(m.payload, "Message-ID") || headerValue(m.payload, "Message-Id"),
      isFromMe: Boolean(myEmail) && from.toLowerCase().includes(myEmail),
    };
  });

  messages.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return messages;
}

export async function getSentMessagesForStyle(userId, { query = "in:sent newer_than:2y -category:promotions", maxResults = 25 } = {}) {
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_not_connected");
  const token = await getAccessToken(connection);
  const limit = Math.min(Math.max(Number(maxResults) || 25, 1), 25);
  const list = await gmailFetch(
    token,
    `messages?q=${encodeURIComponent(query)}&maxResults=${limit}`
  );
  const ids = (list.messages || []).map((m) => m.id).filter(Boolean).slice(0, limit);
  const messages = [];
  for (const id of ids) {
    try {
      const m = await gmailFetch(token, `messages/${encodeURIComponent(id)}?format=full`);
      const internal = Number(m.internalDate || 0);
      messages.push({
        id: m.id,
        date: internal ? new Date(internal).toISOString() : headerValue(m.payload, "Date") || null,
        from: headerValue(m.payload, "From"),
        to: headerValue(m.payload, "To"),
        subject: headerValue(m.payload, "Subject"),
        body: extractBody(m.payload),
      });
    } catch (err) {
      console.warn("Gmail sent sample skipped:", err?.message || err);
    }
  }
  return {
    providerEmail: connection.provider_email || "",
    messages,
  };
}

export async function getAttachment(userId, messageId, attachmentId) {
  if (!messageId || !attachmentId) throw new Error("messageId and attachmentId are required");
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_not_connected");
  const token = await getAccessToken(connection);
  const data = await gmailFetch(
    token,
    `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  );
  const raw = String(data.data || "");
  const contentBase64 = raw.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(raw.length / 4) * 4, "=");
  return { contentBase64, size: Number(data.size || 0) };
}

/** Gmail thread search (e.g. "to:a@b.com OR from:a@b.com"). Returns
    [{ id, snippet }] newest first, for importing existing conversations. */
export async function searchThreads(userId, query, maxResults = 5) {
  const connection = await getGoogleConnection(userId);
  if (!connection) throw new Error("google_not_connected");
  const token = await getAccessToken(connection);
  const data = await gmailFetch(
    token,
    `threads?q=${encodeURIComponent(query)}&maxResults=${Math.min(Math.max(maxResults, 1), 10)}`
  );
  return data.threads || [];
}
