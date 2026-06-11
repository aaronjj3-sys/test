/* ============================================================
   Knock app — SPA logic
   Views: dashboard · find people · inbox · tracker · profile · settings
   Agent drawer simulates a TechCenter/Tsenta-style background agent:
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
  autonomy: { review: true, followups: true, weekends: false },
  stats: { sent: 31, openRate: 71, replies: 9, meetings: 2 },
};
const contact = (id) => CONTACTS.find((c) => c.id === id);
const saveKnocks = () => localStorage.setItem("knock_left", state.knocks);

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

const avatarBg = { lavender: "#7a68c9", mint: "#1f4d3a", blush: "#c95f3c", butter: "#a8842a" };
const av = (c, size = 26) =>
  `<span class="avatar" style="width:${size}px;height:${size}px;background:${avatarBg[c.color]};font-size:${size * 0.34}px">${c.initials}</span>`;

const askLabel = { job: "Job / internship", coffee: "Coffee chat", case: "Case comp" };
const askEmoji = { job: "💼", coffee: "☕", case: "🏆" };
const sourceBadge = (s) =>
  ({ yc: '<span class="badge badge--yc">YC directory</span>',
     alumni: '<span class="badge badge--alumni">Alumni</span>',
     hiring: '<span class="badge badge--hiring">Hiring now</span>',
     vc: '<span class="badge badge--vc">VC · PE</span>' }[s] || "");

function updateChrome() {
  $("#knocks-left").textContent = state.knocks;
  $("#knocks-bar").style.width = (state.knocks / 15) * 100 + "%";
  const unread = state.threads.filter((t) => t.unread).length;
  const badge = $("#inbox-badge");
  badge.hidden = unread === 0;
  badge.textContent = unread;
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

function renderDashboard() {
  const inPipeline = new Set(state.outreach.map((o) => o.contactId));
  const matches = CONTACTS.filter((c) => !inPipeline.has(c.id) && !state.passed.has(c.id)).slice(0, 5);
  const warm = state.outreach.filter((o) => o.stage === "replied" || o.stage === "meeting").length;

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>${greeting()}, ${PROFILE.name.split(" ")[0]}. <em>${warm} warm thread${warm === 1 ? "" : "s"}</em> waiting.</h1>
      <p>Scout sourced ${matches.length} new doors overnight from the YC directory, alumni network, and live hiring signals.</p>
    </div>

    <div class="statgrid">
      <div class="statcard"><small>Knocks sent</small><div class="num">${state.stats.sent}</div><span class="delta">▲ 8 this week</span></div>
      <div class="statcard"><small>Open rate</small><div class="num">${state.stats.openRate}%</div><span class="delta">▲ 12% vs job boards' 2%</span></div>
      <div class="statcard"><small>Replies</small><div class="num">${state.stats.replies}</div><span class="delta">▲ 3 this week</span></div>
      <div class="statcard"><small>Meetings booked</small><div class="num">${state.stats.meetings}</div><span class="delta">Thu 2:00 PM next</span></div>
    </div>

    <div class="rowhead">
      <h2 class="serif">Top doors to knock</h2>
      <span class="rowhead__hint">ranked for you · refreshed 2h ago</span>
      <div class="rowhead__actions">
        <a class="btn btn--paper btn--sm" href="#people">Browse all</a>
        <button class="btn btn--sm" id="knock-all">✦ Knock on all ${matches.length}</button>
      </div>
    </div>
    <div class="matches">
      ${matches.map((c, i) => `
        <div class="match-card match-card--${c.color}" style="animation-delay:${i * 70}ms" data-id="${c.id}">
          <div class="match-card__top">
            <span class="match-card__meta">${c.location}<br>${askEmoji[c.type]} ${askLabel[c.type]}</span>
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
      <h2 class="serif">All outreach</h2>
      <span class="rowhead__hint">${state.outreach.length} active</span>
      <div class="rowhead__actions"><a class="btn btn--paper btn--sm" href="#tracker">Open tracker</a></div>
    </div>
    <div class="tablewrap"><table>
      <thead><tr><th>Person</th><th>Ask</th><th>Status</th><th>Opens</th><th>Last activity</th><th></th></tr></thead>
      <tbody>
        ${state.outreach.map((o) => { const c = contact(o.contactId); const st = STAGES.find((s) => s.id === o.stage); return `
          <tr data-id="${c.id}">
            <td><div class="cell-who">${av(c, 32)}<div><strong>${c.name}</strong><small>${c.role} · ${c.company}</small></div></div></td>
            <td class="cell-mono">${askEmoji[c.type]} ${askLabel[c.type]}</td>
            <td><span class="status status--${o.stage}">${st.label}</span></td>
            <td class="cell-mono">${o.opens || "—"}</td>
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
      toast("Passed — Scout recalibrates your matches");
      setTimeout(renderDashboard, 320);
    }));
  $("#knock-all", view)?.addEventListener("click", () => {
    if (!matches.length) return;
    matches.slice(1).forEach((c) => state.outreach.unshift({ contactId: c.id, stage: "drafted", lastTouch: "just now", opens: 0, note: "Draft ready for review" }));
    toast(`✦ Scout is drafting ${matches.length} knocks — first one ready now`);
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
   FIND PEOPLE
   ============================================================ */
