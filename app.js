/* Stunden - privater Arbeitszeit-Tracker. Alle Daten bleiben im Speicher dieses Geraets. */
'use strict';

const KEY = 'hourapp.v1';
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DEFAULT_TEMPLATE = '{datum} | {beginn} - {ende} | {stunden} h';
const clone = (o) => JSON.parse(JSON.stringify(o));

const DEFAULTS = {
  entries: [],   // {id, start:ISO, end:ISO, note:string, sent:bool}
  running: null, // {start:ISO, note:string}
  settings: {
    roundTo: 15,               // Minuten-Raster, 0 = aus
    roundMode: 'nearest',      // nearest | up | down
    roundTarget: 'times',      // times = Anfang und Ende ziehen, duration = nur die Dauer
    wage: 0,                   // Stundenlohn in Euro, 0 = kein Geld anzeigen
    template: DEFAULT_TEMPLATE,
    warnHours: 12,             // Vergessen-Warnung, 0 = aus
    backupDays: 14,            // Backup-Erinnerung nach x Tagen, 0 = aus
    lastBackup: null           // ISO-Zeitpunkt des letzten gesicherten Backups
  }
};

let state = load();
let period = 'week';           // day | week | month | all
let periodOffset = 0;
let editingId = null;
let lastExport = null;
let pendingImport = null;
let warnDismissed = false;
let backupDismissed = false;
let onlyOpen = false;      // Filter: nur ungemeldete Eintraege
let sendQueue = [];        // ids, die nacheinander gemeldet werden

/* ============================ speicher ============================ */

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(DEFAULTS);
    const d = JSON.parse(raw);
    return {
      entries: Array.isArray(d.entries)
        ? d.entries.filter((e) => e && e.start && e.end).map((e) => ({ sent: false, ...e }))
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
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

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
const fullDate = (d) => shortDate(d) + d.getFullYear();

/** Minuten -> "7:30" */
function hm(min) {
  const neg = min < 0;
  const m = Math.round(Math.abs(min));
  return (neg ? '-' : '') + Math.floor(m / 60) + ':' + pad(m % 60);
}

/** Sekunden -> "1:07:42" */
function hms(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
}

/** Minuten -> "8,5" (Dezimalstunden ohne ueberfluessige Nullen) */
function decHours(min) {
  return (min / 60).toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

function fmtDate(d, opts) {
  return d.toLocaleDateString('de-DE', opts || { weekday: 'long', day: '2-digit', month: 'long' });
}

/* ============================ geld ============================ */

const hasWage = () => (Number(state.settings.wage) || 0) > 0;

function money(min) {
  const val = (min / 60) * (Number(state.settings.wage) || 0);
  return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
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
  if (state.settings.roundTarget === 'duration') {
    return { start: new Date(startISO), end: new Date(endISO) };
  }
  const [ds, de] = snapDirs();
  const s = snap(new Date(startISO), ds);
  let e = snap(new Date(endISO), de);
  if (e < s) e = s;
  return { start: s, end: e };
}

/** Rundet eine Dauer direkt aufs Raster, statt Anfang und Ende zu verschieben. */
function roundDuration(min) {
  const step = Number(state.settings.roundTo) || 0;
  if (!step) return min;
  const m = state.settings.roundMode;
  const f = m === 'up' ? Math.ceil : m === 'down' ? Math.floor : Math.round;
  return f(min / step) * step;
}

/** Was gemeldet wird: die Zeiten und die Minuten nach Rundung. */
function reported(startISO, endISO) {
  const r = roundedRange(startISO, endISO);
  const min = state.settings.roundTarget === 'duration'
    ? roundDuration((new Date(endISO) - new Date(startISO)) / 60000)
    : (r.end - r.start) / 60000;
  return { start: r.start, end: r.end, min: Math.max(0, min) };
}

/** Gemeldete Minuten eines Eintrags (nach Rundung). */
function entryMin(e) {
  return reported(e.start, e.end).min;
}

/* ============================ nachricht ============================ */

const PLACEHOLDERS = {
  '{datum}':      (c) => shortDate(c.start),
  '{datum_lang}': (c) => fullDate(c.start),
  '{wochentag}':  (c) => DAYS[c.start.getDay()],
  '{beginn}':     (c) => clock(c.start),
  '{ende}':       (c) => clock(c.end),
  '{stunden}':    (c) => decHours(c.min),
  '{stunden_hm}': (c) => hm(c.min),
  '{geld}':       (c) => money(c.min),
  '{notiz}':      (c) => c.note || ''
};

function buildMessage(startISO, endISO, note) {
  const r = reported(startISO, endISO);
  const ctx = { start: r.start, end: r.end, min: r.min, note: note || '' };
  const tpl = state.settings.template || DEFAULT_TEMPLATE;
  return tpl.replace(/\{[a-z_]+\}/g, (m) => (PLACEHOLDERS[m] ? PLACEHOLDERS[m](ctx) : m));
}

async function sendWhatsApp(text) {
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; }
  catch (err) { /* Zwischenablage ist nur die Absicherung */ }

  window.location.href = 'whatsapp://send?text=' + encodeURIComponent(text);

  setTimeout(() => {
    if (!document.hidden) {
      toast(copied ? 'WhatsApp reagiert nicht. Text ist kopiert.' : 'WhatsApp reagiert nicht.');
    }
  }, 1500);
}

/** Ungemeldete Eintraege des angezeigten Zeitraums, aelteste zuerst. */
function openEntries() {
  const { from, to } = periodRange(period, periodOffset);
  return entriesInRange(from, to).filter((e) => !e.sent);
}

function sendAllOpen() {
  const list = openEntries();
  if (!list.length) return;
  const text = list.map((e) => buildMessage(e.start, e.end, e.note)).join('\n');
  list.forEach((e) => { e.sent = true; });
  onlyOpen = false;
  save();
  renderAll();
  sendWhatsApp(text);
}

/** Meldet die offenen Eintraege einzeln, jeweils nach der Rueckkehr aus WhatsApp. */
function startQueue() {
  sendQueue = openEntries().map((e) => e.id);
  if (!sendQueue.length) return;
  nextInQueue();
}

function nextInQueue() {
  while (sendQueue.length) {
    const id = sendQueue.shift();
    if (state.entries.some((e) => e.id === id)) { openSheet(id); return; }
  }
  onlyOpen = false;
  renderAll();
  toast('Alle offenen Meldungen durch');
}

/* ============================ zeitraeume ============================ */

function periodRange(kind, offset) {
  const now = new Date();
  if (kind === 'day') {
    const from = addDays(startOfDay(now), offset);
    return { from, to: addDays(from, 1), label: fmtDate(from) };
  }
  if (kind === 'month') {
    const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
    return { from, to, label: from.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) };
  }
  if (kind === 'all') {
    return { from: new Date(-8640000000000000), to: new Date(8640000000000000), label: 'Alle Einträge' };
  }
  const from = addDays(startOfWeek(now), offset * 7);
  const to = addDays(from, 7);
  return {
    from, to,
    label: fmtDate(from, { day: '2-digit', month: '2-digit' }) + ' – ' +
           fmtDate(addDays(to, -1), { day: '2-digit', month: '2-digit', year: 'numeric' })
  };
}

