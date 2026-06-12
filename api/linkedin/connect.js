/* GET /api/linkedin/connect?user_id=...&return_to=...
   Starts the LinkedIn OAuth flow (OpenID Connect: identity only — LinkedIn
   does not expose messaging APIs to standard apps). Set LINKEDIN_CLIENT_ID
   and LINKEDIN_CLIENT_SECRET (see SETUP.md) and this whole flow works. */

const SCOPES = ["openid", "profile", "email"].join(" ");

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8000";
  return `${proto}://${host}`;
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "LINKEDIN_CLIENT_ID is not configured" });

  const url = new URL(req.url, requestOrigin(req));
  const userId = url.searchParams.get("user_id");
  const returnTo = url.searchParams.get("return_to") || "/app/index.html#settings";

  if (!userId || userId === "dev") {
    return res.status(400).json({ error: "Connect LinkedIn requires a real Supabase user session" });
  }

  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${requestOrigin(req)}/api/linkedin/callback`;
  const state = Buffer.from(JSON.stringify({ userId, returnTo }), "utf8").toString("base64url");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  });

  redirect(res, `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`);
}
