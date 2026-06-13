import { sbSelect, sbUpsert, supabaseConfigured } from "../supabase/admin.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

function validUserId(userId) {
  return UUID_RE.test(String(userId || ""));
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function normalize(row = {}, now = new Date()) {
  const day = dayKey(now);
  const month = monthKey(now);
  return {
    user_id: row.user_id,
    day_key: day,
    month_key: month,
    api_calls_today: row.day_key === day ? Number(row.api_calls_today || 0) : 0,
    people_searched_month: row.month_key === month ? Number(row.people_searched_month || 0) : 0,
    enrich_credits_month: row.month_key === month ? Number(row.enrich_credits_month || 0) : 0,
  };
}

export function publicApolloUsage(row = {}, { configured = true, daily = null } = {}) {
  const normalized = normalize(row);
  return {
    configured,
    apiCallsToday: normalized.api_calls_today,
    apiDayLimit: daily?.limit ?? null,
    apiDayLeft: daily?.left ?? null,
    apiDayEndpoint: daily?.endpoint || "",
    peopleSearchedMonth: normalized.people_searched_month,
    enrichCreditsMonth: normalized.enrich_credits_month,
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

export async function readApolloUsage(userId) {
  if (!supabaseConfigured() || !validUserId(userId)) return null;
  const rows = await sbSelect("apollo_usage", {
    filter: { user_id: userId },
    limit: 1,
  });
  if (!rows?.[0]) return null;
  return { ...rows[0], ...normalize(rows[0]) };
}

export async function recordApolloUsage(userId, delta = {}) {
  if (!supabaseConfigured() || !validUserId(userId)) return null;
  const now = new Date();
  const existing = await readApolloUsage(userId);
  const base = normalize(existing || { user_id: userId }, now);
  const row = {
    user_id: userId,
    day_key: dayKey(now),
    month_key: monthKey(now),
    api_calls_today: base.api_calls_today + Math.max(0, Number(delta.apiCalls || 0)),
    people_searched_month: base.people_searched_month + Math.max(0, Number(delta.peopleSearched || 0)),
    enrich_credits_month: base.enrich_credits_month + Math.max(0, Number(delta.enrichedPeople || delta.enrichCredits || 0)),
    updated_at: now.toISOString(),
  };
  const saved = await sbUpsert("apollo_usage", [row], "user_id");
  return saved?.[0] ? { ...saved[0], ...normalize(saved[0], now) } : row;
}
