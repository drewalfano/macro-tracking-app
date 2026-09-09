/**
 * IndexedDB layer. Every write in the app goes through here and nothing here
 * touches the network — the app is fully usable with the radio off.
 */

import { openDB } from 'idb'
import { addDays, todayStr } from './dates.js'
import { weightUnitFor } from './format.js'
import {
  EXPORT_FORMAT,
  SCHEMA_VERSION,
  DATA_STORES,
  keyPathFor,
  validateImport as checkImport,
} from './backup.js'

export const DB_NAME = 'macro-tracker'
/**
 * Declared in backup.js, because it is as much the version of the export
 * format as of the database — a file is readable exactly when its version is
 * no newer than this.
 */
export const DB_VERSION = SCHEMA_VERSION
export { EXPORT_FORMAT }

/**
 * What onboarding fills in. Every field is null until someone says otherwise,
 * because a default here is a number the app made up and then drew rings
 * against — and `sex: 'male'` as a fallback would be exactly that.
 *
 * Height and weight are canonical metric and converted at display time. Weight
 * is not stored here at all: the `weights` store is already the record of what
 * someone weighs, and a second copy would be a second answer.
 */
export const DEFAULT_PROFILE = {
  /** 'female' | 'male' | 'unspecified'. Unspecified means manual targets. */
  sex: null,
  /** The year, not the age — an age is wrong from the next birthday onwards. */
  birthYear: null,
  heightCm: null,
  activity: null,
  goal: 'maintain',
  /** Signed kg per week. Negative loses. Clamped on the way into the maths. */
  rateKgPerWeek: 0,
}

export const DEFAULT_SETTINGS = {
  targets: { kcal: 2837, protein: 180, fat: 80, carbs: 300 },
  /**
   * 'calculated' follows the profile; 'manual' does not, and wins. Any hand
   * edit of a target flips this, so the app never quietly overwrites a number
   * somebody typed on purpose.
   */
  targetsSource: 'manual',
  profile: { ...DEFAULT_PROFILE },
  onboardingComplete: false,
  units: 'metric',
  weightUnit: 'kg',
  blockNames: ['Morning', 'Afternoon', 'Night'],
  blockThresholds: { afternoon: 12, night: 17 },
  theme: 'system',
  trendWindow: 7,
  /**
   * Which reading the Today card leads with: 'consumed' or 'remaining'.
   *
   * Stored rather than held in memory because the control that sets it is now
   * visible and permanent, which makes it a preference. An invisible gesture
   * could argue it was only a way of looking at today; a labelled switch sitting
   * on the card all day cannot, and a setting that forgets what you told it is
   * worse than one that was never offered.
   *
   * 'consumed' is the first-run default, and the internal name stays 'consumed'
   * while the control reads "Eaten" — the value is what `macroRing` and
   * `calorieBlock` have always spoken.
   */
  cardMode: 'consumed',
  /** Ordered and manual. These do not re-sort themselves — that is the point. */
  favourites: [],
  firstRunSeen: false,
  firstMealSeen: false,
}

export const uid = () =>
  crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Thrown when storage is unavailable, e.g. private browsing on some browsers. */
export class StorageUnavailableError extends Error {
  constructor(cause) {
    super('IndexedDB is unavailable')
    this.name = 'StorageUnavailableError'
    this.cause = cause
  }
}

export class QuotaError extends Error {
  constructor(cause) {
    super('Storage is full')
    this.name = 'QuotaError'
    this.cause = cause
  }
}

/* ---------------------------------------------------------------- change bus */

const listeners = new Set()

/** Screens subscribe to this and re-render. Coarse on purpose: writes are rare. */
export function onChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(scope) {
  // The one derived thing in this file that is expensive enough to hold on to.
  // Invalidated here so no write path can forget it. See `quickAddFoods`.
  if (scope === 'entries' || scope === 'foods' || scope === 'all') quickAddCache = null
  /**
   * The read caches below are maintained SURGICALLY by the two entry writers,
   * not invalidated here, which is the opposite of the rule above.
   *
   * `quickAddCache` is derived from a ranking that any food write can reorder,
   * so there is no cheap way to patch it and dropping it is correct. A day's
   * entries are the opposite: `putEntry` and `deleteEntry` are the only things
   * that can change them, and each one knows exactly which row moved and which
   * date it moved in. Dropping the map on their emit would hand every screen a
   * cache miss on the one change it was built to make free.
   *
   * `'all'` is the exception, because import and clear rewrite the store
   * underneath the map without going through either writer.
   */
  if (scope === 'all') {
    entriesByDate.clear()
    stampedDays.clear()
    firstLoggedCache = undefined
  }
  for (const fn of listeners) fn(scope)
}

/* --------------------------------------------------------- the read caches */

