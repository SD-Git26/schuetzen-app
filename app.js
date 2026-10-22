'use strict';

// ---------- Daten ----------

const STORAGE_KEY = 'schuetzen-app-v1';
const TREND_WINDOW = 5;

const DEFAULT_DISCIPLINES = [
  ['Pistole', false],
  ['Luftgewehr', true],
  ['Luftpistole', true],
  ['KK-Gewehr', true],
  ['Sportpistole', false],
];

const DEFAULT_COMPETITION_TYPES = [
  'Vereinsmeisterschaft',
  'Kreismeisterschaft',
  'Bezirksmeisterschaft',
  'Landesmeisterschaft',
  'Deutsche Meisterschaft',
  'Liga-Wettkampf',
  'Pokalschießen',
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function newDiscipline(name, decimal) {
  return { id: uid(), name, series: 3, shots: 10, decimal };
}

function defaultState() {
  return normalizeState({
    version: 1,
    disciplines: DEFAULT_DISCIPLINES.map(([name, decimal]) => newDiscipline(name, decimal)),
    results: [],
  });
}

function isValidState(s) {
  return s && Array.isArray(s.disciplines) && Array.isArray(s.results);
}

// Ergänzt fehlende Felder (z. B. aus älteren Backups)
function normalizeState(s) {
  if (!s.disciplines.some(d => d.id === s.defaultDisciplineId)) {
    const lp = s.disciplines.find(d => d.name === 'Luftpistole');
    s.defaultDisciplineId = lp ? lp.id : (s.disciplines[0] ? s.disciplines[0].id : null);
  }
  delete s.lastDisciplineId;
  if (!Array.isArray(s.competitionTypes)) {
    s.competitionTypes = DEFAULT_COMPETITION_TYPES.map(name => ({ id: uid(), name }));
  }
  // Ältere Einträge ohne Angabe gelten als Training
  s.results.forEach(r => { if (r.type !== 'competition') { r.type = 'training'; r.competition = null; } });
  return s;
}

function compTypeById(id) {
  return state.competitionTypes.find(c => c.id === id) || null;
}

// Angaben zu einem Wettkampf, z. B. "Kreismeisterschaft · Musterstadt" (neben dem Wettkampf-Etikett)
function competitionLabel(r) {
  if (r.type !== 'competition') return '';
  const c = r.competition || {};
  const t = compTypeById(c.typeId);
  return [t ? t.name : '', c.location].filter(Boolean).join(' · ');
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (isValidState(s)) {
        const migrate = !Array.isArray(s.competitionTypes);
        normalizeState(s);
        // Ergänzte Felder gleich speichern, damit sie beim nächsten Start gleich bleiben
        if (migrate) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
        return s;
      }
    }
  } catch (e) { /* Speicher nicht verfügbar – mit Standardwerten starten */ }
  return defaultState();
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Speichern fehlgeschlagen – bitte Backup exportieren!');
  }
}

// ---------- Design (hell/dunkel) ----------

// Eigener Schlüssel, damit ein Backup-Import das Design nicht überschreibt
const THEME_KEY = 'schuetzen-theme';

// Standard ist Dunkel
function loadTheme() {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch (e) { return 'dark'; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // Farbe der Statusleiste anpassen
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#12161c' : '#f4f6f9';
}

function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) { /* Design gilt dann nur bis zum Schließen */ }
  applyTheme(theme);
}

applyTheme(loadTheme());

// Browser bitten, die Daten nicht automatisch zu löschen
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

function discById(id) {
  return state.disciplines.find(d => d.id === id) || null;
}

function shotMax(d) { return d.decimal ? 10.9 : 10; }
function seriesMax(d) { return round1(d.shots * shotMax(d)); }
function totalMax(d) { return round1(d.series * seriesMax(d)); }

function sortedResults(list) {
  return list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
}

// ---------- Hilfsfunktionen ----------

function round1(n) { return Math.round(n * 10) / 10; }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n, digits) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

function fmtScore(n, d) { return fmt(n, d && d.decimal ? 1 : 0); }
function fmtAvg(n, d) { return fmt(n, d && d.decimal ? 2 : 1); }

