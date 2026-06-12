/* GET /api/linkedin/callback — completes the LinkedIn OIDC flow and stores
   the connection in Supabase oauth_connections (provider: "linkedin"). */

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8000";
  return `${proto}://${host}`;
}

function safeReturnTo(value) {
  return value && value.startsWith("/app") ? value : "/app/index.html#settings";
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function returnWithParam(returnTo, key, value) {
  const url = new URL(safeReturnTo(returnTo), "https://knock.local");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

function readState(value) {
  if (!value) return {};
  try { return JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { return {}; }
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const url = new URL(req.url, requestOrigin(req));
  const state = readState(url.searchParams.get("state"));
  const returnTo = safeReturnTo(state.returnTo);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error) return redirect(res, returnWithParam(returnTo, "linkedin_error", error));
  if (!code) { res.statusCode = 400; return res.end("Missing LinkedIn authorization code"); }
  if (!validUuid(state.userId)) {
    return redirect(res, returnWithParam(returnTo, "linkedin_error", "missing_supabase_user"));
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${requestOrigin(req)}/api/linkedin/callback`;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DB_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !supabaseUrl || !serviceRoleKey) {
    return redirect(res, returnWithParam(returnTo, "linkedin_error", "server_not_configured"));
  }

  try {
    const tokenResponse = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("LinkedIn token error:", tokens.error || tokenResponse.status);
      return redirect(res, returnWithParam(returnTo, "linkedin_error", "token_exchange_failed"));
    }

    const userInfoResponse = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const linkedinUser = await userInfoResponse.json();
    if (!userInfoResponse.ok || !linkedinUser.sub) {
      console.error("LinkedIn userinfo error:", userInfoResponse.status);
      return redirect(res, returnWithParam(returnTo, "linkedin_error", "userinfo_failed"));
    }

    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 0) * 1000).toISOString();
    const payload = {
      user_id: state.userId,
      provider: "linkedin",
      provider_email: linkedinUser.email || "",
      provider_user_id: linkedinUser.sub,
      scopes: ["openid", "profile", "email"],
      status: "connected",
      access_token_encrypted: tokens.access_token,
      refresh_token_encrypted: tokens.refresh_token || "",
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/oauth_connections?on_conflict=user_id,provider`;
    const saveResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!saveResponse.ok) {
      console.error("Supabase LinkedIn save error:", saveResponse.status, await saveResponse.text());
      return redirect(res, returnWithParam(returnTo, "linkedin_error", "supabase_save_failed"));
    }

    return redirect(res, returnWithParam(returnTo, "linkedin", "connected"));
  } catch (err) {
    console.error("LinkedIn connection failed:", err.message);
    return redirect(res, returnWithParam(returnTo, "linkedin_error", "connection_failed"));
  }
}
