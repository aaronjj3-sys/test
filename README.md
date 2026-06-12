# Knock, cold outreach that lands jobs

**Knock** is a cold-outreach opportunity agent for high schoolers, college students,
and job seekers: it sources real people (YC founders, alumni, hiring managers, PE/VC
contacts), drafts the first line in *your* voice, and follows up until doors open.

Two parts:

1. **Landing page** (`index.html`), 3D scroll-driven marketing site
2. **App MVP** (`app/`), the Jobright/Tsenta-style dashboard behind the CTA

## The app MVP (`app/`)

Zero-build SPA (vanilla JS, hash routing). Flows that work today:

- **Onboarding questionnaire**, resume dropzone + "what are you actually like?"
  personality chips ("Allergic to average", "Will do whatever it takes") that calibrate
  the agent's writing voice
- **Dashboard**, Tsenta-style pastel top-match cards with match rings, stat row
  (sent / open rate / replies / meetings), all-outreach table, "Knock on all 5"
- **Find people**, a clean table sourced from YC / alumni / live hiring signals / PE-VC
  with real company logos (favicon service + lettermark fallback), live signals, and
  match rings
- **The agent drawer (the wow)**, click *Knock* and Scout visibly researches the
  person, finds the hook, drafts a personalized email typewriter-style in your voice,
  shows the follow-up plan, and waits for *Approve & send*
- **Simulated life**, after sending: an "opened" toast at ~9s, then a reply at ~19s
  that lands as a warm thread in the Inbox and advances the Tracker
- **Inbox**, warm-threads-first with a Connections hub (Gmail, Google Calendar,
  Outlook, LinkedIn), Scout can draft replies
- **Tracker**, Jobright-style funnel tabs with counts, a segmented pipeline bar, and
  stage-specific actions (nudge, follow up, open thread, prep brief)
- **Profile**, everything the agent knows about you, inline-editable story, traits,
  voice settings
- **Settings**, agent autonomy toggles, Gmail/Calendar integrations, plan & knocks

## Landing page

Bubbly cartoon-modern design (Revnu-inspired): steel-blue #5e91bd primary, Figtree
type, thick ink borders with offset "pop" shadows, hover pop-outs everywhere.

- Floating pill nav that condenses as you scroll
- Big blue hero card with solid focal chips (agent / jobs / coffee chats / sponsors),
  the real app dashboard popping out of it, parallax floating UI chips, and a
  paper-plane doodle riding a dashed path on scroll
- Knocky the mascot skates across the stats strip on scroll and kickflips on click
- Numbered sections: stats face-off, a pinned 3D product tour that page-turns through
  live app screenshots as you scroll, sticky how-it-works, centered testimonials,
  pricing, merged Careers + Contact section
- Blue footer with working link columns (Privacy and Terms are real pages) and a
  giant stacked KNOCK wordmark that ripples letter-by-letter on hover
- Respects prefers-reduced-motion

## Run it

No build step. Libraries are vendored (`vendor/`).

```bash
npm run dev        # serves the site AND the /api routes (Apollo sourcing etc.)
# landing:  http://localhost:8000
# app:      http://localhost:8000/app/
npm test           # sourcing/scoring checks
```

Copy `.env.example` → `.env.local` and add `APOLLO_API_KEY` for live sourcing;
without it the app runs in clearly-labeled mock mode. See `docs/SETUP.md` for the
full go-live checklist (Supabase auth, Google/LinkedIn login, Gmail, Stripe).

## The live MVP layer

- **Dashboard state machine**: ghost ("No doors found yet") → sourcing
  (agent step list) → doors queue (checkboxes, match reasons, draft previews,
  Approve & Launch) → campaign queued (honest "Gmail not connected" banner)
- **Apollo sourcing** (`lib/apollo/`): server-side client (timeout, 429
  backoff, no key leakage), People Search (credit-free) → normalize → score
  0–100 with reasons → deterministic draft previews; enrichment is opt-in and
  capped at 10
- **API routes** (`api/`): `sourcing/apollo`, `sourcing/mock`,
  `dashboard/doors`, `campaigns/create` — Vercel-compatible handlers, served
  locally by `server.js`
- **Auth** (`app/auth.js`): the landing page gates every CTA behind a login
  overlay (Google OAuth or email magic link via Supabase when browser env vars
  exist; a labeled dev login otherwise). The app redirects signed-out
  visitors back to the landing page
- **Onboarding**: resume drag-and-drop → about you → target paths → people +
  locations → voice + personality. The saved profile powers sourcing, which
  runs automatically and paginates 100 doors, 25 per page
- **Supabase schema**: `supabase/migrations/001_init.sql` (profiles, doors,
  campaigns, messages, oauth connections — all with RLS)

## Files

- `index.html` / `styles.css` / `main.js`, landing page (+ `privacy.html`, `terms.html`)
- `app/`, the dashboard SPA (`index.html`, `app.css`, `app.js`, `auth.js`)
- `api/` + `lib/` + `server.js`, the backend (Apollo sourcing, campaigns, mock mode)
- `supabase/migrations/`, database schema with RLS
- `assets/`, app UI screenshots + `assets/logos/` brand SVGs for the marquee
- `vendor/`, GSAP, ScrollTrigger, Lenis, supabase-js
- `docs/SETUP.md`, the go-live checklist (what only you can do)
