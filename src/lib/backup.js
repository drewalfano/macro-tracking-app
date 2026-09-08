import { BLOCKS, fromDateStr, toDateStr } from './dates.js'
import { UNITS } from './format.js'

/**
 * What a backup file has to look like before any of it is written.
 *
 * Export is the only backup this app has, and import is the only way back —
 * so an import that trusted the file was a way to turn one bad byte into a
 * white screen with no route out. `validateImport` used to check the format
 * label and that each store was an array, and nothing about the rows: an entry
 * with no date sailed through, could not be found by the day index, and put
 * `NaN` into every total that touched it.
 *
 * Everything here is pure. It reads a parsed JSON object and either hands back
 * a normalized copy of what will be written, or throws an `ImportError` whose
 * message names the first thing wrong. db.js does the writing and does not
 * start until this has finished, which is what makes "invalid data leaves
 * existing data intact" true by construction rather than by luck.
 *
 * **Rejecting, not skipping.** A malformed row could be dropped and the rest
 * imported, and that would be quieter and worse: a backup is somebody's whole
 * history, and a restore that silently lost twelve entries is a restore they
 * would not find out about until the week the entries were from looked thin.
 * The file is refused whole, with the row and the reason, so it can be fixed
 * or re-exported.
 */

export const EXPORT_FORMAT = 'macro-tracker-export'

/**
 * The schema version this build writes and the newest it can read.
 *
 * db.js opens the database at this number and steps the upgrade blocks from
 * whatever is on disk, so a v1 file — one exported before `dayTargets`
 * existed — is a file with a store missing, and that is fine. A file from a
 * future version is not: it may carry stores or fields this build has never
 * heard of, and importing it would mean writing records no screen here knows
 * how to read.
 */
export const SCHEMA_VERSION = 2

/** Every store that travels in an export, in the order they are written. */
export const DATA_STORES = ['foods', 'entries', 'meals', 'weights', 'dayTargets']

/** Two stores are keyed by date rather than by a generated id. */
export const keyPathFor = (store) => (store === 'weights' || store === 'dayTargets' ? 'date' : 'id')

export class ImportError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImportError'
  }
}

/* ---------------------------------------------------------------- helpers */

const MACROS = ['kcal', 'protein', 'fat', 'carbs']
const ENTRY_UNITS = ['serving', ...UNITS]
const THEMES = ['system', 'light', 'dark']
const UNIT_SYSTEMS = ['metric', 'imperial']
const SEXES = [null, 'female', 'male', 'unspecified']
const TARGET_SOURCES = ['manual', 'calculated']
const CARD_MODES = ['consumed', 'remaining']
const FAVOURITE_TYPES = ['food', 'meal']

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isFinite_ = (v) => typeof v === 'number' && Number.isFinite(v)
const isNonNeg = (v) => isFinite_(v) && v >= 0
const isText = (v) => typeof v === 'string' && v.trim().length > 0

/** A key IndexedDB will accept for these stores: a non-empty string or a number. */
const isKey = (v) => isText(v) || isFinite_(v)

/**
 * A real calendar day in the app's own format. `2026-02-30` matches the
 * pattern and is not a day, and the date index would file it between two days
 * that are; round-tripping through the local date parser catches it.
 */
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && toDateStr(fromDateStr(v)) === v

const fail = (msg) => {
  throw new ImportError(msg)
}

/** A short handle for an error message: the name if it has one, else its position. */
const handle = (what, row, i, nameKey) =>
  isText(row?.[nameKey]) ? `${what} "${row[nameKey].trim()}"` : `${what} ${i + 1}`

/** Four macro numbers, all present and all finite. `sodium` may be absent or null. */
function checkMacros(obj, where) {
  if (!isObject(obj)) fail(`${where} has no nutrition.`)
  for (const m of MACROS) {
    if (!isNonNeg(obj[m])) fail(`${where} has a bad ${m} value.`)
  }
  if (obj.sodium != null && !isNonNeg(obj.sodium)) fail(`${where} has a bad sodium value.`)
  /**
   * Only what was there. A record is handed back with the fields it arrived
   * with, so an export → import → export round trip reproduces the file
   * rather than a copy with nulls filled in where nothing was.
   */
  const out = { kcal: obj.kcal, protein: obj.protein, fat: obj.fat, carbs: obj.carbs }
  if (obj.sodium !== undefined) out.sodium = obj.sodium
  return out
}