function parseNum(str) {
  const t = String(str).trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDate(s) {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y}`;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function scoreError(value, max, d) {
  if (value === null) return null;
  if (Number.isNaN(value)) return 'Keine gültige Zahl';
  if (value < 0 || value > max) return `Erlaubt: 0 bis ${fmtScore(max, d)}`;
  if (!d.decimal && !Number.isInteger(value)) return 'Diese Disziplin wird in ganzen Ringen gewertet';
  if (d.decimal && Math.abs(value * 10 - Math.round(value * 10)) > 1e-9) return 'Höchstens eine Nachkommastelle';
  return null;
}

// Gültige Eingabe einheitlich darstellen, z. B. "98" → "98,0" bei Zehntelwertung
function formatInput(str, max, d) {
  const n = parseNum(str);
  if (n === null || scoreError(n, max, d)) return str;
  return fmtScore(n, d);
}

// Nur Ziffern tippen, die letzte Ziffer ist die Zehntelstelle: "9" → "0,9", "98" → "9,8", "980" → "98,0"
function autoComma(str) {
  const digits = String(str).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits === '') return '';
  if (digits.length === 1) return '0,' + digits;
  return digits.slice(0, -1) + ',' + digits.slice(-1);
}

// Eigenes Bestätigungsfenster statt confirm(): Das Browser-Fenster wird in manchen
// Umgebungen (z. B. eingebettete Browser) unterdrückt und liefert dann immer "Abbrechen".
function askConfirm(message, okLabel = 'Löschen') {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    const [title, ...rest] = message.split('\n\n');
    dlg.innerHTML = `
      <p class="confirm-title">${esc(title)}</p>
      ${rest.map(p => `<p class="confirm-text">${esc(p)}</p>`).join('')}
      <div class="actions">
        <button type="button" class="btn" data-answer="no">Abbrechen</button>
        <button type="button" class="btn ${okLabel === 'Löschen' ? 'danger-fill' : 'primary'}" data-answer="yes">${esc(okLabel)}</button>
      </div>`;
    const finish = answer => { dlg.close(); dlg.remove(); resolve(answer); };
    dlg.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => finish(b.dataset.answer === 'yes'));
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(false); }); // Zurück-Taste / Esc
    dlg.addEventListener('click', e => { if (e.target === dlg) finish(false); });  // Tipp neben das Fenster
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Navigation ----------

const TITLES = { entry: 'Eintrag', history: 'Verlauf', analysis: 'Analyse', options: 'Optionen' };

const ui = {
  tab: 'entry',
  draft: null,          // Formular "Eintragen"
  editId: null,         // Ergebnis, das gerade bearbeitet wird
  historyFilter: 'all',
  analysisDiscId: null,
  period: 'all',
  kind: 'all',          // Analyse: alle, nur Training oder nur Wettkampf
  selectedPoint: null,
  lines: { data: true, trend: true }, // sichtbare Linien im Ergebnisverlauf
  editDiscId: null,     // Disziplin, die gerade bearbeitet wird ('new' = neue)
  editCompId: null,     // Wettkampfart, die gerade umbenannt wird
  openSections: new Set(), // aufgeklappte Bereiche in den Optionen
};

const view = document.getElementById('view');

function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tabbar button').forEach(b => {
  b.addEventListener('click', () => {
    if (b.dataset.tab !== 'entry' && ui.editId) { ui.editId = null; ui.draft = null; }
    setTab(b.dataset.tab);
  });
});

function render() {
  const title = ui.tab === 'entry' && ui.editId ? 'Ergebnis bearbeiten' : TITLES[ui.tab];
  document.getElementById('title').textContent = title;
  ({ entry: renderEntry, history: renderHistory, analysis: renderAnalysis, options: renderOptions })[ui.tab]();
}

// ---------- Eintragen ----------

// Bisher eingetragene Wettkampforte als Vorschläge
function knownLocations() {
  const set = new Set();
  state.results.forEach(r => { if (r.competition && r.competition.location) set.add(r.competition.location); });
  return [...set].sort((a, b) => a.localeCompare(b, 'de'));
}

function freshDraft() {
  const d = discById(state.defaultDisciplineId) || state.disciplines[0];
  return {
    disciplineId: d ? d.id : null,
    date: todayISO(),
    totalOnly: false,
    series: d ? Array(d.series).fill('') : [],
    total: '',
    note: '',
    isComp: false, // Standard ist Training
    compTypeId: '',
    location: '',
  };
}

function draftFromResult(r) {
  const d = discById(r.disciplineId);
  const hasSeries = Array.isArray(r.series) && r.series.length > 0;
  return {
    disciplineId: r.disciplineId,
    date: r.date,
    totalOnly: !hasSeries,
    series: hasSeries ? r.series.map(v => fmtScore(v, d)) : Array(d ? d.series : 0).fill(''),
    total: fmtScore(r.total, d),
    note: r.note || '',
    isComp: r.type === 'competition',
    compTypeId: (r.competition && compTypeById(r.competition.typeId)) ? r.competition.typeId : '',
    location: (r.competition && r.competition.location) || '',
  };
}

function renderEntry() {
  if (state.disciplines.length === 0) {
    view.innerHTML = `<div class="card empty">Noch keine Disziplin angelegt.<br><br>
      <button class="btn primary" id="go-options">Zu den Optionen</button></div>`;
    document.getElementById('go-options').onclick = () => setTab('options');
    return;
  }

  if (!ui.draft || !discById(ui.draft.disciplineId)) ui.draft = freshDraft();
  const dr = ui.draft;
  const d = discById(dr.disciplineId);

  // Serienanzahl an Disziplin anpassen (bestehende Eingaben bleiben erhalten)
  if (dr.series.length !== d.series) {
    dr.series = Array.from({ length: d.series }, (_, i) => dr.series[i] || '');
  }

  const options = state.disciplines.map(x =>
    `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');

  const seriesInputs = dr.series.map((v, i) => `
    <div>
      <label for="s${i}">Serie ${i + 1}</label>
      <input id="s${i}" data-series="${i}" inputmode="${d.decimal ? 'numeric' : 'decimal'}" autocomplete="off" value="${esc(v)}" placeholder="${fmtScore(0, d)}">
    </div>`).join('');

  view.innerHTML = `
    <div class="card">
      <div class="row">
        <div class="field">
          <label for="disc">Disziplin</label>
          <select id="disc">${options}</select>
        </div>
        <div class="field">
          <label for="date">Datum</label>
          <input id="date" type="date" value="${dr.date}" max="${todayISO()}">
        </div>
      </div>
      <p class="hint" style="margin:-6px 0 14px">${d.series} × ${d.shots} Schuss · ${d.decimal ? 'Zehntelwertung' : 'Ganze Ringe'} · max. ${fmtScore(totalMax(d), d)}</p>

      ${dr.totalOnly ? `
        <div class="field">
          <label for="total">Gesamtergebnis</label>
          <input id="total" inputmode="${d.decimal ? 'numeric' : 'decimal'}" autocomplete="off" value="${esc(dr.total)}" placeholder="${fmtScore(0, d)}" style="font-size:22px;font-weight:700">
        </div>` : `
        <div class="series-grid" style="grid-template-columns:repeat(${d.series <= 4 ? d.series : (d.series % 4 === 0 ? 4 : 3)}, 1fr)">${seriesInputs}</div>
        <div class="sum-line"><span class="label">Gesamt</span><span class="sum" id="sum">–</span></div>`}

      <label class="switch subtle">
        <input type="checkbox" id="total-only" ${dr.totalOnly ? 'checked' : ''}>
        <span>Nur Gesamtergebnis eintragen</span>
      </label>

      <div id="entry-error" class="error" hidden></div>

      <div class="comp-box ${dr.isComp ? 'open' : ''}">
        <div class="comp-toggle">
          <input type="checkbox" id="is-comp" aria-label="Wettkampf" ${dr.isComp ? 'checked' : ''}>
          <span>Wettkampf</span>
        </div>
        ${dr.isComp ? `
        <div class="comp-fields">
          <div class="field">
            <label for="comp-type">Art</label>
            <select id="comp-type">
              <option value="">– ohne Angabe –</option>
              ${state.competitionTypes.map(c => `<option value="${c.id}" ${c.id === dr.compTypeId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="comp-location">Ort</label>
            <input id="comp-location" list="known-locations" autocomplete="off" value="${esc(dr.location)}" placeholder="z. B. Schützenhaus Musterstadt" maxlength="80">
            <datalist id="known-locations">${knownLocations().map(l => `<option value="${esc(l)}">`).join('')}</datalist>
          </div>
        </div>` : ''}
      </div>

      <div class="field note-field">
        <label for="note">Notiz</label>
        <textarea id="note" rows="1" placeholder="optional">${esc(dr.note)}</textarea>
      </div>

      <div class="actions">
        ${ui.editId ? '<button class="btn" id="cancel">Abbrechen</button>' : ''}
        <button class="btn primary" id="save">${ui.editId ? 'Änderungen speichern' : 'Speichern'}</button>
      </div>
    </div>`;

  const errorEl = document.getElementById('entry-error');

  function validate(showAll) {
    let firstError = null;
    if (dr.totalOnly) {
      const el = document.getElementById('total');
      const err = scoreError(parseNum(dr.total), totalMax(d), d);
      el.classList.toggle('invalid', !!err);
      firstError = err;
    } else {
      dr.series.forEach((v, i) => {
        const err = scoreError(parseNum(v), seriesMax(d), d);
        document.getElementById('s' + i).classList.toggle('invalid', !!err);
        if (err && !firstError) firstError = `Serie ${i + 1}: ${err}`;
      });
      const nums = dr.series.map(parseNum);
      const sumEl = document.getElementById('sum');
      const valid = nums.filter(n => n !== null && !Number.isNaN(n));
      sumEl.textContent = valid.length ? fmtScore(round1(valid.reduce((a, b) => a + b, 0)), d) : '–';
    }
    if (showAll || firstError) {
      errorEl.hidden = !firstError;
      errorEl.textContent = firstError || '';
    } else {
      errorEl.hidden = true;
    }
    return firstError;
  }

  validate(false);

  document.getElementById('disc').onchange = e => {
    dr.disciplineId = e.target.value;
    render();
  };
  document.getElementById('date').oninput = e => { dr.date = e.target.value; };
  // Notizfeld wächst mit dem Text mit
  const noteEl = document.getElementById('note');
  const fitNote = () => { noteEl.style.height = 'auto'; noteEl.style.height = noteEl.scrollHeight + 2 + 'px'; };
  noteEl.oninput = () => { dr.note = noteEl.value; fitNote(); };
  if (dr.note) fitNote();
  document.getElementById('total-only').onchange = e => { dr.totalOnly = e.target.checked; render(); };
  document.getElementById('is-comp').onchange = e => { dr.isComp = e.target.checked; render(); };
  if (dr.isComp) {
    document.getElementById('comp-type').onchange = e => { dr.compTypeId = e.target.value; };
    document.getElementById('comp-location').oninput = e => { dr.location = e.target.value; };
  }

  // Bei Zehntelwertung setzt die App das Komma selbst: "1014" → "101,4"
  function readInput(el) {
    if (d.decimal) el.value = autoComma(el.value);
    return el.value;
  }

  if (dr.totalOnly) {
    const totalEl = document.getElementById('total');
    totalEl.oninput = () => { dr.total = readInput(totalEl); validate(false); };
    totalEl.onblur = () => { dr.total = totalEl.value = formatInput(totalEl.value, totalMax(d), d); validate(false); };
  } else {
    view.querySelectorAll('[data-series]').forEach(el => {
      el.oninput = () => { dr.series[+el.dataset.series] = readInput(el); validate(false); };
      el.onblur = () => { dr.series[+el.dataset.series] = el.value = formatInput(el.value, seriesMax(d), d); validate(false); };
      el.onkeydown = e => {
        if (e.key === 'Enter') {
          const next = document.getElementById('s' + (+el.dataset.series + 1));
          if (next) { e.preventDefault(); next.focus(); }
        }
      };
    });
  }

  if (ui.editId) {
    document.getElementById('cancel').onclick = () => {
      ui.editId = null;
      ui.draft = null;
      setTab('history');
    };
  }

  document.getElementById('save').onclick = () => {
    if (validate(true)) return;
    if (!dr.date) { errorEl.hidden = false; errorEl.textContent = 'Bitte ein Datum wählen'; return; }

    let series = null;
    let total;
    if (dr.totalOnly) {
      total = parseNum(dr.total);
      if (total === null) { errorEl.hidden = false; errorEl.textContent = 'Bitte ein Ergebnis eintragen'; return; }
    } else {
      const nums = dr.series.map(parseNum);
      if (nums.some(n => n === null)) { errorEl.hidden = false; errorEl.textContent = 'Bitte alle Serien ausfüllen (oder „Nur Gesamtergebnis“ wählen)'; return; }
      series = nums;
      total = round1(nums.reduce((a, b) => a + b, 0));
    }

    const fields = {
      disciplineId: d.id,
      date: dr.date,
      series,
      total,
      note: dr.note.trim(),
      type: dr.isComp ? 'competition' : 'training',
      competition: dr.isComp ? { typeId: dr.compTypeId || null, location: dr.location.trim() } : null,
    };
    if (ui.editId) {
      const r = state.results.find(x => x.id === ui.editId);
      if (r) Object.assign(r, fields);
      toast('Änderungen gespeichert');
    } else {
      state.results.push({ id: uid(), ...fields, createdAt: Date.now() });
      toast(`${fmtScore(total, d)} Ringe gespeichert${dr.isComp ? ' (Wettkampf)' : ''}`);
    }
    saveState();

    const wasEdit = !!ui.editId;
    ui.editId = null;
    ui.draft = null;
    if (wasEdit) setTab('history'); else render();
  };
}

// ---------- Verlauf ----------

function renderHistory() {
  const filterOpts = ['<option value="all">Alle Disziplinen</option>']
    .concat(state.disciplines.map(d => `<option value="${d.id}" ${ui.historyFilter === d.id ? 'selected' : ''}>${esc(d.name)}</option>`))
    .join('');

  let list = state.results;
  if (ui.historyFilter !== 'all') list = list.filter(r => r.disciplineId === ui.historyFilter);
  list = sortedResults(list).reverse();

  let body = '';
  if (list.length === 0) {
    body = `<div class="card empty">Noch keine Ergebnisse${ui.historyFilter !== 'all' ? ' für diese Disziplin' : ''}.</div>`;
  } else {
    let currentMonth = null;
    let group = '';
    const flush = () => { if (group) body += `<div class="card">${group}</div>`; group = ''; };
    for (const r of list) {
      const month = r.date.slice(0, 7);
      if (month !== currentMonth) {
        flush();
        currentMonth = month;
        const dt = parseISO(r.date);
        body += `<div class="month-label">${MONTHS[dt.getMonth()]} ${dt.getFullYear()}</div>`;
      }
      const d = discById(r.disciplineId);
      group += `
        <div class="result-item">
          <div class="result-main">
            <div class="result-meta">${fmtDate(r.date)} · ${esc(d ? d.name : 'Gelöschte Disziplin')}</div>
            ${r.type === 'competition' ? `<div class="result-comp"><span class="tag-comp">Wettkampf</span> ${esc(competitionLabel(r))}</div>` : ''}
            ${r.series ? `<div class="result-series">${r.series.map(v => fmtScore(v, d)).join(' · ')}</div>` : ''}
            ${r.note ? `<div class="result-note">${esc(r.note)}</div>` : ''}
            <div class="result-buttons">
              <button class="btn small" data-edit="${r.id}">Bearbeiten</button>
              <button class="btn small danger" data-del="${r.id}">Löschen</button>
            </div>
          </div>
          <div class="result-total">${fmtScore(r.total, d)}</div>
        </div>`;
    }
    flush();
  }

  view.innerHTML = `
    <div class="field"><select id="hist-filter" aria-label="Disziplin filtern">${filterOpts}</select></div>
    ${body}`;

  document.getElementById('hist-filter').onchange = e => { ui.historyFilter = e.target.value; render(); };

  view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
    const r = state.results.find(x => x.id === b.dataset.edit);
    if (!r || !discById(r.disciplineId)) return;
    ui.editId = r.id;
    ui.draft = draftFromResult(r);
    setTab('entry');
  });

  view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const r = state.results.find(x => x.id === b.dataset.del);
    if (!r) return;
    if (!(await askConfirm(`Ergebnis vom ${fmtDate(r.date)} (${fmtScore(r.total, discById(r.disciplineId))}) wirklich löschen?`))) return;
    state.results = state.results.filter(x => x.id !== r.id);
    saveState();
    render();
    toast('Ergebnis gelöscht');
  });
}

// ---------- Analyse ----------

const KINDS = [['all', 'Alle'], ['training', 'Training'], ['competition', 'Wettkampf']];

const PERIODS = [['3m', '3 Monate', 3], ['6m', '6 Monate', 6], ['1y', '1 Jahr', 12], ['all', 'Alles', null]];

function periodStart(key) {
  const p = PERIODS.find(x => x[0] === key);
  if (!p || p[2] === null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - p[2]);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function movingAverage(values, k) {
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - k + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function renderAnalysis() {
  if (state.disciplines.length === 0) {
    view.innerHTML = '<div class="card empty">Noch keine Disziplin angelegt.</div>';
    return;
  }
  if (!discById(ui.analysisDiscId)) {
    ui.analysisDiscId = (discById(state.defaultDisciplineId) || state.disciplines[0]).id;
  }
  const d = discById(ui.analysisDiscId);
  const start = periodStart(ui.period);
  const all = sortedResults(state.results.filter(r => r.disciplineId === d.id));
  const list = (start ? all.filter(r => r.date >= start) : all)
    .filter(r => ui.kind === 'all' || r.type === ui.kind);

  const discOpts = state.disciplines.map(x =>
    `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const chips = PERIODS.map(([key, label]) =>
    `<button class="chip ${ui.period === key ? 'active' : ''}" data-period="${key}">${label}</button>`).join('');
  const kindChips = KINDS.map(([key, label]) =>
    `<button class="chip ${ui.kind === key ? 'active' : ''}" data-kind="${key}">${label}</button>`).join('');

  let content;
  if (list.length === 0) {
    const what = ui.kind === 'competition' ? 'Wettkampfergebnisse' : ui.kind === 'training' ? 'Trainingsergebnisse' : 'Ergebnisse';
    content = `<div class="card empty">Keine ${what} für ${esc(d.name)} in diesem Zeitraum.</div>`;
  } else {
    const totals = list.map(r => r.total);
    const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
    const best = list.reduce((a, b) => (b.total > a.total ? b : a));
    const last10 = totals.slice(-10);
    const avg10 = last10.reduce((a, b) => a + b, 0) / last10.length;
    const delta = avg10 - avg;
    const deltaCls = delta > 0.005 ? 'pos' : delta < -0.005 ? 'neg' : '';
    const deltaTxt = list.length > 10
      ? `${delta >= 0 ? '+' : '−'}${fmtAvg(Math.abs(delta), d)} zum Schnitt`
      : 'weniger als 10 Einträge';

    content = `
      <div class="tiles">
        <div class="tile"><div class="label">Bestwert</div><div class="value">${fmtScore(best.total, d)}</div><div class="sub">${fmtDate(best.date)}</div></div>
        <div class="tile"><div class="label">Durchschnitt</div><div class="value">${fmtAvg(avg, d)}</div><div class="sub">von max. ${fmtScore(totalMax(d), d)}</div></div>
        <div class="tile"><div class="label">Ø letzte 10</div><div class="value">${fmtAvg(avg10, d)}</div><div class="sub ${list.length > 10 ? deltaCls : ''}">${deltaTxt}</div></div>
        <div class="tile"><div class="label">Einträge</div><div class="value">${list.length}</div><div class="sub">${fmtDate(list[0].date)} – ${fmtDate(list[list.length - 1].date)}</div></div>
      </div>

      <div class="card">
        ${cardHead('Ergebnisverlauf', `Jeder blaue Punkt ist ein Ergebnis – links die ältesten, rechts die neuesten.
          Die orange Trendlinie ist der Durchschnitt deiner jeweils letzten ${TREND_WINDOW} Ergebnisse. Sie glättet Ausreißer
          und zeigt, ob du dich insgesamt verbesserst. Hohle Kreise sind Wettkämpfe, volle Punkte Trainings.
          Über die Schalter darunter blendest du Linien ein und aus. Tippe in das Chart, um Details zu einem Ergebnis zu sehen.`)}
        <div class="legend">
          <button type="button" class="legend-toggle" data-line="data" aria-pressed="${ui.lines.data}"><i style="background:var(--series-1)"></i>Ergebnis</button>
          <button type="button" class="legend-toggle" data-line="trend" aria-pressed="${ui.lines.trend}"><i style="background:var(--series-2)"></i>Trend (Ø der letzten ${TREND_WINDOW})</button>
        </div>
        <div class="chart" id="chart"></div>
        <div class="chart-info" id="chart-info">Tippe auf einen Punkt für Details.</div>
      </div>

      ${renderSeriesAnalysis(list, d)}`;
  }

  view.innerHTML = `
    <div class="field"><select id="ana-disc" aria-label="Disziplin">${discOpts}</select></div>
    <div class="chips">${chips}</div>
    <div class="chips">${kindChips}</div>
    ${content}`;

  view.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { ui.kind = b.dataset.kind; ui.selectedPoint = null; render(); });

  document.getElementById('ana-disc').onchange = e => { ui.analysisDiscId = e.target.value; ui.selectedPoint = null; render(); };
  view.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { ui.period = b.dataset.period; ui.selectedPoint = null; render(); });

  view.querySelectorAll('[data-line]').forEach(b => b.onclick = () => {
    const key = b.dataset.line;
    const other = key === 'data' ? 'trend' : 'data';
    // Mindestens eine Linie bleibt sichtbar
    if (ui.lines[key] && !ui.lines[other]) { toast('Mindestens eine Linie muss sichtbar bleiben'); return; }
    ui.lines[key] = !ui.lines[key];
    render();
  });

  if (list.length) drawLineChart(document.getElementById('chart'), list, d);
}

