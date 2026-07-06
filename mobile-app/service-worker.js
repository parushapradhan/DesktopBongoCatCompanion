// Minimal offline shell caching so the app opens instantly and can be
// "installed" to the home screen. It does not do background push —
// notifications only fire while the app/tab is open (see SETUP.md for why,
// and how to add real push later with Firebase Cloud Messaging).

const CACHE_NAME = 'bongo-buddy-v1';
const SHELL_FILES = [
  './index.html',
  './style.css',
  './app.js',
  './bongo-cat.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first for the Firebase SDK/API calls and the GSAP CDN, cache-first for the shell.
  if (
    event.request.url.includes('firebaseio.com') ||
    event.request.url.includes('gstatic.com') ||
    event.request.url.includes('jsdelivr.net')
  ) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
