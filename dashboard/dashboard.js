'use strict';

// ---------- Vereins-Dashboard: Ergebnisse aller Mitglieder vergleichen ----------

const TREND_WINDOW = 5;
const CAT_COLORS = 6;

// [Schlüssel, Beschriftung, Monate, Kurzform fürs Handy]
const PERIODS = [['3m', '3 Monate', 3, '3 M'], ['6m', '6 Monate', 6, '6 M'], ['1y', '12 Monate', 12, '12 M'], ['year', 'Dieses Jahr', null, 'Jahr'], ['all', 'Alles', null, 'Alles']];
const KINDS = [['all', 'Alle'], ['training', 'Training'], ['competition', 'Wettkampf']];

// Zuletzt gewählter Verein (für Admins mehrerer Vereine)
const CLUB_KEY = 'hotshot-dash-club-id';

// Verein aus dem Link der App (…/dashboard/?club=…); wird nach dem Anmelden übernommen
let requestedClub = (() => {
  try {
    const params = new URLSearchParams(location.search);
    const id = params.get('club');
    if (!id) return null;
    params.delete('club');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    return id;
  } catch (e) { return null; }
})();

const dash = {
  me: null,          // eigenes Profil
  clubs: [],         // eigene Vereine aus my_clubs()
  clubId: null,      // gerade angezeigter Verein (nur Vereine, in denen man Admin ist)
  clubName: '',
  members: [],       // { id, username, displayName, isAdmin, createdAt, color, total, lastDate }
  results: [],       // alle Ergebnisse aller Mitglieder, flach
  disciplines: [],   // { key, name, decimal, count } – gleichnamige Disziplinen werden zusammengefasst
  loadedAt: null,
  view: 'ranking',
  disc: null,
  period: '1y',
  kind: 'all',
  ageClass: 'all',   // Filter nach Altersklasse der Ergebnisse (beim Eintrag gewählt)
  sort: { key: 'avg', dir: -1 },
  compare: [],       // ausgewählte Mitglieder-IDs für den Vergleich (Reihenfolge = Farbe)
  compareInit: false,
  openSections: new Set(), // aufgeklappte Bereiche unter „Optionen“; beim Öffnen der Seite alle zu
};

const app = document.getElementById('app');

// ---------- Hilfsfunktionen ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(n, digits) {
  return n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
}

const discOf = () => dash.disciplines.find(d => d.key === dash.disc) || null;
const fmtScore = n => fmt(n, discOf() && discOf().decimal ? 1 : 0);
const fmtAvg = n => fmt(n, discOf() && discOf().decimal ? 2 : 1);

function fmtDate(s) {
  if (!s) return '–';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function periodStart(key) {
  const now = new Date();
  if (key === 'year') return `${now.getFullYear()}-01-01`;
  const p = PERIODS.find(x => x[0] === key);
  if (!p || p[2] === null) return null;
  now.setMonth(now.getMonth() - p[2]);
  return isoOf(now);
}

const mean = a => a.reduce((x, y) => x + y, 0) / a.length;

function movingAverage(values, k) {
  return values.map((_, i) => mean(values.slice(Math.max(0, i - k + 1), i + 1)));
}

function niceStep(range, targetTicks) {
  const raw = range / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// Bestätigungsfenster; mit input = true zusätzlich ein Eingabefeld (liefert dann den Text oder null)
function dialog(message, okLabel, { input = false, danger = false } = {}) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    const [title, ...rest] = message.split('\n\n');
    dlg.innerHTML = `
      <p class="confirm-title">${esc(title)}</p>
      ${rest.map(p => `<p class="confirm-text">${esc(p)}</p>`).join('')}
      ${input ? '<input type="text" id="dlg-input" autocomplete="off" style="margin-top:8px">' : ''}
      <div class="actions">
        <button type="button" class="btn" data-answer="no">Abbrechen</button>
        <button type="button" class="btn ${danger ? 'danger-fill' : 'primary'}" data-answer="yes">${esc(okLabel)}</button>
      </div>`;
    const field = () => dlg.querySelector('#dlg-input');
    const finish = yes => {
      const value = input ? (yes ? field().value : null) : yes;
      dlg.close(); dlg.remove(); resolve(value);
    };
    dlg.querySelectorAll('[data-answer]').forEach(b => b.onclick = () => finish(b.dataset.answer === 'yes'));
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    if (input) field().addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); });
    document.body.appendChild(dlg);
    dlg.showModal();
    if (input) field().focus();
  });
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Kopfzeile ----------

// Vereine, deren Dashboard man öffnen darf
const adminClubs = () => dash.clubs.filter(c => c.is_admin && c.status === 'active');

