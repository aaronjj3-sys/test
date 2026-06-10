/* ============================================================
   Knock — landing page
   Three.js: a paper plane flies a flight path scrubbed by scroll,
   through a field of drifting paper sheets.
   GSAP + Lenis: smooth scroll, split-text reveals, pinned steps,
   counters, typewriter, tilt cards.
   ============================================================ */
import * as THREE from "three";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduceMotion) document.documentElement.classList.add("reduced-motion");

gsap.registerPlugin(ScrollTrigger);

/* ---------------- smooth scroll (Lenis ⇄ ScrollTrigger) ---------------- */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 1.0 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ================================================================
   THREE.JS SCENE
   ================================================================ */
const PAPER = 0xf6f1e7;
const INK = 0x181510;
const ACCENT = 0xff4d00;

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PAPER, 9, 26);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 9);

scene.add(new THREE.HemisphereLight(0xfffdf8, 0xd8cdb4, 1.1));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.6);
sun.position.set(4, 6, 5);
scene.add(sun);

/* ---- the paper plane (hand-built dart) ---- */
function buildPaperPlane() {
  const g = new THREE.BufferGeometry();
  // nose, back-top, keel, left tip, right tip
  const v = {
    nose: [0, 0.02, 1.7],
    backT: [0, 0.18, -1.35],
    keel: [0, -0.42, -1.1],
    lTip: [-1.45, 0.34, -1.5],
    rTip: [1.45, 0.34, -1.5],
  };
  const tris = [
    [v.nose, v.lTip, v.backT],   // left wing
    [v.nose, v.backT, v.rTip],   // right wing
    [v.nose, v.backT, v.keel],   // keel fin
  ];
  const pos = new Float32Array(tris.flat(2));
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();

  const body = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      color: 0xfffdf8, flatShading: true, side: THREE.DoubleSide,
      roughness: 0.65, metalness: 0.05,
    })
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(g, 1),
    new THREE.LineBasicMaterial({ color: ACCENT })
  );
  const plane = new THREE.Group();
  plane.add(body, edges);
  plane.scale.setScalar(0.62);
  return plane;
}
const plane = buildPaperPlane();
scene.add(plane);

/* ---- flight path: one long swoop the scroll scrubs through ---- */
const flightCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(3.4, 0.6, 1.5),    // hero: floating right of the headline
    new THREE.Vector3(1.8, 1.6, -1),
    new THREE.Vector3(-3.2, 0.8, -2),    // crosses left during marquee/problem
    new THREE.Vector3(-4.2, -1.4, 0.5),
    new THREE.Vector3(0, -1.9, 2.2),     // dives low under the "how" section
    new THREE.Vector3(3.8, -0.6, -1.5),
    new THREE.Vector3(4.4, 1.8, -3.5),   // climbs far right through features
    new THREE.Vector3(0.5, 2.6, -2),
    new THREE.Vector3(-3.8, 1.2, 0),     // banks left over testimonials
    new THREE.Vector3(-2.6, -0.8, 2.4),
    new THREE.Vector3(0, 0.4, 3.4),      // final CTA: flies right up to the camera
  ],
  false,
  "catmullrom",
  0.6
);

/* dashed flight-trail revealed behind the plane via drawRange */
const TRAIL_POINTS = 360;
const trailGeom = new THREE.BufferGeometry().setFromPoints(
  flightCurve.getSpacedPoints(TRAIL_POINTS)
);
const trail = new THREE.Line(
  trailGeom,
  new THREE.LineDashedMaterial({
    color: ACCENT, dashSize: 0.16, gapSize: 0.12,
    transparent: true, opacity: 0.55,
  })
);
trail.computeLineDistances();
trail.geometry.setDrawRange(0, 0);
scene.add(trail);

/* ---- drifting paper sheets ---- */
const sheets = [];
{
  const sheetGeom = new THREE.PlaneGeometry(0.55, 0.72);
  const mats = [
    new THREE.MeshStandardMaterial({ color: 0xfffdf8, side: THREE.DoubleSide, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xefe7d7, side: THREE.DoubleSide, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0xffd9c7, side: THREE.DoubleSide, roughness: 0.9 }),
  ];
  for (let i = 0; i < 46; i++) {
    const m = new THREE.Mesh(sheetGeom, mats[i % mats.length]);
    m.position.set(
      THREE.MathUtils.randFloatSpread(16),
      THREE.MathUtils.randFloatSpread(11),
      THREE.MathUtils.randFloat(-10, 3)
    );
    m.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    m.userData = {
      spin: THREE.MathUtils.randFloat(0.1, 0.45) * (Math.random() > 0.5 ? 1 : -1),
      bobAmp: THREE.MathUtils.randFloat(0.15, 0.5),
      bobSpeed: THREE.MathUtils.randFloat(0.3, 0.8),
      baseY: m.position.y,
      phase: Math.random() * Math.PI * 2,
    };
    scene.add(m);
    sheets.push(m);
  }
}