function renderPeople() {
  const { source, ask, q } = state.filters;
  const list = CONTACTS.filter((c) =>
    (source === "all" || c.source === source) &&
    (ask === "all" || c.type === ask) &&
    (!q || (c.name + c.company + c.role).toLowerCase().includes(q)));

  view.innerHTML = `<div class="viewwrap">
    <div class="vh">
      <h1>Find people, <em>not postings.</em></h1>
      <p>Scout watches the YC directory, your alumni network, PE/VC rosters, and live hiring signals — and ranks who will actually answer you.</p>
    </div>
    <div class="filters">
      ${SOURCES.map((s) => `<button class="pill ${source === s.id ? "is-on" : ""}" data-k="source" data-v="${s.id}">${s.label}</button>`).join("")}
      <span style="width:10px"></span>
      ${ASKS.map((a) => `<button class="pill ${ask === a.id ? "is-on" : ""}" data-k="ask" data-v="${a.id}">${a.label}</button>`).join("")}
    </div>
    <div class="peoplegrid">
      ${list.map((c, i) => `
        <div class="person-card" style="animation-delay:${i * 50}ms" data-id="${c.id}">
          <div class="person-card__top">
            <span class="avatar ${c.color}" style="width:42px;height:42px;font-size:14px">${c.initials}</span>
            <div><h3>${c.name}</h3><span class="sub">${c.role} · <b>${c.company}</b></span></div>
          </div>
          <div class="person-card__badges">${sourceBadge(c.source)}<span class="badge">${askEmoji[c.type]} ${askLabel[c.type]}</span><span class="badge">${c.location}</span></div>
          <div class="signal"><b>Signal:</b> ${c.signal}</div>
          <div class="person-card__foot">
            ${ring(c.match, 40)}
            <span class="spacer"></span>
            <button class="btn btn--paper btn--sm act-pass">Pass</button>
            <button class="btn btn--sm act-knock">✦ Draft knock</button>
          </div>
        </div>`).join("")}
      ${list.length === 0 ? `<div class="empty">No one matches those filters — Scout is sourcing more doors tonight.</div>` : ""}
    </div>
  </div>`;

  $$(".pill", view).forEach((p) =>
    p.addEventListener("click", () => { state.filters[p.dataset.k] = p.dataset.v; renderPeople(); }));
  $$(".person-card .act-knock", view).forEach((b) =>
    b.addEventListener("click", (e) => openAgent(contact(e.target.closest(".person-card").dataset.id))));
  $$(".person-card .act-pass", view).forEach((b) =>
    b.addEventListener("click", (e) => {
      const card = e.target.closest(".person-card");
      state.passed.add(card.dataset.id);
      card.style.cssText += "transition:.3s;opacity:0;transform:scale(.96)";
      setTimeout(() => card.remove(), 300);
      toast("Passed — fewer of these next time");
    }));
}

/* ============================================================
   INBOX
   ============================================================ */
