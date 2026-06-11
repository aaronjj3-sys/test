# Knock — what YOU need to do to take this MVP fully live

The code is ready for every integration below. Each one is blocked only on
credentials/accounts that only you can create. Work top to bottom.

## 0. Run it locally (works right now, no keys needed)

```bash
node server.js
# landing: http://localhost:8000
# app:     http://localhost:8000/app/
npm test   # sourcing/scoring unit checks
```

Without keys the app runs in **mock mode**: sourcing returns demo doors
(clearly labeled), auth runs in dev mode. Every flow is testable.

## 1. Apollo (live people sourcing) — 5 minutes

You already have this working locally.

1. Copy `.env.example` → `.env.local`.
2. Put your key in `APOLLO_API_KEY=...`
   - People Search requires a **master API key** (Apollo → Settings → API).
3. Restart `node server.js`. Settings → Apollo status should read
   "Server configured — live sourcing on".

Cost control is built in: search is credit-free; enrichment (verified emails)
only runs on approved leads, max 10 per action.

## 2. Supabase (real accounts + database) — ~30 minutes

1. Create a project at https://supabase.com (free tier is fine).
2. SQL Editor → paste and run `supabase/migrations/001_init.sql`
   (creates profiles/doors/campaigns/messages/oauth tables with RLS).
3. Project Settings → API: copy the **URL** and **anon public key**.
4. Copy `app/config.example.js` → `app/config.js` and fill both in
   (these two are safe for the browser; RLS protects the data).
5. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`
   (server-side only — never put the service role key in app/config.js).

The app automatically switches from dev mode to a real login gate once
`app/config.js` exists.

## 3. Google login — ~20 minutes

1. https://console.cloud.google.com → create project "Knock".
2. APIs & Services → OAuth consent screen → External → fill app name/support email.
3. Credentials → Create OAuth client ID → Web application.
   - Authorized redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
4. Supabase Dashboard → Authentication → Providers → Google → paste
   Client ID + Secret → enable.

Scopes stay at openid/email/profile — login only. **No Gmail scopes here.**

## 4. LinkedIn login — ~20 minutes

1. https://developer.linkedin.com → Create app (needs a LinkedIn company page).
2. Products → request **"Sign In with LinkedIn using OpenID Connect"**.
3. Auth tab → add redirect URL: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
4. Supabase → Authentication → Providers → **LinkedIn (OIDC)** → paste
   Client ID + Secret → enable.

Identity only — Knock never scrapes or messages LinkedIn.

## 5. Email magic links — 0 minutes (then 30 for production)

Works out of the box on Supabase's built-in mailer (rate-limited, fine for
testing). For production, plug a custom SMTP (Resend/Postmark) into
Supabase → Authentication → Email so links come from your domain.

## 6. Gmail sending + reply watching — the next build step

This is the one integration that needs real build time after credentials:

1. Same Google Cloud project → enable **Gmail API**.
2. Create a second OAuth client (or extend the first) with scopes
   `gmail.send` + `gmail.readonly` — this is the separate "Connect Gmail"
   flow, not login.
3. Add `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` to `.env.local`.
4. For reply detection: enable Cloud Pub/Sub, create a topic, grant
   `gmail-api-push@system.gserviceaccount.com` publish rights.
5. Heads-up: sending scopes are "restricted" — Google requires app
   verification (a few days, free) before non-test users can connect.

Until then campaigns queue honestly and the UI says so. The architecture
(drip caps 10–25/day for new users, working-hours spacing, pause + do-not-
contact states) is documented in `lib/gmail/`.

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
3. LinkedIn login
4. Gmail connect + drip sending + reply classification (next coding session)
5. Stripe billing
6. Deploy to Vercel
