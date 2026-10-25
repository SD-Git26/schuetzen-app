'use strict';

// ---------- Daten ----------

// Speicher der alten Version (ohne Konto); wird beim ersten Anmelden ins Konto übernommen
const LEGACY_KEY = 'schuetzen-app-v1';
// Jedes Konto hat auf dem Gerät eine eigene Kopie seiner Daten (für den Offline-Betrieb)
const stateKey = userId => `hotshot-state-${userId}`;
const dirtyKey = userId => `hotshot-dirty-${userId}`;
const LAST_USER_KEY = 'hotshot-last-user';
const TREND_WINDOW = 5;
const TOMBSTONE_DAYS = 365;

// Vorauswahl beim Eintrag: der feste Standard (Häkchen unter „Anpassen“), sonst die zuletzt
// gewählte Disziplin, beim allerersten Öffnen 1.10 Luftgewehr.
const DEFAULT_DISC_ID = 'dsb-1.10';
const lastDiscKey = userId => `hotshot-last-disc-${userId}`;

// Reihenfolge = Anzeige in Optionen und Auswahl; selbst angelegte Wettkampfarten folgen danach
const DEFAULT_COMPETITION_TYPES = [
  'Pokalschießen',
  'Liga-Wettkampf',
  'Vereinsmeisterschaft',
  'Kreismeisterschaft',
  'Bezirksmeisterschaft',
  'Landesmeisterschaft',
  'Deutsche Meisterschaft',
];

