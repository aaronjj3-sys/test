/* ============================================================
   Knock landing, bubbly blue edition
   GSAP + Lenis. Signature moves:
   · pill nav condenses on scroll
   · paper-plane doodle rides its dashed path through the hero
   · Knocky the mascot skates across on scroll, kickflips on click
   · giant footer wordmark ripples on hover
   · split-word headlines (descender-safe), counters, marquee
   ============================================================ */

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduceMotion) document.documentElement.classList.add("reduced-motion");

gsap.registerPlugin(ScrollTrigger);

/* ---------------- landing auth gate ---------------- */
const APP_URL = "app/index.html#dashboard";
let landingSupabase = null;

function getLandingSupabase() {
  const cfg = window.KNOCK_CONFIG;
  if (!cfg?.supabaseUrl || !cfg?.supabaseAnonKey || !window.supabase) return null;
  if (!landingSupabase) landingSupabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  return landingSupabase;
}

async function openLandingAuth(e) {
  e.preventDefault();
  const client = getLandingSupabase();
  if (!client) {
    window.location.href = APP_URL;
    return;
  }

  const { data: { session } } = await client.auth.getSession();
  if (session) {
    window.location.href = APP_URL;
    return;
  }

  if (document.getElementById("landing-auth")) return;
  const el = document.createElement("div");
  el.id = "landing-auth";
  el.className = "landing-auth";
  el.innerHTML = `
    <div class="landing-auth__card">
      <div class="landing-auth__logo">knock<i>.</i></div>
      <h2>Open some doors.</h2>
      <p>Sign in to build your profile and start knocking.</p>
      <button class="landing-auth__btn" data-provider="google">
        <svg class="landing-auth__logoicon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.78-.07-1.53-.2-2.23H12v4.22h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.22c1.89-1.74 2.99-4.3 2.99-7.52z"/>
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.89 6.61-2.25l-3.22-2.51c-.9.6-2.04.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.08v2.59A9.99 9.99 0 0 0 12 22z"/>
          <path fill="#FBBC05" d="M6.41 14.07A6.01 6.01 0 0 1 6.1 12c0-.72.11-1.42.31-2.07V7.34H3.08A9.99 9.99 0 0 0 2 12c0 1.61.39 3.13 1.08 4.66l3.33-2.59z"/>
          <path fill="#EA4335" d="M12 5.81c1.47 0 2.79.5 3.82 1.5l2.86-2.86C16.95 2.83 14.69 2 12 2a9.99 9.99 0 0 0-8.92 5.34l3.33 2.59C7.2 7.57 9.4 5.81 12 5.81z"/>
        </svg>
        Continue with Google
      </button>
      <button class="landing-auth__btn" data-provider="linkedin_oidc">
        <svg class="landing-auth__logoicon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#0A66C2" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V8.98h3.42v1.57h.05a3.75 3.75 0 0 1 3.37-1.85c3.61 0 4.27 2.38 4.27 5.47v6.28zM5.32 7.41a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.1 20.45H3.53V8.98H7.1v11.47z"/>
        </svg>
        Continue with LinkedIn
      </button>
      <div class="landing-auth__or"><span>or</span></div>
      <form id="landing-auth-email">
        <input type="email" placeholder="you@school.edu" required />
        <button class="landing-auth__btn landing-auth__btn--accent" type="submit">Email me a magic link</button>
      </form>
      <p class="landing-auth__note" id="landing-auth-note"></p>
      <p class="landing-auth__fine">By continuing you agree to Knock's <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy Policy</a>.</p>
    </div>`;
  document.body.append(el);

  el.addEventListener("click", (event) => {
    if (event.target === el) el.remove();
  });
  el.querySelectorAll("[data-provider]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const { error } = await client.auth.signInWithOAuth({
        provider: btn.dataset.provider,
        options: { redirectTo: new URL(APP_URL, window.location.origin).href },
      });
      if (error) document.getElementById("landing-auth-note").textContent = error.message;
    })
  );
  el.querySelector("#landing-auth-email").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = event.target.querySelector("input").value;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: new URL(APP_URL, window.location.origin).href },
    });
    document.getElementById("landing-auth-note").textContent = error
      ? error.message
      : `Magic link sent to ${email}. Check your inbox.`;
  });
}

async function syncLandingSession() {
  const client = getLandingSupabase();
  if (!client) return;

  const url = new URL(window.location.href);
  if (url.searchParams.get("logout") === "1") {
    await client.auth.signOut();
    url.searchParams.delete("logout");
    history.replaceState({}, "", url.pathname + url.search + url.hash);
    return;
  }

  const { data: { session } } = await client.auth.getSession();
  if (session) window.location.href = APP_URL;
}

document.querySelectorAll('a[href="app/index.html"]').forEach((link) => {
  link.addEventListener("click", openLandingAuth);
});
syncLandingSession();

