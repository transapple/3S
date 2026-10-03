/* ShalomStream Studio service worker
   - Downloads the whole app (page, icons, fonts, Supabase library) on first open
   - Opens instantly, with or without internet
   - Data and saved changes are handled inside the page (index.html) */
const VER = 'ss-studio-v4';
const IMG = 'ss-images-v1';
const SHELL = ['./', './index.html', './manifest.json', './logo.png', './logo-icon.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap';
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VER);
    await c.addAll(SHELL);
    // Extras: never block the install if one of them fails
    await Promise.allSettled([
      fetch(LIB).then(r => r.ok && c.put(LIB, r)),
      (async () => {
        const r = await fetch(FONT_CSS);
        if (!r.ok) return;
        const css = await r.clone().text();
        await c.put(FONT_CSS, r);
        const files = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
        await Promise.allSettled(files.map(u => fetch(u).then(x => x.ok && c.put(u, x))));
      })()
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VER && k !== IMG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Opening the app: fresh page if the internet answers quickly, otherwise the saved page
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const cache = await caches.open(VER);
      const net = fetch(req).then(r => { if (r.ok) cache.put('./index.html', r.clone()); return r; });
      net.catch(() => {});
      const saved = () => cache.match('./index.html', { ignoreSearch: true }).then(r => r || cache.match('./'));
      try {
        return await Promise.race([net, new Promise((_, rej) => setTimeout(rej, 4000))]);
      } catch (_) {
        return (await saved()) || net;
      }
    })());
    return;
  }

  // App files, fonts and the Supabase library: saved copy first, refreshed in the background
  if (url.origin === location.origin || CDN.includes(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VER);
      const hit = await cache.match(req, { ignoreVary: true });
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
    return;
  }

  // Pictures (covers, avatars, video thumbnails): keep the ones already seen
  if (req.destination === 'image' && (url.hostname.endsWith('.supabase.co') || url.hostname === 'i.ytimg.com')) {
    e.respondWith((async () => {
      const cache = await caches.open(IMG);
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) { cache.put(req, res.clone()); trim(IMG, 150); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })());
  }
  // Everything else (database, uploads, embedded players) goes to the network
});
