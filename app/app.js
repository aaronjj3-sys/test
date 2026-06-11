/* ============================================================
   Knock app, SPA logic
   Views: dashboard · find people · inbox · tracker · profile · settings
   The agent drawer simulates a background agent:
   research → hook → draft-in-your-voice → approve & send → live replies.
   ============================================================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");

/* ---------------- state ---------------- */
const state = {
  knocks: +(localStorage.getItem("knock_left") ?? 15),
  outreach: SEED_OUTREACH.map((o) => ({ ...o })),
  threads: SEED_THREADS.map((t) => ({ ...t, messages: [...t.messages] })),
  passed: new Set(),
  filters: { source: "all", ask: "all", q: "" },
  openThread: null,
  trackerTab: "all",
  autonomy: { review: true, followups: true, weekends: false },
  connections: JSON.parse(localStorage.getItem("knock_connections") || '{"gmail":false,"gcal":false,"outlook":false,"linkedin":false}'),
  stats: { sent: 31, openRate: 71, replies: 9, meetings: 2 },
  /* live sourcing state (persisted locally until Supabase is wired) */
  doors: JSON.parse(localStorage.getItem("knock_doors") || "null"),
  doorsMeta: JSON.parse(localStorage.getItem("knock_doors_meta") || "null"),
  campaigns: JSON.parse(localStorage.getItem("knock_campaigns") || "[]"),
  selectedDoors: new Set(),
  searchMode: localStorage.getItem("knock_search_mode") || "founders",
  profilePhoto: localStorage.getItem("knock_profile_photo") || "",
  autoSourcing: false,
};
const saveLive = () => {
  localStorage.setItem("knock_doors", JSON.stringify(state.doors));
  localStorage.setItem("knock_doors_meta", JSON.stringify(state.doorsMeta));
  localStorage.setItem("knock_campaigns", JSON.stringify(state.campaigns));
};
const contact = (id) => CONTACTS.find((c) => c.id === id);
const saveKnocks = () => localStorage.setItem("knock_left", state.knocks);

/* ---------------- icons (inline SVG, currentColor) ---------------- */
const I = {
  job: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4h4a1 1 0 0 1 1 1v1h3a2 2 0 0 1 2 2v3H4V8a2 2 0 0 1 2-2h3V5a1 1 0 0 1 1-1zm1 2h2V5.5h-2zM4 13h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm7 0h2v2h-2z"/></svg>',
  coffee: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5h13v6a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5zm15 1h1.5A2.5 2.5 0 0 1 23 8.5 3.5 3.5 0 0 1 19.5 12H19zM5 19h12v2H5z"/></svg>',
  case: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h14v2h2v3a4 4 0 0 1-4 4 6 6 0 0 1-4 2.9V17h3v3H8v-3h3v-2.1A6 6 0 0 1 7 12a4 4 0 0 1-4-4V5h2zm0 4v1a2 2 0 0 0 2 2zm14 0-2 3a2 2 0 0 0 2-3z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  hook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8zm0 4a6 6 0 1 0 6 6h-2a4 4 0 1 1-4-4zm0 4a2 2 0 1 0 2 2 2 2 0 0 0-2-2z"/></svg>',
  story: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm14 8H3v10h18zM3 8h18V6H3z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 9h4v12H2zM9 9h3.8v1.7h.1A4.2 4.2 0 0 1 16.6 9C20.6 9 21 11.6 21 15v6h-4v-5.3c0-1.3 0-2.9-1.8-2.9S13 14.2 13 15.6V21H9z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-2 2v1h16v-1z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>',
  cap: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 1 9l11 6 9-4.9V17h2V9zM5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 0.7s.8 2.8.8 5c0 2.2-1.4 3.9-3.6 3.9S7 7.9 7 5.7c0-.3 0-.6.1-.9C4.6 7.3 3 10.5 3 13.5 3 18.2 7 22 12 22s9-3.8 9-8.5c0-5.8-5-9.9-7.5-12.8z"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 7V3h-2v4h-4V3H8v4H6v6a5 5 0 0 0 4 4.9V21h4v-3.1A5 5 0 0 0 18 13V7z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 13h7V4H4zm0 7h7v-5H4zm9 0h7v-9h-7zm0-16v5h7V4z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.1 6.1L20 10l-5.9 1.9L12 18l-2.1-6.1L4 10l5.9-1.9z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4l-1.4 1.4L16.2 11H4v2h12.2l-5.6 5.6L12 20l8-8z"/></svg>',
};
const icon = (name, cls = "icn") => `<span class="${cls}">${I[name] || ""}</span>`;

/* ---------------- helpers ---------------- */
function toast(html, ms = 3200) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = html;
  $("#toasts").append(t);
  setTimeout(() => { t.style.opacity = 0; t.style.transition = "opacity .3s"; setTimeout(() => t.remove(), 320); }, ms);
}

