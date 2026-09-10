/**
 * All macro arithmetic.
 *
 * The one modelling decision everything else leans on: a food stores `per100`,
 * normalized to 100 of its base unit (100 g, 100 ml, or 100 items). Every
 * serving-size change downstream is then multiplication, never a re-fetch.
 */

import { round } from './format.js'

export const MACROS = ['kcal', 'protein', 'fat', 'carbs']
/** Fixed order, everywhere: calories, protein, fat, carbs. Spec 7. */
export const MACRO_ORDER = ['kcal', 'protein', 'fat', 'carbs']

export const MACRO_META = {
  kcal: { label: 'Calories', short: 'cal', letter: '', color: 'kcal', unit: '' },
  protein: { label: 'Protein', short: 'P', letter: 'P', color: 'protein', unit: 'g' },
  fat: { label: 'Fat', short: 'F', letter: 'F', color: 'fat', unit: 'g' },
  carbs: { label: 'Carbs', short: 'C', letter: 'C', color: 'carbs', unit: 'g' },
}

export const ATWATER = { protein: 4, carbs: 4, fat: 9 }

export function kcalFromMacros({ protein = 0, carbs = 0, fat = 0 }) {
  return protein * ATWATER.protein + carbs * ATWATER.carbs + fat * ATWATER.fat
}

export const emptyTotals = () => ({ kcal: 0, protein: 0, fat: 0, carbs: 0 })

/**
 * Convert an entry's quantity into the food's base unit.
 * 'serving' is a valid unit for entries — it means "n × the food's serving".
 */
export function baseQuantity(food, quantity, unit) {
  const q = Number(quantity) || 0
  if (unit === 'serving') return q * (Number(food.servingSize) || 0)
  return q
}

/** Macros for an arbitrary quantity of a food. The hot path. */
export function computeMacros(food, quantity, unit) {
  const base = baseQuantity(food, quantity, unit)
  const factor = base / 100
  const p = food.per100 || {}
  return {
    kcal: round((p.kcal || 0) * factor, 1),
    protein: round((p.protein || 0) * factor, 1),
    fat: round((p.fat || 0) * factor, 1),
    carbs: round((p.carbs || 0) * factor, 1),
    sodium: p.sodium == null ? null : round(p.sodium * factor, 1),
  }
}

/** Macros for exactly one serving of a food. */
export function servingMacros(food) {
  return computeMacros(food, 1, 'serving')
}

export function addTotals(a, b) {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    fat: a.fat + b.fat,
    carbs: a.carbs + b.carbs,
  }
}

/**
 * Sum a day's entries.
 * Reads `computed`, never recomputes from the food — the snapshot is the point.
 */
export function sumEntries(entries) {
  return entries.reduce((acc, e) => addTotals(acc, e.computed || emptyTotals()), emptyTotals())
}

/** Per-100 values from per-serving values. Used by the custom-food toggle. */
export function perServingToPer100(values, servingSize) {
  const size = Number(servingSize) || 0
  if (size <= 0) return { kcal: 0, protein: 0, fat: 0, carbs: 0, sodium: null }
  const f = 100 / size
  return {
    kcal: round((Number(values.kcal) || 0) * f, 2),
    protein: round((Number(values.protein) || 0) * f, 2),
    fat: round((Number(values.fat) || 0) * f, 2),
    carbs: round((Number(values.carbs) || 0) * f, 2),
    sodium: values.sodium == null || values.sodium === '' ? null : round(Number(values.sodium) * f, 2),
  }
}

export function per100ToPerServing(per100, servingSize) {
  const f = (Number(servingSize) || 0) / 100
  return {
    kcal: round((per100.kcal || 0) * f, 1),
    protein: round((per100.protein || 0) * f, 1),
    fat: round((per100.fat || 0) * f, 1),
    carbs: round((per100.carbs || 0) * f, 1),
    sodium: per100.sodium == null ? null : round(per100.sodium * f, 1),
  }
}

/**
 * Spec 9: flag anything that looks wrong on ingest rather than trusting it.
 * These are warnings shown to the user, never silent rejections — Open Food
 * Facts is crowdsourced and "looks wrong" is sometimes just an unusual food.
 */
export function sanityCheck(per100, unit = 'g') {
  const warnings = []
  if (unit === 'item') return warnings // "per 100 items" has no physical ceiling

  const { kcal = 0, protein = 0, fat = 0, carbs = 0 } = per100 || {}
  for (const [key, label] of [
    ['protein', 'Protein'],
    ['fat', 'Fat'],
    ['carbs', 'Carbs'],
  ]) {
    if ((per100?.[key] || 0) > 100) {
      warnings.push(`${label} is over 100 g per 100 ${unit}, which is not possible.`)
    }
  }
  const mass = protein + fat + carbs
  if (mass > 105) {
    warnings.push(`Protein, fat and carbs add up to ${Math.round(mass)} g per 100 ${unit}.`)
  }
  if (kcal > 950) {
    warnings.push(`${Math.round(kcal)} cal per 100 ${unit} is higher than pure fat.`)
  }
  const derived = kcalFromMacros({ protein, fat, carbs })
  // Label rounding explains small gaps; 25% and 50 cal apart does not.
  if (kcal > 0 && derived > 0 && Math.abs(derived - kcal) > Math.max(50, kcal * 0.25)) {
    warnings.push(
      `Calories (${Math.round(kcal)}) do not match the macros (${Math.round(derived)}).`
    )
  }
  if (kcal === 0 && mass > 0) {
    warnings.push('Calories are missing but macros are present.')
  }
  return warnings
}