function entriesInRange(from, to) {
  return state.entries
    .filter((e) => { const s = new Date(e.start); return s >= from && s < to; })
    .sort((a, b) => new Date(a.start) - new Date(b.start));
}

function runningSeconds() {
  return state.running ? Math.max(0, (Date.now() - new Date(state.running.start)) / 1000) : 0;
}

function runningInRange(from, to) {
  if (!state.running) return false;
  const s = new Date(state.running.start);
  return s >= from && s < to;
}

/** Summe in Minuten, laufender Timer eingerechnet. */
function sumRange(from, to) {
  let sum = entriesInRange(from, to).reduce((s, e) => s + entryMin(e), 0);
  if (runningInRange(from, to)) sum += runningSeconds() / 60;
  return sum;
}

const entriesOfDay = (d) => entriesInRange(startOfDay(d), addDays(startOfDay(d), 1));

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

  const r = reported(e.start, e.end);
  const box = el('div', 'times');
  const range = el('div', 'range', `${clock(r.start)} – ${clock(r.end)}`);
  if (e.sent) range.appendChild(el('span', 'sent', '✓'));
  box.appendChild(range);
  if (e.note) box.appendChild(el('div', 'note', e.note));

  const right = el('div');
  right.appendChild(el('div', 'dur', hm(entryMin(e))));
  if (hasWage()) right.appendChild(el('div', 'stat-money', money(entryMin(e))));

  btn.append(box, right);
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

function statTile(label, min) {
  const t = el('div', 'stat');
  t.appendChild(el('span', 'stat-val', hm(min)));
  t.appendChild(el('span', 'stat-key', label));
  if (hasWage()) t.appendChild(el('span', 'stat-money', money(min)));
  return t;
}

function paintQuickStats() {
  const now = new Date();
  const box = $('#quick-stats');
  box.textContent = '';
  box.appendChild(statTile('Heute', sumRange(startOfDay(now), addDays(startOfDay(now), 1))));
  box.appendChild(statTile('Woche', sumRange(startOfWeek(now), addDays(startOfWeek(now), 7))));
  const mFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const mTo = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  box.appendChild(statTile('Monat', sumRange(mFrom, mTo)));
}

/** Tage seit dem letzten Backup, oder null wenn noch nie gesichert. */
function daysSinceBackup() {
  const iso = state.settings.lastBackup;
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.floor((startOfDay(new Date()) - startOfDay(d)) / 86400000);
}

function markBackupDone() {
  state.settings.lastBackup = new Date().toISOString();
  backupDismissed = true;
  save();
  renderTimer();
  renderSettings();
}

function paintBackupBanner() {
  const limit = Number(state.settings.backupDays) || 0;
  const days = daysSinceBackup();
  const overdue = limit > 0 && state.entries.length > 0 &&
                  (days === null || days >= limit);
  const show = overdue && !backupDismissed;

  $('#backup-banner').classList.toggle('hidden', !show);
  if (show) {
    $('#backup-text').textContent = days === null
      ? 'Noch kein Backup gesichert. Die Daten liegen nur auf diesem iPhone.'
      : `Letztes Backup vor ${days} Tagen. Zeit für ein neues.`;
  }
}

function paintWarnBanner() {
  const h = Number(state.settings.warnHours) || 0;
  const show = !!state.running && h > 0 && !warnDismissed && runningSeconds() > h * 3600;
  $('#forgot-banner').classList.toggle('hidden', !show);
  if (show) {
    $('#forgot-text').textContent =
      `Der Timer läuft seit ${hm(runningSeconds() / 60)} Stunden. Vergessen zu stoppen?`;
  }
}