function ring(match, size = 46) {
  const C = 2 * Math.PI * 19.5;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 46 46">
      <circle class="bgc" cx="23" cy="23" r="19.5"/>
      <circle class="fgc" cx="23" cy="23" r="19.5" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - match / 100)}"/>
    </svg><b>${match}%</b></div>`;
}

const avatarBg = { lavender: "#7a68c9", mint: "#2e7d5b", blush: "#c95f3c", butter: "#a8842a" };
const av = (c, size = 26) =>
  `<span class="avatar" style="width:${size}px;height:${size}px;background:${avatarBg[c.color]};font-size:${size * 0.34}px">${c.initials}</span>`;

/* company logo pulled from the web, with lettermark fallback */
const logo = (c, size = 28) =>
  `<span class="co-logo" style="width:${size}px;height:${size}px"><b>${c.company[0]}</b><img src="https://www.google.com/s2/favicons?domain=${c.domain}&sz=64" alt="" loading="lazy" onerror="this.remove()"></span>`;

const askLabel = { job: "Job / internship", coffee: "Coffee chat", case: "Case comp" };
const askChip = (t) => `<span class="ask">${icon(t)}${askLabel[t]}</span>`;
const sourceBadge = (s) =>
  ({ yc: '<span class="badge badge--yc">YC directory</span>',
     alumni: '<span class="badge badge--alumni">Alumni</span>',
     hiring: '<span class="badge badge--hiring">Hiring now</span>',
     vc: '<span class="badge badge--vc">VC · PE</span>' }[s] || "");

const statusDot = (stage) => {
  const st = STAGES.find((s) => s.id === stage);
  return `<span class="st st--${stage}"><i></i>${st.label}</span>`;
};

function updateChrome() {
  $("#knocks-left").textContent = state.knocks;
  $("#knocks-bar").style.width = (state.knocks / 15) * 100 + "%";
  const unread = state.threads.filter((t) => t.unread).length;
  const badge = $("#inbox-badge");
  badge.hidden = unread === 0;
  badge.textContent = unread;
  const user = window.knockAuth?.user;
  const initials = ((user?.name || PROFILE.name).match(/\b\w/g) || PROFILE.initials.split("")).slice(0, 2).join("").toUpperCase();
  const avatar = $("#top-avatar");
  if (avatar) avatar.innerHTML = state.profilePhoto || user?.avatar
    ? `<img src="${state.profilePhoto || user.avatar}" alt="">`
    : initials;
  const logout = $("#top-logout");
  if (logout) logout.hidden = (window.knockAuth?.mode || "dev") === "dev";
}

/* ============================================================
   ROUTER
   ============================================================ */
const routes = { dashboard: renderDashboard, people: renderPeople, inbox: renderInbox, tracker: renderTracker, profile: renderProfile, settings: renderSettings };

function navigate() {
  const route = location.hash.replace("#", "") || "dashboard";
  const fn = routes[route] || renderDashboard;
  $$(".side__link").forEach((a) => a.classList.toggle("is-active", a.dataset.route === route));
  view.scrollTop = 0;
  fn();
  updateChrome();
}
window.addEventListener("hashchange", navigate);

/* ============================================================
   DASHBOARD
   ============================================================ */
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

/* ---- live dashboard: ghost → sourcing → doors queue → campaign queued ---- */
const SEARCH_MODES_UI = [
  ["founders", "Founders"], ["hiring_managers", "Hiring managers"],
  ["investors", "Investors"], ["operators", "Operators"],
];

function buildSourcingProfile() {
  const saved = JSON.parse(localStorage.getItem("knock_profile") || "null");
  if (saved) return saved;
  /* fallback before onboarding completes */
  return {
    story: PROFILE.story,
    target: "YC founders, startup operators, investors, hiring managers",
    school: PROFILE.school || "UC Irvine",
    fullName: PROFILE.name,
    goals: ["founder mentorship", "startup roles", "internship opportunities"],
    locations: ["San Francisco", "New York", "Los Angeles", "Remote"],
    industries: ["SaaS", "Venture Capital", "Private Equity", "Startups"],
    quantifiedWins: ["built a $400K wholesale/ecommerce business in high school"],
  };
}

function renderDashboard() {
  const queued = state.campaigns.length > 0;
  if ((!state.doors || state.doors.length === 0) && shouldAutoSource()) return runSourcing({ auto: true });
  if (!state.doors || state.doors.length === 0) return renderGhost();
  return renderDoorsQueue(queued);
}

function shouldAutoSource() {
  const auth = window.knockAuth;
  if (!auth || auth.mode === "dev" || !auth.user?.id || state.autoSourcing) return false;
  return !localStorage.getItem(`knock_auto_sourced_${auth.user.id}`);
}

function renderGhost() {
  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${greeting()}, ${PROFILE.name.split(" ")[0]}.</h1>
      <p>Your command station is ready. Run your first sourcing pass to fill it.</p>
    </div>
    <div class="ghost">
      <div class="ghost__icon">${I.search}</div>
      <h2>No doors found yet</h2>
      <p>Run your first sourcing pass and Knock will build a high-signal queue of real people matched to your profile.</p>
      <div class="ghost__modes">
        ${SEARCH_MODES_UI.map(([id, label]) =>
          `<button class="pill ${state.searchMode === id ? "is-on" : ""}" data-mode="${id}">${label}</button>`).join("")}
      </div>
      <button class="btn btn--accent" id="find-doors">Find doors</button>
      <p class="ghost__fine">Search is free — Knock only spends enrichment credits when you approve a knock.
        <a href="#" id="see-demo">Peek at the demo dashboard</a></p>
    </div>
  </div>`;
  $$(".ghost__modes .pill", view).forEach((p) => p.addEventListener("click", () => {
    state.searchMode = p.dataset.mode;
    localStorage.setItem("knock_search_mode", state.searchMode);
    $$(".ghost__modes .pill", view).forEach((x) => x.classList.toggle("is-on", x === p));
  }));
  $("#find-doors", view).addEventListener("click", runSourcing);
  $("#see-demo", view).addEventListener("click", (e) => { e.preventDefault(); renderDemoDashboard(); });
}

async function runSourcing(options = {}) {
  state.autoSourcing = true;
  const STEPS = [
    "Reading your target profile",
    "Searching Apollo for relevant people",
    "Scoring title, company, and seniority fit",
    "Drafting personalized hooks",
    "Building your launch queue",
  ];
  view.innerHTML = `<div class="viewwrap"><div class="ghost">
    <div class="ghost__icon ghost__icon--spin">${I.spark}</div>
    <h2>Scout is sourcing…</h2>
    <ul class="srcsteps">${STEPS.map((s, i) => `<li data-i="${i}">${s}</li>`).join("")}</ul>
  </div></div>`;
  const items = $$(".srcsteps li", view);
  let step = 0;
  items[0].classList.add("is-on");
  const ticker = setInterval(() => {
    if (step < STEPS.length - 1) {
      items[step].classList.add("is-done");
      step++;
      items[step].classList.add("is-on");
    }
  }, 850);

  try {
    const res = await fetch("/api/sourcing/apollo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: buildSourcingProfile(), searchMode: state.searchMode, limit: 15 }),
    });
    const data = await res.json();
    clearInterval(ticker);
    if (!res.ok) throw new Error(data.error || "Sourcing failed");
    state.doors = data.doors;
    state.doorsMeta = data.meta;
    state.selectedDoors = new Set();
    saveLive();
    if (window.knockAuth?.user?.id) localStorage.setItem(`knock_auto_sourced_${window.knockAuth.user.id}`, "1");
    toast(`${data.doors.length} doors found${data.doors[0]?.source === "mock" ? " (demo data — Apollo key not configured)" : ""}`);
    state.autoSourcing = false;
    renderDashboard();
  } catch (err) {
    clearInterval(ticker);
    state.autoSourcing = false;
    view.innerHTML = `<div class="viewwrap"><div class="ghost">
      <div class="ghost__icon">${I.bell}</div>
      <h2>Sourcing hit a snag</h2>
      <p>${err.message}. If you're running locally, start the dev server with <code>node server.js</code> so the API routes are live.</p>
      <button class="btn btn--accent" id="retry-doors">Try again</button>
    </div></div>`;
    $("#retry-doors", view).addEventListener("click", () => options.auto ? runSourcing({ auto: true }) : renderGhost());
  }
}

