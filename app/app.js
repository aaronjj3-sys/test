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
/* keys that ride along to Supabase (profiles.app_state) so the account
   follows the login across devices; everything else stays device-local */
const SYNCED_KEYS = new Set([
  "knock_doors", "knock_doors_meta", "knock_campaigns", "knock_messages",
  "knock_left", "knock_plan", "knock_search_mode", "knock_filters",
  "knock_door_sort", "knock_autonomy", "knock_send_prefs", "knock_tracker_tab",
  "knock_inbox_filter",
]);
const save = (k, v) => {
  localStorage.setItem(k, JSON.stringify(v));
  if (SYNCED_KEYS.has(k)) scheduleSyncAppState();
};

/* one-time migration: clear demo-era data so accounts start fresh */
if (localStorage.getItem("knock_v") !== "2") {
  Object.keys(localStorage)
    .filter((k) => k.startsWith("knock_") && k !== "knock_dev_session")
    .forEach((k) => localStorage.removeItem(k));
  localStorage.setItem("knock_v", "2");
}

/* ---------------- state ---------------- */
const PAGE_SIZE = 25;
const MAX_DOOR_PAGES = 25;
const MAX_DOORS_LOADED = PAGE_SIZE * MAX_DOOR_PAGES;
const state = {
  profile: load("knock_profile", null),
  doors: load("knock_doors", null),
  doorsMeta: load("knock_doors_meta", null),
  campaigns: load("knock_campaigns", []),
  messages: load("knock_messages", []),
  connections: load("knock_connections", { google: false, outlook: false }),
  autonomy: load("knock_autonomy", { review: true, followups: true, weekends: false, digest: true }),
  knocks: load("knock_left", 15),
  plan: load("knock_plan", "free"),
  searchMode: load("knock_search_mode", "founders"),
  searchFilters: load("knock_filters", { keywords: [], industries: [], locations: [], companies: [] }),
  doorSort: load("knock_door_sort", "match_desc"),
  sendPrefs: load("knock_send_prefs", null),
  profileExpanded: load("knock_profile_expanded", { sections: false, samples: false }),
  inboxSelectedId: load("knock_inbox_selected", null),
  inboxFilter: load("knock_inbox_filter", "all"),
  apolloUsage: load("knock_apollo_usage", {
    configured: false,
    apiDayLeft: null,
    apiDayLimit: null,
    enrichCreditsUsed: 0,
    peopleSearched: 0,
    updatedAt: null,
  }),
  doorsPage: 0,
  selectedDoors: new Set(),
  trackerTab: load("knock_tracker_tab", "all"),
  sourcing: false,
  prefetchingDoors: false,
};
const knockLimit = () => (state.plan === "unlimited" ? 9999 : state.plan === "pro" ? 200 : 15);
const saveApolloUsage = () => save("knock_apollo_usage", state.apolloUsage);
const inboxComposerAttachments = new Map();
let replyToolbarSelectionHandler = null;
state.connections = {
  google: Boolean(state.connections.google || state.connections.gmail || state.connections.gcal),
  outlook: Boolean(state.connections.outlook),
};
if (state.sendPrefs?.channel === "linkedin") state.sendPrefs.channel = state.connections.google ? "gmail" : "queue";
/* These run at top level, before the cross-device sync subsystem below is
   defined. Write them straight to localStorage: going through save() would
   call scheduleSyncAppState() for synced keys (knock_send_prefs) and hit a
   temporal-dead-zone ReferenceError, taking down the whole script. There is
   nothing to sync here anyway, auth isn't ready yet and hydrate runs next. */
localStorage.setItem("knock_connections", JSON.stringify(state.connections));
if (state.sendPrefs) localStorage.setItem("knock_send_prefs", JSON.stringify(state.sendPrefs));
const saveLive = () => {
  save("knock_doors", state.doors);
  save("knock_doors_meta", state.doorsMeta);
  save("knock_campaigns", state.campaigns);
  save("knock_messages", state.messages);
  save("knock_left", state.knocks);
  save("knock_plan", state.plan);
};
/* ---------------- cross-device state sync (profiles.app_state) ----------------
   Everything the UI persists to localStorage (except the profile, which has its
   own profile_json sync) is mirrored into the user's `profiles` row, debounced.
   Dev mode (no Supabase) no-ops; failures are console-only and the app keeps
   running on localStorage. */
let appSyncTimer = null;
let syncSuspended = false;

const canSyncState = () => {
  const auth = window.knockAuth;
  return Boolean(auth?.client && auth.user?.id && auth.user.id !== "dev");
};

function scheduleSyncAppState() {
  if (syncSuspended) return;
  /* track when local state last changed, for the newer-wins merge on load */
  save("knock_state_updated_at", new Date().toISOString());
  if (!canSyncState()) return;
  clearTimeout(appSyncTimer);
  appSyncTimer = setTimeout(syncAppStateNow, 3000);
}

/* strip the bulky Apollo payload; keep every field the UI renders or sends */
function slimDoor(d) {
  if (!d || typeof d !== "object") return d;
  const { raw, ...rest } = d;
  return rest;
}

function buildAppState() {
  return {
    version: 1,
    updatedAt: load("knock_state_updated_at", new Date().toISOString()),
    doors: state.doors ? state.doors.slice(0, 300).map(slimDoor) : null,
    doorsMeta: state.doorsMeta,
    campaigns: state.campaigns,
    messages: state.messages,
    knocks: state.knocks,
    plan: state.plan,
    searchMode: state.searchMode,
    searchFilters: state.searchFilters,
    doorSort: state.doorSort,
    autonomy: state.autonomy,
    sendPrefs: state.sendPrefs,
    trackerTab: state.trackerTab,
    inboxFilter: state.inboxFilter,
  };
}

async function syncAppStateNow() {
  clearTimeout(appSyncTimer);
  appSyncTimer = null;
  if (!canSyncState()) return;
  const auth = window.knockAuth;
  try {
    const { error } = await auth.client.from("profiles").upsert({
      user_id: auth.user.id,
      email: auth.user.email || null,
      app_state: buildAppState(),
    }, { onConflict: "user_id" });
    if (error) console.warn("[knock] state sync skipped:", error.message);
  } catch (err) {
    console.warn("[knock] state sync skipped:", err?.message || err);
  }
}

/* flush a pending debounce when the tab goes to the background */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && appSyncTimer) syncAppStateNow();
});

/* message statuses only ever advance; a stale device can never un-send a knock */
const STATUS_RANK = {
  drafting: 0, queued: 1, paused: 1, waiting_gmail: 1, sending: 2,
  failed: 3, scheduled: 3, sent: 4, opened: 4, followup_sent: 5,
  replied: 7, needs_review: 7, meeting: 8,
};

function mergeMessages(base, other) {
  const out = new Map();
  for (const m of [...(base || []), ...(other || [])]) {
    if (!m || !m.id) continue;
    const prev = out.get(m.id);
    if (!prev) { out.set(m.id, m); continue; }
    const rPrev = STATUS_RANK[prev.status] ?? 0;
    const rNew = STATUS_RANK[m.status] ?? 0;
    if (rNew > rPrev || (rNew === rPrev && (m.updatedAt || "") > (prev.updatedAt || ""))) out.set(m.id, m);
  }
  return [...out.values()].sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
}

/* merge policy: empty local adopts remote wholesale; otherwise the newer
   updatedAt wins as the base, and messages are merged by id either way so
   sent/replied statuses from any device always survive. */
function adoptRemoteAppState(remote) {
  if (!remote || typeof remote !== "object" || !remote.version) return;
  const localUpdatedAt = load("knock_state_updated_at", "");
  const localEmpty = !(state.doors || []).length && !state.messages.length && !state.campaigns.length;
  const useRemote = localEmpty || (remote.updatedAt || "") > localUpdatedAt;
  syncSuspended = true;
  try {
    if (useRemote) {
      if (Array.isArray(remote.doors) && remote.doors.length) {
        state.doors = remote.doors;
        state.doorsMeta = remote.doorsMeta || state.doorsMeta;
        state.doorsPage = 0;
      }
      if (Array.isArray(remote.campaigns)) state.campaigns = remote.campaigns;
      state.messages = mergeMessages(remote.messages, state.messages);
      if (typeof remote.knocks === "number") state.knocks = localEmpty ? remote.knocks : Math.min(state.knocks, remote.knocks);
      if (remote.plan) state.plan = remote.plan;
      if (remote.searchMode) state.searchMode = remote.searchMode;
      if (remote.searchFilters) state.searchFilters = remote.searchFilters;
      if (remote.doorSort) state.doorSort = remote.doorSort;
      if (remote.autonomy) state.autonomy = remote.autonomy;
      if (remote.sendPrefs) state.sendPrefs = remote.sendPrefs;
      if (remote.trackerTab) state.trackerTab = remote.trackerTab;
      if (remote.inboxFilter) state.inboxFilter = remote.inboxFilter;
      saveLive();
      save("knock_search_mode", state.searchMode);
      save("knock_filters", state.searchFilters);
      save("knock_door_sort", state.doorSort);
      save("knock_autonomy", state.autonomy);
      save("knock_send_prefs", state.sendPrefs);
      save("knock_tracker_tab", state.trackerTab);
      save("knock_inbox_filter", state.inboxFilter);
      save("knock_state_updated_at", remote.updatedAt || new Date().toISOString());
    } else {
      /* local is newer: still pick up more-advanced message statuses from remote */
      state.messages = mergeMessages(state.messages, remote.messages);
      if (typeof remote.knocks === "number") state.knocks = Math.min(state.knocks, remote.knocks);
      saveLive();
    }
  } finally {
    syncSuspended = false;
  }
  /* push the merged truth back up so every device converges */
  scheduleSyncAppState();
}

const doorById = (id) => (state.doors || []).find((d) => d.id === id);
const msgById = (id) => state.messages.find((m) => m.id === id);
function messageDoor(m) {
  const live = doorById(m?.doorId);
  if (live) return live;
  if (m?.doorSnapshot) return m.doorSnapshot;
  if (!m?.apolloPersonId) return null;
  return {
    id: m.doorId || m.id,
    apolloPersonId: m.apolloPersonId,
    name: m.name || m.toName || "",
    firstName: (m.name || m.toName || "").split(" ")[0] || "",
    title: m.title || "",
    companyName: m.company || m.companyName || "",
    companyDomain: m.companyDomain || "",
    email: m.to || "",
    emailStatus: m.emailStatus || "",
    draft: m.draft || null,
  };
}
const latestMsgForDoor = (doorId) => {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].doorId === doorId) return state.messages[i];
  }
  return null;
};
const DASHBOARD_PIPELINE_STATUSES = new Set([
  "drafting", "sending", "queued", "paused", "scheduled", "waiting_gmail",
  "failed", "sent", "opened", "followup_sent", "replied", "needs_review", "meeting",
]);
function doorIsActiveInPipeline(d) {
  const m = latestMsgForDoor(d?.id);
  return Boolean(m && DASHBOARD_PIPELINE_STATUSES.has(m.status));
}
function availableDoorsForLaunch() {
  return (state.doors || []).filter((d) => !doorIsActiveInPipeline(d));
}

/* email content hygiene: no em dashes in anything Scout sends */
const noEmDash = (s) => String(s ?? "").replace(/\s+—\s+/g, ", ").replace(/—/g, "-");

/* the authenticated user id (Supabase uuid, or "dev" in dev mode). */
const ACTIVE_USER_ID_KEY = "knock_active_user_id";
const isRealUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value || "");
function rememberActiveUserId(value) {
  if (isRealUuid(value)) localStorage.setItem(ACTIVE_USER_ID_KEY, value);
}
const userId = () => {
  const live = window.knockAuth?.user?.id || "";
  if (isRealUuid(live)) {
    rememberActiveUserId(live);
    return live;
  }
  return "dev";
};

function realAuthUserId() {
  const id = window.knockAuth?.user?.id;
  return isRealUuid(id) ? id : null;
}
async function realUserIdFromAuth() {
  const auth = window.knockAuth;
  if (isRealUuid(auth?.user?.id)) {
    rememberActiveUserId(auth.user.id);
    return auth.user.id;
  }
  if (!auth?.client) return "";
  try {
    const { data } = await auth.client.auth.getUser();
    if (isRealUuid(data?.user?.id)) {
      const name = data.user.user_metadata?.full_name || data.user.email || auth.user?.name || "";
      auth.user = {
        ...(auth.user || {}),
        id: data.user.id,
        email: data.user.email || auth.user?.email || "",
        name,
        avatar: data.user.user_metadata?.avatar_url || auth.user?.avatar,
        initials: (name || data.user.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(""),
      };
      rememberActiveUserId(data.user.id);
      return data.user.id;
    }
  } catch { /* session refresh failed; caller shows a clean login prompt */ }
  return "";
}

function getAuthSnapshot() {
  const auth = window.knockAuth || {};
  const user = auth.user || null;
  const mode = auth.mode || "dev";
  const hasConfig = Boolean(window.KNOCK_CONFIG?.supabaseUrl && window.KNOCK_CONFIG?.supabaseAnonKey);
  const hasClient = Boolean(auth.client);
  const hasRealUser = Boolean(user?.id && user.id !== "dev" && isRealUuid(user.id));
  return { auth, user, mode, hasConfig, hasClient, hasRealUser };
}

async function waitForAuthReady() {
  try {
    if (window.knockAuth?.ready) await window.knockAuth.ready;
  } catch { /* login UI handles auth errors */ }
  await realUserIdFromAuth();
  return getAuthSnapshot();
}

let connectCallbackHandled = false;

async function requireRealSupabaseAuth(reason = "continue", options = {}) {
  const s = await waitForAuthReady();
  if (s.hasRealUser) return s.user;

  if (options.afterLogin) {
    sessionStorage.setItem("knock_after_login", options.afterLogin);
  }

  if (!s.hasConfig || !s.hasClient || s.mode === "misconfigured") {
    toast("Supabase browser config is missing on this deployment.");
    return null;
  }

  toast(`Sign in to Knock first to ${reason}.`);
  window.knockAuth?.openLogin?.();
  return null;
}

/* ---------------- user files: resume + email attachments ----------------
   Stored server-side (user_files table via /api/files) so the actual bytes
   can be attached to Gmail sends. The client keeps metadata only. */
const MAX_EXTRA_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
state.userFiles = null; /* null = not loaded yet */

const filesApiAvailable = () => Boolean(realAuthUserId());

async function loadUserFiles(force = false) {
  const realUserId = await realUserIdFromAuth();
  if (!realUserId) { state.userFiles = []; return state.userFiles; }
  if (state.userFiles && !force) return state.userFiles;
  try {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: realUserId, action: "list" }),
    });
    const data = await res.json().catch(() => ({}));
    state.userFiles = data.ok ? data.files || [] : [];
  } catch {
    state.userFiles = state.userFiles || [];
  }
  return state.userFiles;
}

const resumeFile = () => (state.userFiles || []).find((f) => f.kind === "resume") || null;
const attachmentFiles = () => (state.userFiles || []).filter((f) => f.kind === "attachment");
const userFileById = (id) => (state.userFiles || []).find((f) => f.id === id) || null;

async function uploadUserFile(file, kind = "attachment") {
  if (!file) return null;
  const authUser = await requireRealSupabaseAuth("store attachments");
  if (!authUser) return null;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    toast(`${file.name} is over the 5MB attachment limit`);
    return null;
  }
  try {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: authUser.id,
        action: "upload",
        kind,
        name: file.name,
        mime: file.type || "application/octet-stream",
        dataBase64: await fileToBase64(file),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      toast(data.error || "Could not save the file");
      return null;
    }
    state.userFiles = state.userFiles || [];
    if (kind === "resume") state.userFiles = state.userFiles.filter((f) => f.kind !== "resume");
    state.userFiles.push(data.file);
    return data.file;
  } catch {
    toast("Could not save the file (network)");
    return null;
  }
}

