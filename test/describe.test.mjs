/**
 * The rules parser. Pure text handling, so it runs straight in node.
 *
 * The two long sentences at the bottom are the spec's own acceptance examples,
 * and they are the reason this file prints a coverage summary rather than only
 * passing or failing: the number the rules reach on them is what decides how
 * much the model is left holding, and it should be visible on every run rather
 * than measured once and written into a comment that then goes stale.
 */

const R = new URL('../src/lib/', import.meta.url).href
const { parseDescription, coverage, PRECISION } = await import(R + 'describeRules.js')

let pass = 0, fail = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  ok ? pass++ : fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`)
}

/** The fields worth asserting on, without the bookkeeping. */
const shape = (item) => ({
  food: item.food,
  quantity: item.quantity,
  unit: item.unit,
  measure: item.measure,
  size: item.size,
  precision: item.precision,
})

const one = (text) => shape(parseDescription(text).items[0])

/* ------------------------------------------------------------- quantities */

eq('bare food is one serving', one('a raspberry scone'), {
  food: 'raspberry scone', quantity: 1, unit: 'serving', measure: null, size: null, precision: PRECISION.IMPLIED,
})

eq('decimal count keeps its measure word', one('1.5 pieces of dry sourdough'), {
  food: 'dry sourdough', quantity: 1.5, unit: 'serving', measure: 'pieces', size: null, precision: PRECISION.COUNTED,
})

eq('packs are counted, and "the" is not part of the name', one('2 packs of the banana choc chip Made Good bites'), {
  food: 'banana choc chip Made Good bites', quantity: 2, unit: 'serving', measure: 'packs', size: null, precision: PRECISION.COUNTED,
})

eq('grams are measured', one('40g of dried apricots'), {
  food: 'dried apricots', quantity: 40, unit: 'g', measure: 'g', size: null, precision: PRECISION.MEASURED,
})

eq('ounces convert to grams', one('4 oz chicken'), {
  food: 'chicken', quantity: 113.4, unit: 'g', measure: 'oz', size: null, precision: PRECISION.MEASURED,
})

eq('litres convert to millilitres', one('1 litre of milk'), {
  // `measure` keeps the word that was written, not the key it converted through.
  food: 'milk', quantity: 1000, unit: 'ml', measure: 'litre', size: null, precision: PRECISION.MEASURED,
})

eq('a few handfuls has no number', one('a few handfuls of dried apricots'), {
  food: 'dried apricots', quantity: null, unit: 'serving', measure: 'handfuls', size: null, precision: PRECISION.VAGUE,
})

eq('a couple is two, not a guess', one('a couple of eggs'), {
  food: 'eggs', quantity: 2, unit: 'serving', measure: null, size: null, precision: PRECISION.COUNTED,
})

eq('a small serving counts portions, not amount', one('a small serving of chicken bake'), {
  food: 'chicken bake', quantity: 1, unit: 'serving', measure: 'serving', size: 'small', precision: PRECISION.VAGUE,
})

eq('2 small servings keeps the two', one('2 small servings of boxed pasta'), {
  food: 'boxed pasta', quantity: 2, unit: 'serving', measure: 'servings', size: 'small', precision: PRECISION.VAGUE,
})

eq('a size adjective alone is vague', one('a large omelette'), {
  food: 'omelette', quantity: 1, unit: 'serving', measure: null, size: 'large', precision: PRECISION.VAGUE,
})

eq('written numbers count the food itself', one('three eggs'), {
  food: 'eggs', quantity: 3, unit: 'serving', measure: null, size: null, precision: PRECISION.COUNTED,
})

eq('fractions', one('½ a bagel').quantity, 0.5)
eq('mixed fractions', one('1 1/2 cups of rice').quantity, 1.5)

/* --------------------------------------------------------------- preamble */

eq('preamble is not a food', one('Today I had a raspberry scone').food, 'raspberry scone')
eq('stacked preamble', one('Estimate calories for a plate of 3 slices of homemade bread').food, 'homemade bread')
eq('trailing full stop', one('a raspberry scone.').food, 'raspberry scone')

/* ------------------------------------------------------------- segmenting */

eq('and splits', parseDescription('eggs and toast').items.map((i) => i.food), ['eggs', 'toast'])
eq('with splits when a determiner follows', parseDescription('an omelette with a house salad').items.map((i) => i.food), ['omelette', 'house salad'])
eq('with does not split without one', parseDescription('toast with butter').items.map((i) => i.food), ['toast with butter'])
eq('trailing "and" in a comma list', parseDescription('a scone, an apple, and a pear').items.map((i) => i.food), ['scone', 'apple', 'pear'])

/**
 * The refusal. A run of determiner-less fragments is either one compound name
 * or several elided items, and the parser must not pick.
 */
const bake = parseDescription('a small serving of a feta, tomato, gnocchi, chicken bake')
eq('compound name is not split into phantoms', bake.items.length, 0)
eq('compound name comes back whole', bake.spans.map((s) => s.text), ['a small serving of a feta, tomato, gnocchi, chicken bake'])

const orphan = parseDescription('2 servings of pasta, toss salad, and 3 slices of bread')
eq('an orphan fragment takes its neighbour with it', orphan.spans.map((s) => s.text), ['2 servings of pasta, toss salad'])
eq('the item after an "and" survives it', orphan.items.map((i) => i.food), ['bread'])

eq('order is preserved', parseDescription('a scone, gnocchi bits, and an apple').parts.map((p) => p.kind), ['span', 'item'])

/**
 * Composition, not accompaniment. Splitting these produced `french toast made`,
 * which is a phantom — a food that does not exist, sent off to be looked up.
 */
eq(
  'made with is one food',
  parseDescription('french toast made with 2 eggs and homemade bread').items.map((i) => i.food),
  ['french toast made with 2 eggs and homemade bread']
)
eq(
  'cooked in is one food',
  parseDescription('chicken cooked in butter').items.map((i) => i.food),
  ['chicken cooked in butter']
)
eq(
  'plain with still splits',
  parseDescription('an omelette with a house salad').items.map((i) => i.food),
  ['omelette', 'house salad']
)
eq(
  'a composition clause does not swallow the next comma item',
  parseDescription('french toast made with 2 eggs, a raspberry scone').items.map((i) => i.food),
  ['french toast made with 2 eggs', 'raspberry scone']
)

/* ------------------------------------------------------------------ edges */

eq('empty input', parseDescription('').items, [])
eq('whitespace only', parseDescription('   ').parts, [])
eq('null input does not throw', parseDescription(null).items, [])
eq('a lone preamble leaves nothing', parseDescription('Today I had').items.map((i) => i.food), [])

/* ------------------------------------------------- the acceptance examples */

const EXAMPLES = [
  {
    label: 'Example 1',
    text: 'Today I had a Mediterranean omelette with a house salad and 1.5 pieces of dry sourdough, a raspberry scone, a few handfuls of dried apricots, a small serving of a feta, tomato, gnocchi, chicken bake, 2 packs of the banana choc chip Made Good bites, a mandarins in water cup',
    foods: 8,
  },
  {
    label: 'Example 2',
    text: 'Estimate calories for a plate of 2 small servings of boxed pasta in homemade tomato sauce, toss salad, and 3 slices of homemade bread',
    foods: 3,
  },
]

/* --------------------------------------- the Open Food Facts match guard */

/**
 * Every case here is a real response from Open Food Facts, kept because each
 * one broke the guard at some point. This is the most dangerous function in the
 * feature: everything it lets through arrives on the plate as `Matched`, with
 * real macros, reading as settled.
 */
const { offLooksRight } = await import(R + 'describeResolve.js')
const product = (name, brand = null) => ({ name, brand })

eq('a matching head noun passes', offLooksRight('dried apricots', product('Dried Soft Apricots', 'Alesto')), true)
eq('the brand is not the head noun', offLooksRight('dried apricots', product('Dried Soft Apricots', 'Alesto')), true)
eq('mandarins in water', offLooksRight('mandarins in water cup', product('Mandarin Oranges in Water')), true)

eq('sourdough is not fusilli', offLooksRight('dry sourdough', product('Sourdough Fusilli')), false)
eq('a scone is not a scone mix', offLooksRight('raspberry scone', product('raspberry white chocolate scone mix')), false)
eq(
  'a brand containing "house" does not make a vinaigrette a house salad',
  offLooksRight('house salad', product('Lite Balsamic Vinaigrette', "Ken's Steak House")),
  false
)
eq('an unrelated product', offLooksRight('house salad', product('Ranch Dressing, Topping & Spread')), false)
eq('an empty phrase matches nothing', offLooksRight('', product('Dried Soft Apricots')), false)
eq('a nameless product matches nothing', offLooksRight('apricots', product('')), false)

/* ------------------------------------------------------------ the draft */

/**
 * The review's own rules: what a re-read keeps, where a model reply lands, and
 * what blocks the log. Pure functions over plate-shaped items, so the whole
 * state machine behind the sheet is exercised here without a DOM.
 */
const Dr = await import(R + 'describeDraft.js')

const matched = (over = {}) => ({ id: over.id || Dr.draftId(), key: 'k', foodId: 'f1', quantity: 1, unit: 'serving', ...over })
const unmatched = (over = {}) => ({ id: over.id || Dr.draftId(), key: 'k', name: 'gnocchi bake', text: 'gnocchi bake', ...over })
const estimated = (over = {}) => ({ id: over.id || Dr.draftId(), key: 'k', name: 'curry', quantity: 1, unit: 'serving', computed: { kcal: 700, protein: 30, fat: 30, carbs: 70 }, ...over })

eq('stampRows gives every row an id and a key', Dr.stampRows([{ name: 'Eggs', text: '2 Eggs' }]).map((r) => [typeof r.id, r.key]), [['string', '2 eggs']])
eq('stampRows keeps an existing id', Dr.stampRows([{ id: 'x', text: 'a' }])[0].id, 'x')
eq('a key ignores case and spacing', Dr.draftKey('  Two   EGGS '), 'two eggs')

{
  const fixedEggs = matched({ id: 'old', key: 'two eggs', quantity: 3, fixed: true })
  const oldToast = unmatched({ id: 'old-toast', key: 'toast' })
  const reread = [
    { id: 'n1', key: 'a banana', foodId: 'f9', quantity: 1, unit: 'serving' },
    { id: 'n2', key: 'two eggs', foodId: 'f1', quantity: 2, unit: 'serving' },
    { id: 'n3', key: 'toast', foodId: 'f2', quantity: 1, unit: 'serving' },
  ]
  const out = Dr.carryCorrections([fixedEggs, oldToast], reread)
  eq('a re-read keeps a row fixed by hand, wherever it moved to', out.map((r) => r.id), ['n1', 'old', 'n3'])
  eq('and takes the new read for anything not fixed', out[2].foodId, 'f2')
  eq('a re-read never duplicates', out.length, 3)
  const twice = Dr.carryCorrections([fixedEggs], [{ id: 'n2', key: 'two eggs' }, { id: 'n4', key: 'two eggs' }])
  eq('one fixed row stands in for at most one new row', twice.map((r) => r.id), ['old', 'n4'])
}

{
  const a = matched({ id: 'a' })
  const b = unmatched({ id: 'b' })
  const c = matched({ id: 'c' })
  const d = unmatched({ id: 'd' })
  const reply = [estimated({ id: 'r1' }), estimated({ id: 'r2' })]
  const out = Dr.replaceSent([a, b, c, d], ['b', 'd'], reply)
  eq('a model reply lands where the first sent row was', out.map((r) => r.id), ['a', 'r1', 'r2', 'c'])
  eq('an empty reply changes nothing', Dr.replaceSent([a, b], ['b'], []).map((r) => r.id), ['a', 'b'])
  const late = Dr.replaceSent([a, b, unmatched({ id: 'e' })], ['b'], reply)
  eq('a row that was not sent is not swept up', late.map((r) => r.id), ['a', 'r1', 'r2', 'e'])
}

{
  eq('all matched can log', Dr.draftStatus([matched(), estimated()]).canLog, true)
  const s1 = Dr.draftStatus([matched(), unmatched()])
  eq('an unmatched row blocks', [s1.canLog, s1.reason], [false, '1 item needs a food.'])
  const s2 = Dr.draftStatus([matched({ quantity: null }), matched({ quantity: null }), unmatched()])
  eq('the reason counts what is missing', s2.reason, '1 item needs a food and 2 items need an amount.')
  eq('nothing at all cannot log', Dr.draftStatus([]).reason, 'Nothing to log yet.')
  const s3 = Dr.draftStatus([matched(), matched({ missing: true })])
  eq('a deleted food is skipped, not blocking', [s3.canLog, s3.missing], [true, 1])
}

{
  const plate = [{ foodId: 'p1', quantity: 1, unit: 'serving' }, { foodId: 'x', describe: 'draft-1' }, { foodId: 'p2', quantity: 2, unit: 'g' }]
  const once = Dr.mergeIntoPlate(plate, 'draft-1', [matched({ id: 'm1', foodId: 'y' })])
  eq('a draft replaces its own earlier batch in place', once.map((i) => i.foodId), ['p1', 'y', 'p2'])
  eq('and carries its tag', once[1].describe, 'draft-1')
  eq('and leaves the review bookkeeping behind', ['id', 'key', 'fixed'].some((k) => k in once[1]), false)
  const twice = Dr.mergeIntoPlate(once, 'draft-1', [matched({ foodId: 'y' }), matched({ foodId: 'z' })])
  eq('sending again does not double the meal', twice.map((i) => i.foodId), ['p1', 'y', 'z', 'p2'])
  const fresh = Dr.mergeIntoPlate([{ foodId: 'p1' }], 'draft-2', [matched({ foodId: 'q' })])
  eq('a new draft is appended after what was there', fresh.map((i) => i.foodId), ['p1', 'q'])
}

eq('the amount question names the food', Dr.amountQuestion('Rice'), 'About how much rice?')
eq('the amount question lowers a Title Case product name', Dr.amountQuestion('Dried Soft Apricots'), 'About how much dried soft apricots?')
eq('the amount question keeps an acronym', Dr.amountQuestion('PB Powder'), 'About how much PB powder?')

const { singular } = await import(R + 'describeResolve.js')
eq('eggs is an egg', singular('two eggs'), 'two egg')
eq('apricots keeps its adjective', singular('dried apricots'), 'dried apricot')
eq('berries is a berry', singular('mixed berries'), 'mixed berry')
eq('a singular is left alone', singular('rice'), null)
eq('a three-letter word is left alone', singular('gas'), null)
eq('dishes is a dish', singular('side dishes'), 'side dish')
eq('the amount question with no name', Dr.amountQuestion(''), 'About how much?')

console.log('\n--- the spec\'s two examples ---')
let totalFoods = 0
let totalItems = 0

for (const example of EXAMPLES) {
  const { parts } = parseDescription(example.text)
  const c = coverage(example.text)
  totalFoods += example.foods
  totalItems += c.items

  console.log(`\n${example.label} — ${c.items} items, ${c.spans} span(s), of ${example.foods} foods written`)
  for (const part of parts) {
    if (part.kind === 'span') {
      console.log(`   span   "${part.text}"`)
      continue
    }
    const amount =
      part.quantity == null
        ? `? ${part.measure || part.unit}`
        : `${part.quantity} ${part.measure || part.unit}`
    console.log(
      `   item   ${String(amount).padEnd(16)} ${part.food.padEnd(38)} ${part.precision}${part.size ? ` (${part.size})` : ''}`
    )
  }
}

console.log(`\nItems parsed by rules alone: ${totalItems} of ${totalFoods} foods written ` +
  `(${Math.round((totalItems / totalFoods) * 100)}%)`)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