let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ---------------- split headlines into words ---------------- */
document.querySelectorAll("[data-split]").forEach((el) => {
  const split = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) return frag.append(" ");
        const w = document.createElement("span"); w.className = "w";
        const inner = document.createElement("span"); inner.textContent = part;
        w.append(inner); frag.append(w);
      });
      node.replaceWith(frag);
    } else if (node.nodeType === Node.ELEMENT_NODE) [...node.childNodes].forEach(split);
  };
  [...el.childNodes].forEach(split);
});

/* ---------------- footer giant wordmark ---------------- */
const giant = document.getElementById("footer-giant");
for (let r = 0; r < 3; r++) {
  const row = document.createElement("span");
  row.className = "row";
  for (const ch of "KNOCK") {
    const l = document.createElement("span");
    l.className = "ltr";
    l.textContent = ch;
    row.append(l);
  }
  giant.append(row);
}

/* ---------------- contact form ---------------- */
document.getElementById("contact-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const f = e.target;
  const subject = encodeURIComponent(`Knock contact from ${f.name.value}`);
  const body = encodeURIComponent(`${f.msg.value}\n\nreply to: ${f.email.value}`);
  window.location.href = `mailto:hello@knock.app?subject=${subject}&body=${body}`;
  f.innerHTML = '<p class="sent-note">📨 Opening your mail app. Talk soon!</p>';
});

