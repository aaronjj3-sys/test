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
- **Find people**, directory sourced from YC / alumni / live hiring signals / PE-VC,
  filterable by source and ask (jobs · coffee chats · case-comp sponsors), each card
  shows a live "signal" and a match ring
- **The agent drawer (the wow)**, click *Knock* and Scout visibly researches the
  person, finds the hook, drafts a personalized email typewriter-style in your voice,
  shows the follow-up plan, and waits for *Approve & send*
- **Simulated life**, after sending: an "opened" toast at ~9s, then a reply at ~19s
  that lands as a 🔥 warm thread in the Inbox and advances the Tracker
- **Inbox**, warm-threads-first, Scout can draft replies
- **Tracker**, drag-and-drop kanban: Drafted → Sent → Opened → Replied → Meeting
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
- Numbered /01-/06 sections: stats face-off, bento grid of live app screenshots,
  sticky how-it-works, testimonials, pricing, merged Careers + Contact section
- Blue footer with working link columns (Privacy and Terms are real pages) and a
  giant stacked KNOCK wordmark that ripples letter-by-letter on hover
- Respects prefers-reduced-motion

## Run it

No build step. Libraries are vendored (`vendor/`).

```bash
python3 -m http.server 8000
# landing:  http://localhost:8000
# app:      http://localhost:8000/app/
```

## Files

- `index.html` / `styles.css` / `main.js`, landing page (+ `privacy.html`, `terms.html`)
- `app/`, the dashboard MVP (`index.html`, `app.css`, `app.js`, `data.js`)
- `assets/`, app UI screenshots used by the landing page
- `vendor/`, GSAP, ScrollTrigger, Lenis
