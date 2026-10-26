/* HfO2 Lab app files only. Experimental inputs stay in IndexedDB, never in this cache. */
'use strict';
const BUILD_ID = '0.5.5-e5d8bcdbde7f4630';
const APP_ASSETS = ["./index.html","./manifest.webmanifest","./icons/icon-192.png","./icons/icon-512.png","./icons/maskable-512.png","./icons/icon.svg"];
const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'hfo2-pwa:' + encodeURIComponent(SCOPE.href) + ':';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const ASSET_URLS = APP_ASSETS.map(asset => new URL(asset, SCOPE).href);
const INDEX_URL = new URL('./index.html', SCOPE).href;
if (!ASSET_URLS.includes(INDEX_URL) || ASSET_URLS.some(url => {
  const value = new URL(url);
  return value.origin !== SCOPE.origin || !value.pathname.startsWith(SCOPE.pathname) || value.search || value.hash;
})) throw new Error('Invalid app cache asset list.');
const ASSET_SET = new Set(ASSET_URLS);

async function completeCache() {
  const cache = await caches.open(CACHE_NAME);
  const stored = await Promise.all(ASSET_URLS.map(url => cache.match(url)));
  return stored.every(response => response && response.ok && response.type !== 'opaque');
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(ASSET_URLS.map(url => new Request(url, {cache: 'reload', credentials: 'same-origin'})));
      if (!await completeCache()) throw new Error('App files were not fully cached.');
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // A new version waits until all old windows close, or the user explicitly applies it.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  const appNavigation = request.mode === 'navigate' && (url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX_URL).pathname);
  const canonical = appNavigation ? INDEX_URL : url.href;
  if (!appNavigation && !ASSET_SET.has(canonical)) return;
  event.respondWith((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(canonical);
      if (cached) return cached;
    } catch (_) { /* Online use still works if browser cache access is unavailable. */ }
    // Do not cache arbitrary responses, data files, or files from a later build.
    return fetch(request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'HFO2_CACHE_STATUS') {
    const port = event.ports?.[0];
    if (!port) return;
    event.waitUntil((async () => {
      let ready = false;
      try { ready = await completeCache(); } catch (_) {}
      port.postMessage({type: 'HFO2_CACHE_STATUS', ready, buildId: BUILD_ID});
    })());
  } else if (event.data?.type === 'HFO2_SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});
