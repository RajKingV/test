/* ============================================================
   Mala — Japa Tracker
   All data lives in localStorage under STORAGE_KEY.
   No network calls, no accounts — everything is local-only.
   ============================================================ */

const STORAGE_KEY = "malaJapaData_v1";
const BEADS_PER_MALA = 108;

/* ---------------- Data model + defaults ---------------- */
function defaultData() {
  const id1 = uid();
  return {
    mantras: [
      { id: id1, name: "Om Namah Shivaya", sanskrit: "ॐ नमः शिवाय", createdAt: todayStr() }
    ],
    activeMantraId: id1,
    logs: {}, // logs[mantraId][dateStr] = { app: number, manual: [{id,count,note,time}] }
    sankalps: [], // {id, name, target, mantraId:'all'|id, createdAt}
    settings: {
      dailyTargetMala: 5,
      soundOn: true,
      vibrationOn: true,
      animOn: true,
      hideTotals: false,
      pin: null,
      reminders: []
    }
  };
}

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function todayStr(d) { d = d || new Date(); return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
function pad(n) { return n < 10 ? "0"+n : ""+n; }

let DATA = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    // shallow-merge in case of missing new fields from older versions
    const def = defaultData();
    parsed.settings = Object.assign({}, def.settings, parsed.settings || {});
    parsed.sankalps = parsed.sankalps || [];
    parsed.logs = parsed.logs || {};
    return parsed;
  } catch (e) {
    console.error("Failed to load data, starting fresh.", e);
    return defaultData();
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(DATA)); }
  catch (e) { toast("Storage error — could not save."); console.error(e); }
}

/* ---------------- Log helpers ---------------- */
function ensureLog(mantraId, date) {
  DATA.logs[mantraId] = DATA.logs[mantraId] || {};
  DATA.logs[mantraId][date] = DATA.logs[mantraId][date] || { app: 0, manual: [] };
  return DATA.logs[mantraId][date];
}
function dayTotal(entry) {
  if (!entry) return 0;
  const manual = (entry.manual || []).reduce((s, m) => s + m.count, 0);
  return (entry.app || 0) + manual;
}
function dayMala(entry) { return dayTotal(entry) / BEADS_PER_MALA; }

function allMantraIds() { return DATA.mantras.map(m => m.id); }

function combinedDayTotal(date) {
  let sum = 0;
  allMantraIds().forEach(id => { sum += dayTotal((DATA.logs[id] || {})[date]); });
  return sum;
}
function combinedDayMala(date) { return combinedDayTotal(date) / BEADS_PER_MALA; }

function mantraLifetimeTotal(mantraId) {
  const logs = DATA.logs[mantraId] || {};
  return Object.values(logs).reduce((s, e) => s + dayTotal(e), 0);
}
function combinedLifetimeTotal() {
  return allMantraIds().reduce((s, id) => s + mantraLifetimeTotal(id), 0);
}
function monthTotal(mantraId, year, month) { // month 0-indexed; mantraId null = combined
  const ids = mantraId ? [mantraId] : allMantraIds();
  let sum = 0;
  ids.forEach(id => {
    const logs = DATA.logs[id] || {};
    Object.keys(logs).forEach(date => {
      const d = new Date(date + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) sum += dayTotal(logs[date]);
    });
  });
  return sum;
}

/* current day-total helper across a mantra filter ('all' or id) */
function totalForFilter(filter, date) {
  if (filter === "all") return combinedDayTotal(date);
  return dayTotal((DATA.logs[filter] || {})[date]);
}

/* ---------------- Streak calculation (combined, vs global daily target) ---------------- */
function computeStreaks() {
  const target = DATA.settings.dailyTargetMala * BEADS_PER_MALA;
  // gather all dates with any activity across all mantras
  const dateSet = new Set();
  allMantraIds().forEach(id => Object.keys(DATA.logs[id] || {}).forEach(d => dateSet.add(d)));
  const achievedDates = new Set();
  dateSet.forEach(d => { if (combinedDayTotal(d) >= target && target > 0) achievedDates.add(d); });

  // current streak: walk back from today
  let current = 0;
  let cursor = new Date();
  while (true) {
    const ds = todayStr(cursor);
    if (achievedDates.has(ds)) { current++; cursor.setDate(cursor.getDate() - 1); }
    else if (ds === todayStr()) { cursor.setDate(cursor.getDate() - 1); continue; } // today not yet achieved doesn't break streak
    else break;
  }
  // longest streak
  const sortedDates = Array.from(dateSet).sort();
  let longest = 0, run = 0, prevDate = null;
  sortedDates.forEach(ds => {
    if (achievedDates.has(ds)) {
      if (prevDate) {
        const diff = (new Date(ds) - new Date(prevDate)) / 86400000;
        run = diff === 1 ? run + 1 : 1;
      } else run = 1;
      longest = Math.max(longest, run);
      prevDate = ds;
    } else {
      prevDate = null; run = 0;
    }
  });
  return { current, longest, achievedDates, dateSet };
}

/* ================= UI STATE ================= */
let currentTab = "japa";
let calMonthCursor = new Date();
let statsFilter = "all";
let calFilter = "all";

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", init);

