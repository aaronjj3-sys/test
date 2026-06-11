/* Knock auth gate.
   With app/config.js (Supabase URL + anon key) present → real auth:
   Google OAuth, LinkedIn OIDC, or email magic link via Supabase.
   Without it → dev mode: the demo continues on localStorage, clearly labeled. */

(function () {
  const cfg = window.KNOCK_CONFIG;
  const hasSupabase = cfg && cfg.supabaseUrl && !cfg.supabaseUrl.includes("YOUR-PROJECT") && window.supabase;

  window.knockAuth = { mode: "dev", user: null, client: null, signOut: () => {} };

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
    location.reload();
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
        <button class="authbtn" data-provider="google">Continue with Google</button>
        <button class="authbtn" data-provider="linkedin_oidc">Continue with LinkedIn</button>
        <div class="authgate__or"><span>or</span></div>
        <form id="auth-email">
          <input type="email" placeholder="you@school.edu" required />
          <button class="authbtn authbtn--accent" type="submit">Email me a magic link</button>
        </form>
        <p class="authgate__note" id="auth-note"></p>
        <p class="authgate__fine">By continuing you agree to Knock's <a href="../terms.html">Terms</a> and <a href="../privacy.html">Privacy Policy</a>.<br>
        LinkedIn sign-in verifies your identity only — Knock never scrapes or messages your LinkedIn.</p>
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
