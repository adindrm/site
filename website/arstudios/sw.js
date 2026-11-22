/* Naikkan angka versi setiap kali index.html diganti agar cache lama dibersihkan */
const C = 'ars-v25',
  F = [
    './',
    'index.html',
    'manifest.webmanifest',
    'arstudios.otf',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/maskable-512.png',
    'icons/apple-touch-icon.png'
  ];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(C)
      .then(c => Promise.all(F.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(x => x != C).map(x => caches.delete(x))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request,
    u = new URL(r.url);
  if (r.method !== 'GET' || u.hostname.endsWith('script.google.com') || u.hostname.endsWith('googleusercontent.com')) return;   /* API selalu langsung ke jaringan; antrean offline diurus aplikasi */
  e.respondWith(
    fetch(r)
      .then(x => {
        if (x.ok && u.origin === location.origin) {
          const y = x.clone();
          caches.open(C).then(c => c.put(r, y));
        }
        return x;
      })
      .catch(() => caches.match(r, { ignoreSearch: true })
        .then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