function sortedCompTypes() {
  const rank = c => {
    const i = DEFAULT_COMPETITION_TYPES.findIndex(n => n.toLowerCase() === c.name.trim().toLowerCase());
    return i < 0 ? DEFAULT_COMPETITION_TYPES.length : i;
  };
  return state.competitionTypes.map((c, i) => [c, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([c]) => c);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function newDiscipline(name, decimal, id = uid()) {
  return { id, name, series: 3, shots: 10, decimal, updatedAt: Date.now() };
}

// Feste IDs für die Standardwerte, damit zwei neue Geräte desselben Kontos nichts doppelt anlegen
const slug = s => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/[^a-z0-9]+/g, '-');

function defaultState() {
  return normalizeState({
    version: 1,
    disciplines: [], // Disziplinen der DSB/RSB-Liste kommen beim ersten Ergebnis dazu
    competitionTypes: DEFAULT_COMPETITION_TYPES.map(name => ({ id: 'std-' + slug(name), name, updatedAt: 0 })),
    results: [],
  });
}

function isValidState(s) {
  return s && Array.isArray(s.disciplines) && Array.isArray(s.results);
}

// Ergänzt fehlende Felder (z. B. aus älteren Backups)
function normalizeState(s) {
  // Fester Standard (Häkchen „Als Standard festlegen“); null = zuletzt gewählte Disziplin gilt
  if (!s.disciplines.some(d => d.id === s.defaultDisciplineId) && !isCatalogId(s.defaultDisciplineId)) {
    s.defaultDisciplineId = null;
  }
  delete s.lastDisciplineId;
  // Nicht selbst angepasste Disziplinen der DSB-Liste folgen immer dem aktuellen Stand der Liste
  s.disciplines.forEach(d => {
    const c = !d.adjusted && catalogDisc(d.id);
    if (c) Object.assign(d, { name: c.name, series: c.series, shots: c.shots, decimal: c.decimal, hits: c.hits });
  });
  if (!Array.isArray(s.competitionTypes)) {
    s.competitionTypes = DEFAULT_COMPETITION_TYPES.map(name => ({ id: uid(), name }));
  }
  // Gelöschte IDs mit Zeitpunkt, damit das Löschen auch auf anderen Geräten ankommt
  if (!s.deleted || typeof s.deleted !== 'object') s.deleted = {};
  if (typeof s.settingsUpdatedAt !== 'number') s.settingsUpdatedAt = 0;
  // Gewählte Disziplin-Liste (Optionen): genau eine, DSB oder BDS; ohne Angabe (ältere Stände) DSB
  const set = Array.isArray(s.disciplineSets) && DISCIPLINE_SETS.find(x => s.disciplineSets.includes(x.id));
  s.disciplineSets = [set ? set.id : 'dsb'];
  // Entfallene Altersklassen durch ihren Ersatz ersetzen
  // Freigabe für das Vereins-Dashboard; ohne Angabe (ältere Stände) gilt sie als erteilt
  if (typeof s.shareWithClub !== 'boolean') s.shareWithClub = true;
  // Freigabe je Verein { clubId: true/false }; fehlt ein Verein, gilt shareWithClub
  if (!s.shareWithClubs || typeof s.shareWithClubs !== 'object' || Array.isArray(s.shareWithClubs)) s.shareWithClubs = {};
  // Aktiver Verein (Optionen); null = der älteste Verein
  if (typeof s.activeClubId !== 'string') s.activeClubId = null;
  const ageId = id => (ageClassById(id) ? ageClassById(id).id : null);
  s.ageClassId = ageId(s.ageClassId);
  s.results.forEach(r => { if (r.ageClassId) r.ageClassId = ageId(r.ageClassId); });
  // Ältere Einträge ohne Angabe gelten als Training
  s.results.forEach(r => { if (r.type !== 'competition') { r.type = 'training'; r.competition = null; } });
  return s;
}

// Zeitstempel für den Abgleich zwischen Geräten
function touch(item) { item.updatedAt = Date.now(); return item; }
function markDeleted(id) { state.deleted[id] = Date.now(); }

// Führt zwei Stände zusammen (dieses Gerät + Cloud): pro Eintrag gewinnt die neuere Änderung,
// Gelöschtes bleibt gelöscht, sofern es danach nicht noch einmal bearbeitet wurde.
function mergeStates(a, b) {
  a = normalizeState(a);
  b = normalizeState(JSON.parse(JSON.stringify(b)));
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
  const deleted = {};
  for (const src of [a.deleted, b.deleted]) {
    for (const [id, t] of Object.entries(src)) if (t > cutoff) deleted[id] = Math.max(t, deleted[id] || 0);
  }
  const stamp = x => x.updatedAt || x.createdAt || 0;
  const mergeList = (la, lb) => {
    const map = new Map();
    for (const x of la) map.set(x.id, x);
    for (const x of lb) { const cur = map.get(x.id); if (!cur || stamp(x) > stamp(cur)) map.set(x.id, x); }
    return [...map.values()].filter(x => !(deleted[x.id] >= stamp(x)));
  };
  const newer = b.settingsUpdatedAt > a.settingsUpdatedAt ? b : a;
  return normalizeState({
    version: 1,
    disciplines: mergeList(a.disciplines, b.disciplines),
    competitionTypes: mergeList(a.competitionTypes, b.competitionTypes),
    results: mergeList(a.results, b.results),
    deleted,
    defaultDisciplineId: newer.defaultDisciplineId,
    ageClassId: newer.ageClassId,
    disciplineSets: newer.disciplineSets,
    shareWithClub: newer.shareWithClub,
    shareWithClubs: newer.shareWithClubs,
    activeClubId: newer.activeClubId,
    settingsUpdatedAt: newer.settingsUpdatedAt,
  });
}

// Übernimmt fremde Daten (alte Version auf dem Gerät) zusätzlich in den aktuellen Stand.
// Gleichnamige Disziplinen und Wettkampfarten werden zusammengelegt statt doppelt angelegt.
function importInto(target, incoming) {
  incoming = normalizeState(incoming);
  const byName = (list, name) => list.find(x => x.name.toLowerCase() === name.toLowerCase());
  const discMap = {};
  const compMap = {};
  incoming.disciplines.forEach(d => {
    const same = byName(target.disciplines, d.name);
    if (same) discMap[d.id] = same.id;
    else if (!target.disciplines.some(x => x.id === d.id)) target.disciplines.push(touch({ ...d }));
  });
  incoming.competitionTypes.forEach(c => {
    const same = byName(target.competitionTypes, c.name);
    if (same) compMap[c.id] = same.id;
    else if (!target.competitionTypes.some(x => x.id === c.id)) target.competitionTypes.push(touch({ ...c }));
  });
  let added = 0;
  incoming.results.forEach(r => {
    if (target.results.some(x => x.id === r.id)) return;
    const copy = touch(JSON.parse(JSON.stringify(r)));
    copy.disciplineId = discMap[r.disciplineId] || r.disciplineId;
    if (copy.competition && copy.competition.typeId) copy.competition.typeId = compMap[copy.competition.typeId] || copy.competition.typeId;
    target.results.push(copy);
    added++;
  });
  return added;
}

// JSON mit sortierten Schlüsseln – die Cloud-Datenbank ändert die Reihenfolge der Felder
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
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

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function loadState(userId) {
  const s = readJSON(stateKey(userId));
  return isValidState(s) ? normalizeState(s) : defaultState();
}

// Angemeldetes Konto: { userId, username, displayName, isAdmin }
let account = null;
let state = defaultState();

// Nur auf dem Gerät speichern (ohne Abgleich)
function storeLocal() {
  try {
    localStorage.setItem(stateKey(account.userId), JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

// Speichern nach jeder Änderung: sofort auf dem Gerät, kurz danach in der Cloud
function saveState() {
  if (!storeLocal()) toast('Speichern auf dem Gerät fehlgeschlagen');
  setDirty(true);
  sync.localVersion++;
  scheduleSync();
}

// ---------- Cloud-Abgleich ----------

const sync = {
  status: 'idle',   // idle | syncing | ok | offline | error | auth
  lastSync: null,   // Zeitpunkt des letzten erfolgreichen Abgleichs
  running: false,
  again: false,
  timer: null,
  localVersion: 0,  // zählt lokale Änderungen, um Änderungen während des Abgleichs zu erkennen
};

function isDirty() {
  try { return !!account && localStorage.getItem(dirtyKey(account.userId)) === '1'; } catch (e) { return true; }
}

function setDirty(on) {
  try {
    if (on) localStorage.setItem(dirtyKey(account.userId), '1');
    else localStorage.removeItem(dirtyKey(account.userId));
  } catch (e) { /* ohne Speicher kein Merker */ }
}

function scheduleSync(delay = 800) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, delay);
}

// Der Abgleich läuft unsichtbar im Hintergrund. Oben rechts erscheint nur dann ein Hinweis,
// wenn die Anmeldung abgelaufen ist – sonst würden Änderungen nie hochgeladen.
function setSyncStatus(status) {
  sync.status = status;
  const el = document.getElementById('sync-status');
  el.hidden = !account || status !== 'auth';
  el.dataset.status = status;
  const box = document.getElementById('sync-detail');
  if (box) box.innerHTML = syncDetailText();
  if (status === 'auth' && ui.tab === 'options') refreshAfterSync(); // Knopf „Neu anmelden“ zeigen
}

function syncDetailText() {
  if (!Cloud.client) return 'Keine Verbindung zur Cloud – die Daten werden vorerst nur auf diesem Gerät gespeichert.';
  const when = sync.lastSync ? sync.lastSync.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : null;
  switch (sync.status) {
    case 'syncing': return 'Wird gerade mit der Cloud abgeglichen …';
    case 'ok': return `Alle Daten sind in der Cloud gesichert${when ? ` (zuletzt ${when})` : ''}.`;
    case 'offline': return 'Offline – Änderungen werden hochgeladen, sobald wieder Internet da ist.';
    case 'auth': return 'Die Anmeldung ist abgelaufen. Bitte ab- und wieder anmelden; deine Daten auf diesem Gerät bleiben erhalten.';
    case 'error': return 'Hochladen fehlgeschlagen – wird automatisch erneut versucht.';
    default: return isDirty() ? 'Noch nicht hochgeladene Änderungen vorhanden.' : '';
  }
}

function isAuthError(e) {
  const m = String((e && e.message) || '');
  return (e && (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303')) || /jwt|not authenticated/i.test(m);
}

// Holt den Stand aus der Cloud, führt ihn mit diesem Gerät zusammen und lädt das Ergebnis hoch.
// Hat ein anderes Gerät zwischendurch gespeichert, wird es erneut versucht.
async function syncNow() {
  clearTimeout(sync.timer);
  if (!account || !Cloud.client) return;
  if (sync.running) { sync.again = true; return; }
  if (!navigator.onLine) { setSyncStatus('offline'); return; }
  const userId = account.userId;
  sync.running = true;
  setSyncStatus('syncing');
  try {
    const db = Cloud.client.from('user_state');
    for (let attempt = 0; attempt < 4; attempt++) {
      const versionBefore = sync.localVersion;
      const { data: row, error } = await db.select('state, updated_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      if (!account || account.userId !== userId) return;

      const remote = row && isValidState(row.state) ? row.state : null;
      const remoteCanon = remote ? canonical(remote) : null;
      // Ohne eigene Änderungen gilt der Stand aus der Cloud, sonst wird zusammengeführt
      const next = !remote ? state : isDirty() ? mergeStates(state, remote) : normalizeState(remote);
      if (canonical(next) !== canonical(state)) {
        state = next;
        storeLocal();
        refreshAfterSync();
      }
      if (remote && canonical(state) === remoteCanon) {
        if (sync.localVersion === versionBefore) setDirty(false);
        break;
      }

      const res = row
        ? await db.update({ state }).eq('user_id', userId).eq('updated_at', row.updated_at).select('updated_at')
        : await db.insert({ user_id: userId, state }).select('updated_at');
      if (res.error && res.error.code === '23505') continue;  // Zeile wurde gerade von einem anderen Gerät angelegt
      if (res.error) throw res.error;
      if (!res.data || res.data.length === 0) continue;      // anderes Gerät war schneller
      if (sync.localVersion === versionBefore) setDirty(false);
      break;
    }
    sync.lastSync = new Date();
    setSyncStatus(isDirty() && !sync.again ? 'error' : 'ok');
    tagOldResults();
  } catch (e) {
    setSyncStatus(isAuthError(e) ? 'auth' : navigator.onLine ? 'error' : 'offline');
    if (sync.status === 'error') scheduleSync(30000);
  } finally {
    sync.running = false;
    if (sync.again) { sync.again = false; scheduleSync(0); }
  }
}

// Nach einem Abgleich neu zeichnen – aber nicht, während jemand gerade tippt
function refreshAfterSync() {
  const a = document.activeElement;
  if (a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  if (!document.body.classList.contains('logged-out')) render();
}

window.addEventListener('online', () => scheduleSync(0));
window.addEventListener('offline', () => { if (account) setSyncStatus('offline'); });
document.addEventListener('visibilitychange', () => {
  // Beim Zurückkehren in die App Änderungen von anderen Geräten holen
  if (document.visibilityState === 'visible' && account) scheduleSync(0);
});
// Sicherheitsnetz: Handys melden die Rückkehr ins Netz nicht immer zuverlässig.
// Solange noch etwas hochzuladen ist, regelmäßig erneut versuchen.
setInterval(() => {
  if (account && isDirty() && !sync.running && sync.status !== 'auth' && navigator.onLine
    && document.visibilityState === 'visible') syncNow();
}, 20000);
document.getElementById('sync-status').addEventListener('click', () => {
  endSession('Bitte melde dich erneut an.', true);
});

// ---------- Vereine ----------

// Vereine des Kontos, der älteste zuerst; auf dem Gerät zwischengespeichert für den Offline-Betrieb.
// [{ id, name, location, is_admin, status, joined_at, code (nur für Admins) }]
let clubs = [];
const clubsKey = userId => `hotshot-clubs-${userId}`;

function clubById(id) { return clubs.find(c => c.id === id) || null; }

// Aktiver Verein: für ihn zählen neue Ergebnisse. Festgelegt unter Optionen (state.activeClubId,
// gilt auf allen Geräten), sonst der älteste Verein.
function currentClubId() {
  return (clubById(state.activeClubId) || clubs[0] || { id: '' }).id;
}

// Zustimmung zur Vereinsanalyse für einen Verein; ohne eigene Angabe gilt die allgemeine
function sharesWith(clubId) {
  const v = state.shareWithClubs[clubId];
  return typeof v === 'boolean' ? v : state.shareWithClub;
}

async function refreshClubs() {
  if (!Cloud.client || !navigator.onLine || !account) return;
  const userId = account.userId;
  try {
    const list = await Cloud.myClubs();
    if (!account || account.userId !== userId) return;
    const changed = JSON.stringify(list) !== JSON.stringify(clubs);
    clubs = list;
    try { localStorage.setItem(clubsKey(userId), JSON.stringify(clubs)); } catch (e) { /* dann beim nächsten Start neu laden */ }
    tagOldResults();
    if (changed) refreshAfterSync();
  } catch (e) { /* beim nächsten Start erneut */ }
}

// Ergebnisse aus der Zeit vor den Vereinen gehören zum ältesten Verein (so wertet es auch die Datenbank)
function tagOldResults() {
  if (!clubs.length) return;
  const old = state.results.filter(r => r.clubId === undefined || r.clubId === null);
  if (!old.length) return;
  old.forEach(r => touch(Object.assign(r, { clubId: clubs[0].id })));
  saveState();
}

// Link zum Beitreten, z. B. für den QR-Code: öffnet die App mit ausgefülltem Vereinscode
function inviteLink(code) {
  return new URL('?verein=' + encodeURIComponent(code), document.baseURI).href;
}

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrLibLoading = null;
function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  if (!qrLibLoading) {
    qrLibLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = QR_LIB;
      s.onload = resolve;
      s.onerror = () => { qrLibLoading = null; reject(new Error('QR')); };
      document.head.appendChild(s);
    });
  }
  return qrLibLoading;
}

// Vereinscode mit QR-Code zum Weitergeben; created = gleich nach dem Anlegen des Vereins
function showClubCode(club, created) {
  const dlg = document.createElement('dialog');
  dlg.className = 'confirm club-code-dialog';
  dlg.innerHTML = `
    <p class="confirm-title">${created ? 'Dein Verein ist eingerichtet!' : esc(club.name)}</p>
    <p class="confirm-text">${created
      ? `„${esc(club.name)}“ ist angelegt und du bist Admin. Gib deinen Mitgliedern diesen Vereinscode oder lass sie den QR-Code scannen:`
      : 'Mit diesem Code oder dem QR-Code registrieren sich neue Mitglieder in der App:'}</p>
    <div class="club-code-big">${esc(club.code)}</div>
    <div class="qr-box" aria-label="QR-Code zum Beitreten"></div>
    <p class="hint qr-hint">Tipp: Mach ein Bildschirmfoto und häng den QR-Code im Schützenhaus aus.</p>
    <div class="actions">
      <button type="button" class="btn" data-copy>Code kopieren</button>
      ${navigator.share ? '<button type="button" class="btn" data-share-link>Teilen</button>' : ''}
      <button type="button" class="btn primary" data-close>Fertig</button>
    </div>`;
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-close]').onclick = close;
  dlg.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dlg.querySelector('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(club.code); toast('Code kopiert'); } catch (e) { toast('Kopieren nicht möglich'); }
  };
  const shareBtn = dlg.querySelector('[data-share-link]');
  if (shareBtn) shareBtn.onclick = () => navigator.share({
    title: 'Hot Shot',
    text: `Tritt „${club.name}“ in Hot Shot bei. Vereinscode: ${club.code}`,
    url: inviteLink(club.code),
  }).catch(() => {});
  document.body.appendChild(dlg);
  dlg.showModal();
  const box = dlg.querySelector('.qr-box');
  loadQrLib().then(() => {
    const qr = window.qrcode(0, 'M');
    qr.addData(inviteLink(club.code));
    qr.make();
    box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }).catch(() => { box.remove(); dlg.querySelector('.qr-hint').textContent = 'QR-Code konnte nicht geladen werden (keine Internetverbindung?).'; });
}

// Angaben für einen neuen Verein; p = Präfix der Feld-IDs, v = bisherige Eingaben
function clubFields(p, v) {
  return `
    <div class="field">
      <label for="${p}-club-name">Vereinsname</label>
      <input id="${p}-club-name" name="clubName" value="${esc(v.clubName)}" maxlength="80" placeholder="z. B. Sportschützen Musterstadt">
    </div>
    <div class="field">
      <label for="${p}-club-location">Ort <span class="optional">(freiwillig)</span></label>
      <input id="${p}-club-location" name="clubLocation" value="${esc(v.clubLocation)}" maxlength="80">
    </div>
    <div class="field">
      <label for="${p}-contact-name">Dein Name</label>
      <input id="${p}-contact-name" name="contactName" value="${esc(v.contactName)}" maxlength="80" autocomplete="name" placeholder="Ansprechpartner für den Verein">
    </div>
    <div class="field">
      <label for="${p}-contact-email">Kontakt-E-Mail</label>
      <input id="${p}-contact-email" name="contactEmail" type="email" value="${esc(v.contactEmail)}" maxlength="254" autocomplete="off" autocapitalize="none" spellcheck="false">
      <p class="hint">Nur für Rückfragen zum Verein. Angemeldet wird weiter mit Benutzername und Passwort.</p>
    </div>`;
}

function termsField(p, checked) {
  return `
    <label class="switch subtle terms">
      <input type="checkbox" id="${p}-terms" name="accept" ${checked ? 'checked' : ''}>
      <span>Ich akzeptiere im Namen des Vereins die <a href="${new URL('rechtliches/nutzungsbedingungen.html', document.baseURI).href}" target="_blank" rel="noopener">Nutzungsbedingungen</a>
        und den <a href="${new URL('rechtliches/av-vertrag.html', document.baseURI).href}" target="_blank" rel="noopener">AV-Vertrag</a>.</span>
    </label>`;
}

// Prüft die Vereinsangaben und liefert sie so, wie die Datenbank sie erwartet – oder eine Fehlermeldung
function newClubFrom(v) {
  const name = v.clubName.trim();
  const contact = v.contactName.trim();
  const email = v.contactEmail.trim();
  if (name.length < 2) return { error: 'Bitte den Vereinsnamen eingeben' };
  if (contact.length < 2) return { error: 'Bitte deinen Namen eingeben' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Bitte eine gültige E-Mail-Adresse eingeben' };
  if (!v.accept) return { error: 'Bitte die Nutzungsbedingungen und den AV-Vertrag akzeptieren' };
  return { club: { name, location: v.clubLocation.trim(), contact_name: contact, contact_email: email, accept_terms: true } };
}

const emptyClubForm = () => ({ clubName: '', clubLocation: '', contactName: '', contactEmail: '', accept: false });

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
  return state.disciplines.find(d => d.id === id) || catalogDisc(id);
}

function isCatalogId(id) {
  return DISCIPLINE_CATALOG.some(c => c.id === id);
}

// Disziplin aus der DSB/RSB-Liste mit Voreinstellungen. In die eigenen Daten (state.disciplines)
// kommt sie erst beim ersten Ergebnis oder wenn Serien/Wertung angepasst werden.
function catalogDisc(id) {
  const c = DISCIPLINE_CATALOG.find(x => x.id === id);
  return c ? { id: c.id, name: c.name, series: c.series, shots: c.shots, decimal: c.decimal, hits: c.hits, updatedAt: 0 } : null;
}

// Fügt eine Disziplin aus der Liste den eigenen Daten hinzu (falls noch nicht geschehen)
function adoptDisc(d) {
  const own = state.disciplines.find(x => x.id === d.id);
  if (own) return own;
  state.disciplines.push(touch(d));
  return d;
}

// Für Auswahllisten in Schießbuch und Analyse: nur Disziplinen, die man schon benutzt hat
function sortedDisciplines() {
  return state.disciplines.slice().sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
}

function shotMax(d) { return d.hits ? 1 : d.decimal ? 10.9 : 10; }
function scoringLabel(d) { return d.hits ? 'Treffer' : d.decimal ? 'Zehntelwertung' : 'Ganze Ringe'; }
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

// Wichtige Meldung, die man bestätigen muss (für Hinweise, die in einer kurzen Einblendung untergehen würden)
function showNotice(title, text) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm';
    dlg.innerHTML = `
      <p class="confirm-title">${esc(title)}</p>
      <p class="confirm-text">${esc(text)}</p>
      <div class="actions"><button type="button" class="btn primary" data-ok>OK</button></div>`;
    const finish = () => { dlg.close(); dlg.remove(); resolve(); };
    dlg.querySelector('[data-ok]').onclick = finish;
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(); });
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