function renderInbox() {
  const open = state.openThread ?? state.threads[0]?.contactId;
  state.openThread = open;
  const t = state.threads.find((x) => x.contactId === open);
  if (t && t.unread) { t.unread = false; }

  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Inbox — <em>warm threads first.</em></h1>
    <p>Scout tracks every reply and flags the doors that are opening.</p></div>
    <div class="inbox">
      <div class="threadlist">
        ${state.threads.map((th) => { const c = contact(th.contactId); return `
          <div class="thread-item ${th.contactId === open ? "is-open" : ""}" data-id="${th.contactId}">
            <div class="thread-item__row">${th.unread ? '<span class="dot-unread"></span>' : ""}<strong>${c.name}</strong>
              ${th.warm ? '<span class="warmtag">🔥 WARM</span>' : ""}<time>${th.when}</time></div>
            <span class="subj">${th.subject}</span>
          </div>`; }).join("")}
        ${state.threads.length === 0 ? '<div class="empty">No threads yet — knock on a door first.</div>' : ""}
      </div>
      <div class="threadview">
        ${t ? `
          <div class="threadview__head"><h3>${t.subject}</h3>
            <small>${contact(t.contactId).name} · ${contact(t.contactId).role}, ${contact(t.contactId).company}</small></div>
          <div class="threadview__msgs" id="msgs">
            ${t.messages.map((m) => `<div class="msg msg--${m.from === "you" ? "you" : "them"}"><time>${m.time}</time>${m.text}</div>`).join("")}
          </div>
          <div class="threadview__reply">
            <input id="reply-input" type="text" placeholder="Reply — or let Scout draft it…" />
            <button class="btn btn--paper btn--sm" id="scout-draft">✦ Scout draft</button>
            <button class="btn btn--sm" id="send-reply">Send</button>
          </div>` : '<div class="empty">Select a thread.</div>'}
      </div>
    </div>
  </div>`;

  $$(".thread-item", view).forEach((el) =>
    el.addEventListener("click", () => { state.openThread = el.dataset.id; renderInbox(); updateChrome(); }));

  const msgs = $("#msgs", view);
  if (msgs) msgs.scrollTop = msgs.scrollHeight;

  $("#scout-draft", view)?.addEventListener("click", () => {
    const c = contact(t.contactId);
    $("#reply-input", view).value =
      t.warm
        ? `Booked a slot for Thursday — thank you, ${c.name.split(" ")[0]}! Sending the ${c.type === "case" ? "deck" : "case study"} ahead so we can skip straight to questions.`
        : `Just floating this back up, ${c.name.split(" ")[0]} — still very keen for 15 minutes whenever works.`;
    toast("✦ Drafted in your voice — edit freely");
  });
  $("#send-reply", view)?.addEventListener("click", () => {
    const input = $("#reply-input", view);
    if (!input.value.trim()) return;
    t.messages.push({ from: "you", time: "Just now", text: input.value.trim() });
    input.value = "";
    renderInbox();
    toast("Sent ✓ — Scout will watch for the reply");
  });
}

/* ============================================================
   TRACKER (kanban + drag & drop)
   ============================================================ */
function renderTracker() {
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Every door, <em>one board.</em></h1>
    <p>Drag cards as things move — Scout updates follow-ups to match.</p></div>
    <div class="board">
      ${STAGES.map((s) => { const items = state.outreach.filter((o) => o.stage === s.id); return `
        <div class="col" data-stage="${s.id}">
          <div class="col__head"><h4>${s.label}</h4><span class="count">${items.length}</span></div>
          <div class="col__hint">${s.hint}</div>
          ${items.map((o) => { const c = contact(o.contactId); return `
            <div class="kcard" draggable="true" data-id="${c.id}">
              <div class="kcard__top">${av(c, 24)}<strong>${c.name}</strong></div>
              <small>${c.company} · ${askEmoji[c.type]} ${askLabel[c.type]}</small>
              <small>${o.lastTouch}${o.opens ? ` · ${o.opens} opens` : ""}</small>
              ${o.note ? `<div class="note">${o.note}</div>` : ""}
            </div>`; }).join("")}
        </div>`; }).join("")}
    </div>
  </div>`;

  let dragId = null;
  $$(".kcard", view).forEach((k) => {
    k.addEventListener("dragstart", () => { dragId = k.dataset.id; k.classList.add("dragging"); });
    k.addEventListener("dragend", () => k.classList.remove("dragging"));
  });
  $$(".col", view).forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("dragover"); });
    col.addEventListener("dragleave", () => col.classList.remove("dragover"));
    col.addEventListener("drop", (e) => {
      e.preventDefault(); col.classList.remove("dragover");
      const o = state.outreach.find((x) => x.contactId === dragId);
      if (o && o.stage !== col.dataset.stage) {
        o.stage = col.dataset.stage; o.lastTouch = "just now";
        if (o.stage === "meeting") { state.stats.meetings++; toast("🎉 Meeting booked — Scout sent you a prep brief"); }
        renderTracker();
      }
    });
  });
}