// Kartenüberschrift mit Info-Icon; die Erklärung erscheint bei Hover oder Antippen
function cardHead(title, explanation) {
  return `
    <div class="card-head">
      <h2>${title}</h2>
      <div class="info">
        <button type="button" class="info-btn" aria-label="Erklärung zu ${title}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/></svg>
        </button>
        <div class="info-pop" role="tooltip">${explanation}</div>
      </div>
    </div>`;
}

const SERIES_INFO = `Zeigt den Durchschnitt jeder Serie (Serie 1, 2, 3 …) im gewählten Zeitraum.
  Grün bedeutet: Diese Serie liegt über deinem Serienschnitt, Rot: darunter. Die Zahl rechts ist die Abweichung in Ringen,
  der Balken zeigt sie im Verhältnis zur größten Abweichung. So siehst du z. B., ob du am Ende nachlässt.
  Es zählen nur Einträge mit Serienwerten.`;

function renderSeriesAnalysis(list, d) {
  const withSeries = list.filter(r => Array.isArray(r.series) && r.series.length > 0);
  if (withSeries.length === 0) {
    return `<div class="card">${cardHead('Serienanalyse', SERIES_INFO)}<p class="hint">Trage Ergebnisse mit Serienwerten ein, um zu sehen, welche Serie dir am besten liegt.</p></div>`;
  }
  const n = Math.max(...withSeries.map(r => r.series.length));
  const avgs = [];
  for (let i = 0; i < n; i++) {
    const vals = withSeries.map(r => r.series[i]).filter(v => typeof v === 'number');
    avgs.push(vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  }
  const valid = avgs.filter(v => v !== null);
  const overall = valid.reduce((a, b) => a + b, 0) / valid.length;
  const maxDev = Math.max(0.1, ...valid.map(v => Math.abs(v - overall)));

  const rows = avgs.map((v, i) => {
    if (v === null) return '';
    const dev = v - overall;
    const cls = dev > 0.005 ? 'pos' : dev < -0.005 ? 'neg' : '';
    const width = (Math.abs(dev) / maxDev) * 50;
    return `
      <div class="series-row">
        <span>Serie ${i + 1}</span>
        <span class="avg">${fmtAvg(v, d)}</span>
        <div class="diverge">${cls ? `<b class="${cls}" style="width:${width}%"></b>` : ''}</div>
        <span class="delta ${cls}">${dev >= 0 ? '+' : '−'}${fmtAvg(Math.abs(dev), d)}</span>
      </div>`;
  }).join('');

  return `
    <div class="card">
      ${cardHead('Serienanalyse', SERIES_INFO)}
      <p class="hint" style="margin:-6px 0 10px">Durchschnitt pro Serie und Abweichung vom Serienschnitt (${fmtAvg(overall, d)}) · ${withSeries.length} Einträge mit Serien</p>
      ${rows}
    </div>`;
}

function niceStep(range, targetTicks) {
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function drawLineChart(container, list, d) {
  const W = Math.max(280, container.clientWidth);
  const H = 240;
  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const totals = list.map(r => r.total);
  const trend = movingAverage(totals, TREND_WINDOW);
  const times = list.map(r => parseISO(r.date).getTime());

  let tMin = Math.min(...times), tMax = Math.max(...times);
  if (tMin === tMax) { tMin -= 86400000 * 3; tMax += 86400000 * 3; }

  // Skala nur an den sichtbaren Linien ausrichten
  const visible = [...(ui.lines.data ? totals : []), ...(ui.lines.trend ? trend : [])];
  let vMin = Math.min(...visible), vMax = Math.max(...visible);
  if (vMax - vMin < 2) { vMin -= 2; vMax += 2; }
  const step = niceStep(vMax - vMin, 4);
  vMin = Math.floor(vMin / step) * step;
  vMax = Math.ceil(vMax / step) * step;
  vMin = Math.max(0, vMin);
  vMax = Math.min(Math.max(vMax, vMin + step), Math.ceil(totalMax(d) / step) * step);

  // Mehrere Einträge am selben Tag leicht auseinanderziehen
  const sameDayIdx = {};
  const xs = list.map((r, i) => {
    const key = r.date;
    sameDayIdx[key] = (sameDayIdx[key] || 0) + 1;
    return pad.l + ((times[i] - tMin) / (tMax - tMin)) * iw;
  });
  const dayCount = {};
  list.forEach((r, i) => {
    const total = sameDayIdx[r.date];
    if (total > 1) {
      dayCount[r.date] = (dayCount[r.date] || 0) + 1;
      xs[i] += (dayCount[r.date] - (total + 1) / 2) * 6;
    }
  });

  const y = v => pad.t + ih - ((v - vMin) / (vMax - vMin)) * ih;

  let grid = '';
  for (let v = vMin; v <= vMax + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/>`;
    grid += `<text class="axis-text" x="${pad.l - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }

  // Datumsbeschriftung: bis zu 4 Marken
  const spanDays = (tMax - tMin) / 86400000;
  const labelFmt = t => {
    const dt = new Date(t);
    return spanDays > 120
      ? `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getFullYear()).slice(2)}`
      : `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.`;
  };
  const nLabels = Math.min(4, Math.max(2, Math.floor(iw / 80)));
  let xLabels = '';
  for (let i = 0; i < nLabels; i++) {
    const t = tMin + ((tMax - tMin) * i) / (nLabels - 1);
    const xx = pad.l + (iw * i) / (nLabels - 1);
    const anchor = i === 0 ? 'start' : i === nLabels - 1 ? 'end' : 'middle';
    xLabels += `<text class="axis-text" x="${xx.toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${labelFmt(t)}</text>`;
  }

  const pathOf = vals => vals.map((v, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(v).toFixed(1)}`).join('');
  const dotR = list.length > 60 ? 2.5 : 4;
  const dots = !ui.lines.data ? '' : list.map((r, i) =>
    `<circle class="dot ${r.type === 'competition' ? 'comp' : ''} ${ui.selectedPoint === r.id ? 'selected' : ''}" cx="${xs[i].toFixed(1)}" cy="${y(r.total).toFixed(1)}" r="${ui.selectedPoint === r.id ? 6 : dotR}"/>`).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ergebnisverlauf ${esc(d.name)}">
      ${grid}
      ${xLabels}
      ${ui.lines.data ? `<path class="line-data" d="${pathOf(totals)}"/>` : ''}
      ${ui.lines.trend ? `<path class="line-trend" d="${pathOf(trend)}"/>` : ''}
      <line class="cursor" id="cursor" y1="${pad.t}" y2="${pad.t + ih}" x1="0" x2="0" visibility="hidden"/>
      ${dots}
      <rect class="hit" x="${pad.l - 10}" y="0" width="${iw + 20}" height="${H}"/>
    </svg>`;

  const svg = container.querySelector('svg');
  const info = document.getElementById('chart-info');
  const cursor = svg.querySelector('#cursor');

  function select(i) {
    const r = list[i];
    ui.selectedPoint = r.id;
    svg.querySelectorAll('.dot').forEach((c, j) => {
      c.classList.toggle('selected', j === i);
      c.setAttribute('r', j === i ? 6 : dotR);
    });
    cursor.setAttribute('x1', xs[i]);
    cursor.setAttribute('x2', xs[i]);
    cursor.setAttribute('visibility', 'visible');
    info.innerHTML = `<strong>${fmtScore(r.total, d)}</strong> am ${fmtDate(r.date)} · Trend ${fmtAvg(trend[i], d)}`
      + (r.type === 'competition' ? `<br><span class="tag-comp">Wettkampf</span> ${esc(competitionLabel(r))}` : '')
      + (r.series ? ` · Serien ${r.series.map(v => fmtScore(v, d)).join(' / ')}` : '')
      + (r.note ? `<br>${esc(r.note)}` : '');
  }

  function nearest(evt) {
    const rect = svg.getBoundingClientRect();
    const px = ((evt.clientX - rect.left) / rect.width) * W;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - px) < Math.abs(xs[best] - px)) best = i; });
    return best;
  }

  svg.addEventListener('pointerdown', e => select(nearest(e)));
  svg.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'mouse') select(nearest(e)); });

  const sel = list.findIndex(r => r.id === ui.selectedPoint);
  if (sel >= 0) select(sel);
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (ui.tab === 'analysis') render(); }, 150);
});

