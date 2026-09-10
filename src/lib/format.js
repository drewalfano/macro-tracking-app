/** Number and unit formatting. Everything user-facing rounds here, once. */

export const round = (n, dp = 0) => {
  const f = 10 ** dp
  return Math.round((Number(n) || 0) * f) / f
}

/** Macro grams: whole numbers. Nobody logs 22.4g of fat. */
export const g = (n) => String(Math.round(Number(n) || 0))

/** Calories: whole numbers. */
export const kcal = (n) => String(Math.round(Number(n) || 0))

/** Quantities: up to one decimal, but no trailing ".0". */
export const qty = (n) => {
  const v = round(n, 1)
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

export const KG_PER_LB = 0.45359237

/**
 * There is one units preference, and this is how weight follows from it.
 *
 * Kept here rather than written out at each call site because it used to be
 * two: onboarding derived the weight unit from the units segment while Settings
 * offered it as a second control, so the same app could be told two different
 * things and the screens disagreed about which had been said last. Nobody wants
 * centimetres with pounds, and the canonical-unit rule is about storage, not
 * display.
 */
export const weightUnitFor = (units) => (units === 'imperial' ? 'lb' : 'kg')

export const kgToUnit = (kg, unit) => (unit === 'lb' ? kg / KG_PER_LB : kg)
export const unitToKg = (v, unit) => (unit === 'lb' ? v * KG_PER_LB : v)

/** Weights carry one decimal — the trend moves in tenths. */
export const weight = (kg, unit = 'kg') => kgToUnit(kg, unit).toFixed(1)

export const CM_PER_IN = 2.54

/**
 * Height is stored in centimetres and shown in whatever the units preference
 * says. Imperial is feet and inches, in two fields.
 *
 * This was one field of total inches for a while, on the argument that two
 * coupled fields is a lot of form for a number typed once. That was wrong in
 * the way that matters: nobody knows their height in inches. Asking for 71
 * instead of 5 and 11 makes the person do the conversion the app is for.
 */
export const cmToHeightUnit = (cm, units) => (units === 'imperial' ? cm / CM_PER_IN : cm)
export const heightUnitToCm = (v, units) => (units === 'imperial' ? v * CM_PER_IN : v)

/** Rounds to the nearest whole inch, then carries — 5 ft 12 in is 6 ft. */
export function cmToFtIn(cm) {
  const totalIn = Math.round((Number(cm) || 0) / CM_PER_IN)
  return { ft: Math.floor(totalIn / 12), in: totalIn % 12 }
}

/** Tolerates an out-of-range inches value rather than silently clamping it. */
export const ftInToCm = (ft, inches) =>
  ((Number(ft) || 0) * 12 + (Number(inches) || 0)) * CM_PER_IN

export function heightLabel(cm, units = 'metric') {
  if (!(Number(cm) > 0)) return '—'
  if (units !== 'imperial') return `${Math.round(cm)} cm`
  const { ft, in: inches } = cmToFtIn(cm)
  return `${ft}′ ${inches}″`
}

/** Signed, for rate-of-change readouts. "+0.3", "-0.4", "0.0". */
export const signed = (n, dp = 1) => {
  const v = round(n, dp)
  const s = v.toFixed(dp)
  return v > 0 ? `+${s}` : s
}

/* ------------------------------------------------------------------ names */

/**
 * Acronyms that read as a mistake in lowercase, and only ever consulted on the
 * shouting branch below.
 *
 * Short deliberately. Every entry here is a guess about a word, and the whole
 * point of the rule below is that it does not guess — so the list earns its
 * place only for tokens that are genuinely never words: `UHT semi skimmed` is
 * right and `uht semi skimmed` is wrong, with nothing in between to argue
 * about. Anything debatable belongs out of it.
 */
const KEEP_UPPER = new Set(['UHT', 'BBQ', 'IPA', 'RTD', 'MCT', 'DHA', 'EPA', 'GF', 'XL'])

/** Units that are conventionally lowercase when they follow a digit. */
const DIGIT_UNITS = /(\d)(KCAL|MG|KG|ML|OZ|LB|G)\b/g

/**
 * Capitalise the name's first letter, but only when nothing but punctuation
 * comes before it.
 *
 * `"organic granola"` should open with a capital inside its quote; `500g oats`
 * should not acquire one in the middle at `oats`. So the search stops at the
 * first letter OR digit, and only acts if it found a letter.
 */
const upperFirst = (s) => s.replace(/^[^\p{L}\p{N}]*\p{L}/u, (m) => m.toUpperCase())

/**
 * A food name as it should appear on screen. **Display only — the record keeps
 * what the source said, and nothing here is ever written back.**
 *
 * Open Food Facts is crowdsourced, so `FRUIT & NUT` sits next to `organic
 * granola bites chocolate banana` in the same list and the mismatch is louder
 * than either name. Gemini's described foods arrive lowercase for the same
 * reason from a different direction.
 *
 * **Sentence case, not title case, and the reason is the exception list.**
 * Title case has to decide whether each word is a brand, a unit or a joiner,
 * so it needs `and`, `with`, `of`, `in`, `the` and a brand dictionary it can
 * never finish — and it still mangles `fish and chips`. Sentence case makes
 * exactly one claim, that a name starts with a capital, and that claim is
 * always true. The joiner list is EMPTY because nothing is ever capitalised
 * mid-name to begin with.
 *
 * Two branches:
 *
 * 1. Any lowercase letter present means the source had a casing intention.
 *    Capitalise the first letter, change nothing else. `Kellogg's Corn Flakes`
 *    and internal capitals survive untouched.
 * 2. Nothing but capitals means shouting, and shouting carries no intention to
 *    preserve. Downcase, then branch 1.
 *
 * Branch 2 is the destructive one, so it is fenced:
 *
 * - A single token of four letters or fewer is left alone, which is what saves
 *   a food actually called `PB` or `XL` from becoming `Pb`. It also means the
 *   acronym list only has to cover acronyms buried inside longer names.
 * - A token containing a digit keeps its shape, except a trailing unit: `500G`
 *   becomes `500g`, and `2L` stays `2L` because a lowercase `l` reads as a one.
 *
 * What branch 2 cannot do is recover brand capitals: `KELLOGG'S CORN FLAKES`
 * comes out `Kellogg's corn flakes`. There is no brand dictionary here and
 * inventing capitals would be the guessing this rule exists to avoid. The
 * stored record still has the original.
 *
 * Whitespace is preserved rather than collapsed — the replace runs per token
 * so the string that comes back differs from the source only in case.
 */
export function displayName(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return s

  const shouting = !/\p{Ll}/u.test(s) && /\p{Lu}/u.test(s)
  if (!shouting) return upperFirst(s)

  // A deliberate short acronym as the whole name: `PB`, `XL`, `UHT`.
  const letters = s.replace(/[^\p{L}]/gu, '')
  if (!/\s/.test(s) && letters.length <= 4) return s

  const lowered = s.replace(/\S+/g, (token) => {
    if (KEEP_UPPER.has(token.replace(/[^\p{L}]/gu, ''))) return token
    if (/\d/.test(token)) return token.replace(DIGIT_UNITS, (m, d, u) => d + u.toLowerCase())
    return token.toLowerCase()
  })

  return upperFirst(lowered)
}

/** Serving units the app understands. 'item' covers eggs, bars, scoops. */
export const UNITS = ['g', 'ml', 'item']

export const unitLabel = (unit, n = 1) =>
  unit === 'item' ? (Math.abs(n) === 1 ? 'item' : 'items') : unit

/**
 * Human serving label, e.g. "1 scoop (30 g)" or "100 g".
 * Falls back to the numeric serving when the source gave us no label.
 */
export function servingLabel(food) {
  if (food.servingLabel) return food.servingLabel
  return `${qty(food.servingSize)} ${unitLabel(food.servingUnit, food.servingSize)}`
}

/** "2 servings", "150 g", "3 items" — how much of a food an entry represents. */
export function quantityLabel(entry, food) {
  if (entry.unit === 'serving') {
    const n = qty(entry.quantity)
    return `${n} ${Number(n) === 1 ? 'serving' : 'servings'}`
  }
  return `${qty(entry.quantity)} ${unitLabel(entry.unit, entry.quantity)}`
}

export function pluralize(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * A product name with its brand taken off the front, for anywhere the brand
 * is shown or known separately.
 *
 * Open Food Facts names very often lead with the brand: `MADEGOOD Chocolate
 * Chip Granola Bar` with `brands: Madegood`. On a row that already carries
 * the brand underneath, or a tile that has no room for it, the name says
 * the brand twice or spends its first line on it. The record keeps the full
 * string; this is a display rule, like `displayName`, and it runs before it.
 *
 * Only a brand that is genuinely the prefix comes off, compared without
 * case or punctuation, followed by a separator or a space. `Nature Valley
 * Sweet and Salty` loses `Nature Valley`; `Naturally Good Oats` keeps its
 * name against a brand called `Natural`. And never to nothing: a product
 * named exactly its brand stays as it is.
 */
export function stripBrand(name, brand) {
  const s = String(name ?? '').trim()
  const b = String(brand ?? '').trim()
  if (!s || !b) return s
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const nb = norm(b)
  const ns = norm(s)
  if (!nb || ns === nb || !ns.startsWith(nb + ' ')) return s
  // Walk the original string past as many characters as the brand's
  // normalised form covers, then past any separator that follows.
  let i = 0
  let seen = ''
  while (i < s.length && seen.length < nb.length) {
    const ch = s[i]
    if (/[\p{L}\p{N}]/u.test(ch)) seen += ch.toLowerCase()
    else if (seen && !seen.endsWith(' ')) seen += ' '
    i++
  }
  const rest = s.slice(i).replace(/^[\s\-–—:,|·]+/u, '').trim()
  return rest || s
}