/* a few ink-dark "doors" floating deep in the field */
{
  const doorGeom = new THREE.BoxGeometry(0.5, 0.95, 0.05);
  const doorMat = new THREE.MeshStandardMaterial({ color: INK, roughness: 0.7 });
  const knobGeom = new THREE.SphereGeometry(0.035, 10, 10);
  const knobMat = new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.3 });
  for (let i = 0; i < 7; i++) {
    const door = new THREE.Mesh(doorGeom, doorMat);
    const knob = new THREE.Mesh(knobGeom, knobMat);
    knob.position.set(0.17, 0, 0.05);
    door.add(knob);
    door.position.set(
      THREE.MathUtils.randFloatSpread(15),
      THREE.MathUtils.randFloatSpread(9),
      THREE.MathUtils.randFloat(-9, -3)
    );
    door.rotation.y = THREE.MathUtils.randFloatSpread(1.2);
    door.userData = {
      spin: THREE.MathUtils.randFloat(0.05, 0.15),
      bobAmp: 0.2, bobSpeed: 0.4, baseY: door.position.y,
      phase: Math.random() * Math.PI * 2,
    };
    scene.add(door);
    sheets.push(door);
  }
}

/* ---- scroll drives flight progress; mouse adds parallax ---- */
const flight = { t: 0 };       // 0..1 along the curve, eased by GSAP scrub
const mouse = { x: 0, y: 0 };
window.addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
});

if (!reduceMotion) {
  gsap.to(flight, {
    t: 1,
    ease: "none",
    scrollTrigger: {
      trigger: document.body,
      start: "top top",
      end: "bottom bottom",
      scrub: 1.4, // the "timing": flight lags scroll by ~1.4s for a gliding feel
    },
  });
} else {
  flight.t = 0.04;
}

const tangent = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const clock = new THREE.Clock();
let prevT = 0;

function render() {
  const time = clock.getElapsedTime();

  // plane along curve + gentle bob
  const t = THREE.MathUtils.clamp(flight.t, 0.001, 0.999);
  flightCurve.getPointAt(t, plane.position);
  plane.position.y += Math.sin(time * 1.6) * 0.07;

  flightCurve.getTangentAt(t, tangent);
  lookTarget.copy(plane.position).add(tangent);
  plane.lookAt(lookTarget);
  // bank into turns based on how fast the path is curving
  const turn = (t - prevT) !== 0 ? tangent.x : 0;
  plane.rotation.z += THREE.MathUtils.clamp(-turn * 0.9, -0.7, 0.7) + Math.sin(time * 1.1) * 0.06;
  prevT = t;

  // reveal trail behind the plane
  trail.geometry.setDrawRange(0, Math.floor(t * TRAIL_POINTS));

  // drifting field
  for (const s of sheets) {
    const u = s.userData;
    s.rotation.x += u.spin * 0.004;
    s.rotation.y += u.spin * 0.006;
    s.position.y = u.baseY + Math.sin(time * u.bobSpeed + u.phase) * u.bobAmp;
  }

  // camera parallax follows the mouse, slightly chases the plane vertically
  camera.position.x += (mouse.x * 0.7 - camera.position.x) * 0.04;
  camera.position.y += (-mouse.y * 0.45 + plane.position.y * 0.12 - camera.position.y) * 0.04;
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

if (reduceMotion) {
  render(); // single static frame
} else {
  gsap.ticker.add(render);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (reduceMotion) render();
});

/* ================================================================
   SCROLL CHOREOGRAPHY (GSAP)
   ================================================================ */

/* split headlines into animatable words */
document.querySelectorAll("[data-split]").forEach((el) => {
  const splitNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const frag = document.createDocumentFragment();
      node.textContent.split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { frag.append(document.createTextNode(" ")); return; }
        const w = document.createElement("span");
        w.className = "w";
        const inner = document.createElement("span");
        inner.textContent = part;
        w.append(inner);
        frag.append(w);
      });
      node.replaceWith(frag);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      [...node.childNodes].forEach(splitNode);
    }
  };
  [...el.childNodes].forEach(splitNode);
});

