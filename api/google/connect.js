/* Start Gmail/Calendar OAuth for a signed-in Supabase user.
   Production should set GOOGLE_REDIRECT_URI to the stable app origin, e.g.
   https://knock-nu.vercel.app/api/google/callback. Preview deployments need
   that preview callback added to Google Cloud or use the production callback
   and test Google connect on the production domain. */
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

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function safeReturnTo(value) {
  return value && value.startsWith("/app") ? value : "/app/index.html#settings";
}

function returnWithParam(returnTo, key, value) {
  const url = new URL(safeReturnTo(returnTo), "https://knock.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function wantsJson(req) {
  return /\bapplication\/json\b/i.test(req.headers.accept || "");
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: "GOOGLE_CLIENT_ID is not configured" });

  const url = new URL(req.url, requestOrigin(req));
  const userId = url.searchParams.get("user_id");
  const userEmail = url.searchParams.get("user_email") || "";
  const returnTo = safeReturnTo(url.searchParams.get("return_to"));

  if (!validUuid(userId)) {
    const payload = {
      ok: false,
      error: "real_user_required",
      message: "Sign in to Knock before connecting Google.",
    };
    if (wantsJson(req)) return res.status(400).json(payload);
    return redirect(res, returnWithParam(returnTo, "google_error", "real_user_required"));
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