/* ============================================================
   PROFILE
   ============================================================ */
function renderProfile() {
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>This is who Scout <em>sounds like.</em></h1>
    <p>Everything below was pulled from your resume + questionnaire. Edit anything — every future draft updates instantly.</p></div>
    <div class="profile-grid">
      <div>
        <div class="pcard idcard">
          <span class="avatar">${PROFILE.initials}</span>
          <h2>${PROFILE.name}</h2>
          <div class="sub">${PROFILE.school}<br>${PROFILE.degree} · Class of ${PROFILE.gradYear}</div>
          <div class="traits">${PROFILE.traits.map((t) => `<span class="trait">${t}</span>`).join("")}</div>
          <div class="voicebox">
            <b>Writing voice</b> — tone: <b>${PROFILE.voice.tone}</b> · length: <b>${PROFILE.voice.length}</b> · sign-off: <b>${PROFILE.voice.signoff}</b>
          </div>
        </div>
        <div class="pcard">
          <h3>Resume <button class="edit" id="re-upload">↻ Re-upload</button></h3>
          <div class="dropzone is-filled">📄 Aaron_Johnson_Resume.pdf · parsed ✓<br><small>17 facts extracted · last synced today</small></div>
        </div>
      </div>
      <div>
        <div class="pcard">
          <h3>Your story <button class="edit" data-edit="story">✎ Edit</button></h3>
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
    toast("Editing — click anywhere outside to save");
    el.addEventListener("blur", () => {
      el.contentEditable = false;
      PROFILE.story = el.textContent.replace(/[“”]/g, "");
      toast("Saved — Scout's drafts now use the new story ✓");
    }, { once: true });
  });
  $("#re-upload", view)?.addEventListener("click", () =>
    toast("📄 Drop a new PDF anytime — parsing takes ~20 seconds"));
}

/* ============================================================
   SETTINGS
   ============================================================ */
function renderSettings() {
  view.innerHTML = `<div class="viewwrap">
    <div class="vh"><h1>Settings</h1><p>How Scout behaves in other people's inboxes.</p></div>
    <div class="settings-grid">
      <div class="pcard">
        <h3>Agent autonomy</h3>
        <div class="setrow"><span class="ico">👀</span><div><strong>Review before sending</strong><small>Every draft waits for your approval</small></div>
          <label class="switch end"><input type="checkbox" data-k="review" ${state.autonomy.review ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">⏱</span><div><strong>Follow-up autopilot</strong><small>Up to 2 polite nudges, timed to their reading hours</small></div>
          <label class="switch end"><input type="checkbox" data-k="followups" ${state.autonomy.followups ? "checked" : ""}><i></i></label></div>
        <div class="setrow"><span class="ico">🌙</span><div><strong>Weekend sends</strong><small>Off — replies are 40% lower on weekends</small></div>
          <label class="switch end"><input type="checkbox" data-k="weekends" ${state.autonomy.weekends ? "checked" : ""}><i></i></label></div>
      </div>
      <div class="pcard">
        <h3>Integrations</h3>
        <div class="setrow"><span class="ico">✉️</span><div><strong>Gmail</strong><small>aaron@uci.edu · sends from your real address</small></div>
          <span class="connected end">Connected</span></div>
        <div class="setrow"><span class="ico">📅</span><div><strong>Google Calendar</strong><small>Auto-offers your free slots when they say yes</small></div>
          <span class="connected end">Connected</span></div>
        <div class="setrow"><span class="ico">🧭</span><div><strong>Sources</strong><small>YC directory · UCI alumni · live job reqs · PE/VC rosters</small></div>
          <button class="btn btn--paper btn--sm end">Manage</button></div>
      </div>
      <div class="pcard">
        <h3>Plan & billing</h3>
        <div class="setrow"><span class="ico">🎓</span><div><strong>Student — Free</strong><small>${state.knocks} of 15 knocks left this month</small></div>
          <button class="btn btn--sm end" id="set-upgrade">⚡ Go Pro</button></div>
        <div class="setrow"><span class="ico">🔔</span><div><strong>Daily digest</strong><small>One email: new matches + warm threads</small></div>
          <label class="switch end"><input type="checkbox" checked><i></i></label></div>
        <div class="setrow"><span class="ico">💬</span><div><strong>Feedback</strong><small>Tell us what to build next</small></div>
          <button class="btn btn--paper btn--sm end" id="set-feedback">Send</button></div>
      </div>
    </div>
  </div>`;

  $$('.switch input', view).forEach((sw) =>
    sw.addEventListener("change", () => {
      if (sw.dataset.k) state.autonomy[sw.dataset.k] = sw.checked;
      toast(sw.checked ? "On ✓" : "Off ✓");
    }));
  $("#set-upgrade", view)?.addEventListener("click", openUpgrade);
  $("#set-feedback", view)?.addEventListener("click", openFeedback);
}