function renderDoorsQueue(queued) {
  const doors = state.doors;
  const meta = state.doorsMeta || {};
  const isMock = doors[0]?.source === "mock";
  const campaign = state.campaigns[state.campaigns.length - 1];
  const queuedIds = new Set(state.campaigns.flatMap((c) => c.selectedDoorIds));

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${doors.length} doors found ${isMock ? '<span class="badge badge--hiring">demo data</span>' : ""}</h1>
      <p>Scored against your profile. Select the people you want, review the drafts, then launch.</p>
    </div>
    ${queued ? `
    <div class="qbanner">
      <div>${I.plane}</div>
      <div>
        <b>Campaign queued · ${campaign.selectedDoorIds.length} knock${campaign.selectedDoorIds.length === 1 ? "" : "s"}</b>
        <p>Gmail sending is not connected yet — nothing has been sent. Connect Gmail to send from your own inbox.</p>
      </div>
      <button class="btn btn--paper btn--sm" id="q-gmail">Connect Gmail</button>
    </div>` : ""}
    <div class="statgrid">
      <div class="statcard"><small>Doors found</small><div class="num">${doors.length}</div><span class="delta">${isMock ? "Demo queue ready" : "Live Apollo pull"}</span></div>
      <div class="statcard"><small>Average match</small><div class="num">${Math.round(doors.reduce((sum, d) => sum + (d.matchScore || 0), 0) / doors.length)}%</div><span class="delta">scored for you</span></div>
      <div class="statcard"><small>Drafts ready</small><div class="num">${doors.filter((d) => d.draft).length}</div><span class="delta">review before sending</span></div>
      <div class="statcard"><small>Knocks left</small><div class="num">${state.knocks}</div><span class="delta">free plan</span></div>
    </div>
    <div class="rowhead">
      <h2>Top doors to knock</h2>
      <span class="rowhead__hint">ranked by match score</span>
    </div>
    <div class="matches">
      ${doors.slice(0, 5).map((d, i) => {
        const colors = ["lavender", "mint", "blush", "butter", "lavender"];
        return `<article class="match-card match-card--${colors[i]}">
          <div class="match-card__top"><span class="match-card__meta">${d.companyName || "New door"}</span>${ring(d.matchScore || 0, 46)}</div>
          <h3>${d.name}</h3>
          <div class="co">${d.title || ""}</div>
          <div class="match-card__tags">${(d.matchReasons || []).slice(0, 3).map((r) => `<span>${r}</span>`).join("")}</div>
          <div class="match-card__foot">
            <span class="who">${d.companyName ? logo({ company: d.companyName, domain: d.companyDomain || "" }, 26) : ""}${d.location || "Apollo"}</span>
            <button class="btn btn--paper btn--sm act-review" data-id="${d.id}">Review knock</button>
          </div>
        </article>`;
      }).join("")}
    </div>
    <div class="rowhead">
      <h2>Your launch queue</h2>
      <span class="rowhead__hint">${meta.searchedPeople || doors.length} people searched · ${meta.creditsLikelyUsed ? "credits used" : "no Apollo credits used"}</span>
      <div class="rowhead__actions">
        <button class="btn btn--paper btn--sm" id="resource">Find new doors</button>
        <button class="btn btn--sm" id="launch" disabled>Approve &amp; Launch Campaign</button>
      </div>
    </div>
    <div class="tablewrap"><table class="doors-table">
      <thead><tr><th></th><th>Person</th><th>Company</th><th>Match</th><th>Why</th><th>Draft</th><th></th></tr></thead>
      <tbody>
        ${doors.map((d) => `
          <tr data-id="${d.id}" class="${queuedIds.has(d.id) ? "is-queued" : ""}">
            <td>${queuedIds.has(d.id)
              ? '<span class="st st--sent"><i></i>queued</span>'
              : `<input type="checkbox" class="door-check" data-id="${d.id}" ${state.selectedDoors.has(d.id) ? "checked" : ""}>`}</td>
            <td><div class="cell-who"><div><strong>${d.name}</strong><small>${d.title || ""}${d.location ? " · " + d.location : ""}</small></div></div></td>
            <td>${d.companyName ? `<div class="cell-co">${logo({ company: d.companyName, domain: d.companyDomain || "" }, 24)}<span>${d.companyName}</span></div>` : "—"}</td>
            <td>${ring(d.matchScore, 40)}</td>
            <td><div class="reasons">${(d.matchReasons || []).slice(0, 3).map((r) => `<span>${r}</span>`).join("")}</div></td>
            <td class="cell-draft"><b>${d.draft?.subject || ""}</b><small>${(d.draft?.preview || "").slice(0, 90)}…</small></td>
            <td class="cell-links">${d.linkedinUrl ? `<a href="${d.linkedinUrl}" target="_blank" rel="noopener" title="LinkedIn">${I.linkedin}</a>` : ""}
                <button class="btn btn--paper btn--sm act-review" data-id="${d.id}">Review knock</button></td>
          </tr>`).join("")}
      </tbody>
    </table></div>
    ${(meta.warnings || []).map((w) => `<p class="meta-warn">${w}</p>`).join("")}
  </div>`;

  const launch = $("#launch", view);
  const syncLaunch = () => {
    launch.disabled = state.selectedDoors.size === 0;
    launch.textContent = state.selectedDoors.size
      ? `Approve & Launch (${state.selectedDoors.size})` : "Approve & Launch Campaign";
  };
  syncLaunch();
  $$(".door-check", view).forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? state.selectedDoors.add(cb.dataset.id) : state.selectedDoors.delete(cb.dataset.id);
    syncLaunch();
  }));
  $$(".act-review", view).forEach((b) => b.addEventListener("click", () => {
    const d = doors.find((x) => x.id === b.dataset.id);
    openDoorDraft(d);
  }));
  launch.addEventListener("click", launchCampaign);
  $("#resource", view).addEventListener("click", runSourcing);
  $("#q-gmail", view)?.addEventListener("click", () =>
    toast("Gmail OAuth is the next build step — campaigns stay safely queued until then"));
}

function openDoorDraft(d) {
  openModal(`
    <h2 style="font-size:1.2rem">${d.draft?.subject || "Draft"}</h2>
    <p class="sub">To ${d.name} · ${d.title || ""} at ${d.companyName || ""}</p>
    <div class="pcard" style="white-space:pre-wrap;font-size:.88rem;line-height:1.55">${d.draft?.body || d.draft?.preview || ""}</div>
    <div class="modal__actions">
      <button class="btn btn--paper" id="dd-close">Close</button>
      <button class="btn btn--accent" id="dd-select">${state.selectedDoors.has(d.id) ? "Selected ✓" : "Select for campaign"}</button>
    </div>`);
  $("#dd-close").addEventListener("click", closeModal);
  $("#dd-select").addEventListener("click", () => {
    state.selectedDoors.add(d.id);
    closeModal();
    renderDashboard();
  });
}

async function launchCampaign() {
  const selected = state.doors.filter((d) => state.selectedDoors.has(d.id));
  if (!selected.length) return;
  try {
    const res = await fetch("/api/campaigns/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doors: selected }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not queue campaign");
    state.campaigns.push(data.campaign);
    state.selectedDoors = new Set();
    saveLive();
    toast("Campaign queued — Gmail sending is not connected yet, nothing was sent");
    renderDashboard();
  } catch (err) {
    toast(`Launch failed: ${err.message}`);
  }
}

function renderDemoDashboard() {
  const inPipeline = new Set(state.outreach.map((o) => o.contactId));
  const matches = CONTACTS.filter((c) => !inPipeline.has(c.id) && !state.passed.has(c.id)).slice(0, 5);
  const warm = state.outreach.filter((o) => o.stage === "replied" || o.stage === "meeting").length;

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${greeting()}, ${PROFILE.name.split(" ")[0]}. <em>${warm} warm thread${warm === 1 ? "" : "s"}</em> waiting. <span class="badge badge--hiring">demo data</span></h1>
      <p>Scout sourced ${matches.length} new doors overnight from the YC directory, alumni network, and live hiring signals. <a href="#" id="back-live">Back to your live dashboard</a></p>
    </div>

    <div class="statgrid">
      <div class="statcard"><small>Knocks sent</small><div class="num">${state.stats.sent}</div><span class="delta">▲ 8 this week</span></div>
      <div class="statcard"><small>Open rate</small><div class="num">${state.stats.openRate}%</div><span class="delta">▲ 12% vs job boards' 2%</span></div>
      <div class="statcard"><small>Replies</small><div class="num">${state.stats.replies}</div><span class="delta">▲ 3 this week</span></div>
      <div class="statcard"><small>Meetings booked</small><div class="num">${state.stats.meetings}</div><span class="delta">Thu 2:00 PM next</span></div>
    </div>

    <div class="rowhead">
      <h2>Top doors to knock</h2>
      <span class="rowhead__hint">ranked for you · refreshed 2h ago</span>
      <div class="rowhead__actions">
        <a class="btn btn--paper btn--sm" href="#people">Browse all</a>
        <button class="btn btn--sm" id="knock-all">Knock on all ${matches.length}</button>
      </div>
    </div>
    <div class="matches">
      ${matches.map((c, i) => `
        <div class="match-card match-card--${c.color}" style="animation-delay:${i * 70}ms" data-id="${c.id}">
          <div class="match-card__top">
            <span class="match-card__meta">${c.location}<br>${askLabel[c.type]}</span>
            ${ring(c.match)}
          </div>
          <h3>${c.name}</h3>
          <span class="co">${c.role} · ${c.company}</span>
          <div class="match-card__tags">${c.tags.slice(0, 2).map((t) => `<span>${t}</span>`).join("")}</div>
          <div class="match-card__foot">
            <span class="who">${sourceBadge(c.source)}</span>
            <button class="btn btn--paper btn--sm act-pass">Pass</button>
            <button class="btn btn--sm act-knock">Knock</button>
          </div>
        </div>`).join("")}
    </div>

    <div class="rowhead">
      <h2>All outreach</h2>
      <span class="rowhead__hint">${state.outreach.length} active</span>
      <div class="rowhead__actions"><a class="btn btn--paper btn--sm" href="#tracker">Open tracker</a></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>Person</th><th>Ask</th><th>Status</th><th>Opens</th><th>Last activity</th><th></th></tr></thead>
      <tbody>
        ${state.outreach.map((o) => { const c = contact(o.contactId); return `
          <tr data-id="${c.id}">
            <td><div class="cell-who">${av(c, 32)}<div><strong>${c.name}</strong><small>${c.role} · ${c.company}</small></div></div></td>
            <td>${askChip(c.type)}</td>
            <td>${statusDot(o.stage)}</td>
            <td class="cell-mono">${o.opens || "·"}</td>
            <td><div class="cell-mono">${o.lastTouch}</div>${o.note ? `<div class="cell-note">${o.note}</div>` : ""}</td>
            <td class="cell-mono">→</td>
          </tr>`; }).join("")}
      </tbody>
    </table></div>
  </div>`;

  $$(".match-card .act-knock", view).forEach((b) =>
    b.addEventListener("click", (e) => openAgent(contact(e.target.closest(".match-card").dataset.id))));
  $$(".match-card .act-pass", view).forEach((b) =>
    b.addEventListener("click", (e) => {
      const card = e.target.closest(".match-card");
      state.passed.add(card.dataset.id);
      card.style.cssText += "transition:.3s;opacity:0;transform:translateX(-16px) rotate(-2deg)";
      toast("Passed. Scout recalibrates your matches");
      setTimeout(renderDemoDashboard, 320);
    }));
  $("#back-live", view)?.addEventListener("click", (e) => { e.preventDefault(); renderDashboard(); });
  $("#knock-all", view)?.addEventListener("click", () => {
    if (!matches.length) return;
    matches.slice(1).forEach((c) => state.outreach.unshift({ contactId: c.id, stage: "drafted", lastTouch: "just now", opens: 0, note: "Draft ready for review" }));
    toast(`Scout is drafting ${matches.length} knocks. First one ready now`);
    openAgent(matches[0]);
  });
  $$("tbody tr", view).forEach((tr) =>
    tr.addEventListener("click", () => {
      const o = state.outreach.find((x) => x.contactId === tr.dataset.id);
      if (o.stage === "drafted") openAgent(contact(tr.dataset.id));
      else if (state.threads.some((t) => t.contactId === tr.dataset.id)) { state.openThread = tr.dataset.id; location.hash = "inbox"; }
      else location.hash = "tracker";
    }));
}