/**
 * A day's entries, held in memory, because the rebuild path reads them far more
 * often than anything writes them.
 *
 * Today's build alone asks for three days at once — the day you are on and both
 * neighbours, so a swipe has something to drag in — and it runs that build on
 * every settings change, every log, every delete and every day step. Off
 * IndexedDB that was three index reads and a cursor per keystroke-scale event,
 * on the phone, between the tap and anything moving.
 *
 * Kept as a map rather than a single-day slot because the deck holds three days
 * at once and paging is exactly the motion that must not stall.
 *
 * @type {Map<string, object[]>}
 */
const entriesByDate = new Map()

/**
 * Days already stamped with a target snapshot. See `ensureDayTargets`.
 *
 * Only ever added to. A day that has been stamped cannot become unstamped —
 * first write wins is the whole rule — so a hit here is permanent and a miss
 * costs the read it always did.
 *
 * @type {Set<string>}
 */
const stampedDays = new Set()

/**
 * `undefined` means not yet read; `null` means nothing has ever been logged.
 * The distinction matters because null is a real answer worth caching.
 */
let firstLoggedCache

/**
 * Entry writes still in flight, chained.
 *
 * The two writers below patch the cache and emit BEFORE the disk has taken the
 * row, so that a tap repaints on the next frame rather than after a readwrite
 * transaction commits — measured at 6.25ms on desktop Chromium, and iOS
 * Safari's IndexedDB is not the faster of the two.
 *
 * That leaves a window, a few milliseconds wide, in which the cache knows
 * something the store does not. Everything that reads a day THROUGH the cache
 * is fine inside it, which is the common path and the whole point. Everything
 * that goes around the cache to the store — a range read for Trends, a cache
 * miss, a lookup by id — is not, and would read past the row it was emitted
 * about. So those wait here first.
 *
 * Chained rather than a set, because ordering is the property that matters: two
 * logs in quick succession must land in the order they were made. `catch` keeps
 * a rejected write from poisoning the chain for every read after it — the
 * writer that owns the failure has already rolled its own cache change back.
 */
let inflight = Promise.resolve()
const settled = () => inflight
function tracked(promise) {
  inflight = inflight.then(
    () => promise,
    () => promise
  ).catch(() => {})
  return promise
}

/** Entries are shown and summed in the order they were logged. */
const byCreatedAt = (a, b) => a.createdAt - b.createdAt

/**
 * Fold one written row into the cached day, in place, keeping the order.
 *
 * A miss is a no-op rather than a hydrate: nothing has asked for this day yet,
 * so the first thing that does will read it whole and get the row anyway.
 */
function cacheEntry(record) {
  const rows = entriesByDate.get(record.date)
  if (!rows) return
  const at = rows.findIndex((r) => r.id === record.id)
  if (at >= 0) rows[at] = record
  else rows.push(record)
  rows.sort(byCreatedAt)
}

/** The cached row for an id, or null. Only the rollback in `deleteEntry` needs it. */
function findCachedEntry(id) {
  for (const rows of entriesByDate.values()) {
    const found = rows.find((r) => r.id === id)
    if (found) return found
  }
  return null
}

/** Drop a row from whichever day is holding it. The id does not carry its date. */
function uncacheEntry(id) {
  for (const rows of entriesByDate.values()) {
    const at = rows.findIndex((r) => r.id === id)
    if (at >= 0) {
      rows.splice(at, 1)
      return
    }
  }
}

/* -------------------------------------------------------------------- open */

let dbPromise = null

export function db() {
  if (!dbPromise) {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new StorageUnavailableError())
    }
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // Stepped rather than unconditional: an existing v1 database runs only
      // the v2 block, and re-creating a store that is already there throws.
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          const foods = database.createObjectStore('foods', { keyPath: 'id' })
          foods.createIndex('barcode', 'barcode')
          foods.createIndex('lastUsedAt', 'lastUsedAt')
          foods.createIndex('useCount', 'useCount')
          foods.createIndex('nameLower', 'nameLower')

          const entries = database.createObjectStore('entries', { keyPath: 'id' })
          entries.createIndex('date', 'date')
          entries.createIndex('dateBlock', ['date', 'block'])
          entries.createIndex('foodId', 'foodId')

          const meals = database.createObjectStore('meals', { keyPath: 'id' })
          meals.createIndex('useCount', 'useCount')

          database.createObjectStore('weights', { keyPath: 'date' })
          database.createObjectStore('settings')
        }
        if (oldVersion < 2) {
          // What the target was on a given day. Not backfilled — days logged
          // before this shipped have no record and fall back to the current
          // target, because inventing one would be worse than admitting it.
          database.createObjectStore('dayTargets', { keyPath: 'date' })
        }
      },
      blocked() {
        console.warn('Another tab is holding an old version of the database open.')
      },
    }).catch((err) => {
      dbPromise = null
      throw new StorageUnavailableError(err)
    })
  }
  return dbPromise
}

/**
 * Confirm storage actually works before the app renders anything.
 * Safari in private mode exposes `indexedDB` and then fails on open, so the
 * only honest test is a real round trip.
 */
export async function checkStorage() {
  const d = await db()
  await d.get('settings', 'settings')
  return true
}

