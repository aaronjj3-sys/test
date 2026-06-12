# Knock — what YOU need to do to take this MVP fully live

The code is ready for every integration below. Each one is blocked only on
credentials/accounts that only you can create. Work top to bottom.

## 0. Run it locally (works right now, no keys needed)

```bash
npm run dev        # serves the static site AND all /api routes on :8000
# landing: http://localhost:8000
# app:     http://localhost:8000/app/
npm test           # sourcing/scoring unit checks
```

Without keys the app runs in **mock mode**: sourcing returns demo doors
(clearly labeled), auth runs in dev mode. Every flow is testable.

## 1. Apollo (live people sourcing) — 5 minutes

You already have this working locally.

1. Copy `.env.example` → `.env.local`.
2. Put your key in `APOLLO_API_KEY=...`
   - People Search requires a **master API key** (Apollo → Settings → API).
3. Restart `npm run dev`. Settings → Apollo status should read
   "Server configured · live sourcing on".

Cost control is built in: search is credit-free; enrichment (verified emails)
only runs on approved leads, max 10 per action.

## 2. Supabase (real accounts + database) — ~30 minutes

1. Create a project at https://supabase.com (free tier is fine).
2. SQL Editor → paste and run `supabase/migrations/001_init.sql`
   (creates profiles/doors/campaigns/messages/oauth tables with RLS).
3. Project Settings -> API: copy the **URL** and **anon public key**.
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to
   `.env.local` and Vercel env vars. These two are safe for the browser; RLS
   protects the data.
5. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`
   (server-side only; never expose the service role key to the browser).

The app automatically switches from dev mode to a real login gate once those
Supabase env vars are present and the dev server has restarted.

## 3. Google login — ~20 minutes

1. https://console.cloud.google.com → create project "Knock".
2. APIs & Services → OAuth consent screen → External → fill app name/support email.
3. Credentials → Create OAuth client ID → Web application.
   - Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
4. Supabase Dashboard → Authentication → Providers → Google → paste
   Client ID + Secret → enable.

Scopes stay at openid/email/profile — login only. **No Gmail scopes here.**

## 4. LinkedIn connection — ~15 minutes

The app's Connections card has a working LinkedIn connect flow (identity via
OpenID Connect; stored in oauth_connections like Google). To turn it on:

1. https://developer.linkedin.com → Create app (needs a LinkedIn company page).
2. Products tab → request **"Sign In with LinkedIn using OpenID Connect"**.
3. Auth tab → add redirect URL:
   - local: `http://localhost:8000/api/linkedin/callback`
   - prod:  `https://YOUR-DOMAIN/api/linkedin/callback`
4. Copy Client ID + Client Secret into `.env.local` (and Vercel env):
   `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`.

That's it; the Connect button in Settings starts working. Note: LinkedIn does
not offer a public messaging API, so this connects identity (name, email,
member id) for personalization; DMs would go through their Partner program.

## 4b. Claude-powered parsing (optional) — 2 minutes

Set `ANTHROPIC_API_KEY` in `.env.local` / Vercel and two things upgrade
automatically (both have deterministic fallbacks without it):
- Resume parsing: school/degree/experience/skills extracted by
  `claude-haiku-4-5-20251001` with typo correction, instead of regex heuristics.
- Writing-style learning: your writing samples are analyzed into a style
  profile that shapes every draft.

## 5. Email magic links — 0 minutes (then 30 for production)

Works out of the box on Supabase's built-in mailer (rate-limited, fine for
testing). For production, plug a custom SMTP (Resend/Postmark) into
Supabase → Authentication → Email so links come from your domain.

## 6. Gmail sending + reply watching — built, needs credentials

The integration is implemented (`lib/gmail/`, `api/gmail/send.js`,
`api/gmail/sync.js`, `api/cron/monitor.js`). To turn it on:

1. Same Google Cloud project → enable **Gmail API** + **Calendar API**.
2. The "Connect Google" flow (`api/google/connect.js`) already requests
   `gmail.send`, `gmail.readonly`, `gmail.compose`, `calendar.events`,
   `calendar.readonly` — separate from login.
3. Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to `.env.local`, and run
   `supabase/migrations/003_sending.sql` in the SQL editor.
4. Set `CRON_SECRET` in Vercel env. Reply detection + follow-ups run via
   polling: the app syncs live whenever it's open (`/api/gmail/sync`), and
   the Vercel cron (`/api/cron/monitor`, see vercel.json) covers off-hours —
   note Hobby plan crons run once daily.
5. Heads-up: sending scopes are "restricted" — Google requires app
   verification (a few days, free) before non-test users can connect.

Guardrails: monthly knock limits (15 free / 200 pro), review-before-sending
on by default (suggested replies/follow-ups land as Gmail drafts), follow-ups
3 days apart, max 2, weekends optional.

## 7. Stripe billing — ~45 minutes when ready

1. https://dashboard.stripe.com → create account → add product "Knock Pro"
   at $19/mo (and a Campus custom product later).
2. Copy `STRIPE_SECRET_KEY` + create a webhook (checkout.session.completed,
   customer.subscription.updated/deleted) → `STRIPE_WEBHOOK_SECRET` into `.env.local`.
3. Tell me when the keys exist — I wire Checkout + customer portal + a
   `subscriptions` table and gate unlimited knocks on it. (~1 session of work.)

## 8. Deploy — ~15 minutes

The repo is Vercel-ready (static frontend + `api/` functions):

1. https://vercel.com → Import the GitHub repo.
2. Add the env vars from `.env.local` in Project Settings.
3. Add your production URL to Supabase → Authentication → URL configuration.

## One note on the logo marquee

The marquee now uses real brand SVGs (Stripe, OpenAI, Google, Apple, Meta,
NVIDIA, Goldman Sachs, Y Combinator, Airbnb, Anthropic, Palantir, Figma,
Uber + McKinsey/Sequoia/Deloitte wordmarks). "Knock users opened doors at X"
is a factual claim about trademarked names — fine once you genuinely have
users who landed replies/roles there; until then consider the label
"Knock users are knocking on doors at" to stay safe.

## Build order recommendation

1. ✅ today: Apollo key in `.env.local` → live sourcing works
2. Supabase project + Google login → real accounts
3. ✅ Gmail connect + sending + reply classification (built — add credentials)
5. Stripe billing
6. Deploy to Vercel