/* ============================================================
   FIND PEOPLE (table with company logos)
   ============================================================ */
function renderPeople() {
  const { source, ask, q } = state.filters;
  const list = CONTACTS.filter((c) =>
    !state.passed.has(c.id) &&
    (source === "all" || c.source === source) &&
    (ask === "all" || c.type === ask) &&
    (!q || (c.name + c.company + c.role).toLowerCase().includes(q)));

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>Find people, <em>not postings.</em></h1>
      <p>Scout watches the YC directory, your alumni network, PE/VC rosters, and live hiring signals, then ranks who will actually answer you.</p>
    </div>
    <div class="filters">
      ${SOURCES.map((s) => `<button class="pill ${source === s.id ? "is-on" : ""}" data-k="source" data-v="${s.id}">${s.label}</button>`).join("")}
      <span style="width:10px"></span>
      ${ASKS.map((a) => `<button class="pill ${ask === a.id ? "is-on" : ""}" data-k="ask" data-v="${a.id}">${a.label}</button>`).join("")}
    </div>
    <div class="tablewrap">
      <table class="people-table">
        <thead><tr><th>Name</th><th>Role</th><th>Company</th><th>Source · signal</th><th>Match</th><th></th></tr></thead>
        <tbody>
          ${list.map((c, i) => `
            <tr data-id="${c.id}" style="animation-delay:${i * 35}ms">
              <td><div class="cell-who">${av(c, 36)}<div><strong>${c.name}</strong><small>${c.location}</small></div></div></td>
              <td><div class="cell-role">${c.role}</div>${askChip(c.type)}</td>
              <td><div class="cell-co">${logo(c, 30)}<strong>${c.company}</strong></div></td>
              <td><div class="cell-signal">${sourceBadge(c.source)}<small>${c.signal}</small></div></td>
              <td>${ring(c.match, 38)}</td>
              <td><div class="cell-actions">
                <button class="btn btn--paper btn--sm act-pass">Pass</button>
                <button class="btn btn--sm act-knock">Draft knock</button>
              </div></td>
            </tr>`).join("")}
          ${list.length === 0 ? `<tr><td colspan="6"><div class="empty" style="height:120px">No one matches those filters. Scout is sourcing more doors tonight.</div></td></tr>` : ""}
        </tbody>
      </table>
    </div>
  </div>`;

  $$(".pill", view).forEach((p) =>
    p.addEventListener("click", () => { state.filters[p.dataset.k] = p.dataset.v; renderPeople(); }));
  $$(".people-table .act-knock", view).forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openAgent(contact(e.target.closest("tr").dataset.id)); }));
  $$(".people-table .act-pass", view).forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const tr = e.target.closest("tr");
      state.passed.add(tr.dataset.id);
      tr.style.cssText += "transition:.3s;opacity:0";
      setTimeout(() => tr.remove(), 300);
      toast("Passed. Fewer of these next time");
    }));
}

/* ============================================================
   INBOX (+ Connections hub)
   ============================================================ */
const CONNECTIONS = [
  { id: "gmail", icn: "mail", name: "Gmail", sub: "aaron@uci.edu · sends from your real address" },
  { id: "gcal", icn: "cal", name: "Google Calendar", sub: "auto-offers your free slots when they say yes" },
  { id: "outlook", icn: "mail", name: "Outlook", sub: "school and work inboxes welcome" },
  { id: "linkedin", icn: "linkedin", name: "LinkedIn", sub: "DMs and connection notes, same voice" },
];

function openConnections() {
  openModal(`
    <h2>Connections</h2>
    <p class="sub">Everywhere you knock from. Connect once, Scout handles the rest.</p>
    <div class="connlist">
      ${CONNECTIONS.map((c) => `
        <div class="connrow" data-id="${c.id}">
          <span class="ico">${I[c.icn]}</span>
          <div><strong>${c.name}</strong><small>${c.sub}</small></div>
          ${state.connections[c.id]
            ? `<button class="btn btn--paper btn--sm end act-disconnect">Disconnect</button>`
            : `<button class="btn btn--sm end act-connect">Connect</button>`}
        </div>`).join("")}
    </div>
    <p class="connlist__fine">Real OAuth (Gmail send, Calendar) is the next build step — these toggles track intent until then. More channels (iMessage, X, Discord) are on the roadmap.</p>
    <div class="modal__actions"><button class="btn btn--ghost" id="m-close">Done</button></div>`);
  const setConn = (id, val) => {
    state.connections[id] = val;
    localStorage.setItem("knock_connections", JSON.stringify(state.connections));
    toast(`${CONNECTIONS.find((c) => c.id === id).name} ${val ? "connected" : "disconnected"}`);
    openConnections();
  };
  $$(".act-connect", modal).forEach((b) =>
    b.addEventListener("click", (e) => setConn(e.target.closest(".connrow").dataset.id, true)));
  $$(".act-disconnect", modal).forEach((b) =>
    b.addEventListener("click", (e) => setConn(e.target.closest(".connrow").dataset.id, false)));
  $("#m-close", modal).addEventListener("click", closeModal);
}

function renderInbox() {
  const open = state.openThread ?? state.threads[0]?.contactId;
  state.openThread = open;
  const t = state.threads.find((x) => x.contactId === open);
  if (t && t.unread) { t.unread = false; }

  view.innerHTML = `<div class="viewwrap">
    <div class="vh vh--row">
      <div>
        <h1>Inbox. <em>Warm threads first.</em></h1>
        <p>Scout tracks every reply and flags the doors that are opening.</p>
      </div>
      <button class="btn btn--paper" id="connections-btn">${icon("plug")} Connections</button>
    </div>
    <div class="inbox">
      <div class="threadlist">
        ${state.threads.map((th) => { const c = contact(th.contactId); return `
          <div class="thread-item ${th.contactId === open ? "is-open" : ""}" data-id="${th.contactId}">
            <div class="thread-item__row">${th.unread ? '<span class="dot-unread"></span>' : ""}<strong>${c.name}</strong>
              ${th.warm ? '<span class="warmtag">WARM</span>' : ""}<time>${th.when}</time></div>
            <span class="subj">${th.subject}</span>
          </div>`; }).join("")}
        ${state.threads.length === 0 ? '<div class="empty">No threads yet. Knock on a door first.</div>' : ""}
      </div>
      <div class="threadview">
        ${t ? `
          <div class="threadview__head"><h3>${t.subject}</h3>
            <small>${contact(t.contactId).name} · ${contact(t.contactId).role}, ${contact(t.contactId).company}</small></div>
          <div class="threadview__msgs" id="msgs">
            ${t.messages.map((m) => `<div class="msg msg--${m.from === "you" ? "you" : "them"}"><time>${m.time}</time>${m.text}</div>`).join("")}
          </div>
          <div class="threadview__reply">
            <input id="reply-input" type="text" placeholder="Reply, or let Scout draft it…" />
            <button class="btn btn--paper btn--sm" id="scout-draft">Scout draft</button>
            <button class="btn btn--sm" id="send-reply">Send</button>
          </div>` : '<div class="empty">Select a thread.</div>'}
      </div>
    </div>
  </div>`;

  $("#connections-btn", view).addEventListener("click", openConnections);
  $$(".thread-item", view).forEach((el) =>
    el.addEventListener("click", () => { state.openThread = el.dataset.id; renderInbox(); updateChrome(); }));

  const msgs = $("#msgs", view);
  if (msgs) msgs.scrollTop = msgs.scrollHeight;

  $("#scout-draft", view)?.addEventListener("click", () => {
    const c = contact(t.contactId);
    $("#reply-input", view).value =
      t.warm
        ? `Booked a slot for Thursday. Thank you, ${c.name.split(" ")[0]}! Sending the ${c.type === "case" ? "deck" : "case study"} ahead so we can skip straight to questions.`
        : `Just floating this back up, ${c.name.split(" ")[0]}. Still very keen for 15 minutes whenever works.`;
    toast("Drafted in your voice. Edit freely");
  });
  $("#send-reply", view)?.addEventListener("click", () => {
    const input = $("#reply-input", view);
    if (!input.value.trim()) return;
    t.messages.push({ from: "you", time: "Just now", text: input.value.trim() });
    input.value = "";
    renderInbox();
    toast("Sent. Scout will watch for the reply");
  });
}

/* ============================================================
   TRACKER (funnel tabs, Jobright-style)
   ============================================================ */
const STAGE_ACTIONS = {
  drafted: { label: "Review draft", run: (c) => openAgent(c) },
  sent: { label: "Nudge now", run: (c, o) => { o.lastTouch = "just now"; toast(`Nudge queued for ${c.name.split(" ")[0]}, sending at their reading hours`); renderTracker(); } },
  opened: { label: "Follow up", run: (c, o) => { o.lastTouch = "just now"; toast(`Follow-up drafted for ${c.name.split(" ")[0]}. Review it in the drawer`); openAgent(c); } },
  replied: { label: "Open thread", run: (c) => { state.openThread = c.id; location.hash = "inbox"; } },
  meeting: { label: "Prep brief", run: (c) => toast(`Prep brief for ${c.name.split(" ")[0]} sent to your email`) },
};

function renderTracker() {
  const tabs = [{ id: "all", label: "All" }, ...STAGES];
  const count = (id) => (id === "all" ? state.outreach.length : state.outreach.filter((o) => o.stage === id).length);
  const active = state.trackerTab;
  const rows = state.outreach.filter((o) => active === "all" || o.stage === active);
  const total = Math.max(state.outreach.length, 1);

  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Every door, <em>one funnel.</em></h1>
    <p>Where each knock stands. Scout keeps the follow-ups moving so you only act on the doors that open.</p></div>

    <div class="funnel-tabs">
      ${tabs.map((s) => `
        <button class="ftab ${active === s.id ? "is-on" : ""}" data-id="${s.id}">
          <b>${count(s.id)}</b><span>${s.label}</span>
        </button>`).join("")}
    </div>

    <div class="funnel-bar" title="Your pipeline at a glance">
      ${STAGES.map((s) => { const n = count(s.id); return n ? `<i class="fb--${s.id}" style="flex:${n}" title="${s.label}: ${n}"></i>` : ""; }).join("")}
    </div>

    <div class="tablewrap">
      <table>
        <thead><tr><th>Person</th><th>Company</th><th>Ask</th><th>Status</th><th>Opens</th><th>Last activity</th><th></th></tr></thead>
        <tbody>
          ${rows.map((o) => { const c = contact(o.contactId); const act = STAGE_ACTIONS[o.stage]; return `
            <tr data-id="${c.id}">
              <td><div class="cell-who">${av(c, 32)}<div><strong>${c.name}</strong><small>${c.role}</small></div></div></td>
              <td><div class="cell-co">${logo(c, 26)}<span>${c.company}</span></div></td>
              <td>${askChip(c.type)}</td>
              <td>${statusDot(o.stage)}</td>
              <td class="cell-mono">${o.opens || "·"}</td>
              <td><div class="cell-mono">${o.lastTouch}</div>${o.note ? `<div class="cell-note">${o.note}</div>` : ""}</td>
              <td><button class="btn btn--paper btn--sm act-stage">${act.label}</button></td>
            </tr>`; }).join("")}
          ${rows.length === 0 ? `<tr><td colspan="7"><div class="empty" style="height:110px">Nothing here yet. Go knock on something.</div></td></tr>` : ""}
        </tbody>
      </table>
    </div>
  </div>`;

  $$(".ftab", view).forEach((b) =>
    b.addEventListener("click", () => { state.trackerTab = b.dataset.id; renderTracker(); }));
  $$(".act-stage", view).forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = e.target.closest("tr").dataset.id;
      const o = state.outreach.find((x) => x.contactId === id);
      STAGE_ACTIONS[o.stage].run(contact(id), o);
    }));
}