function renderTimer() {
  const now = new Date();
  $('#today-date').textContent = fmtDate(now);

  const running = !!state.running;
  $('#clock').textContent = hms(runningSeconds());
  $('#clock-label').textContent = running
    ? 'Läuft seit ' + clock(new Date(state.running.start))
    : 'Nicht gestartet';
  $('#clock-money').textContent = running && hasWage() ? money(runningSeconds() / 60) : '';

  const btn = $('#toggle-btn');
  btn.textContent = running ? 'Stopp' : 'Start';
  btn.classList.toggle('stop', running);

  paintQuickStats();
  paintWarnBanner();
  paintBackupBanner();

  const list = $('#today-list');
  list.textContent = '';
  if (running && dayKey(new Date(state.running.start)) === dayKey(now)) {
    list.appendChild(card([runningRow()]));
  }
  const items = entriesOfDay(now);
  if (items.length) list.appendChild(card(items.map(entryRow)));
  else if (!running) list.appendChild(el('p', 'empty', 'Heute noch nichts erfasst.'));

  $('#add-like-last').classList.toggle('hidden', !lastEntry());
}

function lastEntry() {
  if (!state.entries.length) return null;
  return state.entries.reduce((a, b) => (new Date(a.start) > new Date(b.start) ? a : b));
}

function renderHistory() {
  const { from, to, label } = periodRange(period, periodOffset);
  $('#period-label').textContent = label + (periodOffset === 0 && period !== 'all' ? ' · aktuell' : '');

  document.querySelectorAll('#period-seg button').forEach((b) =>
    b.classList.toggle('on', b.dataset.p === period));
  $('#period-nav').classList.toggle('hidden', period === 'all');
  $('#per-next').style.opacity = periodOffset >= 0 ? .35 : 1;

  const min = sumRange(from, to);
  $('#period-hours').textContent = hm(min);
  $('#period-money').textContent = hasWage() ? money(min) : decHours(min) + ' Stunden';

  const all = entriesInRange(from, to);
  const openItems = all.filter((e) => !e.sent);
  if (!openItems.length) onlyOpen = false;
  const items = onlyOpen ? openItems : all;

  const hint = $('#open-hint');
  hint.classList.toggle('hidden', openItems.length === 0);
  hint.classList.toggle('on', onlyOpen);
  hint.textContent = openItems.length === 1
    ? '1 offene Meldung' : `${openItems.length} offene Meldungen`;

  $('#open-bar').classList.toggle('hidden', !onlyOpen || !openItems.length);
  $('#send-all').textContent = openItems.length === 1
    ? 'Meldung senden' : `Alle ${openItems.length} als eine Nachricht`;

  // nach Tagen gruppieren, neueste zuerst
  const byDay = new Map();
  items.forEach((e) => {
    const k = dayKey(new Date(e.start));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  });
  if (!onlyOpen && runningInRange(from, to)) {
    const k = dayKey(new Date(state.running.start));
    if (!byDay.has(k)) byDay.set(k, []);
  }

  const list = $('#history-list');
  list.textContent = '';
  const keys = [...byDay.keys()].sort().reverse();

  for (const k of keys) {
    const day = new Date(k + 'T00:00:00');
    const group = el('div', 'daygroup');

    const head = el('div', 'dayhead');
    head.appendChild(el('span', null, fmtDate(day, { weekday: 'short', day: '2-digit', month: '2-digit' })));
    const right = el('span');
    const dayMin = onlyOpen
      ? byDay.get(k).reduce((sum, e) => sum + entryMin(e), 0)
      : sumRange(startOfDay(day), addDays(startOfDay(day), 1));
    right.appendChild(el('span', 'dsum', hm(dayMin)));
    if (hasWage()) right.appendChild(el('span', 'dbal', money(dayMin)));
    head.append(right);
    group.appendChild(head);

    if (!onlyOpen && state.running && dayKey(new Date(state.running.start)) === k) {
      group.appendChild(runningRow());
    }
    byDay.get(k).forEach((e) => group.appendChild(entryRow(e)));
    list.appendChild(group);
  }

  if (!keys.length) {
    list.appendChild(el('p', 'empty', onlyOpen
      ? 'Alles gemeldet in diesem Zeitraum.'
      : 'Keine Einträge in diesem Zeitraum.'));
  }
}

