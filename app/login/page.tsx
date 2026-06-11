"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const hasCallbackError = searchParams.get("error") === "auth_callback_failed";

  async function signInWithGoogle() {
    setLoading(true);
    setMessage(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes:
          "openid email profile https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      setLoading(false);
      setMessage(error.message);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <Link className="brand" href="/">
          knock<span>.</span>
        </Link>
        <h1 id="login-title">Open some doors.</h1>
        <p>Sign in with Google to build your profile, find people, and send outreach from Knock.</p>

        {hasCallbackError ? (
          <div className="notice" role="alert">
            Google sign-in could not be completed. Try again.
          </div>
        ) : null}

        {message ? (
          <div className="notice" role="alert">
            {message}
          </div>
        ) : null}

        <button className="btn btn--accent btn--wide" disabled={loading} onClick={signInWithGoogle}>
          <svg className="btn__logo" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.3 2.99-7.52z" />
            <path fill="#34A853" d="M12 22c2.7 0 4.96-.89 6.61-2.25l-3.22-2.51c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.08v2.59A9.99 9.99 0 0 0 12 22z" />
            <path fill="#FBBC05" d="M6.41 14.07A6.01 6.01 0 0 1 6.1 12c0-.72.11-1.42.31-2.07V7.34H3.08A9.99 9.99 0 0 0 2 12c0 1.61.39 3.13 1.08 4.66l3.33-2.59z" />
            <path fill="#EA4335" d="M12 5.81c1.47 0 2.79.5 3.82 1.5l2.86-2.86C16.95 2.83 14.69 2 12 2a9.99 9.99 0 0 0-8.92 5.34l3.33 2.59C7.2 7.57 9.4 5.81 12 5.81z" />
          </svg>
          {loading ? "Opening Google..." : "Continue with Google"}
        </button>

        <p className="fine-print">
          Knock asks Google for your basic profile plus Gmail send and Calendar event access so it can
          send approved outreach and coordinate follow-up.
        </p>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="auth-page">
          <section className="auth-card">
            <Link className="brand" href="/">
              knock<span>.</span>
            </Link>
            <p>Loading sign in...</p>
          </section>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
