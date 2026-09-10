import { s } from './dom.js'
import { macroColor } from './ui.js'
import { dayState } from './insights.js'
import { formatDayShort } from './dates.js'

const W = 340
const H = 150
const TOP = 10
const BOTTOM = 18
// A gutter at the right for the target figure, so the label sits at the end
// of its own line and never over a bar. It was above the line at the left,
// and the first bars of the window drew straight through it.
const RIGHT = 40

/**
 * One bar per day against a dashed target line, for any span the pages
 * ask for. Values are not labelled: at thirty bars a label per bar is a
 * wall of digits, and the target line and the height say the thing that
 * matters, which is over or under and by roughly how much.
 *
 * Same honesty as the tile's seven bars: a partial day is drawn as track,
 * an untracked day as a gap, and the axis is the data plus the target so
 * the target line always lands inside the box.
 */
export function dayBars({ days, key, target, targets }) {
  const ordered = [...days].reverse() // oldest on the left
  const n = ordered.length
  const plotH = H - TOP - BOTTOM
  const slot = (W - RIGHT) / n
  const barW = Math.max(3, Math.min(14, slot * 0.6))
  const max = Math.max(...ordered.map((d) => d.totals?.[key] || 0), target || 0, 1)
  const y = (v) => TOP + plotH - (v / max) * plotH
  const floor = TOP + plotH

  const bars = ordered.flatMap((day, i) => {
    const state = dayState(day, targets)
    if (state === 'none') return []
    const v = day.totals?.[key] || 0
    const x = i * slot + (slot - barW) / 2
    const top = y(v)
    return [
      s('rect', {
        x: x.toFixed(1),
        y: top.toFixed(1),
        width: barW.toFixed(1),
        height: Math.max(barW, floor - top).toFixed(1),
        rx: (barW / 2).toFixed(1),
        fill:
          state === 'partial'
            ? `color-mix(in srgb, ${macroColor(key)} 20%, transparent)`
            : macroColor(key),
      }),
    ]
  })

  // Three date labels: first, middle, last. Enough to place the span.
  const labels = [0, Math.floor((n - 1) / 2), n - 1].map((i, k) =>
    s(
      'text',
      {
        x: (i * slot + slot / 2).toFixed(1),
        y: H - 4,
        'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle',
        class: 'chart-label',
      },
      formatDayShort(ordered[i].date),
    ),
  )

  const targetLine =
    target > 0
      ? [
          s('line', { x1: 0, x2: W - RIGHT, y1: y(target), y2: y(target), class: 'chart-mean' }),
          // The figure alone, in the gutter, centred on the line. The word
          // is in the caption above the chart, where there is room for it.
          s(
            'text',
            { x: W, y: y(target), dy: 4, 'text-anchor': 'end', class: 'chart-label' },
            String(Math.round(target)),
          ),
        ]
      : []

  return s(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, class: 'w-full', role: 'img', 'aria-label': `${key} by day` },
    ...bars,
    ...targetLine,
    ...labels,
  )
}