async function deleteUserFile(id) {
  const authUser = await requireRealSupabaseAuth("store attachments");
  if (!authUser) return false;
  try {
    const res = await fetch("/api/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: authUser.id, action: "delete", id }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) state.userFiles = (state.userFiles || []).filter((f) => f.id !== id);
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

/* which user_files ride along with a given door's knock */
function attachmentIdsForDoor(d) {
  const attach = d?.attach || {};
  const wantResume = attach.resume !== undefined
    ? attach.resume
    : Boolean(state.sendPrefs?.attachResume);
  const ids = [...(attach.fileIds || [])];
  const resume = resumeFile();
  if (wantResume && resume) ids.unshift(resume.id);
  return [...new Set(ids)].slice(0, MAX_EXTRA_ATTACHMENTS + 1);
}

function metadataForFileId(id) {
  const f = userFileById(id);
  return f ? {
    id: f.id,
    fileId: f.id,
    fileName: f.name,
    name: f.name,
    mimeType: f.mime || "application/octet-stream",
    size: f.sizeBytes || 0,
    saved: true,
    kind: f.kind,
  } : { id, fileId: id, fileName: "saved attachment", name: "saved attachment", saved: true };
}

function sentAttachmentMetadata({ ids = [], oneOffs = [] } = {}) {
  const saved = [...new Set(ids)].map(metadataForFileId);
  const local = (oneOffs || []).map((a) => ({
    id: a.id,
    fileName: a.fileName || a.name || "attachment",
    name: a.fileName || a.name || "attachment",
    mimeType: a.mimeType || a.type || "application/octet-stream",
    size: a.size || a.sizeBytes || 0,
    contentBase64: a.contentBase64 || "",
    oneOff: true,
  }));
  return [...saved, ...local].slice(0, MAX_EXTRA_ATTACHMENTS + 1);
}

function mergeAttachments(remote = [], local = []) {
  const byKey = new Map();
  for (const a of [...local, ...remote]) {
    const name = a.fileName || a.filename || a.name || "attachment";
    const size = a.size || a.sizeBytes || 0;
    byKey.set(`${name}:${size}`, { ...byKey.get(`${name}:${size}`), ...a, fileName: name, name });
  }
  return [...byKey.values()];
}

/* ---------------- message status vocabulary ---------------- */
const STATUS_UI = {
  drafting: ["Drafting", "drafting"],
  queued: ["Queued", "queued"],
  paused: ["Paused", "paused"],
  scheduled: ["Scheduled", "scheduled"],
  sending: ["Sending", "sending"],
  sent: ["Sent", "sent"],
  followup_sent: ["Followed up", "followup"],
  opened: ["Sent", "sent"],
  replied: ["Replied", "replied"],
  needs_review: ["Reply drafted, review", "review"],
  drafting_reply: ["Generating reply", "drafting"],
  auto_replying: ["Auto-replying", "sending"],
  waiting_gmail: ["Connect Google", "gmail"],
  failed: ["Failed", "failed"],
  meeting: ["Meeting booked", "meeting"],
};
function stChip(status) {
  const [label, cls] = STATUS_UI[status] || [status, "drafted"];
  return `<span class="st st--${cls}"><i></i>${esc(label)}</span>`;
}

/* ---------------- icons (inline SVG, currentColor) ---------------- */
const I = {
  search: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>',
  story: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.34 0-10 1.67-10 5v3h20v-3c0-3.33-6.66-5-10-5z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm14 8H3v10h18zM3 8h18V6H3z"/></svg>',
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

function renderAppError(err, context = "render") {
  const message = err?.message || String(err || "Unknown app error");
  console.error(`[knock] ${context} failed:`, err);
  view.innerHTML = `<div class="viewwrap"><div class="ghost">
    <div class="ghost__icon">${I.bell}</div>
    <h2>Knock hit a startup error.</h2>
    <p>${esc(message)}</p>
    <button class="btn btn--accent" id="app-reload">Reload app</button>
    <p class="connlist__fine">If this keeps happening, restart the dev server and hard refresh the browser.</p>
  </div></div>`;
  $("#app-reload", view)?.addEventListener("click", () => location.reload());
  window.__knockBooted = true;
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

function renderSettingsIfCurrent() {
  if ((location.hash.replace("#", "") || "dashboard") === "settings") renderSettings();
}

const GOOGLE_CONNECT_ERRORS = {
  real_user_required: "Sign in to Knock before connecting Google.",
  missing_supabase_user: "Sign in to Knock before connecting Google.",
  missing_refresh_token: "Google did not grant offline access. Remove Knock from your Google Account permissions and try again.",
  server_not_configured: "Google connect is not configured on this server.",
  token_exchange_failed: "Google authorization failed. Try connecting again.",
  userinfo_failed: "Could not read your Google account details.",
  supabase_save_failed: "Google connected, but Knock could not save the connection.",
  connection_failed: "Google connect failed. Try again.",
};

async function connectGoogle() {
  const user = await requireRealSupabaseAuth("connect Google", {
    afterLogin: "connect_google",
  });
  if (!user) return;

  await refreshConnectionStatus({ silent: true });

  if (state.connections.google) {
    sessionStorage.removeItem("knock_google_connecting");
    sessionStorage.removeItem("knock_after_login");
    toast("Google is already connected.");
    renderSettingsIfCurrent();
    return;
  }

  sessionStorage.setItem("knock_google_connecting", "1");

  const params = new URLSearchParams({
    user_id: user.id,
    user_email: user.email || "",
    return_to: "/app/#settings",
  });

  location.href = `/api/google/connect?${params.toString()}`;
}

async function handleAfterLoginAction() {
  if (connectCallbackHandled) return;

  const action = sessionStorage.getItem("knock_after_login");
  if (!action) {
    sessionStorage.removeItem("knock_google_connecting");
    return;
  }

  const s = await waitForAuthReady();
  if (!s.hasRealUser) return;

  const url = new URL(location.href);
  if (url.searchParams.get("google") || url.searchParams.get("google_error")) return;

  sessionStorage.removeItem("knock_after_login");
  sessionStorage.removeItem("knock_google_connecting");

  if (action === "connect_google") {
    await refreshConnectionStatus({ silent: true });

    if (state.connections.google) {
      toast("Google is already connected.");
      renderSettingsIfCurrent();
      return;
    }

    await connectGoogle();
  }
}

async function handleConnectReturn() {
  const url = new URL(location.href);
  let touched = false;
  for (const provider of ["google"]) {
    const connected = url.searchParams.get(provider) === "connected";
    const error = url.searchParams.get(`${provider}_error`);
    if (!connected && !error) continue;

    sessionStorage.removeItem("knock_google_connecting");
    touched = true;
    if (isRealUuid(window.knockAuth?.user?.id)) rememberActiveUserId(window.knockAuth.user.id);
    await refreshConnectionStatus({ silent: true });

    if (connected) {
      toast("Google connected.");
      const pendingVoice = sessionStorage.getItem("knock_after_google_connect");
      if (pendingVoice === "learn_voice") {
        sessionStorage.removeItem("knock_after_google_connect");
        toast("Google connected. Tap Learn from Gmail when you are ready.");
      }
    } else {
      toast(GOOGLE_CONNECT_ERRORS[error] || `Google connect failed: ${String(error || "unknown_error").replace(/_/g, " ")}`);
    }
  }
  if (touched) {
    connectCallbackHandled = true;
    sessionStorage.removeItem("knock_after_login");
    history.replaceState(null, "", `${location.pathname}${location.hash || "#settings"}`);
    renderSettingsIfCurrent();
  }
}

function releaseWaitingGmailMessages() {
  if (!state.connections.google) return 0;
  let released = 0;
  state.messages.forEach((m) => {
    if (m.status === "waiting_gmail") {
      m.status = "queued";
      released++;
    }
  });
  if (released) {
    saveLive();
    state.messages.forEach((m) => m.status === "queued" && updateMessageRow(m));
    processSendQueue();
  }
  return released;
}

async function refreshConnectionStatus({ silent = true } = {}) {
  const s = await waitForAuthReady();
  if (!s.hasRealUser) {
    const changed = Boolean(state.connections.google);
    state.connections.google = false;
    saveConnections();
    return { ...state.connections, changed };
  }
  try {
    const before = Boolean(state.connections.google);
    const res = await fetch("/api/connections/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: s.user.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      state.connections.google = Boolean(data.connections?.google?.connected || data.connections?.google || data.google);
      saveConnections();
      const changed = before !== Boolean(state.connections.google);
      if (changed && state.connections.google) releaseWaitingGmailMessages();
      return { ...state.connections, changed };
    }
    if (!silent) toast(data.message || data.error || "Could not check Google connection");
  } catch {
    if (!silent) toast("Could not check Google connection");
  }
  return { ...state.connections, changed: false };
}

async function recheckConnectionStatus() {
  const auth = window.knockAuth;
  try {
    if (auth?.ready) await auth.ready;
    if (auth?.client) {
      const { data } = await auth.client.auth.getSession();
      const sessionUser = data?.session?.user;
      if (sessionUser?.id) {
        const name = sessionUser.user_metadata?.full_name || sessionUser.email || auth.user?.name || "";
        auth.user = {
          ...(auth.user || {}),
          id: sessionUser.id,
          email: sessionUser.email || auth.user?.email || "",
          name,
          avatar: sessionUser.user_metadata?.avatar_url || auth.user?.avatar,
          initials: (name || sessionUser.email || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(""),
        };
        rememberActiveUserId(sessionUser.id);
      }
    }
    await refreshConnectionStatus({ silent: false });
    toast("Connection status refreshed");
    renderSettings();
  } catch {
    toast("Could not refresh connection status");
  }
}

async function disconnectProvider(provider) {
  const user = await requireRealSupabaseAuth(`disconnect ${provider}`);
  if (!user) return;
  state.connections[provider] = false;
  saveConnections();
  try {
    await fetch("/api/connections/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: user.id, provider }),
    });
  } catch { /* local state already cleared */ }
  toast(`${provider === "google" ? "Google" : "Outlook"} disconnected`);
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
  $("#knocks-bar").style.width = Math.max(0, Math.min(100, (state.knocks / knockLimit()) * 100)) + "%";
  const planEl = $(".knocks-card__plan");
  if (planEl) planEl.textContent = state.plan === "unlimited" ? "Unlimited plan" : state.plan === "pro" ? "Pro plan · resets monthly" : "Free plan · resets monthly";
  updateApolloCard();
  const badge = $("#inbox-badge");
  const needsReview = state.messages.filter((m) => m.status === "needs_review").length;
  badge.hidden = needsReview === 0;
  badge.textContent = needsReview;
  const streak = bumpStreak();
  $("#streak").innerHTML = `<i></i>${streak}-day streak`;
}

function updateApolloCard() {
  const status = $("#apollo-status-pill");
  if (!status) return;
  const u = state.apolloUsage || {};
  status.textContent = u.configured ? "live" : "demo";
  status.classList.toggle("is-off", !u.configured);
  const api = $("#apollo-api-left");
  if (api) {
    api.textContent = Number.isFinite(u.apiDayLeft) && Number.isFinite(u.apiDayLimit)
      ? `${u.apiDayLeft}/${u.apiDayLimit}`
      : u.configured ? "live" : "off";
  }
  const credits = $("#apollo-credit-used");
  if (credits) credits.textContent = String(u.enrichCreditsUsed || 0);
  const note = $("#apollo-note");
  if (note) {
    note.textContent = u.configured
      ? "Emails use enrichment credits only after approval."
      : "Set APOLLO_API_KEY for live sourcing.";
  }
}

function noteApolloSearch(meta = {}) {
  state.apolloUsage.peopleSearched = (state.apolloUsage.peopleSearched || 0) + Number(meta.searchedPeople || 0);
  if (Number(meta.enrichedPeople) > 0) {
    state.apolloUsage.enrichCreditsUsed = (state.apolloUsage.enrichCreditsUsed || 0) + Number(meta.enrichedPeople || 0);
  }
  state.apolloUsage.updatedAt = new Date().toISOString();
  saveApolloUsage();
  updateApolloCard();
}

async function refreshApolloUsage() {
  try {
    const res = await fetch("/api/apollo/usage");
    const data = await res.json();
    state.apolloUsage.configured = Boolean(data.configured);
    if (data.daily) {
      state.apolloUsage.apiDayLeft = data.daily.left;
      state.apolloUsage.apiDayLimit = data.daily.limit;
    }
    state.apolloUsage.updatedAt = new Date().toISOString();
    saveApolloUsage();
    updateApolloCard();
  } catch {
    updateApolloCard();
  }
}

/* ============================================================
   ROUTER
   ============================================================ */
/* "people" stays as a route alias: Find People merged into the dashboard */
const routes = { dashboard: renderDashboard, people: renderDashboard, inbox: renderInbox, tracker: renderTracker, profile: renderProfile, settings: renderSettings };

function navigate() {
  try {
    const route = location.hash.replace("#", "") || "dashboard";
    const fn = routes[route] || renderDashboard;
    $$(".side__link").forEach((a) => a.classList.toggle("is-active", a.dataset.route === route));
    view.scrollTop = 0;
    fn();
    updateChrome();
    window.__knockBooted = true;
    /* reply/follow-up sync runs while live message views are on screen */
    if (route === "dashboard" || route === "people" || route === "tracker" || route === "inbox") startSyncPolling();
    else stopSyncPolling();
  } catch (err) {
    renderAppError(err, "route render");
  }
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
  ["all", "All"],
  ["founders", "Founders"], ["hiring_managers", "Hiring managers"],
  ["investors", "Investors"], ["operators", "Operators"],
];
const modeLabel = (id) => (SEARCH_MODES_UI.find(([m]) => m === id) || [, "Founders"])[1];
const noFiltersActive = () => Object.values(state.searchFilters || {}).every((arr) => !(arr || []).length);

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
      body: JSON.stringify({ profile: state.profile, searchMode: state.searchMode, mode: state.searchMode, filters: state.searchFilters, limit: 100, page: 1 }),
    });
    const data = await res.json();
    clearInterval(ticker);
    state.sourcing = false;
    if (!res.ok) throw new Error(data.error || "Sourcing failed");
    state.doors = (data.doors || []).slice(0, MAX_DOORS_LOADED);
    state.doorsMeta = {
      ...data.meta,
      /* the initial bulk fetch covers pages 1..N in PAGE_SIZE units;
         prefetch continues from there with limit = PAGE_SIZE */
      apolloPage: Math.max(data.meta?.page || 1, Math.ceil(state.doors.length / PAGE_SIZE)),
      hasMore: data.meta?.hasMore === true && state.doors.length < MAX_DOORS_LOADED,
      capReached: (data.doors || []).length >= MAX_DOORS_LOADED && data.meta?.hasMore === true,
    };
    state.doorsPage = 0;
    state.selectedDoors = new Set();
    noteApolloSearch(data.meta);
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
  const msg = queuedIds.has(d.id) ? latestMsgForDoor(d.id) : null;
  return `
    <tr data-id="${d.id}" class="${queuedIds.has(d.id) ? "is-queued" : ""}">
      <td class="door-st">${queuedIds.has(d.id)
        ? stChip(msg?.status || "queued")
        : `<input type="checkbox" class="door-check" data-id="${d.id}" ${state.selectedDoors.has(d.id) ? "checked" : ""}>`}</td>
      <td><div class="cell-who"><div><strong>${esc(d.name)}</strong><small>${esc(d.title || "")}${d.location ? " · " + esc(d.location) : ""}</small></div></div></td>
      <td>${d.companyName ? `<div class="cell-co">${logo(d.companyName, d.companyDomain, 24)}<span>${esc(d.companyName)}</span></div>` : "·"}</td>
      <td>${ring(d.matchScore, 40)}</td>
      <td><div class="reasons">${(d.matchReasons || []).slice(0, 3).map((r) => `<span>${esc(r)}</span>`).join("")}</div></td>
      <td class="cell-draft"><b>${esc(d.draft?.subject || "")}</b><small>${esc((d.draft?.preview || "").slice(0, 90))}…</small></td>
      <td class="cell-links"><button class="btn btn--paper btn--sm act-review" data-id="${d.id}">Review knock</button></td>
    </tr>`;
}

function pager(total, page, idPrefix) {
  const cappedTotal = idPrefix === "doors" ? Math.min(total, MAX_DOORS_LOADED) : total;
  const pages = Math.ceil(cappedTotal / PAGE_SIZE);
  if (pages <= 1) return "";
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(cappedTotal, (page + 1) * PAGE_SIZE);
  const loading = idPrefix === "doors" && state.prefetchingDoors;
  const capped = idPrefix === "doors" && total >= MAX_DOORS_LOADED && (state.doorsMeta || {}).hasMore;
  return `<div class="pager" id="${idPrefix}-pager">
    <span class="pager__hint">Showing ${from}–${to} of ${cappedTotal}${capped ? " · refine search for more" : ""}</span>
    <button class="btn btn--paper btn--sm" data-p="${page - 1}" ${page === 0 ? "disabled" : ""}>← Prev</button>
    ${Array.from({ length: pages }, (_, i) =>
      `<button class="pager__num ${i === page ? "is-on" : ""}" data-p="${i}">${i + 1}</button>`).join("")}
    <button class="btn btn--paper btn--sm" data-p="${page + 1}" ${page >= pages - 1 ? "disabled" : ""}>Next →</button>
    ${loading ? `<span class="pager__loading"><i></i>finding more...</span>` : ""}
  </div>`;
}

/* ---- background pagination: when the user hits the last loaded UI page,
   quietly pull the next Apollo page and grow the pager ---- */
async function prefetchNextDoorsPage() {
  if (state.prefetchingDoors || !state.profile || !(state.doors || []).length) return;
  if ((state.doorsMeta || {}).hasMore !== true) return;
  if (state.doors.length >= MAX_DOORS_LOADED) {
    state.doorsMeta = { ...(state.doorsMeta || {}), capReached: true };
    refreshDoorsPager();
    return;
  }
  state.prefetchingDoors = true;
  refreshDoorsPager();
  try {
    /* keep pulling until something new lands (dedupe can eat whole pages) or
       Apollo is exhausted — "next page" must always find more if more exist */
    for (let attempt = 0; attempt < 3; attempt++) {
      const meta = state.doorsMeta || {};
      if (meta.hasMore !== true) break;
      const nextPage = (meta.apolloPage || Math.ceil(state.doors.length / PAGE_SIZE)) + 1;
      const body = {
        profile: state.profile, searchMode: state.searchMode, mode: state.searchMode,
        filters: state.searchFilters, limit: PAGE_SIZE,
      };
      /* the server walks search plans via an opaque cursor; fall back to plain
         page numbers for older responses and mock mode */
      if (meta.cursor) body.cursor = meta.cursor;
      else body.page = nextPage;
      const res = await fetch("/api/sourcing/apollo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "prefetch failed");
      const seenIds = new Set(state.doors.map((d) => d.id));
      const seenApollo = new Set(state.doors.map((d) => d.apolloPersonId).filter(Boolean));
      const room = Math.max(0, MAX_DOORS_LOADED - state.doors.length);
      const fresh = (data.doors || []).filter((d) =>
        !seenIds.has(d.id) && !(d.apolloPersonId && seenApollo.has(d.apolloPersonId))).slice(0, room);
      state.doors.push(...fresh);
      state.doorsMeta = {
        ...meta,
        ...data.meta,
        apolloPage: nextPage,
        hasMore: data.meta?.hasMore === true && state.doors.length < MAX_DOORS_LOADED,
        cursor: data.meta?.cursor || null,
        capReached: state.doors.length >= MAX_DOORS_LOADED && data.meta?.hasMore === true,
      };
      noteApolloSearch(data.meta);
      saveLive();
      if (fresh.length) break; /* got new people; stop until the user pages on */
    }
  } catch {
    /* network hiccup or API offline: stop trying this session, retry on next sourcing */
    state.doorsMeta = { ...(state.doorsMeta || {}), hasMore: false };
  } finally {
    state.prefetchingDoors = false;
    refreshDoorsPager();
  }
}

/* targeted pager refresh, keeps table scroll position intact */
function refreshDoorsPager() {
  if ((location.hash.replace("#", "") || "dashboard") !== "dashboard") return;
  const doors = availableDoorsForLaunch();
  const old = $("#doors-pager", view);
  if (!old) {
    /* results used to fit one page and the pager wasn't rendered:
       repaint the queue once so the new page appears */
    if (doors.length > PAGE_SIZE && $(".doors-table", view) && !state.prefetchingDoors) renderDoorsQueue();
    return;
  }
  const page = Math.min(state.doorsPage, Math.max(0, Math.ceil(doors.length / PAGE_SIZE) - 1));
  const holder = document.createElement("div");
  holder.innerHTML = pager(doors.length, page, "doors");
  const next = holder.firstElementChild;
  if (next) { old.replaceWith(next); wireDoorsPager(); }
  const statDoors = $("#stat-doors", view);
  if (statDoors) statDoors.textContent = (state.doors || []).length;
}

function wireDoorsPager() {
  $("#doors-pager", view)?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (!b || b.disabled) return;
    state.doorsPage = +b.dataset.p;
    renderDoorsQueue();
  });
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

function sortedDoorsForDisplay(doors = []) {
  const list = [...doors];
  const byName = (d) => `${d.companyName || ""} ${d.name || ""}`.toLowerCase();
  if (state.doorSort === "match_asc") return list.sort((a, b) => (a.matchScore || 0) - (b.matchScore || 0) || byName(a).localeCompare(byName(b)));
  if (state.doorSort === "company_asc") return list.sort((a, b) => (a.companyName || "").localeCompare(b.companyName || "") || (b.matchScore || 0) - (a.matchScore || 0));
  if (state.doorSort === "recent") return list.reverse();
  return list.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0) || byName(a).localeCompare(byName(b)));
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
  const availableDoors = availableDoorsForLaunch();
  state.selectedDoors = new Set([...state.selectedDoors].filter((id) => availableDoors.some((d) => d.id === id)));
  const displayDoors = sortedDoorsForDisplay(availableDoors).slice(0, MAX_DOORS_LOADED);
  const meta = state.doorsMeta || {};
  const isMock = doors[0]?.source === "mock";
  const queuedIds = new Set();
  const totalPages = Math.max(1, Math.ceil(displayDoors.length / PAGE_SIZE));
  const page = Math.min(state.doorsPage, totalPages - 1);
  const slice = displayDoors.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const avgMatch = Math.round(doors.reduce((s, d) => s + (d.matchScore || 0), 0) / doors.length);
  const allMode = state.searchMode === "all";
  const sentCount = state.messages.filter((m) => ["sent", "scheduled", "followup_sent", "opened", "replied", "needs_review", "meeting"].includes(m.status)).length;

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${greeting()}, ${firstName()}. ${isMock ? '<span class="badge badge--hiring">demo data</span>' : ""}</h1>
      <p>${allMode && noFiltersActive()
        ? `Scout is surfacing the ${doors.length} highest matches for your profile across every persona. Select the ones you want, review the drafts, then launch.`
        : `Scout found ${doors.length} doors matched to your profile. Select the ones you want, review the drafts, then launch.`}</p>
    </div>

    <div class="statgrid">
      <div class="statcard"><small>Doors found</small><div class="num" id="stat-doors">${doors.length}</div><span class="delta">${allMode ? "highest matches, every persona" : "searching as " + modeLabel(state.searchMode)}</span></div>
      <div class="statcard"><small>Average match</small><div class="num">${avgMatch}%</div><span class="delta">scored against your story</span></div>
      <div class="statcard"><small>Knocks in motion</small><div class="num">${state.messages.length}</div><span class="delta">${sentCount} sent so far</span></div>
      <div class="statcard"><small>Knocks left</small><div class="num">${state.knocks}</div><span class="delta">${state.plan === "unlimited" ? "unlimited" : state.plan === "pro" ? "pro" : "free"} plan · resets monthly</span></div>
    </div>

    ${shouldShowSendStrip() && !stripDismissed() ? `<div class="qbanner" id="send-strip">${sendStripHTML()}</div>` : ""}

    <div class="rowhead">
      <h2>Your launch queue</h2>
      <span class="rowhead__hint">${meta.searchedPeople || doors.length} people searched · ${meta.creditsLikelyUsed ? "credits used" : "no Apollo credits used"}</span>
      <div class="rowhead__actions">
        ${SEARCH_MODES_UI.map(([id, label]) =>
          `<button class="pill ${state.searchMode === id ? "is-on" : ""}" data-mode="${id}">${label}</button>`).join("")}
        <label class="sortctl">Sort
          <select id="door-sort">
            <option value="match_desc" ${state.doorSort === "match_desc" ? "selected" : ""}>Match high to low</option>
            <option value="match_asc" ${state.doorSort === "match_asc" ? "selected" : ""}>Match low to high</option>
            <option value="company_asc" ${state.doorSort === "company_asc" ? "selected" : ""}>Company A-Z</option>
            <option value="recent" ${state.doorSort === "recent" ? "selected" : ""}>Newest found</option>
          </select>
        </label>
        <button class="btn btn--paper btn--sm" id="add-contact" title="Track someone you found yourself">+ Add contact</button>
        <button class="btn btn--sm" id="launch" disabled>Approve &amp; launch</button>
      </div>
    </div>
    ${filterBar()}
    ${displayDoors.length ? `<div class="tablewrap"><table class="doors-table">
      <thead><tr><th><input type="checkbox" id="check-page" title="Select everyone on this page"></th><th>Person</th><th>Company</th><th>Match</th><th>Why</th><th>Draft</th><th></th></tr></thead>
      <tbody>${slice.map((d) => doorRow(d, queuedIds)).join("")}</tbody>
    </table></div>` : `<div class="ghost">
      <div class="ghost__icon">${I.plane}</div>
      <h2>All visible doors are already in motion.</h2>
      <p>Sent, replied, and meeting-booked contacts now live in Inbox and Tracker so this launch queue stays clean.</p>
      <button class="btn btn--accent" id="dash-open-tracker">Open tracker</button>
      <button class="btn btn--paper" id="dash-search-again">Search again</button>
    </div>`}
    ${pager(displayDoors.length, page, "doors")}
    ${(meta.warnings || []).map((w) => `<p class="meta-warn">${esc(w)}</p>`).join("")}
  </div>`;

  if (displayDoors.length) wireDoorsTable(slice, queuedIds);
  wireFilterBar();
  wireSendStrip();
  $("#add-contact", view)?.addEventListener("click", openAddContact);
  $("#dash-open-tracker", view)?.addEventListener("click", () => { location.hash = "tracker"; });
  $("#dash-search-again", view)?.addEventListener("click", runSourcing);

  $$(".rowhead .pill", view).forEach((p) => p.addEventListener("click", () => {
    state.searchMode = p.dataset.mode;
    save("knock_search_mode", state.searchMode);
    runSourcing();
  }));
  $("#door-sort", view)?.addEventListener("change", (e) => {
    state.doorSort = e.target.value;
    state.doorsPage = 0;
    save("knock_door_sort", state.doorSort);
    renderDoorsQueue();
  });
  wireDoorsPager();
  /* user is close to the last loaded UI page: preload the next Apollo page */
  if (displayDoors.length && page >= totalPages - 2) prefetchNextDoorsPage();
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

/* ---- live send progress strip (dashboard) ----
   The strip is dismissable: acting on its CTA (or the ×) hides it until the
   pipeline state actually changes, then it reappears with the news. */
function stripSig() {
  const counts = {};
  for (const m of state.messages.filter(stripActionableMessages)) {
    counts[m.status] = (counts[m.status] || 0) + 1;
    if (m.unread) counts.unread = (counts.unread || 0) + 1;
  }
  return Object.entries(counts).sort().map(([k, v]) => `${k}:${v}`).join("|");
}
const stripDismissed = () => load("knock_strip_dismissed", "") === stripSig();
function stripActionableMessages(m) {
  return Boolean(m?.unread || ["drafting", "sending", "queued", "paused", "waiting_gmail", "failed", "needs_review"].includes(m?.status));
}
function shouldShowSendStrip() {
  return state.messages.some(stripActionableMessages);
}
function dismissSendStrip() {
  save("knock_strip_dismissed", stripSig());
  $("#send-strip", view)?.remove();
}

function sendStripHTML() {
  return `${sendStripBody()}<button class="qbanner__x" id="ss-dismiss" title="Dismiss">&times;</button>`;
}

function sendStripBody() {
  const msgs = state.messages.filter(stripActionableMessages);
  const total = msgs.length;
  const by = (...sts) => msgs.filter((m) => sts.includes(m.status)).length;
  const unread = msgs.filter((m) => m.unread).length;
  const inflight = by("drafting", "sending");
  const waiting = by("waiting_gmail");
  const failed = by("failed");
  const queuedN = by("queued", "paused");
  const review = by("needs_review");
  const bar = total ? `<div class="sendstrip__bar"><i style="width:${Math.round((inflight / total) * 100)}%"></i></div>` : "";

  if (review || unread) return `
    <div class="qbanner__icn">${I.mail}</div>
    <div>
      <b>${review ? `${review} repl${review === 1 ? "y" : "ies"} ready for review` : `${unread} new repl${unread === 1 ? "y" : "ies"}`}</b>
      <p>Open Inbox to review the warmest threads and keep the conversation moving.</p>
    </div>
    <a class="btn btn--paper btn--sm" href="#inbox">Open inbox</a>`;

  if (inflight || (sendRunActive && queuedN)) return `
    <div class="qbanner__icn qbanner__icn--live">${I.plane}</div>
    <div>
      <b>Scout is sending ${inflight || queuedN} knock${(inflight || queuedN) === 1 ? "" : "s"}</b>
      <p>${inflight ? "Drafting and sending live from your Gmail." : "Working through the queue."}${failed ? ` ${failed} failed, retry from the tracker.` : ""}</p>
      ${bar}
    </div>
    <a class="btn btn--paper btn--sm" href="#tracker">Watch live</a>`;
  if (waiting) return `
    <div class="qbanner__icn">${I.plug}</div>
    <div>
      <b>${waiting} knock${waiting === 1 ? "" : "s"} waiting on Gmail</b>
      <p>Connect Google and Scout sends them immediately from your own inbox, then tracks replies.</p>
    </div>
    <button class="btn btn--accent btn--sm" id="ss-google">Connect Google to send</button>`;
  if (failed) return `
    <div class="qbanner__icn">${I.bell}</div>
    <div>
      <b>${failed} knock${failed === 1 ? "" : "s"} failed to send</b>
      <p>Open the tracker to retry the ones that bounced.</p>
    </div>
    <a class="btn btn--paper btn--sm" href="#tracker">Open tracker</a>`;
  if (queuedN) return `
    <div class="qbanner__icn">${I.plane}</div>
    <div>
      <b>${queuedN} knock${queuedN === 1 ? "" : "s"} queued</b>
      <p>${state.knocks === 0 ? "You're out of knocks this month. Go Pro to keep sending." : "Paused or held. Resume them from the tracker and Scout sends right away."}</p>
    </div>
    ${state.knocks === 0 ? `<button class="btn btn--accent btn--sm" id="ss-upgrade">Go Pro</button>` : `<a class="btn btn--paper btn--sm" href="#tracker">Open tracker</a>`}`;
  return `
    <div class="qbanner__icn">${I.mail}</div>
    <div>
      <b>Knock is watching your active threads</b>
      <p>Open the tracker for the full pipeline.</p>
    </div>
    <a class="btn btn--paper btn--sm" href="#tracker">Open tracker</a>`;
}

function wireSendStrip() {
  const strip = $("#send-strip", view);
  if (!strip || strip.dataset.wired) return;
  strip.dataset.wired = "1";
  strip.addEventListener("click", (e) => {
    if (e.target.closest("#ss-google")) return connectGoogle();
    if (e.target.closest("#ss-upgrade")) return openUpgrade();
    if (e.target.closest("#ss-dismiss")) return dismissSendStrip();
    /* following the CTA acknowledges the notice: hide it until news arrives */
    if (e.target.closest("a[href='#tracker']")) save("knock_strip_dismissed", stripSig());
  });
}

function refreshSendStrip() {
  const strip = $("#send-strip", view);
  if (!shouldShowSendStrip()) {
    strip?.remove();
    return;
  }
  if (strip) {
    if (stripDismissed()) strip.remove();
    else strip.innerHTML = sendStripHTML();
    return;
  }
  /* dismissed earlier but the pipeline moved: bring the strip back with the news */
  const anchor = $(".statgrid", view);
  if (anchor && shouldShowSendStrip() && !stripDismissed()) {
    const holder = document.createElement("div");
    holder.className = "qbanner";
    holder.id = "send-strip";
    holder.innerHTML = sendStripHTML();
    anchor.insertAdjacentElement("afterend", holder);
    wireSendStrip();
  }
}

/* attachments block shared by the review modal: resume toggle + saved files
   + upload. Selections persist per door on d.attach = { resume, fileIds }. */
function attachBlockHTML(d) {
  const resume = resumeFile();
  const attach = d.attach || {};
  const resumeOn = attach.resume !== undefined ? attach.resume : Boolean(state.sendPrefs?.attachResume);
  const selected = new Set(attach.fileIds || []);
  const extras = attachmentFiles();
  const oneOffs = d.oneOffAttachments || [];
  return `
    <label>Attachments</label>
    <div class="attachbox" id="attachbox">
      <div class="attachgroup">
        <b>Additional attachments</b>
        <small>Sent with this knock only.</small>
        ${oneOffs.length ? `<div class="oneoff-list attach-oneoffs">${oneOffs.map((a) => `
          <span class="filechip">${icon("doc")} ${esc(attachmentLabel(a))}
            <button class="chip-x att-oneoff-remove" data-id="${esc(a.id)}" title="Remove">&times;</button>
          </span>`).join("")}</div>` : `<p class="connlist__fine">No one-off files added for this draft.</p>`}
      </div>
      <div class="attachadd" id="att-drop">
        <button type="button" class="pill" id="att-add">+ Add one-off file</button>
        <small>or drag &amp; drop</small>
        <input type="file" id="att-input" multiple hidden>
      </div>
      <div class="attachgroup attachgroup--saved">
        <b>Saved attachments</b>
        <small>Manage saved attachments in Settings.</small>
        <label class="attachrow ${resume ? "" : "is-off"}">
          <input type="checkbox" id="att-resume" ${resume && resumeOn ? "checked" : ""} ${resume ? "" : "disabled"}>
          <span class="attachrow__ico">${I.doc}</span>
          <span class="attachrow__name">${resume ? `My resume · ${esc(resume.name)}` : "My resume"}</span>
          ${resume ? "" : `<small>Upload your resume on the Profile page first</small>`}
        </label>
        ${extras.map((f) => `
          <label class="attachrow">
            <input type="checkbox" class="att-file" data-id="${f.id}" ${selected.has(f.id) ? "checked" : ""}>
            <span class="attachrow__ico">${I.doc}</span>
            <span class="attachrow__name">${esc(f.name)}</span>
            <small>${Math.max(1, Math.round((f.sizeBytes || 0) / 1024))} KB</small>
          </label>`).join("")}
        ${!resume && !extras.length ? `<p class="connlist__fine">No saved attachments yet. Add them in Settings.</p>` : ""}
      </div>
    </div>`;
}

function readAttachSelection() {
  return {
    resume: Boolean($("#att-resume", modal)?.checked),
    fileIds: $$(".att-file", modal).filter((c) => c.checked).map((c) => c.dataset.id),
  };
}

function wireAttachBlock(d, rerender) {
  const saveSel = () => { d.attach = readAttachSelection(); saveLive(); };
  $("#att-resume", modal)?.addEventListener("change", saveSel);
  $$(".att-file", modal).forEach((c) => c.addEventListener("change", saveSel));
  $$(".att-oneoff-remove", modal).forEach((b) => b.addEventListener("click", () => {
    d.oneOffAttachments = (d.oneOffAttachments || []).filter((a) => a.id !== b.dataset.id);
    saveLive();
    rerender();
  }));
  const input = $("#att-input", modal);
  const addFiles = async (files) => {
    const room = MAX_EXTRA_ATTACHMENTS - (d.oneOffAttachments || []).length;
    const list = [...(files || [])].slice(0, Math.max(0, room));
    if (!list.length && (files || []).length) {
      toast(`This knock already has ${MAX_EXTRA_ATTACHMENTS} one-off attachments`);
      return;
    }
    let added = 0;
    for (const f of list) {
      const oneOff = await attachmentFromFile(f);
      if (oneOff) {
        d.oneOffAttachments = [...(d.oneOffAttachments || []), oneOff];
        added++;
      }
    }
    if (added) {
      saveLive();
      toast(`${added} attachment${added === 1 ? "" : "s"} added`);
      rerender();
    }
  };
  $("#att-add", modal)?.addEventListener("click", () => input.click());
  input?.addEventListener("change", () => addFiles(input.files));
  const drop = $("#att-drop", modal);
  ["dragover", "dragenter"].forEach((ev) => drop?.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop?.addEventListener(ev, (e) => {
    e.preventDefault();
    drop.classList.remove("is-drag");
    if (ev === "drop") addFiles(e.dataTransfer.files);
  }));
}

function openDoorDraft(d) {
  openModal(`
    <h2 style="font-size:1.2rem">Review knock</h2>
    <p class="sub">To ${esc(d.name)} · ${esc(d.title || "")}${d.companyName ? " at " + esc(d.companyName) : ""}</p>
    <label>Subject</label>
    <input type="text" id="dd-subject" value="${esc(d.draft?.subject || "")}">
    <label>Email</label>
    <div class="pcard" style="white-space:pre-wrap;font-size:.88rem;line-height:1.55" contenteditable="true" id="dd-body">${esc(d.draft?.body || d.draft?.preview || "")}</div>
    <p class="connlist__fine">Edit the draft directly. Your changes are saved when you close.</p>
    ${attachBlockHTML(d)}
    <div class="modal__actions">
      <button class="btn btn--premium" id="dd-improve">${icon("spark")} Improve with AI <span class="prochip">Pro</span></button>
      <button class="btn btn--paper" id="dd-undo" hidden>Undo</button>
      <span class="modal__spacer"></span>
      <button class="btn btn--paper" id="dd-close">Close</button>
      <button class="btn btn--accent" id="dd-select">${state.selectedDoors.has(d.id) ? "Selected ✓" : "Select for campaign"}</button>
    </div>`);
  let undoDraft = null;
  const persist = () => {
    const text = noEmDash($("#dd-body").innerText.trim());
    const subject = noEmDash($("#dd-subject").value.trim());
    if ((text && text !== d.draft?.body) || (subject && subject !== d.draft?.subject)) {
      /* the user rewrote the draft in their own words: learn from it */
      if (text) rememberEditedSample({ before: d.draft?.body || "", after: text, category: "cold_intro", subject });
      d.draft = { ...(d.draft || {}), subject: subject || d.draft?.subject, body: text || d.draft?.body };
      saveLive();
    }
    d.attach = readAttachSelection();
    saveLive();
  };
  /* swap just the attachments box (keeps any in-progress body edits intact) */
  const repaintAttach = () => {
    const box = $("#attachbox", modal);
    if (!box || modalScrim.hidden) return;
    const holder = document.createElement("div");
    holder.innerHTML = attachBlockHTML(d);
    box.replaceWith(holder.querySelector("#attachbox"));
    wireAttachBlock(d, repaintAttach);
  };
  wireAttachBlock(d, repaintAttach);
  /* file metadata loads in the background on first open */
  if (state.userFiles === null) loadUserFiles().then(repaintAttach);
  $("#dd-improve").addEventListener("click", async () => {
    const btn = $("#dd-improve");
    const prev = { subject: $("#dd-subject").value, body: $("#dd-body").innerText };
    btn.disabled = true;
    btn.innerHTML = `${icon("spark")} Improving…`;
    try {
      const res = await fetch("/api/knock/improve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: state.profile, door: d, subject: prev.subject, body: prev.body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) {
        toast("AI improve isn't available: the server has no OpenAI key configured");
      } else if (!res.ok || !data.ok || !data.draft) {
        throw new Error(data.error || `Improve failed (${res.status})`);
      } else {
        undoDraft = prev;
        $("#dd-subject").value = noEmDash(data.draft.subject || prev.subject);
        $("#dd-body").innerText = noEmDash(data.draft.body || prev.body);
        $("#dd-undo").hidden = false;
        toast("Draft improved. Undo brings your version back");
      }
    } catch (err) {
      toast(`Improve failed: ${esc(err.message)}`);
    }
    btn.disabled = false;
    btn.innerHTML = `${icon("spark")} Improve with AI <span class="prochip">Pro</span>`;
  });
  $("#dd-undo").addEventListener("click", () => {
    if (!undoDraft) return;
    $("#dd-subject").value = undoDraft.subject;
    $("#dd-body").innerText = undoDraft.body;
    $("#dd-undo").hidden = true;
    undoDraft = null;
    toast("Restored your previous draft");
  });
  $("#dd-close").addEventListener("click", () => { persist(); closeModal(); });
  $("#dd-select").addEventListener("click", () => {
    persist();
    state.selectedDoors.add(d.id);
    closeModal();
    navigate();
  });
}

/* ---- add your own contact: compose in Knock, or import a conversation
   you already started from Gmail so the tracker/inbox follow it ---- */
function openAddContact() {
  openModal(`
    <h2>Add your own contact</h2>
    <p class="sub">Found someone yourself? Track them here: send through Knock, or pull in an email you already sent.</p>
    <div class="chips-select chips-select--stack ac-mode">
      <button type="button" class="pill is-on" data-v="compose"><b>Compose in Knock</b> · Scout drafts it, you review and send from your Gmail</button>
      <button type="button" class="pill" data-v="import"><b>I already emailed them</b> · pull the Gmail conversation into the tracker</button>
    </div>
    <label>Name</label><input type="text" id="ac-name" placeholder="Jordan Rivers">
    <label>Email</label><input type="email" id="ac-email" placeholder="jordan@company.com">
    <div class="formrow">
      <div><label>Company (optional)</label><input type="text" id="ac-company" placeholder="Acme Capital"></div>
      <div><label>Role (optional)</label><input type="text" id="ac-title" placeholder="Partner"></div>
    </div>
    <p class="connlist__fine" id="ac-hint">Scout drafts a knock in your voice. You review it before anything sends.</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="m-cancel">Cancel</button>
      <button class="btn btn--accent" id="ac-go">Add contact</button>
    </div>`);
  const hint = $("#ac-hint", modal);
  const mode = () => $(".ac-mode .pill.is-on", modal)?.dataset.v || "compose";
  $$(".ac-mode .pill", modal).forEach((p) => p.addEventListener("click", () => {
    $$(".ac-mode .pill", modal).forEach((x) => x.classList.toggle("is-on", x === p));
    hint.textContent = p.dataset.v === "import"
      ? "Scout searches your Gmail for the conversation with this address, then tracks replies and follow-ups from here."
      : "Scout drafts a knock in your voice. You review it before anything sends.";
    $("#ac-go", modal).textContent = p.dataset.v === "import" ? "Find & track conversation" : "Add contact";
  }));
  $("#m-cancel").addEventListener("click", closeModal);
  $("#ac-go").addEventListener("click", async () => {
    const name = $("#ac-name", modal).value.trim();
    const email = $("#ac-email", modal).value.trim();
    const company = $("#ac-company", modal).value.trim();
    const title = $("#ac-title", modal).value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return obError("#ac-email", "A valid email address is required.");

    if (mode() === "import") {
      const authUser = await requireRealSupabaseAuth("import from Gmail");
      if (!authUser) return obError("#ac-email", "Sign in with a real account to import from Gmail.");
      if (!googleConnected()) return obError("#ac-email", "Connect Google in Settings first so Scout can read the thread.");
      const btn = $("#ac-go", modal);
      btn.disabled = true; btn.textContent = "Searching your Gmail…";
      try {
        const res = await fetch("/api/gmail/import-thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: authUser.id, email, name, company, title }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 404 || data.error === "no_thread_found") {
          throw new Error(data.message || "No Gmail conversation with that address was found.");
        }
        if (res.status === 412 || data.error === "google_not_connected") throw new Error("Google isn't connected.");
        if (!res.ok || !data.ok) throw new Error(data.error || `Import failed (${res.status})`);
        const msg = {
          ...data.message,
          name: data.message.name || name || email,
          company: data.message.company || company,
          title: data.message.title || title,
          threadMessages: data.threadMessages || [],
          unread: data.message.status === "replied",
          history: [{ at: data.message.sentAt, type: "imported", label: "Imported from Gmail" }],
        };
        state.messages.push(msg);
        state.inboxSelectedId = msg.id;
        save("knock_inbox_selected", msg.id);
        saveLive();
        closeModal();
        toast(`Conversation with ${msg.name} imported. Scout is watching the thread`);
        location.hash = "inbox";
      } catch (err) {
        btn.disabled = false; btn.textContent = "Find & track conversation";
        obError("#ac-email", err.message);
      }
      return;
    }

    if (!name) return obError("#ac-name", "Add their name so Scout can write to them.");
    const d = {
      id: `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: "manual",
      status: "found",
      name,
      firstName: name.split(" ")[0],
      title: title || undefined,
      companyName: company || undefined,
      email,
      emailStatus: "user_provided",
      matchScore: 100,
      matchReasons: ["Added by you"],
      signals: {},
      draft: null,
    };
    state.doors = state.doors || [];
    state.doors.unshift(d);
    state.selectedDoors.add(d.id);
    state.doorsPage = 0;
    saveLive();
    closeModal();
    toast(`${name} added to your queue. Scout is drafting the knock…`);
    /* draft with AI, then open review; an empty draft still opens for manual writing */
    try {
      const res = await fetch("/api/knock/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: state.profile, door: d, tone: state.profile?.tone, styleProfile: state.profile?.styleProfile }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.draft) {
        d.draft = { ...data.draft, subject: noEmDash(data.draft.subject), body: noEmDash(data.draft.body), source: data.source };
        saveLive();
      }
    } catch { /* manual draft is fine */ }
    if ((location.hash.replace("#", "") || "dashboard") === "dashboard") renderDoorsQueue();
    openDoorDraft(d);
  });
}

