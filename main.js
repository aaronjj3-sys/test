/* ============================================================
   Knock — hero landing
   Scroll choreography: Lenis smooth scroll + GSAP ScrollTrigger.
   Signature moves:
   · hero product frame tilts flat as you scroll (Ramp-style)
   · floating UI chips parallax over the frame
   · paper plane (Three.js) glides across the hero and fades out
   · split-word headlines, counters, marquee, staggered bento
   ============================================================ */
import * as THREE from "three";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (reduceMotion) document.documentElement.classList.add("reduced-motion");

gsap.registerPlugin(ScrollTrigger);

/* ---------------- smooth scroll ---------------- */
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.09 });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ================================================================
   THREE.JS — paper plane over the hero
   ================================================================ */
const PAPER = 0xf8f5ee, ACCENT = 0xff4d00;
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PAPER, 9, 24);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 9);
scene.add(new THREE.HemisphereLight(0xfffdf8, 0xd8cdb4, 1.15));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
sun.position.set(4, 6, 5);
scene.add(sun);

function buildPlane() {
  const v = { nose: [0, 0.02, 1.7], backT: [0, 0.18, -1.35], keel: [0, -0.42, -1.1], lTip: [-1.45, 0.34, -1.5], rTip: [1.45, 0.34, -1.5] };
  const tris = [[v.nose, v.lTip, v.backT], [v.nose, v.backT, v.rTip], [v.nose, v.backT, v.keel]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tris.flat(2)), 3));
  g.computeVertexNormals();
  const grp = new THREE.Group();
  grp.add(
    new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xfffdf8, flatShading: true, side: THREE.DoubleSide, roughness: 0.65 })),
    new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), new THREE.LineBasicMaterial({ color: ACCENT }))
  );
  grp.scale.setScalar(0.5);
  return grp;
}
const plane = buildPlane();
scene.add(plane);

/* hero-only flight: a lazy S-curve across the top of the page */
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-5.2, 2.4, -2),
  new THREE.Vector3(-2.2, 1.1, 0.5),
  new THREE.Vector3(1.6, 2.2, 1.2),
  new THREE.Vector3(4.6, 0.6, -0.5),
  new THREE.Vector3(6.4, 1.8, -3),
], false, "catmullrom", 0.65);

const TRAIL = 240;
const trail = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(TRAIL)),
  new THREE.LineDashedMaterial({ color: ACCENT, dashSize: 0.16, gapSize: 0.12, transparent: true, opacity: 0.5 })
);
trail.computeLineDistances();
trail.geometry.setDrawRange(0, 0);
scene.add(trail);

/* a few drifting sheets for depth */
const sheets = [];
{
  const geo = new THREE.PlaneGeometry(0.5, 0.66);
  const mats = [0xfffdf8, 0xefe9da, 0xffe3d6].map((c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.9 }));
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(geo, mats[i % 3]);
    m.position.set(THREE.MathUtils.randFloatSpread(15), THREE.MathUtils.randFloatSpread(9), THREE.MathUtils.randFloat(-9, -2));
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    m.userData = { spin: THREE.MathUtils.randFloat(0.1, 0.4) * (Math.random() > 0.5 ? 1 : -1), baseY: m.position.y, amp: THREE.MathUtils.randFloat(0.15, 0.4), spd: THREE.MathUtils.randFloat(0.3, 0.7), ph: Math.random() * 6.28 };
    scene.add(m);
    sheets.push(m);
  }
}

const flight = { t: 0.06, fade: 1 };
const mouse = { x: 0, y: 0 };
window.addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
});

if (!reduceMotion) {
  /* plane crosses the sky over the first two screens, then the scene fades */
  gsap.to(flight, {
    t: 0.98, ease: "none",
    scrollTrigger: { trigger: ".hero", start: "top top", end: "+=180%", scrub: 1.3 },
  });
  gsap.to(flight, {
    fade: 0, ease: "none",
    scrollTrigger: { trigger: ".stats", start: "top 80%", end: "top 20%", scrub: true },
  });
}

