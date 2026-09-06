import { searchFoods, recallPortion, portionKey } from './db.js'
import { searchStaples, stapleDraft, stapleName } from './staples.js'
import { searchProducts, isOnline } from './off.js'
import { computeMacros } from './compute.js'
import { PRECISION } from './describeRules.js'

/**
 * Turning parsed phrases into things that can sit on a plate.
 *
 * The order is library, then the staples table, then Open Food Facts, then —
 * only if a key is stored and only when asked — an estimate. Your own foods
 * lead because they are the likely hit and cost no network. Staples sit above
 * Open Food Facts for the reason the add sheet's search already documents: OFF
 * is a database of barcoded packaged products whose text search reads
 * ingredient lists, so for a bare noun like "sourdough" its best honest answer
 * is a branded loaf rather than bread. Nearly every phrase in a described meal
 * is a bare noun.
 *
 * Nothing here writes to the library. A staple or an Open Food Facts product
 * resolves to a DRAFT that rides on the plate item and is adopted at commit, so
 * a parse you look at and throw away leaves no trace — the same bargain
 * `staples.js` makes for the add sheet: "nothing enters the foods store because
 * it exists somewhere, only because someone reached for it."
 */

/* -------------------------------------------------------------- the chain */

/**
 * Words that carry no identity, so their presence in an Open Food Facts product
 * name proves nothing about whether it is the right product.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'with', 'in', 'on', 'my', 'some', 'fresh',
  'homemade', 'home', 'made', 'own', 'plain', 'dry', 'raw', 'cooked',
])

const terms = (phrase) =>
  String(phrase || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))

/** Plurals are the only inflection worth undoing to compare two food words. */
const stem = (word) => word.replace(/(ies)$/, 'y').replace(/(es|s)$/, '')

/**
 * Whether an Open Food Facts product is actually the food that was described.
 *
 * Open Food Facts searches ingredient lists as well as names, and it is a
 * database of BARCODED PACKAGED PRODUCTS — so for a bare noun it returns
 * something plausible far more often than something right. Left to one shared
 * word, "dry sourdough" came back as Sourdough Fusilli and "a raspberry scone"
 * as a raspberry white chocolate scone mix. Both are pasta and flour wearing
 * the right adjective, and both would have arrived on the plate as `Matched`,
 * with real macros, reading as settled.
 *
 * **The head noun is the test.** The last meaningful word of a product name is
 * what the food IS; everything before it says what kind. If that word is not
 * somewhere in what you wrote, it is a different food however many adjectives
 * agree — fusilli is not sourdough, and a mix is not a scone. Mandarin Oranges
 * in Water passes against "a mandarins in water cup" because its head, water,
 * is right there in the phrase.
 *
 * A shared term is still required as well, so a head noun matching by accident
 * cannot carry an otherwise unrelated product.
 *
 * **The brand is excluded from both tests, and that is not a detail.** Open
 * Food Facts brands are company names full of ordinary food words, and letting
 * them in wrecks the comparison in both directions at once: "house salad"
 * matched a Lite Balsamic Vinaigrette because the brand is Ken's Steak HOUSE,
 * and "dried apricots" lost its perfectly good Dried Soft Apricots because the
 * brand, Alesto, became the last word and therefore the head. What a food IS
 * lives in its name; who sells it says nothing about whether it is the thing
 * you ate.
 *
 * This is deliberately strict, and the cost is real: a food Open Food Facts
 * genuinely has will sometimes come back as "Needs a match" instead. That is
 * the trade this feature is built on — a row that admits it does not know is
 * fixable in two taps, and a confidently wrong row is one you have to catch.
 */