// ---------- Optionen ----------

const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

function discEditForm(d) {
  const isNew = !d;
  d = d || { name: '', series: 3, shots: 10, decimal: false };
  const isDefault = !isNew && d.id === state.defaultDisciplineId;
  return `
    <div class="disc-edit">
      <div class="field">
        <label for="de-name">Name</label>
        <input id="de-name" value="${esc(d.name)}" placeholder="z. B. Luftgewehr 60 Schuss" maxlength="60">
      </div>
      <div class="row">
        <div class="field">
          <label for="de-series">Serien</label>
          <input id="de-series" type="number" inputmode="numeric" min="1" max="20" value="${d.series}">
        </div>
        <div class="field">
          <label for="de-shots">Schuss pro Serie</label>
          <input id="de-shots" type="number" inputmode="numeric" min="1" max="100" value="${d.shots}">
        </div>
      </div>
      <div class="field">
        <label for="de-decimal">Wertung</label>
        <select id="de-decimal">
          <option value="0" ${!d.decimal ? 'selected' : ''}>Ganze Ringe (max. 10)</option>
          <option value="1" ${d.decimal ? 'selected' : ''}>Zehntel (max. 10,9)</option>
        </select>
      </div>
      <label class="switch">
        <span>Als Standard festlegen</span>
        <input type="checkbox" id="de-default" ${isDefault ? 'checked disabled' : ''}>
      </label>
      ${isDefault ? '<p class="hint" style="margin:-8px 0 14px">Diese Disziplin ist beim Eintragen vorausgewählt. Um das zu ändern, lege eine andere Disziplin als Standard fest.</p>' : ''}
      <div id="de-error" class="error" hidden></div>
      <div class="actions">
        <button class="btn" id="de-cancel">Abbrechen</button>
        <button class="btn primary" id="de-save">${isNew ? 'Hinzufügen' : 'Speichern'}</button>
      </div>
    </div>`;
}

