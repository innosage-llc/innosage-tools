// Build replaces the manifest. This worker owns only the static demo shell.
const assets = __BYOS_SHELL_ASSETS__;
const cacheName = __BYOS_SHELL_CACHE__;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Fetch and validate the complete pair before making this worker eligible.
    const responses = await Promise.all(assets.map(async asset => {
      const response = await fetch(asset.url, {cache: 'reload', credentials: 'omit', integrity: asset.integrity, signal: AbortSignal.timeout(15000)});
      if (!response.ok || response.redirected || !response.headers.get('Content-Type')?.includes(asset.type))
        throw new Error('Offline shell asset unavailable');
      return response;
    }));
    const cache = await caches.open(cacheName);
    await Promise.all(assets.map((asset, i) => cache.put(asset.url, responses[i])));
    // No skipWaiting: an update never takes over an open editor automatically.
  })());
});
self.addEventListener('activate', event => {
  // First installation controls its current page. Retain prior complete caches;
  // never discard one beneath an existing tab or touch IndexedDB/local intent.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data === 'BYOS_OFFLINE_SHELL') event.ports[0]?.postMessage({cacheName, bundle: assets[1].url});
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && ['/byos-demo/', '/byos-demo/index.html'].includes(url.pathname)) {
    // Preserve workspace/session in the address, never in CacheStorage keys.
    event.respondWith(fetch(request).then(response => {
      if (!response.ok) throw new Error('Shell navigation unavailable');
      return response;
    }).catch(async () => {
      const response = await (await caches.open(cacheName)).match(assets[0].url);
      if (!response) throw new Error('Complete offline shell unavailable');
      return response;
    }));
  } else if (url.pathname + url.search === assets[1].url) {
    // Pinned HTML always uses its corresponding, integrity-checked bundle.
    event.respondWith((async () => {
      const response = await (await caches.open(cacheName)).match(assets[1].url);
      if (!response) throw new Error('Complete offline bundle unavailable');
      return response;
    })());
  }
  // Google/GIS/API, credentials, bodies and other site routes pass through.
});