export function offLooksRight(phrase, draft) {
  const wanted = terms(phrase).map(stem)
  if (!wanted.length) return false

  const nameTerms = terms(draft.name).map(stem)
  if (!nameTerms.length) return false

  const overlaps = (t) => wanted.some((w) => w.includes(t) || t.includes(w))
  if (!nameTerms.some(overlaps)) return false

  /**
   * Open Food Facts names are comma-separated attribute lists rather than
   * English noun phrases — "Chicken breast, raw", "Sticky fingers bakeries,
   * scones premium mix, raspberry" — so the last word of the whole string is
   * very often a modifier that drifted to the end. That last example ends in
   * "raspberry", which is in the phrase, and it is a box of dry scone mix.
   *
   * So the segment that best describes the food is found first — the one
   * sharing most with what was written — and ITS head is the one tested. For
   * that product the winning segment is "scones premium mix", whose head is
   * mix, and a mix is not a scone.
   */
  const segments = draft.name
    .split(',')
    .map((s) => terms(s).map(stem))
    .filter((s) => s.length)
  if (!segments.length) return false

  const best = segments.reduce((a, b) =>
    b.filter(overlaps).length > a.filter(overlaps).length ? b : a
  )
  const head = best[best.length - 1]
  return overlaps(head)
}

/**
 * The phrase with its last word made singular, or null when that changes nothing.
 *
 * "Two eggs" is written as eggs and the staples table lists an egg, and the
 * library search wants every term to appear in the name — so the plural was a
 * miss on the commonest food anyone describes. Only the last word is touched:
 * it is the head noun, and "dried apricots" should become "dried apricot", not
 * "dry apricot". The same single inflection `offLooksRight` undoes.
 */
export function singular(phrase) {
  const words = String(phrase || '').trim().split(/\s+/)
  const last = words[words.length - 1] || ''
  const one = last.length > 3 ? last.replace(/ies$/, 'y').replace(/(sh|ch|ss|x)es$/, '$1').replace(/s$/, '') : last
  if (one === last) return null
  return [...words.slice(0, -1), one].join(' ')
}

/**
 * @returns {Promise<{source: 'library'|'staple'|'off', food?: object, draft?: object}|null>}
 */
export async function resolvePhrase(phrase, { signal } = {}) {
  const text = String(phrase || '').trim()
  if (!text) return null

  // The phrase as written, then its singular, against each local source in
  // turn: a library hit on the singular still beats a staple hit on the plural.
  const forms = [text, singular(text)].filter(Boolean)
  for (const form of forms) {
    const [found] = await searchFoods(form, 1)
    if (found) return { source: 'library', food: found }
  }
  for (const form of forms) {
    const [staple] = await searchStaples(form, 1)
    if (staple) return { source: 'staple', draft: { ...stapleDraft(staple), name: stapleName(staple) } }
  }

  if (!isOnline()) return null

  try {
    const products = await searchProducts(text, { signal, pageSize: 10 })
    const hit = products.find((r) => offLooksRight(text, r.draft))
    if (hit) return { source: 'off', draft: hit.draft }
  } catch (err) {
    // A failed lookup is not a failed parse. The row simply arrives needing a
    // match, which is a state the plate already knows how to show.
    if (err.name === 'AbortError') throw err
  }

  return null
}

/* ------------------------------------------------------------ plate items */

/**
 * The four shapes a plate item can take, and how to tell them apart.
 *
 * Kept in one function because both the plate's renderer and `logPlate` branch
 * on it, and two copies of this would drift the first time a fifth case turned
 * up. Items added from the add sheet carry none of the new fields and fall
 * through to `matched`, which is what they have always been.
 */
export function classifyItem(item) {
  if (!item) return 'unmatched'
  if (item.computed) return 'estimated'
  if (!item.foodId && !item.draft) return 'unmatched'
  return item.quantity == null ? 'needs-amount' : 'matched'
}

/**
 * The phrase a remembered portion is filed under.
 *
 * Not the whole fragment. "a few handfuls of dried apricots" and "a few
 * handfuls of apricots" are the same instruction about the same food, and
 * filing under the full text would remember neither the second time. What is
 * worth keeping is the AMOUNT phrasing — "handful", "small serving" — against
 * the food it was corrected on.
 */
export function amountPhrase(item) {
  const measure = (item.measure || 'serving').replace(/(es|s)$/, '')
  return portionKey([item.size, measure].filter(Boolean).join(' '))
}

/** A quantity the app is willing to put a number against without asking. */
const hasUsableQuantity = (item) =>
  item.quantity != null && item.precision !== PRECISION.VAGUE