function init() {
  document.getElementById("dateSubtitle").textContent = new Date().toLocaleDateString(undefined, { weekday:"long", day:"numeric", month:"long" });
  setupNav();
  setupJapaTab();
  setupCalendarTab();
  setupMantrasTab();
  setupStatsTab();
  setupSettingsTab();
  setupLockScreen();
  renderAll();
  registerSW();
  checkLock();
  scheduleReminderCheck();
}

function renderAll() {
  renderMantraChips();
  renderDashboardStats();
  renderBeadRing();
  renderMantraList();
  renderCalendar();
  renderStats();
  renderSettings();
  renderHeaderStreak();
}

/* ================= NAV ================= */
function setupNav() {
  document.querySelectorAll("#bottomNav button").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll("section.screen").forEach(s => s.classList.remove("active"));
  document.getElementById("tab-" + tab).classList.add("active");
  document.querySelectorAll("#bottomNav button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  if (tab === "calendar") renderCalendar();
  if (tab === "stats") renderStats();
}

/* ================= TOAST ================= */
let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

/* ================= JAPA TAB ================= */
function setupJapaTab() {
  document.getElementById("tapBtn").addEventListener("click", onTap);
  document.getElementById("undoBtn").addEventListener("click", onUndo);
  document.getElementById("manualAddBtn").addEventListener("click", () => openManualEntryModal(DATA.activeMantraId, todayStr()));
  document.getElementById("resetTodayBtn").addEventListener("click", onResetToday);
}

function activeMantra() { return DATA.mantras.find(m => m.id === DATA.activeMantraId) || DATA.mantras[0]; }

function renderMantraChips() {
  const row = document.getElementById("mantraChipRow");
  row.innerHTML = "";
  DATA.mantras.forEach(m => {
    const chip = document.createElement("div");
    chip.className = "mantra-chip" + (m.id === DATA.activeMantraId ? " active" : "");
    chip.textContent = m.sanskrit || m.name;
    chip.addEventListener("click", () => { DATA.activeMantraId = m.id; save(); renderAll(); });
    row.appendChild(chip);
  });
}

function renderDashboardStats() {
  const target = DATA.settings.dailyTargetMala;
  const today = todayStr();
  const now = new Date();
  const todayCombined = combinedDayTotal(today);
  const monthCombined = monthTotal(null, now.getFullYear(), now.getMonth());
  const lifetime = combinedLifetimeTotal();
  const streaks = computeStreaks();

  // best day (combined)
  const dateSet = new Set();
  allMantraIds().forEach(id => Object.keys(DATA.logs[id]||{}).forEach(d=>dateSet.add(d)));
  let bestMala = 0;
  dateSet.forEach(d => { bestMala = Math.max(bestMala, combinedDayMala(d)); });

  setText("statToday", fmtMala(todayCombined / BEADS_PER_MALA));
  setText("statMonth", fmtMala(monthCombined / BEADS_PER_MALA));
  setText("statLifetime", fmtMala(lifetime / BEADS_PER_MALA));
  setText("statBest", fmtMala(bestMala));

  document.getElementById("statGrid").classList.toggle("blurred", DATA.settings.hideTotals);

  const progressPct = target > 0 ? Math.min(100, (todayCombined / BEADS_PER_MALA / target) * 100) : 0;
  document.getElementById("progressFill").style.width = progressPct + "%";
  document.getElementById("progressLabel").textContent = fmtMala(todayCombined / BEADS_PER_MALA) + " / " + target + " mala";
}

function renderHeaderStreak() {
  const s = computeStreaks();
  document.getElementById("headerStreak").textContent = s.current;
}

function fmtMala(n) {
  const r = Math.round(n * 10) / 10;
  return (r % 1 === 0) ? r.toFixed(0) : r.toFixed(1);
}

/* ---- Bead ring ---- */
const BEAD_POS = [];
(function precomputeBeadPositions() {
  const cx = 140, cy = 140, r = 118;
  for (let i = 0; i < BEADS_PER_MALA; i++) {
    const ang = (2 * Math.PI * i / BEADS_PER_MALA) - Math.PI / 2;
    BEAD_POS.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
  }
})();

function renderBeadRing() {
  const svg = document.getElementById("beadSvg");
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";
  const entry = ensureLog(DATA.activeMantraId, todayStr());
  const count = entry.app || 0;
  const posInMala = count % BEADS_PER_MALA === 0 && count > 0 ? BEADS_PER_MALA : count % BEADS_PER_MALA;

  BEAD_POS.forEach((p, i) => {
    const c = document.createElementNS(ns, "circle");
    c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); c.setAttribute("r", 5.4);
    c.setAttribute("class", "bead " + (i < posInMala ? "on" : "off"));
    svg.appendChild(c);
  });
  // guru bead at top
  const guru = document.createElementNS(ns, "circle");
  guru.setAttribute("cx", 140); guru.setAttribute("cy", 22); guru.setAttribute("r", 8.5);
  guru.setAttribute("class", "guru-bead");
  guru.setAttribute("fill", posInMala === BEADS_PER_MALA ? "var(--rose)" : "rgba(198,93,123,0.35)");
  svg.appendChild(guru);

  setText("countDisplay", count);
  setText("malaTotalToday", fmtMala((entry.app||0) / BEADS_PER_MALA + (entry.manual||[]).reduce((s,m)=>s+m.count,0)/BEADS_PER_MALA));
}

