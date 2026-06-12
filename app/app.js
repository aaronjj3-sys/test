/* ============================================================
   Knock app, SPA logic
   Fresh-account experience: everything starts empty and fills up
   as the user onboards, sources doors, and queues campaigns.
   Views: dashboard · find people · inbox · tracker · profile · settings
   ============================================================ */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");

/* ---------------- storage ---------------- */
const load = (k, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? "null");
    return v === null ? fallback : v;
  } catch { return fallback; }
};
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

/* one-time migration: clear demo-era data so accounts start fresh */
if (localStorage.getItem("knock_v") !== "2") {
  Object.keys(localStorage)
    .filter((k) => k.startsWith("knock_") && k !== "knock_dev_session")
    .forEach((k) => localStorage.removeItem(k));
  localStorage.setItem("knock_v", "2");
}

/* ---------------- state ---------------- */
const PAGE_SIZE = 25;
const state = {
  profile: load("knock_profile", null),
  doors: load("knock_doors", null),
  doorsMeta: load("knock_doors_meta", null),
  campaigns: load("knock_campaigns", []),
  messages: load("knock_messages", []),
  connections: load("knock_connections", { google: false, outlook: false, linkedin: false }),
  autonomy: load("knock_autonomy", { review: true, followups: true, weekends: false, digest: true }),
  knocks: load("knock_left", 15),
  searchMode: load("knock_search_mode", "founders"),
  searchFilters: load("knock_filters", { keywords: [], industries: [], locations: [], companies: [] }),
  sendPrefs: load("knock_send_prefs", null),
  doorsPage: 0,
  selectedDoors: new Set(),
  trackerTab: "all",
  sourcing: false,
};
state.connections = {
  google: Boolean(state.connections.google || state.connections.gmail || state.connections.gcal),
  outlook: Boolean(state.connections.outlook),
  linkedin: Boolean(state.connections.linkedin),
};
save("knock_connections", state.connections);
const saveLive = () => {
  save("knock_doors", state.doors);
  save("knock_doors_meta", state.doorsMeta);
  save("knock_campaigns", state.campaigns);
  save("knock_messages", state.messages);
  save("knock_left", state.knocks);
};
const doorById = (id) => (state.doors || []).find((d) => d.id === id);

/* ---------------- icons (inline SVG, currentColor) ---------------- */
const I = {
  search: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  story: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm14 8H3v10h18zM3 8h18V6H3z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 9h4v12H2zM9 9h3.8v1.7h.1A4.2 4.2 0 0 1 16.6 9C20.6 9 21 11.6 21 15v6h-4v-5.3c0-1.3 0-2.9-1.8-2.9S13 14.2 13 15.6V21H9z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-4.5-5.8V4.5a1.5 1.5 0 0 0-3 0v.7A6 6 0 0 0 6 11v5l-2 2v1h16v-1z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>',
  cap: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 1 9l11 6 9-4.9V17h2V9zM5 13.2V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-3.8l-7 3.8z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 7V3.5L18.5 9z"/></svg>',
  plane: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3v7l15 2-15 2z"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 7V3h-2v4h-4V3H8v4H6v6a5 5 0 0 0 4 4.9V21h4v-3.1A5 5 0 0 0 18 13V7z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.1 6.1L20 10l-5.9 1.9L12 18l-2.1-6.1L4 10l5.9-1.9z"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>',
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

/* company logo pulled from the web, with lettermark fallback */
const logo = (company, domain, size = 28) =>
  `<span class="co-logo" style="width:${size}px;height:${size}px"><b>${(company || "?")[0]}</b>${domain ? `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const firstName = () => (state.profile?.fullName || window.knockAuth?.user?.name || "there").split(" ")[0];
const googleConnected = () => Boolean(state.connections.google);

function saveConnections() {
  save("knock_connections", state.connections);
}

/* Starts an OAuth connect flow and returns the user to the view they were
   on (inbox, dashboard, settings...) when the provider redirects back. */
function connectProvider(provider) {
  const user = window.knockAuth?.user || {};
  if ((window.knockAuth?.mode || "dev") !== "supabase" || !user.id || user.id === "dev") {
    toast(`Connect ${provider === "google" ? "Google" : "LinkedIn"} requires Supabase login. Configure Supabase, log in, then try again`);
    return;
  }
  const params = new URLSearchParams({
    user_id: user.id,
    user_email: user.email || "",
    return_to: `${location.pathname || "/app/index.html"}${location.hash || "#dashboard"}`,
  });
  location.href = `/api/${provider}/connect?${params.toString()}`;
}
const connectGoogle = () => connectProvider("google");
const connectLinkedIn = () => connectProvider("linkedin");

function handleConnectReturn() {
  const url = new URL(location.href);
  let touched = false;
  for (const provider of ["google", "linkedin"]) {
    const connected = url.searchParams.get(provider) === "connected";
    const error = url.searchParams.get(`${provider}_error`);
    if (connected) {
      state.connections[provider] = true;
      saveConnections();
      toast(`${provider === "google" ? "Google" : "LinkedIn"} connected`);
    } else if (error) {
      toast(`${provider === "google" ? "Google" : "LinkedIn"} connect failed: ${esc(error)}`);
    }
    touched = touched || connected || Boolean(error);
  }
  if (touched) {
    history.replaceState(null, "", `${location.pathname}${location.hash || "#dashboard"}`);
  }
}

/* Server is the source of truth for connections: sync on boot so the UI
   shows what's actually connected, on every page and every device. */
async function syncConnections() {
  const user = window.knockAuth?.user;
  if (!user?.id || user.id === "dev") return;
  try {
    const res = await fetch(`/api/connections/status?user_id=${encodeURIComponent(user.id)}`);
    const data = await res.json();
    if (!data.persisted) return;
    let changed = false;
    for (const provider of ["google", "linkedin", "outlook"]) {
      const isConnected = Boolean(data.connections[provider]?.connected);
      if (state.connections[provider] !== isConnected) {
        state.connections[provider] = isConnected;
        changed = true;
      }
    }
    if (changed) { saveConnections(); navigate(); }
  } catch { /* offline or dev server without Supabase; keep local state */ }
}

async function disconnectProvider(provider) {
  const user = window.knockAuth?.user || {};
  state.connections[provider] = false;
  saveConnections();
  try {
    await fetch("/api/connections/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, provider }),
    });
  } catch { /* local state already cleared */ }
  toast(`${provider === "google" ? "Google" : provider === "linkedin" ? "LinkedIn" : "Outlook"} disconnected`);
  navigate();
}