/**
 * One parsed item, resolved and turned into a plate item.
 *
 * A vague amount on a food that DID resolve is not an estimate and is not a
 * failure to match — it is a real food whose portion nobody has stated. Portion
 * memory answers it outright when the phrase has been corrected before;
 * otherwise the row arrives asking for an amount, which is the one thing the
 * app genuinely does not know and you do.
 */
async function toPlateItem(item, { signal }) {
  const resolved = await resolvePhrase(item.food, { signal })

  if (!resolved) {
    /**
     * The amount travels with the words, so that a food picked for this row
     * later — by hand, in the search — arrives already measured. "Two eggs"
     * that resolved to nothing still said two; only a vague amount is left
     * as the blank it is.
     */
    return {
      name: item.food,
      text: item.text,
      phrase: amountPhrase(item),
      quantity: hasUsableQuantity(item) ? item.quantity : null,
      unit: item.unit,
    }
  }

  const record = resolved.food || resolved.draft
  const base = resolved.food
    ? { foodId: resolved.food.id }
    : { draft: resolved.draft, name: resolved.draft.name }

  if (hasUsableQuantity(item)) {
    return { ...base, quantity: item.quantity, unit: item.unit, phrase: amountPhrase(item) }
  }

  const remembered = recallPortion(record, amountPhrase(item))
  if (remembered) {
    return {
      ...base,
      quantity: remembered.quantity,
      unit: remembered.unit,
      phrase: amountPhrase(item),
    }
  }

  // Known food, unknown portion. `quantity: null` is the whole signal.
  return { ...base, quantity: null, unit: item.unit, phrase: amountPhrase(item), text: item.text }
}

/**
 * Everything the rules produced, resolved.
 *
 * Spans come through as unmatched rows carrying their own text, in the position
 * they were written, so the plate reads back in the order of the sentence.
 */
export async function resolveParsed(parsed, { signal } = {}) {
  const out = []
  for (const part of parsed.parts) {
    if (part.kind === 'span') {
      out.push({ name: part.text, text: part.text, span: true })
      continue
    }
    out.push(await toPlateItem(part, { signal }))
  }
  return out
}

/**
 * What the model handed back, put through resolution before its estimate is
 * allowed to count.
 *
 * Spec 9.3 is absolute: a food that exists never takes an estimated value. A
 * dish the model split out of a compound name may well be in the library, so
 * every returned item is looked up again and the estimate is consulted only
 * where that lookup also comes back empty.
 */
export async function resolveModelItems(modelItems, { signal } = {}) {
  const out = []
  for (const item of modelItems) {
    const resolved = await resolvePhrase(item.name, { signal })

    if (resolved) {
      const base = resolved.food
        ? { foodId: resolved.food.id }
        : { draft: resolved.draft, name: resolved.draft.name }
      out.push({ ...base, quantity: item.quantity ?? 1, unit: item.unit })
      continue
    }

    if (!item.estimate) {
      out.push({ name: item.name, text: item.name })
      continue
    }

    out.push({
      name: item.name,
      quantity: item.quantity ?? 1,
      unit: item.unit,
      computed: {
        kcal: Math.round(item.estimate.kcal),
        protein: Math.round(item.estimate.protein),
        fat: Math.round(item.estimate.fat),
        carbs: Math.round(item.estimate.carbs),
      },
    })
  }
  return out
}

/**
 * What a row is worth, whichever shape it is.
 *
 * An estimate carries its own totals and is used verbatim; everything else is
 * computed from a food or a draft the way the rest of the app computes it.
 */
export function itemMacros(item, food) {
  if (item.computed) return item.computed
  const record = food || item.draft
  if (!record) return null
  if (item.quantity == null) return null
  return computeMacros(record, item.quantity, item.unit)
}

/** What the leftovers call would carry, and nothing more. */
export function leftoversPayload(items) {
  const spans = []
  const unresolved = []
  for (const item of items) {
    if (classifyItem(item) !== 'unmatched') continue
    if (item.span) spans.push(item.text || item.name)
    else unresolved.push(item.text || item.name)
  }
  return { spans, unresolved }
}
