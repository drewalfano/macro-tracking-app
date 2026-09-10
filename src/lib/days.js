import { entriesInRange } from './db.js'
import { sumEntries } from './compute.js'
import { addDays, todayStr } from './dates.js'

/**
 * The last N days as `{ date, entries, totals }`, newest first, with today
 * at index 0. One shape for every screen that reads history, so the tiles,
 * the calendar and the charts all count the same days the same way.
 */
export async function loadDays(span) {
  const today = todayStr()
  const start = addDays(today, -span)
  const all = await entriesInRange(start, today)
  const byDate = new Map()
  for (const entry of all) {
    if (!byDate.has(entry.date)) byDate.set(entry.date, [])
    byDate.get(entry.date).push(entry)
  }
  return Array.from({ length: span + 1 }, (_, i) => {
    const date = addDays(today, -i)
    const entries = byDate.get(date) || []
    return { date, entries, totals: sumEntries(entries) }
  })
}