/** Quota rejections are rare at this data volume but must not fail silently. */
async function write(fn) {
  try {
    return await fn()
  } catch (err) {
    if (err?.name === 'QuotaExceededError' || err?.code === 22) throw new QuotaError(err)
    throw err
  }
}

/* ---------------------------------------------------------------- settings */

let settingsCache = null

export async function getSettings() {
  if (settingsCache) return settingsCache
  const stored = (await (await db()).get('settings', 'settings')) || {}
  settingsCache = {
    ...DEFAULT_SETTINGS,
    ...stored,
    targets: { ...DEFAULT_SETTINGS.targets, ...(stored.targets || {}) },
    profile: { ...DEFAULT_PROFILE, ...(stored.profile || {}) },
    blockThresholds: { ...DEFAULT_SETTINGS.blockThresholds, ...(stored.blockThresholds || {}) },
    blockNames: stored.blockNames || [...DEFAULT_SETTINGS.blockNames],
    favourites: stored.favourites || [],
  }
  return derive(settingsCache)
}

/**
 * `weightUnit` follows `units` and is not settable on its own. It stays a
 * stored field so every consumer reads one value rather than each deriving its
 * own — which means the invariant has to be restored on both paths, not just on
 * load: settings written before Settings dropped its second control can hold a
 * combination (metric with pounds) that nothing in the app can now produce, and
 * a patch that changes `units` would otherwise leave the old weight unit
 * merged in beside it.
 */
function derive(settings) {
  settings.weightUnit = weightUnitFor(settings.units)
  return settings
}

export async function saveSettings(patch) {
  const previous = await getSettings()
  const next = derive({ ...previous, ...patch })
  await write(async () => (await db()).put('settings', next, 'settings'))
  settingsCache = next

  // Today is not history yet, so a target changed now applies to the day in
  // progress. Past days keep whatever was in force when they were logged —
  // that is the whole point of the snapshot, and re-stamping them here would
  // undo it.
  if (patch.targets && JSON.stringify(patch.targets) !== JSON.stringify(previous.targets)) {
    await putDayTargets(todayStr(), next.targets)
  }

  emit('settings')
  return next
}

/**
 * The Today card's reading, written on its own and WITHOUT an emit.
 *
 * Every other setting goes through `saveSettings`, and the emit is the point
 * there: a target changed in Settings has to reach a Today that is already
 * built. This one is the opposite case. The only screen that reads `cardMode`
 * is the one whose own control just set it, and it has already repainted from
 * the value in hand — so an emit would be telling a screen something it told
 * us.
 *
 * It would not be free, either. Today watches the `settings` scope, so an emit
 * here re-runs its build: three days of entries re-read from IndexedDB, and a
 * fresh calorie bar that restarts its fill from zero, on every tap of a control
 * whose entire job is to be cheap enough to flick back and forth.
 */
export async function saveCardMode(mode) {
  const previous = await getSettings()
  if (previous.cardMode === mode) return previous
  const next = derive({ ...previous, cardMode: mode })
  await write(async () => (await db()).put('settings', next, 'settings'))
  settingsCache = next
  return next
}

/** Shallow-merges into `profile` rather than replacing it, unlike saveSettings. */
export async function saveProfile(patch) {
  const settings = await getSettings()
  return saveSettings({ profile: { ...settings.profile, ...patch } })
}

/* --------------------------------------------------------------- the plate */

/**
 * The staging area: foods assembled but not yet logged.
 *
 * Stored under its own key in the `settings` store, which is a plain keyval —
 * so this needs no schema change, and `getSettings` and `exportAll` both only
 * ever read the `'settings'` key, which keeps a draft out of the settings
 * object and out of backups by construction. A backup of something you have not
 * logged yet is noise.
 *
 * Persisted rather than held in memory because a plate outlives the sheet. The
 * phone locks mid-assembly, a notification steals focus, you go and check what
 * is left on Today — none of those should throw away four taps of work.
 */
export const EMPTY_PLATE = { items: [], date: null, block: null, startedAt: null }

export async function getPlate() {
  const stored = await (await db()).get('settings', 'plate')
  return stored?.items ? stored : { ...EMPTY_PLATE }
}

export async function savePlate(plate) {
  await write(async () => (await db()).put('settings', plate, 'plate'))
  emit('plate')
  return plate
}

export async function clearPlate() {
  await write(async () => (await db()).delete('settings', 'plate'))
  emit('plate')
}

/* --------------------------------------------------------------- day targets */

/**
 * A day's row in History should read against the target that was in force when
 * it was logged, not against whatever the target happens to be today. Changing
 * a goal in August must not silently rewrite how March went.
 */
export async function putDayTargets(date, targets) {
  const record = { date, targets: { ...targets }, savedAt: Date.now() }
  await write(async () => (await db()).put('dayTargets', record))
  stampedDays.add(date)
  emit('dayTargets')
  return record
}

/**
 * Stamp the day the first time anything is logged into it. First write wins:
 * the target in force when you started logging is the one the day is judged by.
 */
