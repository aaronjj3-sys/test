# Knock — cold outreach that lands jobs

**Knock** is a cold-outreach opportunity agent for high schoolers, college students,
and job seekers: it sources real people (YC founders, alumni, hiring managers, PE/VC
contacts), drafts the first line in *your* voice, and follows up until doors open.

Two parts:

1. **Landing page** (`index.html`) — 3D scroll-driven marketing site
2. **App MVP** (`app/`) — the Jobright/Tsenta-style dashboard behind the CTA

## The app MVP (`app/`)

Zero-build SPA (vanilla JS, hash routing). Flows that work today:

- **Onboarding questionnaire** — resume dropzone + "what are you actually like?"
  personality chips ("Allergic to average", "Will do whatever it takes") that calibrate
  the agent's writing voice
- **Dashboard** — Tsenta-style pastel top-match cards with match rings, stat row
  (sent / open rate / replies / meetings), all-outreach table, "Knock on all 5"
- **Find people** — directory sourced from YC / alumni / live hiring signals / PE-VC,
  filterable by source and ask (jobs · coffee chats · case-comp sponsors), each card
  shows a live "signal" and a match ring
- **The agent drawer (the wow)** — click *Knock* and Scout visibly researches the
  person, finds the hook, drafts a personalized email typewriter-style in your voice,
  shows the follow-up plan, and waits for *Approve & send*
- **Simulated life** — after sending: an "opened" toast at ~9s, then a reply at ~19s
  that lands as a 🔥 warm thread in the Inbox and advances the Tracker
- **Inbox** — warm-threads-first, Scout can draft replies
- **Tracker** — drag-and-drop kanban: Drafted → Sent → Opened → Replied → Meeting
- **Profile** — everything the agent knows about you, inline-editable story, traits,
  voice settings
- **Settings** — agent autonomy toggles, Gmail/Calendar integrations, plan & knocks

## Landing page

Product-forward hero in the Ramp / Granola / Rex design language — warm paper & ink,
Fraunces serif, signal-orange accent:

- **Hero**: the real app dashboard embedded in a browser frame that starts tilted in
  3D and flattens as you scroll (Ramp-style), with parallax floating UI chips
  ("🔥 Maya replied", a 96% match ring)
- A Three.js **paper plane** glides across the hero on a scroll-scrubbed flight path
  with a dashed trail, then the scene fades out
- GSAP + Lenis scroll timings: split-word headlines, animated counters
  (2% vs 71%), staggered bento grid of real app screenshots, sticky how-it-works,
  infinite marquee
- Respects `prefers-reduced-motion`

## Run it

No build step. Libraries are vendored (`vendor/`).

```bash
python3 -m http.server 8000
# landing:  http://localhost:8000
# app:      http://localhost:8000/app/
```

## Files

- `index.html` / `styles.css` / `main.js` — landing page
- `app/` — the dashboard MVP (`index.html`, `app.css`, `app.js`, `data.js`)
- `assets/` — app UI screenshots used by the landing page
- `vendor/` — three.js, GSAP, ScrollTrigger, Lenis