if (!reduceMotion) {
  /* ---------------- nav condenses on scroll ---------------- */
  ScrollTrigger.create({
    start: 90,
    end: "max",
    onToggle: (self) => document.getElementById("nav").classList.toggle("is-condensed", self.isActive),
  });

  /* ---------------- hero entrance ---------------- */
  gsap.set(".hero .reveal", { y: 18 });
  gsap.timeline({ defaults: { ease: "power3.out" } })
    .from("#nav", { y: -30, opacity: 0, duration: 0.7 }, 0.05)
    .from(".hero__card", { y: 50, opacity: 0, duration: 0.9, ease: "power2.out" }, 0.1)
    .to(".hero__title .w > span", { y: 0, duration: 1.0, stagger: 0.06 }, 0.35)
    .to(".hero .reveal", { opacity: 1, y: 0, duration: 0.8, stagger: 0.1 }, 0.7)
    .fromTo(".hero__chips .chip", { scale: 0, rotation: -8 }, { scale: 1, rotation: 0, duration: 0.5, stagger: 0.08, ease: "back.out(2.5)", clearProps: "transform" }, 0.55)
    .from(".frame-wrap", { y: 110, opacity: 0, duration: 1.0, ease: "power3.out" }, 0.85)
    .fromTo(".float-chip", { scale: 0, rotation: 6 }, { scale: 1, rotation: 0, duration: 0.6, stagger: 0.14, ease: "back.out(2.2)", clearProps: "transform" }, 1.35);

  /* paper plane rides the dashed path across the hero, scrubbed */
  const path = document.getElementById("flight-path");
  const planeEl = document.getElementById("flight-plane");
  const pathLen = path.getTotalLength();
  gsap.set(path, { strokeDasharray: "10 12", strokeDashoffset: 0 });
  const flight = { t: 0.04 };
  const placePlane = () => {
    const p = path.getPointAtLength(flight.t * pathLen);
    const p2 = path.getPointAtLength(Math.min(flight.t * pathLen + 2, pathLen));
    const ang = (Math.atan2(p2.y - p.y, p2.x - p.x) * 180) / Math.PI;
    planeEl.setAttribute("transform", `translate(${p.x - 20}, ${p.y - 17}) rotate(${ang} 20 17)`);
  };
  placePlane();
  gsap.to(flight, {
    t: 0.99, ease: "none", onUpdate: placePlane,
    scrollTrigger: { trigger: ".hero", start: "top top", end: "+=120%", scrub: 1.2 },
  });

  /* frame chips parallax */
  gsap.to("#chip-reply", { y: -42, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top bottom", end: "bottom top", scrub: true } });
  gsap.to("#chip-match", { y: 48, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top bottom", end: "bottom top", scrub: true } });
  gsap.to("#chip-sent", { y: -26, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top bottom", end: "bottom top", scrub: true } });

  /* ---------------- split headlines on scroll ---------------- */
  document.querySelectorAll("[data-split]").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.to(el.querySelectorAll(".w > span"), {
      y: 0, duration: 0.85, ease: "power3.out", stagger: 0.05,
      scrollTrigger: { trigger: el, start: "top 84%" },
    });
  });

  /* generic reveals + card groups */
  document.querySelectorAll(".reveal").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.fromTo(el, { opacity: 0, y: 24 }, {
      opacity: 1, y: 0, duration: 0.85, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 86%" },
    });
  });
  document.querySelectorAll(".stats__row, .voices__row, .pricing__grid, .join__grid, .cta").forEach((group) => {
    gsap.fromTo(group.querySelectorAll(".reveal-card"), { opacity: 0, y: 46, rotation: 0.8 }, {
      opacity: 1, y: 0, rotation: 0, duration: 0.85, ease: "back.out(1.4)", stagger: 0.1,
      scrollTrigger: { trigger: group, start: "top 82%" },
    });
  });

  /* counters */
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = +el.dataset.count, obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.5, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 86%" },
      onUpdate: () => (el.textContent = Math.round(obj.v)),
    });
  });

  /* marquee */
  const track = document.querySelector(".marquee__track");
  track.innerHTML += track.innerHTML;
  gsap.to(track, { xPercent: -50, ease: "none", duration: 26, repeat: -1 });

  /* ---------------- showcase: pinned 3D product tour ---------------- */
  const CHIP_TEXT = [
    ["Reply likelihood: High", "Send at 9:41 AM her time"],
    ["96% match · Elena Cruz", "Live signal: hiring first ops hire"],
    ["Maya replied", "Warm thread flagged"],
    ["Day 3 nudge queued", "Meeting booked, Thu 2:00 PM"],
  ];
  const frames = gsap.utils.toArray(".sframe");
  const copies = gsap.utils.toArray(".scopy");
  const sdots = gsap.utils.toArray(".sdot");
  const stageInner = document.getElementById("stage-inner");
  const showcaseMobile = window.matchMedia("(max-width: 980px)").matches;

  if (showcaseMobile) {
    /* mobile: no pin, no 3D swaps — interleave copy + screenshot pairs and stack */
    document.querySelector(".showcase").classList.add("showcase--stacked");
    copies.forEach((c, k) => c.insertAdjacentElement("afterend", frames[k]));
    [...copies, ...frames].forEach((el) => {
      gsap.fromTo(el, { opacity: 0, y: 26 }, {
        opacity: 1, y: 0, duration: 0.8, ease: "power2.out",
        scrollTrigger: { trigger: el, start: "top 88%" },
      });
    });
  } else {
    let phase = 0;
    gsap.set(copies[0], { autoAlpha: 1 });

    const setPhase = (i) => {
      if (i === phase) return;
      const dir = i > phase ? 1 : -1;
      const prev = phase;
      phase = i;
      /* kill in-flight tweens so fast back-and-forth scrubbing can't strand a frame mid-swap */
      gsap.killTweensOf([...frames, ...copies]);
      frames.forEach((f, k) => { if (k !== i && k !== prev) gsap.set(f, { autoAlpha: 0 }); });
      copies.forEach((c, k) => { if (k !== i && k !== prev) gsap.set(c, { autoAlpha: 0, y: 0 }); });
      /* frames swap with a 3D page-turn feel */
      gsap.to(frames[prev], { autoAlpha: 0, rotateY: -28 * dir, x: -50 * dir, duration: 0.4, ease: "power2.in", overwrite: true });
      gsap.fromTo(frames[i], { autoAlpha: 0, rotateY: 32 * dir, x: 70 * dir },
        { autoAlpha: 1, rotateY: 0, x: 0, duration: 0.5, ease: "power3.out", delay: 0.08, overwrite: true });
      /* copy crossfade */
      gsap.to(copies[prev], { autoAlpha: 0, y: -18 * dir, duration: 0.28, ease: "power2.in", overwrite: true });
      gsap.fromTo(copies[i], { autoAlpha: 0, y: 26 * dir }, { autoAlpha: 1, y: 0, duration: 0.45, ease: "power3.out", delay: 0.08, overwrite: true });
      /* floating chips swap text with a pop */
      const [a, b] = CHIP_TEXT[i];
      [["#schip-a", a], ["#schip-b", b]].forEach(([sel, txt], k) => {
        const el = document.querySelector(sel);
        gsap.killTweensOf(el);
        gsap.timeline()
          .to(el, { scale: 0, duration: 0.16, ease: "power2.in", delay: k * 0.05 })
          .add(() => (el.textContent = txt))
          .to(el, { scale: 1, duration: 0.3, ease: "back.out(2.2)" });
      });
      sdots.forEach((d, k) => d.classList.toggle("is-on", k === i));
    };

    ScrollTrigger.create({
      trigger: ".showcase",
      start: "top top",
      end: "+=2400",
      pin: ".showcase__pin",
      scrub: true,
      anticipatePin: 1,
      onUpdate: (self) => setPhase(Math.min(3, Math.floor(self.progress * 4))),
      /* settle between phases so the scrub never parks mid-swap */
      snap: { snapTo: [0.125, 0.375, 0.625, 0.875], duration: 0.4, delay: 0.15, ease: "power2.out" },
    });

    /* mouse parallax tilt on the stage */
    const stage = document.getElementById("stage");
    stage.addEventListener("pointermove", (e) => {
      const r = stage.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(stageInner, { rotateY: px * 9, rotateX: -py * 7, duration: 0.5, ease: "power2.out" });
    });
    stage.addEventListener("pointerleave", () =>
      gsap.to(stageInner, { rotateY: 0, rotateX: 0, duration: 0.8, ease: "elastic.out(1, 0.5)" }));
  }

  /* ---------------- Knocky skates across on scroll ---------------- */
  const strip = document.getElementById("skate-strip");
  const knocky = document.getElementById("knocky");
  gsap.to(knocky, {
    x: () => strip.offsetWidth - 140, ease: "none",
    scrollTrigger: { trigger: strip, start: "top 95%", end: "bottom 15%", scrub: 0.8 },
  });
  /* idle wobble */
  gsap.to("#knocky-body", { y: -4, rotation: 2, transformOrigin: "50% 90%", duration: 0.6, yoyo: true, repeat: -1, ease: "sine.inOut" });
  /* kickflip on click / hover */
  let flipping = false;
  const kickflip = () => {
    if (flipping) return;
    flipping = true;
    gsap.timeline({ onComplete: () => (flipping = false) })
      .to(knocky, { y: -90, duration: 0.32, ease: "power2.out" })
      .to(knocky, { rotation: "+=360", duration: 0.55, ease: "power1.inOut" }, 0.08)
      .to("#knocky-board", { rotation: "+=360", transformOrigin: "50% 50%", duration: 0.4, ease: "power1.inOut" }, 0.12)
      .to(knocky, { y: 0, duration: 0.34, ease: "bounce.out" }, 0.45);
  };
  strip.addEventListener("click", kickflip);
  strip.addEventListener("mouseenter", kickflip);

  /* ---------------- voyager: a paper plane rides the whole page ---------------- */
  if (!showcaseMobile) {
    const voyager = document.createElement("div");
    voyager.id = "voyager";
    voyager.setAttribute("aria-hidden", "true");
    voyager.innerHTML = `<svg viewBox="0 0 40 34"><path d="M2 4 L36 12 L10 20 L14 30 Z" fill="#fff" stroke="#1b2a38" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(voyager);
    gsap.set(voyager, { xPercent: -50, yPercent: -50, left: "4vw", top: "70vh", autoAlpha: 0 });

    /* waypoints in viewport coords; the timeline is scrubbed across the full page scroll */
    const LEGS = [
      { left: "8vw",  top: "72vh", rotation: -8,  autoAlpha: 0 },   // hold while the hero plane flies
      { left: "12vw", top: "66vh", rotation: -12, autoAlpha: 1 },   // picks up after the hero
      { left: "88vw", top: "26vh", rotation: -20 },                 // climbs across the stats strip
      { left: "10vw", top: "58vh", rotation: 16 },                  // banks back over the product tour
      { left: "90vw", top: "70vh", rotation: -4 },                  // glides through how-it-works
      { left: "12vw", top: "24vh", rotation: -24 },                 // loops up past the wins
      { left: "86vw", top: "48vh", rotation: 8 },                   // crosses pricing
      { left: "50vw", top: "62vh", rotation: 2 },                   // lines up on the CTA
      { left: "50vw", top: "86vh", rotation: 12, autoAlpha: 0 },    // lands and fades before the footer
    ];
    const vtl = gsap.timeline({
      defaults: { ease: "sine.inOut" },
      scrollTrigger: { trigger: document.body, start: "top top", end: "bottom bottom", scrub: 1.6 },
    });
    LEGS.forEach((leg, k) => vtl.to(voyager, { ...leg, duration: k === 0 ? 0.6 : 1 }));
    /* gentle idle bob on top of the flight path */
    gsap.to("#voyager svg", { y: -9, rotation: 4, transformOrigin: "50% 50%", duration: 1.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
  }

  /* ---------------- footer wordmark ripple ---------------- */
  document.querySelectorAll(".footer__giant .ltr").forEach((l) => {
    l.addEventListener("mouseenter", () => {
      gsap.timeline()
        .to(l, { y: -28, scaleY: 1.12, duration: 0.22, ease: "power2.out" })
        .to(l, { y: 0, scaleY: 1, duration: 0.5, ease: "bounce.out" });
      const sibs = [l.previousElementSibling, l.nextElementSibling].filter(Boolean);
      gsap.timeline()
        .to(sibs, { y: -12, duration: 0.22, ease: "power2.out", delay: 0.05 })
        .to(sibs, { y: 0, duration: 0.45, ease: "bounce.out" });
    });
  });

  /* nav anchors through Lenis */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -90, duration: 1.2 });
    });
  });
} else {
  document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = el.dataset.count));
}
