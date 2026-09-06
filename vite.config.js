import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { cacheVersion } from './scripts/cacheVersion.mjs'

// Repo name on GitHub Pages. Override with BASE_PATH=/ for a custom domain.
const base = process.env.BASE_PATH ?? '/trackd/'

/**
 * Files copied verbatim out of `public/` that the shell needs.
 *
 * These never appear in Rollup's bundle, so they are listed by hand, split by
 * what happens if one of them fails to download. The manifest is required:
 * without it the installed app has no identity. The icons are optional: the
 * home-screen icon was copied out at install time and lives in the launcher,
 * so a failed icon fetch costs nothing the app needs to run offline, and it
 * must not be allowed to fail the whole install.
 */
const PUBLIC_REQUIRED = ['manifest.webmanifest']
const PUBLIC_OPTIONAL = [
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
]

/**
 * Hand-rolled service worker build step.
 *
 * Workbox is a lot of machinery for "precache the shell, stale-while-revalidate
 * one API host". All this needs to do is take the final hashed filenames Rollup
 * produced and stamp them into a template, so that's all it does.
 */
function serviceWorker() {
  const root = process.cwd()
  const templatePath = resolve(root, 'src/sw.template.js')
  return {
    name: 'trackd:sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .map((f) => base + f)

      const required = [
        ...new Set([base, ...PUBLIC_REQUIRED.map((f) => base + f), ...assets]),
      ].sort()
      const optional = PUBLIC_OPTIONAL.map((f) => base + f).sort()

      /**
       * Content-derived version: the worker re-installs when, and only when,
       * something it caches has changed. See `cacheVersion` for why a length
       * was never a version.
       *
       * The parts are everything the worker will put in the shell cache: the
       * bundle Rollup produced, the HTML template the document is built from
       * (the built `index.html` is emitted after this hook runs, but it is a
       * pure function of the template and the hashed asset names, both of
       * which are in here), and every public file listed above — required and
       * optional alike, so a redrawn icon changes the version too. The worker's
       * own source is included so a change to the caching logic gets a fresh
       * cache rather than inheriting one built under the old rules.
       */
      const parts = Object.entries(bundle)
        .filter(([f]) => !f.endsWith('.map'))
        .map(([f, c]) => ({ name: f, content: c.type === 'chunk' ? c.code : c.source }))
      parts.push({ name: 'index.html', content: readFileSync(resolve(root, 'index.html')) })
      const source = readFileSync(templatePath, 'utf8')
      parts.push({ name: 'sw.template.js', content: source })
      for (const f of [...PUBLIC_REQUIRED, ...PUBLIC_OPTIONAL]) {
        const path = resolve(root, 'public', f)
        // A missing public file is a build error, not a quietly shorter hash:
        // the worker would go on to precache a URL that 404s.
        if (!existsSync(path)) throw new Error(`trackd:sw: public/${f} is missing`)
        parts.push({ name: `public/${f}`, content: readFileSync(path) })
      }
      const version = cacheVersion(parts)

      const stamped = source
        .replace('__PRECACHE__', JSON.stringify(required, null, 2))
        .replace('__OPTIONAL__', JSON.stringify(optional, null, 2))
        .replace('__VERSION__', JSON.stringify(version))
        .replace('__BASE__', JSON.stringify(base))

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: stamped })
    },
  }
}

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'))

/**
 * Which build is actually running, as a short commit.
 *
 * `VERSION` is the package version and has read 1.0.0 through every deploy
 * there has been, so it cannot answer the first question any device-only bug
 * asks: is the phone on the build that was meant to fix it, or still on the
 * service worker's copy of the one before? A commit changes every push and
 * settles that in one glance.
 *
 * `GITHUB_SHA` first, because Actions checks out a detached HEAD and the local
 * command would report it correctly but the env var is already there.
 */
function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'local'
  }
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  plugins: [tailwindcss(), serviceWorker()],
  build: {
    target: 'es2022',
    // One user, one device, no code splitting worth the extra round trips.
    modulePreload: { polyfill: false },
  },
  // `PORT` so a second dev server can be told where to sit rather than picking
  // for itself; unset falls through to Vite's own 5173.
  server: { host: true, port: process.env.PORT ? Number(process.env.PORT) : undefined },
})