/* ---- sending preferences: confirmed before every launch unless the user
   opts out ("don't ask again" → it lives in Settings → Sending preferences) ---- */
function openSendPrefs(onDone) {
  const prefs = state.sendPrefs || { mode: "review", channel: "gmail", attachResume: false };
  const channelRow = (id, name, hint, available) => `
    <button type="button" class="pill sp-channel ${prefs.channel === id ? "is-on" : ""}" data-v="${id}" ${available ? "" : 'data-off="1"'}>
      ${name}${available ? "" : " · not connected"}
    </button>`;
  openModal(`
    <h2>How should Knock send for you?</h2>
    <p class="sub">Confirmed before every launch. Change it anytime in Settings → Sending preferences.</p>
    <label>Sending mode</label>
    <div class="chips-select chips-select--stack sp-mode">
      <button type="button" class="pill ${prefs.mode === "review" ? "is-on" : ""}" data-v="review"><b>Review every send</b> · you approve, edit, and add attachments before anything goes out</button>
      <button type="button" class="pill ${prefs.mode === "auto" ? "is-on" : ""}" data-v="auto"><b>Fully automated</b> · Scout sends and follows up on its own, at their reading hours</button>
    </div>
    <label>Channel</label>
    <div class="chips-select sp-chan">
      ${channelRow("gmail", "Gmail", "", googleConnected())}
      ${channelRow("queue", "Hold in queue", "", true)}
    </div>
    ${googleConnected() ? "" : `<p class="connlist__fine">Gmail isn't connected yet. Knocks stay safely queued until you connect it in Settings.</p>`}
    <label class="sp-skip"><input type="checkbox" id="sp-skip" ${prefs.skipPrompt ? "checked" : ""}>
      Don't show this before every launch <small>· you can always edit it in Settings → Sending preferences</small></label>
    <div class="modal__actions">
      <button class="btn btn--accent" id="sp-save">Save &amp; continue</button>
    </div>`);
  wireChips("sp-mode", { single: true });
  $$(".sp-chan .pill", modal).forEach((p) => p.addEventListener("click", () => {
    if (p.dataset.off) { toast("Gmail isn't connected yet. Connect it in Settings first"); return; }
    $$(".sp-chan .pill", modal).forEach((x) => x.classList.toggle("is-on", x === p));
  }));
  $("#sp-save").addEventListener("click", () => {
    const skipPrompt = $("#sp-skip").checked;
    state.sendPrefs = {
      mode: $(".sp-mode .pill.is-on", modal)?.dataset.v || "review",
      channel: $(".sp-chan .pill.is-on", modal)?.dataset.v || "queue",
      attachResume: Boolean(prefs.attachResume),
      skipPrompt,
    };
    /* the mode drives the agent for real: review gates replies + follow-ups */
    state.autonomy.review = state.sendPrefs.mode !== "auto";
    save("knock_autonomy", state.autonomy);
    save("knock_send_prefs", state.sendPrefs);
    schedulePersistProfile();
    closeModal();
    toast(skipPrompt
      ? "Saved. Find these anytime in Settings → Sending preferences"
      : "Sending preferences saved");
    onDone && onDone();
  });
}

function launchCampaign() {
  const selected = (state.doors || []).filter((d) => state.selectedDoors.has(d.id));
  if (!selected.length) return;
  /* confirm automation level, channel, and attachments before each launch
     (skippable via "don't show again"; then it lives in Settings) */
  if (!state.sendPrefs || !state.sendPrefs.skipPrompt) {
    return openSendPrefs(() => launchCampaignStage2(selected));
  }
  launchCampaignStage2(selected);
}

function launchCampaignStage2(selected) {
  /* knock limits: free 15/mo, pro 200/mo. Block over-approving up front. */
  if (selected.length > state.knocks) {
    openModal(`
      <h2>Not enough knocks left</h2>
      <p class="sub">You picked ${selected.length} ${selected.length === 1 ? "person" : "people"} but only have <b>${state.knocks}</b> of ${knockLimit()} knock${knockLimit() === 1 ? "" : "s"} left this month on the ${state.plan === "pro" ? "Pro" : "free"} plan.</p>
      <p class="sub">Deselect a few, or go Pro for 200 knocks a month.</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Trim my selection</button>
        <button class="btn btn--accent" id="m-pro">Go Pro →</button>
      </div>`);
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-pro").addEventListener("click", () => { closeModal(); openUpgrade(); });
    return;
  }
  openLaunchReview(selected);
}

/* ---- Knock-styled date & time picker (replaces the browser default) ----
   mountKdt(container) renders a display field + popover calendar and exposes
   getValue(): Date | null. Knock paper/ink styling, no native widgets. */
const KDT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const KDT_DOW = ["S", "M", "T", "W", "T", "F", "S"];

function mountKdt(container) {
  const now = new Date();
  const st = { y: now.getFullYear(), mo: now.getMonth(), day: null, h: 9, min: 0, open: false };

  const sel = () => st.day === null ? null : new Date(st.y, st.mo, st.day, st.h, st.min);
  const fmt = () => {
    const d = sel();
    return d
      ? d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : "Send now";
  };

  const render = () => {
    const first = new Date(st.y, st.mo, 1).getDay();
    const daysIn = new Date(st.y, st.mo + 1, 0).getDate();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cells = [];
    for (let i = 0; i < first; i++) cells.push("<i></i>");
    for (let d = 1; d <= daysIn; d++) {
      const dt = new Date(st.y, st.mo, d);
      const past = dt < today;
      const isToday = dt.getTime() === today.getTime();
      const on = st.day === d;
      cells.push(`<button type="button" class="kdt__day ${on ? "is-on" : ""} ${isToday ? "is-today" : ""}" data-d="${d}" ${past ? "disabled" : ""}>${d}</button>`);
    }
    const h12 = ((st.h + 11) % 12) + 1;
    container.innerHTML = `
      <button type="button" class="kdt__display ${st.day !== null ? "is-set" : ""}" id="kdt-display">
        ${icon("cal")} <span>${esc(fmt())}</span>${st.day !== null ? '<b class="kdt__clearmini" title="Clear">&times;</b>' : ""}
      </button>
      <div class="kdt__pop" ${st.open ? "" : "hidden"}>
        <div class="kdt__head">
          <button type="button" class="kdt__nav" data-nav="-1">‹</button>
          <b>${KDT_MONTHS[st.mo]} ${st.y}</b>
          <button type="button" class="kdt__nav" data-nav="1">›</button>
        </div>
        <div class="kdt__dow">${KDT_DOW.map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="kdt__grid">${cells.join("")}</div>
        <div class="kdt__time">
          <span class="kdt__timelabel">at</span>
          <select class="kdt__sel" data-t="h">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${h12 === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select>
          <span class="kdt__colon">:</span>
          <select class="kdt__sel" data-t="m">${[0, 15, 30, 45].map((m) => `<option value="${m}" ${st.min === m ? "selected" : ""}>${String(m).padStart(2, "0")}</option>`).join("")}</select>
          <div class="kdt__ampm">
            <button type="button" class="${st.h < 12 ? "is-on" : ""}" data-ap="am">AM</button>
            <button type="button" class="${st.h >= 12 ? "is-on" : ""}" data-ap="pm">PM</button>
          </div>
        </div>
        <div class="kdt__foot">
          <button type="button" class="kdt__link" data-act="clear">Clear · send now</button>
          <button type="button" class="btn btn--accent btn--sm" data-act="done">Done</button>
        </div>
      </div>`;
    wire();
  };

  const wire = () => {
    $("#kdt-display", container).addEventListener("click", (e) => {
      if (e.target.closest(".kdt__clearmini")) { st.day = null; st.open = false; render(); return; }
      st.open = !st.open;
      render();
    });
    $$(".kdt__nav", container).forEach((b) => b.addEventListener("click", () => {
      st.mo += Number(b.dataset.nav);
      if (st.mo < 0) { st.mo = 11; st.y--; }
      if (st.mo > 11) { st.mo = 0; st.y++; }
      render();
    }));
    $$(".kdt__day", container).forEach((b) => b.addEventListener("click", () => {
      st.day = Number(b.dataset.d);
      render();
    }));
    $$(".kdt__sel", container).forEach((s) => s.addEventListener("change", () => {
      if (s.dataset.t === "h") {
        const h12 = Number(s.value);
        st.h = (st.h >= 12 ? 12 : 0) + (h12 % 12);
      } else st.min = Number(s.value);
      if (st.day === null) st.day = Math.max(now.getDate(), 1);
      render();
    }));
    $$(".kdt__ampm button", container).forEach((b) => b.addEventListener("click", () => {
      st.h = b.dataset.ap === "pm" ? (st.h % 12) + 12 : st.h % 12;
      if (st.day === null) st.day = now.getDate();
      render();
    }));
    container.querySelector('[data-act="clear"]').addEventListener("click", () => { st.day = null; st.open = false; render(); });
    container.querySelector('[data-act="done"]').addEventListener("click", () => { st.open = false; render(); });
  };

  render();
  return { getValue: sel };
}

/* approve modal: confirm the batch + optional "Send later" schedule */
function openLaunchReview(selected) {
  if (state.userFiles === null && filesApiAvailable()) {
    openModal(`<h2>Loading attachments</h2><p class="sub">Fetching your saved resume and reusable files...</p>`, true);
    loadUserFiles().then(() => openLaunchReview(selected));
    return;
  }
  const n = selected.length;
  openModal(`
    <h2>Approve &amp; launch ${n} knock${n === 1 ? "" : "s"}</h2>
    <p class="sub">Scout finalizes each draft in your voice, then sends from your Gmail one by one. You'll see every status live. ${state.knocks} knock${state.knocks === 1 ? "" : "s"} left this month.</p>
    ${googleConnected() ? "" : `<p class="connlist__fine">Google isn't connected yet, so these will wait safely as "Connect Google" until you connect it.</p>`}
    <label>Send later (optional)</label>
    <div id="lc-kdt" class="kdt"></div>
    <p class="connlist__fine">Leave empty to send now. Pick a time and Gmail delivers them then.</p>
    <p class="connlist__fine">Attachments are chosen per message in Review knock. One-off files stay with that knock only.</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="m-cancel">Cancel</button>
      <button class="btn btn--accent" id="lc-go">${googleConnected() ? "Launch" : "Queue knocks"}</button>
    </div>`);
  const kdt = mountKdt($("#lc-kdt", modal));
  $("#m-cancel").addEventListener("click", closeModal);
  $("#lc-go").addEventListener("click", () => {
    const when = kdt.getValue();
    let scheduleAt = null;
    if (when) {
      if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
        return obError("#lc-kdt", "Pick a time in the future, or clear it to send now.");
      }
      scheduleAt = when.toISOString();
    }
    if (scheduleAt && selected.some((d) => (d.oneOffAttachments || []).length)) {
      return obError("#lc-kdt", "Send now to include one-off attachments, or use saved attachments from Settings for scheduled sends.");
    }
    closeModal();
    runLaunch(selected, scheduleAt);
  });
}

async function runLaunch(selected, scheduleAt, oneOffAttachments = [], batchAttachmentIds = []) {
  try {
    const authUser = await requireRealSupabaseAuth("launch campaigns");
    if (!authUser) return;
    const res = await fetch("/api/campaigns/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doors: selected, userId: authUser.id, sendPrefs: state.sendPrefs, scheduleAt: scheduleAt || undefined }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not queue campaign");
    state.campaigns.push(data.campaign);
    for (const m of data.messages || []) {
      const d = doorById(m.doorId);
      const savedIds = [...new Set([...(attachmentIdsForDoor(d) || []), ...batchAttachmentIds])];
      const oneOffsForDoor = [...(oneOffAttachments || []), ...((d && d.oneOffAttachments) || [])];
      const sentAttachments = sentAttachmentMetadata({ ids: savedIds, oneOffs: oneOffsForDoor });
      state.messages.push({
        ...m,
        subject: noEmDash(m.subject),
        body: noEmDash(m.body),
        name: d?.name, title: d?.title, company: d?.companyName, companyDomain: d?.companyDomain,
        doorSnapshot: d || m.doorSnapshot || null,
        apolloPersonId: d?.apolloPersonId || m.apolloPersonId || "",
        emailStatus: d?.emailStatus || m.emailStatus || "",
        draft: d?.draft || m.draft || null,
        to: m.to || m.toEmail || d?.email || "",
        toName: m.toName || d?.name || "",
        scheduleAt: scheduleAt || m.scheduledAt || null,
        attachmentIds: savedIds,
        attachments: oneOffsForDoor.map((a) => ({ ...a })),
        sentAttachments,
      });
      if (d?.oneOffAttachments) delete d.oneOffAttachments;
    }
    state.selectedDoors = new Set();
    saveLive();
    const holdChannel = (state.sendPrefs?.channel || "gmail") !== "gmail";
    toast(holdChannel
      ? "Campaign queued and held, per your sending preferences. Switch the channel to Gmail to send"
      : googleConnected()
        ? `Campaign approved. Scout is sending ${selected.length} knock${selected.length === 1 ? "" : "s"} now`
        : "Campaign queued. Connect Google and Scout sends the moment you do");
    navigate();
    processSendQueue();
  } catch (err) {
    toast(`Launch failed: ${esc(err.message)}`);
  }
}

/* ---- the live pipeline: drafting → sending → sent/scheduled/failed ----
   Sequential, with targeted re-renders per status change so the rows and
   the dashboard strip update without losing scroll. */
let sendRunActive = false;

function setMsgStatus(m, status) {
  if (m.status !== status) {
    m.history = [
      ...(m.history || []),
      { at: new Date().toISOString(), type: "status", label: status },
    ].slice(-20);
  }
  m.status = status;
  m.updatedAt = new Date().toISOString();
  saveLive();
  updateMessageRow(m);
}

async function fetchGmailSend({ message, scheduleAt } = {}) {
  const authUser = await requireRealSupabaseAuth("send Gmail");
  if (!authUser) return null;
  const realUserId = authUser.id;
  if (!isRealUuid(realUserId)) {
    toast("Sign in to Knock before sending Gmail.");
    return null;
  }
  const { userId: _drop, ...messageFields } = message || {};
  console.log("[gmail/send payload]", {
    userId: realUserId,
    messageId: messageFields.id,
    to: messageFields.to,
    subject: messageFields.subject,
  });
  const res = await fetch("/api/gmail/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: realUserId,
      message: messageFields,
      scheduleAt,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function processSendQueue() {
  if (sendRunActive) return;
  /* sending preference says hold: knocks stay safely queued on purpose */
  const channel = state.sendPrefs?.channel || "gmail";
  if (channel === "queue") return;
  if (channel === "linkedin") {
    /* LinkedIn delivery isn't live yet; keep knocks parked, never lost */
    return;
  }
  /* no Google: park everything visibly instead of a dead "queued" */
  if (!googleConnected()) {
    let parked = 0;
    state.messages.forEach((m) => { if (m.status === "queued") { m.status = "waiting_gmail"; parked++; } });
    if (parked) { saveLive(); state.messages.forEach((m) => m.status === "waiting_gmail" && updateMessageRow(m)); }
    return;
  }
  const authUser = await requireRealSupabaseAuth("send Gmail");
  if (!authUser || !isRealUuid(authUser.id)) {
    if (!realAuthUserId()) toast("Sign in to Knock before sending Gmail.");
    return;
  }
  sendRunActive = true;
  refreshSendStrip();
  try {
    for (;;) {
      const m = state.messages.find((x) => x.status === "queued");
      if (!m) break;
      const outcome = await processSingleSend(m);
      if (outcome === "stop") break;
    }
  } finally {
    sendRunActive = false;
    refreshSendStrip();
    updateChrome();
  }
}

async function enrichDoorForEmail(d) {
  if (!d || d.email || !d.apolloPersonId) return d?.email || "";
  try {
    const res = await fetch("/api/sourcing/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doors: [d] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Apollo enrichment failed");
    const enriched = (data.enriched || []).find((x) => x.id === d.id || x.apolloPersonId === d.apolloPersonId);
    if (enriched?.email) {
      d.email = enriched.email;
      d.emailStatus = enriched.emailStatus || d.emailStatus;
    }
    if (data.meta?.creditsLikelyUsed) {
      state.apolloUsage.enrichCreditsUsed = (state.apolloUsage.enrichCreditsUsed || 0) + Math.max(1, Number(data.meta.enrichedPeople || 0));
      state.apolloUsage.updatedAt = new Date().toISOString();
      saveApolloUsage();
      updateApolloCard();
    }
    saveLive();
    return d.email || "";
  } catch (err) {
    return "";
  }
}

async function ensureMessageReady(m, d) {
  if (d) {
    m.to = m.to || d.email || "";
    m.toName = m.toName || d.name || "";
    m.apolloPersonId = m.apolloPersonId || d.apolloPersonId || "";
    m.emailStatus = m.emailStatus || d.emailStatus || "";
    m.doorSnapshot = m.doorSnapshot || d;
    m.subject = noEmDash(m.subject || d.draft?.subject || "quick question");
    m.body = noEmDash(m.body || d.draft?.body || d.draft?.preview || "");
  }

  if (d && (!m.subject || !m.body || !d.draft?.body)) {
    setMsgStatus(m, "drafting");
    try {
      const res = await fetch("/api/knock/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: state.profile, door: d, tone: state.profile?.tone, styleProfile: state.profile?.styleProfile }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.draft) {
        m.subject = noEmDash(data.draft.subject || m.subject);
        m.body = noEmDash(data.draft.body || m.body);
        d.draft = { ...(d.draft || {}), ...data.draft, subject: m.subject, body: m.body, source: data.source };
      }
    } catch { /* deterministic draft route fallback may still be unavailable locally */ }
  }

  const enrichTarget = d || (m.apolloPersonId ? {
    id: m.doorId || m.id,
    apolloPersonId: m.apolloPersonId,
    email: m.to || "",
    emailStatus: m.emailStatus || "",
  } : null);

  if (!m.to && enrichTarget?.apolloPersonId) {
    setMsgStatus(m, "drafting");
    m.to = await enrichDoorForEmail(enrichTarget);
    m.emailStatus = enrichTarget.emailStatus || m.emailStatus || "";
  }

  m.subject = noEmDash(m.subject || "quick question");
  m.body = noEmDash(m.body || "");
  saveLive();

  if (!m.to) return { ok: false, error: "No verified email found. Apollo enrichment did not return one." };
  if (!m.subject || !m.body) return { ok: false, error: "Draft is missing a subject or body. Review the knock, then retry." };
  return { ok: true };
}

async function processSingleSend(m) {
  const d = messageDoor(m);
  /* 1 · drafting: upgrade template previews into a real AI draft */
  if (d && (!d.draft || d.draft.source !== "openai")) {
    setMsgStatus(m, "drafting");
    try {
      const res = await fetch("/api/knock/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: state.profile, door: d, tone: state.profile?.tone, styleProfile: state.profile?.styleProfile }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok && data.draft) {
        m.subject = noEmDash(data.draft.subject || m.subject);
        m.body = noEmDash(data.draft.body || m.body);
        if (d) { d.draft = { ...(d.draft || {}), ...data.draft, subject: m.subject, body: m.body, source: data.source }; }
      }
    } catch { /* template draft still sends fine */ }
  }
  /* 2 · sending */
  const ready = await ensureMessageReady(m, d);
  if (!ready.ok) {
    m.error = ready.error;
    setMsgStatus(m, "failed");
    return "failed";
  }
  setMsgStatus(m, "sending");
  try {
    const savedIds = m.attachmentIds || attachmentIdsForDoor(d);
    const oneOffs = m.attachments || [];
    m.sentAttachments = sentAttachmentMetadata({ ids: savedIds, oneOffs });
    const sendResult = await fetchGmailSend({
      message: {
        id: m.id, doorId: m.doorId, campaignId: m.campaignId,
        to: m.to, toName: m.toName || m.name || d?.name || "",
        subject: noEmDash(m.subject), body: noEmDash(m.body),
        attachmentIds: savedIds,
        attachments: oneOffs,
      },
      scheduleAt: m.scheduleAt || undefined,
    });
    if (!sendResult) return "stop";
    const { res, data } = sendResult;
    if (res.ok && data.ok) {
      if (data.gmailMessageId) m.gmailMessageId = data.gmailMessageId;
      if (data.gmailThreadId) m.gmailThreadId = data.gmailThreadId;
      m.error = null;
      if (m.attachments?.length && data.status !== "scheduled") delete m.attachments;
      if (data.status !== "scheduled") {
        m.threadMessages = [{
          id: data.gmailMessageId || m.gmailMessageId || `local-${Date.now()}`,
          from: state.profile?.fullName || "You",
          to: m.to,
          date: new Date().toISOString(),
          subject: noEmDash(m.subject),
          body: noEmDash(m.body),
          isFromMe: true,
          attachments: m.sentAttachments || [],
        }];
      }
      m.history = [
        ...(m.history || []),
        { at: new Date().toISOString(), type: data.status === "scheduled" ? "scheduled" : "sent", label: noEmDash(m.subject), body: noEmDash(m.body) },
      ].slice(-20);
      rememberEditedSample({ before: d?.draft?.body || "", after: m.body, category: "cold_intro", subject: m.subject });
      state.knocks = Math.max(0, state.knocks - 1); /* knocks burn on send, not on queue */
      setMsgStatus(m, data.status === "scheduled" ? "scheduled" : "sent");
      updateChrome();
      if (data.status !== "scheduled") refreshConversation(m, true);
      return "sent";
    }
    if (res.status === 412 || data.error === "google_not_connected") {
      state.connections.google = false;
      saveConnections();
      setMsgStatus(m, "waiting_gmail");
      state.messages.forEach((x) => { if (x.status === "queued") { x.status = "waiting_gmail"; updateMessageRow(x); } });
      saveLive();
      toast("Gmail isn't connected. Knocks are parked until you connect Google");
      return "stop";
    }
    if (res.status === 402 || data.error === "knock_limit_reached") {
      state.knocks = 0;
      setMsgStatus(m, "queued"); /* held, not lost */
      updateChrome();
      toast(`Monthly knock limit reached${data.limit ? ` (${data.limit})` : ""}. Go Pro for 200 knocks a month`);
      return "stop";
    }
    m.error = data.message || data.error || `Send failed (${res.status})`;
    setMsgStatus(m, "failed");
    return "failed";
  } catch (err) {
    m.error = err.message || "Network error";
    setMsgStatus(m, "failed");
    return "failed";
  }
}

/* targeted DOM updates: tracker row, dashboard queue row, progress strip */
function msgStatusCell(m) {
  return `${stChip(m.status)}
    ${m.status === "failed" && m.error ? `<small class="st-note st-note--err">${esc(m.error)}</small>` : ""}
    ${m.statusDetail ? `<small class="st-note">${esc(m.statusDetail)}</small>` : ""}
    ${m.classification ? `<small class="st-note">${esc(summaryText(m))}</small>` : ""}`;
}

function summaryText(m) {
  const cls = typeof m.classification === "string" ? m.classification : m.classification?.label || "";
  const summary = typeof m.classification === "object" ? m.classification?.summary || "" : "";
  return [cls, summary].filter(Boolean).join(" · ");
}

function updateMessageRow(m) {
  if ((location.hash.replace("#", "") || "dashboard") === "dashboard" && doorIsActiveInPipeline(messageDoor(m))) {
    renderDoorsQueue();
    return;
  }
  const row = $(`tr[data-msg-id="${m.id}"]`, view);
  if (row) {
    /* swap the whole row; click handling is delegated to the table */
    const holder = document.createElement("tbody");
    holder.innerHTML = trackerRow(m);
    if (holder.firstElementChild) row.replaceWith(holder.firstElementChild);
  }
  const doorCell = $(`tr[data-id="${m.doorId}"] .door-st`, view);
  if (doorCell) doorCell.innerHTML = stChip(m.status);
  refreshSendStrip();
  refreshTrackerCounts();
}

/* ============================================================
   INBOX (+ Connections hub)
   ============================================================ */
const CONNECTIONS = [
  { id: "google", icn: "mail", name: "Google", sub: "Connect Gmail and Calendar to send emails, detect replies, and schedule meetings." },
  { id: "outlook", icn: "mail", name: "Outlook", sub: "school and work inboxes welcome" },
];

function openConnections() {
  const googleConn = googleConnectionCopy();
  openModal(`
    <h2>Connections</h2>
    <p class="sub">Everywhere you knock from. Connect once, Scout handles the rest.</p>
    <div class="connlist">
      ${CONNECTIONS.map((c) => {
        const isGoogle = c.id === "google";
        const connected = Boolean(state.connections[c.id]);
        const title = isGoogle ? googleConn.title : c.name;
        const sub = isGoogle ? googleConn.sub : c.sub;
        const btn = isGoogle
          ? (googleConn.disconnect
            ? `<button class="btn btn--paper btn--sm end act-disconnect">Disconnect</button>`
            : `<button class="btn btn--sm end act-connect"${googleConn.disabled ? " disabled" : ""}>${esc(googleConn.button)}</button>`)
          : (connected
            ? `<button class="btn btn--paper btn--sm end act-disconnect">Disconnect</button>`
            : `<button class="btn btn--sm end act-connect">Connect</button>`);
        return `
        <div class="connrow" data-id="${c.id}">
          <span class="ico">${I[c.icn]}</span>
          <div><strong>${c.name}</strong><small>${connected && !isGoogle ? "Connected · " : ""}${isGoogle ? `<strong>${esc(title)}</strong> · ${esc(sub)}` : esc(sub)}</small></div>
          ${btn}
        </div>`;
      }).join("")}
    </div>
    <p class="connlist__fine">Google connects Gmail and Calendar. Additional channels can be managed later without changing your drafts.</p>
    <div class="modal__actions"><button class="btn btn--ghost" id="m-close">Done</button></div>`);
  const setConn = (id, val) => {
    state.connections[id] = val;
    saveConnections();
    toast(`${CONNECTIONS.find((c) => c.id === id).name} ${val ? "connected" : "disconnected"}`);
    openConnections();
  };
  $$(".act-connect", modal).forEach((b) =>
    b.addEventListener("click", (e) => {
      if (b.disabled) return;
      const id = e.target.closest(".connrow").dataset.id;
      if (id === "google") {
        if (!getAuthSnapshot().hasRealUser) return startSignInAndConnectGoogle();
        return connectGoogle();
      }
      setConn(id, true);
    }));
  $$(".act-disconnect", modal).forEach((b) =>
    b.addEventListener("click", (e) => {
      const id = e.target.closest(".connrow").dataset.id;
      closeModal();
      if (id === "google") return disconnectProvider(id);
      setConn(id, false);
    }));
  $("#m-close", modal).addEventListener("click", closeModal);
}

/* a thread's most recent activity: latest inbound/outbound mail, else updatedAt */
function threadLastActivity(m) {
  const dates = (m.threadMessages || []).map((t) => Date.parse(t.date) || 0);
  return Math.max(Date.parse(m.updatedAt || m.createdAt) || 0, ...dates, 0);
}

function stripQuotedTextClient(text) {
  const lines = String(text || "").replace(/\r/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const hasContent = out.some((l) => l.trim());
    if (hasContent && /^On\s.+(?:wrote:|<[^>]+>)/i.test(trimmed)) break;
    if (hasContent && /^wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed)) break;
    if (hasContent && /^(From|Sent|To|Cc|Subject|Date):\s/i.test(trimmed)) break;
    if (/^>/.test(trimmed)) {
      if (hasContent) break;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToPlain(html = "") {
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("script,style,blockquote,.gmail_quote,.yahoo_quoted").forEach((n) => n.remove());
  return stripQuotedTextClient((el.innerText || el.textContent || "").trim());
}

function sanitizeRichHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const allowed = new Set(["B", "STRONG", "I", "EM", "U", "A", "UL", "OL", "LI", "BR", "P", "DIV"]);
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        const name = attr.name.toLowerCase();
        if (child.tagName === "A" && name === "href" && /^(https?:|mailto:)/i.test(attr.value)) {
          child.setAttribute("target", "_blank");
          child.setAttribute("rel", "noopener");
          continue;
        }
        child.removeAttribute(attr.name);
      }
      walk(child);
    }
  };
  walk(template.content);
  return template.innerHTML
    .replace(/<div><br><\/div>/gi, "<br>")
    .replace(/\s?on\w+="[^"]*"/gi, "")
    .trim();
}

function threadBodyText(tm) {
  const body = tm?.bodyHtml ? htmlToPlain(tm.bodyHtml) : (tm?.body || tm?.subject || "");
  return stripQuotedTextClient(body);
}

function threadBodyHTML(tm) {
  if (tm?.bodyHtml && tm.isFromMe) return sanitizeRichHtml(tm.bodyHtml);
  const text = threadBodyText(tm);
  return esc(text || tm?.subject || "").replace(/\n/g, "<br>");
}

function formatBytes(n) {
  const bytes = Number(n || 0);
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const attachmentPreviewStore = new Map();
let attachmentPreviewSeq = 0;
function cacheAttachmentPreview(a) {
  const key = `att_${++attachmentPreviewSeq}`;
  attachmentPreviewStore.set(key, a);
  return key;
}

function previewMarkup(file) {
  const name = file.fileName || file.filename || file.name || "attachment";
  const mime = file.mimeType || file.type || file.mime || "application/octet-stream";
  const content = file.contentBase64 || "";
  if (!content) {
    return `<div class="preview-empty"><h3>Preview unavailable</h3><p>${esc(name)} can be previewed after Gmail returns the file bytes.</p></div>`;
  }
  const src = `data:${mime};base64,${content}`;
  if (/^image\//i.test(mime)) return `<img class="att-preview__image" src="${src}" alt="${esc(name)}">`;
  if (/pdf/i.test(mime)) return `<iframe class="att-preview__pdf" src="${src}" title="${esc(name)}"></iframe>`;
  return `
    <div class="preview-empty">
      <h3>Preview unavailable</h3>
      <p>${esc(name)} is a ${esc(mime)} file.</p>
      <a class="btn btn--paper btn--sm" href="${src}" download="${esc(name)}">Download file</a>
    </div>`;
}

async function openAttachmentPreview(att) {
  const name = att.fileName || att.filename || att.name || "attachment";
  const mime = att.mimeType || att.type || att.mime || "application/octet-stream";
  openModal(`
    <button class="modal-x" id="att-close" aria-label="Close">&times;</button>
    <h2>Attachment preview</h2>
    <p class="sub"><b>${esc(name)}</b>${formatBytes(att.size || att.sizeBytes) ? ` · ${esc(formatBytes(att.size || att.sizeBytes))}` : ""} · ${esc(mime)}</p>
    <div class="att-preview" id="att-preview-body">
      ${att.contentBase64 ? previewMarkup(att) : `<div class="preview-empty"><h3>Loading preview…</h3><p>Fetching the attachment securely from Gmail.</p></div>`}
    </div>`);
  $("#att-close", modal)?.addEventListener("click", closeModal);
  if (att.contentBase64) return;
  if (!att.attachmentId || !(att.messageId || att.gmailMessageId)) {
    $("#att-preview-body", modal).innerHTML = previewMarkup(att);
    return;
  }
  try {
    const authUser = await requireRealSupabaseAuth("preview attachments");
    if (!authUser) throw new Error("Sign in to Knock first.");
    const res = await fetch("/api/gmail/attachment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: authUser.id,
        gmailMessageId: att.gmailMessageId || att.messageId,
        attachmentId: att.attachmentId,
        fileName: name,
        mimeType: mime,
        size: att.size || att.sizeBytes || 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not fetch attachment");
    const file = { ...att, ...data };
    Object.assign(att, file);
    $("#att-preview-body", modal).innerHTML = previewMarkup(file);
  } catch (err) {
    $("#att-preview-body", modal).innerHTML = `<div class="preview-empty"><h3>Preview unavailable</h3><p>${esc(err.message || "Could not load this attachment.")}</p></div>`;
  }
}

function attachmentChips(attachments = []) {
  const files = (attachments || []).filter(Boolean);
  if (!files.length) return "";
  return `<div class="msg__files">${files.map((a) => `
    <button type="button" class="filechip filechip--button attach-preview" data-preview-id="${cacheAttachmentPreview(a)}">${icon("doc")} ${esc(a.fileName || a.filename || a.name || "attachment")}${formatBytes(a.size || a.sizeBytes) ? ` · ${esc(formatBytes(a.size || a.sizeBytes))}` : ""}</button>
  `).join("")}</div>`;
}

function latestInbound(m) {
  return [...(m.threadMessages || [])].reverse().find((t) => !t.isFromMe) || null;
}

function lastReplyAt(m) {
  return m.lastReplyAt || latestInbound(m)?.date || null;
}

function snippet(m) {
  const newest = [...(m.threadMessages || [])].reverse().find((t) => threadBodyText(t)) || null;
  return (threadBodyText(newest) || stripQuotedTextClient(m?.body || m?.subject || "") || "No message body yet").slice(0, 120);
}

/* the left-rail tag only flags what needs attention; plain "sent" is implied */
function threadTag(m) {
  if (m.flagged) return `<span class="warmtag warmtag--flag">flagged</span>`;
  if (m.archivedAt) return `<span class="warmtag warmtag--dim">archived</span>`;
  if (m.unread) return `<span class="warmtag warmtag--new">new reply</span>`;
  if (m.statusDetail === "Scout drafting response") return `<span class="warmtag">Scout drafting response</span>`;
  if (m.statusDetail === "Auto-replied") return `<span class="warmtag warmtag--ok">auto-replied</span>`;
  if (m.status === "needs_review") return `<span class="warmtag">reply drafted - review</span>`;
  if (m.status === "replied" && m.suggestedReply && !m.replySent) return `<span class="warmtag">draft ready</span>`;
  if (m.status === "meeting") return `<span class="warmtag warmtag--ok">meeting booked</span>`;
  if (m.status === "failed") return `<span class="warmtag">failed</span>`;
  if (m.status === "followup_sent") return `<span class="warmtag warmtag--dim">followed up</span>`;
  return "";
}

const INBOX_FILTERS = [
  ["all", "All"],
  ["needs_review", "Needs review"],
  ["replied", "Replied"],
  ["meeting", "Meeting booked"],
  ["sent", "Sent"],
  ["flagged", "Flagged"],
  ["archived", "Archived"],
];

function inboxMatches(m, filter = state.inboxFilter) {
  if (filter === "deleted") return Boolean(m.deletedAt);
  if (m.deletedAt) return false;
  if (filter === "archived") return Boolean(m.archivedAt);
  if (m.archivedAt && filter !== "flagged") return false;
  if (filter === "flagged") return Boolean(m.flagged);
  if (filter === "needs_review") return m.status === "needs_review";
  if (filter === "replied") return ["replied", "needs_review"].includes(m.status);
  if (filter === "meeting") return m.status === "meeting";
  if (filter === "sent") return ["sent", "scheduled", "followup_sent", "opened", "waiting_gmail"].includes(m.status);
  return true;
}

function normalizeThreadMessages(m) {
  const list = m?.threadMessages?.length
    ? m.threadMessages
    : m?.body
      ? [{ isFromMe: true, from: "You", date: m.sentAt || m.createdAt, body: m.body, subject: m.subject, attachments: m.sentAttachments || m.attachments || [] }]
      : [];
  return list.filter((tm) => threadBodyText(tm) || tm.subject || (tm.attachments || []).length);
}

async function persistMessageOrg(m) {
  const realUserId = realAuthUserId();
  if (!m || !realUserId) return;
  try {
    await fetch("/api/messages/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: realUserId,
        messageId: m.id,
        archivedAt: m.archivedAt || null,
        deletedAt: m.deletedAt || null,
        flagged: Boolean(m.flagged),
      }),
    });
  } catch { /* local app_state still preserves organization */ }
}

async function deleteThreadFromKnock(m) {
  if (!m) return;
  const previousId = m.id;
  state.messages = state.messages.filter((x) => x.id !== previousId);
  for (const c of state.campaigns) {
    c.selectedDoorIds = (c.selectedDoorIds || []).filter((id) => id !== m.doorId);
  }
  state.campaigns = state.campaigns.filter((c) => (c.selectedDoorIds || []).length > 0);
  if (state.inboxSelectedId === previousId) state.inboxSelectedId = null;
  save("knock_inbox_selected", state.inboxSelectedId);
  saveLive();
  updateChrome();
  renderInbox();

  if (!isRealUuid(previousId)) return;
  const realUserId = realAuthUserId();
  if (!realUserId) return;
  try {
    await fetch("/api/messages/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: realUserId, messageId: previousId, action: "delete" }),
    });
  } catch { /* local removal already happened */ }
}

function applyThreadRefresh(m, data) {
  if (!m || !data?.ok) return false;
  const keep = { archivedAt: m.archivedAt, deletedAt: m.deletedAt, flagged: m.flagged };
  const previous = normalizeThreadMessages(m);
  if (Array.isArray(data.threadMessages)) {
    const localOutgoing = previous.filter((p) => p.isFromMe);
    let outgoingIndex = 0;
    m.threadMessages = data.threadMessages.map((tm) => {
      if (!tm.isFromMe) return tm;
      const local = previous.find((p) => p.id && tm.id && p.id === tm.id)
        || localOutgoing[outgoingIndex]
        || null;
      const fallbackAttachments = outgoingIndex === 0 ? (m.sentAttachments || []) : [];
      outgoingIndex += 1;
      return {
        ...tm,
        attachments: mergeAttachments(tm.attachments || [], local?.attachments || fallbackAttachments),
      };
    });
  }
  if (data.lastReplyAt) m.lastReplyAt = data.lastReplyAt;
  if (data.attachments) m.threadAttachments = data.attachments;
  if (data.gmailThreadId) m.gmailThreadId = data.gmailThreadId;
  if (data.gmailMessageId) m.gmailMessageId = data.gmailMessageId;
  if (data.latestThreadMessageId) m.latestThreadMessageId = data.latestThreadMessageId;
  if (data.latestThreadMessageAt) m.latestThreadMessageAt = data.latestThreadMessageAt;
  if (data.statusSuggestion && m.status !== "meeting") m.status = data.statusSuggestion;
  Object.assign(m, keep);
  m.updatedAt = new Date().toISOString();
  return true;
}

async function refreshConversation(m, silent = false) {
  if (!m) {
    if (!silent) toast("Select a thread to refresh");
    return false;
  }
  const user = await requireRealSupabaseAuth("refresh Gmail threads");
  if (!user) return false;
  const connections = await refreshConnectionStatus({ silent: true });
  if (!connections.google) {
    if (!silent) connectGoogle();
    return false;
  }
  const hasRefreshReference = Boolean(m.gmailThreadId || m.gmailMessageId || isRealUuid(m.id));
  if (!hasRefreshReference) {
    if (!silent) toast("This thread has not been sent through Gmail yet.");
    return false;
  }
  try {
    const res = await fetch("/api/gmail/refresh-thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        messageId: m.id,
        gmailThreadId: m.gmailThreadId || m.gmail_thread_id || "",
        gmailMessageId: m.gmailMessageId || m.gmail_message_id || "",
        toEmail: m.to || m.toEmail || "",
        subject: m.subject || "",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error === "real_user_required") throw new Error("Sign in to Knock first.");
    if (res.status === 412 || data.error === "google_not_connected") throw new Error("Connect Google to refresh Gmail threads.");
    if (data.error === "missing_thread_reference") throw new Error("This thread has not been sent through Gmail yet.");
    if (data.error === "missing_gmail_thread_id") throw new Error("This thread has not been sent through Gmail yet.");
    if (!res.ok || !data.ok) throw new Error(data.message || data.error || `Refresh failed (${res.status})`);
    applyThreadRefresh(m, data);
    saveLive();
    if ((location.hash.replace("#", "") || "dashboard") === "inbox") {
      updateInboxThread(m, { forceBottom: !silent });
    }
    if (!silent) toast("Conversation refreshed from Gmail");
    return true;
  } catch (err) {
    if (!silent) toast(`Could not refresh: ${esc(err.message)}`);
    return false;
  }
}

function polishCalendarReply(body, m) {
  let text = noEmDash(body || "");
  if (m?.calendarLink && /meet\.google\.com/i.test(text)) {
    text = text
      .replace(/https?:\/\/meet\.google\.com\/[^\s)]+/gi, "the Google Calendar invite")
      .replace(/meet here:\s*the Google Calendar invite/gi, "I sent a Google Calendar invite for that time");
  }
  return text.trim();
}

function appendOutgoingThreadMessage(m, { subject, body, bodyHtml, attachments = [] }) {
  m.threadMessages = normalizeThreadMessages(m);
  const localAttachments = (attachments || []).map((a) => ({
    id: a.id,
    fileName: a.fileName || a.name || "attachment",
    name: a.fileName || a.name || "attachment",
    mimeType: a.mimeType || a.type || "application/octet-stream",
    size: a.size || a.sizeBytes || 0,
    contentBase64: a.contentBase64 || "",
    attachmentId: a.attachmentId || null,
    messageId: a.messageId || null,
    oneOff: true,
  }));
  m.threadMessages.push({
    from: state.profile?.fullName || "You",
    date: new Date().toISOString(),
    subject,
    body,
    bodyHtml,
    isFromMe: true,
    attachments: localAttachments,
  });
  m.sentAttachments = mergeAttachments(localAttachments, m.sentAttachments || []);
  m.lastReplyAt = lastReplyAt(m);
  m.unread = false;
  m.updatedAt = new Date().toISOString();
}

async function sendThreadReply(m, { subject, body, bodyHtml = "", attachments = [], kind = "reply" }) {
  const d = messageDoor(m);
  if (!m.to && d?.email) m.to = d.email;
  if (!m.to && d?.apolloPersonId) m.to = await enrichDoorForEmail(d);
  const replySubject = noEmDash(String(subject || `Re: ${m.subject || "quick question"}`).trim());
  const replyBody = polishCalendarReply(String(body || "").trim(), m);
  const safeHtml = bodyHtml ? sanitizeRichHtml(bodyHtml) : "";
  if (!m.to) throw new Error("No verified email found. Apollo enrichment did not return one.");
  if (!replySubject || !replyBody) throw new Error("Reply needs a subject and body.");
  const sendResult = await fetchGmailSend({
    message: {
      id: m.id, doorId: m.doorId, campaignId: m.campaignId,
      to: m.to, toName: m.name || d?.name || "",
      subject: replySubject,
      body: replyBody,
      bodyHtml: safeHtml,
      kind,
      threadId: m.gmailThreadId,
      attachments,
    },
  });
  if (!sendResult) throw new Error("Sign in to Knock before sending Gmail.");
  const { res, data } = sendResult;
  if (res.status === 412 || data.error === "google_not_connected") throw new Error("Google isn't connected");
  if (!res.ok || !data.ok) throw new Error(data.message || data.error || `Send failed (${res.status})`);
  if (data.gmailThreadId) m.gmailThreadId = data.gmailThreadId;
  if (data.gmailMessageId) m.gmailMessageId = data.gmailMessageId;
  appendOutgoingThreadMessage(m, {
    subject: replySubject,
    body: replyBody,
    bodyHtml: safeHtml,
    attachments: (attachments || []).map((a) => ({ ...a, messageId: data.gmailMessageId || a.messageId })),
  });
  m.status = kind === "followup" ? "followup_sent" : (m.status === "meeting" ? "meeting" : "replied");
  m.replySent = true;
  if (kind === "followup") m.followupNumber = (m.followupNumber || 0) + 1;
  rememberEditedSample({
    before: m.suggestedReply?.body || "",
    after: replyBody,
    category: kind === "followup" ? "follow_up" : "reply",
    subject: replySubject,
  });
  delete m.suggestedReply;
  saveLive();
  updateMessageRow(m);
  updateChrome();
  refreshConversation(m, true);
  return data;
}

function renderComposerChips(id) {
  const host = $("#reply-files", view);
  if (!host) return;
  const files = inboxComposerAttachments.get(id) || [];
  host.innerHTML = files.map((a) => `
    <span class="filechip">${icon("doc")} ${esc(attachmentLabel(a))}
      <button class="chip-x reply-file-remove" data-id="${esc(a.id)}" title="Remove">&times;</button>
    </span>`).join("");
  $$(".reply-file-remove", host).forEach((b) => b.addEventListener("click", () => {
    inboxComposerAttachments.set(id, files.filter((a) => a.id !== b.dataset.id));
    renderComposerChips(id);
  }));
}

function inboxSnippet(m) {
  const last = (m?.threadMessages || []).filter((t) => !t.isFromMe).slice(-1)[0];
  return (threadBodyText(last) || m?.body || "").replace(/\s+/g, " ").slice(0, 80);
}

function threadMessagesHTML(m) {
  const threadMessages = normalizeThreadMessages(m);
  return `
    ${threadMessages.map((tm) => `
      <div class="msg ${tm.isFromMe ? "msg--you" : "msg--them"}">
        <time>${esc(tm.isFromMe ? "You" : tm.from || "Them")} ${tm.date ? " - " + new Date(tm.date).toLocaleString() : ""}</time>
        <div class="msg__body">${threadBodyHTML(tm)}</div>
        ${attachmentChips(tm.attachments)}
      </div>`).join("")}
    ${m?.statusDetail === "Scout drafting response" && !m?.suggestedReply ? `<div class="msg msg--draft"><time>Scout</time><div class="msg__body">Scout is drafting a response...</div></div>` : ""}
    ${m?.suggestedReply ? `<div class="msg msg--draft"><time>Scout draft</time><b>${esc(m.suggestedReply.subject || "")}</b><div class="msg__body">${esc(m.suggestedReply.body || "")}</div></div>` : ""}`;
}

function threadListItemHTML(m, selectedId = state.inboxSelectedId) {
  return `<button class="thread-item ${selectedId === m.id ? "is-open" : ""} ${m.unread ? "is-new" : ""}" data-id="${m.id}">
    <span class="thread-item__row">
      ${m.unread ? '<i class="dot-unread"></i>' : ""}
      <strong>${esc(m.name || m.toName || "Unknown")}</strong>
      <time>${new Date(threadLastActivity(m) || Date.now()).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
    </span>
    <span class="subj">${esc(m.subject || "quick question")}</span>
    <span class="snippet">${esc(inboxSnippet(m))}</span>
    ${threadTag(m)}
  </button>`;
}

function wireThreadItemButton(b) {
  b?.addEventListener("click", () => {
    state.inboxSelectedId = b.dataset.id;
    const m = msgById(b.dataset.id);
    if (m?.unread) { m.unread = false; saveLive(); }
    save("knock_inbox_selected", state.inboxSelectedId);
    renderInbox();
  });
}

function wireAttachmentPreviewButtons(root = view) {
  $$(".attach-preview", root).forEach((b) => b.addEventListener("click", () => {
    const att = attachmentPreviewStore.get(b.dataset.previewId);
    if (att) openAttachmentPreview(att);
  }));
}

function updateThreadListItem(m) {
  const old = $$(".thread-item", view).find((b) => b.dataset.id === m.id);
  if (!old) return false;
  const holder = document.createElement("div");
  holder.innerHTML = threadListItemHTML(m);
  const next = holder.firstElementChild;
  old.replaceWith(next);
  wireThreadItemButton(next);
  return true;
}

function renderThreadMessagesOnly(m, { forceBottom = false } = {}) {
  const pane = $(".threadview__msgs", view);
  if (!pane) return false;
  const nearBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 48;
  pane.innerHTML = threadMessagesHTML(m);
  wireAttachmentPreviewButtons(pane);
  if (forceBottom || nearBottom) pane.scrollTop = pane.scrollHeight;
  return true;
}

function updateInboxThread(m, opts = {}) {
  if ((location.hash.replace("#", "") || "dashboard") !== "inbox") return false;
  if (!m || state.inboxSelectedId !== m.id || !inboxMatches(m)) {
    renderInbox();
    return false;
  }
  if (m.unread) m.unread = false;
  const head = $(".threadview__head", view);
  if (!head || !$(".threadview__msgs", view)) {
    renderInbox();
    return false;
  }
  $("h3", head).textContent = m.subject || "Select a thread";
  $("small", head).textContent = `${m.name || ""}${m.company ? " - " + m.company : ""}${m.to ? " - " + m.to : ""}`;
  $(".thread-flag", head).textContent = m.flagged ? "Unflag" : "Flag";
  $(".thread-archive", head).textContent = m.archivedAt ? "Unarchive" : "Archive";
  renderThreadMessagesOnly(m, opts);
  const replyActions = $(".threadview__reply", view);
  if (replyActions) {
    replyActions.innerHTML = `
      ${m.suggestedReply ? `<button class="btn btn--accent msg-reply" data-id="${m.id}">Review &amp; send Scout draft</button>` : ""}
      <button class="btn btn--paper" id="open-tracker">Open tracker</button>`;
    $(".msg-reply", replyActions)?.addEventListener("click", (e) => openSuggestedReply(msgById(e.target.dataset.id)));
    $("#open-tracker", replyActions)?.addEventListener("click", () => { location.hash = "tracker"; });
  }
  updateThreadListItem(m);
  return true;
}

function selectionInside(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const node = sel.anchorNode;
  return Boolean(node && el?.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node));
}

function normalizeLinkUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^(https?:\/\/|mailto:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  return `https://${value}`;
}

function selectedText() {
  const sel = window.getSelection();
  return sel && sel.rangeCount ? sel.toString() : "";
}

function openLinkModal(editor, savedRange) {
  const selected = savedRange ? savedRange.toString() : selectedText();
  openModal(`
    <h2>Insert link</h2>
    <label>Link URL</label>
    <input type="text" id="link-url" placeholder="https://example.com">
    <label>Display text</label>
    <input type="text" id="link-text" value="${esc(selected)}" placeholder="Text to show">
    <div class="modal__actions">
      <button class="btn btn--ghost" id="link-cancel">Cancel</button>
      <button class="btn btn--accent" id="link-insert">Insert link</button>
    </div>`);
  const restore = () => {
    editor.focus();
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  };
  $("#link-cancel", modal).addEventListener("click", () => { closeModal(); editor.focus(); });
  $("#link-insert", modal).addEventListener("click", () => {
    const url = normalizeLinkUrl($("#link-url", modal).value);
    const text = $("#link-text", modal).value.trim() || url;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return obError("#link-url", "Use http, https, mailto, or a normal domain.");
    closeModal();
    restore();
    if (selectedText()) document.execCommand("createLink", false, url);
    else document.execCommand("insertHTML", false, `<a href="${esc(url)}">${esc(text)}</a>`);
    editor.focus();
  });
  setTimeout(() => $("#link-url", modal)?.focus(), 0);
}

function updateReplyToolbarState(editor) {
  if (!editor || !selectionInside(editor)) return;
  const stateMap = {
    bold: "bold",
    italic: "italic",
    underline: "underline",
    insertUnorderedList: "insertUnorderedList",
    insertOrderedList: "insertOrderedList",
  };
  $$(".rt-btn", view).forEach((b) => {
    const cmd = b.dataset.cmd;
    const active = stateMap[cmd] ? document.queryCommandState(cmd) : false;
    b.classList.toggle("is-on", Boolean(active));
  });
}

function wireReplyComposer(m) {
  if (!m) return;
  renderComposerChips(m.id);
  const editor = $("#reply-editor", view);
  let savedRange = null;
  const rememberSelection = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && selectionInside(editor)) savedRange = sel.getRangeAt(0).cloneRange();
    updateReplyToolbarState(editor);
  };
  ["keyup", "mouseup", "focus", "input"].forEach((ev) => editor?.addEventListener(ev, rememberSelection));
  if (replyToolbarSelectionHandler) document.removeEventListener("selectionchange", replyToolbarSelectionHandler);
  replyToolbarSelectionHandler = rememberSelection;
  document.addEventListener("selectionchange", replyToolbarSelectionHandler);
  $$(".rt-btn", view).forEach((b) => b.addEventListener("click", () => {
    const cmd = b.dataset.cmd;
    editor?.focus();
    if (cmd === "createLink") {
      openLinkModal(editor, savedRange);
      return;
    }
    document.execCommand(cmd, false, null);
    updateReplyToolbarState(editor);
  }));
  $("#reply-attach", view)?.addEventListener("click", () => $("#reply-file", view)?.click());
  $("#reply-file", view)?.addEventListener("change", async (e) => {
    const current = inboxComposerAttachments.get(m.id) || [];
    const room = 6 - current.length;
    const next = [];
    for (const file of [...(e.target.files || [])].slice(0, Math.max(0, room))) {
      const att = await attachmentFromFile(file);
      if (att) next.push(att);
    }
    inboxComposerAttachments.set(m.id, [...current, ...next]);
    e.target.value = "";
    renderComposerChips(m.id);
  });
  $("#reply-send", view)?.addEventListener("click", async () => {
    const btn = $("#reply-send", view);
    const editor = $("#reply-editor", view);
    const bodyHtml = sanitizeRichHtml(editor?.innerHTML || "");
    const body = noEmDash(htmlToPlain(bodyHtml));
    if (!body) { toast("Write a reply first"); return; }
    btn.disabled = true; btn.textContent = "Sending...";
    try {
      await sendThreadReply(m, {
        subject: `Re: ${m.subject || "quick question"}`,
        body,
        bodyHtml,
        attachments: inboxComposerAttachments.get(m.id) || [],
      });
      inboxComposerAttachments.delete(m.id);
      toast("Reply sent. Knock is watching the thread");
      updateInboxThread(m, { forceBottom: true });
    } catch (err) {
      btn.disabled = false; btn.textContent = "Send reply";
      toast(`Could not send: ${esc(err.message)}`);
    }
  });
}

function renderInbox() {
  if (!INBOX_FILTERS.some(([id]) => id === state.inboxFilter)) {
    state.inboxFilter = "all";
    save("knock_inbox_filter", state.inboxFilter);
  }
  /* new replies first (lighted blue), then most recent activity downward */
  let messages = [...state.messages].filter((m) => inboxMatches(m)).sort((a, b) =>
    (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || threadLastActivity(b) - threadLastActivity(a));
  const selected = messages.find((m) => m.id === state.inboxSelectedId) || messages[0];
  if (selected) {
    state.inboxSelectedId = selected.id;
    save("knock_inbox_selected", selected.id);
  }

  view.innerHTML = `<div class="viewwrap">
    <div class="vh vh--row">
      <div>
        <h1>Inbox. <em>Warm threads first.</em></h1>
        <p>Scout tracks every knock, reply, follow-up, and draft in one place.</p>
      </div>
      <button class="btn btn--paper" id="connections-btn">${icon("plug")} Connections</button>
    </div>
    <div class="inbox-filters">
      ${INBOX_FILTERS.map(([id, label]) => `
        <button class="pill ${state.inboxFilter === id ? "is-on" : ""}" data-filter="${id}">${label}</button>`).join("")}
    </div>
    ${messages.length ? `
    <div class="inbox">
      <div class="threadlist">
        ${messages.map((m) => `
          ${threadListItemHTML(m, selected?.id)}`).join("")}
      </div>
      <div class="threadview">
        <div class="threadview__head">
          <div>
            <h3>${esc(selected?.subject || "Select a thread")}</h3>
            <small>${esc(selected?.name || "")}${selected?.company ? " - " + esc(selected.company) : ""}${selected?.to ? " - " + esc(selected.to) : ""}</small>
          </div>
          <div class="thread-actions">
            <button class="btn btn--paper btn--sm thread-refresh" data-id="${selected?.id || ""}">Refresh conversation</button>
            <button class="btn btn--paper btn--sm thread-flag" data-id="${selected?.id || ""}">${selected?.flagged ? "Unflag" : "Flag"}</button>
            <button class="btn btn--paper btn--sm thread-archive" data-id="${selected?.id || ""}">${selected?.archivedAt ? "Unarchive" : "Archive"}</button>
            <button class="btn btn--paper btn--sm thread-delete" data-id="${selected?.id || ""}">Delete</button>
          </div>
        </div>
        <div class="threadview__msgs">
          ${threadMessagesHTML(selected)}
        </div>
        <div class="threadview__reply">
          ${selected?.suggestedReply ? `<button class="btn btn--accent msg-reply" data-id="${selected.id}">Review &amp; send Scout draft</button>` : ""}
          <button class="btn btn--paper" id="open-tracker">Open tracker</button>
        </div>
        <div class="replybox" data-id="${selected?.id || ""}">
          <div class="replybar" aria-label="Formatting">
            <button class="rt-btn" data-cmd="bold" title="Bold"><b>B</b></button>
            <button class="rt-btn" data-cmd="italic" title="Italic"><i>I</i></button>
            <button class="rt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
            <button class="rt-btn" data-cmd="insertUnorderedList" title="Bulleted list">•</button>
            <button class="rt-btn" data-cmd="insertOrderedList" title="Numbered list">1.</button>
            <button class="rt-btn" data-cmd="createLink" title="Link">link</button>
            <button class="rt-btn" data-cmd="removeFormat" title="Clear formatting">clear</button>
          </div>
          <div class="replyeditor" id="reply-editor" contenteditable="true" role="textbox" aria-label="Reply"></div>
          <div class="replyfoot">
            <div class="oneoff-list" id="reply-files"></div>
            <button class="btn btn--paper btn--sm" id="reply-attach" type="button">${icon("doc")} Attach</button>
            <input type="file" id="reply-file" multiple hidden>
            <button class="btn btn--accent btn--sm" id="reply-send" type="button">Send reply</button>
          </div>
        </div>
      </div>
    </div>` : `
    <div class="ghost">
      <div class="ghost__icon">${I.mail}</div>
      <h2>No threads yet</h2>
      <p>${state.inboxFilter === "all" ? "Launch your first campaign from the dashboard. Every sent knock, follow-up, reply, and Scout draft will show up here." : "Nothing matches this inbox filter yet."}</p>
      <button class="btn btn--accent" id="inbox-cta">Go to dashboard</button>
    </div>`}
  </div>`;
  $("#connections-btn", view).addEventListener("click", openConnections);
  $$(".inbox-filters .pill", view).forEach((b) => b.addEventListener("click", () => {
    state.inboxFilter = b.dataset.filter;
    save("knock_inbox_filter", state.inboxFilter);
    renderInbox();
  }));
  $$(".thread-item", view).forEach(wireThreadItemButton);
  /* opening the selected thread clears its unread highlight */
  if (selected?.unread) { selected.unread = false; saveLive(); }
  $(".msg-reply", view)?.addEventListener("click", (e) => openSuggestedReply(msgById(e.target.dataset.id)));
  wireAttachmentPreviewButtons(view);
  $("#open-tracker", view)?.addEventListener("click", () => { location.hash = "tracker"; });
  $("#inbox-cta", view)?.addEventListener("click", () => { location.hash = "dashboard"; });
  $(".thread-refresh", view)?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Refreshing...";
    await refreshConversation(selected);
    btn.disabled = false;
    btn.textContent = old;
  });
  $(".thread-flag", view)?.addEventListener("click", () => {
    selected.flagged = !selected.flagged;
    saveLive(); persistMessageOrg(selected); renderInbox();
  });
  $(".thread-archive", view)?.addEventListener("click", () => {
    selected.archivedAt = selected.archivedAt ? null : new Date().toISOString();
    saveLive(); persistMessageOrg(selected); renderInbox();
  });
  $(".thread-delete", view)?.addEventListener("click", () => {
    openModal(`
      <h2>Delete this thread from Knock?</h2>
      <p class="sub">This removes the thread from Knock tracking. It will not delete anything from Gmail.</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Cancel</button>
        <button class="btn btn--accent" id="m-delete">Delete from Knock</button>
      </div>`);
    $("#m-cancel", modal).addEventListener("click", closeModal);
    $("#m-delete", modal).addEventListener("click", async () => {
      closeModal();
      await deleteThreadFromKnock(selected);
      toast("Deleted from Knock. Gmail was not touched");
    });
  });
  wireReplyComposer(selected);
  const msgPane = $(".threadview__msgs", view);
  if (msgPane) msgPane.scrollTop = msgPane.scrollHeight;
}

/* ============================================================
   TRACKER
   ============================================================ */
const STAGES = [
  { id: "queued", label: "Queued", hint: "Drafting and sending", match: ["queued", "paused", "drafting", "sending", "scheduled", "waiting_gmail", "failed"] },
  { id: "sent", label: "Sent", hint: "Knocked, waiting", match: ["sent", "followup_sent", "opened"] },
  { id: "replied", label: "Replied", hint: "Door is open", match: ["replied", "needs_review"] },
  { id: "meeting", label: "Meeting booked", hint: "Go win", match: ["meeting"] },
];
const stageCount = (s) => state.messages.filter((m) => s.match.includes(m.status)).length;

function messageActions(m) {
  if (m.status === "queued") return `
    <button class="btn btn--paper btn--sm msg-pause" data-id="${m.id}">Pause</button>
    <button class="btn btn--paper btn--sm msg-cancel" data-id="${m.id}">Cancel</button>`;
  if (m.status === "paused") return `
    <button class="btn btn--sm msg-resume" data-id="${m.id}">Resume</button>
    <button class="btn btn--paper btn--sm msg-cancel" data-id="${m.id}">Cancel</button>`;
  if (m.status === "failed") return `
    <button class="btn btn--sm msg-retry" data-id="${m.id}">Retry</button>
    <button class="btn btn--paper btn--sm msg-cancel" data-id="${m.id}">Cancel</button>`;
  if (m.status === "waiting_gmail") return `
    <button class="btn btn--sm msg-connect" data-id="${m.id}">Connect Google to send</button>`;
  if (m.status === "needs_review" || ((m.status === "replied" || m.status === "meeting") && m.suggestedReply)) return `
    <button class="btn btn--sm msg-reply" data-id="${m.id}">View suggested reply</button>`;
  return "";
}

/* statuses with a real conversation behind them open in the inbox on click */
const TRACKER_LINKABLE = new Set(["sent", "followup_sent", "opened", "replied", "needs_review", "meeting", "scheduled"]);

function trackerRow(m) {
  const linkable = TRACKER_LINKABLE.has(m.status);
  const replyAt = lastReplyAt(m);
  const reply = latestInbound(m);
  return `
    <tr data-msg-id="${m.id}" class="${linkable ? "is-link" : ""}" ${linkable ? 'title="Open this conversation in the inbox"' : ""}>
      <td><div class="cell-who"><div><strong>${esc(m.name || "Unknown")}</strong><small>${esc(m.title || "")}</small></div></div></td>
      <td>${m.company ? `<div class="cell-co">${logo(m.company, m.companyDomain, 26)}<span>${esc(m.company)}</span></div>` : "·"}</td>
      <td class="cell-draft"><b>${esc(m.subject)}</b>
        ${m.calendarLink ? `<small>${icon("cal")} Google Calendar created · <a href="${esc(m.calendarLink)}" target="_blank" rel="noopener">calendar link</a></small>` : ""}</td>
      <td class="cell-status">${msgStatusCell(m)}</td>
      <td class="cell-last-reply">${replyAt ? `<b>${new Date(replyAt).toLocaleDateString()}</b><small>${esc(threadBodyText(reply).slice(0, 90))}</small>` : "<span>--</span>"}</td>
      <td class="cell-mono">${new Date(m.createdAt).toLocaleDateString()}</td>
      <td class="cell-msgact">${messageActions(m)}</td>
    </tr>`;
}

/* targeted: keep funnel tab counts honest without a full repaint */
function refreshTrackerCounts() {
  const tabs = $$(".ftab", view);
  if (!tabs.length) return;
  tabs.forEach((b) => {
    const id = b.dataset.id;
    const n = id === "all" ? state.messages.length : stageCount(STAGES.find((s) => s.id === id) || { match: [id] });
    const num = $("b", b);
    if (num) num.textContent = n;
  });
}

function renderTracker() {
  const tabs = [{ id: "all", label: "All" }, ...STAGES];
  const active = state.trackerTab;
  const activeStage = STAGES.find((s) => s.id === active);
  const rows = state.messages.filter((m) => active === "all" || (activeStage ? activeStage.match.includes(m.status) : m.status === active));
  const funnelCounts = STAGES.map((s) => ({ ...s, n: stageCount(s) }));
  const funnelTotal = funnelCounts.reduce((sum, s) => sum + s.n, 0);

  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Every door, <em>one funnel.</em></h1>
    <p>Where each knock stands, live: Scout drafts, sends from your Gmail, follows up, and flags replies for review.</p></div>

    <div class="funnel-tabs">
      ${tabs.map((s) => `
        <button class="ftab ${active === s.id ? "is-on" : ""}" data-id="${s.id}">
          <b>${s.id === "all" ? state.messages.length : stageCount(s)}</b><span>${s.label}</span>
        </button>`).join("")}
    </div>

    ${funnelTotal ? `
    <div class="funnel-bar" title="Your pipeline at a glance">
      ${funnelCounts.map((s) => s.n ? `<i class="fb--${s.id}" style="flex:${s.n}" title="${s.label}: ${s.n}"></i>` : "").join("")}
    </div>` : ""}

    ${state.messages.length ? `
    <div class="tablewrap" id="tracker-table">
      <table>
        <thead><tr><th>Person</th><th>Company</th><th>Subject</th><th>Status</th><th>Last Reply</th><th>Queued</th><th></th></tr></thead>
        <tbody>
          ${rows.map(trackerRow).join("")}
          ${rows.length === 0 ? `<tr><td colspan="7"><div class="empty" style="height:110px">Nothing in this stage yet.</div></td></tr>` : ""}
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
    b.addEventListener("click", () => { state.trackerTab = b.dataset.id; save("knock_tracker_tab", state.trackerTab); renderTracker(); }));
  $("#tr-cta", view)?.addEventListener("click", () => { location.hash = "dashboard"; });

  /* one delegated listener so rows can be re-rendered in place */
  $("#tracker-table", view)?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn) {
      /* plain row click: jump to the matching inbox conversation */
      const row = e.target.closest("tr.is-link[data-msg-id]");
      if (row && !e.target.closest("a")) {
        state.inboxSelectedId = row.dataset.msgId;
        save("knock_inbox_selected", state.inboxSelectedId);
        location.hash = "inbox";
      }
      return;
    }
    const m = msgById(btn.dataset.id);
    if (!m) return;
    if (btn.classList.contains("msg-pause")) {
      m.status = "paused"; saveLive(); updateMessageRow(m);
      toast("Paused. This knock won't send until you resume it");
    } else if (btn.classList.contains("msg-resume")) {
      m.status = "queued"; saveLive(); updateMessageRow(m);
      toast("Back in the queue, sending shortly");
      processSendQueue();
    } else if (btn.classList.contains("msg-retry")) {
      m.status = "queued"; m.error = null; saveLive(); updateMessageRow(m);
      toast("Retrying that knock");
      processSendQueue();
    } else if (btn.classList.contains("msg-connect")) {
      connectGoogle();
    } else if (btn.classList.contains("msg-reply")) {
      openSuggestedReply(m);
    } else if (btn.classList.contains("msg-cancel")) {
      state.messages = state.messages.filter((x) => x.id !== m.id);
      for (const c of state.campaigns) {
        c.selectedDoorIds = (c.selectedDoorIds || []).filter((id) => id !== m.doorId);
      }
      state.campaigns = state.campaigns.filter((c) => (c.selectedDoorIds || []).length > 0);
      saveLive();
      toast("Canceled. That knock never sent, so it cost you nothing");
      renderTracker();
      updateChrome();
    }
  });
}

/* ---- suggested reply review: AI-drafted response to a real reply ---- */
function openSuggestedReply(m) {
  const sr = m.suggestedReply || {};
  const subject = typeof sr === "string" ? `Re: ${m.subject}` : sr.subject || `Re: ${m.subject}`;
  const body = typeof sr === "string" ? sr : sr.body || "";
  const replyKind = typeof sr === "object" && sr.kind === "followup" ? "followup" : "reply";
  openModal(`
    <h2>Suggested reply</h2>
    <p class="sub">To ${esc(m.name || "them")}${m.company ? " · " + esc(m.company) : ""}${summaryText(m) ? `<br>Scout's read: <b>${esc(summaryText(m))}</b>` : ""}</p>
    ${m.calendarLink ? `<p class="meetlink">${icon("cal")} Google Calendar created · <a href="${esc(m.calendarLink)}" target="_blank" rel="noopener">${esc(m.calendarLink)}</a></p>` : ""}
    <label>Subject</label><input type="text" id="sr-subject" value="${esc(noEmDash(subject))}">
    <label>Reply</label><textarea id="sr-body" rows="8">${esc(noEmDash(body))}</textarea>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="sr-dismiss">Dismiss</button>
      <button class="btn btn--accent" id="sr-send">Send reply</button>
    </div>`);
  $("#sr-dismiss").addEventListener("click", () => {
    if (m.status === "needs_review") { m.status = "replied"; saveLive(); updateMessageRow(m); }
    closeModal();
  });
  $("#sr-send").addEventListener("click", async () => {
    const btn = $("#sr-send");
      btn.disabled = true; btn.textContent = "Sending…";
    try {
      const replySubject = noEmDash($("#sr-subject").value.trim());
      const replyBody = noEmDash($("#sr-body").value.trim());
      await sendThreadReply(m, {
        subject: replySubject,
        body: replyBody,
        bodyHtml: esc(replyBody).replace(/\n/g, "<br>"),
        kind: replyKind,
      });
      closeModal();
      toast("Reply sent. Scout keeps watching the thread");
      if ((location.hash.replace("#", "") || "dashboard") === "inbox") updateInboxThread(m, { forceBottom: true });
    } catch (err) {
      btn.disabled = false; btn.textContent = "Send reply";
      toast(`Could not send: ${esc(err.message)}`);
    }
  });
}

/* ============================================================
   REPLY / FOLLOW-UP SYNC: poll Gmail while dashboard or tracker is open
   ============================================================ */
let syncTimer = null;
let syncInFlight = false;

async function runGmailSync() {
  if (syncInFlight) return;
  const syncUserId = await realUserIdFromAuth();
  if (!syncUserId) return; /* dev mode: nothing to sync */
  if (!googleConnected()) return;
  const hasSent = state.messages.some((m) => ["sent", "scheduled", "followup_sent", "opened", "replied", "needs_review", "meeting"].includes(m.status));
  if (!hasSent) return;
  syncInFlight = true;
  try {
    const res = await fetch("/api/gmail/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: syncUserId }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error === "google_not_connected") {
      state.connections.google = false;
      saveConnections();
      return;
    }
    if (!res.ok || !data.ok) return;
    let replies = 0;
    let selectedUpdated = false;
    for (const u of data.updates || []) {
      const m = msgById(u.messageId);
      if (!m) continue;
      if (u.status && u.status !== m.status && (m.status !== "meeting" || u.status === "meeting")) {
        if (u.newInbound || u.status === "replied" || u.status === "needs_review") {
          replies++;
        }
        m.status = u.status;
      }
      if (u.statusDetail && u.statusDetail !== "syncing") m.statusDetail = u.statusDetail;
      else if (!["needs_review", "meeting"].includes(m.status)) delete m.statusDetail;
      if (u.classification) m.classification = u.classification;
      if (u.suggestedReply) m.suggestedReply = u.suggestedReply;
      if (u.threadMessages) {
        const inboundBefore = (m.threadMessages || []).filter((t) => !t.isFromMe).length;
        const inboundNow = u.threadMessages.filter((t) => !t.isFromMe).length;
        const newest = u.threadMessages[u.threadMessages.length - 1] || null;
        applyThreadRefresh(m, {
          ok: true,
          threadMessages: u.threadMessages,
          lastReplyAt: u.lastReplyAt,
          attachments: u.attachments,
          latestThreadMessageId: u.latestThreadMessageId,
          latestThreadMessageAt: u.latestThreadMessageAt,
        });
        if ((u.newInbound || inboundNow > inboundBefore) && newest && !newest.isFromMe) m.unread = true;
      }
      if (u.lastReplyAt) m.lastReplyAt = u.lastReplyAt;
      if (u.attachments) m.threadAttachments = u.attachments;
      if (u.meetLink) m.meetLink = u.meetLink;
      if (u.calendarLink) m.calendarLink = u.calendarLink;
      if (u.calendarEvent) m.calendarEvent = u.calendarEvent;
      if (u.availabilityOptions) m.availabilityOptions = u.availabilityOptions;
      if (u.followupNumber != null) m.followupNumber = u.followupNumber;
      if (u.suggestedReply) {
        m.history = [
          ...(m.history || []),
          { at: new Date().toISOString(), type: u.suggestedReply.kind || "reply", label: u.suggestedReply.subject || "Suggested reply", body: u.suggestedReply.body || "" },
        ].slice(-20);
      }
      updateMessageRow(m);
      if ((location.hash.replace("#", "") || "dashboard") === "inbox") {
        if (state.inboxSelectedId === m.id) selectedUpdated = updateInboxThread(m) || selectedUpdated;
        else updateThreadListItem(m);
      }
    }
    if ((data.updates || []).length) {
      saveLive();
      updateChrome();
      if ((location.hash.replace("#", "") || "dashboard") === "inbox" && !selectedUpdated) {
        const selected = msgById(state.inboxSelectedId);
        if (!selected || !inboxMatches(selected)) renderInbox();
      }
      if (replies) toast(`${replies} new repl${replies === 1 ? "y" : "ies"}. Scout drafted responses for review`);
    }
  } catch { /* offline; next tick will retry */ }
  finally { syncInFlight = false; }
}

function startSyncPolling() {
  if (syncTimer) return; /* single adaptive timer across live routes */
  const tick = async () => {
    syncTimer = null;
    await runGmailSync();
    const route = location.hash.replace("#", "") || "dashboard";
    if (!["dashboard", "people", "tracker", "inbox"].includes(route)) return;
    const delay = ["tracker", "inbox"].includes(route) ? 15000 : 60000;
    syncTimer = setTimeout(tick, delay);
  };
  tick();
}
function stopSyncPolling() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
}

/* ============================================================
   PROFILE (everything editable)
   ============================================================ */
function saveProfile() {
  state.profile.updatedAt = new Date().toISOString();
  save("knock_profile", state.profile);
  schedulePersistProfile();
}

/* ---- style learning from user edits ----
   When the user meaningfully edits, approves, or sends outgoing text, keep
   the final version as a voice exemplar. Edited Knock samples outrank Gmail
   examples in prompts because they reflect what the user actually accepted. */
function normalizeSampleText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sampleWordCount(text) {
  return (String(text || "").match(/[A-Za-z0-9']+/g) || []).length;
}

function rememberEditedSample({ before = "", after = "", category = "general", subject = "" } = {}) {
  const finalText = noEmDash(String(after || "").trim());
  if (!state.profile || finalText.length < 40 || sampleWordCount(finalText) < 8) return;
  const finalKey = normalizeSampleText(finalText);
  const beforeKey = normalizeSampleText(before);
  const existing = [
    ...(state.profile.editedSamples || []).map(normalizeSampleText),
    ...(state.profile.voiceExamples || []).map((s) => normalizeSampleText(s?.body || s?.text || "")),
  ];
  if (existing.includes(finalKey)) return;

  state.profile.editedSamples = [finalText, ...(state.profile.editedSamples || [])].slice(0, 20);
  state.profile.voiceExamples = [
    {
      source: "knock_edit",
      category,
      subject: subject || "",
      body: finalText.slice(0, 1600),
      bodyPreview: finalText.replace(/\s+/g, " ").slice(0, 180),
      wordCount: sampleWordCount(finalText),
      edited: beforeKey && beforeKey !== finalKey,
      date: new Date().toISOString(),
    },
    ...(state.profile.voiceExamples || []),
  ].slice(0, 30);
  state.profile.editedSampleCount = (state.profile.editedSampleCount || 0) + 1;
  saveProfile();
  if (state.profile.editedSampleCount % 3 === 0) refreshStyleFromEdits();
}

function captureEditedSample(text) {
  rememberEditedSample({ after: text });
}

async function refreshStyleFromEdits() {
  const p = state.profile;
  if (!p) return;
  const voiceBodies = (p.voiceExamples || []).map((s) => s?.body).filter(Boolean);
  const samples = [...(p.editedSamples || []), ...voiceBodies, ...(p.writingSampleTexts || []), ...(p.sampleTexts || [])].slice(0, 20);
  if (!samples.length) return;
  try {
    const res = await fetch("/api/profile/analyze-style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ samples, story: p.story || "" }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && data.styleProfile) {
      p.styleProfile = data.styleProfile;
      saveProfile();
      toast("Scout learned from your edits");
    }
  } catch { /* style learning is a bonus, never a blocker */ }
}

function formatShortDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function voiceToneSummary(style = {}) {
  const bits = [];
  if (style.formality || style.energy) bits.push(`Tone: ${[style.formality, style.energy].filter(Boolean).join("/")}`);
  if (style.greetingStyle) bits.push(`Greeting: ${style.greetingStyle}`);
  if (style.signoffStyle) bits.push(`Signoff: ${style.signoffStyle}`);
  if (style.averageSentenceWords) bits.push(`Average length: ${Math.round(style.averageSentenceWords)} words`);
  return bits;
}

function writingSampleLabel(sample) {
  if (typeof sample === "string") return sample;
  if (!sample || typeof sample !== "object") return "writing sample";
  if (sample.source === "gmail_sent") return `${sample.category || "gmail"} · ${sample.subject || "sent email"}`;
  return sample.subject || sample.category || "writing sample";
}

function voiceLearningCardHTML() {
  const p = state.profile || {};
  const auth = getAuthSnapshot();
  const learned = p.voiceLearning?.status === "ready";
  const count = p.voiceLearning?.sampleCount || p.voiceLearning?.selectedCount || 0;
  const learnedAt = formatShortDate(p.voiceLearning?.learnedAt);
  const summary = voiceToneSummary(p.styleProfile || {});
  const stateHtml = !auth.hasConfig || !auth.hasClient || auth.mode === "misconfigured" ? `
        <div class="voicelearn-status">
          <strong>Supabase browser config is missing on this deployment.</strong>
          <small>Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.</small>
        </div>
      ` : !auth.hasRealUser ? `
        <div class="voicelearn-status">
          <strong>Sign in to learn your voice.</strong>
          <small>Sign into Knock first, then connect Google to scan sent mail.</small>
        </div>
        <button class="btn btn--accent btn--sm" id="voice-signin">Sign in &amp; learn my voice</button>
      ` : learned ? `
        <div class="voicelearn-status">
          <strong>Learned from ${count} sent email${count === 1 ? "" : "s"}</strong>
          <small>${learnedAt ? `Last updated ${esc(learnedAt)}` : "Ready for future drafts"}</small>
        </div>
        ${summary.length ? `<div class="voicelearn-summary">${summary.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
        <div class="voicelearn-actions">
          <button class="btn btn--accent btn--sm" id="voice-learn">Relearn from Gmail</button>
          <button class="btn btn--paper btn--sm" id="voice-review">Review samples</button>
          <button class="btn btn--paper btn--sm" id="voice-reset">Reset voice</button>
        </div>
      ` : googleConnected() ? `
        <div class="voicelearn-status">
          <strong>Ready to learn</strong>
          <small>Scans your sent mail only. You can review or reset this anytime.</small>
        </div>
        <button class="btn btn--accent btn--sm" id="voice-learn">Learn from Gmail</button>
      ` : `
        <div class="voicelearn-status">
          <strong>Connect Google to learn from sent emails.</strong>
          <small>Approve Gmail permissions, then Scout can scan sent mail only.</small>
        </div>
        <button class="btn btn--sm" id="voice-connect">Connect Google to learn</button>
      `;
  return `
    <div class="pcard voicelearn-card">
      <h3>Voice learning</h3>
      <p class="voicelearn-copy">Scout can learn how you write from your sent emails and edited Knock drafts.</p>
      ${stateHtml}
      <p class="voicelearn-trust">Knock scans sent emails only. We use cleaned writing samples to learn style, not to train a public model. Scout never uses facts from old emails unless those facts are already in your profile or current thread.</p>
    </div>`;
}

async function learnVoiceFromGmail() {
  const user = await requireRealSupabaseAuth("learn from Gmail");
  if (!user) return;
  const connections = await refreshConnectionStatus({ silent: false });
  if (!connections.google) {
    startVoiceGoogleConnect();
    return;
  }
  openModal(`
    <h2>Learning your voice</h2>
    <p class="sub">Scout is using your sent mail only.</p>
    <div class="voicelearn-steps">
      <span>Scanning sent emails...</span>
      <span>Cleaning replies...</span>
      <span>Learning your voice...</span>
    </div>`, true);
  try {
    const res = await fetch("/api/gmail/learn-style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, maxMessages: 100, months: 12, includeReplyPairs: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error === "real_user_required") throw new Error("Sign in to Knock first.");
    if (res.status === 412 || data.error === "google_not_connected") {
      state.connections.google = false;
      saveConnections();
      throw new Error("Connect Google first.");
    }
    if (!res.ok || !data.ok) throw new Error(data.message || "Scout could not learn from Gmail yet.");
    await hydrateFromSupabase();
    if (state.profile) {
      state.profile.styleProfile = state.profile.styleProfile || data.styleProfile;
      state.profile.voiceLearning = state.profile.voiceLearning || data.voiceLearning;
      save("knock_profile", state.profile);
    }
    closeModal();
    toast("Scout learned your writing style from Gmail.");
    navigate();
  } catch (err) {
    closeModal();
    toast(esc(err.message || "Scout could not learn from Gmail yet."));
    navigate();
  }
}

function learnedSamplesForReview() {
  const p = state.profile || {};
  const samples = [
    ...(p.writingSamples || []).filter((s) => s && typeof s === "object" && s.source === "gmail_sent"),
    ...(p.voiceExamples || []).filter((s) => s && typeof s === "object" && s.source === "gmail_sent"),
  ];
  const seen = new Set();
  return samples.filter((s) => {
    const key = s.gmailMessageId || `${s.subject}:${s.bodyPreview}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function openVoiceReview() {
  const p = state.profile || {};
  const summary = voiceToneSummary(p.styleProfile || {});
  const groups = learnedSamplesForReview().reduce((acc, sample) => {
    const key = sample.category || "general";
    acc[key] = [...(acc[key] || []), sample];
    return acc;
  }, {});
  const groupHtml = Object.entries(groups).map(([category, samples]) => `
    <div class="voice-group">
      <h4>${esc(category.replace(/_/g, " "))}</h4>
      ${samples.slice(0, 6).map((s) => `
        <div class="voice-sample">
          <strong>${esc(s.subject || "Sent email")}</strong>
          <small>${esc([s.wordCount ? `${s.wordCount} words` : "", formatShortDate(s.date)].filter(Boolean).join(" · "))}</small>
          <p>${esc(s.bodyPreview || String(s.body || "").replace(/\s+/g, " ").slice(0, 220))}</p>
        </div>`).join("")}
    </div>`).join("");
  openModal(`
    <h2>Review learned voice</h2>
    <p class="sub">Previews only. Scout stores selected cleaned samples, not raw Gmail threads.</p>
    ${summary.length ? `<div class="voicelearn-summary voicelearn-summary--modal">${summary.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` : ""}
    ${groupHtml || `<p class="empty-line">No learned Gmail samples on this device yet.</p>`}
    <div class="modal__actions">
      <button class="btn btn--paper" id="voice-modal-reset">Reset voice</button>
      <button class="btn btn--accent" id="m-close">Done</button>
    </div>`);
  $("#voice-modal-reset", modal).addEventListener("click", () => resetLearnedVoice(true));
  $("#m-close", modal).addEventListener("click", closeModal);
}

function resetLearnedVoice(fromModal = false) {
  if (!state.profile) return;
  const doReset = () => {
    state.profile.styleProfile = null;
    state.profile.voiceLearning = null;
    state.profile.voiceExamples = [];
    state.profile.editedSamples = [];
    state.profile.editedSampleCount = 0;
    state.profile.writingSamples = (state.profile.writingSamples || [])
      .filter((s) => !(s && typeof s === "object" && s.source === "gmail_sent"));
    state.profile.writingSampleTexts = [];
    state.profile.sampleTexts = [];
    saveProfile();
    closeModal();
    toast("Learned voice reset");
    navigate();
  };
  if (fromModal) return doReset();
  openModal(`
    <h2>Reset learned voice?</h2>
    <p class="sub">This clears learned Gmail samples, edited-draft samples, and the current style profile. Your resume and profile stay put.</p>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="m-cancel">Keep voice</button>
      <button class="btn" id="m-reset">Reset voice</button>
    </div>`);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-reset").addEventListener("click", doReset);
}

function wireVoiceLearningCard() {
  $("#voice-signin", view)?.addEventListener("click", startVoiceSignInFlow);
  $("#voice-connect", view)?.addEventListener("click", startVoiceGoogleConnect);
  $("#voice-learn", view)?.addEventListener("click", learnVoiceFromGmail);
  $("#voice-review", view)?.addEventListener("click", openVoiceReview);
  $("#voice-reset", view)?.addEventListener("click", () => resetLearnedVoice(false));
}

/* ---- durable profile persistence (Supabase `profiles` table) ----
   Debounced upsert on every save; failures log to console only and the
   app keeps running on localStorage (dev mode has no Supabase at all). */
let profilePersistTimer = null;
function schedulePersistProfile() {
  const auth = window.knockAuth;
  if (!auth?.client || !auth.user?.id || auth.user.id === "dev") return;
  clearTimeout(profilePersistTimer);
  profilePersistTimer = setTimeout(persistProfileNow, 2000);
}
async function persistProfileNow() {
  const auth = window.knockAuth;
  const p = state.profile;
  if (!p || !auth?.client || !auth.user?.id || auth.user.id === "dev") return;
  try {
    const { error } = await auth.client.from("profiles").upsert({
      user_id: auth.user.id,
      full_name: p.fullName || null,
      email: p.email || auth.user.email || null,
      school: p.school || null,
      location: p.location || null,
      story: p.story || null,
      tone: p.tone || null,
      skills: p.skills || [],
      quantified_wins: p.quantifiedWins || [],
      profile_json: p,
      style_profile: p.styleProfile || null,
      autonomy: state.autonomy || null,
      send_prefs: state.sendPrefs || null,
      plan: state.plan || "free",
    }, { onConflict: "user_id" });
    if (error) console.warn("[knock] profile sync skipped:", error.message);
  } catch (err) {
    console.warn("[knock] profile sync skipped:", err?.message || err);
  }
}

/* on boot (and on a fresh device), pull the profile and the synced app
   state back from Supabase so the whole account follows the login */
async function hydrateFromSupabase() {
  const auth = window.knockAuth;
  if (!auth?.client || !auth.user?.id || auth.user.id === "dev") return;
  try {
    let res = await auth.client
      .from("profiles").select("profile_json, app_state").eq("user_id", auth.user.id).limit(1);
    if (res.error && /app_state/i.test(res.error.message || "")) {
      /* migration 004 not applied yet: profile sync still works */
      res = await auth.client
        .from("profiles").select("profile_json").eq("user_id", auth.user.id).limit(1);
    }
    if (res.error) {
      console.warn("[knock] hydrate skipped:", res.error.message);
      return;
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) return;
    const remoteProfile = row.profile_json;
    if (remoteProfile && (!state.profile || (remoteProfile.updatedAt || "") > (state.profile.updatedAt || ""))) {
      state.profile = remoteProfile;
      save("knock_profile", state.profile);
    }
    adoptRemoteAppState(row.app_state);
  } catch (err) {
    console.warn("[knock] hydrate skipped:", err?.message || err);
  }
}

/* merge a fresh resume parse into the profile without nuking hand-edits:
   resume-derived fields update; story/tone/signoff/traits/extraContext/
   industries/targets/styleProfile are never touched. */
function mergeParsedProfile(p, parsed) {
  if (parsed.school) p.school = parsed.school;
  if (parsed.degree) p.degree = parsed.degree;
  if (parsed.gradYear) p.gradYear = parsed.gradYear;
  if (Array.isArray(parsed.skills) && parsed.skills.length) {
    p.skills = [...new Set([...(p.skills || []), ...parsed.skills])].slice(0, 14);
  }
  if (Array.isArray(parsed.quantifiedWins) && parsed.quantifiedWins.length) {
    p.quantifiedWins = parsed.quantifiedWins;
  }
  if (Array.isArray(parsed.experience) && parsed.experience.length) {
    p.experience = parsed.experience;
  }
  if (Array.isArray(parsed.sections) && parsed.sections.length) {
    /* the resume's own section structure (Education, Professional Experience,
       Leadership & Extracurriculars, …) drives the Resume highlights card */
    p.sections = parsed.sections;
    p.resumeSections = parsed.sections;
  }
  if (Array.isArray(parsed.education) && parsed.education.length) {
    p.education = parsed.education;
  } else if (Array.isArray(p.sections)) {
    const eduSection = p.sections.find((s) => /education/i.test(s?.title || ""));
    if (eduSection?.items?.length && !(p.education || []).length) {
      p.education = eduSection.items.map((it) => ({
        school: it.org || it.role || "",
        degree: it.org && it.role ? it.role : "",
        when: it.when || "",
        bullets: it.bullets || [],
      })).filter((e) => e.school || e.degree);
    }
  }
  if (!p.location && parsed.location) p.location = parsed.location;
  if (!p.fullName && parsed.fullName) p.fullName = parsed.fullName;
  const bits = [];
  if (parsed.quantifiedWins?.length) bits.push(`${parsed.quantifiedWins.length} win${parsed.quantifiedWins.length === 1 ? "" : "s"}`);
  if (parsed.skills?.length) bits.push(`${parsed.skills.length} skill${parsed.skills.length === 1 ? "" : "s"}`);
  if (parsed.experience?.length) bits.push(`${parsed.experience.length} role${parsed.experience.length === 1 ? "" : "s"}`);
  if (parsed.sections?.length) bits.push(`${parsed.sections.length} section${parsed.sections.length === 1 ? "" : "s"}`);
  return bits.join(", ");
}

/* resume sections, normalized: the resume's own headings drive the card */
function profileSections(p) {
  const sections = Array.isArray(p.sections) && p.sections.length
    ? p.sections
    : Array.isArray(p.resumeSections) && p.resumeSections.length
      ? p.resumeSections
      : [];
  return sections.map((s) => ({
    title: s.title || "Resume",
    items: (s.items || []).filter((item) => item?.role || item?.org || item?.bullets?.length),
  }));
}

/* ALL-CAPS resume headings ("PROFESSIONAL EXPERIENCE") → "Professional experience" */
function sectionTitleCase(t) {
  const s = String(t || "Resume").trim();
  return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

/* keep the scorer/prompt-facing experience list in sync with section edits */
function syncDerivedFromSections(p) {
  if (!Array.isArray(p.sections) || !p.sections.length) return;
  p.resumeSections = p.sections;
  const work = p.sections.filter((s) => /experience|professional|work|employment/i.test(s.title || ""));
  const pool = (work.length ? work : p.sections.filter((s) => !/education/i.test(s.title || "")))
    .flatMap((s) => s.items || [])
    .filter((it) => it?.role || it?.org);
  if (pool.length) p.experience = pool.slice(0, 8);
}

/* the resume's own non-education sections (Professional Experience,
   Leadership & Extracurriculars, Projects, …), each editable per row.
   Falls back to a single "Experience & leadership" block from p.experience
   for profiles parsed before sections existed. */
function rhItemHTML(x, attrs, editCls, delCls) {
  return `
    <div class="xp__item">
      <strong>${esc(x.role || x.org || "Resume item")}</strong>
      <span class="when">${esc(x.role ? x.org || "" : "")}${x.when ? ((x.role && x.org) ? " · " : "") + esc(x.when) : ""}</span>
      ${(x.bullets || []).length ? `<ul>${(x.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      <div class="xp__actions">
        <button class="edit ${editCls}" ${attrs} title="Edit this entry">${icon("pen", "icn icn--xs")} Edit</button>
        <button class="edit ${delCls}" ${attrs}>Remove</button>
      </div>
    </div>`;
}

function rhCustomSections(p) {
  /* edits write to p.sections by index, so render the raw array directly */
  if (!(p.sections || []).length && (p.resumeSections || []).length) p.sections = p.resumeSections;
  const sections = (p.sections || [])
    .map((s, si) => ({ title: s.title || "Resume", items: s.items || [], si }))
    .filter((s) => !/education/i.test(s.title));
  if (sections.length) {
    return sections.map((s) => `
      <div class="rh-sect">
        <h4 class="rh-sub">${esc(sectionTitleCase(s.title))} <button class="edit sec-add" data-si="${s.si}">+ Add</button></h4>
        <div class="xp">
          ${s.items.map((x, ii) => rhItemHTML(x, `data-si="${s.si}" data-ii="${ii}"`, "sec-edit", "sec-del")).join("")}
          ${s.items.length === 0 ? `<p class="empty-line">Nothing in this section yet.</p>` : ""}
        </div>
      </div>`).join("");
  }
  /* legacy fallback: flat experience list */
  return `
    <div class="rh-sect">
      <h4 class="rh-sub">Experience &amp; leadership <button class="edit" id="xp-add">+ Add</button></h4>
      <div class="xp">
        ${(p.experience || []).map((x, i) => rhItemHTML(x, `data-i="${i}"`, "xp-edit", "xp-del")).join("")}
        ${(p.experience || []).length === 0 ? `<p class="empty-line">No experience added yet. Add the roles and wins you want Scout to lead with.</p>` : ""}
      </div>
    </div>`;
}

/* resume highlights card: remembers expanded/collapsed across re-renders */
let rhExpanded = false;

function renderProfile() {
  if (!state.profile) return renderNeedsProfile();
  const p = state.profile;
  const initials = (p.fullName || "?").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
  const samples = p.writingSamples || [];
  const sampleTexts = p.writingSampleTexts || [];
  const samplesExpanded = Boolean(state.profileExpanded.samples);

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
            <span class="voicebox__text"><b>Writing voice</b>: tone <b>${esc(p.tone || "Sharp")}</b> · sign-off <b>${esc(p.signoff || "- " + firstName())}</b></span>
            <button class="edit" id="edit-voice">Edit</button>
          </div>
        </div>
        ${voiceLearningCardHTML()}
        <div class="pcard">
          <h3>Resume <button class="edit" id="re-upload">Re-upload</button></h3>
          <div class="dropzone ${p.resumeFileName ? "is-filled" : ""}" id="resume-zone">
            ${p.resumeFileName
              ? `${icon("doc")} ${esc(p.resumeFileName)}<br><small>Drag a new resume here to update it automatically</small>`
              : `${icon("doc")} Drop your resume here<br><small>PDF, Word, or text</small>`}
          </div>
          <input type="file" id="resume-file" accept=".pdf,.doc,.docx,.txt,.md" hidden>
        </div>
      </div>
      <div class="profile-col">
        <div class="pcard">
          <h3>Your story <button class="edit" data-edit="story">Edit</button></h3>
          <p class="story" id="story-text">${p.story ? `“${esc(p.story)}”` : "Add the one or two sentences that make people reply."}</p>
        </div>
        <div class="pcard rhcard">
          <h3>Resume highlights</h3>
          <div class="rh-clip ${rhExpanded ? "" : "is-collapsed"}" id="rh-clip">
            <div class="rh-sect">
              <h4 class="rh-sub">Education <button class="edit" id="edu-add">+ Add</button></h4>
              <div class="xp">
                ${(p.education || []).map((x, i) => `
                  <div class="xp__item" data-i="${i}">
                    <strong>${esc(x.school)}</strong>
                    <span class="when">${esc(x.degree || "")}${x.when ? (x.degree ? " · " : "") + esc(x.when) : ""}</span>
                    ${(x.bullets || []).length ? `<ul>${(x.bullets || []).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
                    <div class="xp__actions">
                      <button class="edit edu-edit" data-i="${i}" title="Edit this entry">${icon("pen", "icn icn--xs")} Edit</button>
                      <button class="edit edu-del" data-i="${i}">Remove</button>
                    </div>
                  </div>`).join("")}
                ${(p.education || []).length === 0 ? `<p class="empty-line">No education entries yet. Add your school, program, and years.</p>` : ""}
              </div>
            </div>
            ${rhCustomSections(p)}
          </div>
          <div class="rh-more" id="rh-more" hidden><button class="pill" id="rh-toggle">Show more</button></div>
        </div>
        <div class="pcard">
          <h3>Skills</h3>
          <div class="skills" id="skills">
            ${(p.skills || []).map((s, i) => `<span>${esc(s)}<button class="chip-x" data-i="${i}" title="Remove">&times;</button></span>`).join("")}
            <input type="text" id="skill-add" placeholder="+ add a skill" />
          </div>
        </div>
        <div class="pcard profile-samples">
          <h3>Writing samples <button class="edit" id="samples-add">Add</button></h3>
          <p class="empty-line">Drop emails, essays, posts, or notes so Scout can write more like you.</p>
          <div class="dropzone ${samples.length ? "is-filled" : ""}" id="samples-zone">
            ${samples.length
              ? `${icon("doc")} ${samples.length} sample${samples.length === 1 ? "" : "s"} saved<br><small>${samples.slice(0, samplesExpanded ? samples.length : 3).map((s) => esc(writingSampleLabel(s))).join(" - ")}</small>`
              : `${icon("doc")} Drop writing samples here<br><small>.txt, .md, .eml, .docx, or paste text</small>`}
          </div>
          <input type="file" id="samples-file" multiple accept=".pdf,.doc,.docx,.txt,.md,.eml" hidden>
          ${sampleTexts.length ? `<small class="sample-note">Voice learner has ${sampleTexts.length} text sample${sampleTexts.length === 1 ? "" : "s"} available.</small>` : ""}
          ${samples.length > 3 ? `<button class="morelink" id="samples-more">${samplesExpanded ? "Show less" : `Show ${samples.length - 3} more`}</button>` : ""}
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
  wireVoiceLearningCard();

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

  /* resume highlights: collapse to ~420px with a fade; expand on demand.
     The full data always lives in state.profile, collapsed or not. */
  const rhClip = $("#rh-clip", view);
  const rhMore = $("#rh-more", view);
  const rhToggle = $("#rh-toggle", view);
  const applyRhClip = () => {
    rhClip.classList.toggle("is-collapsed", !rhExpanded);
    const overflows = rhClip.scrollHeight > rhClip.clientHeight + 4;
    rhMore.hidden = !(rhExpanded || overflows);
    rhToggle.textContent = rhExpanded ? "Show less" : "Show more";
  };
  applyRhClip();
  rhToggle.addEventListener("click", () => { rhExpanded = !rhExpanded; applyRhClip(); });

  /* education add/edit/remove (same row-editor pattern as experience) */
  const eduModal = (x = { school: "", degree: "", when: "", bullets: [] }, idx = -1) => {
    openModal(`
      <h2>${idx >= 0 ? "Edit" : "Add"} education</h2>
      <label>School</label><input type="text" id="e-school" value="${esc(x.school)}" placeholder="UC Irvine, Paul Merage School of Business">
      <label>Degree / program</label><input type="text" id="e-degree" value="${esc(x.degree)}" placeholder="B.A. Business Administration">
      <label>Years</label><input type="text" id="e-when" value="${esc(x.when)}" placeholder="2023 · 2027">
      <label>Notes (one per line, optional)</label>
      <textarea id="e-bullets" rows="3" placeholder="Dean's List, consulting club president">${esc((x.bullets || []).join("\n"))}</textarea>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Cancel</button>
        <button class="btn btn--accent" id="m-save">Save</button>
      </div>`);
    $("#m-cancel").addEventListener("click", closeModal);
    $("#m-save").addEventListener("click", () => {
      const item = {
        school: $("#e-school").value.trim(),
        degree: $("#e-degree").value.trim(),
        when: $("#e-when").value.trim(),
        bullets: $("#e-bullets").value.split("\n").map((b) => b.trim()).filter(Boolean),
      };
      if (!item.school && !item.degree) { closeModal(); return; }
      p.education = p.education || [];
      if (idx >= 0) p.education[idx] = item; else p.education.push(item);
      saveProfile(); closeModal(); renderProfile();
      toast("Education saved");
    });
  };
  $("#edu-add", view).addEventListener("click", () => eduModal());
  $$(".edu-edit", view).forEach((b) => b.addEventListener("click", () => eduModal(p.education[+b.dataset.i], +b.dataset.i)));
  $$(".edu-del", view).forEach((b) => b.addEventListener("click", () => {
    p.education.splice(+b.dataset.i, 1);
    saveProfile(); renderProfile();
    toast("Removed");
  }));

  /* resume item editor, shared by the legacy flat list and custom sections */
  const itemModal = (x = { role: "", org: "", when: "", bullets: [] }, heading, onSave) => {
    openModal(`
      <h2>${heading}</h2>
      <label>Role / title</label><input type="text" id="x-role" value="${esc(x.role || "")}" placeholder="Revenue Operations Consultant">
      <label>Company / org</label><input type="text" id="x-org" value="${esc(x.org || "")}" placeholder="IntegriTurf">
      <label>Years</label><input type="text" id="x-when" value="${esc(x.when || "")}" placeholder="2024 · 2025">
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
      onSave(item);
      saveProfile(); closeModal(); renderProfile();
      toast("Saved");
    });
  };

  /* legacy flat experience list (profiles without parsed sections) */
  $("#xp-add", view)?.addEventListener("click", () => itemModal(undefined, "Add resume item", (item) => {
    p.experience = [...(p.experience || []), item];
  }));
  $$(".xp-edit", view).forEach((b) => b.addEventListener("click", () =>
    itemModal(p.experience[+b.dataset.i], "Edit resume item", (item) => { p.experience[+b.dataset.i] = item; })));
  $$(".xp-del", view).forEach((b) => b.addEventListener("click", () => {
    p.experience.splice(+b.dataset.i, 1);
    saveProfile(); renderProfile();
    toast("Removed");
  }));

  /* custom resume sections: every row editable in place, per the resume's own headings */
  $$(".sec-add", view).forEach((b) => b.addEventListener("click", () => {
    const si = +b.dataset.si;
    itemModal(undefined, `Add to ${sectionTitleCase(p.sections[si]?.title)}`, (item) => {
      p.sections[si].items = [...(p.sections[si].items || []), item];
      syncDerivedFromSections(p);
    });
  }));
  $$(".sec-edit", view).forEach((b) => b.addEventListener("click", () => {
    const si = +b.dataset.si, ii = +b.dataset.ii;
    itemModal(p.sections[si]?.items?.[ii], `Edit ${sectionTitleCase(p.sections[si]?.title)} entry`, (item) => {
      p.sections[si].items[ii] = item;
      syncDerivedFromSections(p);
    });
  }));
  $$(".sec-del", view).forEach((b) => b.addEventListener("click", () => {
    const si = +b.dataset.si, ii = +b.dataset.ii;
    p.sections[si]?.items?.splice(ii, 1);
    syncDerivedFromSections(p);
    saveProfile(); renderProfile();
    toast("Removed");
  }));

  /* skills */
  $$("#skills .chip-x", view).forEach((b) => b.addEventListener("click", () => {
    p.skills.splice(+b.dataset.i, 1);
    saveProfile(); renderProfile();
  }));
  const skillInput = $("#skill-add", view);
  /* normal pill footprint: width fits the placeholder, grows as you type */
  skillInput.addEventListener("input", () => {
    skillInput.style.width = Math.min(240, Math.max(112, skillInput.value.length * 7 + 36)) + "px";
  });
  skillInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const v = e.target.value.trim();
    if (!v) return;
    p.skills = p.skills || [];
    if (!p.skills.includes(v)) p.skills.push(v);
    saveProfile(); renderProfile();
  });

  $("#samples-more", view)?.addEventListener("click", () => {
    state.profileExpanded.samples = !state.profileExpanded.samples;
    save("knock_profile_expanded", state.profileExpanded);
    renderProfile();
  });

  const addWritingFiles = async (files) => {
    if (!files?.length) return;
    const zone = $("#samples-zone", view);
    if (zone) zone.innerHTML = `${icon("doc")} Scout is reading your samples...`;
    p.writingSamples = p.writingSamples || [];
    p.writingSampleTexts = p.writingSampleTexts || [];
    for (const f of [...files].slice(0, 10)) {
      if (p.writingSamples.length >= 10) break;
      let text = await readFileText(f);
      if (!text) text = await requestTextExtract(f);
      p.writingSamples.push(f.name);
      if (text) p.writingSampleTexts.push(text.slice(0, 6000));
    }
    p.writingSamples = p.writingSamples.slice(0, 10);
    p.writingSampleTexts = p.writingSampleTexts.slice(0, 10);
    saveProfile();
    renderProfile();
    learnWritingVoice(p);
  };

  const sampleInput = $("#samples-file", view);
  $("#samples-add", view)?.addEventListener("click", () => {
    openModal(`
      <h2>Add writing samples</h2>
      <p class="sub">Paste an email, post, essay, or note that sounds like you. Scout uses it to tune rhythm and phrasing.</p>
      <label>Paste a sample</label>
      <textarea id="sample-paste" rows="7" placeholder="Paste a real sample here"></textarea>
      <div class="modal__actions">
        <button class="btn btn--ghost" id="m-cancel">Cancel</button>
        <button class="btn btn--paper" id="sample-browse">Browse files</button>
        <button class="btn btn--accent" id="sample-save">Save sample</button>
      </div>`);
    $("#m-cancel").addEventListener("click", closeModal);
    $("#sample-browse").addEventListener("click", () => { closeModal(); sampleInput.click(); });
    $("#sample-save").addEventListener("click", () => {
      const text = $("#sample-paste", modal).value.trim();
      if (!text) return obError("#sample-paste", "Paste a sample first.");
      p.writingSamples = [...(p.writingSamples || []), `pasted sample ${(p.writingSamples || []).length + 1}`].slice(0, 10);
      p.writingSampleTexts = [...(p.writingSampleTexts || []), text.slice(0, 6000)].slice(0, 10);
      saveProfile();
      closeModal();
      renderProfile();
      learnWritingVoice(p);
    });
  });
  $("#samples-zone", view)?.addEventListener("click", () => sampleInput.click());
  sampleInput?.addEventListener("change", () => addWritingFiles(sampleInput.files));
  ["dragover", "dragenter"].forEach((ev) => $("#samples-zone", view)?.addEventListener(ev, (e) => {
    e.preventDefault();
    $("#samples-zone", view)?.classList.add("is-drag");
  }));
  ["dragleave", "drop"].forEach((ev) => $("#samples-zone", view)?.addEventListener(ev, (e) => {
    e.preventDefault();
    $("#samples-zone", view)?.classList.remove("is-drag");
    if (ev === "drop") addWritingFiles(e.dataTransfer.files);
  }));

  /* extra context */
  $("#ctx-save", view).addEventListener("click", () => {
    p.extraContext = $("#extra-ctx", view).value.trim();
    saveProfile();
    toast("Saved");
  });

  /* resume re-upload: re-run the AI parser and merge results non-destructively */
  const fileInput = $("#resume-file", view);
  const handleResumeUpload = async (f) => {
    if (!f) return;
    const zone = $("#resume-zone", view);
    if (zone) zone.innerHTML = `${icon("doc")} ${esc(f.name)}<br><small>Scout is re-reading it…</small>`;
    p.resumeFileName = f.name;
    p.resumeAttachment = await attachmentFromFile(f);
    const text = await readFileText(f);
    if (text) p.resumeText = text;
    const parsedResult = await requestResumeParse(f);
    if (parsedResult?.parsed) {
      const summary = mergeParsedProfile(p, parsedResult.parsed);
      saveProfile(); renderProfile(); initAccount();
      toast(`Resume parsed${summary ? ": " + summary : ""}`);
    } else {
      /* parser offline: local extraction, still non-destructive */
      const facts = extractProfileFacts((text || "") + " " + (p.story || ""));
      const hadFacts = Boolean(facts.wins.length || facts.skills.length || facts.school);
      if (facts.wins.length) p.quantifiedWins = facts.wins;
      if (!p.school && facts.school) p.school = facts.school;
      p.skills = [...new Set([...(p.skills || []), ...facts.skills])].slice(0, 14);
      saveProfile(); renderProfile();
      toast(hadFacts
        ? "Resume saved. Scout pulled what it could locally"
        : (parsedResult?.note || "Resume saved. Scout could not read text from this file yet"));
    }
  };
  $("#re-upload", view).addEventListener("click", () => fileInput.click());
  $("#resume-zone", view).addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handleResumeUpload(fileInput.files[0]));
  ["dragover", "dragenter"].forEach((ev) => $("#resume-zone", view)?.addEventListener(ev, (e) => {
    e.preventDefault();
    $("#resume-zone", view)?.classList.add("is-drag");
  }));
  ["dragleave", "drop"].forEach((ev) => $("#resume-zone", view)?.addEventListener(ev, (e) => {
    e.preventDefault();
    $("#resume-zone", view)?.classList.remove("is-drag");
    if (ev === "drop") handleResumeUpload(e.dataTransfer.files?.[0]);
  }));
}

/* ============================================================
   SETTINGS
   ============================================================ */
function googleConnectionCopy() {
  const s = getAuthSnapshot();
  if (!s.hasConfig || !s.hasClient || s.mode === "misconfigured") {
    return {
      title: "Unavailable",
      sub: "Add Supabase browser config before connecting Google.",
      button: "Supabase config missing",
      disabled: true,
      disconnect: false,
    };
  }
  if (!s.hasRealUser) {
    return {
      title: "Not signed into Knock",
      sub: "First sign into Knock, then approve Gmail and Calendar permissions.",
      button: "Sign in & connect Google",
      disabled: false,
      disconnect: false,
    };
  }
  if (googleConnected()) {
    return {
      title: "Google connected",
      sub: "Gmail and Calendar are linked for sends, replies, and meetings.",
      button: "Disconnect",
      disabled: false,
      disconnect: true,
    };
  }
  return {
    title: "Google not connected",
    sub: "Approve Gmail and Calendar permissions.",
    button: "Connect Google",
    disabled: false,
    disconnect: false,
  };
}

function startSignInAndConnectGoogle() {
  sessionStorage.setItem("knock_after_login", "connect_google");
  const s = getAuthSnapshot();
  if (!s.hasConfig || !s.hasClient || s.mode === "misconfigured") {
    toast("Supabase browser config is missing on this deployment.");
    return;
  }
  window.knockAuth?.openLogin?.();
}

function startVoiceSignInFlow() {
  sessionStorage.setItem("knock_after_login", "connect_google");
  sessionStorage.setItem("knock_after_google_connect", "learn_voice");
  const s = getAuthSnapshot();
  if (!s.hasConfig || !s.hasClient || s.mode === "misconfigured") {
    toast("Supabase browser config is missing on this deployment.");
    return;
  }
  window.knockAuth?.openLogin?.();
}

function startVoiceGoogleConnect() {
  sessionStorage.setItem("knock_after_google_connect", "learn_voice");
  connectGoogle();
}

function authDiagnosticText() {
  const s = getAuthSnapshot();
  if (s.mode === "dev") return "Auth: Dev mode · Google unavailable";
  if (!s.hasConfig || !s.hasClient || s.mode === "misconfigured") {
    return "Auth: Supabase config missing · Google unavailable";
  }
  const userState = s.hasRealUser ? "Real account" : "Not signed in";
  const googleState = googleConnected() ? "Google connected" : "Google not connected";
  return `Auth: Supabase config present · ${userState} · ${googleState}`;
}

let settingsConnectionRefreshInFlight = false;

function renderSettings() {
  const auth = getAuthSnapshot();
  const user = auth.user || { email: "", name: "" };
  const isDev = auth.mode === "dev";
  const p = state.profile || {};
  const googleConn = googleConnectionCopy();
  const accountName = auth.hasRealUser
    ? (user.name || user.email || "Account")
    : (p.fullName || user.name || "Your profile");
  const accountSub = auth.hasRealUser
    ? `${user.email || ""}${isDev ? " · dev login (configure Supabase for real auth)" : ""}`
    : "Not signed in · Local profile saved on this device";
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Settings</h1><p>How Scout behaves in other people's inboxes.</p></div>
    <div class="settings-grid">
      <div class="pcard">
        <h3>Account</h3>
        <div class="setrow"><span class="ico">${I.story}</span><div><strong>${esc(accountName)}</strong><small>${esc(accountSub)}</small></div>
          ${auth.hasRealUser
            ? `<button class="btn btn--paper btn--sm end" id="set-logout">Log out</button>`
            : `<button class="btn btn--accent btn--sm end" id="set-signin">Sign in</button>`}</div>
        <div class="setrow"><span class="ico">${I.plug}</span><div><strong>Auth status</strong><small id="auth-status-line">${esc(authDiagnosticText())}</small></div></div>
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
          ? `${state.sendPrefs.mode === "auto" ? "Fully automated" : "Review every send"} · via ${state.sendPrefs.channel === "gmail" ? "Gmail" : "queue"}`
          : "Mode and channel for your knocks"}</small></div>
          <button class="btn btn--paper btn--sm end" id="set-sendprefs">Edit</button></div>
      </div>
      ${voiceLearningCardHTML()}
      <div class="pcard" id="files-card">
        <h3>Attachments</h3>
        <div id="files-list"><div class="setrow"><span class="ico">${I.doc}</span><div><strong>Loading…</strong><small>Fetching your saved files</small></div></div></div>
        <div class="setrow" style="border:none">
          <span class="ico">${I.doc}</span>
          <div><strong>Add attachment</strong><small>Up to 5 files, 5MB each. Attach them to knocks from the review screen.</small></div>
          <button class="btn btn--paper btn--sm end" id="file-add">Upload</button>
        </div>
        <input type="file" id="file-add-input" multiple hidden>
      </div>
      <div class="pcard">
        <h3>Connections</h3>
        <div class="setrow"><span class="ico">${I.mail}</span><div><strong>Google</strong><small><strong>${esc(googleConn.title)}</strong> · ${esc(googleConn.sub)}</small></div>
          ${googleConn.disconnect
            ? `<button class="btn btn--paper btn--sm end conn-off" data-id="google">Disconnect</button>`
            : `<button class="btn btn--sm end conn-on" data-id="google"${googleConn.disabled ? " disabled" : ""}>${esc(googleConn.button)}</button>`}</div>
        <div class="setrow"><span class="ico">${I.plug}</span><div><strong>All channels</strong><small>Outlook and more</small></div>
          <button class="btn btn--paper btn--sm end" id="set-connections">Manage</button></div>
        <div class="setrow"><span class="ico">${I.search}</span><div><strong>Connection status</strong><small>Ask the server what is connected for this account</small></div>
          <button class="btn btn--paper btn--sm end" id="conn-recheck">Recheck</button></div>
      </div>
      <div class="pcard">
        <h3>Plan &amp; billing</h3>
        <div class="setrow"><span class="ico">${I.cap}</span><div><strong>${state.plan === "unlimited" ? "Unlimited" : state.plan === "pro" ? "Pro" : "Student · Free"}</strong><small>${state.knocks} of ${knockLimit()} knocks left this month</small></div>
          ${state.plan === "free" ? `<button class="btn btn--sm end" id="set-upgrade">Go Pro</button>` : ""}</div>
        <div class="setrow redeemrow"><span class="ico">${I.spark}</span><div><strong>Redeem code</strong><small>Use a Pro or test license key on this account</small></div>
          <div class="redeemrow__form"><input id="pro-code" type="text" placeholder="License key"><button class="btn btn--paper btn--sm" id="pro-redeem">Redeem</button></div></div>
        <div class="setrow"><span class="ico">${I.bell}</span><div><strong>Daily digest</strong><small>One email: new matches + warm threads</small></div>
          <label class="switch end"><input type="checkbox" data-k="digest" ${state.autonomy.digest ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">${I.chat}</span><div><strong>Feedback</strong><small>Tell us what to build next</small></div>
          <button class="btn btn--paper btn--sm end" id="set-feedback">Send</button></div>
      </div>
    </div>
  </div>`;

  $$('.switch input', view).forEach((sw) =>
    sw.addEventListener("change", () => {
      if (sw.dataset.k) { state.autonomy[sw.dataset.k] = sw.checked; save("knock_autonomy", state.autonomy); schedulePersistProfile(); }
      toast(sw.checked ? "On" : "Off");
    }));
  $("#set-upgrade", view)?.addEventListener("click", openUpgrade);
  $("#set-sendprefs", view).addEventListener("click", () => openSendPrefs(renderSettings));
  $("#set-feedback", view).addEventListener("click", openFeedback);
  $("#set-connections", view).addEventListener("click", openConnections);
  $("#conn-recheck", view)?.addEventListener("click", recheckConnectionStatus);
  wireVoiceLearningCard();
  $("#pro-redeem", view)?.addEventListener("click", redeemProCode);
  $("#set-logout", view)?.addEventListener("click", () => window.knockAuth.signOut());
  $("#set-signin", view)?.addEventListener("click", () => window.knockAuth?.openLogin?.());
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
       "knock_connections", "knock_autonomy", "knock_left", "knock_plan", "knock_search_mode", "knock_ob_draft", "knock_days",
       "knock_filters", "knock_door_sort", "knock_send_prefs", "knock_tour_done", "knock_tracker_tab", "knock_state_updated_at",
       "knock_strip_dismissed", "knock_inbox_selected", "knock_inbox_filter", "knock_profile_expanded", ACTIVE_USER_ID_KEY]
        .forEach((k) => localStorage.removeItem(k));
      location.reload();
    });
  });
  $$(".conn-on", view).forEach((b) => b.addEventListener("click", () => {
    if (b.disabled) return;
    if (b.dataset.id === "google") {
      const copy = googleConnectionCopy();
      if (!getAuthSnapshot().hasRealUser) return startSignInAndConnectGoogle();
      return connectGoogle();
    }
  }));
  $$(".conn-off", view).forEach((b) => b.addEventListener("click", () => disconnectProvider(b.dataset.id)));

  if (!settingsConnectionRefreshInFlight) {
    settingsConnectionRefreshInFlight = true;
    refreshConnectionStatus({ silent: true }).then(({ changed } = {}) => {
      settingsConnectionRefreshInFlight = false;
      if (changed && (location.hash.replace("#", "") || "dashboard") === "settings") renderSettings();
      else {
        const line = $("#auth-status-line", view);
        if (line) line.textContent = authDiagnosticText();
      }
    }).catch(() => {
      settingsConnectionRefreshInFlight = false;
    });
  }

  /* ---- attachments card: resume + up to 5 extra files ---- */
  const paintFiles = () => {
    const list = $("#files-list", view);
    if (!list) return;
    if (!filesApiAvailable()) {
      list.innerHTML = `<div class="setrow"><span class="ico">${I.doc}</span><div><strong>Dev mode</strong><small>Sign in with a real account to store attachments</small></div></div>`;
      return;
    }
    const resume = resumeFile();
    const extras = attachmentFiles();
    list.innerHTML = `
      <div class="setrow"><span class="ico">${I.doc}</span>
        <div><strong>My resume</strong><small>${resume ? `${esc(resume.name)} · select it in Review knock` : "Not on file yet. Upload it on the Profile page and it lands here."}</small></div>
      </div>
      ${extras.map((f) => `
        <div class="setrow"><span class="ico">${I.doc}</span>
          <div><strong>${esc(f.name)}</strong><small>${Math.max(1, Math.round((f.sizeBytes || 0) / 1024))} KB</small></div>
          <button class="btn btn--paper btn--sm end file-del" data-id="${f.id}">Remove</button>
        </div>`).join("")}
      ${extras.length === 0 ? `<div class="setrow"><span class="ico">${I.doc}</span><div><strong>No extra attachments yet</strong><small>Upload case studies, portfolios, or one-pagers to send with knocks</small></div></div>` : ""}`;
    $$(".file-del", list).forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const ok = await deleteUserFile(b.dataset.id);
      toast(ok ? "Attachment removed" : "Could not remove that file");
      paintFiles();
    }));
  };
  loadUserFiles().then(paintFiles);
  const fileInput = $("#file-add-input", view);
  $("#file-add", view)?.addEventListener("click", () => {
    if (!filesApiAvailable()) return toast("Sign in with a real account to store attachments");
    fileInput.click();
  });
  fileInput?.addEventListener("change", async () => {
    const room = MAX_EXTRA_ATTACHMENTS - attachmentFiles().length;
    const files = [...fileInput.files].slice(0, Math.max(0, room));
    if (!files.length && fileInput.files.length) {
      return toast(`You already have ${MAX_EXTRA_ATTACHMENTS} attachments. Remove one first`);
    }
    for (const f of files) await uploadUserFile(f, "attachment");
    paintFiles();
  });

  fetch("/api/apollo/usage").then((r) => r.json()).then((d) => {
    const el = $("#apollo-status", view);
    if (el) el.textContent = d.configured
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

async function redeemProCode() {
  const input = $("#pro-code", view);
  const btn = $("#pro-redeem", view);
  const code = input?.value.trim();
  if (!code) { toast("Enter a license key first"); return; }
  const authUser = await requireRealSupabaseAuth("redeem a license");
  if (!authUser) return;
  btn.disabled = true; btn.textContent = "Checking...";
  try {
    const res = await fetch("/api/billing/redeem-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: authUser.id, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Redeem failed (${res.status})`);
    state.plan = data.plan || "pro";
    state.knocks = Math.max(state.knocks || 0, knockLimit());
    saveLive();
    schedulePersistProfile();
    toast(state.plan === "unlimited" ? "Unlimited access unlocked" : "Pro access unlocked");
    renderSettings();
    updateChrome();
  } catch (err) {
    btn.disabled = false; btn.textContent = "Redeem";
    toast(`Code not accepted: ${esc(err.message)}`);
  }
}

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

/* file → base64, chunked to dodge call-stack limits on big resumes */
async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

const MAX_SAVED_ATTACHMENTS = 5;

async function attachmentFromFile(file) {
  if (!file) return null;
  if (file.size > MAX_ATTACHMENT_BYTES) {
    toast(`${esc(file.name)} is over 5MB, so it was skipped`);
    return null;
  }
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `att_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    contentBase64: await fileToBase64(file),
  };
}

function attachmentLabel(a) {
  const kb = Math.max(1, Math.round(Number(a?.size || 0) / 1024));
  return `${a?.fileName || "attachment"}${kb ? ` (${kb} KB)` : ""}`;
}

/* POST the resume to the AI parser; null when the parser can't help */
async function requestResumeParse(file) {
  try {
    const res = await fetch("/api/profile/parse-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentBase64: await fileToBase64(file) }),
    });
    const data = await res.json();
    return data.ok && data.parsed
      ? { parsed: data.parsed, source: data.source, note: data.note || "" }
      : { parsed: null, source: data.source || "none", note: data.note || "Parser could not read this file." };
  } catch {
    return { parsed: null, source: "offline", note: "Parser is offline. Try again after the dev server restarts." };
  }
}

async function requestTextExtract(file) {
  try {
    const res = await fetch("/api/profile/extract-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentBase64: await fileToBase64(file) }),
    });
    const data = await res.json();
    return data.ok ? data.text || "" : "";
  } catch {
    return "";
  }
}

async function learnWritingVoice(p, notify = true) {
  const samples = (p.writingSampleTexts || []).filter(Boolean).slice(0, 10);
  if (!samples.length && !p.story) return;
  try {
    const res = await fetch("/api/profile/analyze-style", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ samples, story: p.story || "" }),
    });
    const data = await res.json();
    if (data.ok && data.styleProfile) {
      p.styleProfile = data.styleProfile;
      saveProfile();
      if (notify) toast("Scout relearned your writing voice");
    }
  } catch {
    if (notify) toast("Writing samples saved. Voice learning will retry later.");
  }
}

/* upload the resume to the parser; falls back to raw text + local extraction */
async function parseResumeFile(file) {
  /* store the file itself too, so "attach my resume" works from day one */
  if (filesApiAvailable()) {
    uploadUserFile(file, "resume").then((saved) => {
      if (saved) {
        OB.resumeFileId = saved.id;
        saveOB();
        if (state.profile) { state.profile.resumeFileId = saved.id; saveProfile(); }
      }
    });
  }
  try {
    const res = await fetch("/api/profile/parse-resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, contentBase64: await fileToBase64(file) }),
    });
    const data = await res.json();
    if (data.ok && data.parsed) {
      OB.parsed = data.parsed;
      OB.resumeParsed = true;
      OB.parseNote = "";
      const found = [data.parsed.school && "school", data.parsed.skills?.length && `${data.parsed.skills.length} skills`,
        data.parsed.sections?.length && `${data.parsed.sections.length} sections`, data.parsed.experience?.length && `${data.parsed.experience.length} roles`, data.parsed.quantifiedWins?.length && `${data.parsed.quantifiedWins.length} wins`]
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
      OB.resumeAttachment = await attachmentFromFile(f);
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
      <h2>Which doors should Knock start with?</h2>
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
    resumeAttachment: OB.resumeAttachment || null,
    resumeText: OB.resumeText || "",
    target: (OB.targetRoles || []).join(", ") || "founders and operators",
    industries: OB.industries || [],
    targetRoles: OB.targetRoles || [],
    locations: OB.locations || ["Any"],
    tone: OB.tone,
    signoff: `- ${(OB.fullName || "").split(" ")[0] || "Me"}`,
    traits: [...new Set([OB.personaLine, ...(OB.workStyles || [])].filter(Boolean))],
    writingSamples: OB.writingSamples || [],
    writingSampleTexts: (OB.sampleTexts || []).slice(0, 10),
    sampleTexts: OB.sampleTexts || [],
    editedSamples: [],
    editedSampleCount: 0,
    quantifiedWins: wins,
    skills: [...new Set([...(parsed.skills || []), ...local.skills])].slice(0, 14),
    sections: parsed.sections?.length ? parsed.sections : local.sections || [],
    resumeSections: parsed.sections?.length ? parsed.sections : local.sections || [],
    experience: parsed.experience || [],
    education: parsed.education || [],
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
  { route: "tracker", sel: ".funnel-tabs", title: "Tracker", text: "Watch every knock live: drafting, sending, sent, replied, meeting booked. Pause, retry, or review Scout's suggested replies right from the table." },
  { route: "profile", sel: ".profile-grid", title: "Your profile", text: "Everything Scout knows about you, parsed from your resume. Every field is editable, and every edit updates future drafts instantly." },
  { route: "settings", sel: ".settings-grid", title: "Settings", text: "Google connection, agent autonomy, sending preferences, attachments, and your plan all live here." },
];

function waitForEl(sel, timeout = 2500) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      const el = $(sel, view);
      if (el) return resolve(el);
      if (Date.now() - t0 > timeout) return resolve(null);
      setTimeout(poll, 200);
    })();
  });
}

function endTour(msg) {
  document.getElementById("tour")?.remove();
  save("knock_tour_done", true);
  if (msg) toast(msg);
}

/* Escape always frees the user, even if a step ever misbehaves */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("tour")) {
    endTour("Tour closed. Replay it anytime from the account menu");
  }
});

let tourRunId = 0;
async function startTour(stepIndex = 0) {
  const runId = ++tourRunId;
  document.getElementById("tour")?.remove();
  if (stepIndex >= TOUR_STEPS.length) {
    save("knock_tour_done", true);
    location.hash = "dashboard";
    toast("That's the tour. Go knock on something");
    return;
  }
  if (stepIndex < 0) stepIndex = 0;
  const step = TOUR_STEPS[stepIndex];
  if ((location.hash.replace("#", "") || "dashboard") !== step.route) {
    location.hash = step.route;
  }
  const el = await waitForEl(step.sel);
  if (runId !== tourRunId) return; /* user moved on while we waited */
  /* target missing on this view (still sourcing, empty state…): skip ahead */
  if (!el) return startTour(stepIndex + 1);
  el.scrollIntoView({ block: "center", behavior: "instant" });

  const r = el.getBoundingClientRect();
  const pad = 8;
  const tour = document.createElement("div");
  tour.id = "tour";
  /* clamp the card fully on-screen: tall targets (like the doors table)
     used to push it off-viewport, trapping the user under the overlay */
  const CARD_W = 340, CARD_H = 220, gap = 16;
  const left = Math.max(gap, Math.min(r.left, window.innerWidth - CARD_W - gap));
  let top = r.bottom + CARD_H + gap < window.innerHeight ? r.bottom + gap : r.top - CARD_H - gap;
  top = Math.max(gap, Math.min(top, window.innerHeight - CARD_H - gap));
  tour.innerHTML = `
    <div class="tour-hole" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px"></div>
    <div class="tour-card" style="top:${top}px;left:${left}px">
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
  $("#tour-skip").addEventListener("click", () =>
    endTour("You can replay the tour anytime from the account menu"));
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
  try {
    /* brief loading state: never flash a login redirect while the session
       check (and state hydration) is in flight */
    view.innerHTML = `<div class="viewwrap"><div class="ghost ghost--boot">
      <div class="ghost__icon ghost__icon--spin">${I.spark}</div>
      <h2>Opening your doors…</h2>
    </div></div>`;
    const user = await window.knockAuth?.ready;
    if (!user) {
      /* genuinely no session anywhere: back to the landing login */
      location.replace("/#login");
      return;
    }
    /* tidy the URL after a magic-link / OAuth redirect */
    if (/access_token|refresh_token|error_description/.test(location.hash)) {
      history.replaceState(null, "", location.pathname + "#dashboard");
    }
    if (isRealUuid(user.id)) rememberActiveUserId(user.id);
    await handleConnectReturn();
    /* pull the profile and synced app state back from Supabase before
       deciding on onboarding, so a new device starts with everything */
    await hydrateFromSupabase();
    await handleAfterLoginAction();
    initAccount();
    navigate();
    refreshConnectionStatus({ silent: true }).then(({ changed } = {}) => {
      if (changed) navigate();
    });
    refreshApolloUsage();
    if (!state.profile) openOnboarding(1);

    /* resume the send pipeline after a reload or an OAuth round-trip:
       un-stick anything caught mid-flight and release parked knocks */
    let resumable = 0;
    state.messages.forEach((m) => {
      if (m.status === "drafting" || m.status === "sending") { m.status = "queued"; resumable++; }
      if (m.status === "waiting_gmail" && googleConnected()) { m.status = "queued"; resumable++; }
    });
    if (resumable) { saveLive(); processSendQueue(); }
    window.__knockBooted = true;
  } catch (err) {
    renderAppError(err, "boot");
  }
})();