const TITLES = { entry: 'Eintrag', history: 'Schießbuch', analysis: 'Analyse', options: 'Optionen' };

const ui = {
  tab: 'entry',
  draft: null,          // Formular "Eintragen"
  editId: null,         // Ergebnis, das gerade bearbeitet wird
  historyFilter: 'all',
  historyKind: 'all',   // Schießbuch: alle, nur Training oder nur Wettkampf
  analysisDiscId: null,
  period: 'all',
  kind: 'all',          // Analyse: alle, nur Training oder nur Wettkampf
  selectedPoint: null,
  lines: { data: true, trend: true }, // sichtbare Linien im Ergebnisverlauf
  editDiscId: null,     // Disziplin, die gerade bearbeitet wird ('new' = neue)
  adjustDisc: false,    // Eintrag: Serien/Wertung der gewählten Disziplin anpassen
  editCompId: null,     // Wettkampfart, die gerade umbenannt wird
  openSections: new Set(), // aufgeklappte Bereiche in den Optionen
  foundClub: false,     // Optionen: Formular „Neuen Verein gründen“ offen
  clubForm: null,       // Eingaben dafür
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

// Eigene Disziplinen gehören immer dazu, aus den Listen nur die unter Optionen gewählte (DSB oder BDS)
function inActiveSet(id) {
  const c = DISCIPLINE_CATALOG.find(x => x.id === id);
  return !c || state.disciplineSets.includes(c.set);
}

// Standard, sonst zuletzt gewählte, sonst erste Disziplin der gewählten Liste
function standardDisc() {
  let last = null;
  try { last = account && localStorage.getItem(lastDiscKey(account.userId)); } catch (e) { /* kein Speicher */ }
  const first = DISCIPLINE_CATALOG.find(c => state.disciplineSets.includes(c.set));
  return [state.defaultDisciplineId, last, DEFAULT_DISC_ID, first && first.id]
    .filter(id => id && inActiveSet(id)).map(discById).find(Boolean);
}

function freshDraft() {
  const d = standardDisc();
  return {
    disciplineId: d ? d.id : null,
    date: todayISO(),
    totalOnly: true, // Standard: nur Gesamtergebnis, Einzelserien optional
    series: d ? Array(d.series).fill('') : [],
    total: '',
    note: '',
    isComp: false, // Standard ist Training
    compTypeId: '',
    location: '',
    ageClassId: state.ageClassId || '', // Standard aus den Optionen
    clubId: currentClubId(),
  };
}

// Auswahlliste der Altersklassen; long = mit Alter und Jahrgängen (in den Optionen)
function ageClassOptions(selectedId, long) {
  return `<option value="">${long ? '– keine Angabe –' : '–'}</option>` + AGE_CLASSES.map(c =>
    `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${esc(c.name)}${long ? ` · ${esc(c.age)} J. (${esc(c.years)})` : ''}</option>`).join('');
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
    ageClassId: ageClassById(r.ageClassId) ? r.ageClassId : '',
    clubId: r.clubId === undefined || r.clubId === null ? (clubs[0] ? clubs[0].id : '') : r.clubId,
  };
}

