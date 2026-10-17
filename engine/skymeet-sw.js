/* Skymeet service worker. Didaftarkan dengan scope 'skymeet' (mencakup /engine/skymeet dan /engine/skymeet.html),
   jadi TIDAK menyentuh halaman lain di situs utama.
   Naikkan VERSI setiap kali kamu mengganti isi html/aset agar cache lama dibuang. */
const VERSI = 'skymeet-v18';
const SHELL = ['skymeet', 'skymeet.html', 'skymeet.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  /* hanya hapus cache milik Skymeet; cache situs utama dibiarkan */
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.indexOf('skymeet-') === 0 && k !== VERSI).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if(r.method !== 'GET') return;
  const u = new URL(r.url);
  if(u.origin !== location.origin) return;     // Apps Script (API) dan Google Fonts: langsung ke jaringan
  if(r.headers.get('range')) return;           // streaming musik: biarkan browser
  if(r.mode === 'navigate'){                   // halaman: utamakan versi terbaru; jaringan lambat (>2,5 dtk) atau offline -> cache
    e.respondWith((async () => {
      const cached = () => caches.match(r).then(m => m || caches.match('skymeet') || caches.match('skymeet.html'));
      const net = fetch(r).then(res => { if(res.ok){ const cp = res.clone(); caches.open(VERSI).then(c => c.put(r, cp)); } return res; });
      try { return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 2500))]); }
      catch(_) { return (await cached()) || net; }
    })());
    return;
  }
  e.respondWith(caches.match(r).then(m => {    // ikon/aset: cepat dari cache, diperbarui di belakang
    const net = fetch(r).then(res => { if(res.ok){ const cp = res.clone(); caches.open(VERSI).then(c => c.put(r, cp)); } return res; }).catch(() => m);
    return m || net;
  }));
});
