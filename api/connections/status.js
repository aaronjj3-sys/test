/* GET /api/connections/status?user_id=...
   POST /api/connections/status { userId }
   Source of truth for what's actually connected: reads oauth_connections in
   Supabase (service role, server-side only) and reports per-provider status.
   The client syncs its local state from this on boot so the UI always
   reflects reality, on every device. */

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });

  const url = new URL(req.url, "http://localhost");
  const userId = req.method === "POST"
    ? (req.body?.userId || req.body?.user_id || "")
    : (url.searchParams.get("user_id") || url.searchParams.get("userId") || "");

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DB_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!validUuid(userId) || !supabaseUrl || !serviceRoleKey) {
    /* dev mode or no real session: nothing connected server-side */
    return res.status(200).json({ ok: true, connections: {}, google: false, persisted: false });
  }

  try {
    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/oauth_connections` +
      `?user_id=eq.${userId}&status=eq.connected&select=provider,provider_email,updated_at`;
    const response = await fetch(endpoint, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
    if (!response.ok) {
      console.error("Supabase status error:", response.status);
      return res.status(200).json({ ok: false, connections: {}, persisted: false });
    }
    const rows = await response.json();
    const connections = {};
    for (const row of rows) {
      connections[row.provider] = { connected: true, email: row.provider_email || "", updatedAt: row.updated_at };
    }
    return res.status(200).json({ ok: true, connections, google: Boolean(connections.google), persisted: true });
  } catch (err) {
    console.error("Connections status failed:", err.message);
    return res.status(200).json({ ok: false, connections: {}, google: false, persisted: false });
  }
}
