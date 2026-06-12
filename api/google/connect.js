const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

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

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "GOOGLE_CLIENT_ID is not configured" });

  const url = new URL(req.url, requestOrigin(req));
  const userId = url.searchParams.get("user_id");
  const userEmail = url.searchParams.get("user_email") || "";
  const returnTo = url.searchParams.get("return_to") || "/app/index.html#settings";

  if (!userId || userId === "dev") {
    return res.status(400).json({ error: "Connect Google requires a real Supabase user session" });
  }

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${requestOrigin(req)}/api/google/callback`;
  const state = Buffer.from(JSON.stringify({ userId, userEmail, returnTo }), "utf8").toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: SCOPES,
    state,
  });

  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
