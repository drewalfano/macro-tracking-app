import { h, s, repaint, reduceMotion } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import {
  listWeights,
  getWeight,
  putWeight,
  getSettings,
  entriesInRange,
  firstLoggedDate,
} from '../lib/db.js'
import {
  computeTrend,
  ratePerWeek,
  windowPoints,
  axisBounds,
  GRID_FRACTIONS,
  MIN_ENTRIES_FOR_TREND,
} from '../lib/trend.js'
import {
  sumEntries,
  progress,
  weeklyAverages,
  isPartialDay,
  MACRO_META,
} from '../lib/compute.js'
import {
  card,
  segmentedWide,
  numberInput,
  notice,
  emptyState,
  tnum,
  digits,
  pageHeader,
  macroColor,
  macroTextColor,
  macroUnit,
  rowChevron,
} from '../lib/ui.js'
import {
  kgToUnit,
  unitToKg,
  weight as fmtWeight,
  signed,
  kcal,
  g,
  pluralize,
} from '../lib/format.js'
import { formatDayLabel, formatDayAge, todayStr, addDays, daysBetween } from '../lib/dates.js'
import { toast } from '../lib/toast.js'
import { openWeighInSheet } from '../sheets/weighIn.js'
import { trendsGrid } from '../lib/trendTile.js'
import { streak, consistency } from '../lib/streak.js'
import { caloriesTile, streakTile, consistencyTile, macrosTile } from './trendTiles.js'
import { openLogSheet } from '../sheets/log.js'
import { setDate } from '../state.js'

/**
 * Trends. Weight, then history.
 *
 * **The tab was called Weight, which was the only tab named after a data type
 * rather than a job.** Today, Trends and Settings all name what you are doing;
 * Weight named what was stored. It was already a trends screen — a chart over
 * time — so nutrition history is the same shape of thing rather than a fourth
 * tab, and the two belong on one screen because the question people actually
 * have is whether the intake explains the outcome.
 *
 * History moved here wholesale from `screens/history.js`, which no longer
 * exists. It had been reachable only through the Log, which was the wrong place
 * for it twice over: a destination behind a modal, and a multi-day view behind a
 * single-day one.
 *
 * The chart is deliberately neutral — none of the four macros own body weight,
 * so borrowing one of their hues here would break the rule that colour means
 * macro identity. Ink for the trend, muted grey for the raw dots.
 */

let range = 30 // module-level so the toggle survives a re-render

const CHART_W = 340
const CHART_H = 150
const PAD = { top: 10, right: 6, bottom: 8, left: 6 }

/**
 * How long a range switch takes to cross-fade — and why it is a cross-fade
 * rather than the chart morphing to its new axis.
 *
 * **This decision should not be re-litigated, so here is what it rests on.** The
 * y-scale is not a property the chart carries; it is `axisBounds(values, unit)`
 * baked into every coordinate at construction — `y1`/`y2` on each gridline, `y`
 * on each label, and the whole `d` string on the trend path. SVG geometry
 * attributes are not animatable properties, so there is nothing to transition
 * even in principle. `d` alone can interpolate, and only between paths whose
 * segment structure matches.
 *
 * It does not match, and that is the deeper reason. A range switch changes
 * `windowPoints(allPoints, range)`, so thirty days and ninety days hold a
 * different NUMBER of points. It is not one line rescaled onto a new axis; it is
 * a different line. Morphing between them would have to invent intermediate
 * shapes that were never anybody's weight, which is a chart asserting data it
 * does not have — the same standard the honesty rules hold the rest of this
 * screen to.
 *
 * So the fade says the true thing: same instrument, different window. A morph
 * would say the line moved, and it did not.
 *
 * 180ms rather than the 160 the note that asked for this proposed, because the
 * `± / week` line changes in the same breath and takes `.reading-swap`'s 180.
 * One event, one clock — the mistake this pass has been unpicking everywhere
 * else.
 */
const CHART_SWAP_MS = 180

/**
 * The chart's box, held when there is no chart to put in it.
 *
 * `aspect-ratio` off the chart's own constants rather than a measured height,
 * because the svg is `w-full` on a fixed viewBox — its rendered height is always
 * width × 150/340, so a fixed number would only be right at one screen width.
 * The two boxes are therefore the same box at every width, which is what lets
 * the cross-fade swap one for the other without the card changing height. It
 * was `py-[30px]` once, 96px against the chart's 130 at 375pt, and the card
 * jumped 34px the moment a second weigh-in landed.
 */
