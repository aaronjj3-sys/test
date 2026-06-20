/* Knock auth.
   Loaded by BOTH the landing page and the app shell.

   With Supabase browser env vars present, real auth runs:
   Google OAuth or an email magic link via Supabase.
   Without it, a clearly-labeled dev login is offered so the product can
   be tested end to end with no credentials.

   Exposes:
     window.knockAuth = { mode, user, client, ready, signOut, openLogin } */

(function () {
  const cfg = window.KNOCK_CONFIG;
  const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
  const allowDevMode = isLocal || localStorage.getItem("knock_allow_dev_mode") === "1";
  const hasSupabase = Boolean(
    cfg?.supabaseUrl &&
    cfg?.supabaseAnonKey &&
    !cfg.supabaseUrl.includes("YOUR-PROJECT") &&
    window.supabase
  );
  const inApp = /^\/app(?:\/|$)/.test(location.pathname);
  const appUrl = `${location.origin}/app/`;
  const landingUrl = `${location.origin}/`;

  const auth = (window.knockAuth = {
    mode: hasSupabase ? "supabase" : allowDevMode ? "dev" : "misconfigured",
    user: null,
    client: null,
    ready: null,
    signOut: async () => {},
    openLogin,
  });

  if (hasSupabase) {
    auth.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  }

  auth.signOut = async () => {
    localStorage.removeItem("knock_dev_session");
    localStorage.removeItem("knock_active_user_id");
    if (auth.client) await auth.client.auth.signOut();
    location.href = landingUrl;
  };

  function devUser() {
    const email = localStorage.getItem("knock_dev_session");
    return email ? { id: "dev", email, name: "Dev", initials: "DV" } : null;
  }

  function fromSession(session) {
    const u = session.user;
    const name = u.user_metadata?.full_name || u.email;
    return {
      id: u.id,
      email: u.email,
      name,
      avatar: u.user_metadata?.avatar_url,
      initials: name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(""),
    };
  }

  auth.ready = (async () => {
    if (auth.client) {
      const { data: { session } } = await auth.client.auth.getSession();
      if (session) auth.user = fromSession(session);
    }
    if (!auth.user && auth.mode === "dev") auth.user = devUser();
    return auth.user;
  })();

  /* ---------- login overlay (shared by landing + app) ---------- */
  function openLogin() {
    if (document.getElementById("authgate")) return;
    const el = document.createElement("div");
    el.id = "authgate";
    el.innerHTML = `
      <div class="authgate__card">
        <button class="authgate__x" aria-label="Close">&times;</button>
        <div class="authgate__logo">knock<i>.</i></div>
        <h2>Open some doors.</h2>
        <p>Sign in to build your profile and start knocking.</p>
        ${hasSupabase ? `
        <button class="authbtn" data-provider="google">
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.3-2.1 3.7-5.2 3.7-8.9z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-6-2.2-7-5.2l-3.9 3C3.1 21.2 7.2 24 12 24z"/><path fill="#FBBC05" d="M5 14.2a7.3 7.3 0 0 1 0-4.5L1.1 6.7a12 12 0 0 0 0 10.7L5 14.2z"/><path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l2.7-2.7C16.7 1.7 14.2.6 12 .6 7.2.6 3.1 3.4 1.1 7.3l3.9 3c1-3 3.8-5.6 7-5.6z"/></svg>
          Continue with Google
        </button>
        <div class="authgate__or"><span>or</span></div>
        <form id="auth-email">
          <input type="email" placeholder="you@school.edu" required />
          <button class="authbtn authbtn--accent" type="submit">Email me a magic link</button>
        </form>` : auth.mode === "dev" ? `
        <button class="authbtn authbtn--accent" id="auth-dev">Continue with dev login</button>
        <p class="authgate__note">Supabase is not configured, so Google sign-in and magic links are off. Set the Supabase env vars and restart the dev server to turn them on.</p>` : `
        <p class="authgate__note">Supabase browser config is missing on this deployment. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.</p>`}
        <p class="authgate__note" id="auth-note"></p>
        <p class="authgate__fine">By continuing you agree to Knock's <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.</p>
      </div>`;
    document.body.appendChild(el);

    el.querySelector(".authgate__x").addEventListener("click", () => el.remove());
    el.addEventListener("click", (e) => { if (e.target === el) el.remove(); });

    el.querySelectorAll("[data-provider]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const { error } = await auth.client.auth.signInWithOAuth({
          provider: btn.dataset.provider,
          options: { redirectTo: appUrl },
        });
        if (error) document.getElementById("auth-note").textContent = error.message;
      })
    );
    el.querySelector("#auth-email")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = e.target.querySelector("input").value;
      const { error } = await auth.client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: appUrl },
      });
      document.getElementById("auth-note").textContent = error
        ? error.message
        : `Magic link sent to ${email}. Check your inbox.`;
    });
    el.querySelector("#auth-dev")?.addEventListener("click", () => {
      localStorage.setItem("knock_dev_session", "dev@knock.local");
      location.href = appUrl;
    });
  }

  if (auth.client) {
    auth.client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) {
        auth.user = fromSession(session);
        document.getElementById("authgate")?.remove();
        if (!inApp) location.href = appUrl;
      }
    });
  }
})();