const optionalNumber = (v, where, field) => {
  if (v != null && !isFinite_(v)) fail(`${where} has a bad ${field}.`)
}

const optionalText = (v, where, field) => {
  if (v != null && typeof v !== 'string') fail(`${where} has a bad ${field}.`)
}

/** A count or a timestamp that older records may lack: filled with zero, never left NaN. */
const stamp = (v, where, field) => {
  if (v == null) return 0
  if (!isNonNeg(v)) fail(`${where} has a bad ${field}.`)
  return v
}

/* ---------------------------------------------------------------- records */

function checkFood(row, i) {
  const where = handle('Food', row, i, 'name')
  if (!isObject(row)) fail(`Food ${i + 1} is not a record.`)
  if (!isKey(row.id)) fail(`${where} has no id.`)
  if (!isText(row.name)) fail(`Food ${i + 1} has no name.`)
  if (!(isFinite_(row.servingSize) && row.servingSize > 0)) fail(`${where} has a bad serving size.`)
  if (!UNITS.includes(row.servingUnit)) fail(`${where} has an unknown serving unit.`)
  const per100 = checkMacros(row.per100, where)

  let portions = null
  if (row.portions != null) {
    if (!isObject(row.portions)) fail(`${where} has bad portion memory.`)
    portions = {}
    for (const [phrase, p] of Object.entries(row.portions)) {
      if (!isObject(p) || !isNonNeg(p.quantity) || !ENTRY_UNITS.includes(p.unit)) {
        fail(`${where} has a bad remembered portion.`)
      }
      portions[phrase] = { quantity: p.quantity, unit: p.unit }
    }
  }

  optionalText(row.brand, where, 'brand')
  optionalText(row.barcode, where, 'barcode')
  optionalText(row.servingLabel, where, 'serving label')
  optionalNumber(row.lastQuantity, where, 'last quantity')
  optionalText(row.lastUnit, where, 'last unit')
  if (row.lastUnit != null && !ENTRY_UNITS.includes(row.lastUnit)) fail(`${where} has a bad last unit.`)

  const out = {
    ...row,
    per100,
    useCount: stamp(row.useCount, where, 'use count'),
    lastUsedAt: stamp(row.lastUsedAt, where, 'last-used time'),
    createdAt: stamp(row.createdAt, where, 'created time'),
  }
  if (portions) out.portions = portions
  return out
}

function checkEntry(row, i) {
  const where = handle('Entry', row, i, 'foodName')
  if (!isObject(row)) fail(`Entry ${i + 1} is not a record.`)
  if (!isKey(row.id)) fail(`${where} has no id.`)
  if (!isDay(row.date)) fail(`${where} has no valid date.`)
  if (!BLOCKS.includes(row.block)) fail(`${where} has an unknown time block.`)
  if (row.foodId != null && !isKey(row.foodId)) fail(`${where} has a bad food id.`)
  // A snapshot of the name is what keeps history readable after a food is
  // deleted, and it has travelled on every entry the app has written. An
  // entry that has neither a name nor a food to look one up from would be a
  // row with nothing to say.
  if (row.foodName != null && typeof row.foodName !== 'string') fail(`${where} has a bad name.`)
  if (row.foodId == null && !isText(row.foodName)) fail(`Entry ${i + 1} has no name and no food.`)
  if (!isNonNeg(row.quantity)) fail(`${where} has a bad quantity.`)
  if (!ENTRY_UNITS.includes(row.unit)) fail(`${where} has an unknown unit.`)
  optionalText(row.brand, where, 'brand')
  optionalText(row.source, where, 'source')
  const out = {
    ...row,
    computed: checkMacros(row.computed, where),
    /**
     * Rows are shown and summed in the order they were logged, and that order
     * is a subtraction of timestamps. A missing one would sort as `NaN`, which
     * is to say randomly. Midday on the entry's own day keeps it on the right
     * day in every timezone the app runs in.
     */
    createdAt:
      row.createdAt == null
        ? fromDateStr(row.date).getTime() + 12 * 60 * 60 * 1000
        : isNonNeg(row.createdAt)
          ? row.createdAt
          : fail(`${where} has a bad created time.`),
  }
  if (row.foodId === undefined) out.foodId = null
  if (row.estimate != null) out.estimate = checkMacros(row.estimate, where)
  return out
}