function chartPlaceholder() {
  return h(
    'div',
    {
      class: 'flex items-center justify-center text-center text-[12px] text-muted',
      style: { aspectRatio: `${CHART_W} / ${CHART_H}` },
    },
    'Two readings are needed before there is anything to draw.'
  )
}

/**
 * Why the line is not there, said once, in the only place that says it.
 *
 * **This used to be built from the record and never changed.** It was gated on
 * `weights.length`, so a long history with a quiet fortnight in view showed a
 * chart with no line, a withheld rate, and nothing at all accounting for
 * either. The card went quiet in three places at once and explained itself in
 * none of them. It reads off the window now, in the same breath as the chart
 * and the rate, because it is the sentence those two absences share.
 *
 * Two forms, and the pivot between them is whether the count in view is the
 * count you have. `5 more to go` is a true and useful thing to tell someone
 * starting out; told to someone with forty readings and a gap it is nonsense,
 * because they are not short of weigh-ins, they are short of recent ones.
 *
 * Neither form asserts recency. `windowPoints` clips the last 30 days OF THE
 * RECORD, which ends at the last weigh-in rather than at today, so a range
 * ending three months ago is an ordinary state here. `This range holds` is true
 * whenever it is shown; `in the last 30 days` would not be.
 */
function trendNotice(inWindow, total) {
  if (inWindow === total) {
    return notice(
      `The trend line starts at ${MIN_ENTRIES_FOR_TREND} weigh-ins, with ` +
        `${MIN_ENTRIES_FOR_TREND - total} more to go. ` +
        'Fewer than that and the line is just tracing water weight.',
    )
  }
  return notice(
    `This range holds ${pluralize(inWindow, 'weigh-in')}. ` +
      `The trend line starts at ${MIN_ENTRIES_FOR_TREND}, and fewer than that ` +
      'is just tracing water weight.',
  )
}

/**
 * The chart draws what the data supports and no more.
 *
 * Two rules do that, and both are about the difference between what is on the
 * screen and what is in the record:
 *
 * **The y-axis has a floor.** See `MIN_AXIS_SPAN`. Fitted to its data, this
 * chart drew every history at the same amplitude — a fortnight of water noise
 * and a real three-pound cut both filled the frame — so the shape of the line
 * carried no information at all. Below the floor the line compresses toward
 * flat, which is what a flat fortnight actually is.
 *
 * **The trend line is gated on the weigh-ins IN THIS WINDOW.** `computeTrend`
 * already refuses to smooth under `MIN_ENTRIES_FOR_TREND` readings, but it runs
 * over the whole record before `windowPoints` clips it — so forty readings from
 * six months ago and none since still drew a confident line across the 30-day
 * view, carried forward flat from the last one. The gate has to be applied
 * where the drawing happens, against the points being drawn.
 */
