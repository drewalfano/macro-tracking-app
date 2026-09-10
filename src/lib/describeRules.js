/**
 * The rules parser. Text in, items out — no model, no network, no database.
 *
 * This runs first on every parse, and it is the permanent fallback: everything
 * here works with the radio off and with no API key stored. What it cannot
 * place is handed on as raw text rather than guessed at.
 *
 * **It does not resolve foods and it does not produce macros.** Its whole job is
 * to turn one sentence into a list of `{quantity, unit, food}` triples, so that
 * matching against the library, the staples table and Open Food Facts has
 * something structured to match. A phrase is a phrase until something else
 * looks it up.
 *
 * The output vocabulary is the app's own — `g`, `ml`, `serving` — and nothing
 * else. "2 packs", "3 slices" and "1.5 pieces" all leave here as servings with
 * the word that was actually used kept alongside, because the app has no `pack`
 * unit and inventing one would put a fourth value into `UNITS` for the sake of
 * one screen. The original word is worth keeping so resolution can notice when
 * "2 packs" lands on a food whose serving is one biscuit.
 *
 * Normalising at this boundary rather than downstream is the same discipline
 * `off.js` applies to Open Food Facts: everything crossing in gets converted
 * once, here, and nothing past this module sees an ounce.
 */

/* ------------------------------------------------------------- vocabulary */

/** Written numbers, up to the point where nobody writes them out any more. */
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5,
}

const UNICODE_FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }

/**
 * Quantifiers that carry no number at all.
 *
 * "a couple" is deliberately NOT in here — it means two, and treating it as
 * vague would send a resolvable quantity off for estimation. "a few" is: three
 * is the usual reading and it is also plainly a guess, and the difference
 * between guessing three apricots and guessing three handfuls of them is the
 * difference between 15 and 120 calories.
 */
const VAGUE_QUANTIFIERS = ['a few', 'a handful of', 'a bit of', 'a little', 'some', 'several', 'lots of', 'plenty of']

const SIZE_WORDS = ['small', 'medium', 'large', 'big', 'generous', 'heaped', 'heaping', 'scant', 'light', 'regular', 'huge', 'tiny']

