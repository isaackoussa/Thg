// Construit le site Netlify (dist/) à partir de la page de l'app (app/index.html).
// app/index.html reste la source unique : elle est aussi publiée telle quelle en artifact.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const src = readFileSync(root + 'app/index.html', 'utf8');
const cut = src.indexOf('<div class="top">');
if (cut < 0) throw new Error('Repère <div class="top"> introuvable dans app/index.html');
const headPart = src.slice(0, cut).trim();
const bodyPart = src.slice(cut).trim();
const version = createHash('sha256').update(src).digest('hex').slice(0, 10);

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Analyse des états financiers des banques de l'UMOA : dynamique du bilan, ratios de structure, ROA/ROE, Bâle III et test de faillite, avec les formules détaillées.">
<meta name="theme-color" content="#0c5a48">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Analyste UMOA">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
:root { color-scheme: light; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
body { margin: 0; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
${headPart}
</head>
<body>
${bodyPart}
<noscript><p style="padding:16px">Cette application nécessite JavaScript.</p></noscript>
<script>
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
</script>
</body>
</html>
`;

const manifest = {
  name: 'Analyste Bancaire UMOA',
  short_name: 'Analyste UMOA',
  description: "Analyse des états financiers des banques de l'UMOA",
  lang: 'fr',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f2f4f1',
  theme_color: '#0c5a48',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }
  ]
};

// Service worker : réseau d'abord pour la page (mises à jour immédiates), cache en secours pour l'usage hors ligne.
const sw = `const CACHE = 'umoa-${version}';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isPage = req.mode === 'navigate';
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !isFont) return;
  if (isPage) {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)); return r; }).catch(() => caches.match('/')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; })));
});
`;

rmSync(root + 'dist', { recursive: true, force: true });
mkdirSync(root + 'dist');
writeFileSync(root + 'dist/index.html', html);
writeFileSync(root + 'dist/manifest.webmanifest', JSON.stringify(manifest, null, 2));
writeFileSync(root + 'dist/sw.js', sw);
for (const f of readdirSync(root + 'public')) copyFileSync(root + 'public/' + f, root + 'dist/' + f);
console.log('Site construit dans dist/ (version ' + version + ')');