function chart(points, unit) {
  /**
   * Two READINGS, not two points carrying a value.
   *
   * This counted `kg != null || trend != null`, and the second half of that is
   * carried-forward trend — so one weigh-in landing on top of an older history
   * produced thirty qualifying points and drew a full chart of one dot and a
   * line the gate below then refused to draw. The placeholder is for "there is
   * nothing to draw yet", and one reading is that, whatever the record holds.
   */
  const readings = points.filter((p) => p.kg != null).length
  if (readings < 2) return null

  const drawn = points.filter((p) => p.kg != null || p.trend != null)

  const values = []
  for (const p of drawn) {
    if (p.kg != null) values.push(kgToUnit(p.kg, unit))
    if (p.trend != null) values.push(kgToUnit(p.trend, unit))
  }
  const { min, max } = axisBounds(values, unit)

  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom
  const x = (i) => PAD.left + (i / (points.length - 1 || 1)) * innerW
  const y = (v) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH

  const trendPath = []
  if (readings >= MIN_ENTRIES_FOR_TREND) {
    points.forEach((p, i) => {
      if (p.trend == null) return
      const px = x(i)
      const py = y(kgToUnit(p.trend, unit))
      trendPath.push(`${trendPath.length ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`)
    })
  }

  const gridlines = GRID_FRACTIONS.map((f) => min + f * (max - min)).map((v) =>
    s('g', {}, [
      s('line', {
        x1: PAD.left,
        x2: CHART_W - PAD.right,
        y1: y(v).toFixed(1),
        y2: y(v).toFixed(1),
        stroke: 'var(--color-outline)',
        'stroke-width': '1',
      }),
      s(
        'text',
        {
          x: PAD.left + 2,
          y: (y(v) - 4).toFixed(1),
          fill: 'var(--color-muted)',
          'font-size': '9',
        },
        fmtWeight(unitToKg(v, unit), unit),
      ),
    ]),
  )

  return s(
    'svg',
    {
      viewBox: `0 0 ${CHART_W} ${CHART_H}`,
      class: 'w-full',
      role: 'img',
      'aria-label': 'Weight trend chart',
    },
    gridlines,
    /**
     * Raw daily readings sit behind the line and stay muted — but only while
     * there is a line for them to sit behind.
     *
     * 0.55 is a weight chosen against ink at full strength: it puts the scatter
     * far enough back that the smoothed line reads as the subject. With the
     * line gated off there is no subject, and the same 0.55 leaves the only
     * marks on the card looking like a rendering fault rather than like the two
     * weigh-ins they are. Full opacity in that state, same hue and same radius
     * — this is the mark taking the foreground it now has to itself, not a new
     * one.
     */
    points.map((p, i) =>
      p.kg == null
        ? null
        : s('circle', {
            cx: x(i).toFixed(1),
            cy: y(kgToUnit(p.kg, unit)).toFixed(1),
            r: '2',
            fill: 'var(--color-muted)',
            opacity: trendPath.length > 1 ? '0.55' : '1',
          }),
    ),
    trendPath.length > 1
      ? s('path', {
          d: trendPath.join(''),
          fill: 'none',
          stroke: 'var(--color-ink)',
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'vector-effect': 'non-scaling-stroke',
        })
      : null,
  )
}

/* ----------------------------------------------------------------- history */

