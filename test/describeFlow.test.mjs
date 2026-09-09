/**
 * The Describe read, end to end and without a DOM.
 *
 * Three things are pinned here, each of which was a real bug:
 *
 * 1. A product name is not a list. "Tim Hortons spinach & egg white bites"
 *    was split on the "&" into two rows, neither of which was a food. The
 *    model reply keeps it whole, and the local fallback refuses a split it
 *    cannot back up.
 * 2. An old read never lands on a new list. Editing the description while
 *    a read was out let the first answer overwrite the second.
 * 3. Retrying never duplicates, and the total only counts what is confirmed.
 *
 * Everything asynchronous is driven by deferreds, so the interleavings the
 * tests care about — an answer arriving after it was superseded — are exact
 * rather than timed.
 */

const R = new URL('../src/lib/', import.meta.url).href
const { normalizeMealReply } = await import(R + 'describeModel.js')
const { interpretLocally, interpretWithModel, rowFromModel } = await import(R + 'describeInterpret.js')
const { lookupItem, offLooksRight, classifyItem } = await import(R + 'describeResolve.js')
const { createDescribeSession } = await import(R + 'describeSession.js')
const { draftStatus, groupRows, describeTotals, stripDraft } = await import(R + 'describeDraft.js')

let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`
  )
}

/** A promise with its strings on the outside. */
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

/* ---------------------------------------------------- the model's reply */

console.log('\n--- the model reply ---')
{
  const reply = normalizeMealReply({
    items: [
      {
        name: 'Tim Hortons Spinach & Egg White Bites',
        brand: 'Tim Hortons',
        quantity: 1,
        unit: 'serving',
        modifiers: [],
        packaged: true,
        kcal: 180,
        protein: 14,
        fat: 10,
        carbs: 8,
      },
    ],
  })
  eq('a product name with an ampersand stays one item', reply.length, 1)
  eq('and keeps every word of it', reply[0].name, 'Tim Hortons Spinach & Egg White Bites')
  eq('the brand rides apart from the name', reply[0].brand, 'Tim Hortons')
  eq('the estimate is kept aside, not spread onto the item', ['kcal' in reply[0], reply[0].estimate.kcal], [false, 180])
}
{
  const reply = normalizeMealReply({
    items: [
      { name: 'Starbucks Latte', brand: 'Starbucks', quantity: 1, unit: 'serving', modifiers: ['oat milk', 'no sugar'], packaged: true, kcal: 150, protein: 5, fat: 6, carbs: 18 },
      { name: 'Tim Hortons Spinach & Egg White Bites', brand: 'Tim Hortons', quantity: 1, unit: 'serving', modifiers: [], packaged: true, kcal: 180, protein: 14, fat: 10, carbs: 8 },
    ],
  })
  eq('a latte and the bites are two foods', reply.map((r) => r.name), ['Starbucks Latte', 'Tim Hortons Spinach & Egg White Bites'])
  eq('the drink modifications belong to the latte', reply[0].modifiers, ['oat milk', 'no sugar'])
  eq('and not to the bites', reply[1].modifiers, [])
}
eq('an empty reply is no items', normalizeMealReply({ items: [] }), [])
eq('garbage is no items', normalizeMealReply('nope'), [])
eq('a nameless entry is dropped', normalizeMealReply({ items: [{ name: '  ', quantity: 1 }] }), [])
eq(
  'a null estimate is honoured',
  normalizeMealReply({ items: [{ name: 'mystery', quantity: null, unit: 'x', kcal: null }] })[0],
  { name: 'mystery', brand: null, quantity: null, unit: 'serving', modifiers: [], packaged: false, estimate: null }
)

{
  const out = await interpretWithModel('a latte with oat milk and spinach & egg white bites', {
    model: async () => [
      { name: 'Latte', brand: null, quantity: 1, unit: 'serving', modifiers: ['oat milk'], packaged: false, estimate: null },
      { name: 'Tim Hortons Spinach & Egg White Bites', brand: 'Tim Hortons', quantity: 1, unit: 'serving', modifiers: [], packaged: true, estimate: { kcal: 180, protein: 14, fat: 10, carbs: 8 } },
    ],
  })
  eq('the model interpretation is two rows', out.items.map((r) => r.name), ['Latte', 'Tim Hortons Spinach & Egg White Bites'])
  eq('with the milk on the latte', out.items[0].modifiers, ['oat milk'])
  eq('and marked as the model\'s', out.source, 'gemini')
}

/* ------------------------------------------------- the local fallback */

console.log('\n--- the local fallback ---')

/** A lookup that knows a handful of generic foods and nothing branded. */
const knows = (names) => async (phrase) =>
  names.some((n) => phrase.toLowerCase().replace(/s\b/g, '') === n) ? { source: 'staple', draft: { name: phrase } } : null
const staples = knows(['egg', 'toast', 'latte', 'banana'])

{
  const out = await interpretLocally('Tim Hortons spinach & egg white bites', { lookup: staples })
  eq('the bites are not split on the ampersand', out.items.length, 1)
  eq('the whole description is preserved on the row', out.items[0].name, 'Tim Hortons spinach & egg white bites')
  eq('and the row says it is unsure', [out.ambiguous, out.items[0].ambiguous], [true, true])
  eq('with the split it declined to make held as a proposal', out.items[0].proposed.map((p) => p.name), ['Tim Hortons spinach', 'egg white bites'])
}
{
  const out = await interpretLocally('2 Tim Hortons spinach & egg white bites', { lookup: staples })
  eq('a leading amount survives the refusal', [out.items[0].quantity, out.items[0].name], [2, 'Tim Hortons spinach & egg white bites'])
}
{
  const out = await interpretLocally('eggs and toast', { lookup: staples })
  eq('a weak split stands when every piece is a known food', out.items.map((r) => r.name), ['eggs', 'toast'])
  eq('and is not flagged', out.ambiguous, false)
}
{
  const out = await interpretLocally('2 eggs and a Tim Hortons bagel', { lookup: staples })
  eq('a determiner after "and" is a strong boundary', out.items.map((r) => r.name), ['eggs', 'Tim Hortons bagel'])
  eq('and needs no lookup to stand', out.ambiguous, false)
}
{
  const out = await interpretLocally('a latte with oat milk and spinach & egg white bites', { lookup: staples })
  eq('a modification joined by "and" is not made a food', out.items.length, 1)
  eq('the whole sentence is kept for the person to confirm', out.items[0].text, 'a latte with oat milk and spinach & egg white bites')
}
{
  const out = await interpretLocally('a scone, an apple, and a pear', { lookup: knows([]) })
  eq('a comma list of announced items still splits', out.items.map((r) => r.name), ['scone', 'apple', 'pear'])
}
{
  const out = await interpretLocally('a large omelette', { lookup: knows([]) })
  eq('one part is one row, unknown or not', [out.items.length, out.ambiguous], [1, false])
}
eq('nothing that reads as food is no rows', (await interpretLocally('Today I had', { lookup: staples })).items, [])

/* ------------------------------------------------------ the lookup */

const rows2 = [{ name: 'Tim Hortons spinach' }, { name: 'egg white bites' }]
console.log('\n--- the lookup ---')
{
  const calls = []
  const patch = await lookupItem(
    { name: 'Tim Hortons Spinach & Egg White Bites', brand: 'Tim Hortons', quantity: 1, unit: 'serving', estimate: { kcal: 180, protein: 14, fat: 10, carbs: 8 } },
    { lookup: async (phrase, opts) => (calls.push([phrase, opts.branded]), null) }
  )
  eq('a branded item is looked up as branded', calls, [['Tim Hortons Spinach & Egg White Bites', true]])
  eq('and takes the estimate only when nothing is found', [patch.computed.kcal, patch.quantity, classifyItem(patch)], [180, 1, 'estimated'])
}
{
  const patch = await lookupItem(
    { name: 'eggs', quantity: 2, unit: 'serving', estimate: { kcal: 999, protein: 0, fat: 0, carbs: 0 } },
    { lookup: async () => ({ source: 'library', food: { id: 'f-egg' } }) }
  )
  eq('a found food never takes the estimate', [patch.foodId, patch.computed, patch.quantity], ['f-egg', null, 2])
}
{
  const patch = await lookupItem(
    { name: 'latte', quantity: null, unit: 'serving' },
    { lookup: async () => ({ source: 'staple', draft: { name: 'Latte' } }) }
  )
  eq('a found food with no amount asks for one', classifyItem(patch), 'needs-amount')
}
{
  const patch = await lookupItem({ name: 'mystery', quantity: 1, unit: 'serving' }, { lookup: async () => null })
  eq('nothing found and no estimate is unmatched', classifyItem(patch), 'unmatched')
  const unsure = { name: 'Tim Hortons spinach & egg white bites', quantity: 1, unit: 'serving', ambiguous: true, proposed: rows2 }
  const kept = { ...unsure, ...(await lookupItem(unsure, { lookup: async () => null })) }
  eq('an unconfirmed split survives a lookup that finds nothing', [classifyItem(kept), kept.proposed.length], ['ambiguous', 2])
  const found = { ...unsure, ...(await lookupItem(unsure, { lookup: async () => ({ source: 'library', food: { id: 'f-bites' } }) })) }
  eq('and is settled by a lookup that finds the one food', [classifyItem(found), found.proposed], ['matched', null])
}
eq(
  'a generic egg white is not the branded bites',
  offLooksRight('Tim Hortons Spinach & Egg White Bites', { name: 'Egg White', brand: 'Happy Egg' }, { strict: true }),
  false
)
eq(
  'the actual product passes the strict test',
  offLooksRight('Tim Hortons Spinach & Egg White Bites', { name: 'Egg Bites, Spinach & Egg White', brand: 'Tim Hortons' }, { strict: true }),
  true
)
eq('and the loose test is unchanged for generic foods', offLooksRight('dried apricots', { name: 'Dried Soft Apricots' }), true)

/* ----------------------------------------------------- the session */

console.log('\n--- the session ---')

/** A session whose reads and lookups answer only when the test says so. */
function harness() {
  const interprets = []
  const lookups = []
  const changes = []
  const session = createDescribeSession({
    interpret: (text, { signal }) => {
      const d = deferred()
      interprets.push({ text, ...d, signal })
      return d.promise
    },
    lookup: (row, { signal }) => {
      const d = deferred()
      lookups.push({ row, ...d, signal })
      signal.addEventListener('abort', () => d.reject(new DOMException('Aborted', 'AbortError')))
      return d.promise
    },
    onChange: (state) => changes.push(state.phase),
  })
  return { session, interprets, lookups, changes }
}
const rows = (...names) => names.map((name) => ({ name, text: name, quantity: 1, unit: 'serving' }))
const matched = (id) => ({ foodId: id, draft: null, computed: null, quantity: 1, unit: 'serving' })
const names = (s) => s.state.items.map((r) => r.name)

{
  // Editing during processing: the first read's answers must never appear.
  const { session, interprets, lookups } = harness()
  const first = session.read('Tim Hortons spinach & egg white bites')
  eq('a read starts by understanding', session.state.phase, 'interpreting')
  const second = session.read('a latte and Tim Hortons spinach & egg white bites')
  eq('the first read was abandoned', interprets[0].signal.aborted, true)

  // The stale interpretation lands late, after the new read has started.
  interprets[0].resolve({ source: 'local', items: rows('Tim Hortons spinach', 'egg white bites') })
  await first
  eq('a stale interpretation does not land', session.state.items, [])
  eq('and nothing was looked up for it', lookups.length, 0)

  interprets[1].resolve({ source: 'gemini', items: rows('Latte', 'Tim Hortons Spinach & Egg White Bites') })
  await tick()
  eq('the current read lands', names(session), ['Latte', 'Tim Hortons Spinach & Egg White Bites'])
  eq('with every row pending', session.state.items.map((r) => r.pending), [true, true])
  eq('and one lookup per row', lookups.length, 2)

  lookups[0].resolve(matched('f-latte'))
  await tick()
  const groups = groupRows(session.state.items)
  eq('a row that lands moves to ready while the other is still checking', [groups.ready.map((r) => r.name), groups.pending.map((r) => r.name)], [['Latte'], ['Tim Hortons Spinach & Egg White Bites']])
  eq('the footer names the wait', draftStatus(session.state.items).reason, 'Still checking 1 item.')
  const partial = describeTotals(session.state.items, (r) => (r.foodId ? { kcal: 150, protein: 5, fat: 6, carbs: 18 } : null))
  eq('the total is a subtotal of confirmed rows only', [partial.partial, partial.confirmed, partial.pending, partial.totals.kcal], [true, 1, 1, 150])

  lookups[1].resolve({ ...matched(null), foodId: null, computed: { kcal: 180, protein: 14, fat: 10, carbs: 8 } })
  await second
  eq('everything landed', session.state.phase, 'done')
  const done = describeTotals(session.state.items, (r) => r.computed || { kcal: 150, protein: 5, fat: 6, carbs: 18 })
  eq('and the total is the meal', [done.partial, done.totals.kcal, done.estimates], [false, 330, 1])
  eq('and the meal can be logged', draftStatus(session.state.items).canLog, true)
  eq('a logged row carries none of the review\'s bookkeeping', Object.keys(stripDraft(session.state.items[0])).filter((k) => ['pending', 'lookup', 'estimate', 'failed', 'brand', 'modifiers'].includes(k)), [])
}

{
  // A stale lookup, not just a stale interpretation.
  const { session, interprets, lookups } = harness()
  const first = session.read('eggs')
  interprets[0].resolve({ source: 'local', items: rows('eggs') })
  await tick()
  eq('the first read is looking up', [session.state.phase, lookups.length], ['looking-up', 1])
  const second = session.read('toast')
  interprets[1].resolve({ source: 'local', items: rows('toast') })
  await tick()
  eq('the old lookup was cancelled', lookups[0].signal.aborted, true)
  lookups[0].resolve(matched('f-egg'))
  await first
  eq('a stale lookup answer does not land', names(session), ['toast'])
  eq('and the new row is untouched by it', session.state.items[0].foodId, undefined)
  lookups[1].resolve(matched('f-toast'))
  await second
  eq('the current lookup lands', session.state.items[0].foodId, 'f-toast')
}

{
  // Retrying does not duplicate.
  const { session, interprets, lookups } = harness()
  const read = session.read('mystery bake')
  interprets[0].resolve({ source: 'local', items: rows('mystery bake') })
  await tick()
  lookups[0].reject(new Error('OFF is down'))
  await read
  eq('a failed lookup settles as unmatched, marked failed', [classifyItem(session.state.items[0]), session.state.items[0].failed], ['unmatched', 'error'])
  eq('and the log is blocked for it', draftStatus(session.state.items).reason, '1 item needs a food.')

  const row = session.state.items[0]
  const retry = session.retry(row)
  eq('a retry is the same row, pending again', [session.state.items.length, row.pending], [1, true])
  eq('and the phase follows it', session.state.phase, 'looking-up')
  lookups[1].resolve(matched('f-bake'))
  await retry
  eq('the retry lands on the one row', [session.state.items.length, row.foodId, session.state.phase], [1, 'f-bake', 'done'])

  // Reanalysing replaces, never adds.
  const again = session.read('mystery bake')
  interprets[1].resolve({ source: 'gemini', items: rows('Mystery Bake') })
  await tick()
  lookups[2].resolve(matched('f-bake'))
  await again
  eq('a reanalysis replaces the previous interpretation', names(session), ['Mystery Bake'])
}

{
  // Confirming a refused split replaces the one row with its pieces.
  const { session, interprets, lookups } = harness()
  const read = session.read('Tim Hortons spinach & egg white bites')
  interprets[0].resolve({
    source: 'local',
    ambiguous: true,
    items: [{ ...rows('Tim Hortons spinach & egg white bites')[0], ambiguous: true, proposed: rows('Tim Hortons spinach', 'egg white bites') }],
  })
  await tick()
  lookups[0].resolve({ foodId: null, draft: null, computed: null })
  await read
  eq('an unsure row is its own state', classifyItem(session.state.items[0]), 'ambiguous')
  eq('and blocks the log as needing a food', draftStatus(session.state.items).canLog, false)
  const split = session.split(session.state.items[0])
  eq('splitting swaps the row for its pieces, in place', names(session), ['Tim Hortons spinach', 'egg white bites'])
  lookups[1].resolve({ foodId: null, draft: null, computed: null })
  lookups[2].resolve(matched('f-bites'))
  await split
  eq('and each piece is looked up on its own', session.state.items.map((r) => classifyItem(r)), ['unmatched', 'matched'])
}

{
  // Cancel: nothing started before it may change the rows afterwards.
  const { session, interprets, lookups } = harness()
  const read = session.read('eggs and toast')
  interprets[0].resolve({ source: 'local', items: rows('eggs', 'toast') })
  await tick()
  session.cancel()
  eq('cancel abandons the lookups', lookups.every((l) => l.signal.aborted), true)
  eq('and nothing is left pending', session.state.items.some((r) => r.pending), false)
  lookups[0].resolve(matched('f-egg'))
  await read
  eq('an answer after cancel does not land', session.state.items[0].foodId, undefined)
}

{
  // Removing a row mid-lookup: the answer for it is dropped, the rest land.
  const { session, interprets, lookups } = harness()
  const read = session.read('eggs and toast')
  interprets[0].resolve({ source: 'local', items: rows('eggs', 'toast') })
  await tick()
  const [eggs] = session.state.items
  session.remove(eggs)
  eq('a removed row is gone', names(session), ['toast'])
  lookups[1].resolve(matched('f-toast'))
  await read
  eq('and the read still finishes', [session.state.phase, session.state.items[0].foodId], ['done', 'f-toast'])
  eq('with the removed row still gone', session.state.items.length, 1)
}

{
  // A failed interpretation is a state, not an exception.
  const { session, interprets } = harness()
  const read = session.read('???')
  interprets[0].reject(new Error('no'))
  await read
  eq('an interpretation that throws ends in failed', [session.state.phase, session.state.items], ['failed', []])
  eq('and a status with nothing in it says so', draftStatus(session.state.items).reason, 'Nothing to log yet.')
}

{
  // Grouping and totals with nothing confirmed.
  const pending = [{ name: 'a', pending: true }, { name: 'b', pending: true }]
  const t = describeTotals(pending, () => null)
  eq('nothing confirmed while checking is not a zero', [t.confirmed, t.pending, t.partial], [0, 2, true])
  const g = groupRows([{ name: 'a', pending: true }, { name: 'b', foodId: 'x', quantity: 1 }, { name: 'c' }, { name: 'd', foodId: 'y', quantity: null }])
  eq('the three groups', [g.pending.length, g.ready.length, g.attention.map((r) => r.name)], [1, 1, ['c', 'd']])
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