export async function ensureDayTargets(date) {
  if (!date) return null
  // The hit is what makes the second and every later log of a day free. `null`
  // rather than the record because the only caller that matters — `putEntry` —
  // discards the return, and reading the row back to hand it over would undo
  // the round trip this is here to skip.
  if (stampedDays.has(date)) return null
  const existing = await (await db()).get('dayTargets', date)
  if (existing) {
    stampedDays.add(date)
    return existing
  }
  const { targets } = await getSettings()
  return putDayTargets(date, targets)
}

/** Falls back to the current target for days that were never stamped. */
export async function getDayTargets(date) {
  const stored = await (await db()).get('dayTargets', date)
  if (stored?.targets) return stored.targets
  return (await getSettings()).targets
}

/**
 * Bulk read for History, which needs one target per row and should not do a
 * round trip per day to get them.
 */
export async function dayTargetsInRange(from, to) {
  const rows = await (await db()).getAll('dayTargets', IDBKeyRange.bound(from, to))
  return new Map(rows.map((r) => [r.date, r.targets]))
}

/* ------------------------------------------------------------------- foods */

const withSearchKey = (food) => ({
  ...food,
  nameLower: `${food.name} ${food.brand || ''}`.toLowerCase().trim(),
})

export async function listFoods() {
  return (await db()).getAll('foods')
}

/**
 * `null` is a legitimate `foodId` — a quick add and a described estimate are
 * both entries with no food behind them, and a meal built out of those carries
 * items shaped the same way. IndexedDB does not accept null as a key: it throws
 * DataError rather than returning nothing, so a single such item anywhere in a
 * list rejected the whole walk over it and blanked whatever was being painted.
 *
 * The guard lives here rather than at each call site because every walk over a
 * list of items has the same hole, and the next one written would have it too.
 */
export async function getFood(id) {
  if (id == null) return undefined
  return (await db()).get('foods', id)
}

export async function putFood(food) {
  const record = withSearchKey({
    source: 'custom',
    createdAt: Date.now(),
    lastUsedAt: 0,
    useCount: 0,
    ...food,
    id: food.id || uid(),
  })
  await write(async () => (await db()).put('foods', record))
  emit('foods')
  return record
}

export async function deleteFood(id) {
  await write(async () => (await db()).delete('foods', id))
  // Historical entries are deliberately left alone; `computed` was snapshotted.
  const settings = await getSettings()
  const favourites = settings.favourites.filter((f) => !(f.type === 'food' && f.id === id))
  if (favourites.length !== settings.favourites.length) await saveSettings({ favourites })
  emit('foods')
}

export async function findFoodByBarcode(barcode) {
  if (!barcode) return undefined
  return (await db()).getFromIndex('foods', 'barcode', barcode)
}

/**
 * Bump recency. Called on every log, which is what drives the Recents list.
 *
 * `lastQuantity`/`lastUnit` are an addition to the spec's food shape. Recents
 * promises "last used serving prefilled", and that has to be remembered
 * somewhere — the alternative is scanning the entries index on every open of
 * the add sheet, which is the one place latency is unacceptable.
 */
export async function touchFood(id, { quantity, unit } = {}) {
  const d = await db()
  const food = await d.get('foods', id)
  if (!food) return
  food.lastUsedAt = Date.now()
  food.useCount = (food.useCount || 0) + 1
  if (quantity != null) food.lastQuantity = quantity
  if (unit != null) food.lastUnit = unit
  await write(async () => d.put('foods', food))
  emit('foods')
}

/**
 * How long a keystroke waits before a search runs — review finding 9.
 *
 * It was two numbers: 120 on the add sheet and 300 on the Describe match
 * panel, for the same query against the same store, each followed by the same
 * Open Food Facts request. The add sheet's comment held that its 120 was the
 * local number and the 300 was pacing the network, and the code did not agree
 * with it — both panels fire the remote search off the same timer the moment
 * the local results have painted. So the only thing 300 was pacing was a
 * repaint, and every millisecond past what absorbs a burst of typing is lag on
 * the one panel where a described food with no match gets fixed. 120 is the
 * shorter of the two and was already the one argued for. Exported from beside
 * the query it paces so the callers cannot drift again.
 */
export const SEARCH_DEBOUNCE_MS = 120

/** Local library search. Always available, network or not. */
export async function searchFoods(query, limit = 50) {
  const q = query.trim().toLowerCase()
  const all = await listFoods()
  if (!q) return all.sort((a, b) => (b.useCount || 0) - (a.useCount || 0)).slice(0, limit)
  const terms = q.split(/\s+/)
  return all
    .map((food) => {
      const hay = food.nameLower || `${food.name} ${food.brand || ''}`.toLowerCase()
      if (!terms.every((t) => hay.includes(t))) return null
      // Prefix matches beat mid-string ones; ties break on how often it is used.
      const score = (hay.startsWith(terms[0]) ? 1000 : 0) + (food.useCount || 0)
      return { food, score }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.food)
}

export async function recentFoods(limit = 30) {
  const all = await listFoods()
  return all
    .filter((f) => f.lastUsedAt > 0)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, limit)
}

