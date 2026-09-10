import { h, s } from '../lib/dom.js'
import { trendTile } from '../lib/trendTile.js'
import { tnum, macroColor, macroTextColor } from '../lib/ui.js'
import { macroRing } from '../lib/ring.js'
import { AVERAGES_MIN_DAYS, isPartialDay, MACRO_META } from '../lib/compute.js'
import { kcal as fmtKcal, g } from '../lib/format.js'
import { formatDayShort, formatDayAge, fromDateStr } from '../lib/dates.js'
import { kgToUnit, weight as fmtWeight, signed } from '../lib/format.js'
import { computeTrend, ratePerWeek, windowPoints, MIN_ENTRIES_FOR_TREND } from '../lib/trend.js'
import { openTodayWeightSheet } from '../sheets/weighIn.js'

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

/**
 * Sizes, not contents. Small is the reading alone on a half tile, Large is
 * the whole tile; Medium, where a tile has one, is the full width without
 * the list. The words are Apple's widget sizes because that is the mental
 * model: the same thing at three sizes, showing more as it grows.
 */
export const SIZES = {
  small: { value: 'small', label: 'Small' },
  medium: { value: 'medium', label: 'Medium' },
  large: { value: 'large', label: 'Large' },
}
export const CALORIES_VARIANTS = [SIZES.small, SIZES.large]