function renderSettings() {
  $('#set-wage').value = state.settings.wage || '';
  $('#set-round').value = String(state.settings.roundTo);
  $('#set-roundmode').value = state.settings.roundMode;
  $('#set-roundtarget').value = state.settings.roundTarget;
  $('#set-warn').value = String(state.settings.warnHours);
  $('#set-backup-days').value = String(state.settings.backupDays);

  const days = daysSinceBackup();
  const lb = $('#last-backup');
  lb.textContent = days === null ? 'noch nie'
    : days === 0 ? 'heute'
    : days === 1 ? 'gestern'
    : `vor ${days} Tagen`;
  const limit = Number(state.settings.backupDays) || 0;
  lb.className = limit && (days === null || days >= limit) ? 'neg' : '';
  ['#row-roundmode', '#row-roundtarget'].forEach((sel) => {
    $(sel).style.opacity = state.settings.roundTo ? 1 : .4;
  });
  $('#set-roundmode').disabled = !state.settings.roundTo;
  $('#set-roundtarget').disabled = !state.settings.roundTo;

  // Beispiel mit krummer Schicht, damit der Modus sichtbar wird
  const base = startOfDay(new Date());
  const s = new Date(base.getTime() + (7 * 60 + 3) * 60000);
  const e = new Date(base.getTime() + (16 * 60 + 7) * 60000);
  const r = reported(s.toISOString(), e.toISOString());
  $('#round-example').textContent =
    !state.settings.roundTo ? '07:03 – 16:07 bleibt wie erfasst (9,07 h)'
    : state.settings.roundTarget === 'duration'
      ? `07:03 – 16:07 bleibt stehen, 9:04 wird zu ${decHours(r.min)} h`
      : `07:03 – 16:07  wird zu  ${clock(r.start)} – ${clock(r.end)}  (${decHours(r.min)} h)`;

  if ($('#set-template').value !== state.settings.template) {
    $('#set-template').value = state.settings.template;
  }
  $('#tpl-preview').textContent = buildMessage(s.toISOString(), e.toISOString(), 'Beispielnotiz');

  const chips = $('#tpl-chips');
  chips.textContent = '';
  Object.keys(PLACEHOLDERS).forEach((ph) => {
    const b = el('button', 'chip', ph);
    b.type = 'button';
    b.addEventListener('click', () => insertPlaceholder(ph));
    chips.appendChild(b);
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

function startTimer() {
  if (state.running) { toast('Timer läuft schon'); return; }
  state.running = { start: new Date().toISOString(), note: $('#running-note').value.trim() };
  warnDismissed = false;
  save();
  renderAll();
  toast('Timer läuft');
}

function stopTimer() {
  if (!state.running) { toast('Kein Timer aktiv'); return; }
  const start = new Date(state.running.start);
  const end = new Date();
  const note = state.running.note || '';
  state.running = null;
  warnDismissed = false;
  $('#running-note').value = '';

  if (end - start < 30000 && !confirm('Weniger als 30 Sekunden. Eintrag trotzdem anlegen?')) {
    save();
    renderAll();
    return;
  }

  const entry = { id: uid(), start: start.toISOString(), end: end.toISOString(), note, sent: false };
  state.entries.push(entry);
  save();
  renderAll();
  openSheet(entry.id, null, true);
}

const toggleTimer = () => (state.running ? stopTimer() : startTimer());

function tick() {
  if (!state.running) return;
  $('#clock').textContent = hms(runningSeconds());
  if (hasWage()) $('#clock-money').textContent = money(runningSeconds() / 60);
  paintQuickStats();
  paintWarnBanner();
  document.querySelectorAll('.entry.live .dur').forEach((n) => {
    n.textContent = hm(runningSeconds() / 60);
  });
}

/* ============================ eintrags-sheet ============================ */

function openSheet(id, preset, justStopped) {
  editingId = id || null;
  const e = id ? state.entries.find((x) => x.id === id) : null;

  $('#sheet-title').textContent = justStopped ? 'Zeit prüfen'
    : sendQueue.length ? `Noch ${sendQueue.length + 1} offen`
    : (e ? 'Eintrag' : 'Neuer Eintrag');
  $('#sheet-intro').classList.toggle('hidden', !justStopped);
  $('#sheet-delete').classList.toggle('hidden', !e);
  $('#toggle-sent').textContent = e && e.sent ? 'Markierung „gemeldet“ entfernen' : 'Als gemeldet markieren';
  $('#toggle-sent').classList.toggle('hidden', !e);

  if (e) {
    const s = new Date(e.start), en = new Date(e.end);
    $('#f-date').value = dayKey(s);
    $('#f-start').value = clock(s);
    $('#f-end').value = clock(en);
    $('#f-note').value = e.note || '';
  } else {
    const p = preset || {};
    const d = p.date || new Date();
    $('#f-date').value = dayKey(d);
    $('#f-start').value = p.start || '07:00';
    $('#f-end').value = p.end || '16:00';
    $('#f-note').value = p.note || '';
  }

  updatePreview();
  $('#sheet').classList.remove('hidden');
}

function hideSheet() {
  $('#sheet').classList.add('hidden');
  editingId = null;
}

/** Vom Nutzer abgebrochen: beendet auch eine laufende Melde-Reihe. */
function cancelSheet() {
  hideSheet();
  if (sendQueue.length) {
    sendQueue = [];
    onlyOpen = false;
    renderHistory();
    toast('Reihe abgebrochen');
  }
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
    $('#f-money').textContent = '–';
    $('#send-wa').disabled = true;
    return;
  }
  $('#send-wa').disabled = false;
  $('#msg-text').textContent = buildMessage(v.start.toISOString(), v.end.toISOString(), v.note);

  const r = reported(v.start.toISOString(), v.end.toISOString());
  $('#f-money').textContent = hasWage() ? money(r.min) : hm(r.min);

  const rawMin = (v.end - v.start) / 60000;
  const timesMoved = r.start.getTime() !== v.start.getTime() || r.end.getTime() !== v.end.getTime();
  $('#raw-note').textContent =
    timesMoved ? `gerundet · tatsächlich ${clock(v.start)} – ${clock(v.end)} (${hm(rawMin)} h)`
    : Math.abs(r.min - rawMin) > 0.001 ? `Dauer gerundet · tatsächlich ${hm(rawMin)} h`
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
    entry = { id: uid(), start: v.start.toISOString(), end: v.end.toISOString(), note: v.note, sent: false };
    state.entries.push(entry);
    editingId = entry.id;
  }
  save();
  renderAll();
  return entry;
}

function saveSheet() {
  if (!commitSheet()) return;
  hideSheet();
  toast('Gesichert');
}

function deleteEntry() {
  if (!editingId || !confirm('Diesen Eintrag löschen?')) return;
  state.entries = state.entries.filter((x) => x.id !== editingId);
  save();
  hideSheet();
  renderAll();
  toast('Gelöscht');
}

/* ============================ csv ============================ */

function buildCSV() {
  const rows = [['Datum', 'Beginn', 'Ende', 'Stunden', 'Stunden (h:mm)', 'Verdienst', 'Gemeldet', 'Notiz']];
  const sorted = [...state.entries].sort((a, b) => new Date(a.start) - new Date(b.start));
  let total = 0;

  for (const e of sorted) {
    const r = reported(e.start, e.end);
    const min = r.min;
    total += min;
    rows.push([
      fullDate(r.start),
      clock(r.start),
      clock(r.end),
      decHours(min),
      hm(min),
      hasWage() ? money(min) : '',
      e.sent ? 'ja' : 'nein',
      (e.note || '').replace(/[;\r\n]/g, ' ')
    ]);
  }

  rows.push([]);
  rows.push(['Summe', '', '', decHours(total), hm(total), hasWage() ? money(total) : '', '', '']);
  return rows.map((r) => r.join(';')).join('\r\n');
}

/** Zerlegt eine CSV-Zeile und respektiert Anfuehrungszeichen. */
function splitLine(line, d) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Raet das Trennzeichen: gleich viele Spalten in allen Zeilen gewinnt. */
function pickDelim(sample) {
  let best = ';', bestScore = -1;
  for (const d of [';', '\t', '|', ',']) {
    const counts = sample.map((l) => splitLine(l, d).length).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)];
    const steady = counts.filter((c) => c === median).length / counts.length;
    // Ein Trenner ueberzeugt, wenn er in den meisten Zeilen dieselbe Spaltenzahl liefert.
    const score = median > 1 ? median * 10 * steady : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function parseDate(s) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    return new Date(y, Number(m[2]) - 1, Number(m[1]));
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[.\/-](\d{1,2})\.?$/);
  if (m) return new Date(new Date().getFullYear(), Number(m[2]) - 1, Number(m[1]));
  return null;
}