/* ============================================================
   PROFILE
   ============================================================ */
function renderProfile() {
  const user = window.knockAuth?.user || {};
  const profileName = user.name || PROFILE.name;
  const profileEmail = user.email || PROFILE.email;
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>This is who Scout <em>sounds like.</em></h1>
    <p>Everything below was pulled from your resume + questionnaire. Edit anything; every future draft updates instantly.</p></div>
    <div class="profile-grid">
      <div>
        <div class="pcard idcard">
          <span class="avatar">${state.profilePhoto ? `<img src="${state.profilePhoto}" alt="">` : PROFILE.initials}</span>
          <h2>${profileName}</h2>
          <div class="sub">${profileEmail}<br>${PROFILE.school}<br>${PROFILE.degree} · Class of ${PROFILE.gradYear}</div>
          <div class="photo-actions">
            <label class="btn btn--paper btn--sm" for="profile-photo">Add profile picture</label>
            ${state.profilePhoto ? '<button class="btn btn--paper btn--sm" id="remove-photo">Remove</button>' : ""}
            <input id="profile-photo" type="file" accept="image/*">
          </div>
          <div class="traits">${PROFILE.traits.map((t) => `<span class="trait">${t}</span>`).join("")}</div>
          <div class="voicebox">
            <b>Writing voice</b>: tone <b>${PROFILE.voice.tone}</b> · length <b>${PROFILE.voice.length}</b> · sign-off <b>${PROFILE.voice.signoff}</b>
          </div>
        </div>
        <div class="pcard">
          <h3>Resume <button class="edit" id="re-upload">Re-upload</button></h3>
          <div class="dropzone is-filled">${icon("doc")} Aaron_Johnson_Resume.pdf · parsed<br><small>17 facts extracted · last synced today</small></div>
        </div>
      </div>
      <div>
        <div class="pcard">
          <h3>Your story <button class="edit" data-edit="story">Edit</button></h3>
          <p class="story" id="story-text">“${PROFILE.story}”</p>
        </div>
        <div class="pcard">
          <h3>Experience</h3>
          <div class="xp">
            ${PROFILE.experience.map((x) => `
              <div class="xp__item"><strong>${x.role}</strong>
                <span class="when">${x.org} · ${x.when}</span>
                <ul>${x.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>
              </div>`).join("")}
          </div>
        </div>
        <div class="pcard">
          <h3>Skills</h3>
          <div class="skills">${PROFILE.skills.map((s) => `<span>${s}</span>`).join("")}</div>
        </div>
      </div>
    </div>
  </div>`;

  $('[data-edit="story"]', view)?.addEventListener("click", () => {
    const el = $("#story-text", view);
    el.contentEditable = true; el.focus();
    toast("Editing. Click anywhere outside to save");
    el.addEventListener("blur", () => {
      el.contentEditable = false;
      PROFILE.story = el.textContent.replace(/[“”]/g, "");
      toast("Saved. Scout's drafts now use the new story");
    }, { once: true });
  });
  $("#profile-photo", view)?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.profilePhoto = reader.result;
      localStorage.setItem("knock_profile_photo", state.profilePhoto);
      toast("Profile picture saved");
      renderProfile();
      updateChrome();
    };
    reader.readAsDataURL(file);
  });
  $("#remove-photo", view)?.addEventListener("click", () => {
    state.profilePhoto = "";
    localStorage.removeItem("knock_profile_photo");
    toast("Profile picture removed");
    renderProfile();
    updateChrome();
  });
  $("#re-upload", view)?.addEventListener("click", () =>
    toast("Drop a new PDF anytime. Parsing takes ~20 seconds"));
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings() {
  const user = window.knockAuth?.user || { email: "dev@knock.local", name: "Dev mode" };
  const isDev = (window.knockAuth?.mode || "dev") === "dev";
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Settings</h1><p>How Scout behaves in other people's inboxes.</p></div>
    <div class="settings-grid">
      <div class="pcard">
        <h3>Account</h3>
        <div class="setrow"><span class="ico">${I.story}</span><div><strong>${user.name || user.email}</strong><small>${user.email}${isDev ? " · dev mode (configure Supabase for real auth)" : ""}</small></div>
          ${isDev ? "" : '<button class="btn btn--paper btn--sm end" id="set-logout">Log out</button>'}</div>
        <div class="setrow"><span class="ico">${I.plug}</span><div><strong>Apollo sourcing</strong><small id="apollo-status">checking…</small></div></div>
      </div>
      <div class="pcard">
        <h3>Agent autonomy</h3>
        <div class="setrow"><span class="ico">${I.search}</span><div><strong>Review before sending</strong><small>Every draft waits for your approval</small></div>
          <label class="switch end"><input type="checkbox" data-k="review" ${state.autonomy.review ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.bell}</span><div><strong>Follow-up autopilot</strong><small>Up to 2 polite nudges, timed to their reading hours</small></div>
          <label class="switch end"><input type="checkbox" data-k="followups" ${state.autonomy.followups ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.cal}</span><div><strong>Weekend sends</strong><small>Off. Replies are 40% lower on weekends</small></div>
          <label class="switch end"><input type="checkbox" data-k="weekends" ${state.autonomy.weekends ? "checked" : ""}><i></i></label></div>
      </div>
      <div class="pcard">
        <h3>Connections</h3>
        <div class="setrow"><span class="ico">${I.mail}</span><div><strong>Gmail</strong><small>${state.connections.gmail ? "Connected · sends from your real address" : "Not connected — campaigns stay queued until you connect"}</small></div>
          ${state.connections.gmail ? '<span class="connected end">Connected</span>' : '<button class="btn btn--sm end" id="set-gmail">Connect</button>'}</div>
        <div class="setrow"><span class="ico">${I.cal}</span><div><strong>Google Calendar</strong><small>${state.connections.gcal ? "Connected · auto-offers your free slots" : "Not connected"}</small></div>
          ${state.connections.gcal ? '<span class="connected end">Connected</span>' : '<button class="btn btn--paper btn--sm end" id="set-gcal">Connect</button>'}</div>
        <div class="setrow"><span class="ico">${I.plug}</span><div><strong>All channels</strong><small>Outlook, LinkedIn and more</small></div>
          <button class="btn btn--paper btn--sm end" id="set-connections">Manage</button></div>
      </div>
      <div class="pcard">
        <h3>Plan &amp; billing</h3>
        <div class="setrow"><span class="ico">${I.cap}</span><div><strong>Student. Free</strong><small>${state.knocks} of 15 knocks left this month</small></div>
          <button class="btn btn--sm end" id="set-upgrade">Go Pro</button></div>
        <div class="setrow"><span class="ico">${I.bell}</span><div><strong>Daily digest</strong><small>One email: new matches + warm threads</small></div>
          <label class="switch end"><input type="checkbox" checked><i></i></label></div>
        <div class="setrow"><span class="ico">${I.chat}</span><div><strong>Feedback</strong><small>Tell us what to build next</small></div>
          <button class="btn btn--paper btn--sm end" id="set-feedback">Send</button></div>
      </div>
    </div>
  </div>`;

  $$('.switch input', view).forEach((sw) =>
    sw.addEventListener("change", () => {
      if (sw.dataset.k) state.autonomy[sw.dataset.k] = sw.checked;
      toast(sw.checked ? "On" : "Off");
    }));
  $("#set-upgrade", view)?.addEventListener("click", openUpgrade);
  $("#set-feedback", view)?.addEventListener("click", openFeedback);
  $("#set-connections", view)?.addEventListener("click", openConnections);
  $("#set-logout", view)?.addEventListener("click", () => window.knockAuth.signOut());
  $("#set-gmail", view)?.addEventListener("click", () =>
    toast("Gmail OAuth (send scopes) is the next build step — separate from Google login"));
  $("#set-gcal", view)?.addEventListener("click", () =>
    toast("Google Calendar connect is coming with the Gmail integration"));
  fetch("/api/test-apollo").then((r) => r.json()).then((d) => {
    const el = $("#apollo-status", view);
    if (el) el.textContent = d.apolloConfigured
      ? "Server configured — live sourcing on"
      : "Mock mode — set APOLLO_API_KEY in .env.local for live sourcing";
  }).catch(() => {
    const el = $("#apollo-status", view);
    if (el) el.textContent = "API offline — run `node server.js` for live sourcing";
  });
}

