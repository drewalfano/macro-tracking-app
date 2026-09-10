import { parseDescription, readWhole, PRECISION } from './describeRules.js'
import { describeMeal } from './describeModel.js'
import { resolvePhrase, amountPhrase } from './describeResolve.js'

/**
 * Turning a description into a list of foods — and nothing else.
 *
 * This is the first half of a read, and it answers one question: WHAT did the
 * person eat? Not what each thing is worth, which is `lookupItem`'s job and
 * happens afterwards, one row at a time. Keeping the two apart is what lets
 * the review show "Understanding your meal" and then "Finding a match" on each
 * row as two different waits, and what lets a failed model call fall back to
 * a local reading without touching the lookup at all.
 *
 * Two readers, one shape out. `interpretWithModel` sends the whole
 * description to Gemini and takes its foods, brands and modifications as the
 * items. `interpretLocally` runs the rules parser, and then does something
 * the parser on its own never did: it refuses its own split when it cannot
 * back it up.
 *
 * **The bug this exists for.** "Tim Hortons spinach & egg white bites" is one
 * product. The rules parser split it on the "&" — that is what an "&" usually
 * means in a sentence — sent "Tim Hortons spinach" off to be looked up, and
 * showed "egg white bites" as a settled row. Neither was a food anyone ate.
 * A split on "and", "&", "plus" or a comma is now a WEAK boundary (see
 * `boundaryOf` in the rules), and a local read with a weak boundary in it is
 * accepted only when every piece it produced is a food the library or the
 * staples table already knows. Otherwise the description is kept whole, as
 * one row, with the split held beside it as a proposal the person can accept
 * in one tap. An unsure row that says so beats two confident rows that are
 * wrong.
 */

/** Every row an interpretation produces carries these, and starts pending. */
const usableQuantity = (item) => item.quantity != null && item.precision !== PRECISION.VAGUE

/** A rules item as a row waiting for its lookup. */
export function rowFromRules(item) {
  if (item.kind === 'span') {
    return { name: item.text, text: item.text, span: true, quantity: null, unit: 'serving' }
  }
  return {
    name: item.food,
    text: item.text,
    /**
     * The amount travels with the words, so that a food picked for this row
     * later — by hand, in the search — arrives already measured. Only a vague
     * amount is left as the blank it is.
     */
    quantity: usableQuantity(item) ? item.quantity : null,
    unit: item.unit,
    phrase: amountPhrase(item),
  }
}

/** A model item as a row waiting for its lookup. */
export function rowFromModel(item) {
  return {
    name: item.name,
    text: item.name,
    brand: item.brand || null,
    modifiers: item.modifiers || [],
    packaged: item.packaged === true,
    quantity: item.quantity,
    unit: item.unit || 'serving',
    estimate: item.estimate || null,
  }
}

/**
 * @typedef {object} Interpretation
 * @property {'gemini'|'local'} source
 * @property {object[]} items       rows, each waiting for its lookup
 * @property {boolean} ambiguous    the local reader could not stand behind its split
 */

/**
 * The whole description, read by the model.
 *
 * @param {string} text
 * @param {{signal?: AbortSignal, model?: typeof describeMeal}} [opts]
 * @returns {Promise<Interpretation>}
 */
export async function interpretWithModel(text, { signal, model = describeMeal } = {}) {
  const found = await model({ text, signal })
  return { source: 'gemini', items: found.map(rowFromModel), ambiguous: false }
}

/**
 * The description read by the rules, and the split kept only where it is safe.
 *
 * `lookup` is the local half of the resolution chain — the library and the
 * staples table, no network — and it is injectable so the decision can be
 * tested without a database behind it.
 *
 * @param {string} text
 * @param {{signal?: AbortSignal, lookup?: typeof resolvePhrase}} [opts]
 * @returns {Promise<Interpretation>}
 */
export async function interpretLocally(text, { signal, lookup = resolvePhrase } = {}) {
  const parsed = parseDescription(text)
  if (!parsed.parts.length) return { source: 'local', items: [], ambiguous: false }

  const rows = parsed.parts.map(rowFromRules)

  // One part is one row: nothing was split, so there is nothing to doubt. A
  // lone span is the same — the whole of it goes to the lookup as written.
  if (rows.length === 1) return { source: 'local', items: rows, ambiguous: false }

  const weak = parsed.parts.some((part) => part.boundary === 'weak')
  if (!weak) return { source: 'local', items: rows, ambiguous: false }

  /**
   * A weak split stands only when every piece of it is already a food. "eggs
   * and toast" passes — both are in the staples table — and "Tim Hortons
   * spinach & egg white bites" does not, because "Tim Hortons spinach" is not
   * a thing. A span never passes: it is the parser's own admission that it
   * could not find the boundaries.
   */
  const known = await Promise.all(
    rows.map((row) => (row.span ? null : lookup(row.name, { signal, local: true })))
  )
  if (known.every(Boolean)) return { source: 'local', items: rows, ambiguous: false }

  const whole = readWhole(text)
  return {
    source: 'local',
    ambiguous: true,
    items: [{ ...rowFromRules(whole), ambiguous: true, proposed: rows }],
  }
}
