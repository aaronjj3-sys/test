/* POST /api/files — attachment storage for outgoing knocks (resume + extras).
   Actions (all POST, JSON body):
     { userId, action: "list" }                                → { ok, files: [{id, kind, name, mime, sizeBytes, createdAt}] }
     { userId, action: "upload", kind, name, mime, dataBase64 } → { ok, file }
     { userId, action: "delete", id }                          → { ok }
   kind: "resume" (one per user, replaced on re-upload) | "attachment" (max 5).
   File bytes never leave the server after upload; list returns metadata only. */

import { supabaseConfigured, sbSelect, sbInsert } from "../lib/supabase/admin.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // Gmail allows 25MB total; keep singles small
const MAX_ATTACHMENTS = 5;

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

const fileMeta = (row) => ({
  id: row.id,
  kind: row.kind,
  name: row.name,
  mime: row.mime,
  sizeBytes: row.size_bytes,
  createdAt: row.created_at,
});

/* admin.js has no delete helper; mirror its request style for this one call */
async function sbDelete(table, filter) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DB_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const params = new URLSearchParams();
  for (const [column, value] of Object.entries(filter)) params.append(column, `eq.${value}`);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${table}?${params}`, {
      method: "DELETE",
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) console.error(`Supabase DELETE ${table} failed:`, response.status);
    return response.ok;
  } catch (err) {
    console.error(`Supabase DELETE ${table} error:`, err.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { userId, action } = req.body || {};
  if (!validUuid(userId)) return res.status(400).json({ ok: false, error: "A real Supabase userId is required" });
  if (!supabaseConfigured()) return res.status(503).json({ ok: false, error: "supabase_not_configured" });

  if (action === "list") {
    const rows = await sbSelect("user_files", {
      filter: { user_id: userId },
      select: "id,kind,name,mime,size_bytes,created_at",
    });
    return res.status(200).json({ ok: true, files: (rows || []).map(fileMeta) });
  }

  if (action === "upload") {
    const { kind = "attachment", name = "", mime = "", dataBase64 } = req.body || {};
    if (!["resume", "attachment"].includes(kind)) return res.status(400).json({ ok: false, error: "kind must be resume or attachment" });
    if (!name.trim()) return res.status(400).json({ ok: false, error: "name is required" });
    if (!dataBase64) return res.status(400).json({ ok: false, error: "dataBase64 is required" });
    let size;
    try {
      size = Buffer.from(dataBase64, "base64").length;
    } catch {
      return res.status(400).json({ ok: false, error: "dataBase64 is not valid base64" });
    }
    if (size === 0) return res.status(400).json({ ok: false, error: "File is empty" });
    if (size > MAX_FILE_BYTES) return res.status(413).json({ ok: false, error: "File too large (5MB max per attachment)" });

    if (kind === "resume") {
      /* one resume on file: replace the previous one */
      await sbDelete("user_files", { user_id: userId, kind: "resume" });
    } else {
      const existing = await sbSelect("user_files", {
        filter: { user_id: userId, kind: "attachment" },
        select: "id",
      });
      if ((existing || []).length >= MAX_ATTACHMENTS) {
        return res.status(409).json({ ok: false, error: `You can keep up to ${MAX_ATTACHMENTS} attachments. Remove one first.` });
      }
    }

    const inserted = await sbInsert("user_files", [{
      user_id: userId,
      kind,
      name: name.trim().slice(0, 200),
      mime: mime || "application/octet-stream",
      size_bytes: size,
      data_base64: dataBase64,
    }]);
    if (!inserted?.[0]) return res.status(502).json({ ok: false, error: "Could not save the file. Is migration 005_attachments.sql applied?" });
    return res.status(200).json({ ok: true, file: fileMeta(inserted[0]) });
  }

  if (action === "delete") {
    const { id } = req.body || {};
    if (!validUuid(id)) return res.status(400).json({ ok: false, error: "A file id is required" });
    const ok = await sbDelete("user_files", { user_id: userId, id });
    return res.status(ok ? 200 : 502).json({ ok });
  }

  return res.status(400).json({ ok: false, error: "action must be list, upload, or delete" });
}
