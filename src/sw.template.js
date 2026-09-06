/* eslint-env serviceworker */
/**
 * Service worker.
 *
 * Built by the `trackd:sw` plugin in vite.config.js, which stamps in the
 * hashed asset list below. Three jobs, and no more than three:
 *
 *   1. Precache the app shell so a cold launch works with the radio off.
 *   2. Stale-while-revalidate Open Food Facts, so a food seen once resolves
 *      offline forever after.
 *   3. Never swap versions underneath someone mid-entry — the page asks first.
 *
 * **One version at a time, whole or not at all.** Everything the shell needs
 * lives in one cache named for this build, and that cache is only ever read
 * once every required file is in it. An install that cannot get every file
 * fails, throws its half-built cache away, and leaves the previous worker —
 * and the previous, complete cache — serving the app exactly as before. The
 * document and its assets are answered from the same cache, so the page can
 * never be one version and its scripts another.
 */

const VERSION = __VERSION__
const BASE = __BASE__
/** Without every one of these the app does not run. The install needs them all. */
const PRECACHE = __PRECACHE__
/** Nice to have offline. A failure here is logged and the install carries on. */
const OPTIONAL = __OPTIONAL__

const SHELL_CACHE = `mt-shell-${VERSION}`
const SHELL_PREFIX = 'mt-shell-'
const OFF_CACHE = 'mt-off-v1'
const OFF_HOST = 'world.openfoodfacts.org'
const OFF_MAX_ENTRIES = 300

/**
 * `ignoreVary` is load-bearing, not a nicety.
 *
 * Precaching from a list of URL strings stores each response against a request
 * that carries no `Origin` header. A `<script type="module">` tag, however, is
 * fetched in CORS mode and does send one. Hosts that reply `Vary: Origin` — Vite
 * preview and a good few static hosts do — therefore make the cached entry fail
 * to match the very request it exists to answer, and the app boots to a blank
 * screen the first time it is opened offline.
 *
 * `ignoreSearch` for the document: a launch from the home screen can carry a
 * query string, and the shell is the same document whatever is after the `?`.
 */
const MATCH = { ignoreVary: true, ignoreSearch: true }

/**
 * Bypass the HTTP cache while installing.
 *
 * The hashed assets are immutable and could take whatever the HTTP cache has,
 * but the document and the manifest are not, and a stale copy of either taken
 * from the browser's own cache would be stamped into a version that claims to
 * be new. One rule for the whole list is simpler than two, and the install is
 * the one time the extra bytes cost nothing anyone is waiting on.
 */
const fresh = (url) => new Request(url, { cache: 'reload' })

/* ----------------------------------------------------------------- install */

/**
 * Every required file, or nothing.
 *
 * `addAll` is atomic per call — one failed fetch rejects the lot and nothing
 * from the batch is stored — but the cache itself outlives the failure, and a
 * retry into a cache that already has a few files from an earlier attempt is
 * how a shell ends up half one attempt and half another. So a failed install
 * deletes the cache it was building before it rethrows. The rejection is what
 * makes the browser discard this worker; the previous one keeps the page.
 *
 * The optional files go in one at a time after the required set is complete,
 * each failure caught on its own. They are ordered after, not alongside, so a
 * slow icon cannot hold the shell hostage and a missing one cannot fail it.
 */
async function installShell() {
  const cache = await caches.open(SHELL_CACHE)
  try {
    await cache.addAll(PRECACHE.map(fresh))
  } catch (err) {
    await caches.delete(SHELL_CACHE)
    throw err
  }
  await Promise.all(
    OPTIONAL.map(async (url) => {
      try {
        const response = await fetch(fresh(url))
        if (response.ok) await cache.put(url, response)
        else console.warn('Optional asset skipped', url, response.status)
      } catch (err) {
        console.warn('Optional asset skipped', url, err)
      }
    })
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(installShell())
})

/* ---------------------------------------------------------------- activate */