function renderHeader() {
  const admin = adminClubs();
  const sw = document.getElementById('club-switch');
  sw.hidden = !dash.me || admin.length < 2;
  sw.innerHTML = admin.map(c => `<option value="${c.id}" ${c.id === dash.clubId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const nameEl = document.getElementById('club-name');
  nameEl.hidden = !sw.hidden;
  nameEl.textContent = dash.clubName ? `· ${dash.clubName}` : 'Vereins-Dashboard';
  // Vereinsname merken: Vor der Anmeldung gibt die Cloud ihn nicht heraus, der Login-Bildschirm zeigt ihn trotzdem
  if (dash.clubName) try { localStorage.setItem('hotshot-dash-club', dash.clubName); } catch (e) { /* dann nur „Dashboard“ */ }
  const nav = document.getElementById('dash-nav');
  nav.hidden = !(dash.me && dash.clubId);
  nav.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === dash.view));
  document.body.classList.toggle('has-nav', !nav.hidden);
  // Abgemeldet: keine Kopfleiste, Logo steht mittig über dem Anmeldefeld (wie in der App)
  document.body.classList.toggle('signed-out', !dash.me);
}

document.querySelectorAll('#dash-nav [data-view]').forEach(b => b.onclick = () => {
  dash.view = b.dataset.view;
  renderHeader();
  render();
  window.scrollTo(0, 0);
});

// Anderen Verein anzeigen: Auswahl und Vergleich beginnen neu
document.getElementById('club-switch').onchange = async e => {
  dash.clubId = e.target.value;
  try { localStorage.setItem(CLUB_KEY, dash.clubId); } catch (err) { /* dann nur bis zum Neuladen */ }
  Object.assign(dash, { disc: null, compare: [], compareInit: false, sig: null });
  try { await loadAll(dash.me.id); } catch (err) { toast(Cloud.errorText(err)); }
};

// ---------- Anmeldung ----------

// Links zu Impressum und Datenschutz (müssen von jeder Seite aus erreichbar sein)
function legalLinks() {
  const link = (file, label) => `<a href="${new URL('../rechtliches/' + file, document.baseURI).href}" target="_blank" rel="noopener">${label}</a>`;
  return `<p class="legal-links">${link('impressum.html', 'Impressum')} · ${link('datenschutz.html', 'Datenschutz')} · ${link('nutzungsbedingungen.html', 'Nutzungsbedingungen')} · ${link('av-vertrag.html', 'AV-Vertrag')}</p>`;
}

function loginBrand() {
  let club = '';
  try { club = localStorage.getItem('hotshot-dash-club') || ''; } catch (e) { /* unbekannt */ }
  return `
    <div class="auth-brand">
      <img src="../icons/icon.svg" alt="" width="72" height="72">
      <div class="auth-name">Hot Shot</div>
      <div class="auth-sub">Dashboard${club ? ` – ${esc(club)}` : ''}</div>
    </div>`;
}

function renderLogin(message) {
  if (!Cloud.configured || !Cloud.libLoaded) {
    app.innerHTML = `<div class="dash-center">${loginBrand()}<div class="card">
      <h2>${Cloud.configured ? 'Keine Verbindung' : 'Cloud noch nicht eingerichtet'}</h2>
      <p class="hint">${Cloud.configured ? 'Die Supabase-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.'
        : 'In <code>config.js</code> fehlen die Zugangsdaten zum Supabase-Projekt (siehe README).'}</p></div></div>`;
    return;
  }
  app.innerHTML = `<div class="dash-center">${loginBrand()}
    <form class="card" id="login-form" novalidate>
      <h2>Anmelden</h2>
      <p class="hint" style="margin:-6px 0 16px">Das Dashboard ist für die Admins eines Vereins. Melde dich mit deinem Hot-Shot-Konto an.</p>
      <div class="field">
        <label for="l-user">Benutzername</label>
        <input id="l-user" autocomplete="username" autocapitalize="none" spellcheck="false">
      </div>
      <div class="field">
        <label for="l-pass">Passwort</label>
        <input id="l-pass" type="password" autocomplete="current-password">
      </div>
      <div class="error" id="l-error" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
      <div class="actions"><button class="btn primary" type="submit" id="l-submit">Anmelden</button></div>
    </form>${legalLinks()}</div>`;
  const form = document.getElementById('login-form');
  const errEl = document.getElementById('l-error');
  document.getElementById('l-user').focus();
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = document.getElementById('l-submit');
    btn.disabled = true;
    try {
      const session = await Cloud.signIn(document.getElementById('l-user').value, document.getElementById('l-pass').value);
      await loadAll(session.user.id);
    } catch (err) {
      btn.disabled = false;
      errEl.hidden = false;
      errEl.textContent = Cloud.errorText(err);
    }
  };
}

function renderNoAccess() {
  app.innerHTML = `<div class="dash-center card">
    <h2>Kein Zugriff</h2>
    <p class="hint">Das Konto „${esc(dash.me.username)}“ ist in keinem Verein Admin. Ein Admin deines Vereins kann dich im Dashboard unter „Mitglieder“ dazu machen.</p>
    <div class="actions"><button type="button" class="btn" id="na-logout">Abmelden</button></div>
  </div>`;
  document.getElementById('na-logout').onclick = logoutDash;
}

async function logoutDash() {
  await Cloud.signOut();
  Object.assign(dash, { me: null, clubs: [], clubId: null, clubName: '', sig: null, view: 'ranking' });
  renderHeader();
  renderLogin();
}

// ---------- Daten laden ----------

// silent: Hintergrund-Aktualisierung ohne Ladeanzeige; neu gezeichnet wird nur, wenn sich etwas geändert hat
async function loadAll(userId, { silent = false } = {}) {
  if (!silent) app.innerHTML = '<div class="card empty">Daten werden geladen …</div>';
  const [me, clubs] = await Promise.all([Cloud.getProfile(userId), Cloud.myClubs()]);
  if (!me) throw new Error('Profil nicht gefunden');
  const accessBefore = JSON.stringify(adminClubs());
  dash.me = me;
  dash.clubs = clubs;
  const admin = adminClubs();
  // Aus der App geöffnet (…/dashboard/?club=…): gleich diesen Verein zeigen, wenn man dort Admin ist
  if (requestedClub && admin.some(c => c.id === requestedClub)) {
    dash.clubId = requestedClub;
    dash.sig = null;
    try { localStorage.setItem(CLUB_KEY, dash.clubId); } catch (e) { /* dann nur bis zum Neuladen */ }
  }
  requestedClub = null;
  if (!admin.some(c => c.id === dash.clubId)) {
    let saved = null;
    try { saved = localStorage.getItem(CLUB_KEY); } catch (e) { /* kein Speicher */ }
    dash.clubId = (admin.find(c => c.id === saved) || admin[0] || { id: null }).id;
    dash.sig = null;
  }
  const club = admin.find(c => c.id === dash.clubId);
  dash.clubName = club ? club.name : '';
  const accessChanged = accessBefore !== JSON.stringify(admin);
  if (!silent || accessChanged) renderHeader();
  if (!dash.clubId) { renderNoAccess(); return; }

  const members = await Cloud.call('admin_club_members', { club: dash.clubId });
  const sig = JSON.stringify([dash.clubId, dash.clubName, members.map(m => [m.user_id, m.username, m.is_admin, m.updated_at])]);
  dash.loadedAt = new Date();
  if (silent && sig === dash.sig && !accessChanged) return;
  dash.sig = sig;
  buildData(members);
  renderHeader();
  render();
}

// Aktualisieren ohne Flackern; manuell mit kurzer Bestätigung
let refreshing = false;
async function refresh(manual) {
  if (refreshing || !dash.me) return;
  refreshing = true;
  try {
    await loadAll(dash.me.id, { silent: true });
    if (manual) toast('Daten sind aktuell');
  } catch (e) {
    if (manual) toast(Cloud.errorText(e));
  } finally {
    refreshing = false;
  }
}

// Automatisch abgleichen: jede Minute, solange die Seite sichtbar ist, und beim Zurückkehren zur Seite.
// Nicht, während ein Dialog offen ist oder jemand im Bereich „Optionen“ gerade Eingaben macht.
function autoRefreshAllowed() {
  return dash.me && dash.clubId && document.visibilityState === 'visible'
    && !document.querySelector('dialog[open]') && dash.view !== 'club';
}
setInterval(() => { if (autoRefreshAllowed()) refresh(false); }, 60000);
document.addEventListener('visibilitychange', () => { if (autoRefreshAllowed()) refresh(false); });

// Ergebnisse aller Mitglieder zusammenführen. Disziplinen werden über den Namen zugeordnet,
// weil jedes Mitglied seine Disziplinen selbst verwaltet. Die Datenbank liefert je Mitglied
// nur die Ergebnisse für diesen Verein (und nur mit Zustimmung zur Vereinsanalyse).
function buildData(rows) {
  const stateOf = Object.fromEntries(rows.map(p => [p.user_id, p.state]));
  const results = [];
  const discs = new Map();

  dash.members = rows.map(p => ({
    id: p.user_id,
    username: p.username,
    displayName: p.username, // im Dashboard erscheint nur der Benutzername, kein echter Name
    isAdmin: p.is_admin,
    createdAt: p.joined_at,
    ageClassId: (stateOf[p.id] && stateOf[p.id].shareWithClub !== false && ageClassById(stateOf[p.id].ageClassId)) ? ageClassById(stateOf[p.id].ageClassId).id : null,
    total: 0,
    lastDate: null,
  }));

  for (const m of dash.members) {
    const st = stateOf[m.id];
    // Ohne Zustimmung zur Vereinsanalyse (Optionen der App) werden keine Ergebnisse ausgewertet
    if (!st || !Array.isArray(st.results) || st.shareWithClub === false) continue;
    const discById = Object.fromEntries((st.disciplines || []).map(d => [d.id, d]));
    const compById = Object.fromEntries((st.competitionTypes || []).map(c => [c.id, c.name]));
    for (const r of st.results) {
      const d = discById[r.disciplineId];
      if (!d || typeof r.total !== 'number' || !r.date) continue;
      const key = d.name.trim().toLowerCase();
      if (!discs.has(key)) discs.set(key, { key, names: {}, decimalVotes: 0, count: 0 });
      const info = discs.get(key);
      info.names[d.name.trim()] = (info.names[d.name.trim()] || 0) + 1;
      info.decimalVotes += d.decimal ? 1 : -1;
      info.count++;
      const comp = r.type === 'competition' ? (r.competition || {}) : null;
      results.push({
        id: r.id,
        memberId: m.id,
        key,
        date: r.date,
        createdAt: r.createdAt || 0,
        total: r.total,
        series: Array.isArray(r.series) ? r.series : null,
        type: comp ? 'competition' : 'training',
        compName: comp && comp.typeId ? compById[comp.typeId] || '' : '',
        location: comp ? comp.location || '' : '',
        note: r.note || '',
        // Altersklasse des Ergebnisses; ältere Einträge ohne Angabe zählen zur Standard-Klasse des Mitglieds
        ageClassId: ageClassById(r.ageClassId) ? ageClassById(r.ageClassId).id : m.ageClassId,
      });
      m.total++;
      if (!m.lastDate || r.date > m.lastDate) m.lastDate = r.date;
    }
  }

  results.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  dash.results = results;
  dash.disciplines = [...discs.values()]
    .map(d => ({
      key: d.key,
      name: Object.entries(d.names).sort((a, b) => b[1] - a[1])[0][0],
      decimal: d.decimalVotes > 0,
      count: d.count,
    }))
    .sort((a, b) => b.count - a.count);
  // Keine Vorauswahl: die Disziplin wählt der Admin selbst, sie bleibt bis zum Neuladen der Seite
  if (dash.disc && !dash.disciplines.some(d => d.key === dash.disc)) dash.disc = null;
  dash.compare = dash.compare.filter(id => dash.members.some(m => m.id === id));
}

const memberById = id => dash.members.find(m => m.id === id);

function filteredResults() {
  const start = periodStart(dash.period);
  return dash.results.filter(r => r.key === dash.disc
    && (!start || r.date >= start)
    && (dash.kind === 'all' || r.type === dash.kind)
    && (dash.ageClass === 'all' || r.ageClassId === dash.ageClass));
}

function statsOf(list) {
  const totals = list.map(r => r.total);
  const avg = mean(totals);
  const best = list.reduce((a, b) => (b.total > a.total ? b : a));
  const last = totals.slice(-TREND_WINDOW);
  const avgLast = mean(last);
  return {
    n: list.length,
    avg,
    best,
    avgLast,
    trend: list.length > TREND_WINDOW ? avgLast - avg : null,
    lastDate: list[list.length - 1].date,
  };
}

// Kennzahlen je Mitglied für die aktuelle Auswahl
function memberRows() {
  const byMember = new Map();
  for (const r of filteredResults()) {
    if (!byMember.has(r.memberId)) byMember.set(r.memberId, []);
    byMember.get(r.memberId).push(r);
  }
  return [...byMember.entries()].map(([id, list]) => ({ member: memberById(id), list, ...statsOf(list) }));
}

function colorOf(memberId) {
  const i = dash.compare.indexOf(memberId);
  return i >= 0 ? `var(--cat-${(i % CAT_COLORS) + 1})` : null;
}

// ---------- Darstellung ----------

function render() {
  if (!dash.me || !dash.clubId) return;
  ({ ranking: renderRanking, compare: renderCompare, members: renderMembers, club: renderClub })[dash.view]();
  if (dash.view === 'ranking' || dash.view === 'members') showAdminNotice();
}

// Hinweis oben auf der Seite, solange der Verein nur einen Admin hat: Vergisst dieser sein Passwort
// oder ist nicht mehr erreichbar, kommt niemand mehr ins Dashboard.
function showAdminNotice() {
  if (dash.members.filter(m => m.isAdmin).length !== 1) return;
  const alone = dash.members.length < 2;
  const onMembers = dash.view === 'members';
  app.insertAdjacentHTML('afterbegin', `
    <div class="card notice-card">
      <b>Euer Verein hat nur einen Admin.</b>
      ${alone ? 'Sobald sich weitere Mitglieder registriert haben, mach' : 'Mach'} am besten ein zweites Mitglied zum Admin${onMembers && !alone ? ' (Knopf „Zum Admin machen“ unten)' : ''}.
      Sonst kommt niemand mehr ins Dashboard, wenn der einzige Admin sein Passwort vergisst oder nicht mehr erreichbar ist.
      ${!onMembers && !alone ? '<button type="button" class="link-btn" id="notice-members">Zu den Mitgliedern</button>' : ''}
    </div>`);
  const btn = document.getElementById('notice-members');
  if (btn) btn.onclick = () => {
    dash.view = 'members';
    renderHeader();
    render();
    window.scrollTo(0, 0);
  };
}

function filterBar({ showKind = true } = {}) {
  const discOpts = (dash.disc ? '' : '<option value="" selected disabled>-- Disziplin auswählen --</option>')
    + dash.disciplines.map(d =>
    `<option value="${esc(d.key)}" ${d.key === dash.disc ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  // Zeitraum und Art als zwei getrennte Schaltergruppen
  return `
    <div class="dash-filters">
      <select id="f-disc" aria-label="Disziplin">${discOpts}</select>
      <div class="seg seg-period" role="group" aria-label="Zeitraum">${PERIODS.map(([k, l, , short]) =>
        `<button type="button" class="${dash.period === k ? 'active' : ''}" data-period="${k}" aria-pressed="${dash.period === k}" title="${l}"><span class="l-long">${l}</span><span class="l-short">${short}</span></button>`).join('')}</div>
      <div class="f-group">
      ${showKind ? `<div class="seg seg-kind" role="group" aria-label="Art">${KINDS.map(([k, l]) =>
        `<button type="button" class="${dash.kind === k ? 'active' : ''}" data-kind="${k}" aria-pressed="${dash.kind === k}">${l}</button>`).join('')}</div>` : ''}
      <select id="f-age" class="f-age" aria-label="Altersklasse">
        <option value="all">Alle Altersklassen</option>
        ${AGE_CLASSES.map(c => `<option value="${c.id}" ${c.id === dash.ageClass ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
      </select>
      </div>
    </div>`;
}

// Art und Altersklasse brechen gemeinsam um; dann linksbündig statt Altersklasse ganz rechts
function checkFilterWrap() {
  const group = app.querySelector('.f-group');
  const disc = document.getElementById('f-disc');
  if (group && disc) group.classList.toggle('wrapped', group.getBoundingClientRect().top >= disc.getBoundingClientRect().bottom);
}

function bindFilterBar() {
  const sel = document.getElementById('f-disc');
  if (sel) sel.onchange = e => { dash.disc = e.target.value; render(); };
  const age = document.getElementById('f-age');
  if (age) age.onchange = e => { dash.ageClass = e.target.value; render(); };
  app.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { dash.period = b.dataset.period; render(); });
  app.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { dash.kind = b.dataset.kind; render(); });
  const reload = document.getElementById('reload');
  if (reload) reload.onclick = () => refresh(true);
  checkFilterWrap();
}

// Dezenter Hinweis am Seitenende; die Daten werden ohnehin automatisch aktualisiert
function refreshLine() {
  return `<p class="dash-refresh">Wird automatisch aktualisiert · <button type="button" class="link-subtle" id="reload">Jetzt aktualisieren</button></p>`;
}

// Kartenüberschrift mit Info-Icon; die Erklärung erscheint bei Hover oder Klick
function cardHead(title, explanation) {
  return `
    <div class="card-head">
      <h2>${title}</h2>
      ${infoIcon(explanation)}
    </div>`;
}

function infoIcon(explanation) {
  return `
    <div class="info">
      <button type="button" class="info-btn" aria-label="Erklärung">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/></svg>
      </button>
      <div class="info-pop" role="tooltip">${explanation}</div>
    </div>`;
}

// Kennzahl-Kachel mit Info-Icon neben der Beschriftung
function tile(label, value, sub, explanation) {
  return `<div class="tile"><div class="tile-head"><div class="label">${label}</div>${infoIcon(explanation)}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
}

function noData() {
  return '<div class="card empty">Noch keine Ergebnisse im Verein. Sobald Mitglieder in der App Ergebnisse eintragen, erscheinen sie hier.</div>';
}

// Ohne gewählte Disziplin nur die Filter und einen Hinweis zeigen; true = Ansicht ist damit fertig
function needsDisc() {
  if (!dash.disciplines.length) { app.innerHTML = noData(); return true; }
  if (dash.disc) return false;
  app.innerHTML = `${filterBar()}<div class="card empty">Bitte oben eine Disziplin auswählen.</div>`;
  bindFilterBar();
  return true;
}

function deltaCell(v) {
  if (v === null) return '<span class="dash-meta">–</span>';
  const cls = v > 0.005 ? 'pos' : v < -0.005 ? 'neg' : '';
  const arrow = cls === 'pos' ? '▲' : cls === 'neg' ? '▼' : '';
  return `<span class="delta ${cls}">${arrow} ${v >= 0 ? '+' : '−'}${fmtAvg(Math.abs(v))}</span>`;
}

// ----- Rangliste -----

const RANK_COLUMNS = [
  ['name', 'Schütze', false],
  ['n', 'Einträge', true],
  ['avg', 'Durchschnitt', true],
  ['best', 'Bestwert', true],
  ['avgLast', `Ø letzte ${TREND_WINDOW}`, true],
  ['trend', 'Trend', true],
  ['lastDate', 'Letzter Eintrag', true],
];

function sortValue(row, key) {
  switch (key) {
    case 'name': return row.member.displayName.toLowerCase();
    case 'best': return row.best.total;
    case 'trend': return row.trend === null ? -Infinity : row.trend;
    default: return row[key];
  }
}

function renderRanking() {
  if (needsDisc()) return;
  const rows = memberRows();
  const { key, dir } = dash.sort;
  rows.sort((a, b) => {
    const va = sortValue(a, key), vb = sortValue(b, key);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.avg - a.avg;
  });

  let tiles = '';
  if (rows.length) {
    const all = filteredResults();
    const record = all.reduce((a, b) => (b.total > a.total ? b : a));
    const avgOfAvgs = mean(rows.map(r => r.avg));
    tiles = `
      <div class="tiles">
        ${tile('Aktive Schützen', rows.length, `von ${dash.members.length} Mitgliedern`,
          'Mitglieder, die mit den gewählten Filtern mindestens ein Ergebnis haben.')}
        ${tile('Ergebnisse', all.length, 'im gewählten Zeitraum',
          'Anzahl aller eingetragenen Ergebnisse, die zu den gewählten Filtern passen.')}
        ${tile('Vereinsschnitt', fmtAvg(avgOfAvgs), 'Ø der Schützen-Durchschnitte',
          'Mittelwert der Durchschnitte aller aktiven Schützen. Jeder Schütze zählt gleich viel, egal wie viele Ergebnisse er hat.')}
        ${tile('Bestleistung', fmtScore(record.total), `${esc(memberById(record.memberId).displayName)} · ${fmtDate(record.date)}`,
          'Höchstes Einzelergebnis mit den gewählten Filtern, mit Schütze und Datum.')}
      </div>`;
  }

  const head = RANK_COLUMNS.map(([k, label, num]) => `
    <th class="${num ? 'num' : ''}"><button class="sort-btn ${key === k ? 'active' : ''}" data-sort="${k}">${label}${key === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>`).join('');

  const body = rows.map((r, i) => {
    const checked = dash.compare.includes(r.member.id);
    const color = colorOf(r.member.id);
    return `
      <tr>
        <td><input type="checkbox" data-cmp="${r.member.id}" ${checked ? 'checked' : ''} aria-label="${esc(r.member.displayName)} vergleichen"></td>
        <td class="num"><span class="rank ${i < 3 && key === 'avg' && dir < 0 ? 'top' : ''}">${i + 1}.</span></td>
        <td><div class="member-cell">${color ? `<span class="swatch" style="background:${color}"></span>` : ''}<div>${esc(r.member.displayName)}</div></div></td>
        <td class="num">${r.n}</td>
        <td class="num"><b>${fmtAvg(r.avg)}</b></td>
        <td class="num" title="${fmtDate(r.best.date)}">${fmtScore(r.best.total)}</td>
        <td class="num">${fmtAvg(r.avgLast)}</td>
        <td class="num">${deltaCell(r.trend)}</td>
        <td class="num">${fmtDate(r.lastDate)}</td>
      </tr>`;
  }).join('');

  app.innerHTML = `
    ${filterBar()}
    ${tiles}
    <div class="card">
      ${cardHead(`Rangliste ${esc(discOf().name)}`, `<b>Einträge</b> = Anzahl der Ergebnisse.<br><br>
        <b>Durchschnitt</b> = Mittelwert aller Ergebnisse.<br><br><b>Bestwert</b> = höchstes Einzelergebnis.<br><br>
        <b>Ø letzte ${TREND_WINDOW}</b> = Mittelwert der ${TREND_WINDOW} neuesten Ergebnisse.<br><br>
        <b>Trend</b> = Ø der letzten ${TREND_WINDOW} Ergebnisse minus Gesamtdurchschnitt im Zeitraum
        (ab ${TREND_WINDOW + 1} Einträgen).<br><br>Häkchen setzen, um Schützen unter „Vergleich“ gegenüberzustellen.`)}
      ${rows.length ? `
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th><input type="checkbox" id="cmp-all" ${dash.compare.length ? 'checked' : ''} title="${dash.compare.length ? 'Alle Häkchen entfernen' : 'Alle anhaken'}" aria-label="Alle zum Vergleich auswählen oder abwählen"></th><th class="num">Platz</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>` : '<p class="hint">Keine Ergebnisse für diese Auswahl.</p>'}
      <div class="actions foot-actions">
        <button class="btn small" id="go-compare" ${dash.compare.length ? '' : 'disabled'}>Auswahl vergleichen (${dash.compare.length})</button>
        <button class="btn small" id="csv" ${rows.length ? '' : 'disabled'}>CSV exportieren</button>
      </div>
    </div>
    ${refreshLine()}`;

  bindFilterBar();
  app.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
    const k = b.dataset.sort;
    dash.sort = dash.sort.key === k ? { key: k, dir: -dash.sort.dir } : { key: k, dir: k === 'name' ? 1 : -1 };
    render();
  });
  app.querySelectorAll('[data-cmp]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.cmp;
    dash.compare = cb.checked ? [...dash.compare, id] : dash.compare.filter(x => x !== id);
    render();
  });
  const cmpAll = document.getElementById('cmp-all');
  if (cmpAll) {
    cmpAll.indeterminate = dash.compare.length > 0 && rows.some(r => !dash.compare.includes(r.member.id));
    cmpAll.onchange = () => {
      dash.compare = dash.compare.length ? [] : rows.map(r => r.member.id);
      render();
    };
  }
  document.getElementById('go-compare').onclick = () => { dash.view = 'compare'; renderHeader(); render(); };
  document.getElementById('csv').onclick = () => exportRankingCsv(rows);
}