/** Large is the bars; Small is the mean alone on a half tile. */
export function caloriesTile({ days, week, targets, onPress, edit = {} }) {
  const variant = edit.variant || 'large'
  const chart = variant === 'large'
  const recent = days.slice(0, 7).reverse()
  const range = `${formatDayShort(recent[0].date)} to ${formatDayShort(recent[recent.length - 1].date)}`
  const basis = week.partial > 0 ? `${range} · ${week.partial} partial left out` : range

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
          chart ? caption('average') : null,
        ),
        caption(chart ? basis : `average, ${week.complete} full days`),
      )
    : notEnough(week)

  return trendTile(
    {
      id: 'calories',
      title: 'Calories',
      size: chart ? 'full' : 'half',
      onPress,
      variants: CALORIES_VARIANTS,
      ...edit,
      variant,
    },
    headline,
    chart ? caloriesChart(recent, targets, week.kcal) : null,
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

export function streakTile(n, edit = {}) {
  return trendTile(
    { id: 'streak', title: 'Streak', size: 'half', ...edit },
    bigNumber(String(n), n === 1 ? 'full day in a row' : 'full days in a row'),
  )
}

export function consistencyTile({ pct, logged, of }, edit = {}) {
  return trendTile(
    { id: 'consistency', title: 'Consistency', size: 'half', ...edit },
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
export const MACROS_VARIANTS = [SIZES.small, SIZES.large]

export function macrosTile({ week, targets, onPress, edit = {} }) {
  const variant = edit.variant || 'large'
  const rings = variant === 'large'

  /** One line per macro: the letter and unit in the hue, the number in ink. */
  const line = (macro) =>
    h(
      'div',
      { class: 'flex items-baseline gap-[6px]' },
      h(
        'span',
        { class: 'w-[14px] text-[12px] font-semibold', style: { color: macroTextColor(macro) } },
        MACRO_META[macro].letter,
      ),
      tnum(g(week[macro]), 'text-[20px] font-semibold'),
      h('span', { class: 'text-[12px] font-semibold', style: { color: macroTextColor(macro) } }, 'g'),
    )

  const body = !week.enough
    ? notEnough(week)
    : rings
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
      : h(
          'div',
          { class: 'flex flex-col gap-[4px]' },
          ...['protein', 'fat', 'carbs'].map(line),
          caption(`average, ${week.complete} full days`),
        )

  return trendTile(
    {
      id: 'macros',
      title: 'Macros',
      size: rings ? 'full' : 'half',
      onPress,
      variants: MACROS_VARIANTS,
      ...edit,
      variant,
    },
    body,
  )
}

/* ---------------------------------------------------------------- weight */

const SPARK_W = 310
const SPARK_H = 44
const SPARK_PAD = 3
const SPARK_DAYS = 30

/**
 * The trend line over the last 30 days, and nothing else: no dots, no axis,
 * no grid. A sparkline is a shape, not a reading, and the reading is the
 * number beside it. Drawn only when the chart page would draw one, so the
 * tile cannot show a trend the page then declines to.
 */
function sparkline(points) {
  const ys = points.map((p) => p.trend).filter((v) => v != null)
  if (ys.length < 2) return null
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  const span = max - min || 1
  const coords = points
    .map((p, i) => (p.trend == null ? null : [i, p.trend]))
    .filter(Boolean)
    .map(([i, v]) => [
      SPARK_PAD + (i / (points.length - 1)) * (SPARK_W - 2 * SPARK_PAD),
      SPARK_PAD + (1 - (v - min) / span) * (SPARK_H - 2 * SPARK_PAD),
    ])
  const last = coords[coords.length - 1]
  return s(
    'svg',
    /**
     * Full width and a fixed height. The box stretches to the tile and the
     * drawing stretches with it, which is fine for a shape with no axis, and
     * `non-scaling-stroke` keeps the line 2px however far it is stretched.
     */
    {
      viewBox: `0 0 ${SPARK_W} ${SPARK_H}`,
      preserveAspectRatio: 'none',
      class: 'w-full',
      style: { height: `${SPARK_H}px` },
      'aria-hidden': 'true',
    },
    s('polyline', {
      points: coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
      fill: 'none',
      stroke: 'var(--color-ink)',
      'stroke-width': 2,
      'vector-effect': 'non-scaling-stroke',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
    // The end bead would stretch with the box, so it is a stroke of zero
    // length with a round cap: the cap does not scale.
    s('polyline', {
      points: `${last[0].toFixed(1)},${last[1].toFixed(1)} ${last[0].toFixed(1)},${last[1].toFixed(1)}`,
      fill: 'none',
      stroke: 'var(--color-ink)',
      'stroke-width': 6,
      'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke',
    }),
  )
}

/**
 * Latest reading, the rate over the chart's default window, a sparkline, the
 * last three weigh-ins and a button to add one. The button opens the same
 * sheet the chart page uses, so there is one way to log a weight and it is
 * reachable from the tile without leaving the grid.
 *
 * The rate and the line come with the chart's own gates: `ratePerWeek` is
 * null under seven readings or a fortnight of span, and then the chip is
 * simply absent rather than showing a dash. Under seven readings the sparkline
 * goes too and its place says how many readings there are.
 */
export const WEIGHT_VARIANTS = [SIZES.small, SIZES.medium, SIZES.large]

/**
 * Large is the whole tile; Medium drops the last three weigh-ins; Small is
 * a half tile with the reading, the rate and Log.
 *
 * **Log sits on the reading's own line, at the right.** It is the tile's one
 * action and it belongs with the number it changes; under the list it read
 * as an afterthought and left a row of air around it. The sparkline takes the
 * full width beneath, which also makes the line legible.
 */
export function weightTile({ weights, settings, onPress, edit = {} }) {
  const variant = edit.variant || 'large'
  const half = variant === 'small'
  const tileOpts = {
    id: 'weight',
    title: 'Weight',
    size: half ? 'half' : 'full',
    onPress,
    variants: WEIGHT_VARIANTS,
    ...edit,
    variant,
  }

  const unit = settings.weightUnit
  const latest = weights[weights.length - 1] || null
  const points = windowPoints(computeTrend(weights, settings.trendWindow), SPARK_DAYS)
  const rate = ratePerWeek(points)
  const readings = points.filter((p) => p.kg != null).length
  const enough = weights.length >= MIN_ENTRIES_FOR_TREND

  /**
   * The app's small chip, the one Today uses for Full log. A filled pill on
   * this line outweighed the reading beside it; the tile's action is a way
   * in, not the point of the tile.
   */
  const logButton = h(
    'button',
    { class: 'chip-sm', type: 'button', onclick: () => openTodayWeightSheet() },
    'Log',
  )

  if (!latest) {
    return trendTile(
      tileOpts,
      h(
        'div',
        { class: 'flex items-center justify-between gap-[10px]' },
        caption('No weigh-ins yet. The trend appears after seven.'),
        logButton,
      ),
    )
  }

  const chip =
    rate == null
      ? null
      : h('span', { class: 'delta-chip tnum' }, `${signed(kgToUnit(rate, unit))} ${unit} / week`)

  const reading = h(
    'div',
    { class: 'flex min-w-0 flex-col gap-[6px]' },
    h(
      'div',
      { class: 'flex items-baseline gap-[4px]' },
      tnum(fmtWeight(latest.kg, unit), 'text-title font-semibold'),
      h('span', { class: 'text-[14px] font-medium text-muted' }, unit),
    ),
    chip,
  )

  const spark = enough
    ? sparkline(points)
    : h(
        'div',
        { class: 'flex items-baseline gap-[6px]' },
        tnum(`${readings} of ${MIN_ENTRIES_FOR_TREND}`, 'text-[16px] font-semibold'),
        caption('weigh-ins before the trend line'),
      )

  const row = (entry, i) =>
    h(
      'div',
      { class: `flex items-center justify-between py-[8px] ${i ? 'hairline' : ''}` },
      h('span', { class: 'text-[14px] text-muted' }, formatDayAge(entry.date)),
      h(
        'span',
        { class: 'flex items-baseline gap-[3px]' },
        tnum(fmtWeight(entry.kg, unit), 'text-[14px] font-semibold'),
        h('span', { class: 'text-[12px] font-medium text-muted' }, unit),
      ),
    )

  if (half) {
    return trendTile(
      tileOpts,
      h('div', { class: 'flex flex-col gap-[10px]' }, reading, h('div', { class: 'flex' }, logButton)),
    )
  }

  return trendTile(
    tileOpts,
    h('div', { class: 'flex items-center justify-between gap-[10px]' }, reading, logButton),
    spark,
    variant === 'large'
      ? h('div', { class: 'flex flex-col' }, ...weights.slice(-3).reverse().map(row))
      : null,
  )
}