function checkMealItem(item, j, where) {
  const at = `${where}, item ${j + 1},`
  if (!isObject(item)) fail(`${at} is not a record.`)
  if (item.foodId != null && !isKey(item.foodId)) fail(`${at} has a bad food id.`)
  if (!isNonNeg(item.quantity)) fail(`${at} has a bad quantity.`)
  if (!ENTRY_UNITS.includes(item.unit)) fail(`${at} has an unknown unit.`)
  if (item.foodId == null) {
    // A meal item with no food stands on its own numbers, so it has to have
    // them: a quick add or an estimate that was saved into the meal.
    if (!isText(item.name)) fail(`${at} has no name and no food.`)
    optionalText(item.source, at, 'source')
    return { ...item, foodId: null, computed: checkMacros(item.computed, at) }
  }
  return { ...item }
}

function checkMeal(row, i) {
  const where = handle('Meal', row, i, 'name')
  if (!isObject(row)) fail(`Meal ${i + 1} is not a record.`)
  if (!isKey(row.id)) fail(`${where} has no id.`)
  if (!isText(row.name)) fail(`Meal ${i + 1} has no name.`)
  if (!Array.isArray(row.items)) fail(`${where} has no items.`)
  return {
    ...row,
    items: row.items.map((item, j) => checkMealItem(item, j, where)),
    useCount: stamp(row.useCount, where, 'use count'),
    createdAt: stamp(row.createdAt, where, 'created time'),
  }
}

function checkWeight(row, i) {
  if (!isObject(row)) fail(`Weight ${i + 1} is not a record.`)
  if (!isDay(row.date)) fail(`Weight ${i + 1} has no valid date.`)
  const where = `Weight for ${row.date}`
  if (!(isFinite_(row.kg) && row.kg > 0)) fail(`${where} has a bad value.`)
  return {
    ...row,
    createdAt: stamp(row.createdAt, where, 'created time'),
  }
}

function checkTargets(obj, where) {
  if (!isObject(obj)) fail(`${where} has no targets.`)
  for (const m of MACROS) {
    if (!isNonNeg(obj[m])) fail(`${where} has a bad ${m} target.`)
  }
  return { kcal: obj.kcal, protein: obj.protein, fat: obj.fat, carbs: obj.carbs }
}

function checkDayTargets(row, i) {
  if (!isObject(row)) fail(`Day target ${i + 1} is not a record.`)
  if (!isDay(row.date)) fail(`Day target ${i + 1} has no valid date.`)
  const where = `Target for ${row.date}`
  return {
    ...row,
    targets: checkTargets(row.targets, where),
    savedAt: stamp(row.savedAt, where, 'saved time'),
  }
}

const CHECKS = {
  foods: checkFood,
  entries: checkEntry,
  meals: checkMeal,
  weights: checkWeight,
  dayTargets: checkDayTargets,
}

/* --------------------------------------------------------------- settings */

/**
 * Only the fields the app reads are checked, and only when they are there.
 *
 * `getSettings` merges whatever is stored over the defaults, so a field that is
 * absent is fine and a field that is present has to be one the code can act
 * on: a theme of `"blue"` would leave the page unstyled, and a block name list
 * two items long would leave the third block with no heading. Unknown fields
 * are kept as they are — a same-version export may carry something this
 * build's defaults do not name yet, and dropping it would be a quiet edit.
 *
 * `weightUnit` is dropped because it is derived from `units` on every read.
 */
