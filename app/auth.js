/* Knock auth gate.
   With app/config.js (Supabase URL + anon key) present → real auth:
   Google OAuth, LinkedIn OIDC, or email magic link via Supabase.
   Without it → dev mode: the demo continues on localStorage, clearly labeled. */

(function () {
  const cfg = window.KNOCK_CONFIG;
  const hasSupabase = cfg && cfg.supabaseUrl && !cfg.supabaseUrl.includes("YOUR-PROJECT") && window.supabase;

  function clearLocalSession() {
    localStorage.removeItem("knock_doors");
    localStorage.removeItem("knock_doors_meta");
    localStorage.removeItem("knock_campaigns");
    localStorage.removeItem("knock_onboarded");
    localStorage.removeItem("knock_ob_draft");
    Object.keys(localStorage)
      .filter((key) => key.startsWith("knock_auto_sourced_"))
      .forEach((key) => localStorage.removeItem(key));
  }

  function returnToLanding() {
    location.href = "../index.html?logout=1";
  }

  window.knockAuth = {
    mode: "dev",
    user: null,
    client: null,
    signOut: () => {
      clearLocalSession();
      returnToLanding();
    },
  };

  if (!hasSupabase) {
    /* dev fallback: keep the demo usable without credentials */
    window.knockAuth.user = { email: "dev@knock.local", name: "Dev mode" };
    document.documentElement.classList.add("auth-dev");
    return;
  }

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  window.knockAuth.mode = "supabase";
  window.knockAuth.client = client;
  window.knockAuth.signOut = async () => {
    await client.auth.signOut();
    window.knockAuth.user = null;
    clearLocalSession();
    returnToLanding();
  };

  function gate() {
    if (document.getElementById("authgate")) return;
    const el = document.createElement("div");
    el.id = "authgate";
    el.innerHTML = `
      <div class="authgate__card">
        <div class="authgate__logo">knock<i>.</i></div>
        <h2>Open some doors.</h2>
        <p>Sign in to build your profile and start knocking.</p>
        <button class="authbtn" data-provider="google">
          <svg class="authbtn__logo" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.3 2.99-7.52z"/>
            <path fill="#34A853" d="M12 22c2.7 0 4.96-.89 6.61-2.25l-3.22-2.51c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.08v2.59A9.99 9.99 0 0 0 12 22z"/>
            <path fill="#FBBC05" d="M6.41 14.07A6.01 6.01 0 0 1 6.1 12c0-.72.11-1.42.31-2.07V7.34H3.08A9.99 9.99 0 0 0 2 12c0 1.61.39 3.13 1.08 4.66l3.33-2.59z"/>
            <path fill="#EA4335" d="M12 5.81c1.47 0 2.79.5 3.82 1.5l2.86-2.86C16.95 2.83 14.69 2 12 2a9.99 9.99 0 0 0-8.92 5.34l3.33 2.59C7.2 7.57 9.4 5.81 12 5.81z"/>
          </svg>
          Continue with Google
        </button>
        <button class="authbtn" data-provider="linkedin_oidc">
          <svg class="authbtn__logo" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V8.98h3.42v1.57h.05a3.75 3.75 0 0 1 3.37-1.85c3.61 0 4.27 2.38 4.27 5.47v6.28zM5.32 7.41a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.1 20.45H3.53V8.98H7.1v11.47z"/>
          </svg>
          Continue with LinkedIn
        </button>
        <div class="authgate__or"><span>or</span></div>
        <form id="auth-email">
          <input type="email" placeholder="you@school.edu" required />
          <button class="authbtn authbtn--accent" type="submit">Email me a magic link</button>
        </form>
        <p class="authgate__note" id="auth-note"></p>
        <p class="authgate__fine">By continuing you agree to Knock's <a href="../terms.html">Terms</a> and <a href="../privacy.html">Privacy Policy</a>.</p>
      </div>`;
    document.body.appendChild(el);

    el.querySelectorAll("[data-provider]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const { error } = await client.auth.signInWithOAuth({
          provider: btn.dataset.provider,
          options: { redirectTo: location.href.split("#")[0] },
        });
        if (error) document.getElementById("auth-note").textContent = error.message;
      })
    );
    el.querySelector("#auth-email").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = e.target.querySelector("input").value;
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.href.split("#")[0] },
      });
      document.getElementById("auth-note").textContent = error
        ? error.message
        : `Magic link sent to ${email}. Check your inbox.`;
    });
  }

  client.auth.getSession().then(({ data: { session } }) => {
    if (session) {
      window.knockAuth.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata?.full_name || session.user.email,
        avatar: session.user.user_metadata?.avatar_url,
      };
      document.dispatchEvent(new CustomEvent("knock:auth", { detail: window.knockAuth.user }));
    } else {
      gate();
    }
  });

  client.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN") document.getElementById("authgate")?.remove();
  });
})();