function renderOptions() {
  const items = state.disciplines.map(d => {
    if (ui.editDiscId === d.id) return discEditForm(d);
    const count = state.results.filter(r => r.disciplineId === d.id).length;
    return `
      <div class="disc-item">
        <div>
          <div class="disc-name">${esc(d.name)}${d.id === state.defaultDisciplineId ? ' <span class="badge">Standard</span>' : ''}</div>
          <div class="disc-meta">${d.series} × ${d.shots} Schuss · ${d.decimal ? 'Zehntel' : 'Ganze Ringe'}</div>
          <div class="disc-meta">${count} ${count === 1 ? 'Ergebnis' : 'Ergebnisse'}</div>
        </div>
        <div class="disc-buttons">
          <button class="icon-btn" data-edit-disc="${d.id}" aria-label="${esc(d.name)} bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>
          <button class="icon-btn danger" data-del-disc="${d.id}" aria-label="${esc(d.name)} löschen" title="Löschen">${ICON_DELETE}</button>
        </div>
      </div>`;
  }).join('');

  const theme = loadTheme();

  view.innerHTML = `
    <div class="card">
      <h2>Allgemein</h2>
      <div class="option-row">
        <span class="label" style="margin:0">Design</span>
        <div class="theme-toggle" role="group" aria-label="Design">
          <button type="button" data-theme-btn="light" aria-label="Hell" aria-pressed="${theme === 'light'}" class="${theme === 'light' ? 'active' : ''}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          </button>
          <button type="button" data-theme-btn="dark" aria-label="Dunkel" aria-pressed="${theme === 'dark'}" class="${theme === 'dark' ? 'active' : ''}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
          </button>
        </div>
      </div>
    </div>

    ${collapsible('disciplines', 'Disziplinen', `${state.disciplines.length}`, `
      ${items || '<p class="hint">Noch keine Disziplin angelegt.</p>'}
      ${ui.editDiscId === 'new' ? `<div style="margin-top:12px">${discEditForm(null)}</div>` : ''}
      ${ui.editDiscId ? '' : '<div class="actions"><button class="btn primary" id="add-disc">+ Disziplin hinzufügen</button></div>'}`)}

    ${collapsible('comptypes', 'Wettkampfarten', `${state.competitionTypes.length}`, `
      <p class="hint" style="margin:0 0 12px">Auswahl im Bereich „Wettkampf“ beim Eintrag.</p>
      ${renderCompTypes()}
      ${ui.editCompId === 'new' ? `<div style="margin-top:12px">${compEditForm(null)}</div>` : ''}
      ${ui.editCompId ? '' : '<div class="actions"><button class="btn primary" id="ct-add">+ Wettkampfart hinzufügen</button></div>'}`)}

    ${collapsible('backup', 'Datensicherung', '', `
      <p class="hint" style="margin:0 0 12px">Deine Daten sind nur auf diesem Gerät gespeichert. Exportiere regelmäßig ein Backup, z. B. bevor du das Handy wechselst.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn" id="export-json">Backup exportieren</button>
        <button class="btn" id="import-json">Backup importieren</button>
      </div>
      <div class="actions">
        <button class="btn" id="export-csv">Als CSV (Excel) exportieren</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>`)}

    <p class="hint" style="text-align:center">${state.results.length} Ergebnisse · ${state.disciplines.length} Disziplinen</p>`;

  view.querySelectorAll('[data-section]').forEach(b => b.onclick = () => {
    const key = b.dataset.section;
    const open = !ui.openSections.has(key);
    if (open) ui.openSections.add(key); else ui.openSections.delete(key);
    b.closest('.collapsible').classList.toggle('open', open);
    b.setAttribute('aria-expanded', open);
  });

  view.querySelectorAll('[data-theme-btn]').forEach(b => b.onclick = () => {
    setTheme(b.dataset.themeBtn);
    view.querySelectorAll('[data-theme-btn]').forEach(x => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-pressed', on);
    });
  });

  bindCompTypes();

  const addBtn = document.getElementById('add-disc');
  if (addBtn) addBtn.onclick = () => { ui.editDiscId = 'new'; render(); document.getElementById('de-name').focus(); };

  view.querySelectorAll('[data-edit-disc]').forEach(b => b.onclick = () => { ui.editDiscId = b.dataset.editDisc; render(); });

  view.querySelectorAll('[data-del-disc]').forEach(b => b.onclick = async () => {
    const d = discById(b.dataset.delDisc);
    const count = state.results.filter(r => r.disciplineId === d.id).length;
    const msg = count
      ? `„${d.name}“ löschen?\n\nAchtung: ${count} ${count === 1 ? 'Ergebnis wird' : 'Ergebnisse werden'} dabei ebenfalls gelöscht.`
      : `„${d.name}“ löschen?`;
    if (!(await askConfirm(msg))) return;
    state.disciplines = state.disciplines.filter(x => x.id !== d.id);
    state.results = state.results.filter(r => r.disciplineId !== d.id);
    normalizeState(state);
    ui.draft = null;
    saveState();
    render();
    toast('Disziplin gelöscht');
  });

  if (ui.editDiscId) {
    document.getElementById('de-cancel').onclick = () => { ui.editDiscId = null; render(); };
    document.getElementById('de-save').onclick = () => {
      const name = document.getElementById('de-name').value.trim();
      const series = Number(document.getElementById('de-series').value);
      const shots = Number(document.getElementById('de-shots').value);
      const decimal = document.getElementById('de-decimal').value === '1';
      const makeDefault = document.getElementById('de-default').checked;
      const err = document.getElementById('de-error');
      const fail = m => { err.hidden = false; err.textContent = m; };

      if (!name) return fail('Bitte einen Namen eingeben');
      if (state.disciplines.some(x => x.id !== ui.editDiscId && x.name.toLowerCase() === name.toLowerCase())) return fail('Eine Disziplin mit diesem Namen gibt es schon');
      if (!Number.isInteger(series) || series < 1 || series > 20) return fail('Serien: 1 bis 20');
      if (!Number.isInteger(shots) || shots < 1 || shots > 100) return fail('Schuss pro Serie: 1 bis 100');

      if (ui.editDiscId === 'new') {
        const d = newDiscipline(name, decimal);
        d.series = series;
        d.shots = shots;
        state.disciplines.push(d);
        if (makeDefault) state.defaultDisciplineId = d.id;
        toast('Disziplin hinzugefügt');
      } else {
        Object.assign(discById(ui.editDiscId), { name, series, shots, decimal });
        if (makeDefault) state.defaultDisciplineId = ui.editDiscId;
        toast('Disziplin gespeichert');
      }
      if (makeDefault) ui.analysisDiscId = null;
      ui.editDiscId = null;
      ui.draft = null;
      normalizeState(state);
      saveState();
      render();
    };
  }

  document.getElementById('export-json').onclick = () => {
    download(`schuetzen-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  };

  document.getElementById('export-csv').onclick = () => {
    const maxSeries = Math.max(0, ...state.results.map(r => (r.series ? r.series.length : 0)));
    const head = ['Datum', 'Disziplin', 'Art', 'Wettkampf', 'Ort', 'Gesamt'];
    for (let i = 1; i <= maxSeries; i++) head.push(`Serie ${i}`);
    head.push('Notiz');
    const csvCell = v => `"${String(v).replace(/"/g, '""')}"`;
    const num = v => String(v).replace('.', ',');
    const lines = [head.map(csvCell).join(';')];
    for (const r of sortedResults(state.results)) {
      const d = discById(r.disciplineId);
      const comp = r.type === 'competition' ? (r.competition || {}) : null;
      const ct = comp ? compTypeById(comp.typeId) : null;
      const row = [
        fmtDate(r.date),
        d ? d.name : '',
        comp ? 'Wettkampf' : 'Training',
        ct ? ct.name : '',
        comp ? comp.location || '' : '',
        num(r.total),
      ];
      for (let i = 0; i < maxSeries; i++) row.push(r.series && r.series[i] !== undefined ? num(r.series[i]) : '');
      row.push(r.note || '');
      lines.push(row.map(csvCell).join(';'));
    }
    download(`schuetzen-ergebnisse-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };

  const fileInput = document.getElementById('import-file');
  document.getElementById('import-json').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!isValidState(data)) throw new Error('format');
      const msg = `Backup mit ${data.results.length} Ergebnissen und ${data.disciplines.length} Disziplinen laden?\n\nDie aktuellen Daten auf diesem Gerät werden dabei ersetzt.`;
      if (!(await askConfirm(msg, 'Backup laden'))) return;
      state = normalizeState(data);
      ui.draft = null;
      ui.analysisDiscId = null;
      saveState();
      render();
      toast('Backup geladen');
    } catch (e) {
      toast('Die Datei ist kein gültiges Backup');
    } finally {
      fileInput.value = '';
    }
  };
}

// Aufklappbarer Bereich in den Optionen; beim Start der App sind alle zugeklappt
function collapsible(key, title, count, body) {
  const open = ui.openSections.has(key);
  return `
    <section class="card collapsible ${open ? 'open' : ''}">
      <button type="button" class="section-head" data-section="${key}" aria-expanded="${open}">
        <h2>${title}</h2>
        ${count ? `<span class="section-count">${count}</span>` : ''}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="section-body">${body}</div>
    </section>`;
}

// Formular wie bei den Disziplinen; c = null für eine neue Wettkampfart
function compEditForm(c) {
  return `
    <div class="disc-edit">
      <div class="field">
        <label for="ct-name">Name</label>
        <input id="ct-name" value="${c ? esc(c.name) : ''}" placeholder="z. B. Rundenwettkampf" maxlength="60">
      </div>
      <div class="actions">
        <button class="btn" id="ct-cancel">Abbrechen</button>
        <button class="btn primary" id="ct-save">${c ? 'Speichern' : 'Hinzufügen'}</button>
      </div>
    </div>`;
}

function renderCompTypes() {
  if (state.competitionTypes.length === 0) return '<p class="hint">Noch keine Wettkampfart angelegt.</p>';
  return state.competitionTypes.map(c => {
    if (ui.editCompId === c.id) return compEditForm(c);
    const count = state.results.filter(r => r.competition && r.competition.typeId === c.id).length;
    return `
      <div class="disc-item">
        <div>
          <div class="disc-name">${esc(c.name)}</div>
          ${count ? `<div class="disc-meta">${count} ${count === 1 ? 'Eintrag' : 'Einträge'}</div>` : ''}
        </div>
        <div class="disc-buttons">
          <button class="icon-btn" data-edit-ct="${c.id}" aria-label="${esc(c.name)} umbenennen" title="Umbenennen">${ICON_EDIT}</button>
          <button class="icon-btn danger" data-del-ct="${c.id}" aria-label="${esc(c.name)} löschen" title="Löschen">${ICON_DELETE}</button>
        </div>
      </div>`;
  }).join('');
}

function bindCompTypes() {
  const nameTaken = (name, exceptId) =>
    state.competitionTypes.some(c => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  const addBtn = document.getElementById('ct-add');
  if (addBtn) addBtn.onclick = () => { ui.editCompId = 'new'; render(); document.getElementById('ct-name').focus(); };

  view.querySelectorAll('[data-edit-ct]').forEach(b => b.onclick = () => {
    ui.editCompId = b.dataset.editCt;
    render();
    document.getElementById('ct-name').focus();
  });

  if (ui.editCompId) {
    const save = () => {
      const name = document.getElementById('ct-name').value.trim();
      const isNew = ui.editCompId === 'new';
      if (!name) return toast('Bitte einen Namen eingeben');
      if (nameTaken(name, isNew ? null : ui.editCompId)) return toast('Diese Wettkampfart gibt es schon');
      if (isNew) state.competitionTypes.push({ id: uid(), name });
      else compTypeById(ui.editCompId).name = name;
      ui.editCompId = null;
      ui.draft = null;
      saveState();
      render();
      toast(isNew ? 'Wettkampfart hinzugefügt' : 'Wettkampfart gespeichert');
    };
    document.getElementById('ct-save').onclick = save;
    document.getElementById('ct-name').onkeydown = e => { if (e.key === 'Enter') save(); };
    document.getElementById('ct-cancel').onclick = () => { ui.editCompId = null; render(); };
  }

  view.querySelectorAll('[data-del-ct]').forEach(b => b.onclick = async () => {
    const c = compTypeById(b.dataset.delCt);
    const used = state.results.filter(r => r.competition && r.competition.typeId === c.id);
    const msg = used.length
      ? `„${c.name}“ löschen?\n\n${used.length} ${used.length === 1 ? 'Eintrag bleibt' : 'Einträge bleiben'} als Wettkampf erhalten, aber ohne Angabe der Art.`
      : `„${c.name}“ löschen?`;
    if (!(await askConfirm(msg))) return;
    used.forEach(r => { r.competition.typeId = null; });
    state.competitionTypes = state.competitionTypes.filter(x => x.id !== c.id);
    ui.draft = null;
    saveState();
    render();
    toast('Wettkampfart gelöscht');
  });
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Start ----------

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
