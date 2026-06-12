/* GET /api/apollo/usage
   Shows Apollo API usage/rate-limit stats without exposing the API key.
   Apollo's API usage endpoint reports API usage and limits. Actual credit
   balance may still need the Apollo billing screen depending on plan. */

import { apiUsageStats, apolloConfigured } from "../../lib/apollo/client.js";

function pickDailyWindow(stats) {
  const entries = Object.entries(stats || {}).filter(([, v]) => v?.day);
  if (!entries.length) return null;

  const relevant = entries.filter(([k]) =>
    /mixed_people|api_search|people|bulk_match|match/i.test(k)
  );
  const pool = relevant.length ? relevant : entries;

  let best = null;
  for (const [name, value] of pool) {
    const day = value.day || {};
    if (!Number.isFinite(day.left_over) || !Number.isFinite(day.limit)) continue;
    if (!best || day.left_over < best.left) {
      best = {
        endpoint: name,
        left: day.left_over,
        limit: day.limit,
        consumed: day.consumed || 0,
      };
    }
  }
  return best;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  if (!apolloConfigured()) {
    return res.status(200).json({
      ok: true,
      configured: false,
      usageAvailable: false,
      note: "APOLLO_API_KEY is not configured.",
    });
  }

  try {
    const stats = await apiUsageStats();
    const daily = pickDailyWindow(stats);
    return res.status(200).json({
      ok: true,
      configured: true,
      usageAvailable: Boolean(daily),
      daily,
      note: "Apollo reports API usage and rate limits here. Credit balance can differ from API limit remaining.",
    });
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    return res.status(status).json({
      ok: false,
      configured: true,
      usageAvailable: false,
      error: err.message || "Apollo usage check failed",
    });
  }
}
