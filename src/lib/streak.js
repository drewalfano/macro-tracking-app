import { isPartialDay } from './compute.js'

/**
 * Showing up, counted two ways. Both use the same rule for what a day is:
 * tracked and not partial, the rule `weeklyAverages` already applies. A
 * breakfast and nothing after is not a day, and a mark that counted it would
 * be cheaper to earn than the average it sits beside.
 *
 * `days` is newest first with today at index 0, the shape `loadDays` returns.
 */

const full = (day, targets) => !!day.entries?.length && !isPartialDay(day, targets)

/**
 * Consecutive full days, counted back from today.
 *
 * **Today does not break a streak it has not had a chance to join.** At 9am
 * with nothing logged the run is whatever it was last night, so an unlogged
 * today is skipped rather than counted as a miss. A logged today is counted.
 * Yesterday gets no such grace: the day is over, and if it is empty the run
 * ended there.
 */
export function streak(days, targets) {
  if (!days?.length) return 0
  let i = 0
  if (!full(days[0], targets)) i = 1
  let n = 0
  for (; i < days.length; i++) {
    if (!full(days[i], targets)) break
    n++
  }
  return n
}

/**
 * Full days as a share of the window, whole percent.
 *
 * The denominator is the window, not the days that exist. Someone three days
 * in has logged three of thirty, and reporting 100% would be the same lie as
 * a one-day average. The count comes back too so the caller can say what the
 * percentage is of.
 */
export function consistency(days, targets, window = 30) {
  const recent = (days || []).slice(0, window)
  const logged = recent.filter((d) => full(d, targets)).length
  return { logged, of: window, pct: Math.round((logged / window) * 100) }
}