/* ============================================================
   AGENT DRAWER — the wow moment
   ============================================================ */
const drawer = $("#drawer"), scrim = $("#drawer-scrim");

function closeDrawer() { drawer.hidden = true; scrim.hidden = true; }
$("#drawer-close").addEventListener("click", closeDrawer);
scrim.addEventListener("click", closeDrawer);

function openAgent(c) {
  if (state.knocks <= 0) return openUpgrade();
  drawer.hidden = false; scrim.hidden = false;

  $("#drawer-who").innerHTML = `${av(c, 38)}<div><strong>${c.name}</strong><small>${c.role} · ${c.company} · ${askEmoji[c.type]} ${askLabel[c.type]}</small></div>`;

  const steps = agentScript(c);
  const body = $("#drawer-body");
  body.innerHTML = `
    <div class="agent-steps">
      ${steps.map((s, i) => `
        <div class="astep" data-i="${i}">
          <span class="ico">${s.icon}</span>
          <div><strong>${s.label}</strong><small>${s.detail}</small></div>
        </div>`).join("")}
    </div>
    <div id="draft-slot"></div>`;

  let i = 0;
  (function step() {
    const els = $$(".astep", body);
    if (i > 0) { els[i - 1].classList.remove("is-live"); els[i - 1].classList.add("is-done"); els[i - 1].querySelector(".ico").textContent = "✓"; }
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
        <li><b>Day 7</b> Final, shorter note — different angle: ${c.why[2] || c.why[0]}</li>
        <li><b>Then</b> Stop. Never pesters. Flags the next-best door instead.</li>
      </ul>
    </div>
    <div class="drawer__actions">
      <button class="btn btn--ghost" id="d-edit">✎ Edit</button>
      <button class="btn btn--ghost" id="d-regen">↻ Regenerate</button>
      <button class="btn btn--accent" id="d-send" disabled>Approve & send</button>
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
    toast("Every word is yours — edit away");
  });
  $("#d-regen").addEventListener("click", () => { toast("↻ Rewriting with a different hook…"); openAgent(c); });
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
      <div class="big">📨</div>
      <h3>Knock delivered.</h3>
      <p>Scout is watching ${c.name.split(" ")[0]}'s inbox — you'll hear the moment it opens.</p>
    </div>
    <div class="drawer__actions">
      <a class="btn btn--ghost" href="#tracker" id="d-track">View in tracker</a>
      <a class="btn" href="#people" id="d-next">Next door →</a>
    </div>`;
  $("#d-track").addEventListener("click", closeDrawer);
  $("#d-next").addEventListener("click", closeDrawer);
  toast(`📨 Sent to <b>${c.name}</b> — ${state.knocks} knocks left`);

  /* simulated life: open → reply → warm thread */
  setTimeout(() => {
    const o = state.outreach.find((x) => x.contactId === c.id);
    if (o && o.stage === "sent") { o.stage = "opened"; o.opens = 1; o.lastTouch = "just now"; }
    toast(`👀 <b>${c.name.split(" ")[0]}</b> opened your email`);
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
    toast(`🔥 <b>${c.name}</b> replied — warm thread in your inbox`, 5000);
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
   MODALS — onboarding · feedback · upgrade
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
  $("#m-send").addEventListener("click", () => { closeModal(); toast("💌 Got it — thank you. We read every one."); });
}
$("#feedback-btn").addEventListener("click", openFeedback);

function openUpgrade() {
  openModal(`
    <h2>Out of knocks? <em style="font-style:italic;color:var(--accent)">Never.</em></h2>
    <p class="sub">Pro removes the cap and turns on follow-up autopilot + inbox warm-up.</p>
    <div class="pcard" style="display:flex;align-items:center;gap:1rem">
      <div style="font:460 2.4rem var(--serif)">$19<span style="font-size:1rem;color:var(--ink-soft)">/mo</span></div>
      <div style="font-size:.82rem;color:var(--ink-soft)">Unlimited knocks · autopilot follow-ups<br>priority people data · warm-threads inbox</div>
    </div>
    <div class="modal__actions">
      <button class="btn btn--ghost" id="m-cancel">Not yet</button>
      <button class="btn btn--accent" id="m-go">Go Pro →</button>
    </div>`);
  $("#m-cancel").addEventListener("click", closeModal);
  $("#m-go").addEventListener("click", () => { closeModal(); toast("⚡ This is the MVP — payments land next sprint"); });
}
$("#upgrade-btn").addEventListener("click", openUpgrade);

/* ---- onboarding: resume + who-you-are questionnaire ---- */
function openOnboarding(step = 1) {
  const bars = (n) => `<div class="obsteps">${[1, 2, 3].map((i) => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`;
  if (step === 1) {
    openModal(`${bars(1)}
      <h2>First — who are you?</h2>
      <p class="sub">Drop a resume, or just talk. Scout reads everything once and never asks again.</p>
      <div class="dropzone" id="ob-drop">📄 Drop your resume here<br><small>PDF, DOCX — or skip it</small></div>
      <label>Or describe yourself in a sentence or two</label>
      <textarea rows="3" placeholder="e.g. Built a $400K e-commerce business in high school. Strategy student. I outwork everyone.">${PROFILE.story}</textarea>
      <div class="modal__actions"><button class="btn" id="ob-next">Continue →</button></div>`);
    $("#ob-drop").addEventListener("click", function () { this.classList.add("is-filled"); this.innerHTML = "📄 Aaron_Johnson_Resume.pdf ✓<br><small>parsing… 17 facts extracted</small>"; });
    $("#ob-next").addEventListener("click", () => openOnboarding(2));
  } else if (step === 2) {
    openModal(`${bars(2)}
      <h2>What are you <em style="color:var(--accent);font-style:italic">actually</em> like?</h2>
      <p class="sub">Pick what's true. This is how Scout sounds like you — not like AI.</p>
      <div class="chips-select">
        ${["Allergic to average", "Will do whatever it takes", "Ships fast", "First-gen hustle", "Quietly relentless", "Big swing energy", "Detail obsessed", "Cold-email native"].map((t, i) => `<button class="pill ${i < 3 ? "is-on" : ""}">${t}</button>`).join("")}
      </div>
      <label>What do you want doors opened to?</label>
      <div class="chips-select">
        ${["💼 Jobs & internships", "☕ Coffee chats", "🏆 Case comp sponsors", "🚀 Anything — surprise me"].map((t, i) => `<button class="pill ${i === 0 ? "is-on" : ""}">${t}</button>`).join("")}
      </div>
      <div class="modal__actions"><button class="btn" id="ob-next">Continue →</button></div>`);
    $$(".pill", modal).forEach((p) => p.addEventListener("click", () => p.classList.toggle("is-on")));
    $("#ob-next").addEventListener("click", () => openOnboarding(3));
  } else {
    openModal(`${bars(3)}
      <h2>Scout is calibrated.</h2>
      <p class="sub">12 doors found overnight: 3 YC founders, 2 alumni, 4 live hiring managers, 2 PE/VC contacts, 1 case-comp sponsor. Ranked by who will actually reply to <b>you</b>.</p>
      <div class="pcard" style="font-size:.84rem;color:var(--ink-soft)">
        ✦ Tone locked: <b style="color:var(--ink)">direct & warm, under 120 words</b><br>
        ✦ Hook strategy: <b style="color:var(--ink)">lead with the $400K founder story</b><br>
        ✦ Send window: <b style="color:var(--ink)">their reading hours, never weekends</b>
      </div>
      <div class="modal__actions"><button class="btn btn--accent" id="ob-done">Show me my doors →</button></div>`);
    $("#ob-done").addEventListener("click", () => {
      localStorage.setItem("knock_onboarded", "1");
      closeModal();
      toast("✦ Welcome to Knock — your first 5 doors are ready");
    });
  }
}

/* ---------------- global search ---------------- */
$("#global-search").addEventListener("input", (e) => {
  state.filters.q = e.target.value.toLowerCase();
  if (location.hash !== "#people") location.hash = "people";
  else renderPeople();
});

/* ---------------- boot ---------------- */
navigate();
if (!localStorage.getItem("knock_onboarded")) openOnboarding(1);
