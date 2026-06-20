/* Server-side Supabase REST helpers (service role key). Thin fetch wrappers —
   no SDK dependency. NEVER import this from browser code; the service role key
   bypasses RLS. All helpers return parsed JSON rows or null on failure
   (status code is logged, never bodies/keys).

   Filters: plain values become `eq.` matches; values that already start with a
   PostgREST operator (e.g. "in.(sent,replied)", "lte.2026-01-01", "not.is.null")
   pass through untouched. */

const OPERATOR = /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|not|cs|cd|ov|fts|plfts|or)\./;

function config() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DB_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function supabaseConfigured() {
  return Boolean(config());
}

function filterParams(params, filter = {}) {
  for (const [column, value] of Object.entries(filter)) {
    const v = String(value);
    params.append(column, OPERATOR.test(v) ? v : `eq.${v}`);
  }
}

async function request(method, path, { prefer, body } = {}) {
  const cfg = config();
  if (!cfg) return null;
  try {
    const headers = {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`Supabase ${method} ${path.split("?")[0]} failed:`, response.status);
      return null;
    }
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  } catch (err) {
    console.error(`Supabase ${method} ${path.split("?")[0]} error:`, err.message);
    return null;
  }
}

export async function sbSelect(table, { filter, select = "*", limit } = {}) {
  const params = new URLSearchParams();
  params.set("select", select);
  filterParams(params, filter);
  if (limit) params.set("limit", String(limit));
  return request("GET", `${table}?${params.toString()}`);
}

export async function sbInsert(table, rows) {
  return request("POST", table, {
    prefer: "return=representation",
    body: Array.isArray(rows) ? rows : [rows],
  });
}

export async function sbUpdate(table, filter, patch) {
  const params = new URLSearchParams();
  filterParams(params, filter);
  return request("PATCH", `${table}?${params.toString()}`, {
    prefer: "return=representation",
    body: patch,
  });
}

export async function sbDelete(table, filter) {
  const params = new URLSearchParams();
  filterParams(params, filter);
  return request("DELETE", `${table}?${params.toString()}`);
}

export async function sbUpsert(table, rows, onConflict) {
  const params = new URLSearchParams();
  if (onConflict) params.set("on_conflict", onConflict);
  const qs = params.toString();
  return request("POST", qs ? `${table}?${qs}` : table, {
    prefer: "resolution=merge-duplicates,return=representation",
    body: Array.isArray(rows) ? rows : [rows],
  });
}