/**
 * What the same food is called, whichever record you happen to be holding.
 *
 * A barcode is the strong claim — two records carrying one are the same
 * product — and the name is the fallback for everything typed by hand. Lowered,
 * trimmed, and with runs of whitespace collapsed, because "Greek  Yogurt" and
 * "greek yogurt" are one food that arrived by two routes.
 *
 * Brand is deliberately NOT part of the key. A scan fills it in and a hand-typed
 * duplicate usually does not, so including it would keep apart exactly the pair
 * this is here to merge.
 */
export const identityKey = (food) =>
  food.barcode || `name:${(food.name || '').toLowerCase().trim().replace(/\s+/g, ' ')}`

/**
 * How far back the rail counts. Thirty days is long enough that a weekly food
 * still registers and short enough that last season's habits do not.
 */
const QUICK_ADD_WINDOW = 30

/**
 * How many logs in that window make a food a habit rather than an occurrence.
 *
 * Two, which is the smallest number that can mean anything at all: one log says
 * you ate something once, and every meal you have ever eaten clears that bar.
 * The second log is the first evidence of a pattern. Anything higher would take
 * a fortnight of the same breakfast to admit that it is your breakfast.
 */
const QUICK_ADD_FREQUENT_MIN = 2

/**
 * The Quick add rail: what you eat OFTEN, then what you ate LAST.
 *
 * This used to be pure recency — the eight foods with the newest `lastUsedAt` —
 * and the failure was structural rather than occasional. One unusual dinner
 * evicts a daily staple, because recency has no idea that the thing it dropped
 * is eaten every morning and the thing it promoted will never be eaten again.
 * The rail was at its least useful the day after anything out of the ordinary.
 *
 * So the front of the rail is a count over a window: everything logged at least
 * twice in the last thirty days, most-logged first. A one-off dinner cannot
 * enter that tier at all, and a daily breakfast cannot leave it.
 *
 * **Ties break on recency, and that is not a detail either.** Once a rail is
 * mostly foods sitting on two or three logs, the counts stop separating them
 * and the order would otherwise be whatever the map happened to iterate — an
 * arbitrary sequence that never moves. Recency inside a tier keeps the rail
 * feeling alive without letting it be reordered by a single meal.
 *
 * **The tail is still recency, and fills to `limit`.** The frequent tier is
 * empty on a fresh install and small for weeks after, and a rail that shows two
 * tiles because it is being strict about evidence is a worse rail than the one
 * it replaced. So whatever the tier does not fill is topped up with the most
 * recently used foods, newest first, skipping anything already above — and
 * those may be older than the window, since being outside it is exactly the
 * condition. Nothing is padded: with fewer than `limit` foods ever logged, the
 * rail is simply shorter.
 *
 * Counted by `identityKey`, not by `foodId`. The same real food can exist as two
 * records — one adopted from a barcode, one typed by hand — and counting the ids
 * separately would split a food's history in half and then rank it on half its
 * evidence, which is the exact mistake this function exists to stop. The
 * surviving card is the most recently used of the pair, so it carries that
 * record's serving.
 *
 * Foods already logged today are deliberately kept, as before. Re-logging the
 * same thing within a day is ordinary, and dropping it would be a shortcut that
 * vanishes precisely because you used it.
 */
export async function quickAddFoods(limit = 8) {
  const today = todayStr()
  const cached = readQuickAddCache(today, limit)
  if (cached) return cached

  const [foods, entries] = await Promise.all([
    listFoods(),
    entriesInRange(addDays(today, -(QUICK_ADD_WINDOW - 1)), today),
  ])

  /**
   * One food record per identity, and it is the most recently used of them.
   * Built before the counting so both halves agree on which record represents a
   * pair — otherwise the tier could rank one yoghurt and the tail could offer
   * the other, and the rail would show it twice.
   */
  const byIdentity = new Map()
  const byId = new Map()
  for (const food of foods) {
    byId.set(food.id, food)
    const key = identityKey(food)
    const held = byIdentity.get(key)
    if (!held || (food.lastUsedAt || 0) > (held.lastUsedAt || 0)) byIdentity.set(key, food)
  }

  /** Logs per identity inside the window, with the newest of them. */
  const tally = new Map()
  for (const entry of entries) {
    const food = entry.foodId ? byId.get(entry.foodId) : null
    // A quick add or a described estimate has no food to put on the rail, and a
    // food deleted since is a tile with nothing behind it.
    if (!food) continue
    const key = identityKey(food)
    const row = tally.get(key) || { count: 0, lastAt: 0 }
    row.count += 1
    row.lastAt = Math.max(row.lastAt, entry.createdAt || 0)
    tally.set(key, row)
  }

  const frequent = [...tally.entries()]
    .filter(([, row]) => row.count >= QUICK_ADD_FREQUENT_MIN)
    .sort(([, a], [, b]) => b.count - a.count || b.lastAt - a.lastAt)
    .map(([key]) => byIdentity.get(key))
    .filter(Boolean)

  const out = frequent.slice(0, limit)

  if (out.length < limit) {
    const taken = new Set(out.map(identityKey))
    const recent = [...byIdentity.values()]
      .filter((f) => f.lastUsedAt > 0 && !taken.has(identityKey(f)))
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    out.push(...recent.slice(0, limit - out.length))
  }

  quickAddCache = { day: today, limit, foods: out }
  return out
}