/** Uhrzeit einer Von/Bis-Spalte -> Minuten seit Mitternacht. */
function parseClock(s) {
  const m = String(s || '').trim().match(/^(\d{1,2})[:.h](\d{2})(?::\d{2})?$/i);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** "07.05.26 16:30" oder "2026-05-07T16:30" -> {date, min}. */
function parseDateTime(s) {
  const m = String(s || '').trim().match(/^(.+?)[\s,T]+(\d{1,2}[:.h]\d{2}(?::\d{2})?)$/i);
  if (!m) return null;
  const d = parseDate(m[1]);
  const t = parseClock(m[2]);
  if (!d || t == null) return null;
  return { date: d, min: t };
}

/** Dauer-Spalte -> Minuten. Versteht "8:30", "8,5", "8.5", "8,5 h". */
function parseDuration(s) {
  const raw = String(s || '').trim().replace(/\s*(std\.?|stunden|hrs?|h)$/i, '').trim();
  if (!raw) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(raw.replace(',', '.'));
  if (!isFinite(n) || n < 0 || n > 24) return null;
  return Math.round(n * 60);
}

const HEADS = {
  date:  ['datum', 'tag', 'date', 'day'],
  start: ['beginn', 'anfang', 'von', 'start', 'kommen', 'clockedin', 'clockin', 'einstempeln'],
  end:   ['ende', 'bis', 'end', 'gehen', 'schluss', 'clockedout', 'clockout', 'ausstempeln'],
  hours: ['stunden', 'dauer', 'duration', 'arbeitszeit', 'worked', 'hours', 'summe', 'std'],
  rate:  ['stundenlohn', 'hourlyrate', 'lohn', 'satz', 'rate'],
  note:  ['notiz', 'kommentar', 'comment', 'bemerkung', 'note', 'tätigkeit', 'taetigkeit',
          'beschreibung', 'projekt', 'kunde', 'job', 'task']
};

const NO_COLS = { date: -1, start: -1, end: -1, hours: -1, rate: -1, note: -1 };

function findHeader(cells) {
  const cols = { ...NO_COLS };
  let hits = 0;
  cells.forEach((c, i) => {
    const v = c.toLowerCase().replace(/[^a-zäöüß]/g, '');
    for (const key of Object.keys(HEADS)) {
      if (cols[key] === -1 && HEADS[key].some((h) => v === h || v.startsWith(h))) {
        cols[key] = i; hits++; return;
      }
    }
  });
  return hits >= 2 ? cols : null;
}

/** Ohne Kopfzeile: Spalten am Inhalt der ersten brauchbaren Zeile erkennen. */
function guessColumns(rows) {
  const cols = { ...NO_COLS };
  for (const cells of rows) {
    const stamps = [], clocks = [];
    let dateCol = -1;
    cells.forEach((c, i) => {
      if (parseDateTime(c)) { stamps.push(i); return; }
      if (dateCol === -1 && parseDate(c)) { dateCol = i; return; }
      if (parseClock(c) != null) clocks.push(i);
    });

    if (stamps.length >= 2) { cols.start = stamps[0]; cols.end = stamps[1]; }
    else if (dateCol >= 0 && clocks.length >= 2) {
      cols.date = dateCol; cols.start = clocks[0]; cols.end = clocks[1];
    } else if (dateCol >= 0) {
      cols.date = dateCol;
      cells.forEach((c, i) => {
        if (i !== dateCol && cols.hours === -1 && parseDuration(c) != null) cols.hours = i;
      });
    } else continue;

    cells.forEach((c, i) => {
      if (cols.note === -1 && i !== cols.date && i !== cols.start && i !== cols.end &&
          i !== cols.hours && c && !/^[\d\s.,:\/-]+$/.test(c)) cols.note = i;
    });
    return cols;
  }
  return cols;
}

const at = (day, min) => { const x = new Date(day); x.setHours(0, min, 0, 0); return x; };

function rowToEntry(cells, cols) {
  // Beginn und Ende koennen als "07.05.26 16:30" in einer Zelle stehen
  const sStamp = cols.start >= 0 ? parseDateTime(cells[cols.start]) : null;
  const eStamp = cols.end >= 0 ? parseDateTime(cells[cols.end]) : null;

  const day = (cols.date >= 0 ? parseDate(cells[cols.date]) : null) ||
              (sStamp && sStamp.date) || (eStamp && eStamp.date);
  if (!day) return null;

  let sMin = sStamp ? sStamp.min : (cols.start >= 0 ? parseClock(cells[cols.start]) : null);
  let eMin = eStamp ? eStamp.min : (cols.end >= 0 ? parseClock(cells[cols.end]) : null);
  const dur = cols.hours >= 0 ? parseDuration(cells[cols.hours]) : null;

  if (sMin == null && eMin == null && dur == null) return null;
  if (sMin == null && eMin != null && dur != null) sMin = eMin - dur;
  if (sMin == null) sMin = 8 * 60;                 // Standard-Beginn, wenn nur Stunden bekannt sind
  if (eMin == null) {
    if (dur == null) return null;
    eMin = sMin + dur;
  }

  const start = at(sStamp ? sStamp.date : day, sMin);
  const end = at(eStamp ? eStamp.date : day, eMin);
  if (end <= start) end.setDate(end.getDate() + 1);

  const note = cols.note >= 0 ? String(cells[cols.note] || '').trim() : '';
  return { id: uid(), start: start.toISOString(), end: end.toISOString(), note, sent: true };
}

function parseImport(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
  if (!lines.length) return { entries: [], skipped: 0, total: 0, rate: null };

  // Excel-Exporte stellen gern eine Zeile "sep=," voran
  let forced = null;
  const sepLine = lines[0].match(/^sep\s*=\s*(.)$/i);
  if (sepLine) { forced = sepLine[1]; lines.shift(); }
  if (!lines.length) return { entries: [], skipped: 0, total: 0, rate: null };

  const delim = forced || pickDelim(lines.slice(0, Math.min(6, lines.length)));
  let rows = lines.map((l) => splitLine(l, delim));

  let cols = findHeader(rows[0]);
  if (cols) rows = rows.slice(1);
  else cols = guessColumns(rows);

  const entries = [];
  const rates = [];
  let skipped = 0;
  for (const cells of rows) {
    const e = rowToEntry(cells, cols);
    if (e) {
      entries.push(e);
      if (cols.rate >= 0) {
        const r = Number(String(cells[cols.rate] || '').replace(',', '.'));
        if (isFinite(r) && r > 0) rates.push(r);
      }
    } else skipped++;
  }

  // Stundenlohn nur anbieten, wenn die Datei sich einig ist
  const rate = rates.length && rates.every((r) => r === rates[0]) ? rates[0] : null;
  return { entries, skipped, total: rows.length, cols, delim, rate };
}

function openImportSheet(result) {
  pendingImport = result;
  const { entries, skipped, total } = result;

  $('#imp-summary').textContent = entries.length
    ? `${entries.length} von ${total} Zeilen erkannt. Vorschau der ersten Einträge:`
    : `Keine verwertbaren Zeilen gefunden (${total} geprüft). Schick mir ein paar Beispielzeilen, dann passe ich den Import an.`;

  const box = $('#imp-preview');
  box.textContent = '';
  entries.slice(0, 12).forEach((e) => {
    const row = el('div', 'improw');
    const s = new Date(e.start), en = new Date(e.end);
    row.appendChild(el('span', null, `${fullDate(s)}  ${clock(s)} – ${clock(en)}`));
    row.appendChild(el('span', 'dur', hm(entryMin(e))));
    box.appendChild(row);
  });
  if (entries.length > 12) {
    box.appendChild(el('div', 'improw', `… und ${entries.length - 12} weitere`));
  }

  const rateRow = $('#imp-rate-row');
  if (result.rate) {
    rateRow.classList.remove('hidden');
    $('#imp-rate-label').textContent =
      `Stundenlohn ${result.rate.toLocaleString('de-DE', { minimumFractionDigits: 2 })} € übernehmen`;
    $('#imp-rate').checked = !hasWage();
  } else {
    rateRow.classList.add('hidden');
  }

  $('#imp-skipped').textContent = skipped
    ? `${skipped} Zeile(n) übersprungen, weil kein Datum oder keine Zeiten erkennbar waren.`
    : '';
  $('#imp-add').disabled = !entries.length;
  $('#imp-replace').classList.toggle('hidden', !entries.length);
  $('#impsheet').classList.remove('hidden');
}

function dedupeKey(e) {
  const r = roundedRange(e.start, e.end);
  return r.start.getTime() + '|' + r.end.getTime();
}

function applyImport(replace) {
  if (!pendingImport || !pendingImport.entries.length) return;
  const incoming = pendingImport.entries;

  if (pendingImport.rate && $('#imp-rate').checked) {
    state.settings.wage = pendingImport.rate;
  }

  if (replace) {
    if (!confirm(`Alle ${state.entries.length} vorhandenen Einträge löschen und durch ${incoming.length} ersetzen?`)) return;
    state.entries = incoming;
  } else {
    // Ueber die gerundeten Zeiten vergleichen: der CSV-Export enthaelt nur diese,
    // ein Rueckimport wuerde sonst alles doppelt anlegen.
    const known = new Set(state.entries.map(dedupeKey));
    let added = 0, dupes = 0;
    for (const e of incoming) {
      const k = dedupeKey(e);
      if (known.has(k)) { dupes++; continue; }
      known.add(k);
      state.entries.push(e);
      added++;
    }
    toast(dupes ? `${added} hinzugefügt, ${dupes} Dubletten übersprungen` : `${added} Einträge hinzugefügt`);
  }

  save();
  pendingImport = null;
  $('#impsheet').classList.add('hidden');
  renderAll();
  if (replace) toast(`${state.entries.length} Einträge importiert`);
}

/* ============================ export / backup ============================ */

function openExport(title, text, filename, mime, isBackup) {
  lastExport = { text, filename, mime, isBackup: !!isBackup };
  $('#ex-title').textContent = title;
  $('#ex-text').value = text;
  $('#ex-hint').textContent = isBackup
    ? 'Auf „Teilen“ tippen, dann „In Dateien sichern“ und iCloud Drive wählen. Dort holst du die Datei später über „Backup einspielen“ wieder.'
    : 'Über „Teilen“ als Datei sichern, oder den Text kopieren.';
  $('#exsheet').classList.remove('hidden');

  $('#ex-share').onclick = async () => {
    const file = new File([text], filename, { type: mime });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        if (isBackup) markBackupDone();
        return;
      }
      if (navigator.share) {
        await navigator.share({ title, text });
        if (isBackup) markBackupDone();
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (isBackup) markBackupDone();
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
    entries: data.entries.filter((e) => e && e.start && e.end).map((e) => ({ sent: false, ...e })),
    running: data.running && data.running.start ? data.running : null,
    settings: Object.assign(clone(DEFAULTS.settings), data.settings || {})
  };
  backupDismissed = true;
  save();
  renderAll();
  toast('Backup eingespielt');
}

/* ============================ vorlage ============================ */

function insertPlaceholder(ph) {
  const t = $('#set-template');
  const a = t.selectionStart != null ? t.selectionStart : t.value.length;
  const b = t.selectionEnd != null ? t.selectionEnd : t.value.length;
  t.value = t.value.slice(0, a) + ph + t.value.slice(b);
  const pos = a + ph.length;
  t.setSelectionRange(pos, pos);
  state.settings.template = t.value;
  save();
  renderSettings();
  t.focus();
}

/* ============================ url-aktionen ============================ */

function handleUrlAction() {
  const a = new URLSearchParams(location.search).get('a');
  if (!a) return;
  history.replaceState(null, '', location.pathname);
  if (a === 'start') startTimer();
  else if (a === 'stop') stopTimer();
  else if (a === 'toggle') toggleTimer();
}

const actionUrl = (a) => location.origin + location.pathname + '?a=' + a;

/* ============================ ui ============================ */

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}