function onTap() {
  const date = todayStr();
  const entry = ensureLog(DATA.activeMantraId, date);
  entry.app = (entry.app || 0) + 1;
  const completedMala = entry.app % BEADS_PER_MALA === 0;
  save();
  renderBeadRing();
  renderDashboardStats();
  renderHeaderStreak();

  const btn = document.getElementById("tapBtn");
  if (DATA.settings.animOn) { btn.classList.remove("pulse"); void btn.offsetWidth; btn.classList.add("pulse"); }

  if (completedMala) {
    showMalaBadge();
    if (DATA.settings.vibrationOn && navigator.vibrate) navigator.vibrate([40, 60, 40]);
    if (DATA.settings.soundOn) playChime();
    toast("🕉 1 Mala Completed — " + (entry.app / BEADS_PER_MALA) + " today");
  }
}

function showMalaBadge() {
  const badge = document.getElementById("malaBadge");
  badge.style.display = "inline-block";
  clearTimeout(showMalaBadge._t);
  showMalaBadge._t = setTimeout(() => { badge.style.display = "none"; }, 1800);
}

function onUndo() {
  const entry = ensureLog(DATA.activeMantraId, todayStr());
  if (entry.app > 0) { entry.app--; save(); renderBeadRing(); renderDashboardStats(); renderHeaderStreak(); }
}

function onResetToday() {
  confirmDialog("Reset today's count?", "This clears the app counter (" + (ensureLog(DATA.activeMantraId, todayStr()).app||0) + ") for " + activeMantra().name + " today. Manual entries are kept.", () => {
    ensureLog(DATA.activeMantraId, todayStr()).app = 0;
    save(); renderBeadRing(); renderDashboardStats(); renderHeaderStreak();
    toast("Today's count reset.");
  });
}

/* WebAudio chime — no external file needed */
let audioCtx;
function playChime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = freq;
      o.connect(g); g.connect(audioCtx.destination);
      const start = audioCtx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(0.15, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      o.start(start); o.stop(start + 0.55);
    });
  } catch (e) { /* audio unsupported — ignore */ }
}

/* ================= MANUAL ENTRY MODAL ================= */
function openManualEntryModal(mantraId, date) {
  const m = DATA.mantras.find(x => x.id === mantraId) || activeMantra();
  const root = document.getElementById("modalRoot");
  root.innerHTML = modalShell(`
    <h3>Add Manual Count</h3>
    <label class="field-label">Mantra</label>
    <select id="me_mantra">${DATA.mantras.map(x=>`<option value="${x.id}" ${x.id===mantraId?"selected":""}>${escapeHtml(x.sanskrit||x.name)}</option>`).join("")}</select>
    <label class="field-label">Date</label>
    <input type="date" id="me_date" value="${date}" max="${todayStr()}">
    <label class="field-label">Count</label>
    <input type="number" id="me_count" min="1" placeholder="e.g. 2500">
    <label class="field-label">Note (optional)</label>
    <input type="text" id="me_note" placeholder="e.g. Morning Japa">
    <button class="btn-primary" id="me_save">Save Entry</button>
    <button class="btn-secondary" id="me_cancel">Cancel</button>
  `);
  openModal(root);
  document.getElementById("me_cancel").addEventListener("click", closeModal);
  document.getElementById("me_save").addEventListener("click", () => {
    const mid = document.getElementById("me_mantra").value;
    const d = document.getElementById("me_date").value || todayStr();
    const count = parseInt(document.getElementById("me_count").value, 10);
    const note = document.getElementById("me_note").value.trim();
    if (!count || count <= 0) { toast("Enter a valid count."); return; }
    const entry = ensureLog(mid, d);
    entry.manual.push({ id: uid(), count, note, time: new Date().toISOString() });
    save();
    closeModal();
    toast("Manual entry added: " + count + " japa on " + d);
    renderAll();
  });
}

/* ================= CALENDAR TAB ================= */
function setupCalendarTab() {
  document.getElementById("calPrev").addEventListener("click", () => { calMonthCursor.setMonth(calMonthCursor.getMonth()-1); renderCalendar(); });
  document.getElementById("calNext").addEventListener("click", () => { calMonthCursor.setMonth(calMonthCursor.getMonth()+1); renderCalendar(); });
  const sel = document.getElementById("calMantraFilter");
  sel.addEventListener("change", () => { calFilter = sel.value; renderCalendar(); });
}

function populateMantraSelect(sel, includeAll, selected) {
  sel.innerHTML = "";
  if (includeAll) {
    const o = document.createElement("option"); o.value = "all"; o.textContent = "All Mantras (combined)";
    sel.appendChild(o);
  }
  DATA.mantras.forEach(m => {
    const o = document.createElement("option"); o.value = m.id; o.textContent = m.name;
    sel.appendChild(o);
  });
  sel.value = selected || (includeAll ? "all" : DATA.mantras[0].id);
}

