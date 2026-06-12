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

function buildRawMessage({ from, to, toName, subject, body, inReplyTo, references }) {
  const lines = [
    `From: ${from}`,
    `To: ${formatAddress(to, toName)}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  const mime = `${lines.join("\r\n")}\r\n\r\n${body || ""}`;
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

export async function sendEmail({ userId, to, toName, subject, body, threadId, inReplyTo, references }) {
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
      inReplyTo,
      references,
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

function extractBody(payload) {
  let html = null;
  const stack = [payload];
  while (stack.length) {
    const part = stack.shift();
    if (!part) continue;
    if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body.data).trim();
    if (part.mimeType === "text/html" && part.body?.data && html === null) html = decodeBody(part.body.data);
    if (Array.isArray(part.parts)) stack.push(...part.parts);
  }
  if (html) return stripHtml(html);
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
      messageIdHeader: headerValue(m.payload, "Message-ID") || headerValue(m.payload, "Message-Id"),
      isFromMe: Boolean(myEmail) && from.toLowerCase().includes(myEmail),
    };
  });

  messages.sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0));
  return messages;
}
