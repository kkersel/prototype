// Runtime-cache service worker. Works with Vite's hashed asset names because it
// caches on fetch instead of precaching a fixed manifest. Only activates in a
// secure context (https or localhost) — over plain LAN http the browser ignores
// it, and the app falls back to its in-memory + IndexedDB resilience.
const CACHE = 'tp-runtime-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  // Never cache the API — the server is a shared source of truth, so prototype
  // lists, docs and heatmap events must always come fresh over the network.
  if (url.pathname.startsWith('/api/')) return

  // Navigations: network-first, fall back to cached shell so the player can
  // cold-start offline once it has been opened online at least once.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('/index.html', res.clone()))
          return res
        })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match(request)))
    )
    return
  }

  // Assets, uploads (media), prototype GETs: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request)
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) cache.put(request, res.clone())
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
