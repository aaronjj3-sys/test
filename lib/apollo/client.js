/* Server-side Apollo.io client. The API key never leaves this module. */

const BASE = "https://api.apollo.io";
const TIMEOUT_MS = 20000;
const MAX_RETRIES = 3;

class ApolloError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = "ApolloError";
    this.status = status;
    this.body = body;
  }
}

function keyOrThrow() {
  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    throw new ApolloError(500, "APOLLO_API_KEY is not configured on the server");
  }
  return key;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Low-level request helper: timeout, 429/5xx retry with backoff, structured errors.
 * Never logs or returns the API key.
 */
async function request(method, path, { body, query } = {}) {
  const key = keyOrThrow();
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(`${k}[]`, item));
      else url.searchParams.set(k, String(v));
    }
  }

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          accept: "application/json",
          "x-api-key": key,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      clearTimeout(timer);

      if (res.ok) return await res.json();

      const text = await res.text().catch(() => "");
      if (res.status === 401) throw new ApolloError(401, "Apollo rejected the API key (401). Check APOLLO_API_KEY.", text);
      if (res.status === 403) throw new ApolloError(403, "Apollo key lacks permission (403). People Search requires a master API key.", text);
      if (res.status === 422) throw new ApolloError(422, "Apollo rejected the request filters (422).", text);
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ApolloError(res.status, `Apollo ${res.status === 429 ? "rate limit" : "server error"} (${res.status}).`, text);
        await sleep(2 ** attempt * 1000); // 1s, 2s, 4s
        continue;
      }
      throw new ApolloError(res.status, `Apollo request failed (${res.status}).`, text);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        lastErr = new ApolloError(504, "Apollo request timed out.");
        continue;
      }
      if (err instanceof ApolloError && err.status !== 429 && err.status < 500) throw err;
      lastErr = err;
      await sleep(2 ** attempt * 1000);
    }
  }
  throw lastErr;
}

/* ---- endpoint wrappers (only these endpoints — Knock owns its own CRM layer) ---- */

/** Credit-free people discovery. No emails/phones in results. */
export const peopleSearch = (filters) =>
  request("POST", "/api/v1/mixed_people/api_search", { body: filters });

/**
 * Bulk enrichment — CONSUMES APOLLO CREDITS. Max 10 people per call.
 * Personal emails / phone reveal stay off by default.
 */
export const bulkPeopleEnrich = (details, opts = {}) =>
  request("POST", "/api/v1/people/bulk_match", {
    body: {
      details,
      reveal_personal_emails: opts.revealPersonalEmails ?? false,
      reveal_phone_number: opts.revealPhoneNumber ?? false,
    },
  });

/** One-off enrichment — CONSUMES APOLLO CREDITS. Prefer bulkPeopleEnrich. */
export const peopleEnrich = (params) =>
  request("POST", "/api/v1/people/match", { body: params });

/** Find Apollo organization IDs from names/domains. */
export const organizationSearch = (filters) =>
  request("POST", "/api/v1/mixed_companies/search", { body: filters });

/** Hiring signal for one org. */
export const organizationJobPostings = (organizationId, query = {}) =>
  request("GET", `/api/v1/organizations/${organizationId}/job_postings`, { query });

/** API usage/rate-limit stats. Apollo does not always expose credit balance here. */
export const apiUsageStats = () =>
  request("POST", "/api/v1/usage_stats/api_usage_stats", { body: {} });

export { ApolloError };
export const apolloConfigured = () => Boolean(process.env.APOLLO_API_KEY);
