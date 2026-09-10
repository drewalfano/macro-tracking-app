/**
 * Dates are stored as local 'YYYY-MM-DD' strings, never UTC timestamps.
 * A log entry belongs to the day the user was living in, not the day UTC was
 * having. This module is the only place that knows how to cross that boundary.
 */

export const BLOCKS = ['morning', 'afternoon', 'night']

export function toDateStr(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayStr() {
  return toDateStr(new Date())
}

/** Local midnight for a 'YYYY-MM-DD' string. */
export function fromDateStr(str) {
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(str, n) {
  const d = fromDateStr(str)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export function daysBetween(a, b) {
  return Math.round((fromDateStr(b) - fromDateStr(a)) / 86400000)
}

/** Descending list of date strings ending at `end` (inclusive). */
export function lastNDays(n, end = todayStr()) {
  return Array.from({ length: n }, (_, i) => addDays(end, -i))
}

export function isFuture(str) {
  return str > todayStr()
}

export function isToday(str) {
  return str === todayStr()
}

/** "Today" / "Yesterday" / "Tue 29 July". Relative labels earn their place here. */
export function formatDayLabel(str) {
  const today = todayStr()
  if (str === today) return 'Today'
  if (str === addDays(today, -1)) return 'Yesterday'
  if (str === addDays(today, 1)) return 'Tomorrow'
  const d = fromDateStr(str)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  })
}

/**
 * Past this, a date stops answering the question and an age starts.
 *
 * A week is the mark because it is the span over which "Tue, Aug 4" is still
 * locatable without arithmetic — inside seven days it is this week or last, and
 * the weekday does the work. Beyond it the reader has to count, and what they
 * are counting for is not the date at all but how stale the number above it is.
 */
export const STALE_AFTER_DAYS = 7

/**
 * The day, or how long ago it was once the day stops being the useful fact.
 *
 * `Latest 164.6 lb / Tue, Aug 4` reads as a current weight with a date beside
 * it, and at nine days old it is not one. The figure is stated at display size
 * with nothing qualifying it, so the line underneath is the only thing that can
 * say how much to trust it, and a bare date makes the reader work that out.
 *
 * One format past the threshold, deliberately — no second step into weeks or
 * months. `41 days ago` is blunter than "6 weeks ago" and that is the point:
 * this line exists to report staleness, and rounding it into friendlier units
 * softens exactly the fact it is there to carry.
 */
export function formatDayAge(str) {
  const age = daysBetween(str, todayStr())
  if (age <= STALE_AFTER_DAYS) return formatDayLabel(str)
  return `${age} days ago`
}

/**
 * A day label that can sit mid-sentence: "remove today's weight", "saved
 * Tue, 28 Jul".
 *
 * `formatDayLabel` returns either a relative word or a real date, and only the
 * first of those may be lowercased. Calling `.toLowerCase()` on the result
 * blindly turns "Tue, 28 Jul" into "tue, 28 jul", which is how it first shipped.
 */
const RELATIVE_LABELS = new Set(['Today', 'Yesterday', 'Tomorrow'])

export function dayPhrase(str) {
  const label = formatDayLabel(str)
  return RELATIVE_LABELS.has(label) ? label.toLowerCase() : label
}

/**
 * The Today page header: "Today, Jul 31".
 *
 * Relative days carry the short date alongside the word, because "Today" alone
 * tells you nothing about where you are once you have paged away and back.
 * Every other day is already a date, so it does not get one twice.
 */
export function formatDayHeader(str) {
  const label = formatDayLabel(str)
  if (label !== 'Today' && label !== 'Yesterday' && label !== 'Tomorrow') return label
  const short = fromDateStr(str).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
  return `${label}, ${short}`
}

/**
 * `29 Jul` — a day with the weekday and the year taken off.
 *
 * For a date that has to fit a fixed slot rather than a line of text. The
 * duplicate sheet's day picker is the case: it is a `segmentedWide`, so its
 * options divide the row evenly, and a fourth segment leaves each label 78.75px
 * at 375pt — measured, with the track at 335. `formatDayLabel` does not fit
 * that: `Wed 12 Aug` sets 83.8 of ink and a dated one carrying its year sets
 * 115.2, and `.segment` does not clip, so the label would sit across its
 * neighbour. This sets 52.
 *
 * The weekday is what goes, and it is the right thing to lose in a row of days:
 * the segments are consecutive and one of them is named Today, so the weekday
 * is the part the reader can already infer from position. The year goes with it
 * — every caller is offering a day near the one you are looking at, not
 * locating an arbitrary one.
 */
export function formatDayShort(str) {
  return fromDateStr(str).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The muted line under the screen title: "Tuesday, 29 July". */
export function formatDateSub(str) {
  const d = fromDateStr(str)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
  })
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Which block a new entry lands in, from the clock.
 * Thresholds are user-editable in settings, hence the argument.
 */
export function blockForTime(date = new Date(), thresholds = { afternoon: 12, night: 17 }) {
  const hour = date.getHours()
  if (hour < thresholds.afternoon) return 'morning'
  if (hour < thresholds.night) return 'afternoon'
  return 'night'
}

/**
 * A day's entries in the order the day happened: by block, then by the
 * clock within the block.
 *
 * It was the clock alone, which put a breakfast logged at 3pm under dinner:
 * `createdAt` is when Log was tapped, and the block is when it was eaten,
 * and the block is the one the person chose. A row with no block sorts
 * last, after the three that have one.
 */
export function byBlockThenTime(a, b) {
  const ai = BLOCKS.indexOf(a.block)
  const bi = BLOCKS.indexOf(b.block)
  const ao = ai < 0 ? BLOCKS.length : ai
  const bo = bi < 0 ? BLOCKS.length : bi
  if (ao !== bo) return ao - bo
  return (a.createdAt || 0) - (b.createdAt || 0)
}

/**
 * What a logged row says about when: the clock if it agrees with the block,
 * the block's name if it does not.
 *
 * The clock is the moment Log was tapped. It reads as "when I ate this"
 * only while it lands in the block the row was filed under; log the
 * morning's oats at 3pm and `3:03 PM` under a Morning entry asserts a time
 * nobody meant. So the row falls back to the word that was chosen. Same
 * for a day logged ahead. A time field was considered and turned down:
 * nothing in the app computes on the minute.
 */
export function entryWhen(entry, settings) {
  const i = BLOCKS.indexOf(entry.block)
  if (i < 0 || !entry.createdAt) return formatTime(entry.createdAt)
  const stamped = blockForTime(new Date(entry.createdAt), settings?.blockThresholds)
  if (stamped === entry.block) return formatTime(entry.createdAt)
  return settings?.blockNames?.[i] ?? entry.block
}
