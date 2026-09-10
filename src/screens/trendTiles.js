import { h, s } from '../lib/dom.js'
import { trendTile } from '../lib/trendTile.js'
import { tnum, macroColor, macroTextColor } from '../lib/ui.js'
import { macroRing } from '../lib/ring.js'
import { AVERAGES_MIN_DAYS, isPartialDay } from '../lib/compute.js'
import { kcal as fmtKcal } from '../lib/format.js'
import { formatDayShort, fromDateStr } from '../lib/dates.js'

/**
 * The tiles on the Trends grid. Each is a function of the data the screen
 * already loads and nothing else; the screen decides the order and the grid
 * decides the layout.
 *
 * **Every figure states its denominator**, the rule `averagesStrip` held
 * before these replaced it. Under the threshold a tile shows the count of
 * full days rather than a mean of too few, and the calorie bars show which
 * days that count is made of.
 */

const caption = (text) => h('span', { class: 'text-[12px] leading-snug text-muted' }, text)

/** The `4 of 7` figure every tile falls back to under the threshold. */
function notEnough(week) {
  const remaining = AVERAGES_MIN_DAYS - week.complete
  return h(
    'div',
    { class: 'flex flex-col gap-[4px]' },
    h(
      'div',
      { class: 'flex items-baseline gap-[6px]' },
      tnum(`${week.complete} of ${week.of}`, 'text-title font-semibold'),
      caption('full days logged'),
    ),
    caption(`Averages start at ${AVERAGES_MIN_DAYS} full days, with ${remaining} more to go.`),
  )
}

/* -------------------------------------------------------------- calories */

const CHART_W = 350
const CHART_H = 120
const VALUE_ROOM = 18
const LABEL_ROOM = 18
const BAR_W = 22
const BAR_R = 6

/**
 * Seven bars, oldest on the left, with the day's total above each one and a
 * dashed line at the week's mean.
 *
 * A day that did not count for the mean is drawn so it says so: a partial day
 * is the bar's own track at 20%, the same "labelled but empty" treatment the
 * rings use, and it carries no value because the value is the reason it was
 * left out. An untracked day is a label with nothing above it. The mean is
 * drawn only when there is one; a dashed line through four bars and three
 * gaps would be asserting a number the tile has just declined to state.
 */
function caloriesChart(days, targets, mean) {
  const plotH = CHART_H - VALUE_ROOM - LABEL_ROOM
  const slot = CHART_W / days.length
  const values = days.map((d) => (d.entries?.length ? d.totals.kcal : 0))
  const max = Math.max(...values, mean || 0, 1)
  const y = (v) => VALUE_ROOM + plotH - (v / max) * plotH
  const floor = VALUE_ROOM + plotH

  const marks = days.flatMap((day, i) => {
    const x = i * slot + (slot - BAR_W) / 2
    const cx = x + BAR_W / 2
    const label = s(
      'text',
      { x: cx, y: CHART_H - 4, 'text-anchor': 'middle', class: 'chart-label' },
      fromDateStr(day.date).toLocaleDateString(undefined, { weekday: 'short' }),
    )
    if (!day.entries?.length) return [label]

    const partial = isPartialDay(day, targets)
    const top = y(values[i])
    const bar = s('rect', {
      x,
      y: top,
      width: BAR_W,
      height: Math.max(BAR_R * 2, floor - top),
      rx: BAR_R,
      fill: partial ? `color-mix(in srgb, ${macroColor('kcal')} 20%, transparent)` : macroColor('kcal'),
    })
    if (partial) return [bar, label]
    const value = s(
      'text',
      { x: cx, y: top - 6, 'text-anchor': 'middle', class: 'tnum chart-value' },
      fmtKcal(values[i]),
    )
    return [bar, value, label]
  })

  const meanLine =
    mean == null
      ? null
      : s('line', {
          x1: 0,
          x2: CHART_W,
          y1: y(mean),
          y2: y(mean),
          class: 'chart-mean',
        })

  return s(
    'svg',
    {
      viewBox: `0 0 ${CHART_W} ${CHART_H}`,
      class: 'w-full',
      role: 'img',
      'aria-label': 'Calories by day, last seven days',
    },
    ...marks,
    meanLine,
  )
}

export function caloriesTile({ days, week, targets, onPress }) {
  const recent = days.slice(0, 7).reverse()
  const range = `${formatDayShort(recent[0].date)} to ${formatDayShort(recent[recent.length - 1].date)}`

  const headline = week.enough
    ? h(
        'div',
        { class: 'flex flex-col gap-[2px]' },
        h(
          'div',
          { class: 'flex items-baseline gap-[6px]' },
          tnum(fmtKcal(week.kcal), 'text-title font-semibold'),
          h(
            'span',
            { class: 'text-[14px] font-semibold', style: { color: macroTextColor('kcal') } },
            'cal',
          ),
          caption('average'),
        ),
        caption(
          week.partial > 0
            ? `${range} · ${week.partial} partial left out`
            : range,
        ),
      )
    : notEnough(week)

  return trendTile(
    { id: 'calories', title: 'Calories', size: 'full', onPress },
    headline,
    caloriesChart(recent, targets, week.kcal),
  )
}

/* -------------------------------------------------- streak, consistency */

function bigNumber(value, label) {
  return h(
    'div',
    { class: 'flex flex-col gap-[4px]' },
    tnum(value, 'text-display font-semibold'),
    caption(label),
  )
}

export function streakTile(n) {
  return trendTile(
    { id: 'streak', title: 'Streak', size: 'half' },
    bigNumber(String(n), n === 1 ? 'full day in a row' : 'full days in a row'),
  )
}

export function consistencyTile({ pct, logged, of }) {
  return trendTile(
    { id: 'consistency', title: 'Consistency', size: 'half' },
    bigNumber(`${pct}%`, `${logged} of ${of} days full`),
  )
}

/* ---------------------------------------------------------------- macros */

/**
 * Today's own rings, reading the week's mean against the target. Same size,
 * same hue, same second lap past target, so the mark on Trends is the mark on
 * Today with a different number in it and nothing to relearn. `key` is
 * prefixed so these three do not share the live card's arc memory.
 */
export function macrosTile({ week, targets, onPress }) {
  const body = week.enough
    ? h(
        'div',
        { class: 'flex justify-between' },
        ...['protein', 'fat', 'carbs'].map((macro) =>
          macroRing({
            macro,
            value: week[macro],
            target: targets[macro],
            key: `avg:${macro}`,
          }),
        ),
      )
    : notEnough(week)

  return trendTile({ id: 'macros', title: 'Macros', size: 'full', onPress }, body)
}
