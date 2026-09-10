import { h, s } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import {
  listWeights,
  getSettings,
  entriesInRange,
  firstLoggedDate,
} from '../lib/db.js'
import {
  sumEntries,
  progress,
  weeklyAverages,
  isPartialDay,
  MACRO_META,
} from '../lib/compute.js'
import {
  card,
  emptyState,
  tnum,
  digits,
  pageHeader,
  macroColor,
  macroTextColor,
  macroUnit,
  rowChevron,
} from '../lib/ui.js'
import { kcal, g } from '../lib/format.js'
import {
  formatDayLabel,
  todayStr,
  addDays,
  daysBetween,
} from '../lib/dates.js'
import { trendsGrid } from '../lib/trendTile.js'
import { streak, consistency } from '../lib/streak.js'
import {
  caloriesTile,
  streakTile,
  consistencyTile,
  macrosTile,
  weightTile,
} from './trendTiles.js'
import { openLogSheet } from '../sheets/log.js'
import { setDate } from '../state.js'
import { navigate } from '../router.js'

/**
 * Trends. A grid of tiles, then the day list.
 *
 * **The tab was called Weight, which was the only tab named after a data type
 * rather than a job.** Today, Trends and Settings all name what you are doing;
 * Weight named what was stored. It was already a trends screen — a chart over
 * time — so nutrition history is the same shape of thing rather than a fourth
 * tab, and the two belong on one screen because the question people actually
 * have is whether the intake explains the outcome.
 *
 * The weight chart, its range switch and the entry field lived at the top of
 * this screen until the grid arrived. They are one level down now, at
 * `trends/weight` in screens/weight.js, and the Weight tile here carries the
 * reading that matters at a glance and a button to log one. The tiles are in
 * screens/trendTiles.js; this file owns loading, order and the day list.
 */

const RING_SIZE = 20
const RING_STROKE = 3
const RING_R = (RING_SIZE - RING_STROKE) / 2
const RING_C = 2 * Math.PI * RING_R

function miniRing(macro, value, target) {
  const { pct } = progress(value, target)
  const len = pct <= 0 ? 0 : Math.max(RING_STROKE, (pct / 100) * RING_C)

  const onRing = (extra) => ({
    cx: RING_SIZE / 2,
    cy: RING_SIZE / 2,
    r: RING_R,
    fill: 'none',
    'stroke-width': RING_STROKE,
    transform: `rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`,
    ...extra,
  })

  return s(
    'svg',
    {
      width: RING_SIZE,
      height: RING_SIZE,
      viewBox: `0 0 ${RING_SIZE} ${RING_SIZE}`,
      'aria-hidden': 'true',
    },
    s(
      'circle',
      onRing({
        stroke: `color-mix(in srgb, ${macroColor(macro)} 20%, transparent)`,
      }),
    ),
    len > 0
      ? s(
          'circle',
          onRing({
            stroke: macroColor(macro),
            'stroke-linecap': 'round',
            'stroke-dasharray': RING_C,
            'stroke-dashoffset': RING_C - len,
          }),
        )
      : null,
  )
}

/**
 * Three rings showing how close protein, fat and carbs landed.
 *
 * Labelled, because this is the only place the macro hues appear at this size
 * and colour alone is not a label — for the eight percent of men who cannot
 * separate the red from the gold, three grey circles is all this would be. The
 * letter is the macro's own initial from `MACRO_META`, so it stays in step if
 * the palette ever moves.
 *
 * The `title` stays as well: it carries the actual grams, which no ring can.
 */
function macroTicks(totals, targets) {
  return h(
    'div',
    { class: 'flex shrink-0 gap-[10px]' },
    ['protein', 'fat', 'carbs'].map((macro) =>
      h(
        'div',
        {
          class: 'flex flex-col items-center gap-[3px]',
          title: `${g(totals[macro])} / ${g(targets[macro])} ${macro}`,
        },
        miniRing(macro, totals[macro], targets[macro]),
        /**
         * 9px, and it is the app's one deliberate exception to the type scale.
         *
         * The scale is 48/26/20/16/14/12 and everything else was collapsed onto
         * it in v1.2.2. This was looked at in the same pass and kept, so the
         * reasoning lives here rather than being rediscovered and re-flagged
         * every time someone greps for off-scale sizes.
         *
         * **It annotates a 20px ring.** At the nearest scale step the letter
         * would be 12px against a 20px diameter — 60% of the mark it labels —
         * so the annotation would out-measure the thing annotated. A label that
         * large stops reading as a key to the ring and starts competing with it.
         *
         * **The row it sits in has no room.** Three rings, three letters, a
         * figure, a unit and a chevron already put this row at its limit, which
         * is why the calories bar that was tried here was removed rather than
         * fitted. 12px would take each tick stack from 32 to 35 and add 3px to
         * every row in the history list, to make a letter legible that is
         * already `aria-hidden` and duplicated by the group's `title`.
         *
         * The letter is not load-bearing: the hue carries macro identity, which
         * is the app's rule, and the accessible reading comes from `title`. It
         * is a key for the eye, and a key is allowed to be smaller than what it
         * keys. That is the whole argument for the exception — not that 12 does
         * not fit, but that it would be worse.
         */
        h(
          'span',
          {
            class: 'text-[9px] font-semibold leading-none',
            style: { color: macroTextColor(macro) },
            'aria-hidden': 'true',
          },
          MACRO_META[macro].letter,
        ),
      ),
    ),
  )
}

/**
 * One day. Tapping it sets the shared date and opens the Log sheet over this
 * screen, which is now the route to an older day — the sheet stopped carrying
 * its own date controls, so this is where day browsing lives.
 */
