import { h } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import { getSettings } from '../lib/db.js'
import { loadDays } from '../lib/days.js'
import { dayState, weekdayStats, WEEKDAYS } from '../lib/insights.js'
import { trendsPage } from '../lib/trendTile.js'
import { card, tnum } from '../lib/ui.js'
import { streak, consistency } from '../lib/streak.js'
import { fromDateStr, formatDayShort, todayStr } from '../lib/dates.js'
import { navigate } from '../router.js'

const WEEKS = 12

/**
 * Consistency, one level under Trends, and where Streak lands too.
 *
 * A calendar of the last twelve weeks, one dot per day, and the miss rate
 * by weekday under it. The two tiles say how many; this says WHICH, and
 * which is the useful one: the answer is nearly always a weekday, and a
 * count cannot name it.
 *
 * The dots are ink, not a macro hue. Consistency is not a macro and the
 * rule that colour means macro identity holds here.
 */
export function consistencyScreen() {
  return createScreen(
    async () => {
      const settings = await getSettings()
      const today = todayStr()
      // Back to the Monday that starts the window, so every row is a week.
      const wd = (fromDateStr(today).getDay() + 6) % 7
      const span = (WEEKS - 1) * 7 + wd
      const days = await loadDays(span)
      const byDate = new Map(days.map((d) => [d.date, d]))

      const run = streak(days, settings.targets)
      const month = consistency(days, settings.targets)

      /* ------------------------------------------------------- calendar */
      const oldest = days[days.length - 1].date
      const rows = []
      for (let w = 0; w < WEEKS; w++) {
        const cells = []
        for (let i = 0; i < 7; i++) {
          const idx = days.length - 1 - (w * 7 + i)
          const day = idx >= 0 ? days[idx] : null
          const state = day ? dayState(day, settings.targets) : 'future'
          cells.push(
            h('span', {
              class: 'cal-dot',
              dataset: { state },
              title: day ? `${formatDayShort(day.date)} · ${state}` : '',
            }),
          )
        }
        const start = days[Math.max(0, days.length - 1 - w * 7)].date
        rows.push(
          h(
            'div',
            { class: 'cal-row' },
            h('span', { class: 'cal-label' }, formatDayShort(start)),
            ...cells,
          ),
        )
      }
      const calendar = h(
        'div',
        { class: 'day-card flex flex-col gap-[10px]' },
        h(
          'div',
          { class: 'cal-row' },
          h('span', { class: 'cal-label' }),
          ...WEEKDAYS.map((d) => h('span', { class: 'cal-head' }, d[0])),
        ),
        ...rows,
        h(
          'div',
          { class: 'mt-[6px] flex gap-[14px] text-[12px] text-muted' },
          legend('full', 'Full'),
          legend('partial', 'Partial'),
          legend('none', 'Nothing'),
        ),
      )

      /* ------------------------------------------------------- weekdays */
      const stats = weekdayStats(days, settings.targets)
      const worst = Math.max(...stats.map((r) => r.of - r.full))
      const weekdayRows = stats.map((r) => {
        const missed = r.of - r.full
        return h(
          'div',
          { class: 'row justify-between' },
          h('span', { class: 'text-[16px] font-semibold' }, r.label),
          h(
            'span',
            { class: 'flex items-baseline gap-[6px]' },
            tnum(`${r.full} of ${r.of}`, 'text-[14px] font-semibold'),
            h(
              'span',
              { class: `text-[12px] ${missed && missed === worst ? 'font-semibold text-ink' : 'text-muted'}` },
              missed === 1 ? '1 miss' : `${missed} misses`,
            ),
          ),
        )
      })

      return trendsPage(
        { title: 'Consistency', onBack: () => navigate('trends') },
        h(
          'div',
          { class: 'grid grid-cols-2 gap-[10px]' },
          figure(String(run), run === 1 ? 'day in a row' : 'days in a row'),
          figure(`${month.pct}%`, `${month.logged} of the last ${month.of} days`),
        ),
        section(`Last ${WEEKS} weeks`, calendar),
        section('By weekday', card(weekdayRows)),
      )
    },
    { watch: ['entries', 'settings'], watchDate: false },
  )
}

const legend = (state, label) =>
  h('span', { class: 'flex items-center gap-[6px]' }, h('span', { class: 'cal-dot', dataset: { state } }), label)

const figure = (value, label) =>
  h(
    'div',
    { class: 'day-card flex flex-col gap-[4px]' },
    tnum(value, 'text-title font-semibold'),
    h('span', { class: 'text-[12px] leading-snug text-muted' }, label),
  )

const section = (title, body) =>
  h('section', { class: 'flex flex-col gap-[10px]' }, h('div', { class: 'section-title' }, title), body)