/**
 * The rail's last answer, held until something could change it.
 *
 * Today rebuilds its whole subtree on `entries`, `foods` and every step of the
 * date, which is three or four rebuilds around a single log — and this is now
 * the one thing on that screen that reads a thirty-day range rather than a
 * single day. Recomputing it because you swiped to yesterday is work done to
 * produce the answer already in hand.
 *
 * Keyed by day so the rollover past midnight misses without anything having to
 * notice midnight, and cleared in `emit` rather than at the call sites that
 * write — a cache invalidated by hand is a cache that stays valid until someone
 * adds a fourth write path and forgets. `touchFood` fires `foods` on every log,
 * so a log clears this as it should: the counts genuinely changed.
 */
let quickAddCache = null

function readQuickAddCache(day, limit) {
  if (!quickAddCache) return null
  if (quickAddCache.day !== day || quickAddCache.limit !== limit) return null
  return quickAddCache.foods
}

/* --------------------------------------------------------- portion memory */

/**
 * What a phrase means, in amounts, for one particular food.
 *
 * "a few handfuls of dried apricots" is not a quantity, and no amount of
 * parsing will make it one. But it is the same amount every time YOU say it,
 * and once you have corrected it to 40 g the app never needs to ask again.
 *
 * **Stored on the food record, which is what makes the rule structural.** The
 * spec's constraint is that a correction persists only when it attaches to a
 * real food — correcting "a small serving of the gnocchi bake" teaches nothing,
 * because there is no gnocchi bake to teach. Keeping the memory in a store of
 * its own would leave that as a rule to be remembered at every call site;
 * keeping it here means there is nowhere to write it when the food does not
 * exist. It is also deleted with the food, exported with the food and imported
 * with the food, none of which needed writing.
 *
 * This is the same shape `touchFood` already maintains — `lastQuantity` and
 * `lastUnit` are the phrase-less version of exactly this — so it is one more
 * field on a record that already remembers how you eat.
 */

/** Phrases differ in whitespace and case far more often than in meaning. */
export const portionKey = (phrase) =>
  String(phrase || '').toLowerCase().trim().replace(/\s+/g, ' ')

/** @returns the remembered amount, or null. Sync: the food is already in hand. */
export function recallPortion(food, phrase) {
  const key = portionKey(phrase)
  if (!key) return null
  return food?.portions?.[key] || null
}

export async function rememberPortion(foodId, phrase, { quantity, unit }) {
  const key = portionKey(phrase)
  if (!foodId || !key || quantity == null) return null
  const d = await db()
  const food = await d.get('foods', foodId)
  if (!food) return null
  food.portions = { ...(food.portions || {}), [key]: { quantity: Number(quantity), unit } }
  await write(async () => d.put('foods', food))
  emit('foods')
  return food.portions[key]
}

/* ----------------------------------------------------------------- entries */

/**
 * A day's entries, newest last.
 *
 * Served from `entriesByDate` after the first read of that day. The copy is not
 * a nicety: the cached array is the one the two writers patch in place, so
 * handing it out directly would let a caller's `sort` or `splice` rewrite what
 * every other screen is about to render. Three arrays of a dozen rows is not a
 * cost worth reasoning about; a shared mutable one is.
 */
export async function listEntries(date) {
  const cached = entriesByDate.get(date)
  if (cached) return cached.slice()
  await settled()
  const rows = (await (await db()).getAllFromIndex('entries', 'date', date)).sort(byCreatedAt)
  entriesByDate.set(date, rows)
  return rows.slice()
}

export async function entriesInRange(from, to) {
  await settled()
  return (await db()).getAllFromIndex('entries', 'date', IDBKeyRange.bound(from, to))
}

/**
 * Which days between two dates have anything logged on them, as a Set of
 * date strings.
 *
 * The calendar marks them, and it only needs the days — not the rows. So this
 * walks the `date` index by KEY and skips a whole day in one step: dates are
 * `YYYY-MM-DD` strings, so continuing past `key + '\uffff'` lands on the first
 * key greater than every duplicate of the day just read. A month of a hundred
 * entries costs about thirty reads rather than a hundred, and none of them
 * fetch a row.
 *
 * `settled` for the same reason `entriesInRange` needs it: a row logged a
 * moment ago is in the write queue, and a calendar that leaves today unmarked
 * until the queue drains would be wrong about the one day most likely to be
 * looked at.
 */