if (!reduceMotion) {
  /* hero entrance — staged timing on load */
  const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
  intro
    .to(".hero .hero__title .w > span", { y: 0, duration: 1.1, stagger: 0.06 }, 0.15)
    .to(".hero .reveal", { opacity: 1, y: 0, duration: 0.9, stagger: 0.12 }, 0.7)
    .from(".nav", { y: -20, opacity: 0, duration: 0.8 }, 0.2);
  gsap.set(".hero .reveal", { y: 18 });

  /* every other split headline reveals when scrolled into view */
  document.querySelectorAll("[data-split]").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.to(el.querySelectorAll(".w > span"), {
      y: 0, duration: 0.9, ease: "power3.out", stagger: 0.05,
      scrollTrigger: { trigger: el, start: "top 82%" },
    });
  });

  /* generic fade-up reveals */
  document.querySelectorAll(".reveal").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.fromTo(el, { opacity: 0, y: 26 }, {
      opacity: 1, y: 0, duration: 0.9, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 85%" },
    });
  });

  /* cards rise with stagger, grouped per section */
  document.querySelectorAll(".problem__stats, .features__grid, .voices__row, .pricing__grid").forEach((group) => {
    gsap.fromTo(group.querySelectorAll(".reveal-card"), { opacity: 0, y: 44, rotateX: 6 }, {
      opacity: 1, y: 0, rotateX: 0, duration: 0.9, ease: "power3.out", stagger: 0.12,
      scrollTrigger: { trigger: group, start: "top 80%" },
    });
  });

  /* stat counters */
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = +el.dataset.count;
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.6, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 85%" },
      onUpdate: () => { el.textContent = Math.round(obj.v); },
    });
  });

  /* marquee drift */
  const track = document.querySelector(".marquee__track");
  track.innerHTML += track.innerHTML; // duplicate for seamless loop
  gsap.to(track, { xPercent: -50, ease: "none", duration: 28, repeat: -1 });

  /* pinned HOW section: scroll scrubs through the three steps */
  const steps = gsap.utils.toArray(".how-step");
  gsap.set(steps, { autoAlpha: 0, y: 40 });
  const howTl = gsap.timeline({
    scrollTrigger: {
      trigger: ".how",
      start: "top top",
      end: "+=2600",       // scroll distance budget for the whole sequence
      pin: ".how__pin",
      scrub: 0.8,
      onUpdate: (self) => {
        document.querySelector(".how__progress-bar").style.width =
          (self.progress * 100).toFixed(1) + "%";
      },
    },
  });
  steps.forEach((step, i) => {
    howTl.to(step, { autoAlpha: 1, y: 0, duration: 1, ease: "power2.out" });
    howTl.to({}, { duration: 1.6 });                       // hold so each step gets read time
    if (i < steps.length - 1)
      howTl.to(step, { autoAlpha: 0, y: -40, duration: 1, ease: "power2.in" });
  });

  /* typewriter inside step 2 — fires once when the step becomes visible */
  const subjectText = "you don’t know me, but 90 seconds";
  const bodyText =
    "Hi Maya — I’m a design student at UCI. I rebuilt my campus shuttle app’s booking flow as a case study (attached, 2 pages). Your talk on onboarding friction shaped half of it. If Figma ever takes interns who ship before they’re asked to — I’d love 15 minutes.";
  let typed = false;
  ScrollTrigger.create({
    trigger: ".how",
    start: "top top",
    end: "+=2600",
    onUpdate: (self) => {
      if (!typed && self.progress > 0.38) {
        typed = true;
        typeInto(document.getElementById("type-subject"), subjectText, 28, () =>
          typeInto(document.getElementById("type-body"), bodyText, 12)
        );
      }
    },
  });

  /* nav shadow once scrolled */
  ScrollTrigger.create({
    start: 60,
    onToggle: (self) => document.querySelector(".nav").classList.toggle("is-scrolled", self.isActive),
  });

  /* tilt cards (mouse) */
  document.querySelectorAll(".tilt").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      gsap.to(card, { rotateY: px * 10, rotateX: -py * 8, y: -4, duration: 0.4, ease: "power2.out" });
    });
    card.addEventListener("pointerleave", () => {
      gsap.to(card, { rotateY: 0, rotateX: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.5)" });
    });
  });

  /* anchor links scroll smoothly through Lenis */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -70, duration: 1.4 });
    });
  });
} else {
  /* reduced motion: render static text immediately */
  document.getElementById("type-subject").textContent = "you don’t know me, but 90 seconds";
  document.getElementById("type-body").textContent =
    "Hi Maya — I’m a design student at UCI. I rebuilt my campus shuttle app’s booking flow as a case study. If Figma ever takes interns who ship before they’re asked to — I’d love 15 minutes.";
  document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = el.dataset.count));
  document.querySelector(".how__progress-bar").style.width = "100%";
}

function typeInto(el, text, speed, done) {
  let i = 0;
  const tick = () => {
    el.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(tick, speed + Math.random() * speed);
    else if (done) done();
  };
  tick();
}