function renderCalendar() {
  const sel = document.getElementById("calMantraFilter");
  populateMantraSelect(sel, true, calFilter);
  calFilter = sel.value;

  const y = calMonthCursor.getFullYear(), m = calMonthCursor.getMonth();
  document.getElementById("calMonthLabel").textContent = calMonthCursor.toLocaleDateString(undefined,{month:"long", year:"numeric"});

  const grid = document.getElementById("calGrid");
  grid.innerHTML = "";
  ["S","M","T","W","T","F","S"].forEach(d => {
    const el = document.createElement("div"); el.className = "cal-dow"; el.textContent = d; grid.appendChild(el);
  });

  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const target = DATA.settings.dailyTargetMala;
  const today = todayStr();

  for (let i=0;i<firstDay;i++){ const e=document.createElement("div"); e.className="cal-day empty"; grid.appendChild(e); }

  for (let day=1; day<=daysInMonth; day++) {
    const ds = y + "-" + pad(m+1) + "-" + pad(day);
    const total = totalForFilter(calFilter, ds);
    const mala = total / BEADS_PER_MALA;
    const cell = document.createElement("div");
    let statusClass = "none";
    if (total > 0) statusClass = (target > 0 && mala >= target) ? "achieved" : "partial";
    cell.className = "cal-day " + statusClass + (ds === today ? " today" : "");
    cell.innerHTML = `<div class="d">${day}</div><div class="m">${total>0? fmtMala(mala):""}</div>`;
    cell.addEventListener("click", () => openDayModal(ds));
    grid.appendChild(cell);
  }
}

function openDayModal(dateStr) {
  const root = document.getElementById("modalRoot");
  const rows = DATA.mantras.map(m => {
    const entry = (DATA.logs[m.id] || {})[dateStr];
    const app = entry ? (entry.app||0) : 0;
    const manual = entry ? (entry.manual||[]) : [];
    const manualSum = manual.reduce((s,x)=>s+x.count,0);
    const total = app + manualSum;
    if (total === 0 && manual.length === 0) return "";
    let manualHtml = manual.map(x => `<div class="manual-entry-row"><span>${x.count} <span class="note">${escapeHtml(x.note||"")}</span></span><button class="icon-btn" onclick="deleteManualEntry('${m.id}','${dateStr}','${x.id}')">✕</button></div>`).join("");
    return `<div class="card" style="margin-bottom:10px;">
      <div style="font-family:var(--serif); font-size:15px; margin-bottom:6px;">${escapeHtml(m.sanskrit||m.name)}</div>
      <div style="font-size:12.5px; color:var(--muted);">App counter: ${app} &nbsp;·&nbsp; Manual: ${manualSum} &nbsp;·&nbsp; Total: <b style="color:var(--saffron);">${total}</b> (${fmtMala(total/BEADS_PER_MALA)} mala)</div>
      ${manualHtml}
    </div>`;
  }).join("");

  const combined = combinedDayTotal(dateStr);
  root.innerHTML = modalShell(`
    <h3>${new Date(dateStr+"T00:00:00").toLocaleDateString(undefined,{weekday:"long", day:"numeric", month:"long", year:"numeric"})}</h3>
    <div style="font-size:13px; color:var(--muted); margin-bottom:14px;">Combined total: <b style="color:var(--cream);">${combined}</b> counts · ${fmtMala(combined/BEADS_PER_MALA)} mala</div>
    ${rows || '<div class="empty-hint">No japa recorded this day.</div>'}
    <button class="btn-primary" id="dayAddManual">+ Add Manual Entry for this Date</button>
    <button class="btn-secondary" id="dayClose">Close</button>
  `);
  openModal(root);
  document.getElementById("dayClose").addEventListener("click", closeModal);
  document.getElementById("dayAddManual").addEventListener("click", () => openManualEntryModal(DATA.activeMantraId, dateStr));
}

function deleteManualEntry(mantraId, dateStr, entryId) {
  const entry = (DATA.logs[mantraId]||{})[dateStr];
  if (!entry) return;
  entry.manual = entry.manual.filter(x => x.id !== entryId);
  save();
  renderAll();
  openDayModal(dateStr);
}
window.deleteManualEntry = deleteManualEntry;

/* ================= MANTRAS TAB ================= */
function setupMantrasTab() {
  document.getElementById("addMantraBtn").addEventListener("click", openAddMantraModal);
}

