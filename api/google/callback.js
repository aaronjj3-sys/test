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
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

async function upsertConnection({ supabaseUrl, serviceRoleKey, payload }) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/oauth_connections?on_conflict=user_id,provider`;
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates,return=minimal",
  };

  let response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (response.ok) return response;

  const firstError = await response.text();
  if (!/expires_at/i.test(firstError)) {
    response.errorText = firstError;
    return response;
  }

  const fallbackPayload = { ...payload };
  delete fallbackPayload.expires_at;

  response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(fallbackPayload),
  });
  if (!response.ok) response.errorText = await response.text();
  return response;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const url = new URL(req.url, requestOrigin(req));
  const state = readState(url.searchParams.get("state"));
  const returnTo = safeReturnTo(state.returnTo);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");

  if (error) {
    return redirect(res, returnWithParam(returnTo, "google_error", error));
  }

  if (!code) {
    res.statusCode = 400;
    return res.end("Missing Google authorization code");
  }

  if (!validUuid(state.userId)) {
    return redirect(res, returnWithParam(returnTo, "google_error", "missing_supabase_user"));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${requestOrigin(req)}/api/google/callback`;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.DB_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !supabaseUrl || !serviceRoleKey) {
    return redirect(res, returnWithParam(returnTo, "google_error", "server_not_configured"));
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error("Google token error:", tokens.error || tokenResponse.status);
      return redirect(res, returnWithParam(returnTo, "google_error", "token_exchange_failed"));
    }

    if (!tokens.refresh_token) {
      return redirect(res, returnWithParam(returnTo, "google_error", "missing_refresh_token"));
    }

    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = await userInfoResponse.json();

    if (!userInfoResponse.ok || !googleUser.email) {
      console.error("Google userinfo error:", googleUser.error || userInfoResponse.status);
      return redirect(res, returnWithParam(returnTo, "google_error", "userinfo_failed"));
    }

    const expiresAt = new Date(Date.now() + Number(tokens.expires_in || 0) * 1000).toISOString();
    const payload = {
      user_id: state.userId,
      provider: "google",
      provider_email: googleUser.email,
      provider_user_id: googleUser.id || "",
      scopes: tokens.scope ? tokens.scope.split(" ") : [],
      status: "connected",
      access_token_encrypted: tokens.access_token,
      refresh_token_encrypted: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    const saveResponse = await upsertConnection({ supabaseUrl, serviceRoleKey, payload });
    if (!saveResponse.ok) {
      console.error("Supabase Google save error:", saveResponse.errorText || saveResponse.status);
      return redirect(res, returnWithParam(returnTo, "google_error", "supabase_save_failed"));
    }

    return redirect(res, returnWithParam(returnTo, "google", "connected"));
  } catch (err) {
    console.error("Google connection failed:", err.message);
    return redirect(res, returnWithParam(returnTo, "google_error", "connection_failed"));
  }
}
