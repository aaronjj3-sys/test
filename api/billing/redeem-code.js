/* POST /api/billing/redeem-code
   Minimal license-code unlock for testing. Production codes should be supplied
   via PRO_ACCESS_CODES as a comma-separated list. Codes containing UNLIMITED
   unlock the unlimited test plan; other accepted codes unlock pro. */

import { sbUpdate, supabaseConfigured } from "../../lib/supabase/admin.js";

const DEFAULT_TEST_CODES = ["KNOCK-PRO-TEST", "AARON-PRO", "SCOUT-PRO", "KNOCK-UNLIMITED-TEST"];

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
}

function acceptedCodes() {
  const envCodes = String(process.env.PRO_ACCESS_CODES || "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return new Set([...(envCodes.length ? envCodes : DEFAULT_TEST_CODES)]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const userId = String(req.body?.userId || "");
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return res.status(400).json({ ok: false, error: "Code is required" });
  if (!acceptedCodes().has(code)) return res.status(403).json({ ok: false, error: "Invalid or expired code" });

  const plan = /UNLIMITED/.test(code) ? "unlimited" : "pro";
  if (validUuid(userId) && supabaseConfigured()) {
    const updated = await sbUpdate("profiles", { user_id: userId }, {
      plan,
      updated_at: new Date().toISOString(),
    });
    if (!updated) return res.status(502).json({ ok: false, error: "Could not update the account plan" });
  }

  return res.status(200).json({ ok: true, plan });
}