/* ---------------- streak (real, based on days you actually showed up) ---------------- */
function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function bumpStreak() {
  const days = load("knock_days", []);
  const today = localDay(new Date());
  if (!days.includes(today)) { days.push(today); save("knock_days", days); }
  let streak = 0;
  const d = new Date();
  while (days.includes(localDay(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}

function updateChrome() {
  $("#knocks-left").textContent = state.knocks;
  $("#knocks-bar").style.width = Math.max(0, Math.min(100, (state.knocks / 15) * 100)) + "%";
  const badge = $("#inbox-badge");
  badge.hidden = true;
  const streak = bumpStreak();
  $("#streak").innerHTML = `<i></i>${streak}-day streak`;
}

/* ============================================================
   ROUTER
   ============================================================ */
/* "people" stays as a route alias: Find People merged into the dashboard */
const routes = { dashboard: renderDashboard, people: renderDashboard, inbox: renderInbox, tracker: renderTracker, profile: renderProfile, settings: renderSettings };

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
   DASHBOARD: profile gate → auto-sourcing → paginated doors queue
   ============================================================ */
function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Late night";
  if (h < 12) return "Morning";
  if (h < 18) return "Afternoon";
  return "Evening";
}

const SEARCH_MODES_UI = [
  ["founders", "Founders"], ["hiring_managers", "Hiring managers"],
  ["investors", "Investors"], ["operators", "Operators"],
];
const modeLabel = (id) => (SEARCH_MODES_UI.find(([m]) => m === id) || [, "Founders"])[1];

function renderDashboard() {
  if (!state.profile) return renderNeedsProfile();
  if (state.sourcing) {
    /* a pass is in flight; show progress without restarting it */
    view.innerHTML = `<div class="viewwrap"><div class="ghost">
      <div class="ghost__icon ghost__icon--spin">${I.spark}</div>
      <h2>Scout is sourcing…</h2>
      <p>Hang tight, your queue is on its way.</p>
    </div></div>`;
    return;
  }
  if (!state.doors || state.doors.length === 0) return runSourcing();
  renderDoorsQueue();
}

function renderNeedsProfile() {
  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${greeting()}, ${firstName()}.</h1>
      <p>Two minutes of setup and Scout starts finding your people.</p>
    </div>
    <div class="ghost">
      <div class="ghost__icon">${I.story}</div>
      <h2>Build your profile first</h2>
      <p>Scout needs your story before it can find doors worth knocking on.</p>
      <button class="btn btn--accent" id="start-ob">Build my profile</button>
    </div>
  </div>`;
  $("#start-ob", view).addEventListener("click", () => openOnboarding(1));
}

async function runSourcing() {
  if (state.sourcing) return;
  state.sourcing = true;
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
      body: JSON.stringify({ profile: state.profile, searchMode: state.searchMode, filters: state.searchFilters, limit: 100 }),
    });
    const data = await res.json();
    clearInterval(ticker);
    state.sourcing = false;
    if (!res.ok) throw new Error(data.error || "Sourcing failed");
    state.doors = data.doors;
    state.doorsMeta = data.meta;
    state.doorsPage = 0;
    state.selectedDoors = new Set();
    saveLive();
    toast(`${data.doors.length} doors found${data.doors[0]?.source === "mock" ? " (demo data, Apollo key not configured)" : ""}`);
    if ((location.hash.replace("#", "") || "dashboard") === "dashboard") renderDoorsQueue();
    else navigate();
  } catch (err) {
    clearInterval(ticker);
    state.sourcing = false;
    view.innerHTML = `<div class="viewwrap"><div class="ghost">
      <div class="ghost__icon">${I.bell}</div>
      <h2>Sourcing hit a snag</h2>
      <p>${esc(err.message)}. If you're running locally, start the dev server with <code>npm run dev</code> so the API routes are live.</p>
      <button class="btn btn--accent" id="retry-doors">Try again</button>
    </div></div>`;
    $("#retry-doors", view).addEventListener("click", runSourcing);
  }
}

function doorRow(d, queuedIds) {
  return `
    <tr data-id="${d.id}" class="${queuedIds.has(d.id) ? "is-queued" : ""}">
      <td>${queuedIds.has(d.id)
        ? '<span class="st st--sent"><i></i>queued</span>'
        : `<input type="checkbox" class="door-check" data-id="${d.id}" ${state.selectedDoors.has(d.id) ? "checked" : ""}>`}</td>
      <td><div class="cell-who"><div><strong>${esc(d.name)}</strong><small>${esc(d.title || "")}${d.location ? " · " + esc(d.location) : ""}</small></div></div></td>
      <td>${d.companyName ? `<div class="cell-co">${logo(d.companyName, d.companyDomain, 24)}<span>${esc(d.companyName)}</span></div>` : "·"}</td>
      <td>${ring(d.matchScore, 40)}</td>
      <td><div class="reasons">${(d.matchReasons || []).slice(0, 3).map((r) => `<span>${esc(r)}</span>`).join("")}</div></td>
      <td class="cell-draft"><b>${esc(d.draft?.subject || "")}</b><small>${esc((d.draft?.preview || "").slice(0, 90))}…</small></td>
      <td class="cell-links">${d.linkedinUrl ? `<a href="${esc(d.linkedinUrl)}" target="_blank" rel="noopener" title="LinkedIn">${I.linkedin}</a>` : ""}
          <button class="btn btn--paper btn--sm act-review" data-id="${d.id}">Review knock</button></td>
    </tr>`;
}

function pager(total, page, idPrefix) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return "";
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return `<div class="pager" id="${idPrefix}-pager">
    <span class="pager__hint">Showing ${from}–${to} of ${total}</span>
    <button class="btn btn--paper btn--sm" data-p="${page - 1}" ${page === 0 ? "disabled" : ""}>← Prev</button>
    ${Array.from({ length: pages }, (_, i) =>
      `<button class="pager__num ${i === page ? "is-on" : ""}" data-p="${i}">${i + 1}</button>`).join("")}
    <button class="btn btn--paper btn--sm" data-p="${page + 1}" ${page >= pages - 1 ? "disabled" : ""}>Next →</button>
  </div>`;
}

/* ---- search filters: what Apollo lets us slice on, right from the dashboard ---- */
const FILTER_KINDS = {
  industry: { label: "Industry", bucket: "industries" },
  location: { label: "Location", bucket: "locations" },
  company: { label: "Company", bucket: "companies" },
  keyword: { label: "Keyword", bucket: "keywords" },
};
const SUGGEST_LOCATIONS = ["San Francisco", "New York", "Los Angeles", "Boston", "Chicago", "Austin", "Seattle", "Denver", "Miami", "Washington DC", "Remote", "London", "Toronto"];

const saveFilters = () => save("knock_filters", state.searchFilters);
const activeFilterChips = () =>
  Object.entries(FILTER_KINDS).flatMap(([kind, cfg]) =>
    (state.searchFilters[cfg.bucket] || []).map((v) => ({ kind, label: cfg.label, value: v })));

function addFilter(kind, value) {
  const bucket = FILTER_KINDS[kind].bucket;
  const v = value.trim();
  if (!v) return false;
  state.searchFilters[bucket] = state.searchFilters[bucket] || [];
  if (state.searchFilters[bucket].some((x) => x.toLowerCase() === v.toLowerCase())) return false;
  state.searchFilters[bucket].push(v);
  saveFilters();
  return true;
}

function removeFilter(kind, value) {
  const bucket = FILTER_KINDS[kind].bucket;
  state.searchFilters[bucket] = (state.searchFilters[bucket] || []).filter((x) => x !== value);
  saveFilters();
}

function filterSuggestions(q) {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out = [];
  for (const opt of OB_PATHS) {
    if (opt.toLowerCase().includes(needle)) out.push({ kind: "industry", value: opt });
    if (out.length >= 4) break;
  }
  for (const opt of SUGGEST_LOCATIONS) {
    if (opt.toLowerCase().includes(needle)) out.push({ kind: "location", value: opt });
    if (out.length >= 7) break;
  }
  out.push({ kind: "company", value: q.trim() });
  out.push({ kind: "keyword", value: q.trim() });
  return out.slice(0, 9);
}

function filterBar() {
  const chips = activeFilterChips();
  return `<div class="filterbar" id="filterbar">
    ${chips.map((c) => `
      <span class="fchip" data-kind="${c.kind}" data-value="${esc(c.value)}">
        <small>${c.label}</small>${esc(c.value)}<button class="fchip__x" title="Remove">&times;</button>
      </span>`).join("")}
    <div class="filterbar__input">
      <input id="filter-input" type="text" placeholder="${chips.length ? "Add another filter…" : "Filter by industry, location, company…"}" autocomplete="off">
      <div class="fsuggest" id="fsuggest" hidden></div>
    </div>
    <button class="btn btn--accent btn--sm" id="filter-apply">Search</button>
    ${chips.length ? `<button class="filterbar__clear" id="filter-clear">Clear all</button>` : ""}
  </div>`;
}

function wireFilterBar() {
  const bar = $("#filterbar", view);
  if (!bar) return;
  const input = $("#filter-input", bar);
  const sug = $("#fsuggest", bar);

  const applySearch = () => { location.hash = "dashboard"; runSourcing(); };

  const renderSuggestions = () => {
    const items = filterSuggestions(input.value);
    sug.hidden = items.length === 0;
    sug.innerHTML = items.map((s, i) => `
      <button class="fsuggest__item ${i === 0 ? "is-hot" : ""}" data-kind="${s.kind}" data-value="${esc(s.value)}">
        <small>${FILTER_KINDS[s.kind].label}</small>${esc(s.value)}
      </button>`).join("");
    $$(".fsuggest__item", sug).forEach((b) => b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (addFilter(b.dataset.kind, b.dataset.value)) applySearch();
    }));
  };

  input.addEventListener("input", renderSuggestions);
  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("blur", () => setTimeout(() => { sug.hidden = true; }, 150));
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = $(".fsuggest__item.is-hot", sug);
    const kind = first && !sug.hidden ? first.dataset.kind : "keyword";
    const value = first && !sug.hidden ? first.dataset.value : input.value;
    if (addFilter(kind, value)) applySearch();
  });
  $("#filter-apply", bar).addEventListener("click", () => {
    if (input.value.trim()) addFilter("keyword", input.value);
    applySearch();
  });
  $("#filter-clear", bar)?.addEventListener("click", () => {
    state.searchFilters = { keywords: [], industries: [], locations: [], companies: [] };
    saveFilters();
    applySearch();
  });
  $$(".fchip__x", bar).forEach((x) => x.addEventListener("click", (e) => {
    const chip = e.target.closest(".fchip");
    removeFilter(chip.dataset.kind, chip.dataset.value);
    applySearch();
  }));
}

function renderDoorsQueue() {
  const doors = state.doors;
  const meta = state.doorsMeta || {};
  const isMock = doors[0]?.source === "mock";
  const queued = state.campaigns.length > 0;
  const campaign = state.campaigns[state.campaigns.length - 1];
  const queuedIds = new Set(state.campaigns.flatMap((c) => c.selectedDoorIds));
  const page = Math.min(state.doorsPage, Math.ceil(doors.length / PAGE_SIZE) - 1);
  const slice = doors.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const avgMatch = Math.round(doors.reduce((s, d) => s + (d.matchScore || 0), 0) / doors.length);

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${greeting()}, ${firstName()}. ${isMock ? '<span class="badge badge--hiring">demo data</span>' : ""}</h1>
      <p>Scout found ${doors.length} doors matched to your profile. Select the ones you want, review the drafts, then launch.</p>
    </div>

    <div class="statgrid">
      <div class="statcard"><small>Doors found</small><div class="num">${doors.length}</div><span class="delta">searching as ${modeLabel(state.searchMode)}</span></div>
      <div class="statcard"><small>Average match</small><div class="num">${avgMatch}%</div><span class="delta">scored against your story</span></div>
      <div class="statcard"><small>Knocks queued</small><div class="num">${state.messages.length}</div><span class="delta">${googleConnected() ? "ready to send" : "waiting on Google"}</span></div>
      <div class="statcard"><small>Knocks left</small><div class="num">${state.knocks}</div><span class="delta">free plan · resets monthly</span></div>
    </div>

    ${queued ? `
    <div class="qbanner">
      <div>${I.plane}</div>
      <div>
        <b>Campaign queued · ${campaign.selectedDoorIds.length} knock${campaign.selectedDoorIds.length === 1 ? "" : "s"}</b>
        <p>${googleConnected()
          ? "Google is connected. Sending engine wiring is the next build step; manage the queue in the tracker."
          : "Connect Gmail and Calendar to send emails, detect replies, and schedule meetings."}</p>
      </div>
      ${googleConnected()
        ? `<a class="btn btn--paper btn--sm" href="#tracker">Open tracker</a>`
        : `<button class="btn btn--paper btn--sm" id="q-google">Connect Google</button>`}
    </div>` : ""}

    <div class="rowhead">
      <h2>Your launch queue</h2>
      <span class="rowhead__hint">${meta.searchedPeople || doors.length} people searched · ${meta.creditsLikelyUsed ? "credits used" : "no Apollo credits used"}</span>
      <div class="rowhead__actions">
        ${SEARCH_MODES_UI.map(([id, label]) =>
          `<button class="pill ${state.searchMode === id ? "is-on" : ""}" data-mode="${id}">${label}</button>`).join("")}
        <button class="btn btn--sm" id="launch" disabled>Approve &amp; launch</button>
      </div>
    </div>
    ${filterBar()}
    <div class="tablewrap"><table class="doors-table">
      <thead><tr><th><input type="checkbox" id="check-page" title="Select everyone on this page"></th><th>Person</th><th>Company</th><th>Match</th><th>Why</th><th>Draft</th><th></th></tr></thead>
      <tbody>${slice.map((d) => doorRow(d, queuedIds)).join("")}</tbody>
    </table></div>
    ${pager(doors.length, page, "doors")}
    ${(meta.warnings || []).map((w) => `<p class="meta-warn">${esc(w)}</p>`).join("")}
  </div>`;

  wireDoorsTable(slice, queuedIds);
  wireFilterBar();

  $$(".rowhead .pill", view).forEach((p) => p.addEventListener("click", () => {
    state.searchMode = p.dataset.mode;
    save("knock_search_mode", state.searchMode);
    runSourcing();
  }));
  $("#q-google", view)?.addEventListener("click", connectGoogle);
  $("#doors-pager", view)?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (!b || b.disabled) return;
    state.doorsPage = +b.dataset.p;
    renderDoorsQueue();
  });
  const pageCheck = $("#check-page", view);
  pageCheck?.addEventListener("change", () => {
    slice.forEach((d) => {
      if (queuedIds.has(d.id)) return;
      pageCheck.checked ? state.selectedDoors.add(d.id) : state.selectedDoors.delete(d.id);
    });
    renderDoorsQueue();
  });
}