function renderMantraList() {
  const box = document.getElementById("mantraList");
  box.innerHTML = "";
  if (DATA.mantras.length === 0) { box.innerHTML = '<div class="empty-hint">No mantras yet.</div>'; return; }
  DATA.mantras.forEach(m => {
    const lifetime = mantraLifetimeTotal(m.id);
    const row = document.createElement("div");
    row.className = "mantra-list-item";
    row.innerHTML = `
      <div class="mantra-info">
        <div class="name">${escapeHtml(m.sanskrit||m.name)}</div>
        <div class="sub">${escapeHtml(m.name)} · Lifetime <b>${fmtMala(lifetime/BEADS_PER_MALA)} mala</b> (${lifetime})</div>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${m.id===DATA.activeMantraId ? '<span class="badge-active">Active</span>' : `<button class="pill-btn" data-set="${m.id}">Use</button>`}
        <button class="icon-btn" data-del="${m.id}">🗑</button>
      </div>`;
    box.appendChild(row);
  });
  box.querySelectorAll("[data-set]").forEach(b => b.addEventListener("click", () => { DATA.activeMantraId = b.dataset.set; save(); renderAll(); toast("Switched active mantra."); }));
  box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    if (DATA.mantras.length <= 1) { toast("Keep at least one mantra."); return; }
    const m = DATA.mantras.find(x=>x.id===b.dataset.del);
    confirmDialog("Delete mantra?", `This permanently deletes "${m.name}" and all of its japa history.`, () => {
      DATA.mantras = DATA.mantras.filter(x=>x.id!==b.dataset.del);
      delete DATA.logs[b.dataset.del];
      if (DATA.activeMantraId === b.dataset.del) DATA.activeMantraId = DATA.mantras[0].id;
      save(); renderAll(); toast("Mantra deleted.");
    });
  }));
}

function openAddMantraModal() {
  const root = document.getElementById("modalRoot");
  root.innerHTML = modalShell(`
    <h3>Add Mantra</h3>
    <label class="field-label">Name (English)</label>
    <input type="text" id="am_name" placeholder="e.g. Gayatri Mantra">
    <label class="field-label">Sanskrit / Devanagari (optional)</label>
    <input type="text" id="am_sanskrit" placeholder="e.g. ॐ भूर्भुवः स्वः...">
    <button class="btn-primary" id="am_save">Add Mantra</button>
    <button class="btn-secondary" id="am_cancel">Cancel</button>
  `);
  openModal(root);
  document.getElementById("am_cancel").addEventListener("click", closeModal);
  document.getElementById("am_save").addEventListener("click", () => {
    const name = document.getElementById("am_name").value.trim();
    const sanskrit = document.getElementById("am_sanskrit").value.trim();
    if (!name) { toast("Enter a name for the mantra."); return; }
    const id = uid();
    DATA.mantras.push({ id, name, sanskrit, createdAt: todayStr() });
    DATA.activeMantraId = id;
    save(); closeModal(); renderAll();
    toast("Mantra added: " + name);
  });
}

/* ================= STATS TAB ================= */
let chartInstance = null;
function setupStatsTab() {
  const sel = document.getElementById("statsMantraFilter");
  sel.addEventListener("change", () => { statsFilter = sel.value; renderStats(); });
}

function renderStats() {
  const sel = document.getElementById("statsMantraFilter");
  populateMantraSelect(sel, true, statsFilter);
  statsFilter = sel.value;

  const ids = statsFilter === "all" ? allMantraIds() : [statsFilter];
  const dateSet = new Set();
  ids.forEach(id => Object.keys(DATA.logs[id]||{}).forEach(d=>dateSet.add(d)));
  const dates = Array.from(dateSet).sort();

  let totalCounts = 0;
  const perDay = {};
  dates.forEach(d => {
    let sum = 0;
    ids.forEach(id => sum += dayTotal((DATA.logs[id]||{})[d]));
    perDay[d] = sum;
    totalCounts += sum;
  });

  const totalMala = totalCounts / BEADS_PER_MALA;
  const activeDays = dates.filter(d => perDay[d] > 0).length;
  const firstDate = dates.length ? dates[0] : null;
  const daysSinceFirst = firstDate ? Math.max(1, Math.round((new Date(todayStr())-new Date(firstDate))/86400000)+1) : 1;
  const avgPerDay = totalMala / daysSinceFirst;

  // months span
  const monthsSet = new Set(dates.map(d => d.slice(0,7)));
  const avgPerMonth = monthsSet.size ? totalMala / monthsSet.size : 0;

  let highestDayVal = 0, highestDayDate = "-";
  dates.forEach(d => { if (perDay[d] > highestDayVal) { highestDayVal = perDay[d]; highestDayDate = d; } });

  const monthTotals = {};
  dates.forEach(d => { const key = d.slice(0,7); monthTotals[key] = (monthTotals[key]||0) + perDay[d]; });
  let highestMonthVal = 0, highestMonthKey = "-";
  Object.keys(monthTotals).forEach(k => { if (monthTotals[k] > highestMonthVal) { highestMonthVal = monthTotals[k]; highestMonthKey = k; } });

  const target = DATA.settings.dailyTargetMala;
  const achievedDays = dates.filter(d => (perDay[d]/BEADS_PER_MALA) >= target && target>0).length;
  const achievementPct = activeDays ? Math.round((achievedDays/activeDays)*100) : 0;

  const streaks = computeStreaks();

  const kpis = [
    ["Total Japa", totalCounts.toLocaleString()],
    ["Total Mala", fmtMala(totalMala)],
    ["Avg / Day", fmtMala(avgPerDay)],
    ["Avg / Month", fmtMala(avgPerMonth)],
    ["Highest Day", fmtMala(highestDayVal/BEADS_PER_MALA) + " mala"],
    ["Highest Month", fmtMala(highestMonthVal/BEADS_PER_MALA) + " mala"],
    ["Current Streak", streaks.current + " days"],
    ["Longest Streak", streaks.longest + " days"],
    ["Target Achievement", achievementPct + "%"],
    ["Active Days", activeDays],
    ["First Japa", firstDate || "—"],
    ["Days Tracked", daysSinceFirst]
  ];
  const grid = document.getElementById("kpiGrid");
  grid.innerHTML = kpis.map(([lbl,val]) => `<div class="kpi"><div class="num">${val}</div><div class="lbl">${lbl}</div></div>`).join("");

  renderChart(ids);
}