/**
 * How many of the last seven days have to be tracked before the app is willing
 * to call anything an average.
 *
 * Four. Below that the mean is dominated by whichever days happen to be in it —
 * one partial day reads as a 1600-calorie deficit at a glance when it is
 * actually one lunch and no dinner.
 */
export const AVERAGES_MIN_DAYS = 4

/**
 * What separates a day someone stopped logging from a day they ate lightly.
 *
 * Nothing in the data says which is which, so this asks for TWO signals to agree
 * before writing a day off, because either alone gets it wrong in a way that
 * matters. Calories alone would discard a real fast; period count alone would
 * discard a single large meal that was genuinely the whole day.
 *
 * Both are guesses, and they are constants rather than inline numbers so they
 * can be argued with. A day is partial when it is confined to fewer than two of
 * the three periods AND lands under 60% of the calorie target.
 */
export const PARTIAL_DAY_KCAL_FRACTION = 0.6
export const PARTIAL_DAY_MIN_PERIODS = 2

/** Untracked days are not partial — they are absent, and counted separately. */
export function isPartialDay(day, targets) {
  const entries = day.entries || []
  if (!entries.length) return false
  const periods = new Set(entries.map((e) => e.block)).size
  const target = Number(targets?.kcal) || 0
  if (target <= 0) return false
  const low = (day.totals?.kcal || 0) < target * PARTIAL_DAY_KCAL_FRACTION
  return periods < PARTIAL_DAY_MIN_PERIODS && low
}

/**
 * The weekly read, or an admission that there isn't one yet.
 *
 * `kcal` and `protein` come back as null below the threshold rather than as
 * numbers the caller is trusted not to render. A wrong number presented
 * confidently is worse than no number, and the only way to guarantee the screen
 * cannot show one is to not hand it over.
 *
 * **Partial days are excluded from the mean and counted in the return.** A day
 * with breakfast on it and nothing after is not a 400-calorie day, and averaging
 * it in produces a deficit that never happened — quietly, and worse every week
 * it repeats. Excluding it silently would be the same failure wearing better
 * numbers, which is why `complete` and `partial` both come back: every caller is
 * expected to state what the average is drawn from.
 */
export function weeklyAverages(days, targets, minDays = AVERAGES_MIN_DAYS) {
  const recent = days.slice(0, 7)
  const tracked = recent.filter((d) => d.entries?.length)
  const complete = tracked.filter((d) => !isPartialDay(d, targets))
  const enough = complete.length >= minDays
  const mean = (key) =>
    complete.reduce((sum, d) => sum + (d.totals?.[key] || 0), 0) / complete.length

  return {
    tracked: tracked.length,
    complete: complete.length,
    partial: tracked.length - complete.length,
    of: 7,
    enough,
    kcal: enough ? mean('kcal') : null,
    protein: enough ? mean('protein') : null,
    fat: enough ? mean('fat') : null,
    carbs: enough ? mean('carbs') : null,
  }
}

/**
 * Progress of a value against a target. `pct` is clamped for the bar, `ratio`
 * is raw for anything that needs to know how far past target it went, and
 * `over` is **the whole number both marks print**.
 *
 * `over` rounds its operands and then differences them, rather than
 * differencing raw floats and rounding after. This is the same rule the ring's
 * centre already used, and it is here because the two marks disagreed.
 *
 * The chip took the raw difference and rounded it for display; the ring rounded
 * first. At 300.4 against a target of 300 the chip rendered `+0` — its guard
 * was on the raw 0.4, so a chip appeared to say nothing — while the ring read
 * `0g left`. One screen, one day, two answers, and neither of them `+0.4`,
 * which is the number they were actually arguing about.
 *
 * Rounding first is the reading that matches what is on screen. Both marks show
 * whole units, so the question they answer is "is the whole number I am showing
 * you past the whole number I am showing you it is against" — and that question
 * cannot be answered from operands the reader never sees. It also means `+0` is
 * now unreachable rather than guarded against: the value is a whole number, so
 * `over > 0` and `over` printing as non-zero are the same condition.
 *
 * This matters more than a stray chip. The ring's overage lap is drawn from
 * this figure, so a raw-float `over` would draw a notch on a ring whose own
 * centre says it is exactly on target.
 */
export function progress(value, target) {
  const t = Number(target) || 0
  const v = Number(value) || 0
  if (t <= 0) return { pct: 0, over: 0, ratio: 0 }
  const ratio = v / t
  return {
    pct: Math.min(100, ratio * 100),
    over: Math.max(0, Math.round(v) - Math.round(t)),
    ratio,
  }
}
