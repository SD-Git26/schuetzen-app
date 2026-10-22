'use strict';

// ---------- Cloud-Verbindung (Supabase) – genutzt von App und Dashboard ----------

const Cloud = (() => {
  const cfg = window.HOTSHOT_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  // Fehlt die Bibliothek, war das Gerät beim allerersten Start offline
  const libLoaded = !!(window.supabase && window.supabase.createClient);

  // Anmeldung bleibt auf dem Gerät gespeichert, bis man sich abmeldet
  const AUTH_KEY = 'hotshot-auth';
  const client = configured && libLoaded
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_KEY },
    })
    : null;

  function normalizeUsername(s) { return String(s || '').trim().toLowerCase(); }

  function usernameError(s) {
    const u = normalizeUsername(s);
    if (!u) return 'Bitte einen Benutzernamen eingeben';
    if (u.length < 3 || u.length > 30) return 'Benutzername: 3 bis 30 Zeichen';
    if (!/^[a-z0-9._-]+$/.test(u)) return 'Benutzername: nur Buchstaben a–z, Ziffern, Punkt, Minus und Unterstrich (keine Umlaute, keine Leerzeichen)';
    return null;
  }

  // Benutzernamen werden intern als E-Mail-Adresse geführt, es wird aber nie eine E-Mail verschickt
  function emailFor(username) {
    return `${normalizeUsername(username)}@${cfg.emailDomain || 'mitglied.hotshot.app'}`;
  }

  // Fehlermeldungen von Supabase in verständliches Deutsch übersetzen
  function errorText(e) {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/invalid login credentials/i.test(m)) return 'Benutzername oder Passwort falsch';
    if (/already registered|already exists/i.test(m)) return 'Dieser Benutzername ist schon vergeben';
    if (/password.*(at least|characters)/i.test(m)) return 'Das Passwort muss mindestens 6 Zeichen haben';
    if (/HOTSHOT_WRONG_CLUB_CODE/.test(m)) return 'Der Vereinscode stimmt nicht';
    if (/HOTSHOT_INVALID_USERNAME/.test(m)) return 'Ungültiger Benutzername';
    if (/database error saving new user/i.test(m)) return 'Registrierung fehlgeschlagen – bitte Vereinscode prüfen';
    if (/signups? not allowed|signup.*disabled/i.test(m)) return 'Registrierung ist in Supabase abgeschaltet (siehe Anleitung)';
    if (/email not confirmed/i.test(m)) return 'In Supabase ist noch „Confirm email“ eingeschaltet (siehe Anleitung)';
    if (/rate limit|too many/i.test(m)) return 'Zu viele Versuche – bitte kurz warten';
    if (/failed to fetch|network|load failed/i.test(m)) return 'Keine Verbindung zum Server';
    return m || 'Unbekannter Fehler';
  }

  async function signIn(username, password) {
    const { data, error } = await client.auth.signInWithPassword({ email: emailFor(username), password });
    if (error) throw error;
    return data.session;
  }

  async function signUp({ username, password, displayName, clubCode }) {
    const check = await client.rpc('check_club_code', { code: clubCode });
    if (check.error) throw check.error;
    if (!check.data) throw new Error('HOTSHOT_WRONG_CLUB_CODE');
    const { data, error } = await client.auth.signUp({
      email: emailFor(username),
      password,
      options: { data: { username: normalizeUsername(username), display_name: displayName, club_code: clubCode } },
    });
    if (error) throw error;
    if (!data.session) throw new Error('Email not confirmed');
    return data.session;
  }

  async function signOut() {
    // Auch offline abmelden: die lokale Sitzung wird in jedem Fall entfernt
    try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* egal */ }
  }

  async function getSession() {
    const { data } = await client.auth.getSession();
    return data.session;
  }

  // Wie getSession, aber mit Fehler und der Angabe, ob noch eine Anmeldung auf dem Gerät gespeichert ist.
  // Supabase löscht sie nur, wenn sie wirklich ungültig ist – bei Netzproblemen bleibt sie erhalten.
  async function getSessionInfo() {
    let session = null;
    let error = null;
    try {
      const res = await client.auth.getSession();
      session = res.data.session;
      error = res.error || null;
    } catch (e) { error = e; }
    let stored = false;
    try { stored = !!localStorage.getItem(AUTH_KEY); } catch (e) { /* kein Speicher */ }
    return { session, error, stored };
  }

  async function getProfile(userId) {
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data;
  }

  return { configured, libLoaded, client, normalizeUsername, usernameError, emailFor, errorText, signIn, signUp, signOut, getSession, getSessionInfo, getProfile };
})();
