/* Stunden - privater Arbeitszeit-Tracker. Alle Daten bleiben im Speicher dieses Geraets. */
'use strict';

const KEY = 'hourapp.v1';
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const clone = (o) => JSON.parse(JSON.stringify(o));

const DEFAULTS = {
  entries: [],   // {id, start:ISO, end:ISO, note:string}
  running: null, // {start:ISO, note:string}
  settings: {
    targetHours: 8,
    workdays: [1, 2, 3, 4, 5],
    roundTo: 15,               // Minuten-Raster, 0 = aus
    roundMode: 'nearest'       // nearest | up | down
  }
};

let state = load();
let weekOffset = 0;
let editingId = null;
let lastExport = null;

/* ============================ speicher ============================ */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULTS);
    const d = JSON.parse(raw);
    return {
      entries: Array.isArray(d.entries)
        ? d.entries.filter((e) => e && e.start && e.end)
        : [],
      running: d.running && d.running.start ? d.running : null,
      settings: Object.assign(clone(DEFAULTS.settings), d.settings || {})
    };
  } catch (err) {
    console.warn('Daten nicht lesbar', err);
    return clone(DEFAULTS);
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    toast('Speichern fehlgeschlagen');
    console.error(err);
  }
}

/* ============================ zeit-helfer ============================ */

const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

/** Montag der Woche, in der d liegt. */
function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

const clock = (d) => pad(d.getHours()) + ':' + pad(d.getMinutes());
const shortDate = (d) => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.';

/** Minuten -> "7:30" */
function hm(min) {
  const neg = min < 0;
  const m = Math.round(Math.abs(min));
  return (neg ? '-' : '') + Math.floor(m / 60) + ':' + pad(m % 60);
}

/** Minuten -> "+7:30" / "-1:15" / "±0:00" */
function hmSigned(min) {
  const r = Math.round(min);
  if (r === 0) return '±0:00';
  return (r > 0 ? '+' : '') + hm(r);
}

/** Sekunden -> "1:07:42" */
function hms(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
}

