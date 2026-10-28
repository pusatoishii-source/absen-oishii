// Service Worker - Oishii Absen Online
const CACHE_VERSION = 'oishii-absen-v2';
const CACHE_NAME = CACHE_VERSION;

// App-shell inti yang selalu di-cache saat install
const PRECACHE_URLS = [
  '/index.html',
  '/manifest.json',
  '/auth/login.html',
  '/src/assets/css/global.css',
  '/src/assets/css/admin.css',
  '/src/assets/css/salesman.css',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// INSTALL - precache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[SW] Precache gagal:', err))
  );
});

// ACTIVATE - bersihkan cache versi lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// FETCH - strategi berbeda untuk API/Supabase vs aset statis
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return; // jangan cache POST/PUT dsb (mis. absen ke Supabase)

  const url = new URL(request.url);

  // Jangan campur tangan pada request ke Supabase / API eksternal - selalu network
  if (url.origin !== self.location.origin) {
    return;
  }

  // Network-first untuk halaman HTML (biar data selalu terbaru saat online)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate untuk aset statis (css/js/gambar/icon):
  // langsung pakai cache biar cepat, TAPI di background selalu ambil versi
  // terbaru dari server dan update cache-nya untuk request berikutnya.
  // Ini mencegah file JS/CSS lama "nyangkut" di cache selamanya setelah
  // ada perbaikan kode di server.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchAndUpdate = fetch(request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached);

      return cached || fetchAndUpdate;
    })
  );
});