export async function loggedDatesInRange(from, to) {
  await settled()
  const days = new Set()
  const index = (await db()).transaction('entries').store.index('date')
  let cursor = await index.openKeyCursor(IDBKeyRange.bound(from, to))
  while (cursor) {
    days.add(cursor.key)
    cursor = await cursor.continue(`${cursor.key}\uffff`)
  }
  return days
}

export async function getEntry(id) {
  await settled()
  return (await db()).get('entries', id)
}

/**
 * The screens go first and the disk follows. See `inflight`.
 *
 * The row exists as far as everything that can see it is concerned before the
 * transaction that stores it has committed, and the rollback is what makes that
 * honest rather than a lie that usually gets away with it: a write that throws
 * takes its row back out of the cache, emits again so every screen drops it,
 * and then rethrows so the caller still gets to say what happened. What the
 * user sees in that case is a row that appears and leaves, which is a true
 * account of what took place.
 */
export async function putEntry(entry) {
  const record = { createdAt: Date.now(), ...entry, id: entry.id || uid() }
  const floorWas = firstLoggedCache
  cacheEntry(record)
  // Only ever earlier. A row written into a day before the first one on record
  // moves the floor; one written after it cannot.
  if (firstLoggedCache !== undefined) {
    if (firstLoggedCache == null || record.date < firstLoggedCache) firstLoggedCache = record.date
  }
  /**
   * Registered in the barrier BEFORE the emit, not after.
   *
   * `emit` runs its listeners synchronously, so a screen that misses the cache
   * for this day calls `listEntries` and reaches `settled()` inside the same
   * tick. If the write were started after the emit, that barrier would still be
   * holding the PREVIOUS chain — already resolved — and the read would go
   * straight to a store that does not have the row yet. The whole guarantee is
   * one statement's worth of ordering.
   */
  const done = tracked(
    (async () => {
      await write(async () => (await db()).put('entries', record))
      await ensureDayTargets(record.date)
    })()
  )
  emit('entries')
  try {
    await done
  } catch (err) {
    uncacheEntry(record.id)
    firstLoggedCache = floorWas
    emit('entries')
    throw err
  }
  return record
}

/** Optimistic on the same terms as `putEntry`, and restores the row if it fails. */
export async function deleteEntry(id) {
  const floorWas = firstLoggedCache
  const removed = findCachedEntry(id)
  uncacheEntry(id)
  // Dropped rather than adjusted. Removing the last row of the earliest day
  // moves the floor forward to a date this function has no way to know, and a
  // delete is rare enough that re-reading one key is the cheap answer.
  firstLoggedCache = undefined
  // Before the emit, for the reason given in `putEntry`.
  const done = tracked(write(async () => (await db()).delete('entries', id)))
  emit('entries')
  try {
    await done
  } catch (err) {
    if (removed) cacheEntry(removed)
    firstLoggedCache = floorWas
    emit('entries')
    throw err
  }
}

export async function countEntriesForFood(id) {
  await settled()
  return (await db()).countFromIndex('entries', 'foodId', id)
}

/**
 * The earliest date with an entry, or null if nothing has ever been logged.
 *
 * History only ever needed these two facts, and used to get them by cursoring
 * over every entry key in the database to build a set of distinct dates — then
 * reading the same range again for the entries themselves. Two full passes per
 * visit to learn where to start. The `date` index is already sorted, so the
 * first key is one read.
 */
export async function firstLoggedDate() {
  if (firstLoggedCache !== undefined) return firstLoggedCache
  const cursor = await (await db()).transaction('entries').store.index('date').openKeyCursor()
  firstLoggedCache = cursor ? cursor.key : null
  return firstLoggedCache
}

/* ------------------------------------------------------------------- meals */

export async function listMeals() {
  return (await db()).getAll('meals')
}

export async function getMeal(id) {
  return (await db()).get('meals', id)
}

export async function putMeal(meal) {
  const record = { createdAt: Date.now(), useCount: 0, ...meal, id: meal.id || uid() }
  await write(async () => (await db()).put('meals', record))
  emit('meals')
  return record
}

export async function deleteMeal(id) {
  await write(async () => (await db()).delete('meals', id))
  const settings = await getSettings()
  const favourites = settings.favourites.filter((f) => !(f.type === 'meal' && f.id === id))
  if (favourites.length !== settings.favourites.length) await saveSettings({ favourites })
  emit('meals')
}

/* ----------------------------------------------------------------- weights */

export async function listWeights() {
  const rows = await (await db()).getAll('weights')
  return rows.sort((a, b) => a.date.localeCompare(b.date))
}

export async function getWeight(date) {
  return (await db()).get('weights', date)
}

/** One per day. A second value for the same date overwrites, never appends. */
export async function putWeight(date, kg) {
  const record = { date, kg: Number(kg), createdAt: Date.now() }
  await write(async () => (await db()).put('weights', record))
  emit('weights')
  return record
}

export async function deleteWeight(date) {
  await write(async () => (await db()).delete('weights', date))
  emit('weights')
}

/* -------------------------------------------------------------- favourites */

export async function isFavourite(type, id) {
  const { favourites } = await getSettings()
  return favourites.some((f) => f.type === type && f.id === id)
}

