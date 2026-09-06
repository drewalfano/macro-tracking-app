# Trackd

Trackd is a personal macro tracker. Installable PWA, single user, local first. No accounts,
no backend, no subscription — every byte lives on the device.

Built to replace a paid MacroFactor subscription, and to be a UX case study with
a real user and documented iteration. The visual system is white page, grey
outlined cards, a 24px radius, and a 10px spacing grid; colour appears only as
macro identity. See [`CHANGELOG-visual.md`](CHANGELOG-visual.md)
for the full system and every change made to it, and [`NOTES-friction.md`](NOTES-friction.md)
for the running log of things that broke or annoyed in daily use.

## Running it

```bash
npm install
npm run dev
```

The dev server serves at `/trackd/` to match the GitHub Pages base
path, so the URL is `http://localhost:5173/trackd/`.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Generates icons, then builds to `dist/` |
| `npm run preview` | Serves the production build |
| `npm test` | Macro arithmetic, the Describe parser and draft, the service worker lifecycle, backup validation and import |
| `npm run icons` | Regenerates the PWA icons into `public/icons/` |

## Getting it onto the phone

`npm run dev` over the LAN is the worst way to judge how this feels. Vite serves
every module unbundled, so it is ~50 separate requests over WiFi; there is no
service worker, so nothing is cached; and plain HTTP is not a secure context, so
neither the camera nor Add to Home Screen will work. It will feel slow, and none
of that slowness is the app.

**The real answer is to deploy it.** Push to GitHub and the workflow publishes to
Pages over HTTPS, at which point it installs to the home screen, runs from the
service worker cache, and the scanner works:

```
gh repo create trackd --private --source=. --push
```

Then enable Pages with "GitHub Actions" as the source. After that, open the
Pages URL in Safari on the phone → Share → Add to Home Screen. Launched from the
icon it runs standalone with no browser chrome, and every asset is served from
the local cache.

**For a quick check without deploying**, `npm run serve` builds and serves the
production bundle on the LAN. That gets you the real bundle and the real type
and layout, but still no service worker or camera, because HTTPS is the gate on
both. A tunnel closes that gap:

```
npx cloudflared tunnel --url http://localhost:4173
```

which prints an HTTPS URL that behaves exactly like production.

## Deploying

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Enable Pages with
"GitHub Actions" as the source.

`BASE_PATH` must match the repository name. For a custom domain, build with
`BASE_PATH=/`.

HTTPS is not a nicety here: `getUserMedia` refuses to run on plain HTTP, so
barcode scanning only works because Pages serves over TLS. `localhost` counts as
a secure context, so scanning also works in development.

## Architecture

Vanilla JS. No framework, and no state library, because almost all state lives
in IndexedDB and the thing a framework buys — diffing a large render tree — is
not a problem this app has. Screens rebuild their own subtree when the data they
subscribe to changes.

```
src/
  main.js            app shell, tab bar, routing, service worker registration
  router.js          hash routing (Pages has no rewrite rules, so /log would 404)
  state.js           the only cross-screen state: which day you are looking at
  lib/
    db.js            IndexedDB, every read and write, plus export/import
    backup.js        what an export has to look like before import writes it
    describeRules.js the rules parser: a sentence into foods and amounts
    describeResolve.js  library, staples, Open Food Facts, in that order
    describeDraft.js the review's own rules: re-reads, replies, what blocks the log
    describeModel.js the one Gemini call, and the only file that knows the model
    aiKey.js         the key, and the separate switch that allows sending
    compute.js       macro arithmetic, Atwater, the sanity flags from spec 9
    off.js           Open Food Facts client; normalizes everything on ingest
    trend.js         weight smoothing and rate of change
    dates.js         local 'YYYY-MM-DD' handling — never UTC
    ui.js            the component vocabulary
    sheet.js         bottom sheet with a panel stack and history integration
    dom.js           ~100 lines of DOM helper: h(), swipe, long press, count-up
  screens/           today, log, history, weight, settings, foods
  sheets/            addFood, describe, plate, serving, search, custom, scan
  sw.template.js     service worker; vite.config.js stamps in the asset list
scripts/
  cacheVersion.mjs   the worker's cache name, a hash of everything it caches
```

### Dependencies

Three, deliberately: `idb`, `@zxing/browser`, `@zxing/library`. (`fake-indexeddb`
is a dev dependency only, so the import tests run against real transaction
semantics rather than a stub.) ZXing is loaded
dynamically and only when you open the Scan route, so it stays out of the
initial bundle.