/**
 * **An untracked day is the same row as any other, at the same size.**
 *
 * It used to be a hairline: a 12px muted date, a rule across the middle, and the
 * words "not tracked" — about a third the height of the days either side of it.
 * That drew the day you did not log as a lesser kind of object, and it is not
 * one. Looking back at a week, a gap is as much of the answer as a number is;
 * three missed days in a row is the most important thing that week has to say,
 * and it was the quietest thing on the screen.
 *
 * So the size, the type and the structure are shared, and what differs is the
 * DATA — empty tick tracks and an em dash where the calories go. The app makes
 * this argument elsewhere and it holds here: the empty track is the zero state,
 * and a dash cannot be mistaken for data. Nothing is dimmed to say "less
 * important", because it is not.
 *
 * **The tap goes where every other row's tap goes.** It used to open the add
 * sheet for that day, on the reasoning that an empty day's obvious next action
 * is filling it — which was fair while the row looked nothing like its
 * neighbours. Now that it does, two rows that are drawn identically have to do
 * the same thing, so this opens that day's log like the rest. The log's own
 * empty state carries the Add affordance one tap further in.
 */
function dayRow(day, targets) {
  const tracked = day.entries.length > 0
  const partial = tracked && isPartialDay(day, targets)

  return h(
    'button',
    {
      class: 'row',
      onclick: () => {
        setDate(day.date)
        openLogSheet()
      },
    },
    h(
      'div',
      { class: 'min-w-0 flex-1' },
      h('div', { class: 'truncate text-[16px] font-semibold' }, formatDayLabel(day.date)),
      h(
        'div',
        { class: 'mt-[2px] text-[12px] text-muted' },
        tracked
          ? `${day.entries.length} item${day.entries.length === 1 ? '' : 's'}` +
              // Named on the row it applies to, not just counted in the caption
              // above. A number that says two days were left out is only
              // actionable if you can see which two.
              (partial ? ' · partial' : '')
          : 'Not tracked',
      ),
    ),
    macroTicks(day.totals, targets),
    /**
     * Calories as a number, with no mark under it.
     *
     * A bar was tried here, mirroring Today's number-then-proportion
     * arrangement, on the argument that calories was the one value on the row
     * carrying no mark at all. Built and removed: at three rings, three letters,
     * a figure, a unit and a chevron, the row was already at its limit, and the
     * bar was the ninth thing on it.
     *
     * What settled it is that the bar was the cheapest of the marks to lose.
     * The rings carry three values against target where it carried one, and
     * calories is the largest type on the row — hierarchy is already marking it
     * as the headline. The column is fixed-width with tabular figures, so 2420
     * against 1803 is comparable straight down the list without help. The bar
     * was restating what the column already does.
     *
     * A fixed width so the digits do not drift and the dash lands where the
     * numbers do.
     */
    h(
      'span',
      { class: 'w-[70px] shrink-0 text-right text-[16px] font-semibold' },
      tracked
        ? [
            tnum(kcal(day.totals.kcal)),
            macroUnit('kcal', 'ml-[4px] text-[12px] font-semibold'),
          ]
        : h('span', { class: 'text-muted' }, '—'),
    ),
    rowChevron(),
  )
}

/** The last N days as {date, entries, totals}, newest first. */
async function loadDays(span) {
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

export function trendsScreen() {
  return createScreen(
    async () => {
      const [weights, settings, first] = await Promise.all([
        listWeights(),
        getSettings(),
        firstLoggedDate(),
      ])
      const today = todayStr()

      /**
       * Always at least a full week, capped at 180 days.
       *
       * The floor is the fix for the empty-looking first week: the walk used to
       * start at the first logged day, so one day tracked drew exactly one row
       * and the screen was mostly dead space under a card about seven days. The
       * window now has a stable shape from the start and fills in rather than
       * growing. The cap stops a year of use building a thousand rows at once.
       */
      const days = first
        ? await loadDays(Math.max(6, Math.min(daysBetween(first, today), 180)))
        : null
      const week = days ? weeklyAverages(days, settings.targets) : null

      /**
       * 10 between a heading and what it labels, 20 between the groups under it.
       *
       * A heading and its content are one thing, not two — the same step Today
       * uses under `Logged`, and the rule `ui.js` states at the top: 10 inside a
       * group, 20 between groups. All three sections on this screen follow it, so
       * the headings sit at a consistent distance from the tiles they name.
       */
      const historySection = h(
        'section',
        { class: 'flex flex-col gap-[10px]' },
        h('div', { class: 'section-title' }, 'History'),
        days
          ? card(days.map((day) => dayRow(day, settings.targets)))
          : emptyState(
              'No history yet',
              'Once you have logged a few days, this is where the weekly averages live.',
            ),
      )


      return h(
        'div',
        {},
        heading(),
        h(
          'div',
          { class: 'flex flex-col gap-[20px] pb-[20px]' },
          days
            ? trendsGrid([
                caloriesTile({ days, week, targets: settings.targets }),
                streakTile(streak(days, settings.targets)),
                consistencyTile(consistency(days, settings.targets)),
                macrosTile({ week, targets: settings.targets }),
                weightTile({ weights, settings, onPress: () => navigate('trends/weight') }),
              ])
            : trendsGrid([weightTile({ weights, settings, onPress: () => navigate('trends/weight') })]),
          historySection,
        ),
      )
    },
    // can see.
    { watch: ['weights', 'settings', 'entries'], watchDate: false },
  )
}

/**
 * Root tab, so no chevrons — the plain variant. It holds Today's 44px slot
 * anyway, which is what puts this title on Today's baseline rather than 5.75px
 * above it. Settings renders the identical call with a different string.
 */
function heading() {
  return pageHeader('Trends')
}