/* ============================================================
   AGENT DRAWER
   ============================================================ */
const drawer = $("#drawer"), scrim = $("#drawer-scrim");

function closeDrawer() { drawer.hidden = true; scrim.hidden = true; }
$("#drawer-close").addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);

function openAgent(c) {
  if (state.knocks <= 0) return openUpgrade();
  drawer.hidden = false; scrim.hidden = false;

  $("#drawer-who").innerHTML = `${av(c, 38)}<div><strong>${c.name}</strong><small>${c.role} · ${c.company} · ${askLabel[c.type]}</small></div>`;

  const steps = agentScript(c);
  const body = $("#drawer-body");
  body.innerHTML = `
    <div class="agent-steps">
      ${steps.map((s, i) => `
        <div class="astep" data-i="${i}">
          <span class="ico">${I[s.icon] || ""}</span>
          <div><strong>${s.label}</strong><small>${s.detail}</small></div>
        </div>`).join("")}
    </div>
    <div id="draft-slot"></div>`;

  let i = 0;
  (function step() {
    const els = $$(".astep", body);
    if (i > 0) { els[i - 1].classList.remove("is-live"); els[i - 1].classList.add("is-done"); els[i - 1].querySelector(".ico").innerHTML = "✓"; }
    if (i >= steps.length) return showDraft(c);
    els[i].classList.add("is-live");
    setTimeout(step, steps[i++].ms);
  })();
}

