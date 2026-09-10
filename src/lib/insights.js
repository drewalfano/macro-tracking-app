import { isPartialDay } from './compute.js'
import { fromDateStr } from './dates.js'
import { stripBrand } from './format.js'

/**
 * The reads behind the Trends pages. Pure: `days` is newest first with
 * today at index 0, the shape `loadDays` returns, and every function states
 * its denominator in what it hands back. A number without its basis is the
 * thing these pages exist not to show.
 */

/** 'full', 'partial' or 'none'. Same rule the averages and the streak use. */
export function dayState(day, targets) {
  if (!day.entries?.length) return 'none'
  return isPartialDay(day, targets) ? 'partial' : 'full'
}

/** Monday first, the way a week is read. `getDay()` is Sunday first. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const weekdayIndex = (date) => (fromDateStr(date).getDay() + 6) % 7

/**
 * Per weekday: how many of that weekday fell in the window, how many were
 * full, and the mean calories over the full ones. `kcal` is null with no
 * full day to draw it from, never zero.
 */
export function weekdayStats(days, targets) {
  const rows = WEEKDAYS.map((label) => ({ label, of: 0, full: 0, kcalSum: 0 }))
  for (const day of days) {
    const row = rows[weekdayIndex(day.date)]
    row.of++
    if (dayState(day, targets) === 'full') {
      row.full++
      row.kcalSum += day.totals?.kcal || 0
    }
  }
  return rows.map(({ label, of, full, kcalSum }) => ({
    label,
    of,
    full,
    kcal: full ? kcalSum / full : null,
  }))
}

/**
 * Rolling weeks back from today: days 0 to 6, 7 to 13, and so on. Each
 * carries its own count of full days and a mean over them, or null.
 */
export function weeklyMeans(days, targets, weeks = 4) {
  const out = []
  for (let w = 0; w < weeks; w++) {
    const chunk = days.slice(w * 7, w * 7 + 7)
    if (!chunk.length) break
    const full = chunk.filter((d) => dayState(d, targets) === 'full')
    const mean = (key) => full.reduce((s, d) => s + (d.totals?.[key] || 0), 0) / full.length
    out.push({
      start: chunk[chunk.length - 1].date,
      end: chunk[0].date,
      complete: full.length,
      of: chunk.length,
      kcal: full.length ? mean('kcal') : null,
      protein: full.length ? mean('protein') : null,
    })
  }
  return out
}

/**
 * Days that met a macro's target, out of the full days in the window. A
 * partial day cannot meet or miss a target it never had the chance at, so
 * it is outside the denominator, not a miss.
 */
export function targetHits(days, targets, macro) {
  const full = days.filter((d) => dayState(d, targets) === 'full')
  const goal = Number(targets?.[macro]) || 0
  const hit = goal > 0 ? full.filter((d) => (d.totals?.[macro] || 0) >= goal).length : 0
  return { hit, of: full.length }
}

/**
 * The foods that contributed most of `key` over the window, by name, with
 * each one's share of the total. Counts every tracked day, partial ones
 * included: a source is a source whether or not the day was complete.
 */
export function topSources(days, key, n = 5) {
  const byName = new Map()
  let total = 0
  for (const day of days) {
    for (const e of day.entries || []) {
      const amount = e.computed?.[key] || 0
      if (!(amount > 0)) continue
      const name = stripBrand(e.foodName, e.brand) || 'Deleted food'
      const row = byName.get(name) || { name, amount: 0, times: 0 }
      row.amount += amount
      row.times++
      byName.set(name, row)
      total += amount
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n)
    .map((r) => ({ ...r, share: total ? r.amount / total : 0 }))
}