function exportRankingCsv(rows) {
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const num = v => (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : '');
  const lines = [['Platz', 'Benutzername', 'Einträge', 'Durchschnitt', 'Bestwert', `Ø letzte ${TREND_WINDOW}`, 'Trend', 'Letzter Eintrag'].map(cell).join(';')];
  rows.forEach((r, i) => lines.push([i + 1, r.member.username, r.n, num(r.avg), num(r.best.total), num(r.avgLast), num(r.trend), fmtDate(r.lastDate)].map(cell).join(';')));
  download(`hotshot-rangliste-${discOf().name}-${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

// ----- Vergleich -----

function renderCompare() {
  if (needsDisc()) return;
  const rows = memberRows();
  // Beim ersten Öffnen ohne Auswahl die drei besten Schützen vorschlagen
  if (dash.compare.length === 0 && !dash.compareInit) {
    dash.compareInit = true;
    dash.compare = rows.slice().sort((a, b) => b.avg - a.avg).slice(0, 3).map(r => r.member.id);
  }
  const selected = dash.compare.map(id => rows.find(r => r.member.id === id) || { member: memberById(id), list: [] });
  const withData = selected.filter(s => s.list.length > 0);
  const others = rows.filter(r => !dash.compare.includes(r.member.id)).sort((a, b) => a.member.displayName.localeCompare(b.member.displayName, 'de'));

  const legend = selected.map(s => `
    <button type="button" class="legend-toggle" data-remove="${s.member.id}" title="Aus dem Vergleich entfernen">
      <span class="swatch" style="background:${colorOf(s.member.id)}"></span>${esc(s.member.displayName)}${s.list.length ? '' : ' (keine Ergebnisse)'} ✕
    </button>`).join('');

  const tableRows = withData.map(s => `
    <tr>
      <td><div class="member-cell"><span class="swatch" style="background:${colorOf(s.member.id)}"></span>${esc(s.member.displayName)}</div></td>
      <td class="num">${s.n}</td>
      <td class="num"><b>${fmtAvg(s.avg)}</b></td>
      <td class="num">${fmtScore(s.best.total)}</td>
      <td class="num">${fmtAvg(s.avgLast)}</td>
      <td class="num">${deltaCell(s.trend)}</td>
    </tr>`).join('');

  app.innerHTML = `
    ${filterBar()}
    <div class="card">
      ${cardHead(`Vergleich ${esc(discOf().name)}`, `<b>Linien</b> = gleitender Durchschnitt der letzten ${TREND_WINDOW} Ergebnisse.<br><br>
        <b>Punkte</b> = einzelne Ergebnisse (hohl = Wettkampf).<br><br><b>Gestrichelt</b> = Vereinsschnitt je Monat.`)}
      <div class="legend">
        ${legend}
        <span class="legend-toggle legend-static"><i class="club-swatch"></i>Vereinsschnitt</span>
        ${others.length ? `
          <select id="add-member" style="width:auto;min-height:34px;padding:4px 10px;font-size:13px">
            <option value="">+ Schütze hinzufügen</option>
            ${others.map(r => `<option value="${r.member.id}">${esc(r.member.displayName)}</option>`).join('')}
          </select>` : ''}
      </div>
      ${withData.length ? '<div class="cmp-chart" id="cmp-chart"><div class="tooltip" id="tooltip" hidden></div></div>' : '<p class="hint">Keine Ergebnisse für die ausgewählten Schützen in diesem Zeitraum.</p>'}
    </div>
    ${withData.length ? `
    <div class="card">
      ${cardHead('Kennzahlen', `Alle Werte beziehen sich auf die oben gewählten Filter (Disziplin, Zeitraum, Art, Altersklasse).<br><br>
        <b>Durchschnitt</b> = Mittelwert aller Ergebnisse.<br><br><b>Bestwert</b> = höchstes Einzelergebnis.<br><br>
        <b>Ø letzte ${TREND_WINDOW}</b> = Mittelwert der ${TREND_WINDOW} neuesten Ergebnisse.<br><br>
        <b>Trend</b> = Ø letzte ${TREND_WINDOW} minus Durchschnitt (ab ${TREND_WINDOW + 1} Einträgen).`)}
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Schütze</th><th class="num">Einträge</th><th class="num">Durchschnitt</th><th class="num">Bestwert</th><th class="num">Ø letzte ${TREND_WINDOW}</th><th class="num">Trend</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>` : ''}
    ${refreshLine()}`;

  bindFilterBar();
  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    dash.compare = dash.compare.filter(id => id !== b.dataset.remove);
    render();
  });
  const add = document.getElementById('add-member');
  if (add) add.onchange = () => { if (add.value) { dash.compare.push(add.value); render(); } };
  if (withData.length) drawCompareChart(document.getElementById('cmp-chart'), withData);
}

// Vereinsschnitt je Monat über alle Mitglieder (gleiche Filter)
function clubMonthly() {
  const byMonth = new Map();
  for (const r of filteredResults()) {
    const k = r.date.slice(0, 7);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(r.total);
  }
  return [...byMonth.entries()].sort().map(([k, vals]) => ({ t: parseISO(k + '-15').getTime(), v: mean(vals) }));
}

function drawCompareChart(container, series) {
  const W = Math.max(300, container.clientWidth);
  const H = W < 600 ? 280 : 380;
  const directLabels = series.length <= 4 && W >= 600;
  const pad = { l: 48, r: directLabels ? 130 : 16, t: 12, b: 28 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const prepared = series.map(s => {
    const totals = s.list.map(r => r.total);
    return { ...s, color: colorOf(s.member.id), times: s.list.map(r => parseISO(r.date).getTime()), trend: movingAverage(totals, TREND_WINDOW) };
  });
  const club = clubMonthly();

  const allTimes = prepared.flatMap(p => p.times);
  let tMin = Math.min(...allTimes), tMax = Math.max(...allTimes);
  if (tMin === tMax) { tMin -= 86400000 * 3; tMax += 86400000 * 3; }
  const clubVisible = club.filter(c => c.t >= tMin && c.t <= tMax);

  const values = [...prepared.flatMap(p => [...p.list.map(r => r.total), ...p.trend]), ...clubVisible.map(c => c.v)];
  let vMin = Math.min(...values), vMax = Math.max(...values);
  if (vMax - vMin < 2) { vMin -= 2; vMax += 2; }
  const step = niceStep(vMax - vMin, 5);
  vMin = Math.max(0, Math.floor(vMin / step) * step);
  vMax = Math.ceil(vMax / step) * step;

  const x = t => pad.l + ((t - tMin) / (tMax - tMin)) * iw;
  const y = v => pad.t + ih - ((v - vMin) / (vMax - vMin)) * ih;

  let grid = '';
  for (let v = vMin; v <= vMax + 1e-9; v += step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="grid" x1="${pad.l}" x2="${pad.l + iw}" y1="${yy}" y2="${yy}"/>`;
    grid += `<text class="axis-text" x="${pad.l - 8}" y="${yy}" text-anchor="end" dominant-baseline="middle">${fmt(v, step < 1 ? 1 : 0)}</text>`;
  }
  const spanDays = (tMax - tMin) / 86400000;
  const nLabels = Math.min(6, Math.max(2, Math.floor(iw / 120)));
  for (let i = 0; i < nLabels; i++) {
    const t = tMin + ((tMax - tMin) * i) / (nLabels - 1);
    const dt = new Date(t);
    const label = spanDays > 120
      ? `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getFullYear()).slice(2)}`
      : `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.`;
    const anchor = i === 0 ? 'start' : i === nLabels - 1 ? 'end' : 'middle';
    grid += `<text class="axis-text" x="${(pad.l + (iw * i) / (nLabels - 1)).toFixed(1)}" y="${H - 6}" text-anchor="${anchor}">${label}</text>`;
  }

  const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const clubPath = clubVisible.length > 1 ? `<path class="club" d="${path(clubVisible.map(c => [x(c.t), y(c.v)]))}"/>` : '';

  // Alle Punkte für Hover sammeln
  const points = [];
  let lines = '';
  let dots = '';
  prepared.forEach((p, si) => {
    lines += `<path class="trend" style="stroke:${p.color}" d="${path(p.times.map((t, i) => [x(t), y(p.trend[i])]))}"/>`;
    p.list.forEach((r, i) => {
      const px = x(p.times[i]), py = y(r.total);
      points.push({ px, py, si, i });
      dots += `<circle class="pt ${r.type === 'competition' ? 'comp' : ''}" style="fill:${p.color};stroke:${r.type === 'competition' ? p.color : ''}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" data-pt="${points.length - 1}"/>`;
    });
  });

  // Beschriftung am Linienende, Überlappungen auseinanderschieben
  let labels = '';
  if (directLabels) {
    const ends = prepared.map(p => ({ name: p.member.displayName, y: y(p.trend[p.trend.length - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    labels = ends.map(e => `<text class="end-label" x="${pad.l + iw + 10}" y="${e.y.toFixed(1)}" dominant-baseline="middle">${esc(e.name.length > 16 ? e.name.slice(0, 15) + '…' : e.name)}</text>`).join('');
  }

  container.insertAdjacentHTML('afterbegin', `
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Vergleich der Ergebnisse">
      ${grid}
      ${clubPath}
      ${lines}
      <line class="cursor" id="cmp-cursor" y1="${pad.t}" y2="${pad.t + ih}" visibility="hidden"/>
      ${dots}
      ${labels}
      <rect class="hit" x="${pad.l - 10}" y="0" width="${iw + 20}" height="${H}"/>
    </svg>`);

  const svg = container.querySelector('svg');
  const tip = document.getElementById('tooltip');
  const cursor = document.getElementById('cmp-cursor');
  const circles = svg.querySelectorAll('[data-pt]');

  // pointerdown zusätzlich, damit am Handy schon ein Antippen den Wert zeigt
  const showNearest = e => {
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * W;
    const my = ((e.clientY - rect.top) / rect.height) * H;
    let best = null, bestD = Infinity;
    for (const p of points) {
      const d = (p.px - mx) ** 2 + ((p.py - my) ** 2) / 4; // horizontale Nähe zählt mehr
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return;
    const s = prepared[best.si];
    const r = s.list[best.i];
    circles.forEach((c, j) => c.setAttribute('r', points[j] === best ? 6 : 4));
    cursor.setAttribute('x1', best.px);
    cursor.setAttribute('x2', best.px);
    cursor.setAttribute('visibility', 'visible');
    tip.innerHTML = `
      <div class="tt-head"><span class="swatch" style="background:${s.color}"></span>${esc(s.member.displayName)}</div>
      <div class="tt-row">Datum <b>${fmtDate(r.date)}</b></div>
      <div class="tt-row">Ergebnis <b>${fmtScore(r.total)}</b></div>
      <div class="tt-row">Ø letzte ${TREND_WINDOW} <b>${fmtAvg(s.trend[best.i])}</b></div>
      ${r.type === 'competition' ? `<div class="tt-row">Wettkampf <b>${esc([r.compName, r.location].filter(Boolean).join(' · ') || 'ja')}</b></div>` : ''}
      ${r.series ? `<div class="tt-row">Serien <b>${r.series.map(fmtScore).join(' / ')}</b></div>` : ''}`;
    tip.hidden = false;
    const scale = rect.width / W;
    let left = best.px * scale + 14;
    if (left + tip.offsetWidth > rect.width) left = best.px * scale - tip.offsetWidth - 14;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, best.py * scale - tip.offsetHeight / 2) + 'px';
  };
  svg.addEventListener('pointermove', showNearest);
  svg.addEventListener('pointerdown', showNearest);
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cursor.setAttribute('visibility', 'hidden');
    circles.forEach(c => c.setAttribute('r', 4));
  });
}

let resizeTimer = null;
window.addEventListener('resize', () => {
  checkFilterWrap();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (dash.view === 'compare') render(); }, 150);
});

// ----- Mitglieder -----

function renderMembers() {
  const rows = dash.members.slice().sort((a, b) => a.displayName.localeCompare(b.displayName, 'de')).map(m => `
    <tr>
      <td><div>${esc(m.displayName)}${m.id === dash.me.id ? ' <span class="dash-meta">(du)</span>' : ''}</div></td>
      <td>${fmtDate(m.createdAt)}</td>
      <td class="num">${m.total}</td>
      <td class="num">${fmtDate(m.lastDate)}</td>
      <td>${m.isAdmin ? '<span class="badge" style="margin:0">Admin</span>' : '<span class="dash-meta">Mitglied</span>'}</td>
      <td class="num">
        <button class="btn small" data-admin="${m.id}">${m.isAdmin ? 'Admin entziehen' : 'Zum Admin machen'}</button>
        <button class="btn small" data-reset="${m.id}">Passwort zurücksetzen</button>
        ${m.id === dash.me.id ? '' : `<button class="btn small danger" data-remove="${m.id}">Entfernen</button>`}
      </td>
    </tr>`).join('');

  app.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Mitglieder (${dash.members.length})</h2></div>
      <p class="hint" style="margin:-4px 0 10px">Neue Mitglieder registrieren sich selbst in der App mit dem Vereinscode (siehe „Optionen“). „Ergebnisse“ zählt nur, was für diesen Verein eingetragen und freigegeben ist.</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Name</th><th>Beigetreten</th><th class="num">Ergebnisse</th><th class="num">Letzter Eintrag</th><th>Rolle</th><th class="num">Aktionen</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  const rpc = async (fn, args, ok) => {
    const { error } = await Cloud.client.rpc(fn, args);
    if (error) { toast(Cloud.errorText(error)); return false; }
    toast(ok);
    return true;
  };

  app.querySelectorAll('[data-admin]').forEach(b => b.onclick = async () => {
    const m = memberById(b.dataset.admin);
    const value = !m.isAdmin;
    if (!value && m.id === dash.me.id && !(await dialog('Dir selbst die Admin-Rechte entziehen?\n\nDu kannst das Dashboard danach nicht mehr öffnen.', 'Entziehen', { danger: true }))) return;
    if (await rpc('admin_set_admin', { club: dash.clubId, target: m.id, value }, value ? `${m.displayName} ist jetzt Admin` : `${m.displayName} ist kein Admin mehr`)) {
      await loadAll(dash.me.id);
    }
  });

  app.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const m = memberById(b.dataset.reset);
    const pw = await dialog(`Neues Passwort für ${m.displayName}\n\nMindestens 6 Zeichen. Teile es dem Mitglied persönlich mit.`, 'Passwort setzen', { input: true });
    if (pw === null) return;
    if (pw.length < 6) { toast('Das Passwort muss mindestens 6 Zeichen haben'); return; }
    await rpc('admin_reset_password', { club: dash.clubId, target: m.id, new_password: pw }, 'Passwort geändert');
  });

  app.querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
    const m = memberById(b.dataset.remove);
    const ok = await dialog(`${m.displayName} aus dem Verein entfernen?\n\nDas Mitglied gehört danach nicht mehr zum Verein und taucht hier nicht mehr auf. Sein Konto und seine eigenen Ergebnisse bleiben erhalten. Mit dem Vereinscode kann es wieder beitreten – ändere den Code bei Bedarf unter „Optionen“.`, 'Entfernen', { danger: true });
    if (!ok) return;
    if (await rpc('admin_remove_member', { club: dash.clubId, target: m.id }, `${m.displayName} wurde entfernt`)) {
      dash.compare = dash.compare.filter(id => id !== m.id);
      await loadAll(dash.me.id);
    }
  });
}