function wireDoorsTable(slice, queuedIds) {
  const launch = $("#launch", view);
  const syncLaunch = () => {
    if (!launch) return;
    launch.disabled = state.selectedDoors.size === 0;
    launch.textContent = state.selectedDoors.size
      ? `Approve & launch (${state.selectedDoors.size})` : "Approve & launch";
  };
  syncLaunch();
  $$(".door-check", view).forEach((cb) => cb.addEventListener("change", () => {
    cb.checked ? state.selectedDoors.add(cb.dataset.id) : state.selectedDoors.delete(cb.dataset.id);
    syncLaunch();
  }));
  $$(".act-review", view).forEach((b) => b.addEventListener("click", () => {
    const d = doorById(b.dataset.id);
    if (d) openDoorDraft(d);
  }));
  launch?.addEventListener("click", launchCampaign);
}

function openDoorDraft(d) {
  openModal(`
    <h2 style="font-size:1.2rem">${esc(d.draft?.subject || "Draft")}</h2>
    <p class="sub">To ${esc(d.name)} · ${esc(d.title || "")}${d.companyName ? " at " + esc(d.companyName) : ""}</p>
    <div class="pcard" style="white-space:pre-wrap;font-size:.88rem;line-height:1.55" contenteditable="true" id="dd-body">${esc(d.draft?.body || d.draft?.preview || "")}</div>
    <p class="connlist__fine">Edit the draft directly. Your changes are saved when you close.</p>
    <div class="modal__actions">
      <button class="btn btn--paper" id="dd-close">Close</button>
      <button class="btn btn--accent" id="dd-select">${state.selectedDoors.has(d.id) ? "Selected ✓" : "Select for campaign"}</button>
    </div>`);
  const persist = () => {
    const text = $("#dd-body").innerText.trim();
    if (text && text !== d.draft?.body) { d.draft = { ...(d.draft || {}), body: text }; saveLive(); }
  };
  $("#dd-close").addEventListener("click", () => { persist(); closeModal(); });
  $("#dd-select").addEventListener("click", () => {
    persist();
    state.selectedDoors.add(d.id);
    closeModal();
    navigate();
  });
}

/* ---- sending preferences: asked once, on the first launch ---- */
function openSendPrefs(onDone) {
  const prefs = state.sendPrefs || { mode: "review", channel: "gmail", attachResume: false };
  const channelRow = (id, name, hint, available) => `
    <button type="button" class="pill sp-channel ${prefs.channel === id ? "is-on" : ""}" data-v="${id}" ${available ? "" : 'data-off="1"'}>
      ${name}${available ? "" : " · not connected"}
    </button>`;
  openModal(`
    <h2>How should Knock send for you?</h2>
    <p class="sub">Set it once; change it anytime in Settings.</p>
    <label>Sending mode</label>
    <div class="chips-select chips-select--stack sp-mode">
      <button type="button" class="pill ${prefs.mode === "review" ? "is-on" : ""}" data-v="review"><b>Review every send</b> · you approve, edit, and add attachments before anything goes out</button>
      <button type="button" class="pill ${prefs.mode === "auto" ? "is-on" : ""}" data-v="auto"><b>Fully automated</b> · Scout sends and follows up on its own, at their reading hours</button>
    </div>
    <label>Channel</label>
    <div class="chips-select sp-chan">
      ${channelRow("gmail", "Gmail", "", googleConnected())}
      ${channelRow("linkedin", "LinkedIn", "", Boolean(state.connections.linkedin))}
      ${channelRow("queue", "Hold in queue", "", true)}
    </div>
    ${googleConnected() ? "" : `<p class="connlist__fine">Gmail isn't connected yet. Knocks stay safely queued until you connect it in Settings.</p>`}
    <label>Attachments</label>
    <div class="setrow" style="border:none;padding:.3rem 0">
      <div><strong>Attach my resume</strong><small>Adds your resume to every first knock</small></div>
      <label class="switch end"><input type="checkbox" id="sp-resume" ${prefs.attachResume ? "checked" : ""}><i></i></label>
    </div>
    <div class="modal__actions">
      <button class="btn btn--accent" id="sp-save">Save &amp; continue</button>
    </div>`);
  wireChips("sp-mode", { single: true });
  $$(".sp-chan .pill", modal).forEach((p) => p.addEventListener("click", () => {
    if (p.dataset.off) { toast(`${p.dataset.v === "gmail" ? "Gmail" : "LinkedIn"} isn't connected yet. Connect it in Settings first`); return; }
    $$(".sp-chan .pill", modal).forEach((x) => x.classList.toggle("is-on", x === p));
  }));
  $("#sp-save").addEventListener("click", () => {
    state.sendPrefs = {
      mode: $(".sp-mode .pill.is-on", modal)?.dataset.v || "review",
      channel: $(".sp-chan .pill.is-on", modal)?.dataset.v || "queue",
      attachResume: $("#sp-resume").checked,
    };
    save("knock_send_prefs", state.sendPrefs);
    closeModal();
    toast("Sending preferences saved");
    onDone && onDone();
  });
}

async function launchCampaign() {
  const selected = (state.doors || []).filter((d) => state.selectedDoors.has(d.id));
  if (!selected.length) return;
  if (selected.length > state.knocks) {
    toast(`You have ${state.knocks} knock${state.knocks === 1 ? "" : "s"} left this month. Deselect a few or upgrade.`);
    return;
  }
  /* first send: let them choose automation level, channel, attachments */
  if (!state.sendPrefs) return openSendPrefs(launchCampaign);
  try {
    const res = await fetch("/api/campaigns/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doors: selected }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not queue campaign");
    state.campaigns.push(data.campaign);
    for (const m of data.messages || []) {
      const d = doorById(m.doorId);
      state.messages.push({ ...m, name: d?.name, title: d?.title, company: d?.companyName, companyDomain: d?.companyDomain });
    }
    state.knocks = Math.max(0, state.knocks - selected.length);
    state.selectedDoors = new Set();
    saveLive();
    toast("Campaign queued. Connect Google to send from your own inbox");
    navigate();
  } catch (err) {
    toast(`Launch failed: ${esc(err.message)}`);
  }
}

/* ============================================================
   INBOX (+ Connections hub)
   ============================================================ */
const CONNECTIONS = [
  { id: "google", icn: "mail", name: "Google", sub: "Connect Gmail and Calendar to send emails, detect replies, and schedule meetings." },
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
          <div><strong>${c.name}</strong><small>${state.connections[c.id] ? "Connected · " : ""}${c.sub}</small></div>
          ${state.connections[c.id]
            ? `<button class="btn btn--paper btn--sm end act-disconnect">Disconnect</button>`
            : `<button class="btn btn--sm end act-connect">${c.id === "google" ? "Connect Google" : "Connect"}</button>`}
        </div>`).join("")}
    </div>
    <p class="connlist__fine">Google connects Gmail and Calendar. LinkedIn connects your identity for DMs and connection notes.</p>
    <div class="modal__actions"><button class="btn btn--ghost" id="m-close">Done</button></div>`);
  const setConn = (id, val) => {
    state.connections[id] = val;
    saveConnections();
    toast(`${CONNECTIONS.find((c) => c.id === id).name} ${val ? "connected" : "disconnected"}`);
    openConnections();
  };
  $$(".act-connect", modal).forEach((b) =>
    b.addEventListener("click", (e) => {
      const id = e.target.closest(".connrow").dataset.id;
      if (id === "google") return connectGoogle();
      if (id === "linkedin") return connectLinkedIn();
      setConn(id, true);
    }));
  $$(".act-disconnect", modal).forEach((b) =>
    b.addEventListener("click", (e) => {
      const id = e.target.closest(".connrow").dataset.id;
      closeModal();
      if (id === "google" || id === "linkedin") return disconnectProvider(id);
      setConn(id, false);
    }));
  $("#m-close", modal).addEventListener("click", closeModal);
}

function renderInbox() {
  view.innerHTML = `<div class="viewwrap">
    <div class="vh vh--row">
      <div>
        <h1>Inbox. <em>Warm threads first.</em></h1>
        <p>Scout tracks every reply and flags the doors that are opening.</p>
      </div>
      <button class="btn btn--paper" id="connections-btn">${icon("plug")} Connections</button>
    </div>
    <div class="ghost">
      <div class="ghost__icon">${I.mail}</div>
      <h2>No threads yet</h2>
      <p>${state.messages.length
        ? googleConnected()
          ? `Google is connected and ${state.messages.length} knock${state.messages.length === 1 ? " is" : "s are"} queued. When replies come in, every thread shows up here, warmest first.`
          : `You have ${state.messages.length} knock${state.messages.length === 1 ? "" : "s"} queued. Connect Gmail and Calendar to send emails, detect replies, and schedule meetings.`
        : "Launch your first campaign from the dashboard. When people reply, every thread shows up here, warmest first."}</p>
      <button class="btn btn--accent" id="inbox-cta">${state.messages.length && !googleConnected() ? "Connect Google" : state.messages.length ? "View the tracker" : "Go to dashboard"}</button>
    </div>
  </div>`;
  $("#connections-btn", view).addEventListener("click", openConnections);
  $("#inbox-cta", view).addEventListener("click", () => {
    if (state.messages.length && !googleConnected()) connectGoogle();
    else if (state.messages.length) location.hash = "tracker";
    else location.hash = "dashboard";
  });
}

