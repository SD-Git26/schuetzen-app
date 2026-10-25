'use strict';

// ---------- Cloud-Verbindung (Supabase) – genutzt von App und Dashboard ----------

const Cloud = (() => {
  const cfg = window.HOTSHOT_CONFIG || {};
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  // Fehlt die Bibliothek, war das Gerät beim allerersten Start offline
  const libLoaded = !!(window.supabase && window.supabase.createClient);

  // Anmeldung bleibt auf dem Gerät gespeichert, bis man sich abmeldet
  // Die Betreiber-Seite nutzt einen eigenen Schlüssel, damit sie die Anmeldung in App und Dashboard nicht berührt
  const AUTH_KEY = cfg.authKey || 'hotshot-auth';
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

  // Macht aus einer Eingabe einen gültigen Benutzernamen: aus einer E-Mail-Adresse (z. B. vom Browser
  // vorausgefüllt) wird der Teil vor dem @, Umlaute werden umschrieben, Leerzeichen zu Punkten
  function cleanUsername(s) {
    let u = normalizeUsername(s);
    if (u.includes('@')) u = u.split('@')[0];
    u = u.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    return u.slice(0, 30);
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
    if (/HOTSHOT_INVALID_CLUB_NAME/.test(m)) return 'Vereinsname: 2 bis 80 Zeichen';
    if (/HOTSHOT_INVALID_LOCATION/.test(m)) return 'Ort: höchstens 80 Zeichen';
    if (/HOTSHOT_INVALID_CONTACT_NAME/.test(m)) return 'Bitte deinen Namen angeben (2 bis 80 Zeichen)';
    if (/HOTSHOT_INVALID_EMAIL/.test(m)) return 'Bitte eine gültige E-Mail-Adresse angeben';
    if (/HOTSHOT_TERMS_REQUIRED/.test(m)) return 'Bitte die Nutzungsbedingungen und den AV-Vertrag akzeptieren';
    if (/HOTSHOT_TOO_MANY_CLUBS/.test(m)) return 'Gerade wurden sehr viele Vereine angelegt – bitte später erneut versuchen';
    if (/HOTSHOT_TOO_MANY_OWN_CLUBS/.test(m)) return 'Mit einem Konto lassen sich höchstens 3 Vereine gründen';
    if (/HOTSHOT_LAST_ADMIN/.test(m)) return 'Du bist der letzte Admin dieses Vereins. Ernenne zuerst im Dashboard ein anderes Mitglied zum Admin.';
    if (/HOTSHOT_INVALID_CODE/.test(m)) return 'Vereinscode: 6 bis 30 Zeichen, nur Buchstaben, Ziffern und Minus';
    if (/HOTSHOT_CODE_TAKEN/.test(m)) return 'Diesen Vereinscode benutzt schon ein anderer Verein';
    if (/HOTSHOT_RESET_OTHER_CLUB/.test(m)) return 'Dieses Mitglied ist auch in einem anderen Verein. Das Passwort kann nur der Betreiber von Hot Shot zurücksetzen.';
    // Supabase gibt Fehler beim Registrieren nicht im Einzelnen weiter
    if (/database error saving new user/i.test(m)) return 'Registrierung fehlgeschlagen – bitte die Angaben prüfen oder später erneut versuchen';
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

  // Entweder mit clubCode einem Verein beitreten oder mit newClub einen neuen Verein anlegen
  // (newClub = { name, location, contact_name, contact_email, accept_terms })
  async function signUp({ username, password, displayName, clubCode, newClub }) {
    if (!newClub) {
      const check = await client.rpc('check_club_code', { code: clubCode });
      if (check.error) throw check.error;
      if (!check.data) throw new Error('HOTSHOT_WRONG_CLUB_CODE');
    }
    const meta = { username: normalizeUsername(username), display_name: displayName };
    if (newClub) meta.new_club = newClub; else meta.club_code = clubCode;
    const { data, error } = await client.auth.signUp({
      email: emailFor(username),
      password,
      options: { data: meta },
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

  // Datenbank-Funktion aufrufen; Fehler werden geworfen
  async function call(fn, args) {
    const { data, error } = await client.rpc(fn, args);
    if (error) throw error;
    return data;
  }

  // Meine Vereine, der älteste zuerst: [{ id, name, location, is_admin, status, joined_at, code (nur für Admins) }]
  const myClubs = () => call('my_clubs');
  // Verein zum Code (vor dem Beitreten anzeigen) oder null
  const clubByCode = async code => (await call('club_by_code', { code }))[0] || null;
  const joinClub = code => call('join_club', { code });
  const createClub = newClub => call('create_club', { new_club: newClub });
  const leaveClub = club => call('leave_club', { club });
  const deleteMyAccount = () => call('delete_my_account');

  return {
    configured, libLoaded, client, normalizeUsername, cleanUsername, usernameError, emailFor, errorText, signIn, signUp, signOut,
    getSession, getSessionInfo, getProfile, call, myClubs, clubByCode, joinClub, createClub, leaveClub, deleteMyAccount,
  };
})();