/**
 * The mini ring. Same construction as the hero rings on Today, at a tenth the
 * area.
 *
 * These were flat bars, and rings are the better mark here for the reason the
 * dashboard already uses them: the app's language for "how much of a target"
 * is a ring, and a list that answers the same question with a different shape
 * makes the reader translate between two vocabularies to compare a day against
 * the card they just came from.
 *
 * Everything about how it is drawn is inherited rather than reinvented — see
 * lib/ring.js. The track is the macro's own hue at 20%, not a neutral, so an
 * untracked day still reads as three labelled macro rings rather than three
 * identical grey circles. The arc starts at 12 o'clock, runs clockwise, and is
 * round-capped. Zero draws no arc at all, and anything above zero draws at
 * least one stroke width — below that the two caps meet and the arc renders as
 * a dot at 12 o'clock, which reads as a fault rather than as "nearly nothing".
 *
 * It saturates at the target, as the hero rings do. Overage is carried by the
 * calorie figure beside it and by the `title`, not by the mark.
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
      const unit = settings.weightUnit
      const today = todayStr()
      const todayEntry = await getWeight(today)

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
          ? h(
              'div',
              { class: 'flex flex-col gap-[20px]' },
              trendsGrid([
                caloriesTile({ days, week, targets: settings.targets }),
                streakTile(streak(days, settings.targets)),
                consistencyTile(consistency(days, settings.targets)),
                macrosTile({ week, targets: settings.targets }),
              ]),
              card(days.map((day) => dayRow(day, settings.targets))),
            )
          : emptyState(
              'No history yet',
              'Once you have logged a few days, this is where the weekly averages live.',
            ),
      )

      const allPoints = computeTrend(weights, settings.trendWindow)
      const latest = weights[weights.length - 1] || null
      const latestTrend = [...allPoints].reverse().find((p) => p.trend != null)?.trend ?? null

      /**
       * The range switch stops rebuilding the screen and repaints its own two
       * marks instead.
       *
       * `range` changes exactly two things — the chart, and the `± / week` line
       * that reads off the same window. Everything else in this card is the
       * latest weigh-in and the trend figure, which do not know the range
       * exists. Routing the toggle through `rerender()` threw all of it away to
       * redraw two of them, and the visible cost was gaps item 12: the header,
       * the card, the control you just pressed and the chart were all replaced
       * on one frame, so the 30-day line and the 90-day line read as two
       * unrelated charts that happened to appear in the same box.
       *
       * This is the shape onboarding already uses one screen over: a shell that
       * is built once and holds still, and a payload handed a freshly built
       * subtree. The only rule that matters is the one that makes it safe —
       * `repaint` is never given a node the container is already holding, so
       * nothing on screen is ever detached and reattached, and anything mid-
       * transition keeps running.
       */
      const rateEl = h('span', { class: 'text-[12px] text-muted' })
      const chartSlot = h('div', { class: 'chart-slot' })
      /**
       * `contents`, so the wrapper is not in the layout when it is empty.
       *
       * The notice is a child of a `gap-[20px]` column, and an empty div still
       * counts as a child: a plain wrapper would hold 20px of air between the
       * chart card and the entry block in the ordinary state where there is no
       * notice to show. `display: contents` takes the box out of the flow
       * entirely and lets whatever it holds sit in the column directly, so the
       * gap appears with the notice and leaves with it.
       */
      const noticeSlot = h('div', { class: 'contents' })
      let swapTimer = null

      const drawRange = (animate) => {
        const points = windowPoints(allPoints, range)
        const rate = ratePerWeek(points)
        const readings = points.filter((p) => p.kg != null).length

        // Same window, same breath. The chart, the rate and the sentence
        // explaining them are three views of one count.
        repaint(
          noticeSlot,
          readings < MIN_ENTRIES_FOR_TREND ? trendNotice(readings, weights.length) : null,
        )

        rateEl.textContent =
          rate == null ? ' ' : `${signed(kgToUnit(rate, unit))} ${unit} / week`
        if (rate == null) rateEl.setAttribute('aria-hidden', 'true')
        else rateEl.removeAttribute('aria-hidden')

        const next = chart(points, unit) || chartPlaceholder()

        if (!animate || reduceMotion()) {
          clearTimeout(swapTimer)
          repaint(chartSlot, next)
          return
        }

        /**
         * The reading changed and the instrument did not, which is the sentence
         * `.reading-swap` was written for. Restarting it needs the class off,
         * a forced reflow, then on — the long form of why a `requestAnimationFrame`
         * is not a substitute is at `replay` in screens/onboarding.js.
         */
        rateEl.classList.remove('reading-swap')
        void rateEl.offsetWidth
        rateEl.classList.add('reading-swap')

        clearTimeout(swapTimer)
        // A second switch while the first is still fading finishes the first
        // outright rather than leaving three charts stacked in one box.
        chartSlot.querySelectorAll('[data-leaving="true"]').forEach((node) => node.remove())
        const outgoing = chartSlot.firstElementChild
        if (outgoing) outgoing.dataset.leaving = 'true'
        next.classList.add('chart-in')
        chartSlot.appendChild(next)
        swapTimer = setTimeout(() => {
          outgoing?.remove()
          next.classList.remove('chart-in')
        }, CHART_SWAP_MS)
      }

      /* ----------------------------------------------------------- input */

      let draft = todayEntry ? String(kgToUnit(todayEntry.kg, unit).toFixed(1)) : ''
      const saveBtn = h(
        'button',
        {
          class: 'btn-primary btn-compact',
          disabled: !draft,
          onclick: async () => {
            const value = Number(draft)
            if (!(value > 0)) return
            await putWeight(today, unitToKg(value, unit))
            toast(todayEntry ? 'Weight updated' : 'Weight saved')
          },
        },
        todayEntry ? 'Update' : 'Save',
      )

      const input = numberInput({
        value: draft,
        suffix: unit,
        placeholder: '—',
        step: '0.1',
        onInput: (v) => {
          draft = v
          saveBtn.disabled = !(Number(v) > 0)
        },
      })

      /**
       * The controls sit in a tile, like every other group on this screen.
       *
       * They used to sit bare on the canvas, which was survivable when this was
       * a screen about one thing and stopped being so the moment history moved
       * in underneath: the averages and the day list are both tiles, so the one
       * group that was not read as unfinished rather than as different.
       *
       * The heading stays outside it. That is the app's pattern everywhere —
       * `Logged` on Today, `History` below — a label on the page, the content in
       * a card beneath.
       */
      const entryBlock = h(
        'section',
        { class: 'flex flex-col gap-[10px]' },
        h(
          'div',
          { class: 'section-head' },
          h('div', { class: 'section-label' }, 'Today’s weight'),
          /**
           * No `Remove` chip here any more.
           *
           * It deleted today's reading, which is a real thing that `Update`
           * cannot do — replacing a value is not the same as returning to no
           * value, and the trend recalculates differently. But it was the exact
           * action the weigh-in sheet below already offered: that sheet opened
           * on today by default, showed today's reading, and carried its own
           * Remove. So this was a second door onto the same room, given
           * heading-level prominence, for the least common action in the group.
           */
          null,
        ),
        card(
          h(
            'div',
            {
              /**
               * The plain 20 all round, which is what a card's inset is.
               *
               * It was briefly 10 at the bottom when the hint was showing, and
               * that was right for the arrangement it was written against: a
               * hairline and the `All weigh-ins` row sat underneath, and the
               * caption needed to be the same apparent distance from that rule
               * as the row's label was on the other side of it.
               *
               * That row has moved up to the section head, so there is no rule
               * to balance against any more — the group IS the card, and 10
               * against the card's own edge just reads as cramped.
               */
              class: 'flex flex-col gap-[10px] px-[20px] py-[20px]',
            },
            h(
              'div',
              { class: 'flex items-center gap-[10px]' },
              h('div', { class: 'min-w-0 flex-1' }, input),
              saveBtn,
            ),
            /**
             * Shown whether or not today already has a value.
             *
             * It was gated on `todayEntry`, on the reading that a line about
             * replacing today's value has nothing to say until there is one. But
             * the thing it answers is "what happens if I weigh myself twice
             * today", and that question arrives BEFORE the first save, not after
             * — by the time the field says `Update` and holds a number, the
             * button has already answered it. Gated, the hint was only ever
             * visible in the one state that did not need it.
             */
            h(
              'p',
              { class: 'text-[12px] text-muted' },
              'Saving again replaces today’s value rather than adding a second one.',
            ),
          ),
        ),
      )

      if (!weights.length) {
        return h(
          'div',
          {},
          heading(),
          h(
            'div',
            { class: 'flex flex-col gap-[20px] pb-[20px]' },
            h(
              'section',
              { class: 'flex flex-col gap-[20px]' },
              h(
                'div',
                { class: 'flex flex-col gap-[10px]' },
                h('div', { class: 'section-title' }, 'Weight'),
                emptyState(
                  'No weigh-ins yet',
                  // `after a week of readings` named the wrong unit: the gate is
                  // 7 weigh-ins, not 7 days, and those are different promises to
                  // anyone who does not weigh in daily.
                  `Add today’s weight below. The trend line appears after ${MIN_ENTRIES_FOR_TREND} weigh-ins.`,
                ),
              ),
              entryBlock,
            ),
            historySection,
          ),
        )
      }

      /* ---------------------------------------------------------- header */

      const rangeRow = segmentedWide({
        options: [
          { value: 30, label: '30 days' },
          { value: 90, label: '90 days' },
          { value: null, label: 'All' },
        ],
        value: range,
        // Repaints its own two marks rather than rebuilding the screen. The
        // control moves its own pill, so nothing here has to redraw it.
        onChange: (v) => {
          range = v
          drawRange(true)
        },
      })

      // The first paint fills the slot without animating: there is nothing for
      // the chart to have crossed from, and a screen that fades in on arrival is
      // a screen that looks like it is loading.
      drawRange(false)

      return h(
        'div',
        {},
        heading(),

        h(
          'div',
          { class: 'flex flex-col gap-[20px] pb-[20px]' },

          /**
           * `Weight` and `History`, each under a heading of its own.
           *
           * The chart had none, because for the tab's whole life it was the only
           * thing on the screen and the page title named it. Once history arrived
           * with a heading, the group without one read as page furniture rather
           * than as the first of two.
           *
           * The entry controls sit inside this section rather than after it: the
           * chart and the field are the same subject, and separating them would
           * make the section a chart with a stray form beneath it.
           */
          h(
            'section',
            { class: 'flex flex-col gap-[20px]' },

            /* Heading and chart are one group at 10; the 20 stays between the
               groups under it — chart, notice, entry. */
            h(
              'div',
              { class: 'flex flex-col gap-[10px]' },

              /**
               * `All weigh-ins` belongs to the section, not to today's field.
               *
               * It was the last row of the `Today's weight` card, which put a door
               * onto the entire record inside the one group scoped to a single day
               * of it. Up here it is the same shape as `Logged` and `Full log` on
               * Today: a heading names a group, and the control opposite goes to
               * all of it.
               *
               * Sitting over the chart is the better adjacency anyway — the chart
               * is the drawing, this is the readings behind it.
               *
               * No count on it, for the reason the log chip lost its own: a
               * destination's label should say where it goes, not how much is
               * there, or it has to be re-read every time it changes.
               */
              h(
                'div',
                { class: 'section-head' },
                h('div', { class: 'section-label' }, 'Weight'),
                h(
                  'button',
                  { class: 'chip-sm', onclick: () => openWeighInSheet() },
                  'All weigh-ins'
                )
              ),

              h(
                'div',
                { class: 'day-card flex flex-col gap-[20px]' },
                h(
                  'div',
                  { class: 'flex items-end justify-between' },
                  h(
                    'div',
                    { class: 'flex flex-col' },
                    /**
                     * `Latest`, not `Current`.
                     *
                     * The figure is the most recent reading in the record, which
                     * is a different claim from the weight you are now — it was
                     * `Current` over a value from two days ago, and over one from
                     * nine days ago it would still have said so. `Latest` is the
                     * fact the app actually has; whether that is current is what
                     * the date under it is for.
                     */
                    h('span', { class: 'text-[12px] font-semibold text-muted' }, 'Latest'),
                    h(
                      'div',
                      { class: 'flex items-baseline gap-[10px]' },
                      tnum(fmtWeight(latest.kg, unit), 'text-display font-semibold'),
                      h('span', { class: 'text-[12px] font-medium text-muted' }, unit),
                    ),
                    // Turns into `12 days ago` once the date stops being the
                    // useful fact about it — see `formatDayAge`.
                    h('span', { class: 'text-[12px] text-muted' }, formatDayAge(latest.date)),
                  ),
                  h(
                    'div',
                    { class: 'flex flex-col items-end' },
                    h('span', { class: 'text-[12px] font-semibold text-muted' }, 'Trend'),
                    h(
                      'div',
                      { class: 'flex items-baseline gap-[10px]' },
                      h(
                        'span',
                        { class: 'tnum text-title font-semibold' },
                        ...digits(latestTrend == null ? '—' : fmtWeight(latestTrend, unit)),
                      ),
                      h('span', { class: 'text-[12px] font-medium text-muted' }, unit),
                    ),
                    /**
                     * Nothing is SAID when there is no rate yet, but the line is
                     * still held.
                     *
                     * No text, for the reason this has always given: the notice
                     * below the card already says what is missing and how far
                     * off it is, and where the trend figure above is an em-dash,
                     * a second dash under the first states one absence twice in
                     * the weaker of the two positions.
                     *
                     * The empty line box is new, and it is a layout fact rather
                     * than a copy decision. This row is `items-end`, so the two
                     * columns hang from a shared baseline and the right one is
                     * three lines tall — dropping the third let the whole Trend
                     * stack slide down by a line the moment the rate was
                     * withheld, which now happens in an ordinary state rather
                     * than only on a fresh install. A card that reshuffles as
                     * data crosses a threshold reads as a rendering fault, and
                     * the reader is being asked to notice the number, not the
                     * furniture moving under it.
                     *
                     * ` ` rather than a height: it is the same line box the
                     * real text would occupy, so it stays correct if the type
                     * size ever changes.
                     */
                    // Built above and filled by `drawRange`: this line reads off
                    // the same window the chart does, so it has to change in the
                    // same breath rather than a frame later.
                    rateEl,
                  ),
                ),

                // The chart's own box, filled and swapped by `drawRange`. The
                // held-height argument that used to live here moved to
                // `chartPlaceholder`, which is the thing that holds it.
                chartSlot,

                rangeRow,
              ),
            ),

            /**
             * Built and filled by `drawRange`, alongside the chart and the rate
             * — see `trendNotice` for what it says and why it reads off the
             * window rather than the record.
             *
             * The sentence itself is the same shape the History card makes
             * about averages: where the threshold is, how far off it is, and
             * what would be wrong with drawing it now. It read `The trend line
             * needs 7 weigh-ins before it means anything. You have 2.`, which
             * states the rule and the count but leaves "means anything" to be
             * taken on trust. The closing clause states the reason instead, and
             * states it as a principle rather than against the current count —
             * the way `An average of one day is just that day` does. It has to
             * hold at two weigh-ins and at six, so it cannot name a number.
             */
            noticeSlot,

            entryBlock,
          ),

          historySection,
        ),
      )
    },
    // `entries` joins the watch list now that history lives here. `watchDate`
    // stays false: this screen is anchored to today and to its own range, and
    // opening the Log sheet from a row sets the shared date — re-rendering the
    // whole screen underneath the sheet that just opened would be work nobody
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