/* ============================================================
   TRACKER
   ============================================================ */
const STAGES = [
  { id: "queued", label: "Queued", hint: "Waiting on Google" },
  { id: "sent", label: "Sent", hint: "Knocked, waiting" },
  { id: "opened", label: "Opened", hint: "They're reading" },
  { id: "replied", label: "Replied", hint: "Door is open" },
  { id: "meeting", label: "Meeting booked", hint: "Go win" },
];

function messageActions(m) {
  if (m.status === "queued") return `
    <button class="btn btn--paper btn--sm msg-pause" data-id="${m.id}">Pause</button>
    <button class="btn btn--paper btn--sm msg-cancel" data-id="${m.id}">Cancel</button>`;
  if (m.status === "paused") return `
    <button class="btn btn--sm msg-resume" data-id="${m.id}">Resume</button>
    <button class="btn btn--paper btn--sm msg-cancel" data-id="${m.id}">Cancel</button>`;
  return "";
}

function renderTracker() {
  const tabs = [{ id: "all", label: "All" }, ...STAGES];
  const count = (id) => (id === "all" ? state.messages.length : state.messages.filter((m) => m.status === id).length);
  const active = state.trackerTab;
  const rows = state.messages.filter((m) => active === "all" || m.status === active ||
    (active === "queued" && m.status === "paused"));
  const funnelCounts = STAGES.map((s) => ({ ...s, n: s.id === "queued" ? count("queued") + count("paused") : count(s.id) }));
  const funnelTotal = funnelCounts.reduce((sum, s) => sum + s.n, 0);

  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Every door, <em>one funnel.</em></h1>
    <p>Where each knock stands. Scout keeps the follow-ups moving so you only act on the doors that open.</p></div>

    <div class="funnel-tabs">
      ${tabs.map((s) => `
        <button class="ftab ${active === s.id ? "is-on" : ""}" data-id="${s.id}">
          <b>${s.id === "queued" ? count("queued") + count("paused") : count(s.id)}</b><span>${s.label}</span>
        </button>`).join("")}
    </div>

    ${funnelTotal ? `
    <div class="funnel-bar" title="Your pipeline at a glance">
      ${funnelCounts.map((s) => s.n ? `<i class="fb--${s.id}" style="flex:${s.n}" title="${s.label}: ${s.n}"></i>` : "").join("")}
    </div>` : ""}

    ${state.messages.length ? `
    <div class="tablewrap">
      <table>
        <thead><tr><th>Person</th><th>Company</th><th>Subject</th><th>Status</th><th>Queued</th><th></th></tr></thead>
        <tbody>
          ${rows.map((m) => `
            <tr>
              <td><div class="cell-who"><div><strong>${esc(m.name || "Unknown")}</strong><small>${esc(m.title || "")}</small></div></div></td>
              <td>${m.company ? `<div class="cell-co">${logo(m.company, m.companyDomain, 26)}<span>${esc(m.company)}</span></div>` : "·"}</td>
              <td class="cell-draft"><b>${esc(m.subject)}</b></td>
              <td><span class="st st--${m.status === "queued" || m.status === "paused" ? "drafted" : m.status}"><i></i>${m.status}</span></td>
              <td class="cell-mono">${new Date(m.createdAt).toLocaleDateString()}</td>
              <td class="cell-msgact">${messageActions(m)}</td>
            </tr>`).join("")}
          ${rows.length === 0 ? `<tr><td colspan="6"><div class="empty" style="height:110px">Nothing in this stage yet.</div></td></tr>` : ""}
        </tbody>
      </table>
    </div>` : `
    <div class="ghost">
      <div class="ghost__icon">${I.plane}</div>
      <h2>Nothing tracked yet</h2>
      <p>Approve a few doors on the dashboard and launch your first campaign. Every knock lands here.</p>
      <button class="btn btn--accent" id="tr-cta">Go to dashboard</button>
    </div>`}
  </div>`;

  $$(".ftab", view).forEach((b) =>
    b.addEventListener("click", () => { state.trackerTab = b.dataset.id; renderTracker(); }));
  $("#tr-cta", view)?.addEventListener("click", () => { location.hash = "dashboard"; });
  const findMsg = (id) => state.messages.find((m) => m.id === id);
  $$(".msg-pause", view).forEach((b) => b.addEventListener("click", () => {
    const m = findMsg(b.dataset.id);
    if (m) { m.status = "paused"; saveLive(); toast("Paused. This knock won't send until you resume it"); renderTracker(); }
  }));
  $$(".msg-resume", view).forEach((b) => b.addEventListener("click", () => {
    const m = findMsg(b.dataset.id);
    if (m) { m.status = "queued"; saveLive(); toast("Back in the queue"); renderTracker(); }
  }));
  $$(".msg-cancel", view).forEach((b) => b.addEventListener("click", () => {
    const m = findMsg(b.dataset.id);
    if (!m) return;
    state.messages = state.messages.filter((x) => x.id !== m.id);
    for (const c of state.campaigns) {
      c.selectedDoorIds = (c.selectedDoorIds || []).filter((id) => id !== m.doorId);
    }
    state.campaigns = state.campaigns.filter((c) => (c.selectedDoorIds || []).length > 0);
    state.knocks = Math.min(15, state.knocks + 1);
    saveLive();
    toast("Canceled. That knock is back in your pocket");
    renderTracker();
    updateChrome();
  }));
}

/* ============================================================
   PROFILE (everything editable)
   ============================================================ */
function saveProfile() {
  state.profile.updatedAt = new Date().toISOString();
  save("knock_profile", state.profile);
}

function renderProfile() {
  if (!state.profile) return renderNeedsProfile();
  const p = state.profile;
  const initials = (p.fullName || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";

  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>This is who Scout <em>sounds like.</em></h1>
    <p>Everything below powers your drafts. Edit anything; every future draft updates instantly.</p></div>
    <div class="profile-grid">
      <div class="profile-col">
        <div class="pcard idcard">
          <span class="avatar">${initials}</span>
          <h2>${esc(p.fullName || "Add your name")}</h2>
          <div class="sub">
            ${[p.school, p.degree, p.gradYear ? "Class of " + esc(p.gradYear) : null].filter(Boolean).map(esc).join("<br>") || "Add your school and major"}
            ${p.location ? `<br>${esc(p.location)}` : ""}
            ${p.currentRole ? `<br>${esc(p.currentRole)}` : ""}
          </div>
          <button class="btn btn--paper btn--sm" id="edit-id">Edit details</button>
          <div class="traits">${(p.traits || []).map((t) => `<span class="trait">${esc(t)}</span>`).join("")}</div>
          <div class="voicebox">
            <b>Writing voice</b>: tone <b>${esc(p.tone || "Sharp")}</b> · sign-off <b>${esc(p.signoff || "- " + firstName())}</b>
            <button class="edit" id="edit-voice">Edit</button>
          </div>
        </div>
        <div class="pcard">
          <h3>Resume <button class="edit" id="re-upload">Re-upload</button></h3>
          <div class="dropzone ${p.resumeFileName ? "is-filled" : ""}" id="resume-zone">
            ${p.resumeFileName
              ? `${icon("doc")} ${esc(p.resumeFileName)}<br><small>${(p.quantifiedWins || []).length} quantified win${(p.quantifiedWins || []).length === 1 ? "" : "s"} extracted</small>`
              : `${icon("doc")} Drop your resume here`}
          </div>
          <input type="file" id="resume-file" accept=".pdf,.doc,.docx,.txt,.md" hidden>
        </div>
      </div>
      <div class="profile-col">
        <div class="pcard">
          <h3>Your story <button class="edit" data-edit="story">Edit</button></h3>
          <p class="story" id="story-text">${p.story ? `“${esc(p.story)}”` : "Add the one or two sentences that make people reply."}</p>
        </div>
        <div class="pcard">
          <h3>Experience <button class="edit" id="xp-add">+ Add</button></h3>
          <div class="xp">
            ${(p.experience || []).map((x, i) => `
              <div class="xp__item" data-i="${i}">
                <strong>${esc(x.role)}</strong>
                <span class="when">${esc(x.org)}${x.when ? " · " + esc(x.when) : ""}</span>
                <ul>${(x.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
                <div class="xp__actions"><button class="edit xp-edit" data-i="${i}">Edit</button><button class="edit xp-del" data-i="${i}">Remove</button></div>
              </div>`).join("")}
            ${(p.experience || []).length === 0 ? `<p class="empty-line">No experience added yet. Add the roles and wins you want Scout to lead with.</p>` : ""}
          </div>
        </div>
        <div class="pcard">
          <h3>Skills</h3>
          <div class="skills" id="skills">
            ${(p.skills || []).map((s, i) => `<span>${esc(s)}<button class="chip-x" data-i="${i}" title="Remove">&times;</button></span>`).join("")}
            <input type="text" id="skill-add" placeholder="+ add a skill" />
          </div>
        </div>
        <div class="pcard profile-extra">
          <h3>Anything else Scout should know</h3>
          <textarea id="extra-ctx" rows="5" placeholder="Side projects, clubs, the things you nerd out about, who you most want to meet…">${esc(p.extraContext || "")}</textarea>
          <div class="modal__actions"><button class="btn btn--sm" id="ctx-save">Save</button></div>
        </div>
      </div>
    </div>
  </div>`;

  /* identity */
  $("#edit-id", view).addEventListener("click", () => {
    openModal(`
      <h2>Your details</h2>
      <label>Full name</label><input type="text" id="f-name" value="${esc(p.fullName || "")}" placeholder="Jordan Rivers">
      <label>School</label><input type="text" id="f-school" value="${esc(p.school || "")}" placeholder="UC Irvine, Paul Merage School of Business">
      <label>Degree / major</label><input type="text" id="f-degree" value="${esc(p.degree || "")}" placeholder="B.A. Business Administration">
      <label>Graduation year</label><input type="text" id="f-grad" value="${esc(p.gradYear || "")}" placeholder="2027">
      <label>City</label><input type="text" id="f-loc" value="${esc(p.location || "")}" placeholder="San Diego, CA">
      <label>Current role (if any)</label><input type="text" id="f-role" value="${esc(p.currentRole || "")}" placeholder="Founder @ JCommerce">
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Cancel</button>
        <button class="btn btn--accent" id="m-save">Save</button>
      </div>`);
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-save").addEventListener("click", () => {
      p.fullName = $("#f-name").value.trim();
      p.school = $("#f-school").value.trim();
      p.degree = $("#f-degree").value.trim();
      p.gradYear = $("#f-grad").value.trim();
      p.location = $("#f-loc").value.trim();
      p.currentRole = $("#f-role").value.trim();
      saveProfile(); closeModal(); renderProfile(); initAccount();
      toast("Saved. Scout's drafts now use your new details");
    });
  });

  /* voice */
  $("#edit-voice", view).addEventListener("click", () => {
    const tones = ["Casual", "Sharp", "Polished", "Founder-like", "Direct & warm"];
    openModal(`
      <h2>Writing voice</h2>
      <label>Tone</label>
      <div class="chips-select ob-tone">${tones.map((t) => `<button class="pill ${p.tone === t ? "is-on" : ""}" data-v="${t}">${t}</button>`).join("")}</div>
      <label>Sign-off</label><input type="text" id="f-signoff" value="${esc(p.signoff || "")}" placeholder="- ${esc(firstName())}">
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Cancel</button>
        <button class="btn btn--accent" id="m-save">Save</button>
      </div>`);
    $$(".ob-tone .pill", modal).forEach((b) => b.addEventListener("click", () => {
      $$(".ob-tone .pill", modal).forEach((x) => x.classList.toggle("is-on", x === b));
    }));
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-save").addEventListener("click", () => {
      p.tone = $(".ob-tone .pill.is-on", modal)?.dataset.v || p.tone;
      p.signoff = $("#f-signoff").value.trim() || p.signoff;
      saveProfile(); closeModal(); renderProfile();
      toast("Voice updated");
    });
  });

  /* story inline edit */
  $('[data-edit="story"]', view).addEventListener("click", () => {
    const el = $("#story-text", view);
    el.textContent = p.story || "";
    el.contentEditable = true; el.focus();
    toast("Editing. Click anywhere outside to save");
    el.addEventListener("blur", () => {
      el.contentEditable = false;
      p.story = el.textContent.replace(/[“”]/g, "").trim();
      saveProfile(); renderProfile();
      toast("Saved. Scout's drafts now use the new story");
    }, { once: true });
  });

  /* experience add/edit/remove */
  const xpModal = (x = { role: "", org: "", when: "", bullets: [] }, idx = -1) => {
    openModal(`
      <h2>${idx >= 0 ? "Edit" : "Add"} experience</h2>
      <label>Role / title</label><input type="text" id="x-role" value="${esc(x.role)}" placeholder="Revenue Operations Consultant">
      <label>Company / org</label><input type="text" id="x-org" value="${esc(x.org)}" placeholder="IntegriTurf">
      <label>Years</label><input type="text" id="x-when" value="${esc(x.when)}" placeholder="2024 · 2025">
      <label>Highlights (one per line)</label>
      <textarea id="x-bullets" rows="4" placeholder="Saved a client $70K by automating their rev-ops stack">${esc((x.bullets || []).join("\n"))}</textarea>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Cancel</button>
        <button class="btn btn--accent" id="m-save">Save</button>
      </div>`);
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-save").addEventListener("click", () => {
      const item = {
        role: $("#x-role").value.trim(),
        org: $("#x-org").value.trim(),
        when: $("#x-when").value.trim(),
        bullets: $("#x-bullets").value.split("\n").map((b) => b.trim()).filter(Boolean),
      };
      if (!item.role && !item.org) { closeModal(); return; }
      p.experience = p.experience || [];
      if (idx >= 0) p.experience[idx] = item; else p.experience.push(item);
      saveProfile(); closeModal(); renderProfile();
      toast("Experience saved");
    });
  };
  $("#xp-add", view).addEventListener("click", () => xpModal());
  $$(".xp-edit", view).forEach((b) => b.addEventListener("click", () => xpModal(p.experience[+b.dataset.i], +b.dataset.i)));
  $$(".xp-del", view).forEach((b) => b.addEventListener("click", () => {
    p.experience.splice(+b.dataset.i, 1);
    saveProfile(); renderProfile();
    toast("Removed");
  }));

  /* skills */
  $$("#skills .chip-x", view).forEach((b) => b.addEventListener("click", () => {
    p.skills.splice(+b.dataset.i, 1);
    saveProfile(); renderProfile();
  }));
  $("#skill-add", view).addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = e.target.value.trim();
    if (!v) return;
    p.skills = p.skills || [];
    if (!p.skills.includes(v)) p.skills.push(v);
    saveProfile(); renderProfile();
  });

  /* extra context */
  $("#ctx-save", view).addEventListener("click", () => {
    p.extraContext = $("#extra-ctx", view).value.trim();
    saveProfile();
    toast("Saved");
  });

  /* resume re-upload */
  const fileInput = $("#resume-file", view);
  $("#re-upload", view).addEventListener("click", () => fileInput.click());
  $("#resume-zone", view).addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files[0];
    if (!f) return;
    const text = await readFileText(f);
    p.resumeFileName = f.name;
    if (text) {
      p.resumeText = text;
      const facts = extractProfileFacts(text + " " + (p.story || ""));
      p.quantifiedWins = facts.wins;
      if (!p.school && facts.school) p.school = facts.school;
      p.skills = [...new Set([...(p.skills || []), ...facts.skills])];
    }
    saveProfile(); renderProfile();
    toast("Resume updated");
  });
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings() {
  const user = window.knockAuth?.user || { email: "dev@knock.local", name: "Dev" };
  const isDev = (window.knockAuth?.mode || "dev") === "dev";
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Settings</h1><p>How Scout behaves in other people's inboxes.</p></div>
    <div class="settings-grid">
      <div class="pcard">
        <h3>Account</h3>
        <div class="setrow"><span class="ico">${I.story}</span><div><strong>${esc(user.name || user.email)}</strong><small>${esc(user.email)}${isDev ? " · dev login (configure Supabase for real auth)" : ""}</small></div>
          <button class="btn btn--paper btn--sm end" id="set-logout">Log out</button></div>
        <div class="setrow"><span class="ico">${I.plug}</span><div><strong>Apollo sourcing</strong><small id="apollo-status">checking…</small></div></div>
        <div class="setrow"><span class="ico">${I.pen}</span><div><strong>Reset my data</strong><small>Clears your profile, doors, and campaigns on this device</small></div>
          <button class="btn btn--paper btn--sm end" id="set-reset">Reset</button></div>
      </div>
      <div class="pcard">
        <h3>Agent autonomy</h3>
        <div class="setrow"><span class="ico">${I.search}</span><div><strong>Review before sending</strong><small>Every draft waits for your approval</small></div>
          <label class="switch end"><input type="checkbox" data-k="review" ${state.autonomy.review ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.bell}</span><div><strong>Follow-up autopilot</strong><small>Up to 2 polite nudges, timed to their reading hours</small></div>
          <label class="switch end"><input type="checkbox" data-k="followups" ${state.autonomy.followups ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.cal}</span><div><strong>Weekend sends</strong><small>Off by default. Replies are 40% lower on weekends</small></div>
          <label class="switch end"><input type="checkbox" data-k="weekends" ${state.autonomy.weekends ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.plane}</span><div><strong>Sending preferences</strong><small>${state.sendPrefs
          ? `${state.sendPrefs.mode === "auto" ? "Fully automated" : "Review every send"} · via ${state.sendPrefs.channel === "gmail" ? "Gmail" : state.sendPrefs.channel === "linkedin" ? "LinkedIn" : "queue"}`
          : "Mode, channel, and attachments for your knocks"}</small></div>
          <button class="btn btn--paper btn--sm end" id="set-sendprefs">Edit</button></div>
      </div>
      <div class="pcard">
        <h3>Connections</h3>
        ${[
          ["google", "mail", "Google", "Connect Gmail and Calendar to send emails, detect replies, and schedule meetings."],
          ["linkedin", "linkedin", "LinkedIn", "DMs and connection notes, same voice"],
        ].map(([id, icn, name, sub]) => `
        <div class="setrow"><span class="ico">${I[icn]}</span><div><strong>${name}</strong><small>${state.connections[id] ? "Connected · " + sub : "Not connected. " + sub[0].toUpperCase() + sub.slice(1)}</small></div>
          ${state.connections[id]
            ? `<button class="btn btn--paper btn--sm end conn-off" data-id="${id}">Disconnect</button>`
            : `<button class="btn btn--sm end conn-on" data-id="${id}">${id === "google" ? "Connect Google" : "Connect"}</button>`}</div>`).join("")}
        <div class="setrow"><span class="ico">${I.plug}</span><div><strong>All channels</strong><small>Outlook and more</small></div>
          <button class="btn btn--paper btn--sm end" id="set-connections">Manage</button></div>
      </div>
      <div class="pcard">
        <h3>Plan &amp; billing</h3>
        <div class="setrow"><span class="ico">${I.cap}</span><div><strong>Student · Free</strong><small>${state.knocks} of 15 knocks left this month</small></div>
          <button class="btn btn--sm end" id="set-upgrade">Go Pro</button></div>
        <div class="setrow"><span class="ico">${I.bell}</span><div><strong>Daily digest</strong><small>One email: new matches + warm threads</small></div>
          <label class="switch end"><input type="checkbox" data-k="digest" ${state.autonomy.digest ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.chat}</span><div><strong>Feedback</strong><small>Tell us what to build next</small></div>
          <button class="btn btn--paper btn--sm end" id="set-feedback">Send</button></div>
      </div>
    </div>
  </div>`;

  $$('.switch input', view).forEach((sw) =>
    sw.addEventListener("change", () => {
      if (sw.dataset.k) { state.autonomy[sw.dataset.k] = sw.checked; save("knock_autonomy", state.autonomy); }
      toast(sw.checked ? "On" : "Off");
    }));
  $("#set-upgrade", view).addEventListener("click", openUpgrade);
  $("#set-sendprefs", view).addEventListener("click", () => openSendPrefs(renderSettings));
  $("#set-feedback", view).addEventListener("click", openFeedback);
  $("#set-connections", view).addEventListener("click", openConnections);
  $("#set-logout", view).addEventListener("click", () => window.knockAuth.signOut());
  $("#set-reset", view).addEventListener("click", () => {
    openModal(`
      <h2>Reset your data?</h2>
      <p class="sub">This clears your profile, sourced doors, and queued campaigns from this device. There is no undo.</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Keep my data</button>
        <button class="btn" id="m-reset">Yes, reset</button>
      </div>`);
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-reset").addEventListener("click", () => {
      ["knock_profile", "knock_doors", "knock_doors_meta", "knock_campaigns", "knock_messages",
       "knock_connections", "knock_autonomy", "knock_left", "knock_search_mode", "knock_ob_draft", "knock_days",
       "knock_filters", "knock_send_prefs", "knock_tour_done"]
        .forEach((k) => localStorage.removeItem(k));
      location.reload();
    });
  });
  $$(".conn-on", view).forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.id === "google") return connectGoogle();
    if (b.dataset.id === "linkedin") return connectLinkedIn();
  }));
  $$(".conn-off", view).forEach((b) => b.addEventListener("click", () => disconnectProvider(b.dataset.id)));

  fetch("/api/test-apollo").then((r) => r.json()).then((d) => {
    const el = $("#apollo-status", view);
    if (el) el.textContent = d.apolloConfigured
      ? "Server configured · live sourcing on"
      : "Mock mode · set APOLLO_API_KEY in .env.local for live sourcing";
  }).catch(() => {
    const el = $("#apollo-status", view);
    if (el) el.textContent = "API offline · run `npm run dev` for live sourcing";
  });
}

/* ============================================================
   MODALS
   ============================================================ */
const modalScrim = $("#modal-scrim"), modal = $("#modal");
function openModal(html, locked = false) {
  modal.innerHTML = html;
  modalScrim.hidden = false;
  modalScrim.dataset.locked = locked ? "1" : "";
}
function closeModal() { modalScrim.hidden = true; }
modalScrim.addEventListener("click", (e) => {
  if (e.target === modalScrim && !modalScrim.dataset.locked) closeModal();
});

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

/* ============================================================
   ONBOARDING: builds the real profile that powers sourcing
   ============================================================ */
const OB_STEPS = 5;
const OB = load("knock_ob_draft", {});
const saveOB = () => save("knock_ob_draft", OB);

const OB_PATHS = [
  "Startups", "Venture Capital", "Private Equity", "Consulting", "Investment Banking", "Product", "Engineering", "Marketing",
  "Design", "Operations", "Real Estate", "Healthcare", "Law & Policy", "Media & Entertainment", "Sports", "Energy & Climate",
  "Defense & Aerospace", "AI & ML", "Crypto & Web3", "Nonprofit & Education", "Retail & CPG", "Hardware & Robotics",
];
const OB_PEOPLE = [
  "Founders", "Co-founders", "Hiring managers", "Recruiters", "C-suite execs", "VPs", "Directors", "Partners (VC / PE)",
  "Principals", "Associates", "Operators", "Chiefs of staff", "Product managers", "Engineering managers", "Alumni", "Angel investors",
];
const OB_LOCATIONS = ["San Francisco", "New York", "Los Angeles", "Boston", "Chicago", "Austin", "Seattle", "Remote", "Any"];
const OB_TONES = ["Casual", "Sharp", "Polished", "Founder-like", "Direct & warm"];
const OB_LINES = [
  "I'll figure it out before you finish explaining it",
  "Give me the hardest problem on the board",
  "I make people feel like they've known me for years",
  "Quietly excellent, loudly reliable",
];
const OB_STYLES = ["Ships fast", "Detail-obsessed", "Big-picture thinker", "Team-first", "Self-starter", "Allergic to average"];

const PEOPLE_TO_MODE = {
  "Founders": "founders", "Co-founders": "founders", "C-suite execs": "founders", "Angel investors": "investors",
  "Hiring managers": "hiring_managers", "Recruiters": "hiring_managers",
  "Partners (VC / PE)": "investors", "Principals": "investors", "Associates": "investors",
  "Operators": "operators", "Chiefs of staff": "operators", "VPs": "operators", "Directors": "operators",
  "Product managers": "operators", "Engineering managers": "operators", "Alumni": "operators",
};

const COMMON_SKILLS = ["Excel", "SQL", "Python", "JavaScript", "Tableau", "Power BI", "PowerPoint", "Airtable", "Figma", "PitchBook", "R", "Notion", "HubSpot", "Salesforce"];

/* client-side fuzzy school match: prefer the resume's spelling when the
   typed value is clearly the same school (typos, abbreviations) */
function schoolSimilarity(a, b) {
  const norm = (x) => (x || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const GENERIC = new Set(["university", "college", "school", "institute", "of", "the", "at", "state", "and"]);
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const toks = (x) => new Set(x.split(" ").filter((t) => t && !GENERIC.has(t)));
  const ta = toks(na), tb = toks(nb);
  const tok = ta.size && tb.size ? [...ta].filter((t) => tb.has(t)).length / Math.min(ta.size, tb.size) : 0;
  const grams = (x) => { const g = new Set(); const y = x.split(" ").filter((t) => !GENERIC.has(t)).join(" "); for (let i = 0; i < y.length - 1; i++) g.add(y.slice(i, i + 2)); return g; };
  const ga = grams(na), gb = grams(nb);
  const gi = ga.size && gb.size ? [...ga].filter((g) => gb.has(g)).length / Math.min(ga.size, gb.size) : 0;
  return Math.max(tok, gi);
}
const correctSchool = (typed, fromResume) => {
  if (!fromResume) return typed || "";
  if (!typed) return fromResume;
  return schoolSimilarity(typed, fromResume) >= 0.45 ? fromResume : typed;
};

/* deterministic extraction; Claude parsing replaces this later */
function extractProfileFacts(text) {
  const wins = [];
  const winRe = /[^.\n]*(?:\$\s?\d[\d,.]*\s?[KkMmBb]?|\d{1,3}\s?%|\b\d[\d,]*\+?\s+(?:users|customers|members|sales|clients|downloads|followers))[^.\n]*/g;
  let m;
  while ((m = winRe.exec(text)) && wins.length < 5) {
    const w = m[0].trim();
    if (w.length > 10 && w.length < 160) wins.push(w);
  }
  const schoolMatch = text.match(/\b(UC\s?Irvine|UCI|UCLA|USC|Berkeley|Stanford|[A-Z][a-z]+ University)\b/);
  const skills = COMMON_SKILLS.filter((s) => new RegExp(`\\b${s.replace(/[+]/g, "\\+")}\\b`, "i").test(text));
  return { wins, school: schoolMatch ? schoolMatch[0].replace(/^UCI$/, "UC Irvine") : null, skills };
}

/* upload the resume to the parser; falls back to raw text + local extraction */
async function parseResumeFile(file) {
  try {
    const buf = await file.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    const res = await fetch("/api/profile/parse-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentBase64: btoa(bin) }),
    });
    const data = await res.json();
    if (data.ok && data.parsed) {
      OB.parsed = data.parsed;
      OB.resumeParsed = true;
      OB.parseNote = "";
      const found = [data.parsed.school && "school", data.parsed.skills?.length && `${data.parsed.skills.length} skills`,
        data.parsed.experience?.length && `${data.parsed.experience.length} roles`, data.parsed.quantifiedWins?.length && `${data.parsed.quantifiedWins.length} wins`]
        .filter(Boolean).join(" · ");
      toast(`Resume parsed${found ? ": " + found : ""}`);
    } else {
      OB.parsed = null;
      OB.resumeParsed = false;
      OB.parseNote = data.note || "Could not read this file.";
    }
  } catch {
    OB.parsed = null;
    OB.resumeParsed = false;
    OB.parseNote = "Parsing is offline. Your file is saved; details can be filled in by hand.";
  }
  OB.resumeText = OB.parsed ? "" : await readFileText(file);
}

async function readFileText(file) {
  if (!file) return "";
  if (/\.(txt|md|text)$/i.test(file.name) || file.type.startsWith("text/")) {
    try { return await file.text(); } catch { return ""; }
  }
  return ""; /* PDF / DOCX parsing happens server-side later */
}

function obError(elOrSel, msg) {
  const el = typeof elOrSel === "string" ? $(elOrSel, modal) : elOrSel;
  $$(".ob-error", modal).forEach((e) => e.remove());
  const err = document.createElement("p");
  err.className = "ob-error";
  err.textContent = msg;
  el.insertAdjacentElement("afterend", err);
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 450);
}

/* chips with show-more / show-less */
function chipsExpand(list, selected, cls, visible = 8) {
  const expanded = OB[`_x_${cls}`];
  const shown = expanded ? list : list.slice(0, visible);
  const hidden = list.length - visible;
  return `<div class="chips-select ${cls}" data-cls="${cls}">
    ${shown.map((t) => `<button type="button" class="pill ${selected.includes(t) ? "is-on" : ""}" data-v="${esc(t)}">${esc(t)}</button>`).join("")}
    ${hidden > 0 ? `<button type="button" class="pill pill--more" data-more="${cls}">${expanded ? "Show less" : `+ ${hidden} more`}</button>` : ""}
  </div>`;
}
function wireChips(cls, { single = false, onToggle } = {}) {
  $$(`.${cls} .pill`, modal).forEach((p) => p.addEventListener("click", () => {
    if (p.dataset.more) {
      OB[`_x_${cls}`] = !OB[`_x_${cls}`];
      onToggle && onToggle();
      return;
    }
    if (single) $$(`.${cls} .pill`, modal).forEach((x) => { if (!x.dataset.more) x.classList.toggle("is-on", x === p); });
    else p.classList.toggle("is-on");
    $$(".ob-error", modal).forEach((e) => e.remove());
  }));
}
const readChips = (cls) => $$(`.${cls} .pill.is-on`, modal).filter((p) => !p.dataset.more).map((p) => p.dataset.v);

function obBars(n) {
  return `<div class="obsteps">${Array.from({ length: OB_STEPS }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div>`;
}

function wireDrop(zoneSel, inputSel, onFiles) {
  const zone = $(zoneSel, modal), input = $(inputSel, modal);
  zone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => onFiles([...input.files]));
  ["dragover", "dragenter"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("is-drag"); }));
  ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("is-drag"); }));
  zone.addEventListener("drop", (e) => onFiles([...e.dataTransfer.files]));
}

function openOnboarding(step = 1) {
  /* ---------- 1 · resume ---------- */
  if (step === 1) {
    openModal(`${obBars(1)}
      <h2>Drop your resume so Knock can find your strongest hooks.</h2>
      <p class="sub">Scout pulls the wins that make people reply. Your resume never leaves your account.</p>
      <div class="dropzone dropzone--lg ${OB.resumeFileName ? "is-filled" : ""}" id="ob-zone">
        ${OB.resumeFileName
          ? `${icon("doc")} ${esc(OB.resumeFileName)}${OB.resumeParsed ? " · parsed" : ""}<br><small>${OB.parseNote ? esc(OB.parseNote) + " " : ""}Click to swap it for another file</small>`
          : `${icon("doc")} Drag &amp; drop your resume<br><small>PDF, Word, or text · or click to browse</small>`}
      </div>
      <input type="file" id="ob-file" accept=".pdf,.doc,.docx,.txt,.md" hidden>
      <label>Your story in a sentence or two</label>
      <textarea id="ob-story" rows="4" placeholder="The two lines you'd open with if your dream manager asked who are you. Lead with your proudest win.">${esc(OB.story || "")}</textarea>
      <div class="modal__actions"><button class="btn" id="ob-next">Continue →</button></div>`, true);
    wireDrop("#ob-zone", "#ob-file", async (files) => {
      const f = files[0];
      if (!f) return;
      OB.story = $("#ob-story", modal)?.value.trim() ?? OB.story;
      OB.resumeFileName = f.name;
      const zone = $("#ob-zone", modal);
      zone.classList.add("is-filled");
      zone.innerHTML = `${icon("doc")} ${esc(f.name)}<br><small>Scout is reading it…</small>`;
      await parseResumeFile(f);
      saveOB();
      openOnboarding(1);
    });
    $("#ob-next").addEventListener("click", () => {
      if (!OB.resumeFileName) return obError("#ob-zone", "Scout needs your resume to find your hooks. Drop a file in to keep going.");
      OB.story = $("#ob-story").value.trim();
      saveOB();
      openOnboarding(2);
    });
  }

  /* ---------- 2 · about you ---------- */
  else if (step === 2) {
    const user = window.knockAuth?.user || {};
    const parsed = OB.parsed || {};
    const pre = (obVal, parsedVal) => obVal ?? parsedVal ?? "";
    openModal(`${obBars(2)}
      <h2>Tell Scout who's knocking.</h2>
      <p class="sub">${OB.parsed ? "Pulled from your resume; fix anything that's off." : "This is how you'll introduce yourself in every first line."}</p>
      <label>Full name</label><input type="text" id="ob-name" value="${esc(OB.fullName ?? parsed.fullName ?? (user.name && user.name !== user.email ? user.name : ""))}" placeholder="Jordan Rivers">
      <label>School</label><input type="text" id="ob-school" value="${esc(pre(OB.school, parsed.school))}" placeholder="UC Irvine, Paul Merage School of Business">
      <div class="ob-cols">
        <div><label>Degree / major</label><input type="text" id="ob-degree" value="${esc(pre(OB.degree, parsed.degree))}" placeholder="B.A. Business Administration"></div>
        <div><label>Class of</label><input type="text" id="ob-grad" value="${esc(pre(OB.gradYear, parsed.gradYear))}" placeholder="2027"></div>
      </div>
      <div class="ob-cols">
        <div><label>City</label><input type="text" id="ob-city" value="${esc(pre(OB.location, parsed.location))}" placeholder="San Diego, CA"></div>
        <div><label>Where you work now (optional)</label><input type="text" id="ob-work" value="${esc(OB.currentRole || "")}" placeholder="Founder @ JCommerce"></div>
      </div>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="ob-back">← Back</button>
        <button class="btn" id="ob-next">Continue →</button>
      </div>`, true);
    $("#ob-back").addEventListener("click", () => openOnboarding(1));
    $("#ob-next").addEventListener("click", () => {
      const name = $("#ob-name").value.trim();
      const school = $("#ob-school").value.trim();
      if (!name) return obError("#ob-name", "Scout signs every draft with your name. Add it to keep going.");
      if (!school) return obError("#ob-school", "Your school is one of your strongest hooks. Add it to keep going.");
      OB.fullName = name;
      const corrected = correctSchool(school, OB.parsed?.school);
      if (corrected !== school) toast(`Matched to your resume: ${esc(corrected)}`);
      OB.school = corrected;
      OB.degree = $("#ob-degree").value.trim();
      OB.gradYear = $("#ob-grad").value.trim();
      OB.location = $("#ob-city").value.trim();
      OB.currentRole = $("#ob-work").value.trim();
      saveOB();
      openOnboarding(3);
    });
  }

  /* ---------- 3 · target paths ---------- */
  else if (step === 3) {
    openModal(`${obBars(3)}
      <h2>What doors do you want opened?</h2>
      <p class="sub">Pick every path you'd take a meeting for. Scout weights your queue toward these.</p>
      <label>Target paths</label>
      ${chipsExpand(OB_PATHS, OB.industries || [], "ob-ind")}
      <div class="modal__actions">
        <button class="btn btn--ghost" id="ob-back">← Back</button>
        <button class="btn" id="ob-next">Continue →</button>
      </div>`, true);
    wireChips("ob-ind", { onToggle: () => { OB.industries = readChips("ob-ind"); saveOB(); openOnboarding(3); } });
    $("#ob-back").addEventListener("click", () => { OB.industries = readChips("ob-ind"); saveOB(); openOnboarding(2); });
    $("#ob-next").addEventListener("click", () => {
      const picked = readChips("ob-ind");
      if (!picked.length) return obError($(".ob-ind", modal), "Pick at least one path so Scout knows where to hunt.");
      OB.industries = picked;
      saveOB();
      openOnboarding(4);
    });
  }

  /* ---------- 4 · people + location ---------- */
  else if (step === 4) {
    openModal(`${obBars(4)}
      <h2>Who should Scout knock for you?</h2>
      <p class="sub">The kinds of people who'll get your first lines.</p>
      <label>People to reach</label>
      ${chipsExpand(OB_PEOPLE, OB.targetRoles || [], "ob-roles")}
      <label>Location preference</label>
      ${chipsExpand(OB_LOCATIONS, OB.locations || ["Remote"], "ob-loc", 9)}
      <div class="modal__actions">
        <button class="btn btn--ghost" id="ob-back">← Back</button>
        <button class="btn" id="ob-next">Continue →</button>
      </div>`, true);
    const persist = () => { OB.targetRoles = readChips("ob-roles"); OB.locations = readChips("ob-loc"); saveOB(); };
    wireChips("ob-roles", { onToggle: () => { persist(); openOnboarding(4); } });
    wireChips("ob-loc", {});
    $("#ob-back").addEventListener("click", () => { persist(); openOnboarding(3); });
    $("#ob-next").addEventListener("click", () => {
      const roles = readChips("ob-roles");
      if (!roles.length) return obError($(".ob-roles", modal), "Pick at least one kind of person to reach.");
      persist();
      openOnboarding(5);
    });
  }

  /* ---------- 5 · voice + personality ---------- */
  else {
    openModal(`${obBars(5)}
      <h2>Last one: how do you sound?</h2>
      <p class="sub">Scout writes every draft in your voice, not a template's.</p>
      <label>Tone</label>
      <div class="chips-select ob-tone">${OB_TONES.map((t) => `<button type="button" class="pill ${(OB.tone || "Sharp") === t ? "is-on" : ""}" data-v="${t}">${t}</button>`).join("")}</div>
      <label>Pick the line that sounds most like you</label>
      <div class="chips-select chips-select--stack ob-line">${OB_LINES.map((t) => `<button type="button" class="pill ${OB.personaLine === t ? "is-on" : ""}" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <label>How do you work? (pick a few)</label>
      <div class="chips-select ob-style">${OB_STYLES.map((t) => `<button type="button" class="pill ${(OB.workStyles || []).includes(t) ? "is-on" : ""}" data-v="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      <label>Writing samples (optional, up to 10)</label>
      <p class="ob-hint">Drop files or paste an email, essay, or post you're proud of. Scout learns your rhythm from them.</p>
      <div class="dropzone ${(OB.writingSamples || []).length ? "is-filled" : ""}" id="ob-samples-zone">
        ${(OB.writingSamples || []).length
          ? `${icon("doc")} ${OB.writingSamples.length} sample${OB.writingSamples.length === 1 ? "" : "s"} added<br><small>${OB.writingSamples.map(esc).join(" · ")}</small>`
          : `${icon("doc")} Drop writing samples here<br><small>.txt, .md, .eml read best</small>`}
      </div>
      <input type="file" id="ob-samples" multiple accept=".pdf,.doc,.docx,.txt,.md,.eml" hidden>
      <textarea id="ob-sample-text" rows="3" placeholder="…or paste a sample here"></textarea>
      <div class="ob-sample-add"><button type="button" class="btn btn--paper btn--sm" id="ob-sample-btn">+ Add pasted sample</button></div>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="ob-back">← Back</button>
        <button class="btn btn--accent" id="ob-done">Build my profile →</button>
      </div>`, true);
    wireChips("ob-tone", { single: true });
    wireChips("ob-line", { single: true });
    wireChips("ob-style", {});
    const persistStep5 = () => {
      OB.tone = readChips("ob-tone")[0] || OB.tone;
      OB.personaLine = readChips("ob-line")[0] || OB.personaLine;
      OB.workStyles = readChips("ob-style");
    };
    wireDrop("#ob-samples-zone", "#ob-samples", async (files) => {
      persistStep5();
      for (const f of files.slice(0, 10)) {
        if ((OB.writingSamples || []).length >= 10) break;
        OB.writingSamples = [...(OB.writingSamples || []), f.name];
        const text = await readFileText(f);
        if (text) OB.sampleTexts = [...(OB.sampleTexts || []), text.slice(0, 6000)];
      }
      OB.writingSamples = (OB.writingSamples || []).slice(0, 10);
      saveOB();
      openOnboarding(5);
    });
    $("#ob-sample-btn").addEventListener("click", () => {
      const text = $("#ob-sample-text", modal).value.trim();
      if (!text) return obError("#ob-sample-text", "Paste some writing first, then add it.");
      if ((OB.writingSamples || []).length >= 10) return obError("#ob-sample-text", "That's 10 samples, plenty for Scout to learn from.");
      persistStep5();
      OB.writingSamples = [...(OB.writingSamples || []), `pasted sample ${(OB.writingSamples || []).length + 1}`];
      OB.sampleTexts = [...(OB.sampleTexts || []), text.slice(0, 6000)];
      saveOB();
      openOnboarding(5);
    });
    $("#ob-back").addEventListener("click", () => { persistStep5(); saveOB(); openOnboarding(4); });
    $("#ob-done").addEventListener("click", finishOnboarding);
  }
}

async function finishOnboarding() {
  OB.tone = readChips("ob-tone")[0] || "Sharp";
  OB.personaLine = readChips("ob-line")[0] || "";
  OB.workStyles = readChips("ob-style");
  const parsed = OB.parsed || {};
  const local = extractProfileFacts(`${OB.resumeText || ""} ${OB.story || ""}`);
  const user = window.knockAuth?.user || {};
  const wins = parsed.quantifiedWins?.length ? parsed.quantifiedWins : local.wins;
  state.profile = {
    fullName: OB.fullName,
    email: user.email || "",
    school: OB.school || parsed.school || local.school || "",
    degree: OB.degree || parsed.degree || "",
    gradYear: OB.gradYear || parsed.gradYear || "",
    location: OB.location || parsed.location || "",
    currentRole: OB.currentRole || "",
    story: OB.story || "",
    resumeFileName: OB.resumeFileName || "",
    resumeText: OB.resumeText || "",
    target: (OB.targetRoles || []).join(", ") || "founders and operators",
    industries: OB.industries || [],
    targetRoles: OB.targetRoles || [],
    locations: OB.locations || ["Any"],
    tone: OB.tone,
    signoff: `- ${(OB.fullName || "").split(" ")[0] || "Me"}`,
    traits: [...new Set([OB.personaLine, ...(OB.workStyles || [])].filter(Boolean))],
    writingSamples: OB.writingSamples || [],
    quantifiedWins: wins,
    skills: [...new Set([...(parsed.skills || []), ...local.skills])].slice(0, 14),
    experience: parsed.experience || [],
    extraContext: parsed.extraContext || "",
    styleProfile: null,
    goals: OB.industries || [],
    updatedAt: new Date().toISOString(),
  };
  save("knock_profile", state.profile);
  state.searchMode = PEOPLE_TO_MODE[(OB.targetRoles || [])[0]] || "founders";
  save("knock_search_mode", state.searchMode);

  /* learn the writing voice from their samples (non-blocking for the UI) */
  const sampleTexts = OB.sampleTexts || [];
  localStorage.removeItem("knock_ob_draft");
  closeModal();
  initAccount();
  toast(`Profile built${wins.length ? `, ${wins.length} quantified win${wins.length === 1 ? "" : "s"} extracted` : ""}. Scout is finding your first doors`);
  location.hash = "dashboard";
  navigate();
  offerTour();

  if (sampleTexts.length || state.profile.story) {
    try {
      const res = await fetch("/api/profile/analyze-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ samples: sampleTexts, story: state.profile.story }),
      });
      const data = await res.json();
      if (data.ok && data.styleProfile) {
        state.profile.styleProfile = data.styleProfile;
        saveProfile();
        if (sampleTexts.length) toast("Scout learned your writing voice from your samples");
      }
    } catch { /* style learning is a bonus, never a blocker */ }
  }
}

/* ============================================================
   GUIDED TOUR: spotlight walkthrough of the whole app
   ============================================================ */
const TOUR_STEPS = [
  { route: "dashboard", sel: ".statgrid", title: "Your command station", text: "Live counts: doors found, average match, knocks queued, and knocks left this month. Scout sources automatically; no buttons to press." },
  { route: "dashboard", sel: "#filterbar", title: "Slice the search", text: "Filter by industry, location, company, or any keyword. Pick a suggestion or type your own, then hit Search and Scout pulls a fresh 100 people." },
  { route: "dashboard", sel: ".doors-table", title: "Your launch queue", text: "25 people per page, scored against your profile. Tick the ones you want, hit Review knock to read and edit the draft, then Approve & launch." },
  { route: "inbox", sel: ".ghost, .inbox", title: "Inbox", text: "Replies land here once Google is connected, warmest threads first. The Connections button manages every channel." },
  { route: "tracker", sel: ".funnel-tabs", title: "Tracker", text: "Every knock moves through queued, sent, opened, replied, and meeting booked. Pause, resume, or cancel queued knocks right from the table." },
  { route: "profile", sel: ".profile-grid", title: "Your profile", text: "Everything Scout knows about you, parsed from your resume. Every field is editable, and every edit updates future drafts instantly." },
  { route: "settings", sel: ".settings-grid", title: "Settings", text: "Connections (Google, LinkedIn), agent autonomy, sending preferences, and your plan all live here." },
];

function waitForEl(sel, timeout = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      const el = $(sel, view);
      if (el) return resolve(el);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(poll, 250);
    })();
  });
}

async function startTour(stepIndex = 0) {
  document.getElementById("tour")?.remove();
  if (stepIndex >= TOUR_STEPS.length) {
    save("knock_tour_done", true);
    location.hash = "dashboard";
    toast("That's the tour. Go knock on something");
    return;
  }
  const step = TOUR_STEPS[stepIndex];
  if ((location.hash.replace("#", "") || "dashboard") !== step.route) {
    location.hash = step.route;
  }
  const el = await waitForEl(step.sel);
  if (!el) return startTour(stepIndex + 1);
  el.scrollIntoView({ block: "center", behavior: "instant" });

  const r = el.getBoundingClientRect();
  const pad = 8;
  const tour = document.createElement("div");
  tour.id = "tour";
  const cardBelow = r.bottom + 190 < window.innerHeight;
  tour.innerHTML = `
    <div class="tour-hole" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
    <div class="tour-card" style="${cardBelow ? `top:${r.bottom + 16}px` : `bottom:${window.innerHeight - r.top + 16}px`};left:${Math.max(16, Math.min(r.left, window.innerWidth - 360))}px">
      <small>${stepIndex + 1} of ${TOUR_STEPS.length}</small>
      <h3>${step.title}</h3>
      <p>${step.text}</p>
      <div class="tour-card__actions">
        <button class="btn btn--ghost btn--sm" id="tour-skip">Skip tour</button>
        ${stepIndex > 0 ? '<button class="btn btn--paper btn--sm" id="tour-back">Back</button>' : ""}
        <button class="btn btn--accent btn--sm" id="tour-next">${stepIndex === TOUR_STEPS.length - 1 ? "Done" : "Next"}</button>
      </div>
    </div>`;
  document.body.appendChild(tour);
  $("#tour-next").addEventListener("click", () => startTour(stepIndex + 1));
  $("#tour-back")?.addEventListener("click", () => startTour(stepIndex - 1));
  $("#tour-skip").addEventListener("click", () => {
    tour.remove();
    save("knock_tour_done", true);
    toast("You can replay the tour anytime from the account menu");
  });
}

function offerTour() {
  if (load("knock_tour_done", false)) return;
  setTimeout(() => {
    openModal(`
      <h2>Want a quick tour?</h2>
      <p class="sub">60 seconds, six stops. See how sourcing, the queue, the tracker, and your profile fit together.</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="tour-no">I'll explore</button>
        <button class="btn btn--accent" id="tour-yes">Show me around</button>
      </div>`);
    $("#tour-no").addEventListener("click", () => { closeModal(); save("knock_tour_done", true); });
    $("#tour-yes").addEventListener("click", () => { closeModal(); startTour(0); });
  }, 600);
}

/* ---------------- global search: quick-filter + Enter to search Apollo ---------------- */
$("#global-search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  /* live-filter whatever table is on screen */
  $$(".doors-table tbody tr, .view table tbody tr", view).forEach((tr) => {
    tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? "" : "none";
  });
});
$("#global-search").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const q = e.target.value.trim();
  if (!q) return;
  e.target.value = "";
  if (addFilter("keyword", q)) {
    toast(`Searching with keyword "${esc(q)}"`);
    location.hash = "dashboard";
    runSourcing();
  }
});

/* ---------------- account menu ---------------- */
function initAccount() {
  const user = window.knockAuth?.user;
  if (!user) return;
  const name = state.profile?.fullName || user.name || user.email;
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "?";
  $("#acct-btn").textContent = initials;
  $("#acct-name").textContent = name;
  $("#acct-email").textContent = user.email;
}

$("#acct-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const menu = $("#acct-menu");
  menu.hidden = !menu.hidden;
  $("#acct-btn").setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#acct")) $("#acct-menu").hidden = true;
});
$("#acct-logout").addEventListener("click", () => window.knockAuth.signOut());
$("#acct-tour")?.addEventListener("click", () => { $("#acct-menu").hidden = true; startTour(0); });

/* ---------------- boot (auth-gated) ---------------- */
(async function boot() {
  const user = await window.knockAuth.ready;
  if (!user) {
    location.replace("../index.html#login");
    return;
  }
  /* tidy the URL after a magic-link / OAuth redirect */
  if (/access_token|refresh_token|error_description/.test(location.hash)) {
    history.replaceState(null, "", location.pathname + "#dashboard");
  }
  handleConnectReturn();
  initAccount();
  navigate();
  syncConnections();
  if (!state.profile) openOnboarding(1);
})();