function renderChart(ids) {
  const labels = [];
  const values = [];
  for (let i=29;i>=0;i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = todayStr(d);
    labels.push(d.getDate() + "/" + (d.getMonth()+1));
    let sum = 0;
    ids.forEach(id => sum += dayTotal((DATA.logs[id]||{})[ds]));
    values.push(Math.round((sum/BEADS_PER_MALA)*10)/10);
  }
  const ctx = document.getElementById("chartCanvas").getContext("2d");
  if (chartInstance) chartInstance.destroy();
  if (typeof Chart === "undefined") return; // offline / CDN unavailable — chart skipped gracefully
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: "#e8a33d", borderRadius: 4, maxBarThickness: 10 }] },
    options: {
      responsive: true,
      plugins: { legend: { display:false } },
      scales: {
        x: { ticks: { color: "#a6949c", maxRotation:0, autoSkip:true, maxTicksLimit:8 }, grid:{ display:false } },
        y: { ticks: { color: "#a6949c" }, grid:{ color:"rgba(243,233,218,0.08)" }, beginAtZero:true }
      }
    }
  });
}

/* ================= SETTINGS TAB ================= */
function setupSettingsTab() {
  document.getElementById("dailyTargetInput").addEventListener("change", (e) => {
    const v = Math.max(1, parseInt(e.target.value,10)||1);
    DATA.settings.dailyTargetMala = v; save(); renderAll();
  });
  document.getElementById("soundToggle").addEventListener("change", (e) => { DATA.settings.soundOn = e.target.checked; save(); });
  document.getElementById("vibrationToggle").addEventListener("change", (e) => { DATA.settings.vibrationOn = e.target.checked; save(); });
  document.getElementById("animToggle").addEventListener("change", (e) => { DATA.settings.animOn = e.target.checked; save(); });
  document.getElementById("hideToggle").addEventListener("change", (e) => { DATA.settings.hideTotals = e.target.checked; save(); renderDashboardStats(); });

  document.getElementById("pinToggle").addEventListener("change", (e) => {
    if (e.target.checked) { openSetPinModal(); }
    else { DATA.settings.pin = null; save(); toast("PIN lock disabled."); }
  });

  document.getElementById("addSankalpBtn").addEventListener("click", openAddSankalpModal);
  document.getElementById("addReminderBtn").addEventListener("click", openAddReminderModal);

  document.getElementById("backupBtn").addEventListener("click", downloadBackup);
  document.getElementById("restoreBtn").addEventListener("click", () => document.getElementById("restoreFile").click());
  document.getElementById("restoreFile").addEventListener("change", restoreBackup);
  document.getElementById("csvBtn").addEventListener("click", exportCsv);
  document.getElementById("eraseBtn").addEventListener("click", () => {
    confirmDialog("Erase all data?", "This permanently deletes every mantra, log and setting on this device. This cannot be undone.", () => {
      localStorage.removeItem(STORAGE_KEY);
      DATA = defaultData(); save(); renderAll();
      toast("All data erased.");
    });
  });
}

function renderSettings() {
  document.getElementById("dailyTargetInput").value = DATA.settings.dailyTargetMala;
  document.getElementById("soundToggle").checked = DATA.settings.soundOn;
  document.getElementById("vibrationToggle").checked = DATA.settings.vibrationOn;
  document.getElementById("animToggle").checked = DATA.settings.animOn;
  document.getElementById("hideToggle").checked = DATA.settings.hideTotals;
  document.getElementById("pinToggle").checked = !!DATA.settings.pin;
  renderSankalps();
  renderReminders();
}

/* ---- Sankalp ---- */
function renderSankalps() {
  const box = document.getElementById("sankalpCard");
  if (DATA.sankalps.length === 0) { box.innerHTML = '<div class="empty-hint">No sankalp set. Add a long-term goal to track progress toward it.</div>'; return; }
  box.innerHTML = DATA.sankalps.map(s => {
    const ids = s.mantraId === "all" ? allMantraIds() : [s.mantraId];
    const completed = ids.reduce((sum,id)=>sum+mantraLifetimeTotal(id),0);
    const pct = Math.min(100, Math.round((completed/s.target)*100));
    const remaining = Math.max(0, s.target - completed);
    return `<div class="sankalp-item">
      <div class="head"><span class="nm">${escapeHtml(s.name)}</span><button class="icon-btn" onclick="deleteSankalp('${s.id}')">✕</button></div>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%;"></div></div>
      <div class="pct">${completed.toLocaleString()} / ${s.target.toLocaleString()} · ${remaining.toLocaleString()} remaining · ${pct}%</div>
    </div>`;
  }).join("");
}
function deleteSankalp(id) { DATA.sankalps = DATA.sankalps.filter(s=>s.id!==id); save(); renderSankalps(); }
window.deleteSankalp = deleteSankalp;