function renderEntry() {
  if (!ui.draft || !discById(ui.draft.disciplineId)) ui.draft = freshDraft();
  const dr = ui.draft;
  // Solange beim neuen Eintrag nichts selbst gewählt wurde, gelten die aktuellen Standards –
  // auch wenn sie erst nach dem Start (Abgleich mit der Cloud) ankommen
  if (!ui.editId) {
    if (!dr.ageTouched) dr.ageClassId = state.ageClassId || '';
    dr.clubId = currentClubId();
    // Nach dem Wechsel der Liste unter Optionen: Disziplin aus der anderen Liste nicht stehen lassen
    if (!dr.discTouched || !inActiveSet(dr.disciplineId)) {
      const std = standardDisc();
      if (std && std.id !== dr.disciplineId) dr.disciplineId = std.id;
    }
  }
  const d = discById(dr.disciplineId);

  // Serienanzahl an Disziplin anpassen (bestehende Eingaben bleiben erhalten)
  if (dr.series.length !== d.series) {
    dr.series = Array.from({ length: d.series }, (_, i) => dr.series[i] || '');
  }

  const seriesInputs = dr.series.map((v, i) => `
    <div>
      <label for="s${i}">Serie ${i + 1}</label>
      <input id="s${i}" data-series="${i}" inputmode="numeric" autocomplete="off" value="${esc(v)}" placeholder="${fmtScore(0, d)}">
    </div>`).join('');

  view.innerHTML = `
    <div class="card">
      <div class="field">
        <label for="disc">Disziplin</label>
        <div class="combo">
          <input id="disc" class="combo-input" role="combobox" aria-expanded="false" aria-controls="disc-list" aria-autocomplete="list"
            autocomplete="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" readonly
            value="${esc(d.name)}" placeholder="Kennzahl oder Name, z. B. 2.11">
          <div class="combo-list" id="disc-list" role="listbox" aria-label="Disziplinen" hidden></div>
        </div>
      </div>
      <div class="disc-info">
        <p class="hint">${d.series} × ${d.shots} Schuss · ${scoringLabel(d)} · max. ${fmtScore(totalMax(d), d)}</p>
        ${ui.adjustDisc ? '' : '<button type="button" class="link-btn" id="adjust-disc">Anpassen</button>'}
      </div>
      ${ui.adjustDisc ? `<div class="adjust-box">${discEditForm(d, true)}</div>` : ''}
      <div class="row date-age">
        <div class="field">
          <label for="date">Datum</label>
          <input id="date" type="date" value="${dr.date}" max="${todayISO()}">
        </div>
        <div class="field">
          <label for="entry-age">Altersklasse</label>
          <select id="entry-age">${ageClassOptions(dr.ageClassId, false)}</select>
        </div>
      </div>

      ${dr.totalOnly ? `
        <div class="field total-field">
          <label for="total">Gesamtergebnis</label>
          <input id="total" inputmode="numeric" autocomplete="off" value="${esc(dr.total)}" placeholder="${fmtScore(0, d)}">
        </div>` : `
        <div class="series-grid" style="grid-template-columns:repeat(${d.series <= 4 ? d.series : (d.series % 4 === 0 ? 4 : 3)}, 1fr)">${seriesInputs}</div>
        <div class="sum-line"><span class="label">Gesamt</span><span class="sum" id="sum">–</span></div>`}

      <label class="comp-toggle series-toggle">
        <input type="checkbox" class="toggle" role="switch" id="total-only" ${dr.totalOnly ? '' : 'checked'}>
        <span>Einzelserien eintragen</span>
      </label>

      <div id="entry-error" class="error" hidden></div>

      <div class="comp-box ${dr.isComp ? 'open' : ''}">
        <label class="comp-toggle">
          <input type="checkbox" class="toggle" role="switch" id="is-comp" ${dr.isComp ? 'checked' : ''}>
          <span>Wettkampf</span>
        </label>
        ${dr.isComp ? `
        <div class="comp-fields">
          <div class="field">
            <label for="comp-type">Art</label>
            <select id="comp-type">
              <option value="">– ohne Angabe –</option>
              ${sortedCompTypes().map(c => `<option value="${c.id}" ${c.id === dr.compTypeId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
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
        <textarea id="note" rows="1" placeholder="Besondere Hinweise">${esc(dr.note)}</textarea>
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
      // Noch keine Serie eingetragen: vorher eingegebenes Gesamtergebnis weiter anzeigen
      sumEl.textContent = valid.length ? fmtScore(round1(valid.reduce((a, b) => a + b, 0)), d) : (dr.total || '–');
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

  bindDiscCombo(document.getElementById('disc'), document.getElementById('disc-list'), d, id => {
    dr.disciplineId = id;
    dr.discTouched = true;
    // Zuletzt gewählte Disziplin merken (gilt als Vorauswahl, solange kein fester Standard gesetzt ist)
    try { localStorage.setItem(lastDiscKey(account.userId), id); } catch (e) { /* dann nur bis zum Schließen */ }
    ui.adjustDisc = false;
    render();
  });
  if (ui.adjustDisc) {
    bindDiscForm(d.id, () => { ui.adjustDisc = false; render(); });
  } else {
    document.getElementById('adjust-disc').onclick = () => { ui.adjustDisc = true; render(); };
  }
  document.getElementById('date').oninput = e => { dr.date = e.target.value; };
  document.getElementById('entry-age').onchange = e => {
    dr.ageClassId = e.target.value;
    dr.ageTouched = true;
    // Noch kein Standard (z. B. nach dem ersten Login): die erste Auswahl wird zum Standard wie unter Optionen
    if (!ageClassById(state.ageClassId) && ageClassById(dr.ageClassId)) {
      state.ageClassId = dr.ageClassId;
      state.settingsUpdatedAt = Date.now();
      saveState();
      toast(`${ageClassById(dr.ageClassId).name} ist jetzt deine Standard-Altersklasse`);
    }
  };
  // Notizfeld wächst mit dem Text mit
  const noteEl = document.getElementById('note');
  const fitNote = () => { noteEl.style.height = 'auto'; noteEl.style.height = noteEl.scrollHeight + 2 + 'px'; };
  noteEl.oninput = () => { dr.note = noteEl.value; fitNote(); };
  if (dr.note) fitNote();
  document.getElementById('total-only').onchange = e => {
    dr.totalOnly = !e.target.checked;
    // Zurück zum Gesamtergebnis: bereits eingetragene Serien als Summe übernehmen
    if (dr.totalOnly) {
      const valid = dr.series.map(parseNum).filter(n => n !== null && !Number.isNaN(n));
      if (valid.length) dr.total = fmtScore(round1(valid.reduce((a, b) => a + b, 0)), d);
    }
    render();
  };
  document.getElementById('is-comp').onchange = e => { dr.isComp = e.target.checked; render(); };
  if (dr.isComp) {
    document.getElementById('comp-type').onchange = e => { dr.compTypeId = e.target.value; };
    document.getElementById('comp-location').oninput = e => { dr.location = e.target.value; };
  }

  // Eingabe nur als Ziffern. Bei Zehntelwertung setzt die App das Komma selbst ("1014" → "101,4"),
  // bei ganzen Ringen und Treffern gibt es kein Komma.
  function readInput(el) {
    el.value = d.decimal ? autoComma(el.value) : el.value.replace(/\D/g, '');
    return el.value;
  }

  // Eingabe ist fertig, wenn sie gültig ist und jede weitere Ziffer das Maximum überschreiten würde
  // (z. B. bei max. 109,0: "98,5" ist fertig, "10,5" könnte noch zu "105,x" werden)
  function isComplete(value, max) {
    const digits = value.replace(/\D/g, '');
    if (!digits || scoreError(parseNum(value), max, d)) return false;
    return parseNum(d.decimal ? autoComma(digits + '0') : digits + '0') > max;
  }

  if (dr.totalOnly) {
    const totalEl = document.getElementById('total');
    totalEl.oninput = () => {
      dr.total = readInput(totalEl);
      validate(false);
      if (isComplete(totalEl.value, totalMax(d))) totalEl.blur();
    };
    totalEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); totalEl.blur(); } };
    totalEl.onblur = () => { dr.total = totalEl.value = formatInput(totalEl.value, totalMax(d), d); validate(false); };
  } else {
    view.querySelectorAll('[data-series]').forEach(el => {
      const isLast = +el.dataset.series === dr.series.length - 1;
      el.oninput = () => {
        dr.series[+el.dataset.series] = readInput(el);
        validate(false);
        // Letzte Serie fertig: Tastatur schließen
        if (isLast && isComplete(el.value, seriesMax(d))) el.blur();
      };
      el.onblur = () => { dr.series[+el.dataset.series] = el.value = formatInput(el.value, seriesMax(d), d); validate(false); };
      el.onkeydown = e => {
        if (e.key === 'Enter') {
          const next = document.getElementById('s' + (+el.dataset.series + 1));
          e.preventDefault();
          if (next) next.focus(); else el.blur();
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
      if (nums.some(n => n === null)) { errorEl.hidden = false; errorEl.textContent = 'Bitte alle Serien ausfüllen (oder den Haken bei „Einzelserien eintragen“ entfernen)'; return; }
      series = nums;
      total = round1(nums.reduce((a, b) => a + b, 0));
    }

    adoptDisc(d);
    const fields = {
      disciplineId: d.id,
      date: dr.date,
      series,
      total,
      note: dr.note.trim(),
      type: dr.isComp ? 'competition' : 'training',
      competition: dr.isComp ? { typeId: dr.compTypeId || null, location: dr.location.trim() } : null,
      ageClassId: dr.ageClassId || null,
      // Noch kein Verein bekannt (z. B. offline beim ersten Start): wird später dem ältesten Verein zugeordnet
      clubId: dr.clubId || null,
    };
    if (ui.editId) {
      const r = state.results.find(x => x.id === ui.editId);
      if (r) touch(Object.assign(r, fields));
      toast('Änderungen gespeichert');
    } else {
      state.results.push({ id: uid(), ...fields, createdAt: Date.now(), updatedAt: Date.now() });
      toast(`${fmtScore(total, d)} Ringe gespeichert${dr.isComp ? ' (Wettkampf)' : ''}`);
    }
    saveState();

    const wasEdit = !!ui.editId;
    ui.editId = null;
    ui.draft = null;
    if (wasEdit) setTab('history'); else render();
  };
}

// Einträge der Disziplin-Auswahl: eigene Disziplinen zuerst, dann die DSB/RSB-Liste
function discChoices(keepId) {
  const own = state.disciplines.filter(d => !isCatalogId(d.id))
    .map(d => ({ id: d.id, code: '', title: d.name, name: d.name, meta: '', group: 'Eigene Disziplinen' }));
  // Nur die unter Optionen gewählte Liste; beim Bearbeiten eines alten Ergebnisses bleibt dessen Disziplin drin
  const catalog = DISCIPLINE_CATALOG.filter(c => inActiveSet(c.id) || c.id === keepId).map(c => ({
    id: c.id,
    code: c.code,
    title: c.title,
    name: c.name,
    meta: [c.distance, c.caliber, `${c.series * c.shots} ${c.hits && !c.code.startsWith('8.') ? 'Scheiben' : 'Schuss'}`, c.source === 'RSB' ? 'RSB Liste B' : ''].filter(Boolean).join(' · '),
    group: c.group,
    // BDS: Disziplin steht nur in der Gruppe, soll beim Tippen (z. B. „speed“) aber gefunden werden
    search: c.set === 'bds' ? c.group : '',
  }));
  return own.concat(catalog);
}

// Disziplin-Auswahl zum Aufklappen und Tippen: „2.11“ springt auf genau diese Kennzahl,
// ein Wortteil wie „auflage“ filtert die Liste. Übernommen wird per Antippen oder Enter.
function bindDiscCombo(input, list, current, onPick) {
  const choices = discChoices(ui.editId ? current.id : null);
  let shown = [];
  let active = -1;
  const norm = s => s.trim().toLowerCase().replace(',', '.');

  function draw(query) {
    const q = norm(query);
    shown = q ? choices.filter(c => c.code.toLowerCase().startsWith(q) || `${c.title} ${c.meta} ${c.search || ''}`.toLowerCase().includes(q)) : choices;
    active = q ? Math.max(0, shown.findIndex(c => c.code.toLowerCase() === q)) : shown.findIndex(c => c.id === current.id);
    if (shown.length === 0) active = -1;
    let html = '';
    let group = null;
    shown.forEach((c, i) => {
      if (c.group !== group) { group = c.group; html += `<div class="combo-group">${esc(group)}</div>`; }
      html += `
        <div class="combo-opt" role="option" id="disc-opt-${i}" data-i="${i}" aria-selected="false">
          ${c.code ? `<span class="combo-code">${esc(c.code)}</span>` : ''}
          <span class="combo-title">${esc(c.title)}${c.meta ? `<small>${esc(c.meta)}</small>` : ''}</span>
        </div>`;
    });
    list.innerHTML = html || '<div class="combo-empty">Keine Disziplin gefunden</div>';
    mark();
  }

  function mark() {
    list.querySelectorAll('.combo-opt').forEach(el => {
      const on = +el.dataset.i === active;
      el.classList.toggle('active', on);
      el.setAttribute('aria-selected', on);
    });
    input.setAttribute('aria-activedescendant', active >= 0 ? 'disc-opt-' + active : '');
    // Nur die Liste scrollen, nicht die ganze Seite
    const el = document.getElementById('disc-opt-' + active);
    if (el) list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
  }

  function open() {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    draw('');
    if (!input.readOnly) input.select();
  }

  function close() {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.readOnly = true;
    input.value = current.name;
  }

  // Erst beim zweiten Antippen tippen können – beim ersten öffnet sich nur die Liste (ohne Handy-Tastatur)
  let reopening = false;
  function makeEditable() {
    input.readOnly = false;
    reopening = true;
    input.blur();  // neu fokussieren, damit das Handy die Tastatur zeigt
    input.focus();
    reopening = false;
  }

  let wasOpen = false;
  input.onpointerdown = () => { wasOpen = !list.hidden; };
  input.onclick = () => { if (wasOpen && input.readOnly) makeEditable(); };

  function pick(i) {
    const c = shown[i];
    if (!c) return;
    if (c.id === current.id) { close(); input.blur(); return; }
    onPick(c.id);
  }

  input.onfocus = open;
  input.oninput = () => { list.hidden = false; draw(input.value); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return open();
      if (shown.length) active = (active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      mark();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) pick(active);
    } else if (e.key === 'Escape') {
      close();
      input.blur();
    } else if (input.readOnly && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Am PC direkt lostippen
      input.readOnly = false;
      input.value = '';
    }
  };
  // Tastatur zugeklappt oder daneben getippt: eine genau eingegebene Kennzahl gilt als Auswahl
  input.onblur = () => {
    if (list.hidden || reopening) return;
    const q = norm(input.value);
    const exact = q ? shown.findIndex(c => c.code.toLowerCase() === q) : -1;
    if (exact >= 0) pick(exact); else close();
  };
  // Antippen der Liste soll das Feld nicht verlassen (sonst schließt sie vor der Auswahl)
  list.onmousedown = e => e.preventDefault();
  list.onclick = e => {
    const opt = e.target.closest('.combo-opt');
    if (opt) pick(+opt.dataset.i);
  };
}

// ---------- Schießbuch ----------

function renderHistory() {
  const filterOpts = ['<option value="all">Alle Disziplinen</option>']
    .concat(sortedDisciplines().map(d => `<option value="${d.id}" ${ui.historyFilter === d.id ? 'selected' : ''}>${esc(d.name)}</option>`))
    .join('');

  const kindOpts = KINDS.map(([key, label]) =>
    `<option value="${key}" ${ui.historyKind === key ? 'selected' : ''}>${label}</option>`).join('');

  let list = state.results;
  if (ui.historyFilter !== 'all') list = list.filter(r => r.disciplineId === ui.historyFilter);
  if (ui.historyKind !== 'all') list = list.filter(r => r.type === ui.historyKind);
  list = sortedResults(list).reverse();

  let body = '';
  if (list.length === 0) {
    const what = ui.historyKind === 'competition' ? 'Wettkampfergebnisse' : ui.historyKind === 'training' ? 'Trainingsergebnisse' : 'Ergebnisse';
    body = `<div class="card empty">Noch keine ${what}${ui.historyFilter !== 'all' ? ' für diese Disziplin' : ''}.</div>`;
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
      // Bei mehreren Vereinen steht dabei, für welchen das Ergebnis zählt
      const club = clubs.length > 1 ? clubById(r.clubId == null ? clubs[0].id : r.clubId) : null;
      group += `
        <div class="result-item">
          <div class="result-main">
            <div class="result-date">${fmtDate(r.date)}</div>
            <div class="result-meta">${esc(d ? d.name : 'Gelöschte Disziplin')}${club ? ` · ${esc(club.name)}` : ''}</div>
            ${r.type === 'competition' ? `<div class="result-comp"><span class="tag-comp">Wettkampf</span> ${esc(competitionLabel(r))}</div>` : ''}
            ${r.note ? `<div class="result-note">${esc(r.note)}</div>` : ''}
          </div>
          <div class="result-side">
            <button class="icon-btn" data-edit="${r.id}" aria-label="Ergebnis vom ${fmtDate(r.date)} bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>
            <button class="icon-btn danger" data-del="${r.id}" aria-label="Ergebnis vom ${fmtDate(r.date)} löschen" title="Löschen">${ICON_DELETE}</button>
            <div class="result-total">${fmtScore(r.total, d)}</div>
          </div>
        </div>`;
    }
    flush();
  }

  view.innerHTML = `
    <div class="row field hist-filters">
      <select id="hist-filter" aria-label="Disziplin filtern">${filterOpts}</select>
      <select id="hist-kind" aria-label="Training oder Wettkampf">${kindOpts}</select>
    </div>
    ${body}`;

  document.getElementById('hist-filter').onchange = e => { ui.historyFilter = e.target.value; render(); };
  document.getElementById('hist-kind').onchange = e => { ui.historyKind = e.target.value; render(); };

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
    markDeleted(r.id);
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
  const discs = sortedDisciplines();
  if (discs.length === 0) {
    view.innerHTML = '<div class="card empty">Noch keine Ergebnisse eingetragen.</div>';
    return;
  }
  if (!discs.some(x => x.id === ui.analysisDiscId)) {
    ui.analysisDiscId = (discs.find(x => x.id === state.defaultDisciplineId) || discs[0]).id;
  }
  const d = discById(ui.analysisDiscId);
  const start = periodStart(ui.period);
  const all = sortedResults(state.results.filter(r => r.disciplineId === d.id));
  const list = (start ? all.filter(r => r.date >= start) : all)
    .filter(r => ui.kind === 'all' || r.type === ui.kind);

  const discOpts = discs.map(x =>
    `<option value="${x.id}" ${x.id === d.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const chips = PERIODS.map(([key, label]) =>
    `<button type="button" class="${ui.period === key ? 'active' : ''}" data-period="${key}" aria-pressed="${ui.period === key}">${label}</button>`).join('');
  const kindChips = KINDS.map(([key, label]) =>
    `<button type="button" class="${ui.kind === key ? 'active' : ''}" data-kind="${key}" aria-pressed="${ui.kind === key}">${label}</button>`).join('');

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
    <div class="analysis">
      <div class="field"><select id="ana-disc" aria-label="Disziplin">${discOpts}</select></div>
      <div class="seg" role="group" aria-label="Zeitraum">${chips}</div>
      <div class="seg seg-kind" role="group" aria-label="Art">${kindChips}</div>
      ${content}
    </div>`;

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

// fixedName: beim Anpassen im Eintrag – der Name steht schon im Auswahlfeld darüber
function discEditForm(d, fixedName) {
  const isNew = !d;
  d = d || { name: '', series: 3, shots: 10, decimal: false };
  const isDefault = !isNew && d.id === state.defaultDisciplineId;
  return `
    <div class="disc-edit">
      ${fixedName ? '' : `
      <div class="field">
        <label for="de-name">Name</label>
        <input id="de-name" value="${esc(d.name)}" placeholder="z. B. Luftgewehr 60 Schuss" maxlength="60">
      </div>`}
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
          <option value="0" ${!d.decimal && !d.hits ? 'selected' : ''}>Ganze Ringe (max. 10)</option>
          <option value="1" ${d.decimal ? 'selected' : ''}>Zehntel (max. 10,9)</option>
          <option value="hits" ${d.hits ? 'selected' : ''}>Treffer (max. 1)</option>
        </select>
      </div>
      <label class="switch">
        <span>Als Standard festlegen</span>
        <input type="checkbox" id="de-default" ${isDefault ? 'checked' : ''}>
      </label>
      <p class="hint" style="margin:-8px 0 14px">Mit Häkchen ist diese Disziplin beim Eintrag immer vorausgewählt. Ohne festen Standard ist die zuletzt gewählte Disziplin vorausgewählt.</p>
      <div id="de-error" class="error" hidden></div>
      <div class="actions">
        <button class="btn" id="de-cancel">Abbrechen</button>
        <button class="btn primary" id="de-save">${isNew ? 'Hinzufügen' : 'Speichern'}</button>
      </div>
    </div>`;
}

// Speichern des Disziplin-Formulars (Optionen und „Anpassen“ beim Eintrag); id = 'new' für eine neue Disziplin
function bindDiscForm(id, onClose) {
  document.getElementById('de-cancel').onclick = onClose;
  document.getElementById('de-save').onclick = () => {
    const nameEl = document.getElementById('de-name');
    const name = nameEl ? nameEl.value.trim() : null;
    const series = Number(document.getElementById('de-series').value);
    const shots = Number(document.getElementById('de-shots').value);
    const decimal = document.getElementById('de-decimal').value === '1';
    const hits = document.getElementById('de-decimal').value === 'hits';
    const makeDefault = document.getElementById('de-default').checked;
    const err = document.getElementById('de-error');
    const fail = m => { err.hidden = false; err.textContent = m; };

    if (nameEl) {
      if (!name) return fail('Bitte einen Namen eingeben');
      if (state.disciplines.some(x => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return fail('Eine Disziplin mit diesem Namen gibt es schon');
    }
    if (!Number.isInteger(series) || series < 1 || series > 20) return fail('Serien: 1 bis 20');
    if (!Number.isInteger(shots) || shots < 1 || shots > 100) return fail('Schuss pro Serie: 1 bis 100');

    let d;
    if (id === 'new') {
      d = newDiscipline(name, decimal);
      Object.assign(d, { series, shots, hits });
      state.disciplines.push(d);
      toast('Disziplin hinzugefügt');
    } else {
      d = adoptDisc(discById(id));
      // adjusted: eigene Einstellung behalten, statt den Standard aus der DSB-Liste zu übernehmen
      touch(Object.assign(d, { series, shots, decimal, hits }, nameEl ? { name } : { adjusted: true }));
      toast('Disziplin gespeichert');
    }
    // Häkchen setzt den festen Standard, Entfernen hebt ihn auf (dann gilt die zuletzt gewählte Disziplin)
    const newDefault = makeDefault ? d.id : (state.defaultDisciplineId === d.id ? null : state.defaultDisciplineId);
    if (newDefault !== state.defaultDisciplineId) {
      state.defaultDisciplineId = newDefault;
      state.settingsUpdatedAt = Date.now();
      ui.analysisDiscId = null;
    }
    normalizeState(state);
    saveState();
    onClose();
  };
}

function renderOptions() {
  const own = state.disciplines.filter(d => !isCatalogId(d.id));
  const items = own.map(d => {
    if (ui.editDiscId === d.id) return discEditForm(d);
    const count = state.results.filter(r => r.disciplineId === d.id).length;
    return `
      <div class="disc-item">
        <div>
          <div class="disc-name">${esc(d.name)}${d.id === state.defaultDisciplineId ? ' <span class="badge">Standard</span>' : ''}</div>
          <div class="disc-meta">${d.series} × ${d.shots} Schuss · ${scoringLabel(d)}</div>
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
    <div class="card option-card">
      <div class="option-row">
        <h2 style="margin:0">Design</h2>
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

    ${collapsible('disciplines', 'Disziplinen', '', `
      <div class="set-boxes" role="group" aria-label="Disziplin-Liste">
        ${DISCIPLINE_SETS.map(set => {
          const on = state.disciplineSets.includes(set.id);
          return `
          <button type="button" class="dsb-box set-box${on ? ' active' : ''}" data-disc-set="${set.id}" aria-pressed="${on}">
            <div class="disc-name">${esc(set.name)}</div>
            <div class="disc-meta">${DISCIPLINE_CATALOG.filter(c => c.set === set.id).length} Disziplinen · ${esc(set.info)}</div>
          </button>`;
        }).join('')}
      </div>
      <p class="hint">Die gewählte Liste steht beim Eintrag zur Auswahl – über Kennzahl oder Name.</p>
      ${own.length ? `<div class="label own-label">Eigene Disziplinen</div>${items}` : ''}
      ${ui.editDiscId === 'new' ? `<div style="margin-top:12px">${discEditForm(null)}</div>` : ''}
      ${ui.editDiscId ? '' : '<div class="actions"><button class="btn primary" id="add-disc">+ Disziplin hinzufügen</button></div>'}`)}

    ${collapsible('comptypes', 'Wettkampfarten', `${state.competitionTypes.length}`, `
      <p class="hint" style="margin:0 0 12px">Auswahl im Bereich „Wettkampf“ beim Eintrag.</p>
      ${renderCompTypes()}
      ${ui.editCompId === 'new' ? `<div style="margin-top:12px">${compEditForm(null)}</div>` : ''}
      ${ui.editCompId ? '' : '<div class="actions"><button class="btn primary" id="ct-add">+ Wettkampfart hinzufügen</button></div>'}`)}

    ${collapsible('ageclass', 'Altersklasse', ageClassById(state.ageClassId) ? esc(ageClassById(state.ageClassId).name) : '', `
      <div class="field">
        <label for="age-class">Standard-Altersklasse (Sportjahr 2027)</label>
        <select id="age-class">${ageClassOptions(state.ageClassId, true)}</select>
      </div>
      <p class="hint">Ist beim Eintrag vorausgewählt; dort kannst du pro Ergebnis eine andere Klasse wählen. Maßgeblich ist das Alter, das du im Sportjahr erreichst.</p>`)}

    ${clubsCard()}

    ${collapsible('backup', 'Datensicherung', '', `
      <p class="hint" style="margin:0 0 12px">Deine Daten werden automatisch in der Cloud gesichert und sind auf jedem Gerät verfügbar, auf dem du dich anmeldest. Zusätzlich kannst du hier eine Kopie als Datei speichern.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn" id="export-json">Backup exportieren</button>
        <button class="btn" id="import-json">Backup importieren</button>
      </div>
      <div class="actions">
        <button class="btn" id="export-csv">Als CSV (Excel) exportieren</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>`)}

    <div class="card">
      <h2>Konto</h2>
      <div class="account-row">
        <div class="avatar" aria-hidden="true">${esc(account.username.slice(0, 1).toUpperCase())}</div>
        <div class="account-name">
          <div class="disc-name">${esc(account.username)}</div>
        </div>
      </div>
      <p class="hint" id="sync-detail">${syncDetailText()}</p>
      <div class="actions">
        <button class="btn ${sync.status === 'auth' ? 'primary' : ''}" id="logout">${sync.status === 'auth' ? 'Neu anmelden' : 'Abmelden'}</button>
      </div>
      ${dashboardLink()}
      <button type="button" class="link-btn danger-text" id="delete-account">Konto löschen</button>
    </div>

    <p class="hint" style="text-align:center">${state.results.length} Ergebnisse</p>
    ${legalLinks()}`;

  view.querySelectorAll('[data-section]').forEach(b => b.onclick = () => {
    const key = b.dataset.section;
    const open = !ui.openSections.has(key);
    if (open) ui.openSections.add(key); else ui.openSections.delete(key);
    b.closest('.collapsible').classList.toggle('open', open);
    b.setAttribute('aria-expanded', open);
  });

  bindClubsCard();

  view.querySelectorAll('[data-theme-btn]').forEach(b => b.onclick = () => {
    setTheme(b.dataset.themeBtn);
    view.querySelectorAll('[data-theme-btn]').forEach(x => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-pressed', on);
    });
  });

  bindCompTypes();

  // Entweder DSB oder BDS
  view.querySelectorAll('[data-disc-set]').forEach(b => b.onclick = () => {
    const id = b.dataset.discSet;
    if (state.disciplineSets.includes(id)) return;
    state.disciplineSets = [id];
    state.settingsUpdatedAt = Date.now();
    saveState();
    render();
    toast(DISCIPLINE_SETS.find(x => x.id === id).name);
  });

  document.getElementById('age-class').onchange = e => {
    state.ageClassId = e.target.value || null;
    state.settingsUpdatedAt = Date.now();    saveState();
    render();
    toast(state.ageClassId ? `Altersklasse: ${ageClassById(state.ageClassId).name}` : 'Altersklasse entfernt');
  };

  document.getElementById('logout').onclick = () => {
    // Abgelaufene Anmeldung: neu anmelden, ohne die Daten auf dem Gerät zu verlieren
    if (sync.status === 'auth') endSession('Bitte melde dich erneut an.', true);
    else logout();
  };

  document.getElementById('delete-account').onclick = async () => {
    const ok = await askConfirm(`Konto „${account.username}“ endgültig löschen?\n\nAlle deine Ergebnisse, Disziplinen und Einstellungen werden gelöscht – in der Cloud und auf allen Geräten. Das lässt sich nicht rückgängig machen. Sichere vorher bei Bedarf ein Backup (Optionen → Datensicherung).`, 'Löschen');
    if (!ok) return;
    if (!navigator.onLine) { toast('Keine Internetverbindung'); return; }
    try {
      await Cloud.deleteMyAccount();
      endSession('Dein Konto wurde gelöscht.');
      await Cloud.signOut();
    } catch (e) {
      if (/HOTSHOT_LAST_ADMIN/.test(String(e && e.message))) showNotice('Konto kann nicht gelöscht werden', Cloud.errorText(e));
      else toast(Cloud.errorText(e));
    }
  };

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
    markDeleted(d.id);
    state.results.filter(r => r.disciplineId === d.id).forEach(r => markDeleted(r.id));
    state.results = state.results.filter(r => r.disciplineId !== d.id);
    if (state.defaultDisciplineId === d.id) state.settingsUpdatedAt = Date.now();
    normalizeState(state);
    ui.draft = null;
    saveState();
    render();
    toast('Disziplin gelöscht');
  });

  if (ui.editDiscId) {
    bindDiscForm(ui.editDiscId, () => { ui.editDiscId = null; ui.draft = null; render(); });
  }
  document.getElementById('export-json').onclick = () => {
    download(`hotshot-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
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
    download(`hotshot-ergebnisse-${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
  };

  const fileInput = document.getElementById('import-file');
  document.getElementById('import-json').onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!isValidState(data)) throw new Error('format');
      const msg = `Backup mit ${data.results.length} Ergebnissen und ${data.disciplines.length} Disziplinen laden?\n\nDie aktuellen Daten in deinem Konto werden dabei ersetzt – auch in der Cloud und auf deinen anderen Geräten.`;
      if (!(await askConfirm(msg, 'Backup laden'))) return;
      // Ältere Backups kennen die Vereinsanalyse-Einstellung noch nicht: die aktuelle bleibt dann erhalten
      if (typeof data.shareWithClub !== 'boolean') data.shareWithClub = state.shareWithClub;
      if (!data.shareWithClubs) data.shareWithClubs = state.shareWithClubs;
      if (data.activeClubId === undefined) data.activeClubId = state.activeClubId;
      const loaded = normalizeState(data);
      // Alles Bisherige, was im Backup fehlt, als gelöscht vermerken; alles aus dem Backup gilt als neuester Stand
      const keep = new Set([...loaded.disciplines, ...loaded.competitionTypes, ...loaded.results].map(x => x.id));
      const deleted = { ...state.deleted };
      [...state.disciplines, ...state.competitionTypes, ...state.results].forEach(x => { if (!keep.has(x.id)) deleted[x.id] = Date.now(); });
      keep.forEach(id => delete deleted[id]);
      [...loaded.disciplines, ...loaded.competitionTypes, ...loaded.results].forEach(touch);
      loaded.deleted = deleted;
      loaded.settingsUpdatedAt = Date.now();
      state = loaded;
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

// Link zum Vereins-Dashboard: öffnet den aktiven Verein, wenn man dort Admin ist, sonst den ersten Verein mit Admin-Rechten
function dashboardLink() {
  const active = clubById(currentClubId());
  const club = active && active.is_admin ? active : clubs.find(c => c.is_admin);
  if (!club) return account.isAdmin ? `<a class="link-subtle" href="dashboard/" target="_blank" rel="noopener">Vereins-Dashboard öffnen ↗</a>` : '';
  const href = new URL('dashboard/?club=' + encodeURIComponent(club.id), document.baseURI).href;
  return `<a class="link-subtle" href="${esc(href)}" target="_blank" rel="noopener">Dashboard „${esc(club.name)}“ öffnen ↗</a>`;
}

// Optionen: Vereine mit aktivem Verein, Zustimmung zur Vereinsanalyse je Verein, Beitreten und Gründen
function clubsCard() {
  const activeId = currentClubId();
  const several = clubs.length > 1;
  const items = clubs.map(c => {
    const share = sharesWith(c.id);
    const active = c.id === activeId;
    return `
      <div class="club-item ${several && active ? 'is-active' : ''}">
        <div class="option-row">
          <div class="club-title">
            <div class="disc-name">${esc(c.name)}${several && active ? ' <span class="badge badge-active">aktiv</span>' : ''}${c.is_admin ? ' <span class="badge">Admin</span>' : ''}${c.status === 'locked' ? ' <span class="badge">gesperrt</span>' : ''}</div>
            ${c.location ? `<div class="disc-meta">${esc(c.location)}</div>` : ''}
          </div>
          <button type="button" class="link-btn danger-text" data-leave="${c.id}">Verlassen</button>
        </div>
        ${several && !active ? `<button type="button" class="btn small" data-activate="${c.id}">Als aktiven Verein festlegen</button>` : ''}
        ${c.code ? `
        <div class="club-code-row">
          <span class="disc-meta">Vereinscode</span>
          <strong class="club-code">${esc(c.code)}</strong>
          <button type="button" class="link-btn" data-show-code="${c.id}">QR-Code</button>
        </div>` : ''}
        <div class="share-row">
          <label class="switch subtle share-switch">
            <input type="checkbox" data-share-club="${c.id}" ${share ? '' : 'checked'}>
            <span>Vereinsauswertung ablehnen</span>
          </label>
          <div class="info">
            <button type="button" class="info-btn" aria-label="Erklärung zu Vereinsauswertung ablehnen">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/></svg>
            </button>
            <div class="info-pop" role="tooltip"><b>Ohne Häkchen</b> sehen die Admins dieses Vereins im Dashboard die Ergebnisse, die du für ihn einträgst – unter deinem Benutzernamen.<br><b>Mit Häkchen</b> sieht der Verein deine Ergebnisse nicht. In deinem Konto bleiben sie in jedem Fall gespeichert.</div>
          </div>
        </div>
      </div>`;
  }).join('');

  const active = clubById(activeId);
  return collapsible('clubs', several ? 'Meine Vereine' : 'Mein Verein', active ? esc(active.name) : '', `
      ${several ? `<p class="hint club-active-hint">Neue Ergebnisse zählen für den <strong>aktiven Verein: ${esc(active.name)}</strong>. Schießt du für einen anderen Verein, lege ihn hier vorher als aktiv fest.</p>` : ''}
      ${items || '<p class="hint" style="margin:0">Du bist in keinem Verein. Tritt mit einem Vereinscode bei oder gründe einen neuen Verein.</p>'}
      ${ui.foundClub ? `
        <div class="disc-edit found-club">
          <div class="disc-name">Neuen Verein gründen</div>
          ${clubFields('fc', ui.clubForm)}
          ${termsField('fc', ui.clubForm.accept)}
          <div id="fc-error" class="error" hidden></div>
          <div class="actions">
            <button type="button" class="btn" id="fc-cancel">Abbrechen</button>
            <button type="button" class="btn primary" id="fc-save">Verein gründen</button>
          </div>
        </div>` : `
        <div class="field join-field">
          <label for="join-code">${clubs.length ? 'Einem weiteren Verein beitreten' : 'Einem Verein beitreten'}</label>
          <div class="join-row">
            <input id="join-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Vereinscode" maxlength="40">
            <button type="button" class="btn" id="join-btn">Beitreten</button>
          </div>
        </div>
        <button type="button" class="link-btn found-club-btn" id="found-club">+ Neuen Verein gründen</button>`}`);
}

function bindClubsCard() {
  view.querySelectorAll('[data-share-club]').forEach(b => b.onchange = () => {
    const id = b.dataset.shareClub;
    const share = !b.checked; // Häkchen = Vereinsauswertung abgelehnt
    if (share === sharesWith(id)) return;
    state.shareWithClubs = { ...state.shareWithClubs, [id]: share };
    // Ältere App-Versionen auf anderen Geräten kennen nur die allgemeine Einstellung
    if (clubs.length === 1) state.shareWithClub = share;
    state.settingsUpdatedAt = Date.now();
    saveState();
    render();
    toast(share ? 'Der Verein sieht deine Ergebnisse wieder' : 'Vereinsauswertung abgelehnt');
  });

  view.querySelectorAll('[data-show-code]').forEach(b => b.onclick = () => showClubCode(clubById(b.dataset.showCode), false));

  view.querySelectorAll('[data-activate]').forEach(b => b.onclick = () => {
    const c = clubById(b.dataset.activate);
    if (!c) return;
    state.activeClubId = c.id;
    state.settingsUpdatedAt = Date.now();
    saveState();
    render();
    toast(`Neue Ergebnisse zählen jetzt für „${c.name}“`);
  });

  view.querySelectorAll('[data-leave]').forEach(b => b.onclick = async () => {
    const c = clubById(b.dataset.leave);
    if (!c) return;
    if (!(await askConfirm(`„${c.name}“ verlassen?\n\nDer Verein sieht deine Ergebnisse danach nicht mehr. Sie bleiben in deinem Konto gesichert. Zurück kommst du nur mit dem Vereinscode.`, 'Verlassen'))) return;
    if (!navigator.onLine) { toast('Keine Internetverbindung'); return; }
    try {
      await Cloud.leaveClub(c.id);
      await refreshClubs();
      render();
      toast(`Du hast „${c.name}“ verlassen`);
    } catch (e) {
      if (/HOTSHOT_LAST_ADMIN/.test(String(e && e.message))) showNotice('Verlassen nicht möglich', Cloud.errorText(e));
      else toast(Cloud.errorText(e));
    }
  });

  const joinBtn = document.getElementById('join-btn');
  if (joinBtn) {
    const codeEl = document.getElementById('join-code');
    codeEl.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); joinBtn.click(); } };
    joinBtn.onclick = () => joinByCode(codeEl.value);
    document.getElementById('found-club').onclick = () => { ui.foundClub = true; ui.clubForm = emptyClubForm(); render(); };
    return;
  }

  const f = ui.clubForm;
  view.querySelectorAll('.found-club input').forEach(el => {
    el.oninput = el.onchange = () => { f[el.name] = el.type === 'checkbox' ? el.checked : el.value; };
  });
  document.getElementById('fc-cancel').onclick = () => { ui.foundClub = false; render(); };
  document.getElementById('fc-save').onclick = async () => {
    const errEl = document.getElementById('fc-error');
    const fail = m => { errEl.hidden = false; errEl.textContent = m; };
    const { club, error } = newClubFrom(f);
    if (error) return fail(error);
    if (!navigator.onLine) return fail('Keine Internetverbindung');
    const btn = document.getElementById('fc-save');
    btn.disabled = true;
    try {
      const id = await Cloud.createClub(club);
      ui.foundClub = false;
      await refreshClubs();
      render();
      const created = clubById(id);
      if (created) showClubCode(created, true);
    } catch (e) {
      btn.disabled = false;
      fail(Cloud.errorText(e));
    }
  };
}

// Mit Vereinscode beitreten; vorher zeigen, welcher Verein es ist
async function joinByCode(code) {
  code = String(code || '').trim();
  if (!code) { toast('Bitte den Vereinscode eingeben'); return; }
  if (!navigator.onLine) { toast('Keine Internetverbindung'); return; }
  try {
    const club = await Cloud.clubByCode(code);
    if (!club) { toast('Der Vereinscode stimmt nicht'); return; }
    if (clubById(club.id)) { toast(`Du bist schon in „${club.name}“`); return; }
    const label = club.location ? `${club.name} (${club.location})` : club.name;
    if (!(await askConfirm(`„${label}“ beitreten?\n\nErgebnisse, die du für diesen Verein einträgst, sieht der Vereins-Admin im Dashboard. Möchtest du das nicht, setze unter Optionen → Meine Vereine das Häkchen „Vereinsauswertung ablehnen“.`, 'Beitreten'))) return;
    await Cloud.joinClub(code);
    await refreshClubs();
    render();
    toast(`Willkommen in „${club.name}“`);
  } catch (e) { toast(Cloud.errorText(e)); }
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
  return sortedCompTypes().map(c => {
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
      if (isNew) state.competitionTypes.push({ id: uid(), name, updatedAt: Date.now() });
      else touch(compTypeById(ui.editCompId)).name = name;
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
    used.forEach(r => { r.competition.typeId = null; touch(r); });
    state.competitionTypes = state.competitionTypes.filter(x => x.id !== c.id);
    markDeleted(c.id);
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

// ---------- Anmeldung ----------

const emptyAuthFields = () => ({ username: '', clubCode: '', password: '', password2: '', ...emptyClubForm() });

const authUi = {
  mode: 'login', // login | register | create (neuen Verein anlegen)
  fields: emptyAuthFields(),
  clubPreview: '', // Verein zum eingegebenen Code
  busy: false,
};

// Einladungslink aus dem QR-Code (…?verein=CODE): Code merken und aus der Adresse entfernen
let inviteCode = (() => {
  try {
    const params = new URLSearchParams(location.search);
    const code = params.get('verein');
    if (!code) return null;
    params.delete('verein');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    return code.trim();
  } catch (e) { return null; }
})();

function showLoggedOut(html) {
  document.body.classList.add('logged-out');
  document.getElementById('title').textContent = 'Hot Shot';
  document.getElementById('sync-status').hidden = true;
  view.innerHTML = html;
}

function renderAuth(message) {
  if (!Cloud.configured) {
    showLoggedOut(`
      <div class="auth">
        ${authBrand()}
        <div class="card">
          <h2>Cloud noch nicht eingerichtet</h2>
          <p class="hint">In <code>config.js</code> fehlen die Zugangsdaten zum Supabase-Projekt.
            Die Schritte stehen in der README im Abschnitt „Cloud einrichten“.</p>
        </div>
      </div>`);
    return;
  }
  if (!Cloud.libLoaded) {
    showLoggedOut(`
      <div class="auth">
        ${authBrand()}
        <div class="card empty">Keine Internetverbindung.<br>Für die erste Anmeldung wird Internet benötigt.<br><br>
          <button class="btn primary" id="retry">Erneut versuchen</button></div>
      </div>`);
    document.getElementById('retry').onclick = () => location.reload();
    return;
  }

  const f = authUi.fields;
  const mode = authUi.mode;
  const reg = mode !== 'login'; // neues Konto (Registrieren oder Verein anlegen)
  const create = mode === 'create';
  const submitLabel = create ? 'Verein anlegen' : reg ? 'Konto anlegen' : 'Anmelden';
  showLoggedOut(`
    <div class="auth">
      ${authBrand()}
      <div class="card">
        ${create ? `
        <div class="auth-head">
          <h2 style="margin:0">Neuen Verein anlegen</h2>
          <button type="button" class="link-btn" data-mode="login">Zurück</button>
        </div>
        <p class="hint" style="margin:0 0 14px">Du legst den Verein an und wirst sein Admin. Danach bekommst du den Vereinscode für deine Mitglieder. Hot Shot ist kostenlos.</p>` : `
        <div class="segmented" role="tablist">
          <button type="button" role="tab" data-mode="login" aria-selected="${!reg}" class="${!reg ? 'active' : ''}">Anmelden</button>
          <button type="button" role="tab" data-mode="register" aria-selected="${reg}" class="${reg ? 'active' : ''}">Registrieren</button>
        </div>`}
        <form id="auth-form" novalidate>
          ${create ? `${clubFields('a', f)}<div class="label own-label">Dein Konto</div>` : ''}
          <div class="field">
            <label for="a-username">Benutzername</label>
            <input id="a-username" name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(f.username)}" placeholder="${reg ? 'z. B. max.muster' : ''}" maxlength="${reg ? 254 : 30}">
            ${reg ? `<p class="hint" id="username-hint">So erscheinst du in der Vereinsauswertung. Nur a–z, Ziffern, Punkt, Minus und Unterstrich – keine E-Mail-Adresse.</p>` : ''}
          </div>
          <div class="field">
            <label for="a-password">Passwort</label>
            ${passwordField('a-password', 'password', reg ? 'new-password' : 'current-password', f.password)}
          </div>
          ${reg ? `
          <div class="field">
            <label for="a-password2">Passwort wiederholen</label>
            ${passwordField('a-password2', 'password2', 'new-password', f.password2)}
          </div>` : ''}
          ${mode === 'register' ? `
          <div class="field">
            <label for="a-club">Vereinscode</label>
            <input id="a-club" name="clubCode" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(f.clubCode)}" placeholder="bekommst du vom Verein">
            <p class="hint" id="club-preview" ${authUi.clubPreview ? '' : 'hidden'}>${esc(authUi.clubPreview)}</p>
          </div>` : ''}
          ${create ? termsField('a', f.accept) : ''}
          <div id="auth-error" class="error" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
          <div class="actions">
            <button type="submit" class="btn primary" id="auth-submit" ${authUi.busy ? 'disabled' : ''}>${submitLabel}</button>
          </div>
        </form>
        ${!reg ? '<p class="hint" style="margin-top:14px">Passwort vergessen? Ein Admin deines Vereins kann es im Dashboard zurücksetzen.</p>' : ''}
      </div>
      ${create ? '' : `
      <div class="auth-create">
        <p class="hint">Dein Verein nutzt Hot Shot noch nicht?</p>
        <button type="button" class="btn block" data-mode="create">Neuen Verein anlegen</button>
      </div>`}
      ${legalLinks()}
    </div>`);

  view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    authUi.mode = b.dataset.mode;
    renderAuth();
    window.scrollTo(0, 0);
  });
  view.querySelectorAll('#auth-form input').forEach(el => el.oninput = el.onchange = () => {
    f[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  });
  // Neues Konto: ungültige Benutzernamen (z. B. eine vom Browser eingesetzte E-Mail-Adresse) gleich passend machen
  const userEl = document.getElementById('a-username');
  const fixUsername = () => {
    if (!reg || !userEl.value.trim()) return;
    const clean = Cloud.cleanUsername(userEl.value);
    if (clean === userEl.value) return;
    const onlyCase = clean === Cloud.normalizeUsername(userEl.value);
    userEl.value = f.username = clean;
    if (onlyCase) return; // nur Großbuchstaben: stillschweigend klein schreiben
    const hint = document.getElementById('username-hint');
    hint.textContent = 'Der Benutzername wurde angepasst (keine E-Mail-Adresse, keine Umlaute oder Leerzeichen). Du kannst ihn noch ändern.';
    hint.classList.add('notice');
  };
  userEl.addEventListener('change', fixUsername);
  userEl.addEventListener('blur', fixUsername);
  // Zum Vereinscode gleich anzeigen, welcher Verein es ist
  const codeEl = document.getElementById('a-club');
  if (codeEl) codeEl.onblur = () => showClubPreview(codeEl.value);
  // Auge: Passwort im Klartext zeigen bzw. wieder verbergen
  view.querySelectorAll('[data-pw-toggle]').forEach(b => b.onclick = () => {
    const input = document.getElementById(b.dataset.pwToggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', show);
    b.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    b.innerHTML = show ? ICON_EYE_OFF : ICON_EYE;
  });

  const form = document.getElementById('auth-form');
  const errEl = document.getElementById('auth-error');
  const fail = m => { errEl.hidden = false; errEl.textContent = m; };

  form.onsubmit = async e => {
    e.preventDefault();
    if (authUi.busy) return;
    fixUsername();
    const uErr = Cloud.usernameError(f.username);
    if (uErr) return fail(uErr);
    if (!f.password) return fail('Bitte ein Passwort eingeben');
    let newClub = null;
    if (create) {
      const checked = newClubFrom(f);
      if (checked.error) return fail(checked.error);
      newClub = checked.club;
    }
    if (reg) {
      if (f.password.length < 6) return fail('Das Passwort muss mindestens 6 Zeichen haben');
      if (f.password !== f.password2) return fail('Die Passwörter stimmen nicht überein');
      if (!create && !f.clubCode.trim()) return fail('Bitte den Vereinscode eingeben');
    }
    if (!navigator.onLine) return fail('Keine Internetverbindung');

    authUi.busy = true;
    const btn = document.getElementById('auth-submit');
    btn.disabled = true;
    btn.textContent = 'Bitte warten …';
    try {
      const session = reg
        // Der Benutzername ist der einzige Name – er wird auch als Anzeigename gespeichert
        ? await Cloud.signUp({ username: f.username, password: f.password, displayName: f.username.trim(), clubCode: f.clubCode.trim(), newClub })
        : await Cloud.signIn(f.username, f.password);
      authUi.busy = false;
      authUi.fields = emptyAuthFields();
      authUi.clubPreview = '';
      authUi.mode = 'login';
      await startSession(session.user);
      if (create) {
        await refreshClubs();
        const club = clubs.find(c => c.is_admin);
        if (club) showClubCode(club, true);
      } else if (reg) {
        toast('Willkommen bei Hot Shot!');
      }
      // Einladungslink: beim Registrieren schon erledigt, beim Anmelden jetzt den Beitritt anbieten
      if (reg) inviteCode = null; else offerInvite();
    } catch (err) {
      authUi.busy = false;
      btn.disabled = false;
      btn.textContent = submitLabel;
      fail(Cloud.errorText(err));
    }
  };
}

async function showClubPreview(code) {
  const el = document.getElementById('club-preview');
  if (!el) return;
  code = code.trim();
  let text = '';
  if (code && navigator.onLine) {
    try {
      const club = await Cloud.clubByCode(code);
      text = club ? `Verein: ${club.name}${club.location ? ` · ${club.location}` : ''}` : 'Zu diesem Code gibt es keinen Verein';
    } catch (e) { text = ''; }
  }
  authUi.clubPreview = text;
  if (!document.getElementById('club-preview')) return;
  el.textContent = text;
  el.hidden = !text;
}

const ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/></svg>';

// Passwortfeld mit Augen-Knopf zum Anzeigen
function passwordField(id, name, autocomplete, value) {
  return `
    <div class="pw-wrap">
      <input id="${id}" name="${name}" type="password" autocomplete="${autocomplete}" value="${esc(value)}">
      <button type="button" class="pw-toggle" data-pw-toggle="${id}" aria-label="Passwort anzeigen" aria-pressed="false">${ICON_EYE}</button>
    </div>`;
}

// Links zu Impressum und Datenschutz (müssen von jeder Seite aus erreichbar sein)
function legalLinks() {
  const link = (file, label) => `<a href="${new URL('rechtliches/' + file, document.baseURI).href}" target="_blank" rel="noopener">${label}</a>`;
  return `<p class="legal-links">${link('impressum.html', 'Impressum')} · ${link('datenschutz.html', 'Datenschutz')} · ${link('nutzungsbedingungen.html', 'Nutzungsbedingungen')}</p>`;
}

function authBrand() {
  return `
    <div class="auth-brand">
      <img src="icons/icon.svg" alt="" width="72" height="72">
      <div class="auth-name">Hot Shot</div>
    </div>`;
}

function accountFromUser(user) {
  const meta = user.user_metadata || {};
  return {
    userId: user.id,
    username: meta.username || String(user.email || '').split('@')[0],
    displayName: meta.display_name || meta.username || '',
    isAdmin: false,
  };
}

function rememberAccount() {
  try { localStorage.setItem(LAST_USER_KEY, JSON.stringify(account)); } catch (e) { /* egal */ }
}

async function startSession(user, cached) {
  account = cached || accountFromUser(user);
  rememberAccount();
  state = loadState(account.userId);
  const cachedClubs = readJSON(clubsKey(account.userId));
  clubs = Array.isArray(cachedClubs) ? cachedClubs : [];
  sync.lastSync = null;
  Object.assign(ui, { tab: 'entry', draft: null, editId: null, historyFilter: 'all', historyKind: 'all', analysisDiscId: null, selectedPoint: null, editDiscId: null, adjustDisc: false, editCompId: null, foundClub: false });
  document.body.classList.remove('logged-out');
  setTab('entry');
  setSyncStatus(navigator.onLine ? 'idle' : 'offline');
  await offerLegacyImport();
  syncNow();
  refreshProfile();
  refreshClubs();
}

// Angemeldet einen Einladungslink geöffnet: Beitritt anbieten
async function offerInvite() {
  if (!inviteCode || !account) return;
  const code = inviteCode;
  inviteCode = null;
  await joinByCode(code);
}

// Anzeigename und Admin-Recht aus der Cloud holen
async function refreshProfile() {
  if (!Cloud.client || !navigator.onLine) return;
  try {
    const p = await Cloud.getProfile(account.userId);
    if (!p || !account || account.userId !== p.id) return;
    const changed = account.isAdmin !== p.is_admin || account.displayName !== p.display_name;
    Object.assign(account, { username: p.username, displayName: p.display_name, isAdmin: p.is_admin });
    rememberAccount();
    if (changed && ui.tab === 'options') refreshAfterSync();
  } catch (e) { /* beim nächsten Start erneut */ }
}

// Daten aus der Version ohne Konto einmalig ins Konto übernehmen
async function offerLegacyImport() {
  const legacy = readJSON(LEGACY_KEY);
  if (!isValidState(legacy) || legacy.results.length === 0) return;
  const n = legacy.results.length;
  const ok = await askConfirm(
    `${n} ${n === 1 ? 'Ergebnis' : 'Ergebnisse'} aus der alten Schützen-App gefunden\n\nSollen sie in dein Konto „${account.username}“ übernommen und damit in der Cloud gesichert werden?`,
    'Übernehmen');
  if (!ok) return;
  const added = importInto(state, legacy);
  saveState();
  try {
    // Nicht löschen, nur umbenennen – so bleibt im Notfall eine Kopie auf dem Gerät
    localStorage.setItem(LEGACY_KEY + '-uebernommen', localStorage.getItem(LEGACY_KEY));
    localStorage.removeItem(LEGACY_KEY);
  } catch (e) { /* dann wird beim nächsten Start erneut gefragt */ }
  render();
  toast(`${added} ${added === 1 ? 'Ergebnis' : 'Ergebnisse'} übernommen`);
}

async function logout() {
  if (isDirty()) {
    const ok = await askConfirm('Wirklich abmelden?\n\nEinige Änderungen sind noch nicht in der Cloud gespeichert und gehen beim Abmelden verloren. Verbinde dich besser erst mit dem Internet.', 'Trotzdem abmelden');
    if (!ok) return;
  }
  endSession();
  await Cloud.signOut();
}

// Gerätekopie entfernen, damit auf geteilten Handys keine fremden Daten liegen bleiben.
// Mit keepData bleiben die Daten erhalten (abgelaufene Anmeldung mit noch nicht hochgeladenen Änderungen).
function endSession(message, keepData) {
  if (!account) return;
  if (!keepData) {
    try {
      localStorage.removeItem(stateKey(account.userId));
      localStorage.removeItem(dirtyKey(account.userId));
      localStorage.removeItem(LAST_USER_KEY);
      localStorage.removeItem(lastDiscKey(account.userId));
      localStorage.removeItem(clubsKey(account.userId));
    } catch (e) { /* egal */ }
  }
  account = null;
  state = defaultState();
  clubs = [];
  clearTimeout(sync.timer);
  renderAuth(message);
}

// ---------- Start ----------

async function boot() {
  // Einladungslink ohne Anmeldung: gleich „Registrieren“ mit ausgefülltem Vereinscode
  if (inviteCode) {
    authUi.mode = 'register';
    authUi.fields.clubCode = inviteCode;
  }
  if (!Cloud.client) {
    // Offline beim Start ohne geladene Bibliothek: mit dem zuletzt angemeldeten Konto weiterarbeiten
    const last = readJSON(LAST_USER_KEY);
    if (Cloud.configured && last && last.userId) return startSession(null, last);
    return renderAuth();
  }
  const { session, error, stored } = await Cloud.getSessionInfo();
  const last = readJSON(LAST_USER_KEY);
  if (session) {
    const cached = last && last.userId === session.user.id ? last : null;
    await startSession(session.user, cached);
  } else if (last && last.userId && (!navigator.onLine || stored)) {
    // Die gespeicherte Anmeldung ist noch da, konnte aber gerade nicht erneuert werden
    // (z. B. Netz beim Öffnen noch nicht bereit). Weiterarbeiten – Supabase erneuert sie im Hintergrund.
    await startSession(null, last);
  } else {
    // Grund anzeigen, falls man vorher angemeldet war – hilft bei der Fehlersuche
    renderAuth(last && last.userId
      ? `Bitte erneut anmelden (${error ? Cloud.errorText(error) : 'keine gespeicherte Anmeldung gefunden'}).`
      : undefined);
    if (inviteCode) showClubPreview(inviteCode);
  }
  if (account) offerInvite();

  Cloud.client.auth.onAuthStateChange(event => {
    // Sitzung wurde ungültig (z. B. Passwort von einem Admin zurückgesetzt)
    if (event === 'SIGNED_OUT' && account) endSession('Die Anmeldung wurde vom Server beendet. Bitte erneut anmelden.', isDirty());
    // Anmeldung wurde im Hintergrund erneuert: liegengebliebene Änderungen jetzt hochladen
    if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && account && sync.status !== 'ok') scheduleSync(0);
  });
}

boot();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