function showDraft(c) {
  const d = draftEmail(c);
  const slot = $("#draft-slot");
  slot.innerHTML = `
    <div class="draft">
      <div class="draft__bar"><span>To: ${c.email}</span><span style="margin-left:auto">from aaron@uci.edu</span></div>
      <div class="draft__body">
        <p class="draft__subject">Subj: <span id="d-subj"></span><span class="caret" id="d-caret"></span></p>
        <p class="draft__text" id="d-body"></p>
      </div>
      <div class="draft__meta"><span>Reply likelihood: <b>High</b></span><span>Send at 9:41 AM their time</span></div>
    </div>
    <div class="fplan">
      <h4>If no reply, Scout will…</h4>
      <ul>
        <li><b>Day 3</b> Nudge with one new proof point (the $70K save)</li>
        <li><b>Day 7</b> Final, shorter note. Different angle: ${c.why[2] || c.why[0]}</li>
        <li><b>Then</b> Stop. Never pesters. Flags the next-best door instead.</li>
      </ul>
    </div>
    <div class="drawer__actions">
      <button class="btn btn--ghost" id="d-edit">Edit</button>
      <button class="btn btn--ghost" id="d-regen">Regenerate</button>
      <button class="btn btn--accent" id="d-send" disabled>Approve &amp; send</button>
    </div>`;
  slot.scrollIntoView({ behavior: "smooth", block: "end" });

  typeInto($("#d-subj"), d.subject, 22, () =>
    typeInto($("#d-body"), d.body, 6, () => {
      $("#d-caret").remove();
      $("#d-send").disabled = false;
    }));

  $("#d-edit").addEventListener("click", () => {
    const el = $("#d-body");
    el.contentEditable = true; el.focus();
    toast("Every word is yours. Edit away");
  });
  $("#d-regen").addEventListener("click", () => { toast("Rewriting with a different hook…"); openAgent(c); });
  $("#d-send").addEventListener("click", () => sendKnock(c));
}

function sendKnock(c) {
  state.knocks = Math.max(0, state.knocks - 1); saveKnocks();
  state.stats.sent++;
  const existing = state.outreach.find((o) => o.contactId === c.id);
  if (existing) { existing.stage = "sent"; existing.lastTouch = "just now"; existing.note = null; }
  else state.outreach.unshift({ contactId: c.id, stage: "sent", lastTouch: "just now", opens: 0, note: null });
  updateChrome();

  $("#drawer-body").innerHTML = `
    <div class="sentstamp">
      <span class="big">${I.plane}</span>
      <h3>Knock delivered.</h3>
      <p>Scout is watching ${c.name.split(" ")[0]}'s inbox. You'll hear the moment it opens.</p>
    </div>
    <div class="drawer__actions">
      <a class="btn btn--ghost" href="#tracker" id="d-track">View in tracker</a>
      <a class="btn" href="#people" id="d-next">Next door →</a>
    </div>`;
  $("#d-track").addEventListener("click", closeDrawer);
  $("#d-next").addEventListener("click", closeDrawer);
  toast(`Sent to <b>${c.name}</b>. ${state.knocks} knocks left`);

  setTimeout(() => {
    const o = state.outreach.find((x) => x.contactId === c.id);
    if (o && o.stage === "sent") { o.stage = "opened"; o.opens = 1; o.lastTouch = "just now"; }
    toast(`<b>${c.name.split(" ")[0]}</b> opened your email`);
    if (!$("#view .viewwrap")) return; navigate();
  }, 9000);

  setTimeout(() => {
    const o = state.outreach.find((x) => x.contactId === c.id);
    if (o) { o.stage = "replied"; o.opens = (o.opens || 1) + 1; o.lastTouch = "just now"; o.note = "“" + (SIM_REPLIES[c.id] || SIM_REPLIES.default).slice(0, 60) + "…”"; }
    state.stats.replies++;
    state.threads.unshift({
      contactId: c.id, unread: true, warm: true, when: "Just now",
      subject: `Re: ${draftEmail(c).subject}`,
      messages: [
        { from: "you", time: "Earlier today", text: draftEmail(c).body },
        { from: "them", time: "Just now", text: SIM_REPLIES[c.id] || SIM_REPLIES.default },
      ],
    });
    updateChrome();
    toast(`<b>${c.name}</b> replied. Warm thread in your inbox`, 5000);
    navigate();
  }, 19000);
}

function typeInto(el, text, speed, done) {
  let i = 0;
  (function tick() {
    el.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(tick, speed + Math.random() * speed * 0.6);
    else done && done();
  })();
}

/* ============================================================
   MODALS
   ============================================================ */
const modalScrim = $("#modal-scrim"), modal = $("#modal");
function openModal(html) { modal.innerHTML = html; modalScrim.hidden = false; }
function closeModal() { modalScrim.hidden = true; }
modalScrim.addEventListener("click", (e) => { if (e.target === modalScrim) closeModal(); });

function openFeedback() {
  openModal(`
    <h2>Help us build Knock</h2>
    <p class="sub">Goes straight to the founders. We reply to everything.</p>
    <div class="chips-select">
      ${["Bug report", "Feature request", "UX feedback", "Pricing", "Other"].map((c, i) => `<button class="pill ${i === 1 ? "is-on" : ""}">${c}</button>`).join("")}
    </div>
    <label>Tell us more</label>
    <textarea rows="4" placeholder="What should Scout learn to do next?"></textarea>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="m-cancel">Cancel</button>
      <button class="btn" id="m-send">Send feedback</button>
    </div>`);
  $$(".pill", modal).forEach((p) => p.addEventListener("click", () => { $$(".pill", modal).forEach((x) => x.classList.remove("is-on")); p.classList.add("is-on"); }));
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-send").addEventListener("click", () => { closeModal(); toast("Got it. Thank you, we read every one"); });
}
$("#feedback-btn").addEventListener("click", openFeedback);