function checkSettings(s) {
  if (!isObject(s)) fail('The settings in that file are malformed.')
  const where = 'Settings'
  const out = { ...s }
  delete out.weightUnit

  if (s.targets != null) out.targets = checkTargets(s.targets, where)
  if (s.targetsSource != null && !TARGET_SOURCES.includes(s.targetsSource)) fail(`${where} has an unknown targets source.`)
  if (s.units != null && !UNIT_SYSTEMS.includes(s.units)) fail(`${where} has an unknown unit system.`)
  if (s.theme != null && !THEMES.includes(s.theme)) fail(`${where} has an unknown theme.`)
  if (s.cardMode != null && !CARD_MODES.includes(s.cardMode)) fail(`${where} has an unknown card mode.`)
  if (s.onboardingComplete != null && typeof s.onboardingComplete !== 'boolean') fail(`${where} has a bad onboarding flag.`)
  if (s.firstRunSeen != null && typeof s.firstRunSeen !== 'boolean') fail(`${where} has a bad first-run flag.`)
  if (s.firstMealSeen != null && typeof s.firstMealSeen !== 'boolean') fail(`${where} has a bad first-meal flag.`)
  if (s.trendWindow != null && !(Number.isInteger(s.trendWindow) && s.trendWindow > 0)) fail(`${where} has a bad trend window.`)

  if (s.blockNames != null) {
    if (!(Array.isArray(s.blockNames) && s.blockNames.length === BLOCKS.length && s.blockNames.every(isText))) {
      fail(`${where} has bad block names.`)
    }
  }
  if (s.blockThresholds != null) {
    const t = s.blockThresholds
    const hour = (v) => Number.isInteger(v) && v >= 0 && v <= 24
    if (!isObject(t) || (t.afternoon != null && !hour(t.afternoon)) || (t.night != null && !hour(t.night))) {
      fail(`${where} has bad block thresholds.`)
    }
  }
  if (s.favourites != null) {
    if (!Array.isArray(s.favourites)) fail(`${where} has a bad favourites list.`)
    out.favourites = s.favourites.map((f) => {
      if (!isObject(f) || !FAVOURITE_TYPES.includes(f.type) || !isKey(f.id)) fail(`${where} has a bad favourite.`)
      return { type: f.type, id: f.id }
    })
  }
  if (s.profile != null) {
    const p = s.profile
    if (!isObject(p)) fail(`${where} has a bad profile.`)
    if (p.sex !== undefined && !SEXES.includes(p.sex)) fail(`${where} has an unknown sex.`)
    if (p.birthYear != null && !(Number.isInteger(p.birthYear) && p.birthYear > 1800 && p.birthYear < 3000)) fail(`${where} has a bad birth year.`)
    if (p.heightCm != null && !(isFinite_(p.heightCm) && p.heightCm > 0)) fail(`${where} has a bad height.`)
    if (p.activity != null && typeof p.activity !== 'string') fail(`${where} has a bad activity level.`)
    if (p.goal != null && typeof p.goal !== 'string') fail(`${where} has a bad goal.`)
    if (p.rateKgPerWeek != null && !isFinite_(p.rateKgPerWeek)) fail(`${where} has a bad rate.`)
  }
  return out
}

/* ------------------------------------------------------------------ root */

/**
 * @typedef {object} ValidatedImport
 * @property {number} version              the schema version the file declares
 * @property {object|null} settings        normalized settings, when the file has them
 * @property {Record<string, object[]>} stores  every store, normalized, one row per key
 * @property {Record<string, number>} duplicates rows dropped per store because a later row had the same key
 */

/**
 * Check a parsed backup and hand back exactly what an import would write.
 *
 * @param {unknown} data
 * @returns {ValidatedImport}
 */
export function validateImport(data) {
  if (!isObject(data)) throw new ImportError('That file is not a Trackd backup.')
  if (data.format !== EXPORT_FORMAT) throw new ImportError('That file was not exported from Trackd.')

  /**
   * The very first exports did not write a version; everything since has.
   * A missing one is read as the first schema, which is also what a file with
   * nothing but foods and entries in it is.
   */
  const version = data.version == null ? 1 : data.version
  if (!Number.isInteger(version) || version < 1) throw new ImportError('That file has a bad version number.')
  if (version > SCHEMA_VERSION) {
    throw new ImportError(
      'That backup was made by a newer version of Trackd. Update the app, then import it.'
    )
  }

  const stores = {}
  const duplicates = {}
  for (const store of DATA_STORES) {
    // A store missing entirely is fine — an export taken before it existed.
    const rows = data[store] == null ? [] : data[store]
    if (!Array.isArray(rows)) throw new ImportError(`The "${store}" data is malformed.`)
    const check = CHECKS[store]
    const key = keyPathFor(store)
    /**
     * One row per key, last one wins.
     *
     * Two rows with the same id cannot both be stored — the second `put` would
     * overwrite the first in the transaction anyway — so the file is collapsed
     * here, where the preview can count what was collapsed and the count can
     * be shown before anything is committed. Last wins because that is what
     * the write would have done, and because a file assembled by hand from two
     * exports most plausibly has the newer copy later.
     */
    const byKey = new Map()
    rows.forEach((row, i) => {
      const clean = check(row, i)
      byKey.set(clean[key], clean)
    })
    stores[store] = [...byKey.values()]
    duplicates[store] = rows.length - byKey.size
  }

  const settings = data.settings == null ? null : checkSettings(data.settings)

  return { version, settings, stores, duplicates }
}
