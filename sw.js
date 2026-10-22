// Bei jeder Änderung an den App-Dateien die Version erhöhen,
// damit das Handy die neue Version lädt. Dieselbe Zahl steht als ?v=… in index.html und dashboard/index.html.
const CACHE = 'hotshot-v6';

const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

const FILES = [
  './',
  'index.html',
  'style.css?v=6',
  'config.js?v=6',
  'disziplinen.js?v=6',
  'cloud.js?v=6',
  'app.js?v=6',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  SUPABASE_LIB,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst Netzwerk (für Updates), bei Offline aus dem Cache.
// Nur App-Dateien und die Supabase-Bibliothek – Anfragen an die Datenbank nie zwischenspeichern.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin && e.request.url !== SUPABASE_LIB) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