/** Mass and volume, converted to the two base units the app stores. */
const MEASURED = {
  g: ['g', 'gram', 'grams', 'gm', 'gms'],
  kg: ['kg', 'kilo', 'kilos', 'kilogram', 'kilograms'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'],
  l: ['l', 'litre', 'litres', 'liter', 'liters'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
}

const TO_BASE = {
  g: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
  oz: { unit: 'g', factor: 28.3495 },
  lb: { unit: 'g', factor: 453.592 },
  ml: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
}

/**
 * Discrete things. A number in front of one of these IS a quantity — two packs
 * is exactly two of something, even though how much that is depends on the
 * food.
 */
const COUNT_WORDS = [
  'slice', 'piece', 'pack', 'packet', 'bar', 'can', 'tin', 'bottle', 'cup', 'scoop',
  'square', 'biscuit', 'cookie', 'stick', 'wedge', 'fillet', 'breast', 'thigh',
  'roll', 'wrap', 'bun', 'bagel', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'sachet', 'pot', 'tub', 'box', 'bag', 'punnet', 'clove', 'sheet',
]

/**
 * Words that name a portion without describing its size. A number in front of
 * one of these counts the portions but says nothing about how big each is, so
 * "2 small servings" is two of something unknown — the number is real and the
 * amount is not.
 */
const PORTION_WORDS = [
  'serving', 'portion', 'handful', 'bowl', 'plate', 'glass', 'helping',
  'dollop', 'spoonful', 'mouthful', 'chunk', 'lump',
]

const plural = (words) => words.flatMap((w) => (w.endsWith('s') ? [w] : [w, `${w}s`, `${w}es`]))
const COUNT_SET = new Set(plural(COUNT_WORDS))
const PORTION_SET = new Set(plural(PORTION_WORDS))
const MEASURED_LOOKUP = new Map(
  Object.entries(MEASURED).flatMap(([key, forms]) => forms.map((f) => [f, key]))
)

/** How the food was quantified, which decides what resolution has to do next. */
export const PRECISION = {
  /** A real weight or volume. Usable as-is. */
  MEASURED: 'measured',
  /** A count of discrete things. Usable once the food's serving is known. */
  COUNTED: 'counted',
  /** No quantity given at all, so one serving is assumed. */
  IMPLIED: 'implied',
  /** A portion word or a size adjective and no number behind it. */
  VAGUE: 'vague',
}

/* ---------------------------------------------------------------- preamble */

/**
 * Openings that are about the act of describing rather than about food.
 *
 * Left in, "Today I had" becomes the first item's name and resolution goes off
 * to look for a food called "today i had a mediterranean omelette".
 */
const PREAMBLE = [
  /^\s*(so|ok|okay|right)[,\s]+/i,
  /^\s*(today|this morning|this afternoon|this evening|tonight|yesterday|earlier)[,\s]+/i,
  /^\s*for (breakfast|lunch|dinner|brunch|a snack)[,\s]+/i,
  /^\s*i (just )?(had|ate|have had|have eaten|hadn?)\b[:,\s]*/i,
  /^\s*(please )?(estimate|work out|calculate|guess)( the)? (calories|macros|cals)( and macros)?( for)?\b[:,\s]*/i,
  /^\s*(log|add|track)\b[:,\s]*/i,
  /^\s*(a|the) plate of\b[:,\s]*/i,
  /^\s*(consisting of|made up of|which was|that was)\b[:,\s]*/i,
]

function stripPreamble(text) {
  let out = text.trim()
  let changed = true
  // Looped because these stack: "Today I had…" is two of them, and
  // "Estimate calories for a plate of…" is another two.
  while (changed) {
    changed = false
    for (const re of PREAMBLE) {
      const next = out.replace(re, '')
      if (next !== out) {
        out = next
        changed = true
      }
    }
  }
  return out.replace(/\s*[.!]+\s*$/, '').replace(/\s+please\s*$/i, '').trim()
}

/* -------------------------------------------------------------- segmenting */

/**
 * `with` joins two foods when what follows it is a new noun phrase, and belongs
 * to one food when it is not. "An omelette with a house salad" is two things;
 * "toast with butter" is one thing somebody would look for under that name.
 * The determiner is the whole signal, and it is a good one.
 */
const WITH_SPLIT = /\s+(?:with|alongside|and also)\s+(?=(?:a|an|the|some|two|three|four|\d)\b)/gi

/**
 * `with` after one of these is composition, not accompaniment.
 *
 * "An omelette with a house salad" is two foods. "French toast made with 2 eggs
 * and homemade bread" is one food and a description of how it was made, and
 * splitting it produced `french toast made` — a phantom, and a worse failure
 * than any amount of under-splitting, because it names a food that does not
 * exist and then goes looking for it.
 *
 * The verb is the whole signal and it is a reliable one: nobody writes "made
 * with" about a side dish. Everything from that verb to the end of the chunk is
 * treated as part of the name, which does over-capture — "chicken cooked in
 * butter and a side salad" comes back as one item rather than two. That is the
 * same trade the comma-run refusal makes and it falls the same way: one item
 * carrying too much is visible on the plate and can be fixed or sent on, where
 * a phantom is a confident wrong answer nobody asked for.
 *
 * `served with` is deliberately absent. It means the opposite of the rest.
 */
const COMPOSITION =
  /\b(?:made|cooked|baked|prepared|filled|stuffed|topped|mixed|blended|fried|scrambled|tossed)\s+(?:with|from|of|in)\b[^,]*/gi

/**
 * Separators inside a composition clause are hidden from the splitter and put
 * back afterwards, so the clause survives segmentation as one piece without
 * `segment` needing to know anything about food.
 */
const AND_MASK = '\u0001'
const WITH_MASK = '\u0002'

const maskComposition = (text) =>
  text.replace(COMPOSITION, (clause) =>
    clause.replace(/\s+and\s+/gi, AND_MASK).replace(/\s+with\s+/gi, WITH_MASK)
  )

const unmask = (text) =>
  text.split(AND_MASK).join(' and ').split(WITH_MASK).join(' with ')

/** Splits, and remembers which separator produced each fragment. See `segment`. */
function segment(text) {
  const prepared = text.replace(WITH_SPLIT, ', ')
  const parts = []
  const re = /\s*(,\s*(?:and|&)\s+|,\s*|\s+(?:and|&|plus)\s+|;\s*)/gi
  let last = 0
  let match
  let pendingSep = 'start'

  while ((match = re.exec(prepared))) {
    parts.push({ text: prepared.slice(last, match.index).trim(), sep: pendingSep })
    // A separator containing "and" is a strong boundary; a bare comma is not.
    pendingSep = /and|&|plus|;/i.test(match[1]) ? 'and' : 'comma'
    last = match.index + match[0].length
  }
  parts.push({ text: prepared.slice(last).trim(), sep: pendingSep })
  return parts.filter((p) => p.text.length > 0)
}

/**
 * Does this fragment open the way a new item opens?
 *
 * A determiner or a number at the front is the marker. "a raspberry scone" and
 * "2 packs of…" both announce themselves; "tomato" does not, and the reason it
 * does not is that it is the middle of somebody else's name.
 */
const OPENS_ITEM = new RegExp(
  `^(?:\\d|[${Object.keys(UNICODE_FRACTIONS).join('')}]|` +
    `(?:${[...Object.keys(NUMBER_WORDS), 'the', 'some', 'several', 'my', 'another', 'lots', 'plenty'].join('|')})\\b)`,
  'i'
)

/* ------------------------------------------------------- reading a fragment */

const num = (raw) => {
  const t = raw.trim()
  if (UNICODE_FRACTIONS[t] != null) return UNICODE_FRACTIONS[t]
  // "1 1/2" and "1/2"
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Pull the quantity off the front of a fragment, leaving the food behind.
 *
 * Works on the original string rather than a lowercased copy so that "Made
 * Good" and "Mediterranean" survive with their capitals — the food phrase is
 * going to be shown on a row and searched against a library of real names.
 */
function readQuantity(fragment) {
  let rest = fragment
  let quantity = null
  let size = null
  let measure = null
  let vague = false
  /**
   * True when the only thing in front of the food was `a`, `an` or `the`.
   *
   * These sit in the number table because "a scone" is one scone, but they are
   * not a COUNT the way "three eggs" is — nobody typing "a scone" has told the
   * app an amount, they have named a food and left the portion to it. The
   * distinction is the whole difference between `implied` and `counted`, and it
   * is what lets portion memory know which quantities were actually stated.
   */
  let determinerOnly = false

  const eat = (re) => {
    const m = rest.match(re)
    if (!m) return null
    rest = rest.slice(m[0].length)
    return m
  }

  // 1. The quantity itself.
  const vagueMatch = eat(new RegExp(`^(?:${VAGUE_QUANTIFIERS.join('|')})\\s+`, 'i'))
  if (vagueMatch) {
    vague = true
  } else {
    const couple = eat(/^(?:a couple of|a couple)\s+/i)
    if (couple) {
      quantity = 2
    } else {
      const digits = eat(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*/)
      if (digits) {
        quantity = num(digits[1])
      } else {
        const fraction = eat(new RegExp(`^([${Object.keys(UNICODE_FRACTIONS).join('')}])\\s*`))
        if (fraction) {
          quantity = UNICODE_FRACTIONS[fraction[1]]
        } else {
          const word = eat(new RegExp(`^(${Object.keys(NUMBER_WORDS).join('|')})\\s+`, 'i'))
          if (word) {
            const lower = word[1].toLowerCase()
            quantity = NUMBER_WORDS[lower]
            determinerOnly = lower === 'a' || lower === 'an'
          } else if (eat(/^the\s+/i)) {
            determinerOnly = true
          }
        }
      }
    }
  }

  // 2. A size adjective, which is a qualifier and never a quantity.
  const sizeMatch = eat(new RegExp(`^(${SIZE_WORDS.join('|')})\\s+`, 'i'))
  if (sizeMatch) size = sizeMatch[1].toLowerCase()

  // 3. The measure word, if the next token is one.
  const wordMatch = rest.match(/^([a-z]+)\b/i)
  let unit = null
  let precision = null

  if (wordMatch) {
    const word = wordMatch[1].toLowerCase()
    const measured = MEASURED_LOOKUP.get(word)
    if (measured) {
      rest = rest.slice(wordMatch[0].length)
      const conversion = TO_BASE[measured]
      unit = conversion.unit
      if (quantity != null) quantity = Math.round(quantity * conversion.factor * 100) / 100
      measure = word
      precision = PRECISION.MEASURED
    } else if (COUNT_SET.has(word)) {
      rest = rest.slice(wordMatch[0].length)
      measure = word
      precision = PRECISION.COUNTED
    } else if (PORTION_SET.has(word)) {
      rest = rest.slice(wordMatch[0].length)
      measure = word
      // A number of portions is still a number, but the size of each is not
      // known — that is exactly the case the estimator exists for.
      precision = PRECISION.VAGUE
    }
  }

  // 4. The "of" that joins a measure to its food, and any determiner after it.
  eat(/^\s*of\s+/i)
  eat(/^\s*(?:a|an|the)\s+/i)

  const food = rest.trim().replace(/\s+/g, ' ')

  if (precision == null) {
    // No measure word: the number counts the food itself ("2 eggs"), or there
    // was no number and one serving is the reading.
    if (vague) precision = PRECISION.VAGUE
    else if (quantity == null || determinerOnly) {
      quantity = 1
      precision = PRECISION.IMPLIED
    } else {
      precision = PRECISION.COUNTED
    }
  }

  // A size adjective with no number behind it is not a quantity either.
  if (size && precision === PRECISION.IMPLIED) precision = PRECISION.VAGUE
  if (vague) quantity = null

  return {
    food,
    quantity,
    // The app has three units and `serving` at entry level. Anything counted or
    // portioned leaves here as servings; `measure` keeps what was actually said.
    unit: precision === PRECISION.MEASURED ? unit : 'serving',
    measure,
    size,
    precision,
  }
}

/**
 * How much the split in front of a fragment can be trusted.
 *
 * `start` is the first fragment, which was never split from anything. `strong`
 * is a fragment that opens the way a new item opens — "a latte", "2 eggs",
 * "the scone" — so the person announced it as a new thing whatever separator
 * sat in front of it. `weak` is everything else: a fragment that exists only
 * because an "and", an "&", a "plus" or a comma sat in the sentence, which is
 * exactly where a product name ("spinach & egg white bites", "mac and cheese")
 * or a modification ("with oat milk and no sugar") gets cut in two. The rules
 * cannot tell those from two foods, so they say so rather than pick.
 */
function boundaryOf(fragment, index) {
  if (index === 0) return 'start'
  return OPENS_ITEM.test(fragment.text) ? 'strong' : 'weak'
}

/**
 * The whole description read as one item, quantity and all.
 *
 * For the fallback that refuses to split: "2 Tim Hortons spinach & egg white
 * bites" is two of one thing, and the row that preserves the description
 * should still carry the two.
 */
export function readWhole(input) {
  const text = stripPreamble(String(input || ''))
  if (!text) return null
  return { kind: 'item', text, boundary: 'start', ...readQuantity(text) }
}

/* ------------------------------------------------------------------ parse */

/**
 * @typedef {object} DescribedItem
 * @property {'item'} kind
 * @property {string} text     the fragment as written, kept for portion memory
 * @property {string} food     the food phrase, with the quantity taken off
 * @property {number|null} quantity
 * @property {'g'|'ml'|'serving'} unit
 * @property {string|null} measure  the word used, e.g. 'pack'
 * @property {string|null} size     'small' | 'large' | …
 * @property {string} precision     see PRECISION
 */

/**
 * @typedef {object} DescribedSpan
 * @property {'span'} kind
 * @property {string} text
 * @property {string} reason
 */

/**
 * Parse a described meal.
 *
 * Returns everything in the order it was written, because the plate is going to
 * show it back and a list that reorders what somebody typed is a list they have
 * to re-read to check.
 *
 * **Where it refuses to guess.** A comma-separated fragment that does not open
 * like a new item — "tomato", "gnocchi", "chicken bake" — is either the middle
 * of a compound name or an item with its determiner left off, and no rule can
 * tell those apart without knowing what the foods are. "a feta, tomato, gnocchi,
 * chicken bake" is one dish; "eggs, bacon, toast" is three. So the run, along
 * with the fragment before it, comes back as a span for something that does know
 * about food to split — the model when there is a key, and the person otherwise.
 *
 * The fragment before the run is swallowed deliberately. It reads complete on
 * its own, but if the run continues its name then emitting it alone produces a
 * confident, wrong item — "a small serving of a feta" — and a wrong item that
 * looks right is the one failure this whole feature is built to avoid.
 *
 * @param {string} input
 * @returns {{parts: Array<DescribedItem|DescribedSpan>, items: DescribedItem[], spans: DescribedSpan[]}}
 */
export function parseDescription(input) {
  const empty = { parts: [], items: [], spans: [] }
  if (typeof input !== 'string' || !input.trim()) return empty

  // Composition clauses are hidden from the splitter and restored immediately
  // after, so every fragment downstream reads as it was written.
  const fragments = segment(maskComposition(stripPreamble(input))).map((f) => ({
    ...f,
    text: unmask(f.text),
  }))
  if (!fragments.length) return empty

  // The first fragment always opens an item; after that, an "and" boundary or a
  // determiner does.
  const opens = fragments.map(
    (f, i) => i === 0 || f.sep === 'and' || OPENS_ITEM.test(f.text)
  )

  /**
   * How sure the split in front of each part is. See `boundaryOf`: a part
   * that opens with a determiner or a number announced itself, and one that
   * was split off only because an "and" or an "&" sat in front of it did not.
   * `interpretLocally` reads this to decide whether the split can stand on
   * its own or has to be confirmed.
   */
  const parts = []
  let i = 0
  while (i < fragments.length) {
    let j = i + 1
    while (j < fragments.length && !opens[j]) j++

    const boundary = boundaryOf(fragments[i], i)
    if (j > i + 1) {
      parts.push({
        kind: 'span',
        text: fragments.slice(i, j).map((f) => f.text).join(', '),
        reason: 'ambiguous-boundary',
        boundary: 'weak',
      })
    } else {
      const text = fragments[i].text
      parts.push({ kind: 'item', text, boundary, ...readQuantity(text) })
    }
    i = j
  }

  return {
    parts,
    items: parts.filter((p) => p.kind === 'item'),
    spans: parts.filter((p) => p.kind === 'span'),
  }
}

/**
 * What the rules managed, as a fraction of what was written.
 *
 * Used by the tests and by nothing on screen. It counts fragments rather than
 * items on purpose: a span is one string that may hold several foods, so
 * counting it as a single miss would flatter the parser.
 */
export function coverage(input) {
  const { parts } = parseDescription(input)
  const fragments = segment(stripPreamble(input))
  const spanned = parts
    .filter((p) => p.kind === 'span')
    .reduce((n, p) => n + segment(p.text).length, 0)
  return {
    fragments: fragments.length,
    items: parts.filter((p) => p.kind === 'item').length,
    spans: parts.filter((p) => p.kind === 'span').length,
    spannedFragments: spanned,
  }
}
