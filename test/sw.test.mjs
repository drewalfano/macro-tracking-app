/**
 * The service worker's lifecycle, run against fakes.
 *
 * The worker is a script that registers three handlers on `self` and talks to
 * `caches` and `fetch`. None of that needs a browser to exercise: a fake cache
 * storage, a fake network that can be told which files exist, and a `self`
 * that collects the handlers are enough to ask the questions that matter —
 * does a failed install leave the old version alone, does a good one clean
 * up, and does a cold launch with the radio off get the app.
 */

import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const ROOT = new URL('../', import.meta.url)
const { cacheVersion } = await import(new URL('scripts/cacheVersion.mjs', ROOT).href)

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`
  )
}

/* ---------------------------------------------------------- cache version */

eq(
  'same content, same version',
  cacheVersion([{ name: 'a.js', content: 'x' }]),
  cacheVersion([{ name: 'a.js', content: 'x' }])
)
eq(
  'different content of the same length differs',
  cacheVersion([{ name: 'a.js', content: 'const a = 1' }]) ===
    cacheVersion([{ name: 'a.js', content: 'const a = 2' }]),
  false
)
eq(
  'the same bytes under a different name differ',
  cacheVersion([{ name: 'a.js', content: 'x' }]) === cacheVersion([{ name: 'b.js', content: 'x' }]),
  false
)
eq(
  'part order does not matter',
  cacheVersion([
    { name: 'a', content: '1' },
    { name: 'b', content: '2' },
  ]),
  cacheVersion([
    { name: 'b', content: '2' },
    { name: 'a', content: '1' },
  ])
)
eq(
  'a changed icon changes the version',
  cacheVersion([
    { name: 'a', content: '1' },
    { name: 'public/icons/icon-192.png', content: new Uint8Array([1, 2, 3]) },
  ]) ===
    cacheVersion([
      { name: 'a', content: '1' },
      { name: 'public/icons/icon-192.png', content: new Uint8Array([1, 2, 4]) },
    ]),
  false
)
eq('twelve hex characters', /^[0-9a-f]{12}$/.test(cacheVersion([{ name: 'a', content: '' }])), true)

/* ------------------------------------------------------------ the sandbox */

const ORIGIN = 'https://example.test'
const BASE = '/trackd/'
const REQUIRED = [
  '/trackd/',
  '/trackd/assets/index-AAA.js',
  '/trackd/assets/index-AAA.css',
  '/trackd/manifest.webmanifest',
]
const OPTIONAL = ['/trackd/icons/icon-192.png', '/trackd/icons/apple-touch-icon.png']

const template = readFileSync(new URL('src/sw.template.js', ROOT), 'utf8')

const abs = (input) => new URL(input instanceof Request ? input.url : String(input), ORIGIN).href

/** Requests in a worker resolve relative URLs against its location; Node's do not. */
class WorkerRequest extends Request {
  constructor(input, init) {
    super(abs(input), init)
  }
}

class FakeCache {
  constructor() {
    this.store = new Map()
  }
  key(input) {
    const url = new URL(abs(input))
    url.search = ''
    return url.href
  }
  async addAll(requests) {
    const responses = await Promise.all(requests.map((r) => fetchImpl(r)))
    const bad = responses.find((r) => !r.ok)
    if (bad) throw new TypeError('Request failed')
    requests.forEach((r, i) => this.store.set(this.key(r), responses[i]))
  }
  async put(request, response) {
    this.store.set(this.key(request), response)
  }
  async match(request) {
    const hit = this.store.get(this.key(request))
    return hit ? hit.clone() : undefined
  }
  async keys() {
    return [...this.store.keys()].map((k) => new WorkerRequest(k))
  }
  async delete(request) {
    return this.store.delete(this.key(request))
  }
}

class FakeCacheStorage {
  constructor() {
    this.caches = new Map()
  }
  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name)
  }
  async has(name) {
    return this.caches.has(name)
  }
  async keys() {
    return [...this.caches.keys()]
  }
  async delete(name) {
    return this.caches.delete(name)
  }
  async match(request, opts) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request, opts)
      if (hit) return hit
    }
    return undefined
  }
}

/** What the network currently has. `null` means the request fails outright. */
let network = null
let fetchLog = []
let cacheModes = []
async function fetchImpl(input) {
  const url = abs(input)
  fetchLog.push(url)
  cacheModes.push(input instanceof Request ? input.cache : 'default')
  if (network === null) throw new TypeError('Failed to fetch')
  const path = new URL(url).pathname
  const body = network.get(path)
  if (body === undefined) return new Response('not found', { status: 404 })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' } })
}

function boot({ version, caches, skipped, claimed }) {
  const handlers = {}
  const self = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: () => skipped.push(version),
    clients: { claim: async () => claimed.push(version) },
    location: { origin: ORIGIN },
  }
  const warnings = []
  const source = template
    .replace('__VERSION__', JSON.stringify(version))
    .replace('__BASE__', JSON.stringify(BASE))
    .replace('__PRECACHE__', JSON.stringify(REQUIRED))
    .replace('__OPTIONAL__', JSON.stringify(OPTIONAL))
  const context = vm.createContext({
    self,
    caches,
    fetch: fetchImpl,
    Request: WorkerRequest,
    Response,
    Headers,
    URL,
    console: { warn: (...args) => warnings.push(args.map(String).join(' ')), log() {} },
  })
  vm.runInContext(source, context, { filename: 'sw.js' })

  const run = async (type, extra = {}) => {
    const waited = []
    handlers[type]({ waitUntil: (p) => waited.push(p), ...extra })
    await Promise.all(waited)
  }
  /**
   * Node's `Request` refuses `mode: 'navigate'` (only the browser may make
   * one), so the mode is written over the top after construction.
   */
  const request = async (input, { mode, ...init } = {}) => {
    const req = new WorkerRequest(input, init)
    if (mode) Object.defineProperty(req, 'mode', { value: mode })
    let promise = null
    handlers.fetch({
      request: req,
      respondWith: (p) => (promise = Promise.resolve(p)),
    })
    return promise
  }
  return { run, request, warnings }
}

const withShell = (assets = REQUIRED, icons = OPTIONAL) =>
  new Map([...assets, ...icons].map((p) => [p, `body of ${p}`]))

const cacheNames = async (caches) => (await caches.keys()).sort()
const cachedPaths = async (caches, name) =>
  (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname).sort()

/* ---------------------------------------------------- successful install */

{
  const caches = new FakeCacheStorage()
  const skipped = []
  const claimed = []
  network = withShell()
  fetchLog = []
  cacheModes = []
  const sw = boot({ version: 'v1', caches, skipped, claimed })
  let installed = true
  await sw.run('install').catch(() => (installed = false))
  eq('a complete shell installs', installed, true)
  eq('every required and optional file is cached', await cachedPaths(caches, 'mt-shell-v1'), [
    ...REQUIRED,
    ...OPTIONAL,
  ].sort())
  eq('every install fetch bypasses the HTTP cache', [...new Set(cacheModes)], ['reload'])
  await sw.run('activate')
  eq('activating claims the clients', claimed, ['v1'])

  /* ------------------------------------------------ optional asset failure */

  const caches2 = new FakeCacheStorage()
  network = withShell(REQUIRED, [OPTIONAL[0]]) // the touch icon is missing
  const sw2 = boot({ version: 'v1', caches: caches2, skipped: [], claimed: [] })
  let ok = true
  await sw2.run('install').catch(() => (ok = false))
  eq('a missing optional asset does not fail the install', ok, true)
  eq('the required set is complete without it', await cachedPaths(caches2, 'mt-shell-v1'), [
    ...REQUIRED,
    OPTIONAL[0],
  ].sort())
  eq('and the skip is logged', sw2.warnings.some((w) => w.includes('apple-touch-icon')), true)
}

/* -------------------------------------------------------- failed install */

{
  // A device already on v1, complete, plus the OFF cache it built up.
  const caches = new FakeCacheStorage()
  network = withShell()
  const v1 = boot({ version: 'v1', caches, skipped: [], claimed: [] })
  await v1.run('install')
  await v1.run('activate')
  const off = await caches.open('mt-off-v1')
  await off.put('https://world.openfoodfacts.org/api/v2/product/1.json', new Response('{}'))

  // A v2 deploy in progress: the CSS is not on the server yet.
  network = withShell(REQUIRED.filter((p) => !p.endsWith('.css')))
  const v2 = boot({ version: 'v2', caches, skipped: [], claimed: [] })
  let installed = true
  await v2.run('install').catch(() => (installed = false))
  eq('a missing required asset fails the install', installed, false)
  eq('the half-built cache is thrown away', await cacheNames(caches), ['mt-off-v1', 'mt-shell-v1'])
  eq('the previous shell is untouched', (await cachedPaths(caches, 'mt-shell-v1')).length, REQUIRED.length + OPTIONAL.length)

  // The network comes back with everything, and the retry succeeds cleanly.
  network = withShell()
  let retried = true
  await v2.run('install').catch(() => (retried = false))
  eq('the retry installs', retried, true)
  await v2.run('activate')
  eq('activation removes the old shell and keeps the OFF cache', await cacheNames(caches), [
    'mt-off-v1',
    'mt-shell-v2',
  ])
}

/* --------------------------------------------- activate with an evicted cache */

{
  const caches = new FakeCacheStorage()
  network = withShell()
  const v1 = boot({ version: 'v1', caches, skipped: [], claimed: [] })
  await v1.run('install')
  await v1.run('activate')

  const v2 = boot({ version: 'v2', caches, skipped: [], claimed: [] })
  await v2.run('install')
  // Storage pressure evicts a file between install and activate.
  await (await caches.open('mt-shell-v2')).delete('/trackd/assets/index-AAA.js')
  await v2.run('activate')
  eq('an incomplete new shell does not delete the old one', await cacheNames(caches), [
    'mt-shell-v1',
    'mt-shell-v2',
  ])
  eq('and says so', v2.warnings.some((w) => w.includes('incomplete')), true)

  // The evicted asset is not answered from the OLD version's cache.
  network = null
  const res = await v2.request('/trackd/assets/index-AAA.js', { mode: 'no-cors' }).catch((e) => e)
  eq('a missing asset is never taken from another version', res instanceof Error, true)
}

/* --------------------------------------------------------- offline launch */

{
  const caches = new FakeCacheStorage()
  network = withShell()
  const sw = boot({ version: 'v1', caches, skipped: [], claimed: [] })
  await sw.run('install')
  await sw.run('activate')

  network = null // radio off
  const doc = await sw.request('/trackd/', { mode: 'navigate' })
  eq('the document launches from the cache', await doc.text(), 'body of /trackd/')
  const docQuery = await sw.request('/trackd/?source=homescreen', { mode: 'navigate' })
  eq('a query string still finds the document', await docQuery.text(), 'body of /trackd/')
  const asset = await sw.request('/trackd/assets/index-AAA.js')
  eq('an asset launches from the cache', await asset.text(), 'body of /trackd/assets/index-AAA.js')
  const icon = await sw.request('/trackd/icons/icon-192.png')
  eq('an optional asset is served when it was cached', await icon.text(), 'body of /trackd/icons/icon-192.png')
  const offRes = await sw.request('https://world.openfoodfacts.org/api/v2/search?x=1')
  eq('an uncached OFF lookup gets the offline sentinel', [offRes.status, (await offRes.json()).offline], [503, true])

  // Online again, and the document is still answered from the cache: the
  // update path is the only way a new build reaches the page.
  network = new Map([['/trackd/', 'a NEW document from the server']])
  fetchLog = []
  const same = await sw.request('/trackd/', { mode: 'navigate' })
  eq('online, the cached document still wins', await same.text(), 'body of /trackd/')
  eq('and no network request was made for it', fetchLog, [])

  // Anything else on the origin is not the shell: the worker stays out of it
  // and the browser fetches the page itself, so it is never served the app's
  // document in its place and never written into the shell cache.
  const probe = await sw.request('/trackd/probe-safe.html', { mode: 'navigate' })
  eq('another page on the origin is left to the browser', probe, null)
  const probeAsset = await sw.request('/trackd/probe-safe.html')
  eq('and its bytes are not written into the shell cache', probeAsset === null || !(await cachedPaths(caches, 'mt-shell-v1')).includes('/trackd/probe-safe.html'), true)
}

/* --------------------------------------------------------------- messages */

{
  const skipped = []
  const sw = boot({ version: 'v1', caches: new FakeCacheStorage(), skipped, claimed: [] })
  await sw.run('message', { data: { type: 'SKIP_WAITING' } })
  await sw.run('message', { data: { type: 'SOMETHING_ELSE' } })
  eq('only SKIP_WAITING skips waiting', skipped, ['v1'])
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