const tangent = new THREE.Vector3(), look = new THREE.Vector3();
const clock = new THREE.Clock();
function render() {
  const time = clock.getElapsedTime();
  const t = THREE.MathUtils.clamp(flight.t, 0.001, 0.999);
  curve.getPointAt(t, plane.position);
  plane.position.y += Math.sin(time * 1.6) * 0.06;
  curve.getTangentAt(t, tangent);
  look.copy(plane.position).add(tangent);
  plane.lookAt(look);
  plane.rotation.z += Math.sin(time * 1.1) * 0.05 - tangent.y * 0.6;
  trail.geometry.setDrawRange(0, Math.floor(t * TRAIL));

  for (const s of sheets) {
    const u = s.userData;
    s.rotation.x += u.spin * 0.004; s.rotation.y += u.spin * 0.006;
    s.position.y = u.baseY + Math.sin(time * u.spd + u.ph) * u.amp;
  }
  camera.position.x += (mouse.x * 0.5 - camera.position.x) * 0.04;
  camera.position.y += (-mouse.y * 0.35 - camera.position.y) * 0.04;
  camera.lookAt(0, 0.5, 0);
  canvas.style.opacity = flight.fade;
  renderer.render(scene, camera);
}
if (reduceMotion) render();
else gsap.ticker.add(render);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (reduceMotion) render();
});

/* ================================================================
   SCROLL CHOREOGRAPHY
   ================================================================ */
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

if (!reduceMotion) {
  /* hero entrance */
  gsap.set(".hero .reveal", { y: 18 });
  gsap.timeline({ defaults: { ease: "power3.out" } })
    .from("#nav", { y: -20, opacity: 0, duration: 0.8 }, 0.1)
    .to(".hero__title .w > span", { y: 0, duration: 1.05, stagger: 0.07 }, 0.2)
    .to(".hero .reveal", { opacity: 1, y: 0, duration: 0.9, stagger: 0.12 }, 0.75)
    .from(".frame-wrap", { y: 80, opacity: 0, duration: 1.1, ease: "power3.out" }, 0.9)
    .from(".float-chip", { scale: 0.6, opacity: 0, duration: 0.7, stagger: 0.15, ease: "back.out(2)" }, 1.4);

  /* the Ramp move: frame flattens + grows as you scroll */
  gsap.to("#hero-frame", {
    rotateX: 0, scale: 1, ease: "none",
    scrollTrigger: { trigger: ".frame-wrap", start: "top 85%", end: "top 22%", scrub: 0.6 },
  });
  /* chips drift at different speeds over the frame */
  gsap.to("#chip-reply", { y: -46, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top bottom", end: "bottom top", scrub: true } });
  gsap.to("#chip-match", { y: 54, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top bottom", end: "bottom top", scrub: true } });
  gsap.to("#chip-sent", { y: -30, ease: "none", scrollTrigger: { trigger: ".frame-wrap", start: "top bottom", end: "bottom top", scrub: true } });

  /* split headlines on scroll */
  document.querySelectorAll("[data-split]").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.to(el.querySelectorAll(".w > span"), {
      y: 0, duration: 0.9, ease: "power3.out", stagger: 0.05,
      scrollTrigger: { trigger: el, start: "top 84%" },
    });
  });

  /* generic reveals */
  document.querySelectorAll(".reveal").forEach((el) => {
    if (el.closest(".hero")) return;
    gsap.fromTo(el, { opacity: 0, y: 24 }, {
      opacity: 1, y: 0, duration: 0.9, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 86%" },
    });
  });

  /* card groups rise with stagger */
  document.querySelectorAll(".stats__row, .bento__grid, .voices__row, .pricing__grid").forEach((group) => {
    gsap.fromTo(group.querySelectorAll(".reveal-card"), { opacity: 0, y: 44 }, {
      opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.1,
      scrollTrigger: { trigger: group, start: "top 82%" },
    });
  });

  /* counters */
  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = +el.dataset.count, obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.6, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 86%" },
      onUpdate: () => (el.textContent = Math.round(obj.v)),
    });
  });

  /* marquee */
  const track = document.querySelector(".marquee__track");
  track.innerHTML += track.innerHTML;
  gsap.to(track, { xPercent: -50, ease: "none", duration: 26, repeat: -1 });

  /* how-steps fade in as they pass */
  document.querySelectorAll(".hstep").forEach((s) => {
    gsap.fromTo(s, { opacity: 0.25, x: 24 }, {
      opacity: 1, x: 0, duration: 0.7, ease: "power2.out",
      scrollTrigger: { trigger: s, start: "top 74%" },
    });
  });

  /* nav border on scroll */
  ScrollTrigger.create({
    start: 60,
    onToggle: (self) => document.getElementById("nav").classList.toggle("is-scrolled", self.isActive),
  });

  /* smooth anchors through Lenis */
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -70, duration: 1.3 });
    });
  });
} else {
  document.querySelectorAll("[data-count]").forEach((el) => (el.textContent = el.dataset.count));
}
