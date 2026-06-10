# Knock — cold outreach that lands jobs

A single-page B2B SaaS marketing site for **Knock**, a cold-outreach platform that helps
high schoolers, college students, and job seekers email their way to opportunities —
finding real people (recruiters, alumni, hiring managers), drafting the first line,
and timing every follow-up.

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