The service worker keeps one shell cache per build, named by a hash of the
bundle, the document, the manifest and the icons. An install that cannot fetch
every required file fails and throws its half-built cache away, so the previous
version keeps serving; old caches are deleted only once the new one is verified
whole. The document and its assets are both answered from that one cache, so
the page can never be one build and its scripts another. A new build is offered
with a toast and installed only when Update is tapped.

`vite-plugin-pwa` was evaluated and dropped. It pulls in 300+ packages and,
today, eight high-severity build-time advisories to do an app-shell precache and
one stale-while-revalidate route. A ~40-line Vite plugin stamps the hashed asset
list into `sw.template.js` instead. Charts are hand-rolled SVG for the same
reason — a charting library for one sparkline is not a trade worth making.

Initial load is ~29 KB gzipped of JS plus ~5 KB of CSS.

## Data model

One IndexedDB database, `macro-tracker`, version 1. Two decisions carry the
whole design:

**Foods store `per100`, normalized to 100 of their base unit.** Every serving
change downstream is multiplication, never a re-fetch. For `item` foods this
means "per 100 items", so the same arithmetic works for eggs and for rice.

**Entries snapshot their `computed` macros at the time of logging.** If a food's
nutrition is corrected later, history does not silently rewrite itself. This is
also why deleting a food leaves its entries intact and readable.

Two additions to the original spec, both forced by behaviour it asked for:

- Entries also snapshot `foodName` and `brand`. Without it, deleting a food
  turns months of history into rows labelled "Deleted food".
- Foods track `lastQuantity` and `lastUnit`. Recents promises "last used serving
  prefilled", and the alternative is scanning the entries index every time the
  add sheet opens — the one place latency is unacceptable.

## Describing a meal

Describe takes a sentence — "two eggs on toast and a black coffee" — and turns
it into rows you can check and log. One sheet, three states: write it, review
it, log it. Every correction happens on the row it is about; the only thing
that ever opens on top is the food search.

What reads the sentence, in order: the rules parser in
[`describeRules.js`](src/lib/describeRules.js), then your library, then the
bundled staples table, then Open Food Facts. All of that runs without a key.
A food that none of them can place arrives as a row that says so and offers
the search.

### What leaves the phone, and when

Nothing, unless you have said so. Two things have to be true before Describe
sends anything to Gemini: a Google AI Studio key is saved in Settings → AI
Describe, **and** the switch under it, "Send unmatched foods to Gemini", is
on. The switch is off for every key, including keys saved before it existed.
With a key and no decision, the sheet asks once — the first time it has
something it would send — and remembers the answer either way.

When sending is on, what goes is the exact words of the foods that could not
be placed locally, and nothing else: no date, no targets, no history, none of
the foods that were placed. The reply is put back through the local
resolution before any estimate counts, so a dish the model names that your
library already has takes your numbers, not its guess. Estimates are marked
with a sparkle on the row, in the log, and in every export.

The key lives in `localStorage`, travels in the header of that one request,
and is never included in a backup. See [`aiKey.js`](src/lib/aiKey.js) and
[`describeModel.js`](src/lib/describeModel.js).

## Backups

Export is the only backup. Clearing the browser's site data deletes everything,
and nothing is stored anywhere else. Settings → Data → Export data writes a
single JSON file with every store; import offers merge or replace with a preview
of exactly what will change first.

Every record in the file is checked before anything is written —
[`backup.js`](src/lib/backup.js) — and a file that fails is refused whole,
with the row and the reason, rather than partly imported. Older exports with
stores that did not exist yet are fine; a file from a newer version of the app
is refused with a message saying so. A replace is one transaction: if a write
fails partway, IndexedDB rolls it back and what was on the device is still
there.

## Open questions, resolved

1. **Preact or vanilla** — vanilla. State lives in IndexedDB; a framework would
   be carrying weight it does not need to carry here.
2. **Red is spoken for by carbs** — destructive and error states are ink and
   grey. No second red anywhere, including delete confirmations, going over
   target, and offline notices.
3. **A "remaining" number** — no. `2504 / 2837` covers it, as the mockups said.
4. **Does the history view earn v1** — yes, but for the weekly averages rather
   than the day list. A single day is noise; seven days of mean calories and
   mean protein is the number worth designing around.

## Known limits

- Open Food Facts search is rate limited and intermittently returns 503. A
  transient failure gets one quiet retry before the user sees anything; a
  persistent one shows a retry notice. The local library stays searchable
  regardless.
- Scanning needs a rear camera and a secure context. Every failure path — denied
  permission, no camera, unknown barcode, a product with no nutrition data —
  falls back to manual entry or the custom form rather than dead-ending.
- IndexedDB is unavailable in private browsing on some browsers. The app detects
  this on boot and says so, rather than silently forgetting everything.