function openUpgrade() {
  openModal(`
    <h2>Out of knocks? <em style="color:var(--accent-deep)">Never.</em></h2>
    <p class="sub">Pro removes the cap and turns on follow-up autopilot + inbox warm-up.</p>
    <div class="pcard" style="display:flex;align-items:center;gap:1rem">
      <div style="font-size:2.4rem;font-weight:900">$19<span style="font-size:1rem;color:var(--ink-soft);font-weight:700">/mo</span></div>
      <div style="font-size:.82rem;color:var(--ink-soft);font-weight:500">Unlimited knocks · autopilot follow-ups<br>priority people data · warm-threads inbox</div>
    </div>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="m-cancel">Not yet</button>
      <button class="btn btn--accent" id="m-go">Go Pro →</button>
    </div>`);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-go").addEventListener("click", () => { closeModal(); toast("This is the MVP. Payments land next sprint"); });
}
$("#upgrade-btn").addEventListener("click", openUpgrade);

/* ---- onboarding: builds a real profile that powers sourcing ---- */
const OB = JSON.parse(localStorage.getItem("knock_ob_draft") || "{}");

/* deterministic extraction — Claude parsing replaces this later */
function extractProfileFacts(text) {
  const wins = [];
  const winRe = /[^.\n]*(?:\$\s?\d[\d,.]*\s?[KkMmBb]?|\d{1,3}\s?%|\b\d[\d,]*\+?\s+(?:users|customers|members|sales|clients|downloads|followers))[^.\n]*/g;
  let m;
  while ((m = winRe.exec(text)) && wins.length < 5) {
    const w = m[0].trim();
    if (w.length > 10 && w.length < 160) wins.push(w);
  }
  const schoolMatch = text.match(/\b(UC\s?Irvine|UCI|UCLA|USC|Berkeley|Stanford|[A-Z][a-z]+ University)\b/);
  return { wins, school: schoolMatch ? schoolMatch[0].replace(/^UCI$/, "UC Irvine") : null };
}

const PEOPLE_TO_MODE = {
  Founders: "founders", "Co-founders": "founders",
  "Hiring managers": "hiring_managers", Recruiters: "hiring_managers",
  Partners: "investors", Principals: "investors", Associates: "investors",
  Operators: "operators", "Chiefs of staff": "operators",
};

function openOnboarding(step = 1) {
  const bars = (n) => `<div class="obsteps">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`;
  const chips = (list, selected, cls = "") =>
    `<div class="chips-select ${cls}">${list.map((t) => `<button class="pill ${selected.includes(t) ? "is-on" : ""}" data-v="${t}">${t}</button>`).join("")}</div>`;
  const readChips = (cls) => $$(`.${cls} .pill.is-on`, modal).map((p) => p.dataset.v);

  if (step === 1) {
    openModal(`${bars(1)}
      <h2>Drop your resume so Knock can find your strongest hooks.</h2>
      <p class="sub">Paste your resume or LinkedIn summary — Scout pulls the wins that make people reply.</p>
      <textarea id="ob-resume" rows="6" placeholder="Paste your resume or LinkedIn summary here…">${OB.resumeText || ""}</textarea>
      <label>Your story in a sentence or two</label>
      <textarea id="ob-story" rows="2" placeholder="e.g. Built a $400K e-commerce business in high school. Strategy student. I outwork everyone.">${OB.story || PROFILE.story}</textarea>
      <div class="modal__actions"><button class="btn" id="ob-next">Continue →</button></div>`);
    $("#ob-next").addEventListener("click", () => {
      OB.resumeText = $("#ob-resume").value;
      OB.story = $("#ob-story").value || PROFILE.story;
      localStorage.setItem("knock_ob_draft", JSON.stringify(OB));
      openOnboarding(2);
    });
  } else if (step === 2) {
    openModal(`${bars(2)}
      <h2>Tell Knock what kind of doors you want opened.</h2>
      <p class="sub">Pick your target path and the people you want to reach.</p>
      <label>Target path</label>
      ${chips(["Private Equity", "Venture Capital", "Startups", "Consulting", "Product", "Operations", "Founder network", "Recruiting / internships"], OB.industries || ["Startups"], "ob-ind")}
      <label>People to reach</label>
      ${chips(["Founders", "Co-founders", "Hiring managers", "Recruiters", "Partners", "Principals", "Operators", "Chiefs of staff"], OB.targetRoles || ["Founders"], "ob-roles")}
      <div class="modal__actions"><button class="btn" id="ob-next">Continue →</button></div>`);
    $$(".pill", modal).forEach((p) => p.addEventListener("click", () => p.classList.toggle("is-on")));
    $("#ob-next").addEventListener("click", () => {
      OB.industries = readChips("ob-ind");
      OB.targetRoles = readChips("ob-roles");
      localStorage.setItem("knock_ob_draft", JSON.stringify(OB));
      openOnboarding(3);
    });
  } else {
    openModal(`${bars(3)}
      <h2>Almost there.</h2>
      <p class="sub">Where, and how you want to sound. We'll build your first queue automatically.</p>
      <label>Location preference</label>
      ${chips(["San Francisco", "New York", "Los Angeles", "Boston", "Chicago", "Remote", "Any"], OB.locations || ["San Francisco", "Remote"], "ob-loc")}
      <label>Tone</label>
      ${chips(["Casual", "Sharp", "Polished", "Founder-like"], OB.tone ? [OB.tone] : ["Sharp"], "ob-tone")}
      <div class="modal__actions"><button class="btn btn--accent" id="ob-done">Build my profile →</button></div>`);
    $$(".ob-loc .pill", modal).forEach((p) => p.addEventListener("click", () => p.classList.toggle("is-on")));
    $$(".ob-tone .pill", modal).forEach((p) => p.addEventListener("click", () => {
      $$(".ob-tone .pill", modal).forEach((x) => x.classList.toggle("is-on", x === p));
    }));
    $("#ob-done").addEventListener("click", () => {
      OB.locations = readChips("ob-loc");
      OB.tone = readChips("ob-tone")[0] || "Sharp";
      const facts = extractProfileFacts(`${OB.resumeText || ""} ${OB.story || ""}`);
      const profile = {
        fullName: window.knockAuth?.user?.name || PROFILE.name,
        email: window.knockAuth?.user?.email || "",
        school: facts.school || PROFILE.school || "UC Irvine",
        story: OB.story || PROFILE.story,
        resumeText: OB.resumeText || "",
        target: (OB.targetRoles || []).join(", ") || "founders and operators",
        goals: ["founder mentorship", "startup roles", "internship opportunities"],
        industries: OB.industries || ["Startups"],
        targetRoles: OB.targetRoles || ["Founders"],
        locations: OB.locations || ["Any"],
        tone: OB.tone,
        quantifiedWins: facts.wins,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem("knock_profile", JSON.stringify(profile));
      state.searchMode = PEOPLE_TO_MODE[(OB.targetRoles || [])[0]] || "founders";
      localStorage.setItem("knock_search_mode", state.searchMode);
      localStorage.setItem("knock_onboarded", "1");
      localStorage.removeItem("knock_ob_draft");
      closeModal();
      toast(`Profile built${facts.wins.length ? `, ${facts.wins.length} quantified win${facts.wins.length === 1 ? "" : "s"} extracted` : ""}. Building your first queue now`);
      navigate();
    });
  }
}

/* ---------------- global search ---------------- */
$("#global-search").addEventListener("input", (e) => {
  state.filters.q = e.target.value.toLowerCase();
  if (location.hash !== "#people") location.hash = "people";
  else renderPeople();
});

$("#top-logout")?.addEventListener("click", () => window.knockAuth?.signOut?.());

document.addEventListener("knock:auth", () => {
  updateChrome();
  if ((location.hash.replace("#", "") || "dashboard") === "dashboard") renderDashboard();
});

/* ---------------- boot ---------------- */
navigate();
if (!localStorage.getItem("knock_onboarded")) openOnboarding(1);