// ----- Optionen -----

// Aufklappbarer Bereich wie in den Optionen der App
function collapsible(key, title, body) {
  const open = dash.openSections.has(key);
  return `
    <section class="card narrow collapsible ${open ? 'open' : ''}">
      <button type="button" class="section-head" data-section="${key}" aria-expanded="${open}">
        <h2>${title}</h2>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="section-body">${body}</div>
    </section>`;
}

async function renderClub() {
  const theme = document.documentElement.dataset.theme;
  app.innerHTML = `
    ${collapsible('club', 'Verein', `
      <div class="form-grid">
        <div class="field">
          <label for="c-name">Vereinsname</label>
          <input id="c-name" value="${esc(dash.clubName)}" maxlength="80">
        </div>
        <div class="field">
          <label for="c-location">Ort <span class="optional">(freiwillig)</span></label>
          <input id="c-location" value="" maxlength="80">
        </div>
        <div class="field">
          <label for="c-contact">Ansprechpartner</label>
          <input id="c-contact" value="" maxlength="80" autocomplete="name">
        </div>
        <div class="field">
          <label for="c-email">Kontakt-E-Mail</label>
          <input id="c-email" type="email" value="" maxlength="254" autocomplete="email">
        </div>
      </div>
      <p class="hint">Ansprechpartner und E-Mail sieht nur der Betreiber von Hot Shot, z. B. für Rückfragen.</p>
      <div class="actions"><button class="btn primary" id="c-save">Speichern</button></div>`)}
    ${collapsible('code', 'Vereinscode', `
      <div class="code-layout">
        <div>
          <div class="field">
            <label for="c-code">Vereinscode</label>
            <input id="c-code" class="code-input" value="" placeholder="wird geladen …" autocomplete="off" spellcheck="false" maxlength="30">
          </div>
          <p class="hint">Mit dem Vereinscode oder dem QR-Code registrieren sich neue Mitglieder in der App. Ändere ihn, wenn er in falsche Hände geraten ist – bestehende Mitglieder bleiben im Verein.</p>
          <div class="actions">
            <button class="btn primary" id="c-code-save">Code speichern</button>
            <button class="btn" id="c-code-new">Neuen Code erzeugen</button>
          </div>
        </div>
        <div class="qr-box" id="c-qr" aria-label="QR-Code zum Beitreten"></div>
      </div>`)}
    ${collapsible('export', 'Export', `
      <p class="hint" style="margin:0 0 12px">Alle Ergebnisse aller Mitglieder als CSV-Datei (z. B. für Excel).</p>
      <div class="actions" style="margin-top:0"><button class="btn" id="c-csv">Alle Ergebnisse exportieren</button></div>`)}
    ${collapsible('dissolve', 'Verein auflösen', dash.members.length > 1 ? `
      <p class="hint" style="margin:0">Auflösen geht nur, wenn du das letzte Mitglied bist. Der Verein hat noch ${dash.members.length - 1} weitere${dash.members.length === 2 ? 's Mitglied' : ' Mitglieder'}.
        Möchtest du als Admin aufhören, mach unter „Mitglieder“ jemand anderen zum Admin.</p>` : `
      <p class="hint" style="margin:0 0 12px">Du bist das letzte Mitglied. Beim Auflösen wird der Verein mit Vereinscode gelöscht.
        Dein Konto und deine eigenen Ergebnisse in der App bleiben erhalten. Danach kannst du dein Konto in der App auch löschen.</p>
      <div class="actions" style="margin-top:0"><button class="btn danger" id="c-dissolve">Verein auflösen</button></div>`)}
    <div class="card narrow">
      <div class="account-row">
        <div class="avatar" aria-hidden="true">${esc(dash.me.username.slice(0, 1).toUpperCase())}</div>
        <div class="account-name"><div class="disc-name">${esc(dash.me.username)} <span class="badge">Admin</span></div></div>
      </div>
      <div class="actions">
        <button type="button" class="btn" id="theme-toggle">${theme === 'dark' ? 'Hell' : 'Dunkel'}</button>
        <button type="button" class="btn" id="logout">Abmelden</button>
      </div>
    </div>
    <div class="narrow">${legalLinks()}</div>`;

  app.querySelectorAll('[data-section]').forEach(b => b.onclick = () => {
    const key = b.dataset.section;
    const open = !dash.openSections.has(key);
    if (open) dash.openSections.add(key); else dash.openSections.delete(key);
    b.closest('.collapsible').classList.toggle('open', open);
    b.setAttribute('aria-expanded', open);
  });
  document.getElementById('theme-toggle').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('schuetzen-theme', next); } catch (e) { /* nur für diese Sitzung */ }
    document.documentElement.dataset.theme = next;
    document.getElementById('theme-toggle').textContent = next === 'dark' ? 'Hell' : 'Dunkel';
  };
  document.getElementById('logout').onclick = logoutDash;
  document.getElementById('c-csv').onclick = exportAllCsv;
  const dissolveBtn = document.getElementById('c-dissolve');
  if (dissolveBtn) dissolveBtn.onclick = async () => {
    const typed = await dialog(`„${dash.clubName}“ auflösen?\n\nDer Verein und sein Vereinscode werden endgültig gelöscht. Dein Konto bleibt erhalten.\n\nZum Bestätigen den Vereinsnamen eintippen:`, 'Verein auflösen', { input: true, danger: true });
    if (typed === null) return;
    if (typed.trim() !== dash.clubName) { toast('Der Name stimmt nicht – nichts gelöscht'); return; }
    try {
      await Cloud.call('admin_dissolve_club', { club: dash.clubId });
      toast('Verein aufgelöst');
      dash.clubId = null;
      dash.view = 'ranking';
      await loadAll(dash.me.id);
    } catch (e) { toast(Cloud.errorText(e)); }
  };

  const club = dash.clubId;
  const codeEl = document.getElementById('c-code');
  let info = null;
  try { info = (await Cloud.call('admin_get_club', { club }))[0]; } catch (e) { /* unten Hinweis */ }
  if (dash.view !== 'club' || dash.clubId !== club) return;
  if (!info) { codeEl.placeholder = 'konnte nicht geladen werden'; return; }
  document.getElementById('c-name').value = info.name;
  document.getElementById('c-location').value = info.location || '';
  document.getElementById('c-contact').value = info.contact_name || '';
  document.getElementById('c-email').value = info.contact_email || '';
  const showCode = code => { codeEl.value = code; codeEl.placeholder = ''; drawQr(document.getElementById('c-qr'), inviteLink(code)); };
  showCode(info.code);

  document.getElementById('c-save').onclick = async () => {
    const val = id => document.getElementById(id).value.trim();
    try {
      await Cloud.call('admin_update_club', { club, new_name: val('c-name'), new_location: val('c-location'), new_contact_name: val('c-contact'), new_contact_email: val('c-email') });
      await loadAll(dash.me.id, { silent: true });
      renderHeader();
      toast('Gespeichert');
    } catch (e) { toast(Cloud.errorText(e)); }
  };
  document.getElementById('c-code-save').onclick = async () => {
    try {
      showCode(await Cloud.call('admin_set_club_code', { club, new_code: codeEl.value }));
      toast('Vereinscode gespeichert');
    } catch (e) { toast(Cloud.errorText(e)); }
  };
  document.getElementById('c-code-new').onclick = async () => {
    if (!(await dialog('Neuen Vereinscode erzeugen?\n\nDer bisherige Code und alte QR-Code-Aushänge funktionieren danach nicht mehr. Bestehende Mitglieder bleiben im Verein.', 'Neuen Code erzeugen'))) return;
    try {
      showCode(await Cloud.call('admin_new_club_code', { club }));
      toast('Neuer Vereinscode erzeugt');
    } catch (e) { toast(Cloud.errorText(e)); }
  };
}