function openAddSankalpModal() {
  const root = document.getElementById("modalRoot");
  root.innerHTML = modalShell(`
    <h3>Add Sankalp</h3>
    <label class="field-label">Goal name</label>
    <input type="text" id="sk_name" placeholder="e.g. Panch Lakh Japa">
    <label class="field-label">Target count</label>
    <input type="number" id="sk_target" placeholder="e.g. 100000" min="1">
    <label class="field-label">Applies to</label>
    <select id="sk_mantra"></select>
    <button class="btn-primary" id="sk_save">Add Sankalp</button>
    <button class="btn-secondary" id="sk_cancel">Cancel</button>
  `);
  openModal(root);
  populateMantraSelect(document.getElementById("sk_mantra"), true, "all");
  document.getElementById("sk_cancel").addEventListener("click", closeModal);
  document.getElementById("sk_save").addEventListener("click", () => {
    const name = document.getElementById("sk_name").value.trim();
    const target = parseInt(document.getElementById("sk_target").value,10);
    const mantraId = document.getElementById("sk_mantra").value;
    if (!name || !target || target<=0) { toast("Enter a name and valid target."); return; }
    DATA.sankalps.push({ id: uid(), name, target, mantraId, createdAt: todayStr() });
    save(); closeModal(); renderSankalps();
    toast("Sankalp added.");
  });
}

/* ---- Reminders ---- */
function renderReminders() {
  const box = document.getElementById("reminderList");
  if (DATA.settings.reminders.length === 0) { box.innerHTML = '<div class="empty-hint">No reminders set.</div>'; return; }
  box.innerHTML = DATA.settings.reminders.map(r => `
    <div class="reminder-item">
      <div class="row-text"><div class="t">${escapeHtml(r.label)}</div><div class="s">${r.time}</div></div>
      <div style="display:flex; align-items:center; gap:10px;">
        <label class="switch"><input type="checkbox" ${r.enabled?"checked":""} onchange="toggleReminder('${r.id}', this.checked)"><span class="slider"></span></label>
        <button class="icon-btn" onclick="deleteReminder('${r.id}')">✕</button>
      </div>
    </div>`).join("");
}
function toggleReminder(id, val) { const r = DATA.settings.reminders.find(x=>x.id===id); if(r){ r.enabled=val; save(); } }
function deleteReminder(id) { DATA.settings.reminders = DATA.settings.reminders.filter(x=>x.id!==id); save(); renderReminders(); }
window.toggleReminder = toggleReminder; window.deleteReminder = deleteReminder;

function openAddReminderModal() {
  const root = document.getElementById("modalRoot");
  root.innerHTML = modalShell(`
    <h3>Add Reminder</h3>
    <label class="field-label">Label</label>
    <input type="text" id="rm_label" placeholder="e.g. Morning Japa" value="Time for your Japa">
    <label class="field-label">Time</label>
    <input type="time" id="rm_time" value="06:00">
    <button class="btn-primary" id="rm_save">Add Reminder</button>
    <button class="btn-secondary" id="rm_cancel">Cancel</button>
  `);
  openModal(root);
  document.getElementById("rm_cancel").addEventListener("click", closeModal);
  document.getElementById("rm_save").addEventListener("click", () => {
    const label = document.getElementById("rm_label").value.trim() || "Time for your Japa";
    const time = document.getElementById("rm_time").value || "06:00";
    DATA.settings.reminders.push({ id: uid(), label, time, enabled: true, lastFired: null });
    save(); closeModal(); renderReminders();
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    toast("Reminder added.");
  });
}

function scheduleReminderCheck() {
  setInterval(() => {
    const now = new Date();
    const hm = pad(now.getHours()) + ":" + pad(now.getMinutes());
    const today = todayStr();
    DATA.settings.reminders.forEach(r => {
      if (r.enabled && r.time === hm && r.lastFired !== today) {
        r.lastFired = today; save();
        fireReminder(r);
      }
    });
  }, 20000);
}
function fireReminder(r) {
  const target = DATA.settings.dailyTargetMala;
  const done = combinedDayMala(todayStr());
  const remaining = Math.max(0, target - done);
  const body = `Target today: ${target} mala · Completed: ${fmtMala(done)} · Remaining: ${fmtMala(remaining)}`;
  if ("Notification" in window && Notification.permission === "granted") {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type:"SHOW_REMINDER", title: "🕉️ " + r.label, body });
    } else {
      new Notification("🕉️ " + r.label, { body, icon:"icon-192.png" });
    }
  } else {
    toast("🕉️ " + r.label + " — " + body);
  }
}

