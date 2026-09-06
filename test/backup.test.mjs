/**
 * Backups: what the validator lets through, what it refuses, and whether a
 * refused or failed import leaves the database as it was.
 *
 * The validator is pure and is tested directly. The write path is tested
 * against `fake-indexeddb`, which implements the real transaction semantics —
 * including rollback on abort — rather than against a stub that would only
 * prove the stub rolls back.
 */

import 'fake-indexeddb/auto'

const R = new URL('../src/lib/', import.meta.url).href
const B = await import(R + 'backup.js')
const DB = await import(R + 'db.js')

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`
  )
}
/** The validator either throws an ImportError with this text, or it does not. */
const rejects = (label, data, fragment) => {
  try {
    B.validateImport(data)
    eq(label, 'accepted', `rejected: ${fragment}`)
  } catch (err) {
    const ok = err instanceof B.ImportError && err.message.includes(fragment)
    eq(label, ok ? `rejected: ${fragment}` : `wrong: ${err.message}`, `rejected: ${fragment}`)
  }
}

/* ----------------------------------------------------------- fixtures */

const food = (over = {}) => ({
  id: 'f1',
  name: 'Whey',
  brand: null,
  barcode: null,
  servingSize: 30,
  servingUnit: 'g',
  per100: { kcal: 400, protein: 80, fat: 6.7, carbs: 6.7, sodium: 250 },
  source: 'custom',
  createdAt: 1000,
  lastUsedAt: 2000,
  useCount: 3,
  lastQuantity: 1,
  lastUnit: 'serving',
  ...over,
})

const entry = (over = {}) => ({
  id: 'e1',
  date: '2026-08-01',
  block: 'morning',
  foodId: 'f1',
  foodName: 'Whey',
  brand: null,
  quantity: 1,
  unit: 'serving',
  computed: { kcal: 120, protein: 24, fat: 2, carbs: 2 },
  createdAt: 3000,
  ...over,
})

const meal = (over = {}) => ({
  id: 'm1',
  name: 'Shake',
  items: [{ foodId: 'f1', quantity: 2, unit: 'serving' }],
  createdAt: 1000,
  useCount: 0,
  ...over,
})

const settings = (over = {}) => ({
  ...DB.DEFAULT_SETTINGS,
  onboardingComplete: true,
  targets: { kcal: 2200, protein: 160, fat: 70, carbs: 240 },
  favourites: [{ type: 'food', id: 'f1' }],
  ...over,
})

const file = (over = {}) => ({
  format: B.EXPORT_FORMAT,
  version: B.SCHEMA_VERSION,
  exportedAt: '2026-08-02T10:00:00.000Z',
  settings: settings(),
  foods: [food()],
  entries: [entry()],
  meals: [meal()],
  weights: [{ date: '2026-08-01', kg: 80.4, createdAt: 1 }],
  dayTargets: [{ date: '2026-08-01', targets: { kcal: 2200, protein: 160, fat: 70, carbs: 240 }, savedAt: 1 }],
  ...over,
})

/* ------------------------------------------------------- the validator */

console.log('--- validation ---')
{
  const v = B.validateImport(file())
  eq('a current export validates', Object.keys(v.stores), B.DATA_STORES)
  eq('and reports its version', v.version, B.SCHEMA_VERSION)
  eq('and carries its settings', v.settings.targets.kcal, 2200)
  eq('nothing is counted as duplicate', Object.values(v.duplicates).every((n) => n === 0), true)
  eq('weightUnit is dropped, since it is derived', 'weightUnit' in v.settings, false)
}

{
  // An export from the first schema: no dayTargets store, no version stamp on
  // the very earliest, entries without a created time, foods without counts.
  const legacy = {
    format: B.EXPORT_FORMAT,
    foods: [{ id: 'f1', name: 'Egg', servingSize: 50, servingUnit: 'g', per100: { kcal: 155, protein: 13, fat: 11, carbs: 1.1 } }],
    entries: [{ id: 'e1', date: '2025-12-31', block: 'night', foodId: 'f1', foodName: 'Egg', quantity: 2, unit: 'item', computed: { kcal: 155, protein: 13, fat: 11, carbs: 1.1 } }],
    meals: [],
    weights: [{ date: '2025-12-31', kg: 81 }],
  }
  const v = B.validateImport(legacy)
  eq('a legacy export with no version validates as version 1', v.version, 1)
  eq('a store that did not exist yet is empty', v.stores.dayTargets, [])
  eq('a food without counts gets zeros', [v.stores.foods[0].useCount, v.stores.foods[0].lastUsedAt], [0, 0])
  eq('an entry without a created time is placed on its own day', new Date(v.stores.entries[0].createdAt).toISOString().slice(0, 10), '2025-12-31')
  eq('sodium missing stays missing', 'sodium' in v.stores.foods[0].per100, false)
  eq('legacy settings absent is allowed', v.settings, null)
}

{
  // A history that has outlived its foods is a normal history.
  const v = B.validateImport(file({ foods: [], entries: [entry({ foodId: 'gone' })], meals: [meal()] }))
  eq('an entry for a deleted food is kept', v.stores.entries.length, 1)
  eq('a meal pointing at a missing food is kept', v.stores.meals[0].items.length, 1)
  const q = B.validateImport(
    file({ entries: [entry({ foodId: null, foodName: 'Takeaway', source: 'quick' })] })
  )
  eq('a quick add with no food validates', q.stores.entries[0].foodId, null)
  const est = B.validateImport(
    file({
      meals: [meal({ items: [{ foodId: null, name: 'Curry', quantity: 1, unit: 'serving', computed: { kcal: 700, protein: 30, fat: 30, carbs: 70 }, source: 'describe' }] })],
    })
  )
  eq('a meal item standing on its own numbers validates', est.stores.meals[0].items[0].computed.kcal, 700)
}

{
  const v = B.validateImport(
    file({ foods: [food({ name: 'First' }), food({ name: 'Second' })], weights: [{ date: '2026-08-01', kg: 80 }, { date: '2026-08-01', kg: 81 }] })
  )
  eq('duplicate ids collapse to one row', v.stores.foods.length, 1)
  eq('the later copy wins', v.stores.foods[0].name, 'Second')
  eq('and the collapse is counted', v.duplicates, { foods: 1, entries: 0, meals: 0, weights: 1, dayTargets: 0 })
  eq('a duplicate date keeps the later weight', v.stores.weights[0].kg, 81)
}

rejects('not an object', 'nope', 'not a Trackd backup')
rejects('wrong format', { format: 'other' }, 'not exported from Trackd')
rejects('a future version', file({ version: B.SCHEMA_VERSION + 1 }), 'newer version of Trackd')
rejects('a nonsense version', file({ version: 'two' }), 'bad version')
rejects('a store that is not a list', file({ entries: {} }), '"entries" data is malformed')
rejects('a food with no id', file({ foods: [food({ id: '' })] }), 'has no id')
rejects('a food with no name', file({ foods: [food({ name: '  ' })] }), 'has no name')
rejects('a food with a zero serving', file({ foods: [food({ servingSize: 0 })] }), 'bad serving size')
rejects('a food with a made-up unit', file({ foods: [food({ servingUnit: 'cup' })] }), 'unknown serving unit')
rejects('a food with text for a macro', file({ foods: [food({ per100: { kcal: 'lots', protein: 1, fat: 1, carbs: 1 } })] }), 'bad kcal')
rejects('a food with no nutrition', file({ foods: [food({ per100: null })] }), 'has no nutrition')
rejects('a bad remembered portion', file({ foods: [food({ portions: { handful: { quantity: 'x', unit: 'g' } } })] }), 'bad remembered portion')
rejects('an entry with an impossible date', file({ entries: [entry({ date: '2026-02-30' })] }), 'no valid date')
rejects('an entry with a bad block', file({ entries: [entry({ block: 'brunch' })] }), 'unknown time block')
rejects('an entry with a NaN quantity', file({ entries: [entry({ quantity: NaN })] }), 'bad quantity')
rejects('an entry with no macros', file({ entries: [entry({ computed: { kcal: 1 } })] }), 'bad protein')
rejects('an entry with neither name nor food', file({ entries: [entry({ foodId: null, foodName: '' })] }), 'no name and no food')
rejects('a meal with no items list', file({ meals: [meal({ items: null })] }), 'has no items')
rejects('a foodless meal item with no numbers', file({ meals: [meal({ items: [{ foodId: null, name: 'X', quantity: 1, unit: 'serving' }] })] }), 'has no nutrition')
rejects('a weight that is not positive', file({ weights: [{ date: '2026-08-01', kg: -1 }] }), 'bad value')
rejects('a day target with a bad date', file({ dayTargets: [{ date: 'august', targets: { kcal: 1, protein: 1, fat: 1, carbs: 1 } }] }), 'no valid date')
rejects('settings that are not an object', file({ settings: [] }), 'settings in that file are malformed')
rejects('an unknown theme', file({ settings: settings({ theme: 'blue' }) }), 'unknown theme')
rejects('two block names', file({ settings: settings({ blockNames: ['a', 'b'] }) }), 'bad block names')
rejects('a threshold past midnight', file({ settings: settings({ blockThresholds: { afternoon: 12, night: 25 } }) }), 'bad block thresholds')
rejects('a favourite of an unknown kind', file({ settings: settings({ favourites: [{ type: 'drink', id: 'x' }] }) }), 'bad favourite')
rejects('a target that is text', file({ settings: settings({ targets: { kcal: '2000', protein: 1, fat: 1, carbs: 1 } }) }), 'bad kcal target')
rejects('a profile with an unknown sex', file({ settings: settings({ profile: { sex: 'yes' } }) }), 'unknown sex')

{
  const v = B.validateImport(file({ settings: settings({ somethingNewer: true }) }))
  eq('an unknown settings field is kept', v.settings.somethingNewer, true)
}

/* ---------------------------------------------------------- the store */

console.log('\n--- import and export ---')

const strip = (exported) => {
  const { exportedAt, exportedOn, ...rest } = exported
  return rest
}
const count = async (store) => (await (await DB.db()).getAllKeys(store)).length

// A device with real data on it.
await DB.saveSettings({ onboardingComplete: true, targets: { kcal: 2500, protein: 170, fat: 75, carbs: 260 } })
const whey = await DB.putFood(food({ id: undefined }))
await DB.putEntry(entry({ id: undefined, foodId: whey.id, date: '2026-08-03' }))
await DB.putMeal(meal({ id: undefined, items: [{ foodId: whey.id, quantity: 1, unit: 'serving' }] }))
await DB.putWeight('2026-08-03', 79.5)
const before = strip(await DB.exportAll())
eq('the export validates as a current file', B.validateImport(before).version, B.SCHEMA_VERSION)
eq('and it declares the format', before.format, B.EXPORT_FORMAT)

{
  // A bad file leaves everything alone.
  const bad = file({ entries: [entry({ date: 'never' })] })
  let message = null
  await DB.importAll(bad, 'replace').catch((err) => (message = err.message))
  eq('a malformed file is refused with a reason', message, 'Entry "Whey" has no valid date.')
  eq('and the database is untouched', strip(await DB.exportAll()), before)
}

{
  // A file that validates but cannot be written: a value the structured clone
  // refuses. The transaction aborts and IndexedDB rolls back the clear.
  const poisoned = file({ foods: [food({ id: 'poison', bad: () => {} })] })
  let failed = false
  await DB.importAll(poisoned, 'replace').catch(() => (failed = true))
  eq('a failed write rejects', failed, true)
  eq('and the previous data survives the aborted replace', strip(await DB.exportAll()), before)
  eq('including the settings', (await DB.getSettings()).targets.kcal, 2500)
}

{
  // Merge: the preview says what the store will hold, then the store holds it.
  const incoming = file({
    foods: [food({ id: whey.id, name: 'Whey, updated' }), food({ id: 'f2', name: 'Oats' })],
    entries: [entry({ id: 'e-new', foodId: 'f2', foodName: 'Oats', date: '2026-08-04' })],
    meals: [],
    weights: [{ date: '2026-08-04', kg: 79.2 }],
    dayTargets: [],
    settings: settings({ targets: { kcal: 1, protein: 1, fat: 1, carbs: 1 } }),
  })
  const preview = await DB.previewImport(incoming, 'merge')
  eq('merge preview: foods', preview.counts.foods, { existing: 1, incoming: 2, added: 1, overwritten: 1, removed: 0, after: 2 })
  eq('merge preview: settings are not applied', preview.settings, { present: true, applied: false })
  await DB.importAll(incoming, 'merge')
  for (const store of B.DATA_STORES) {
    eq(`after a merge, ${store} holds what the preview said`, await count(store), preview.counts[store].after)
  }
  eq('the overlapping food was updated', (await DB.getFood(whey.id)).name, 'Whey, updated')
  eq('the merge left settings alone', (await DB.getSettings()).targets.kcal, 2500)
  eq('a merged food is searchable', (await DB.searchFoods('oats')).length, 1)
}

{
  // Replace: the preview says what the store will hold, then the store holds it.
  const preview = await DB.previewImport(before, 'replace')
  eq('replace preview: settings come across', preview.settings, { present: true, applied: true })
  eq('replace preview: foods', preview.counts.foods.after, 1)
  await DB.importAll(before, 'replace')
  for (const store of B.DATA_STORES) {
    eq(`after a replace, ${store} holds what the preview said`, await count(store), preview.counts[store].after)
  }
  eq('export → replace → export round-trips the stores', strip(await DB.exportAll()), before)
}

{
  // A legacy file replaces cleanly, with the newer store simply empty.
  const legacy = {
    format: B.EXPORT_FORMAT,
    version: 1,
    foods: [food({ id: 'lf' })],
    entries: [entry({ id: 'le', foodId: 'lf', createdAt: undefined })],
    meals: [],
    weights: [],
  }
  await DB.importAll(legacy, 'replace')
  eq('a legacy replace lands its rows', [await count('foods'), await count('entries'), await count('dayTargets')], [1, 1, 0])
  const [row] = await DB.listEntries('2026-08-01')
  eq('and the day index can find the entry', row?.id, 'le')
  eq('and its created time was filled in', typeof row?.createdAt, 'number')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
