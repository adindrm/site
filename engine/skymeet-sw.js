/* Skymeet service worker. Didaftarkan dengan scope 'skymeet' (mencakup /engine/skymeet dan /engine/skymeet.html),
   jadi TIDAK menyentuh halaman lain di situs utama.
   Naikkan VERSI setiap kali kamu mengganti isi html/aset agar cache lama dibuang. */
const VERSI = 'skymeet-v21';
const IMG = 'skymeet-img';                    // gambar profil (Google Drive); tidak ikut dibuang saat VERSI naik
const IMG_MAX = 120;                          // batas jumlah gambar profil di cache
const SHELL = ['skymeet', 'skymeet.html', 'skymeet.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSI).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  /* hanya hapus cache milik Skymeet; cache situs utama dibiarkan */
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.indexOf('skymeet-') === 0 && k !== VERSI && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* halaman memanggil ini saat SW baru sudah terpasang (lihat skymeet.html) */
self.addEventListener('message', e => { if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });

const put = (name, req, res, max) => caches.open(name).then(async c => {
  await c.put(req, res);
  if(max){ const ks = await c.keys(); for(let i = 0; i < ks.length - max; i++) await c.delete(ks[i]); }   // buang yang tertua
}).catch(() => {});

/* stale-while-revalidate: tampil dari cache seketika, segarkan di belakang layar (dijaga e.waitUntil agar tidak terputus) */
function swr(e, name, max){
  const r = e.request;
  e.respondWith(caches.open(name).then(async c => {
    const hit = await c.match(r);
    const net = fetch(r).then(res => { if(res && (res.ok || res.type === 'opaque')) put(name, r, res.clone(), max); return res; }).catch(() => null);
    e.waitUntil(net);
    return hit || (await net) || Response.error();
  }));
}

self.addEventListener('fetch', e => {
  const r = e.request;
  if(r.method !== 'GET') return;
  if(r.headers.get('range')) return;           // streaming musik: biarkan browser
  const u = new URL(r.url);
  if(u.hostname === 'lh3.googleusercontent.com' && u.pathname.indexOf('/d/') === 0){ swr(e, IMG, IMG_MAX); return; }   // gambar profil: cepat dari cache
  if(u.origin !== location.origin) return;     // Apps Script (API) dan Google Fonts: langsung ke jaringan
  if(r.mode === 'navigate'){                   // halaman: utamakan versi terbaru; jaringan lambat (>2,5 dtk) atau offline -> cache
    e.respondWith((async () => {
      const cached = () => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('skymeet') || caches.match('skymeet.html'));
      const net = fetch(r).then(res => { if(res.ok) put(VERSI, r, res.clone()); return res; });
      net.catch(() => {});                     // cegah "unhandled rejection" bila cache yang menang balapan
      try { return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 2500))]); }
      catch(_) { return (await cached()) || net; }
    })());
    return;
  }
  swr(e, VERSI);                               // ikon/aset: cepat dari cache, diperbarui di belakang
});