/** Minuten -> "8,5" (Dezimalstunden, ohne ueberfluessige Nullen) */
function decHours(min) {
  return (min / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

function fmtDate(d, opts) {
  return d.toLocaleDateString('de-DE', opts || { weekday: 'long', day: '2-digit', month: 'long' });
}

/* ============================ rundung ============================ */

/** Zieht einen Zeitpunkt aufs eingestellte Raster. dir: floor | ceil | nearest */
function snap(date, dir) {
  const step = Number(state.settings.roundTo) || 0;
  if (!step) return new Date(date);
  const mid = startOfDay(date);
  const mins = (date - mid) / 60000;
  const f = dir === 'floor' ? Math.floor : dir === 'ceil' ? Math.ceil : Math.round;
  return new Date(mid.getTime() + f(mins / step) * step * 60000);
}

/**
 * Beim Aufrunden wandert der Beginn nach unten und das Ende nach oben,
 * also zugunsten der Arbeitszeit. Beim Abrunden umgekehrt.
 */
function snapDirs() {
  const m = state.settings.roundMode;
  if (m === 'up') return ['floor', 'ceil'];
  if (m === 'down') return ['ceil', 'floor'];
  return ['nearest', 'nearest'];
}

function roundedRange(startISO, endISO) {
  const [ds, de] = snapDirs();
  const s = snap(new Date(startISO), ds);
  let e = snap(new Date(endISO), de);
  if (e < s) e = s;
  return { start: s, end: e };
}

/** Gemeldete Minuten eines Eintrags (nach Rundung). */
function entryMin(e) {
  const r = roundedRange(e.start, e.end);
  return Math.max(0, (r.end - r.start) / 60000);
}

function isRounded(e) {
  const r = roundedRange(e.start, e.end);
  return r.start.getTime() !== new Date(e.start).getTime() ||
         r.end.getTime() !== new Date(e.end).getTime();
}

/* ============================ nachricht ============================ */

/** "09.09. | 07:00 - 16:00 | 8,5 h" */
function buildMessage(startISO, endISO) {
  const r = roundedRange(startISO, endISO);
  const min = Math.max(0, (r.end - r.start) / 60000);
  return `${shortDate(r.start)} | ${clock(r.start)} - ${clock(r.end)} | ${decHours(min)} h`;
}

async function sendWhatsApp(text) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (err) { /* Zwischenablage ist nur die Absicherung */ }

  window.location.href = 'whatsapp://send?text=' + encodeURIComponent(text);

  setTimeout(() => {
    if (!document.hidden) {
      toast(copied ? 'WhatsApp reagiert nicht. Text ist kopiert.' : 'WhatsApp reagiert nicht.');
    }
  }, 1500);
}

/* ============================ berechnung ============================ */

function entriesOfDay(key) {
  return state.entries
    .filter((e) => dayKey(new Date(e.start)) === key)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function runningSeconds() {
  return state.running ? Math.max(0, (Date.now() - new Date(state.running.start)) / 1000) : 0;
}

function dayMinutes(key, withRunning) {
  let sum = entriesOfDay(key).reduce((s, e) => s + entryMin(e), 0);
  if (withRunning && state.running && dayKey(new Date(state.running.start)) === key) {
    sum += runningSeconds() / 60;
  }
  return sum;
}

const isWorkday = (d) => state.settings.workdays.includes(d.getDay());

/** Soll-Minuten: nur an Arbeitstagen, und nur bis einschliesslich heute. */
function targetMinutes(d) {
  if (!isWorkday(d)) return 0;
  if (startOfDay(d) > startOfDay(new Date())) return 0;
  return (Number(state.settings.targetHours) || 0) * 60;
}

function weekStats(monday) {
  let ist = 0, soll = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    ist += dayMinutes(dayKey(d), true);
    soll += targetMinutes(d);
  }
  return { ist, soll, saldo: ist - soll };
}

/* ============================ darstellung ============================ */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function entryRow(e) {
  const btn = el('button', 'entry');
  btn.type = 'button';

  const r = roundedRange(e.start, e.end);
  const box = el('div', 'times');
  box.appendChild(el('div', 'range', `${clock(r.start)} – ${clock(r.end)}`));
  if (e.note) box.appendChild(el('div', 'note', e.note));

  btn.append(box, el('div', 'dur', hm(entryMin(e))));
  btn.addEventListener('click', () => openSheet(e.id));
  return btn;
}

function runningRow() {
  const div = el('div', 'entry live');
  const box = el('div', 'times');
  box.appendChild(el('div', 'range', `${clock(new Date(state.running.start))} – läuft`));
  if (state.running.note) box.appendChild(el('div', 'note', state.running.note));
  div.append(box, el('div', 'dur', hm(runningSeconds() / 60)));
  return div;
}

function card(children) {
  const box = el('div', 'daygroup');
  children.forEach((c) => box.appendChild(c));
  return box;
}

function paintStats() {
  const now = new Date();
  const week = weekStats(startOfWeek(now));
  $('#stat-today').textContent = hm(dayMinutes(dayKey(now), true));
  $('#stat-week').textContent = hm(week.ist);
  const bal = $('#stat-balance');
  bal.textContent = hmSigned(week.saldo);
  bal.className = 'stat-val ' + (week.saldo >= 0 ? 'pos' : 'neg');
}

function renderTimer() {
  const now = new Date();
  $('#today-date').textContent = fmtDate(now);

  const running = !!state.running;
  $('#clock').textContent = hms(runningSeconds());
  $('#clock-label').textContent = running
    ? 'Läuft seit ' + clock(new Date(state.running.start))
    : 'Nicht gestartet';

  const btn = $('#toggle-btn');
  btn.textContent = running ? 'Stopp' : 'Start';
  btn.classList.toggle('stop', running);

  paintStats();

  const key = dayKey(now);
  const list = $('#today-list');
  list.textContent = '';
  if (running && dayKey(new Date(state.running.start)) === key) list.appendChild(card([runningRow()]));
  const items = entriesOfDay(key);
  if (items.length) list.appendChild(card(items.map(entryRow)));
  else if (!running) list.appendChild(el('p', 'empty', 'Heute noch nichts erfasst.'));
}

function renderHistory() {
  const monday = addDays(startOfWeek(new Date()), weekOffset * 7);
  const sunday = addDays(monday, 6);

  $('#week-range').textContent =
    fmtDate(monday, { day: '2-digit', month: '2-digit' }) + ' – ' +
    fmtDate(sunday, { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    (weekOffset === 0 ? ' · diese Woche' : '');

  const st = weekStats(monday);
  $('#week-total').textContent = hm(st.ist);
  const wb = $('#week-balance');
  wb.textContent = 'Saldo ' + hmSigned(st.saldo);
  wb.className = st.saldo >= 0 ? 'pos' : 'neg';
  $('#week-next').style.opacity = weekOffset >= 0 ? .35 : 1;

  const list = $('#history-list');
  list.textContent = '';
  let any = false;

  for (let i = 6; i >= 0; i--) {
    const d = addDays(monday, i);
    const key = dayKey(d);
    const items = entriesOfDay(key);
    const live = !!state.running && dayKey(new Date(state.running.start)) === key;
    if (!items.length && !live) continue;
    any = true;

    const group = el('div', 'daygroup');
    const head = el('div', 'dayhead');
    head.appendChild(el('span', null, fmtDate(d, { weekday: 'short', day: '2-digit', month: '2-digit' })));

    const right = el('span');
    right.appendChild(el('span', 'dsum', hm(dayMinutes(key, true))));
    const soll = targetMinutes(d);
    if (soll > 0) {
      const diff = dayMinutes(key, true) - soll;
      right.appendChild(el('span', 'dbal ' + (diff >= 0 ? 'pos' : 'neg'), hmSigned(diff)));
    }
    head.appendChild(right);
    group.appendChild(head);

    if (live) group.appendChild(runningRow());
    items.forEach((e) => group.appendChild(entryRow(e)));
    list.appendChild(group);
  }

  if (!any) list.appendChild(el('p', 'empty', 'Keine Einträge in dieser Woche.'));
}

function renderSettings() {
  $('#set-target').value = state.settings.targetHours;
  $('#set-round').value = String(state.settings.roundTo);
  $('#set-roundmode').value = state.settings.roundMode;
  $('#row-roundmode').style.opacity = state.settings.roundTo ? 1 : .4;
  $('#set-roundmode').disabled = !state.settings.roundTo;

  // Beispiel mit einer krummen Schicht, damit der Modus sichtbar wird
  const base = startOfDay(new Date());
  const s = new Date(base.getTime() + (7 * 60 + 3) * 60000);
  const e = new Date(base.getTime() + (16 * 60 + 7) * 60000);
  const r = roundedRange(s.toISOString(), e.toISOString());
  const min = (r.end - r.start) / 60000;
  $('#round-example').textContent = state.settings.roundTo
    ? `07:03 – 16:07  wird zu  ${clock(r.start)} – ${clock(r.end)}  (${decHours(min)} h)`
    : '07:03 – 16:07 bleibt wie erfasst (9,07 h)';

  const box = $('#set-days');
  box.textContent = '';
  [1, 2, 3, 4, 5, 6, 0].forEach((idx) => {
    const b = el('button', 'day' + (state.settings.workdays.includes(idx) ? ' on' : ''), DAYS[idx]);
    b.type = 'button';
    b.addEventListener('click', () => {
      const set = new Set(state.settings.workdays);
      set.has(idx) ? set.delete(idx) : set.add(idx);
      state.settings.workdays = [...set].sort();
      save();
      renderSettings();
      renderTimer();
      renderHistory();
    });
    box.appendChild(b);
  });

  $('#storage-hint').textContent =
    `${state.entries.length} Einträge gespeichert. Die Daten liegen ausschließlich auf diesem Gerät. ` +
    `Löschst du die App vom Home-Bildschirm, sind sie weg. Zieh ab und zu ein Backup.`;
}

function renderAll() {
  renderTimer();
  renderHistory();
  renderSettings();
}

/* ============================ timer ============================ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toggleTimer() {
  if (state.running) {
    const start = new Date(state.running.start);
    const end = new Date();
    const note = state.running.note || '';
    state.running = null;
    $('#running-note').value = '';

    if (end - start < 30000 && !confirm('Weniger als 30 Sekunden. Eintrag trotzdem anlegen?')) {
      save();
      renderAll();
      return;
    }

    const entry = { id: uid(), start: start.toISOString(), end: end.toISOString(), note };
    state.entries.push(entry);
    save();
    renderAll();
    openSheet(entry.id, null, true);
  } else {
    state.running = { start: new Date().toISOString(), note: $('#running-note').value.trim() };
    save();
    renderAll();
    toast('Timer läuft');
  }
}

function tick() {
  if (!state.running) return;
  $('#clock').textContent = hms(runningSeconds());
  paintStats();
  document.querySelectorAll('.entry.live .dur').forEach((n) => {
    n.textContent = hm(runningSeconds() / 60);
  });
}

/* ============================ eintrags-sheet ============================ */

function openSheet(id, presetDate, justStopped) {
  editingId = id || null;
  const e = id ? state.entries.find((x) => x.id === id) : null;

  $('#sheet-title').textContent = justStopped ? 'Zeit prüfen' : (e ? 'Eintrag' : 'Neuer Eintrag');
  $('#sheet-intro').classList.toggle('hidden', !justStopped);
  $('#sheet-delete').classList.toggle('hidden', !e);

  if (e) {
    const s = new Date(e.start), en = new Date(e.end);
    $('#f-date').value = dayKey(s);
    $('#f-start').value = clock(s);
    $('#f-end').value = clock(en);
    $('#f-note').value = e.note || '';
  } else {
    const d = presetDate || new Date();
    $('#f-date').value = dayKey(d);
    $('#f-start').value = '07:00';
    $('#f-end').value = '16:00';
    $('#f-note').value = '';
  }

  updatePreview();
  $('#sheet').classList.remove('hidden');
}

function closeSheet() {
  $('#sheet').classList.add('hidden');
  editingId = null;
}

/** Liest das Formular. Ein Ende vor dem Beginn gilt als Folgetag (Nachtschicht). */
function readSheet() {
  const date = $('#f-date').value;
  const a = $('#f-start').value;
  const b = $('#f-end').value;
  if (!date || !a || !b) return null;

  const start = new Date(`${date}T${a}:00`);
  let end = new Date(`${date}T${b}:00`);
  if (isNaN(start) || isNaN(end)) return null;
  if (end <= start) end = addDays(end, 1);

  return { start, end, note: $('#f-note').value.trim() };
}

function updatePreview() {
  const v = readSheet();
  if (!v) {
    $('#msg-text').textContent = '–';
    $('#raw-note').textContent = '';
    $('#send-wa').disabled = true;
    return;
  }
  $('#send-wa').disabled = false;
  $('#msg-text').textContent = buildMessage(v.start.toISOString(), v.end.toISOString());

  const r = roundedRange(v.start.toISOString(), v.end.toISOString());
  const changed = r.start.getTime() !== v.start.getTime() || r.end.getTime() !== v.end.getTime();
  $('#raw-note').textContent = changed
    ? `gerundet · tatsächlich ${clock(v.start)} – ${clock(v.end)} (${hm((v.end - v.start) / 60000)} h)`
    : '';
}

/** Sichert das Formular und gibt den Eintrag zurueck, oder null bei Fehler. */
function commitSheet() {
  const v = readSheet();
  if (!v) { toast('Bitte Datum und Zeiten ausfüllen'); return null; }

  let entry;
  if (editingId) {
    entry = state.entries.find((x) => x.id === editingId);
    if (!entry) { toast('Eintrag nicht gefunden'); return null; }
    entry.start = v.start.toISOString();
    entry.end = v.end.toISOString();
    entry.note = v.note;
  } else {
    entry = { id: uid(), start: v.start.toISOString(), end: v.end.toISOString(), note: v.note };
    state.entries.push(entry);
    editingId = entry.id;
  }
  save();
  renderAll();
  return entry;
}

function saveSheet() {
  if (!commitSheet()) return;
  closeSheet();
  toast('Gesichert');
}

function deleteEntry() {
  if (!editingId || !confirm('Diesen Eintrag löschen?')) return;
  state.entries = state.entries.filter((x) => x.id !== editingId);
  save();
  closeSheet();
  renderAll();
  toast('Gelöscht');
}

/* ============================ export / import ============================ */

function buildCSV() {
  const rows = [['Datum', 'Beginn', 'Ende', 'Stunden', 'Stunden (h:mm)', 'Notiz']];
  const sorted = [...state.entries].sort((a, b) => new Date(a.start) - new Date(b.start));
  let total = 0;

  for (const e of sorted) {
    const r = roundedRange(e.start, e.end);
    const min = entryMin(e);
    total += min;
    rows.push([
      r.start.toLocaleDateString('de-DE'),
      clock(r.start),
      clock(r.end),
      decHours(min),
      hm(min),
      (e.note || '').replace(/[;\r\n]/g, ' ')
    ]);
  }

  rows.push([]);
  rows.push(['Summe', '', '', decHours(total), hm(total), '']);
  return rows.map((r) => r.join(';')).join('\r\n');
}

function openExport(title, text, filename, mime) {
  lastExport = { text, filename, mime };
  $('#ex-title').textContent = title;
  $('#ex-text').value = text;
  $('#exsheet').classList.remove('hidden');

  $('#ex-share').onclick = async () => {
    const file = new File([text], filename, { type: mime });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return;
      }
      if (navigator.share) { await navigator.share({ title, text }); return; }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || 'Kopiert');
  } catch (err) {
    const t = $('#ex-text');
    if (t && !$('#exsheet').classList.contains('hidden')) {
      t.focus();
      t.setSelectionRange(0, t.value.length);
    }
    toast('Kopieren nicht erlaubt, bitte von Hand markieren');
  }
}

function importJSON(text) {
  let data;
  try { data = JSON.parse(text); }
  catch (err) { toast('Datei ist kein gültiges JSON'); return; }

  if (!data || !Array.isArray(data.entries)) { toast('Kein gültiges Backup'); return; }
  if (!confirm(`Backup mit ${data.entries.length} Einträgen einspielen? Die aktuellen Daten werden ersetzt.`)) return;

  state = {
    entries: data.entries.filter((e) => e && e.start && e.end),
    running: data.running && data.running.start ? data.running : null,
    settings: Object.assign(clone(DEFAULTS.settings), data.settings || {})
  };
  save();
  renderAll();
  toast('Backup eingespielt');
}

/* ============================ ui ============================ */

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function showView(name) {
  ['timer', 'history', 'settings'].forEach((v) => {
    $('#view-' + v).classList.toggle('hidden', v !== name);
  });
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
}

function sheetOpen() {
  return !$('#sheet').classList.contains('hidden') || !$('#exsheet').classList.contains('hidden');
}

function bind() {
  $('#toggle-btn').addEventListener('click', toggleTimer);
  $('#running-note').addEventListener('input', (ev) => {
    if (state.running) { state.running.note = ev.target.value.trim(); save(); }
  });

  document.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => showView(b.dataset.view)));

  $('#week-prev').addEventListener('click', () => { weekOffset--; renderHistory(); });
  $('#week-next').addEventListener('click', () => { if (weekOffset < 0) { weekOffset++; renderHistory(); } });

  $('#add-today').addEventListener('click', () => openSheet(null, new Date()));
  $('#add-any').addEventListener('click', () =>
    openSheet(null, addDays(startOfWeek(new Date()), weekOffset * 7)));

  $('#sheet-save').addEventListener('click', saveSheet);
  $('#sheet-delete').addEventListener('click', deleteEntry);
  document.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', closeSheet));
  ['#f-date', '#f-start', '#f-end'].forEach((sel) => {
    $(sel).addEventListener('input', updatePreview);
    $(sel).addEventListener('change', updatePreview);
  });

  $('#send-wa').addEventListener('click', () => {
    const entry = commitSheet();
    if (!entry) return;
    const text = buildMessage(entry.start, entry.end);
    closeSheet();
    sendWhatsApp(text);
  });

  $('#copy-msg').addEventListener('click', () => {
    const v = readSheet();
    if (!v) { toast('Bitte Datum und Zeiten ausfüllen'); return; }
    copyText(buildMessage(v.start.toISOString(), v.end.toISOString()), 'Nachricht kopiert');
  });

  document.querySelectorAll('[data-exclose]').forEach((n) =>
    n.addEventListener('click', () => $('#exsheet').classList.add('hidden')));
  $('#ex-copy').addEventListener('click', () =>
    copyText(lastExport ? lastExport.text : $('#ex-text').value));

  $('#set-target').addEventListener('change', (ev) => {
    const v = Number(ev.target.value);
    state.settings.targetHours = isNaN(v) ? 8 : Math.min(24, Math.max(0, v));
    ev.target.value = state.settings.targetHours;
    save();
    renderTimer();
    renderHistory();
  });
  $('#set-round').addEventListener('change', (ev) => {
    state.settings.roundTo = Number(ev.target.value) || 0;
    save();
    renderAll();
  });
  $('#set-roundmode').addEventListener('change', (ev) => {
    state.settings.roundMode = ev.target.value;
    save();
    renderAll();
  });

  $('#export-csv').addEventListener('click', () => {
    if (!state.entries.length) { toast('Noch nichts zu exportieren'); return; }
    openExport('CSV-Export', buildCSV(), `stunden-${dayKey(new Date())}.csv`, 'text/csv');
  });
  $('#export-json').addEventListener('click', () =>
    openExport('Backup', JSON.stringify(state, null, 2),
      `stunden-backup-${dayKey(new Date())}.json`, 'application/json'));
  $('#import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importJSON(String(r.result));
    r.readAsText(f);
    ev.target.value = '';
  });

  $('#wipe').addEventListener('click', () => {
    if (!confirm('Wirklich alle Einträge und Einstellungen löschen?')) return;
    if (!confirm('Letzte Warnung, das lässt sich nicht rückgängig machen.')) return;
    state = clone(DEFAULTS);
    save();
    renderAll();
    toast('Alles gelöscht');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || sheetOpen()) return;
    state = load();
    renderAll();
  });
}

/* ============================ start ============================ */

bind();
if (state.running && state.running.note) $('#running-note').value = state.running.note;
renderAll();
setInterval(tick, 1000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
  });
}