export async function toggleFavourite(type, id) {
  const settings = await getSettings()
  const exists = settings.favourites.some((f) => f.type === type && f.id === id)
  const favourites = exists
    ? settings.favourites.filter((f) => !(f.type === type && f.id === id))
    : [...settings.favourites, { type, id }]
  await saveSettings({ favourites })
  return !exists
}

export async function moveFavourite(index, delta) {
  const settings = await getSettings()
  const favourites = [...settings.favourites]
  const target = index + delta
  if (target < 0 || target >= favourites.length) return
  ;[favourites[index], favourites[target]] = [favourites[target], favourites[index]]
  await saveSettings({ favourites })
}

/* ------------------------------------------------------------ export/import */

export async function exportAll() {
  const d = await db()
  const rows = await Promise.all(DATA_STORES.map((store) => d.getAll(store)))
  return {
    format: EXPORT_FORMAT,
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    exportedOn: todayStr(),
    settings: await getSettings(),
    ...Object.fromEntries(DATA_STORES.map((store, i) => [store, rows[i]])),
  }
}

/**
 * The whole check lives in backup.js; this is the one place db.js runs it.
 * Everything below writes what THIS returns and never the raw file, so the
 * preview and the commit are looking at the same rows.
 */
export function validateImport(data) {
  return checkImport(data)
}

/**
 * What a merge or replace would actually change, shown before committing.
 *
 * Counted from the validated, de-duplicated rows — the exact set `importAll`
 * writes — so the numbers on the preview are the numbers that land. A row the
 * file listed twice is counted once here and once in `duplicates`.
 */
export async function previewImport(data, mode) {
  const checked = validateImport(data)
  const d = await db()
  const counts = {}
  for (const store of DATA_STORES) {
    const incoming = checked.stores[store]
    const existingKeys = new Set(await d.getAllKeys(store))
    const key = keyPathFor(store)
    const overlapping = incoming.filter((r) => existingKeys.has(r[key])).length
    counts[store] = {
      existing: existingKeys.size,
      incoming: incoming.length,
      added: incoming.length - overlapping,
      overwritten: overlapping,
      removed: mode === 'replace' ? existingKeys.size : 0,
      after: mode === 'replace' ? incoming.length : existingKeys.size + (incoming.length - overlapping),
    }
  }
  return {
    counts,
    duplicates: checked.duplicates,
    version: checked.version,
    // Settings only come across on a replace. Merging someone else's targets
    // into a live app is a surprise nobody asked for.
    settings: { present: checked.settings != null, applied: mode === 'replace' && checked.settings != null },
  }
}

/**
 * Write a backup in, whole or not at all.
 *
 * Validation runs first and throws before the transaction is opened, so a bad
 * file never touches the store. Everything after that is one readwrite
 * transaction across every store: a `put` that fails — a quota hit, a value
 * the structured clone refuses — aborts the transaction and IndexedDB rolls
 * back every clear and every put in it, so the data that was there is still
 * there. The in-memory caches are only dropped once `tx.done` has resolved,
 * for the same reason: a failed write must leave the screens showing what is
 * actually on disk, which is what they were showing before.
 */
export async function importAll(data, mode = 'merge') {
  const checked = validateImport(data)
  const d = await db()
  const stores = [...DATA_STORES, 'settings']

  await write(async () => {
    const tx = d.transaction(stores, 'readwrite')
    /**
     * Every request is kept and awaited, not fired and forgotten. `idb` hands
     * each one back as a promise, and a transaction that aborts rejects all
     * of them — a rejection nobody is listening to is an error the page
     * cannot report and Node refuses to run past.
     */
    const requests = []
    try {
      if (mode === 'replace') {
        for (const store of stores) requests.push(tx.objectStore(store).clear())
      }
      for (const store of DATA_STORES) {
        for (const row of checked.stores[store]) {
          requests.push(tx.objectStore(store).put(store === 'foods' ? withSearchKey(row) : row))
        }
      }
      if (mode === 'replace' && checked.settings) {
        requests.push(tx.objectStore('settings').put(checked.settings, 'settings'))
      }
    } catch (err) {
      // A synchronous throw from `put` (a value that cannot be cloned) has not
      // aborted the transaction yet; do it, so nothing before it commits.
      try {
        tx.abort()
      } catch {
        /* already aborting */
      }
      await Promise.allSettled([...requests, tx.done])
      throw err
    }
    await Promise.all([...requests, tx.done])
  })

  settingsCache = null
  emit('all')
}

export async function clearAll() {
  const d = await db()
  const stores = [...DATA_STORES, 'settings']
  const tx = d.transaction(stores, 'readwrite')
  for (const store of stores) tx.objectStore(store).clear()
  await tx.done
  settingsCache = null
  emit('all')
}

/** Rough footprint, shown in Settings so "export it" has a sense of scale. */
export async function storageEstimate() {
  try {
    const est = await navigator.storage?.estimate?.()
    return est || null
  } catch {
    return null
  }
}
