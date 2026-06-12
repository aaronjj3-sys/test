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

/* ---------------- auth-gated CTAs ----------------
   Every "start knocking" button goes straight to the app when a session
   exists. The session check is awaited on click, so an early click can
   never flash the login overlay at someone who is already signed in. */
const authReady = window.knockAuth?.ready || Promise.resolve(null);
let authedUser = null;
authReady.then((u) => {
  authedUser = u || null;
  if (!authedUser) return;
  /* small signed-in affordance: the nav CTA becomes "Open app" */
  const navCta = document.querySelector('#nav a.btn[href="app/index.html"]');
  if (navCta) navCta.textContent = "Open app →";
});
document.querySelectorAll('a[href="app/index.html"]').forEach((a) => {
  a.addEventListener("click", async (e) => {
    if (authedUser) return; /* session known: continue straight to the app */
    e.preventDefault();
    const u = await authReady; /* wait for the session check, never assume logged-out */
    if (u) location.href = a.href;
    else window.knockAuth?.openLogin();
  });
});
if (location.hash === "#login") {
  history.replaceState(null, "", location.pathname);
  authReady.then((u) => { if (!u) window.knockAuth?.openLogin(); });
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
      /* full side flip: the old frame rotates away to 90°, the new one
         completes the turn in from -90°, like flipping a card over */
      gsap.set(frames[i], { x: 0 });
      gsap.to(frames[prev], { rotateY: 90 * dir, autoAlpha: 0, duration: 0.3, ease: "power2.in", overwrite: true });
      gsap.fromTo(frames[i], { rotateY: -90 * dir, autoAlpha: 0 },
        { rotateY: 0, autoAlpha: 1, duration: 0.45, ease: "power3.out", delay: 0.27, overwrite: true });
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

  /* ---------------- voyager: a paper plane glides with you down the page ----------------
     Not scrubbed 1:1. The scroll position picks a target along the route and the
     plane eases toward it every frame, so fast scrolling never makes it dart:
     it lags behind, catches up, and banks left/right with its actual heading. */
  if (!showcaseMobile) {
    const voyager = document.createElement("div");
    voyager.id = "voyager";
    voyager.setAttribute("aria-hidden", "true");
    voyager.innerHTML = `<svg viewBox="0 0 40 34"><path d="M2 4 L36 12 L10 20 L14 30 Z" fill="#fff" stroke="#1b2a38" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(voyager);
    gsap.set(voyager, { xPercent: -50, yPercent: -50, force3D: true });

    /* route waypoints in [vw, vh]; loops left → right → left down the page */
    const ROUTE = [
      [10, 74], [12, 66],  // holds near the hero while its own plane flies
      [88, 26],            // climbs across the stats strip
      [10, 58],            // banks back over the product tour
      [90, 70],            // glides through how-it-works
      [12, 24],            // loops up past the wins
      [86, 48],            // crosses pricing
      [50, 62], [50, 84],  // lines up on the CTA and descends
    ];
    const routeAt = (p) => {
      const f = Math.min(0.9999, Math.max(0, p)) * (ROUTE.length - 1);
      const i = Math.floor(f), t = f - i;
      const [x1, y1] = ROUTE[i], [x2, y2] = ROUTE[i + 1];
      return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
    };

    let cur = null, alpha = 0, pitch = 0, facing = 1;
    gsap.ticker.add(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      const [tx, ty] = routeAt(p);
      if (!cur) cur = [tx, ty];

      /* low-pass follow: the plane drifts toward the target instead of jumping */
      const k = 0.045;
      const dx = (tx - cur[0]) * k;
      const dy = (ty - cur[1]) * k;
      cur[0] += dx; cur[1] += dy;

      /* heading: mirror when flying right-to-left, pitch with the climb/dive */
      if (Math.abs(dx) > 0.004) facing = dx < 0 ? -1 : 1;
      const speed = Math.hypot(dx, dy);
      const targetPitch = speed > 0.002
        ? Math.max(-38, Math.min(38, (Math.atan2(dy * (window.innerHeight / window.innerWidth), Math.abs(dx)) * 180) / Math.PI))
        : 0;
      pitch += (targetPitch - pitch) * 0.08;

      /* hidden over the hero (it has its own plane) and before the footer */
      const targetAlpha = p > 0.06 && p < 0.95 ? 1 : 0;
      alpha += (targetAlpha - alpha) * 0.06;

      gsap.set(voyager, {
        left: cur[0] + "vw", top: cur[1] + "vh",
        rotation: pitch, scaleX: facing,
        autoAlpha: Math.round(alpha * 100) / 100,
      });
    });
    /* gentle idle bob on top of the flight */
    gsap.to("#voyager svg", { y: -8, duration: 1.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
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