// Link zum Beitreten: öffnet die App mit ausgefülltem Vereinscode
function inviteLink(code) {
  return new URL('../?verein=' + encodeURIComponent(code), document.baseURI).href;
}

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrLibLoading = null;
function drawQr(box, text) {
  if (!qrLibLoading) {
    qrLibLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = resolve;
      s.onerror = () => { qrLibLoading = null; reject(new Error('QR')); };
      document.head.appendChild(s);
    });
  }
  qrLibLoading.then(() => {
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }).catch(() => { box.hidden = true; });
}

function exportAllCsv() {
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const num = v => String(v).replace('.', ',');
  const discName = Object.fromEntries(dash.disciplines.map(d => [d.key, d.name]));
  const maxSeries = Math.max(0, ...dash.results.map(r => (r.series ? r.series.length : 0)));
  const head = ['Benutzername', 'Datum', 'Disziplin', 'Art', 'Wettkampf', 'Ort', 'Gesamt'];
  for (let i = 1; i <= maxSeries; i++) head.push(`Serie ${i}`);
  head.push('Notiz');
  const lines = [head.map(cell).join(';')];
  for (const r of dash.results) {
    const m = memberById(r.memberId);
    const row = [m.username, fmtDate(r.date), discName[r.key], r.type === 'competition' ? 'Wettkampf' : 'Training', r.compName, r.location, num(r.total)];
    for (let i = 0; i < maxSeries; i++) row.push(r.series && r.series[i] !== undefined ? num(r.series[i]) : '');
    row.push(r.note);
    lines.push(row.map(cell).join(';'));
  }
  download(`hotshot-verein-${isoOf(new Date())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

// ---------- Start ----------

async function boot() {
  renderHeader();
  if (!Cloud.client) { renderLogin(); return; }
  const session = await Cloud.getSession().catch(() => null);
  if (!session) { renderLogin(); return; }
  try {
    await loadAll(session.user.id);
  } catch (e) {
    renderLogin(Cloud.errorText(e));
  }
}

boot();
