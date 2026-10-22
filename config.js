// Zugangsdaten zum Supabase-Projekt (siehe README, Abschnitt "Cloud einrichten").
// Beide Werte findest du in Supabase unter Project Settings → API.
// Der "anon"-Schlüssel ist öffentlich und darf in der App stehen –
// die Daten schützen die Zugriffsregeln aus supabase/setup.sql.
window.HOTSHOT_CONFIG = {
  supabaseUrl: 'https://mkljitkkcpffyqsfwokr.supabase.co',
  supabaseAnonKey: 'sb_publishable_-G9HF6YvItpGijIRVgogyw_Bq4ewF1c', // öffentlicher Schlüssel ("anon" oder "publishable")

  // Benutzernamen werden intern als E-Mail-Adresse <name>@<emailDomain> angelegt.
  // Es werden keine E-Mails verschickt. Nach dem Start nicht mehr ändern,
  // sonst kann sich niemand mehr anmelden.
  emailDomain: 'mitglied.hotshot.app',
};