function showView(name) {
  ['timer', 'history', 'settings'].forEach((v) =>
    $('#view-' + v).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === name));
  window.scrollTo(0, 0);
}

function anySheetOpen() {
  return ['#sheet', '#exsheet', '#impsheet'].some((s) => !$(s).classList.contains('hidden'));
}

function bind() {
  $('#toggle-btn').addEventListener('click', toggleTimer);
  $('#running-note').addEventListener('input', (ev) => {
    if (state.running) { state.running.note = ev.target.value.trim(); save(); }
  });

  $('#backup-now').addEventListener('click', () => {
    showView('settings');
    $('#export-json').click();
  });
  $('#backup-later').addEventListener('click', () => {
    backupDismissed = true;
    paintBackupBanner();
  });

  $('#set-backup-days').addEventListener('change', (ev) => {
    state.settings.backupDays = Number(ev.target.value) || 0;
    backupDismissed = false;
    save();
    renderTimer();
    renderSettings();
  });

  $('#forgot-stop').addEventListener('click', stopTimer);
  $('#forgot-ignore').addEventListener('click', () => {
    warnDismissed = true;
    paintWarnBanner();
  });

  document.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => showView(b.dataset.view)));

  document.querySelectorAll('#period-seg button').forEach((b) =>
    b.addEventListener('click', () => {
      period = b.dataset.p;
      periodOffset = 0;
      onlyOpen = false;
      renderHistory();
    }));
  $('#open-hint').addEventListener('click', () => { onlyOpen = !onlyOpen; renderHistory(); });
  $('#send-all').addEventListener('click', sendAllOpen);
  $('#send-each').addEventListener('click', startQueue);

  $('#per-prev').addEventListener('click', () => { periodOffset--; renderHistory(); });
  $('#per-next').addEventListener('click', () => {
    if (periodOffset < 0) { periodOffset++; renderHistory(); }
  });

  $('#add-today').addEventListener('click', () => openSheet(null, { date: new Date() }));
  $('#add-any').addEventListener('click', () =>
    openSheet(null, { date: periodRange(period, periodOffset).from }));
  $('#add-like-last').addEventListener('click', () => {
    const e = lastEntry();
    if (!e) { toast('Noch kein Eintrag vorhanden'); return; }
    openSheet(null, {
      date: new Date(),
      start: clock(new Date(e.start)),
      end: clock(new Date(e.end)),
      note: e.note || ''
    });
  });

  $('#sheet-save').addEventListener('click', saveSheet);
  $('#sheet-delete').addEventListener('click', deleteEntry);
  document.querySelectorAll('[data-close]').forEach((n) =>
    n.addEventListener('click', () => cancelSheet()));
  ['#f-date', '#f-start', '#f-end', '#f-note'].forEach((sel) => {
    $(sel).addEventListener('input', updatePreview);
    $(sel).addEventListener('change', updatePreview);
  });

  $('#send-wa').addEventListener('click', () => {
    const entry = commitSheet();
    if (!entry) return;
    entry.sent = true;
    save();
    renderAll();
    const text = buildMessage(entry.start, entry.end, entry.note);
    hideSheet();
    sendWhatsApp(text);
  });

  $('#copy-msg').addEventListener('click', () => {
    const v = readSheet();
    if (!v) { toast('Bitte Datum und Zeiten ausfüllen'); return; }
    copyText(buildMessage(v.start.toISOString(), v.end.toISOString(), v.note), 'Nachricht kopiert');
  });

  $('#toggle-sent').addEventListener('click', () => {
    const e = state.entries.find((x) => x.id === editingId);
    if (!e) return;
    e.sent = !e.sent;
    save();
    renderAll();
    $('#toggle-sent').textContent = e.sent ? 'Markierung „gemeldet“ entfernen' : 'Als gemeldet markieren';
    toast(e.sent ? 'Als gemeldet markiert' : 'Markierung entfernt');
  });

  document.querySelectorAll('[data-exclose]').forEach((n) =>
    n.addEventListener('click', () => $('#exsheet').classList.add('hidden')));
  document.querySelectorAll('[data-impclose]').forEach((n) =>
    n.addEventListener('click', () => {
      pendingImport = null;
      $('#impsheet').classList.add('hidden');
    }));
  $('#ex-copy').addEventListener('click', async () => {
    await copyText(lastExport ? lastExport.text : $('#ex-text').value);
    if (lastExport && lastExport.isBackup) markBackupDone();
  });

  $('#set-wage').addEventListener('change', (ev) => {
    const v = Number(String(ev.target.value).replace(',', '.'));
    state.settings.wage = isFinite(v) && v > 0 ? v : 0;
    ev.target.value = state.settings.wage || '';
    save();
    renderAll();
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
  $('#set-roundtarget').addEventListener('change', (ev) => {
    state.settings.roundTarget = ev.target.value;
    save();
    renderAll();
  });
  $('#set-warn').addEventListener('change', (ev) => {
    state.settings.warnHours = Number(ev.target.value) || 0;
    warnDismissed = false;
    save();
    renderTimer();
  });
  $('#set-template').addEventListener('input', (ev) => {
    state.settings.template = ev.target.value;
    save();
    $('#tpl-preview').textContent = buildMessage(
      new Date(startOfDay(new Date()).getTime() + (7 * 60 + 3) * 60000).toISOString(),
      new Date(startOfDay(new Date()).getTime() + (16 * 60 + 7) * 60000).toISOString(),
      'Beispielnotiz'
    );
  });
  $('#tpl-reset').addEventListener('click', () => {
    state.settings.template = DEFAULT_TEMPLATE;
    save();
    renderSettings();
    toast('Vorlage zurückgesetzt');
  });

  $('#copy-start-url').addEventListener('click', () => copyText(actionUrl('start'), 'Start-Adresse kopiert'));
  $('#copy-stop-url').addEventListener('click', () => copyText(actionUrl('stop'), 'Stopp-Adresse kopiert'));

  $('#export-csv').addEventListener('click', () => {
    if (!state.entries.length) { toast('Noch nichts zu exportieren'); return; }
    openExport('CSV-Export', buildCSV(), `stunden-${dayKey(new Date())}.csv`, 'text/csv');
  });
  $('#export-json').addEventListener('click', () =>
    openExport('Backup', JSON.stringify(state, null, 2),
      `stunden-backup-${dayKey(new Date())}.json`, 'application/json', true));

  $('#import-json').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => importJSON(String(r.result));
    r.readAsText(f);
    ev.target.value = '';
  });

  $('#import-csv').addEventListener('click', () => $('#csv-file').click());
  $('#csv-file').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => openImportSheet(parseImport(String(r.result)));
    r.readAsText(f, 'utf-8');
    ev.target.value = '';
  });
  $('#imp-add').addEventListener('click', () => applyImport(false));
  $('#imp-replace').addEventListener('click', () => applyImport(true));

  $('#wipe').addEventListener('click', () => {
    if (!confirm('Wirklich alle Einträge und Einstellungen löschen?')) return;
    if (!confirm('Letzte Warnung, das lässt sich nicht rückgängig machen.')) return;
    state = clone(DEFAULTS);
    save();
    renderAll();
    toast('Alles gelöscht');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden || anySheetOpen()) return;
    state = load();
    renderAll();
    if (sendQueue.length) nextInQueue();
  });
}

/* ============================ start ============================ */

bind();
if (state.running && state.running.note) $('#running-note').value = state.running.note;
renderAll();
handleUrlAction();
setInterval(tick, 1000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW', err));
  });
}
