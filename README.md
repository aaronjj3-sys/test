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

Design direction: warm "paper & ink" world (cream paper, ink black, signal-orange accent,
Fraunces serif display type) — a fusion of Granola's warm minimalism and Tsenta's bold
outbound-sales energy.

## The 3D & scroll system

- **Three.js** renders a fixed full-screen scene behind the page: a hand-built low-poly
  paper plane, a field of drifting paper sheets, and a few floating ink "doors" with
  orange knobs.
- The plane flies along a Catmull-Rom **flight path scrubbed by page scroll**
  (with a ~1.4s scrub lag for a gliding feel), leaving a dashed orange trail behind it.
  It ends its flight right at the camera on the final CTA.
- **GSAP ScrollTrigger + Lenis** drive the scroll timings: split-word headline reveals,
  staggered card entrances, animated stat counters, a **pinned "How it works" section**
  that scrubs through three steps (with a progress bar and a live typewriter writing a
  cold email), an infinite marquee, and mouse-tilt feature cards.
- Mouse parallax on the camera; film-grain overlay for the paper texture.
- Fully respects `prefers-reduced-motion` (static scene, instant text, no pinning).

## Run it

No build step. Everything loads from CDNs (Three.js via import map, GSAP, Lenis, Google Fonts).

```bash
# any static server works; ES modules require http(s), not file://
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

- `index.html` — structure & copy
- `styles.css` — design system & layout
- `main.js` — Three.js scene + GSAP/Lenis scroll choreography
