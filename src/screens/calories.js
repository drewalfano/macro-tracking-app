import { h, repaint } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import { getSettings } from '../lib/db.js'
import { loadDays } from '../lib/days.js'
import { weekdayStats, weeklyMeans, dayState } from '../lib/insights.js'
import { dayBars } from '../lib/bars.js'
import { trendsPage } from '../lib/trendTile.js'
import { card, tnum, segmentedWide, macroTextColor } from '../lib/ui.js'
import { kcal as fmtKcal } from '../lib/format.js'
import { formatDayShort } from '../lib/dates.js'
import { navigate } from '../router.js'

let range = 30 // module-level so the switch survives a re-render

/**
 * Calories, one level under Trends.
 *
 * Every day against the target over 30 or 90 days, then the last four
 * weeks as means, then the mean by weekday. The tile's seven bars answer
 * "this week"; this answers "is it a pattern", and the weekday table is
 * where the pattern usually is.
 *
 * No energy-balance estimate. Expected loss from a deficit needs a
 * maintenance figure the app does not have, and a chart drawn on a guess
 * would be asserting more than the data supports.
 */
export function caloriesScreen() {
  return createScreen(
    async () => {
      const [settings, days] = await Promise.all([getSettings(), loadDays(89)])
      const target = settings.targets.kcal
      const chartSlot = h('div')

      const draw = () => {
        const window = days.slice(0, range)
        const full = window.filter((d) => dayState(d, settings.targets) === 'full')
        const mean = full.length ? full.reduce((s, d) => s + d.totals.kcal, 0) / full.length : null
        repaint(
          chartSlot,
          h(
            'div',
            { class: 'day-card flex flex-col gap-[16px]' },
            h(
              'div',
              { class: 'flex flex-col gap-[2px]' },
              h(
                'div',
                { class: 'flex items-baseline gap-[6px]' },
                tnum(mean == null ? '—' : fmtKcal(mean), 'text-title font-semibold'),
                h('span', { class: 'text-[14px] font-semibold', style: { color: macroTextColor('kcal') } }, 'cal'),
                h('span', { class: 'text-[12px] text-muted' }, 'average'),
              ),
              h(
                'span',
                { class: 'text-[12px] leading-snug text-muted' },
                `${full.length} full days of the last ${range} · target ${fmtKcal(target)}`,
              ),
            ),
            dayBars({ days: window, key: 'kcal', target, targets: settings.targets }),
          ),
        )
      }
      draw()

      const rangeRow = segmentedWide({
        options: [
          { value: 30, label: '30 days' },
          { value: 90, label: '90 days' },
        ],
        value: range,
        onChange: (v) => {
          range = v
          draw()
        },
      })

      const weeks = weeklyMeans(days, settings.targets, 4).map((w) =>
        h(
          'div',
          { class: 'row justify-between' },
          h(
            'div',
            { class: 'flex flex-col' },
            h('span', { class: 'text-[16px] font-semibold' }, `${formatDayShort(w.start)} to ${formatDayShort(w.end)}`),
            h('span', { class: 'text-[12px] text-muted' }, `${w.complete} of ${w.of} full days`),
          ),
          w.kcal == null
            ? h('span', { class: 'text-[14px] text-muted' }, '—')
            : h(
                'span',
                { class: 'flex items-baseline gap-[3px]' },
                tnum(fmtKcal(w.kcal), 'text-[16px] font-semibold'),
                h('span', { class: 'text-[12px] font-semibold', style: { color: macroTextColor('kcal') } }, 'cal'),
              ),
        ),
      )

      const weekdays = weekdayStats(days.slice(0, range), settings.targets).map((r) =>
        h(
          'div',
          { class: 'row justify-between' },
          h(
            'div',
            { class: 'flex flex-col' },
            h('span', { class: 'text-[16px] font-semibold' }, r.label),
            h('span', { class: 'text-[12px] text-muted' }, `${r.full} full ${r.full === 1 ? 'day' : 'days'}`),
          ),
          r.kcal == null
            ? h('span', { class: 'text-[14px] text-muted' }, '—')
            : h(
                'span',
                { class: 'flex items-baseline gap-[3px]' },
                tnum(fmtKcal(r.kcal), 'text-[16px] font-semibold'),
                h('span', { class: 'text-[12px] font-semibold', style: { color: macroTextColor('kcal') } }, 'cal'),
              ),
        ),
      )

      return trendsPage(
        { title: 'Calories', onBack: () => navigate('trends') },
        h('div', { class: 'flex flex-col gap-[10px]' }, chartSlot, rangeRow),
        section('By week', card(weeks)),
        section('By weekday', card(weekdays)),
      )
    },
    { watch: ['entries', 'settings'], watchDate: false },
  )
}

const section = (title, body) =>
  h('section', { class: 'flex flex-col gap-[10px]' }, h('div', { class: 'section-title' }, title), body)