/* ---- Backup / Restore / CSV ---- */
function downloadBackup() {
  const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "mala-japa-backup-" + todayStr() + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Backup downloaded.");
}
function restoreBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.mantras || !parsed.logs) throw new Error("Invalid file");
      confirmDialog("Restore backup?", "This replaces all current data on this device with the backup file's data.", () => {
        DATA = parsed;
        DATA.settings = Object.assign({}, defaultData().settings, DATA.settings||{});
        save(); renderAll();
        toast("Backup restored.");
      });
    } catch (err) { toast("That file doesn't look like a valid backup."); }
  };
  reader.readAsText(file);
  e.target.value = "";
}
function exportCsv() {
  const rows = [["Date","Mantra","App Count","Manual Count","Total","Mala"]];
  DATA.mantras.forEach(m => {
    const logs = DATA.logs[m.id] || {};
    Object.keys(logs).sort().forEach(d => {
      const e = logs[d];
      const manual = (e.manual||[]).reduce((s,x)=>s+x.count,0);
      const total = (e.app||0) + manual;
      if (total>0) rows.push([d, m.name, e.app||0, manual, total, fmtMala(total/BEADS_PER_MALA)]);
    });
  });
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "mala-japa-history-" + todayStr() + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("CSV exported.");
}

/* ================= PIN LOCK ================= */
let pinBuffer = "";
function setupLockScreen() {
  const pad = document.getElementById("pinPad");
  pad.innerHTML = "";
  ["1","2","3","4","5","6","7","8","9","","0","⌫"].forEach(k => {
    const b = document.createElement("button");
    b.textContent = k;
    if (k==="") { b.style.visibility="hidden"; }
    else b.addEventListener("click", () => onPinKey(k));
    pad.appendChild(b);
  });
}
function onPinKey(k) {
  if (k === "⌫") { pinBuffer = pinBuffer.slice(0,-1); }
  else if (pinBuffer.length < 4) { pinBuffer += k; }
  renderPinDots();
  if (pinBuffer.length === 4) {
    if (pinBuffer === DATA.settings.pin) {
      document.getElementById("lockScreen").classList.remove("show");
      pinBuffer = "";
      document.getElementById("pinError").textContent = "";
    } else {
      document.getElementById("pinError").textContent = "Incorrect PIN, try again.";
      setTimeout(() => { pinBuffer = ""; renderPinDots(); }, 400);
    }
  }
}
function renderPinDots() {
  const box = document.getElementById("pinDots");
  box.innerHTML = "";
  for (let i=0;i<4;i++) { const d = document.createElement("div"); d.className = "pin-dot" + (i<pinBuffer.length?" filled":""); box.appendChild(d); }
}
function checkLock() {
  if (DATA.settings.pin) { document.getElementById("lockScreen").classList.add("show"); renderPinDots(); }
}
function openSetPinModal() {
  const root = document.getElementById("modalRoot");
  root.innerHTML = modalShell(`
    <h3>Set a 4-digit PIN</h3>
    <input type="password" id="pin_new" maxlength="4" inputmode="numeric" placeholder="New PIN">
    <label class="field-label">Confirm PIN</label>
    <input type="password" id="pin_confirm" maxlength="4" inputmode="numeric" placeholder="Confirm PIN">
    <button class="btn-primary" id="pin_save">Save PIN</button>
    <button class="btn-secondary" id="pin_cancel">Cancel</button>
  `);
  openModal(root);
  document.getElementById("pin_cancel").addEventListener("click", () => { document.getElementById("pinToggle").checked=false; closeModal(); });
  document.getElementById("pin_save").addEventListener("click", () => {
    const a = document.getElementById("pin_new").value, b = document.getElementById("pin_confirm").value;
    if (!/^\d{4}$/.test(a)) { toast("PIN must be exactly 4 digits."); return; }
    if (a !== b) { toast("PINs don't match."); return; }
    DATA.settings.pin = a; save(); closeModal(); toast("PIN lock enabled.");
  });
}

/* ================= MODAL HELPERS ================= */
function modalShell(inner) {
  return `<div class="modal-backdrop" id="mBackdrop"><div class="modal-sheet"><div class="sheet-row">${inner}</div></div></div>`;
}
function openModal(root) {
  root.querySelector("#mBackdrop").addEventListener("click", (e) => { if (e.target.id === "mBackdrop") closeModal(); });
}
function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }

function confirmDialog(title, body, onConfirm) {
  const root = document.getElementById("modalRoot");
  root.innerHTML = modalShell(`
    <h3>${escapeHtml(title)}</h3>
    <p style="color:var(--muted); font-size:13.5px; line-height:1.6;">${escapeHtml(body)}</p>
    <button class="btn-primary" id="cf_ok">Confirm</button>
    <button class="btn-secondary" id="cf_cancel">Cancel</button>
  `);
  openModal(root);
  document.getElementById("cf_cancel").addEventListener("click", closeModal);
  document.getElementById("cf_ok").addEventListener("click", () => { closeModal(); onConfirm(); });
}

/* ================= MISC ================= */
function setText(id, val) { document.getElementById(id).textContent = val; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(err => console.warn("SW registration failed:", err));
  }
}