/**
 * Whether the cache for this version holds every required file.
 *
 * It always should — the install cannot succeed otherwise — but the check is
 * what stands between "should" and deleting the only complete shell on the
 * device. Storage can be evicted between install and activate, and a worker
 * whose cache has been emptied under it must not go on to clear out the one
 * that still works.
 */
async function shellIsComplete() {
  if (!(await caches.has(SHELL_CACHE))) return false
  const cache = await caches.open(SHELL_CACHE)
  const found = await Promise.all(PRECACHE.map((url) => cache.match(url, MATCH)))
  return found.every(Boolean)
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      /**
       * Old shells go only once the new one is verified whole. An incomplete
       * cache is left beside the old ones rather than replacing them, and the
       * fetch handler below falls through to the network for anything it does
       * not hold — degraded, but never a blank screen.
       */
      if (await shellIsComplete()) {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter((key) => key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE)
            .map((key) => caches.delete(key))
        )
      } else {
        console.warn('Shell cache incomplete; previous versions kept')
      }
      await self.clients.claim()
    })()
  )
})

/**
 * Only ever sent by the page, and only after someone tapped Update. A worker
 * that skips waiting on its own swaps the app out from under whatever was being
 * typed; see `registerServiceWorker` in main.js.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

/* ------------------------------------------------------------ Open Food Facts */

/** Keep the OFF cache from growing without bound. Oldest entries go first. */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  if (keys.length <= max) return
  await Promise.all(keys.slice(0, keys.length - max).map((key) => cache.delete(key)))
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(OFF_CACHE)
  const cached = await cache.match(request, { ignoreVary: true })

  const network = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).then(() => trimCache(OFF_CACHE, OFF_MAX_ENTRIES))
      }
      return response
    })
    .catch(() => null)

  // Cached answer immediately when we have one; the refresh lands in the
  // background for next time.
  if (cached) return cached
  const fresh = await network
  if (fresh) return fresh
  return new Response(JSON.stringify({ status: 0, offline: true }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  })
}

/* -------------------------------------------------------------------- shell */

const shellPaths = new Set([BASE, `${BASE}index.html`])

/** The app's own document, as opposed to anything else served from the origin. */
const isShellDocument = (url) => shellPaths.has(url.pathname)

/**
 * The document, from this version's cache first.
 *
 * It was network-first, and that is the wrong order for an app shell: it made
 * every launch wait on a round trip that could take seconds on a weak signal,
 * and it meant the page could arrive from the network as one version while the
 * worker controlling it — and the cache answering its asset requests — was
 * another. Cache-first ties the document to the cache its assets are in, so the
 * two are the same build by construction. New builds arrive through the update
 * path only, which is the one the page already asks permission for.
 *
 * The network is the fallback rather than the first choice, for a worker whose
 * cache was evicted; and a request for some other path on this origin — the
 * viewport probe pages — is not the shell and goes straight to the network.
 */
async function shellDocument(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = (await cache.match(BASE, MATCH)) || (await cache.match(`${BASE}index.html`, MATCH))
  if (cached) return cached
  try {
    return await fetch(request)
  } catch {
    return Response.error()
  }
}

/**
 * Same-origin assets: this version's cache, then the network.
 *
 * Matched against `SHELL_CACHE` and not across every cache, which is the other
 * half of "one version at a time". While a previous shell is still on disk —
 * an activate that found this one incomplete leaves it there — a global match
 * could answer a request for a new file with an old one that happens to share
 * a name, and unhashed names like the manifest do.
 *
 * Only files that belong to this version are written back. A response for
 * anything else is passed through without being stored, so the shell cache
 * holds exactly what the build said it should and nothing that drifted in.
 */
const ownsAsset = (url) => PRECACHE.includes(url.pathname) || OPTIONAL.includes(url.pathname)

async function cacheFirst(request, url) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(request, MATCH)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && ownsAsset(url)) cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Hash routing means every navigation to the app is the same document.
  if (request.mode === 'navigate') {
    if (url.origin === self.location.origin && isShellDocument(url)) {
      event.respondWith(shellDocument(request))
    }
    return
  }

  if (url.hostname === OFF_HOST) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, url))
  }
})
