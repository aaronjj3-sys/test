/* POST /api/connections/disconnect — { user_id, provider }
   Marks the provider disconnected in Supabase and clears stored tokens, so
   Disconnect in the UI is real, not just a local toggle. */

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

const PROVIDERS = new Set(["google", "outlook"]);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { user_id: userId, provider } = req.body || {};

  if (!PROVIDERS.has(provider)) return res.status(400).json({ error: "Unknown provider" });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DB_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!validUuid(userId) || !supabaseUrl || !serviceRoleKey) {
    /* dev mode: nothing stored server-side, the client clears local state */
    return res.status(200).json({ ok: true, persisted: false });
  }

  try {
    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/oauth_connections` +
      `?user_id=eq.${userId}&provider=eq.${provider}`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        status: "disconnected",
        access_token_encrypted: "",
        refresh_token_encrypted: "",
        updated_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      console.error("Supabase disconnect error:", response.status);
      return res.status(502).json({ error: "Could not update the connection" });
    }
    return res.status(200).json({ ok: true, persisted: true });
  } catch (err) {
    console.error("Disconnect failed:", err.message);
    return res.status(502).json({ error: "Could not update the connection" });
  }
}
