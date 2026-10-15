/* Service worker: menyimpan "cangkang" aplikasi (halaman pembungkus + ikon).
   Isi aplikasi tetap dimuat dari Google Apps Script dan butuh internet.
   Hanya file yang tercantum di FILES yang ditangani; halaman lain di folder ini tidak disentuh.
   Ubah angka VERSI setiap kali file di folder ini diperbarui. */
const VERSI = 'v7';
const CACHE = 'unggasmandiri-' + VERSI;
const FILES = ['./unggasmandiri.html', './unggasmandiri.json', './unggasmandiriicons/icon-192.png', './unggasmandiriicons/icon-512.png', './unggasmandiriicons/apple-touch-icon.png'];
const URLS = new Set(FILES.map(f => new URL(f, self.location).href));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => (n.startsWith('unggasmandiri-') || n.startsWith('admin-nota-')) && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url); u.search = ''; u.hash = '';
  if (!URLS.has(u.href)) return; // file lain di folder ini: biarkan normal
  // jaringan dulu, cache sebagai cadangan saat offline
  e.respondWith(fetch(r).then(res => {
    const cp = res.clone(); caches.open(CACHE).then(c => c.put(u.href, cp)); return res;
  }).catch(() => caches.match(u.href)));
});
