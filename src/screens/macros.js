import { h } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import { getSettings } from '../lib/db.js'
import { loadDays } from '../lib/days.js'
import { targetHits, topSources } from '../lib/insights.js'
import { dayBars } from '../lib/bars.js'
import { trendsPage } from '../lib/trendTile.js'
import { card, tnum, macroTextColor } from '../lib/ui.js'
import { g, kcal as fmtKcal, displayName } from '../lib/format.js'
import { navigate } from '../router.js'

const SPAN = 30

/**
 * Macros, one level under Trends.
 *
 * Protein by day against its target with the hit rate, then the foods that
 * carried the most protein and the most calories over the month. The tile
 * shows the week's means; a mean hides two big days and five misses, and
 * it cannot say where the protein came from. These two can.
 *
 * Protein rather than all three because protein is the one that has a
 * floor to hit; fat and carbs are what is left after it. No split as a
 * percentage of calories: it looks like analysis and changes nothing.
 */
export function macrosScreen() {
  return createScreen(
    async () => {
      const [settings, days] = await Promise.all([getSettings(), loadDays(SPAN - 1)])
      const hits = targetHits(days, settings.targets, 'protein')

      const protein = h(
        'div',
        { class: 'day-card flex flex-col gap-[16px]' },
        h(
          'div',
          { class: 'flex flex-col gap-[2px]' },
          h(
            'div',
            { class: 'flex items-baseline gap-[6px]' },
            tnum(`${hits.hit} of ${hits.of}`, 'text-title font-semibold'),
            h('span', { class: 'text-[12px] text-muted' }, 'full days hit the target'),
          ),
          h(
            'span',
            { class: 'text-[12px] leading-snug text-muted' },
            `${g(settings.targets.protein)}g protein, last ${SPAN} days`,
          ),
        ),
        dayBars({ days, key: 'protein', target: settings.targets.protein, targets: settings.targets }),
      )

      const sourceRows = (key, unit, fmt) =>
        topSources(days, key, 5).map((r) =>
          h(
            'div',
            { class: 'row justify-between' },
            h(
              'div',
              { class: 'flex min-w-0 flex-col' },
              h('span', { class: 'truncate text-[16px] font-semibold' }, displayName(r.name)),
              h(
                'span',
                { class: 'text-[12px] text-muted' },
                `${r.times} ${r.times === 1 ? 'time' : 'times'} · ${Math.round(r.share * 100)}% of the total`,
              ),
            ),
            h(
              'span',
              { class: 'flex shrink-0 items-baseline gap-[3px]' },
              tnum(fmt(r.amount), 'text-[16px] font-semibold'),
              h('span', { class: 'text-[12px] font-semibold', style: { color: macroTextColor(key) } }, unit),
            ),
          ),
        )

      const empty = h('div', { class: 'row' }, h('span', { class: 'text-[14px] text-muted' }, 'Nothing logged in the last 30 days.'))
      const proteinRows = sourceRows('protein', 'g', g)
      const kcalRows = sourceRows('kcal', 'cal', fmtKcal)

      return trendsPage(
        { title: 'Macros', onBack: () => navigate('trends') },
        section('Protein', protein),
        section('Most protein, last 30 days', card(proteinRows.length ? proteinRows : empty)),
        section('Most calories, last 30 days', card(kcalRows.length ? kcalRows : empty.cloneNode(true))),
      )
    },
    { watch: ['entries', 'settings'], watchDate: false },
  )
}

const section = (title, body) =>
  h('section', { class: 'flex flex-col gap-[10px]' }, h('div', { class: 'section-title' }, title), body)
