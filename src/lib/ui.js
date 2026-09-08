import { h, countTo, setTabularText, fitText } from './dom.js'
import { icon, sparkleHalf } from './icons.js'
import { MACRO_ORDER, MACRO_META, progress } from './compute.js'
import { g, kcal, round, cmToFtIn, ftInToCm, displayName } from './format.js'


/**
 * The component vocabulary. Everything visual that appears on more than one
 * screen lives here, so the visual system has exactly one place to change.
 *
 * Layout spacing is on a 10px grid throughout: 10 inside a group, 20 between
 * groups, 30 between sections. The only sub-10 values are typographic — a
 * heading and the line directly under it are one unit, not two.
 */

const MACRO_VAR = {
  kcal: 'var(--color-kcal)',
  protein: 'var(--color-protein)',
  fat: 'var(--color-fat)',
  carbs: 'var(--color-carbs)',
}

const MACRO_EDGE = {
  kcal: 'var(--color-kcal-edge)',
  protein: 'var(--color-protein-edge)',
  fat: 'var(--color-fat-edge)',
  carbs: 'var(--color-carbs-edge)',
}

/**
 * Macro colour as TEXT, which is never the fill.
 *
 * The gold fill is 2.10:1 on white and the green 3.28:1 — both fail AA for the
 * 15px P/F/C suffixes. These resolve to the darker shade in light mode and to a
 * lighter tint in dark, where the darker shades fail instead.
 */
const MACRO_TEXT = {
  kcal: 'var(--color-kcal-text)',
  protein: 'var(--color-protein-text)',
  fat: 'var(--color-fat-text)',
  carbs: 'var(--color-carbs-text)',
}

/**
 * The unit token that follows a number: `cal`, `P`, `F`, `C`.
 *
 * **It is always in its macro's hue, wherever it is drawn.** The figure stays
 * in ink so the data is readable and the unit after it carries the identity —
 * that is the whole convention, and it only works if it holds everywhere. It
 * did not: `macroLine` coloured all four, and every hand-rolled `cal` beside a
 * hero number — the serving sheet, the meal sheet, the plate, a Trends day row
 * — was `text-muted`, so the same word was green in a 12px list and grey at
 * 30px directly above it. Same drift `foodRowBody` describes: the component
 * gets copied instead of called, then the copy disagrees about a detail.
 *
 * So there is one function and no literal `'cal'` in a span left in the app.
 * Callers pass the size and weight they need; they do not get to pass a colour.
 *
 * The exception is prose. `average cal`, `3 items · 812 cal` and "The
 * arithmetic came to 2100 cal." are sentences, not readings, and a hue inside a
 * sentence is a highlight rather than a label. The word-labelled tables on the
 * food detail screen are the same call, made in the note beside them.
 */
export function macroUnit(macro, cls = '') {
  return h(
    'span',
    { class: cls, style: { color: MACRO_TEXT[macro] } },
    MACRO_META[macro].short
  )
}

/** Digit nodes for a string, for use inside an element that carries .tnum. */
export function digits(text) {
  const holder = h('span')
  setTabularText(holder, text)
  return [...holder.childNodes]
}

/** A number that holds its position as it changes. See `.tnum` in styles.css. */
export function tnum(text, cls = '') {
  return h('span', { class: `tnum ${cls}`.trim() }, ...digits(text))
}

/** The fill shade. For painted areas only — see MACRO_TEXT for type. */
export const macroColor = (macro) => MACRO_VAR[macro]
export const macroTextColor = (macro) => MACRO_TEXT[macro]

/**
 * The darker shade of the same hue. It is the BARS' encoding for the part past
 * the target — `bar-over` and `chip-over`, where it is a fill behind white
 * type and is measured for contrast as such.
 *
 * It is not the rings'. This used to claim the rings carried it on their second
 * lap, and they did, once; the lap now draws in one hue on the same track and
 * says "past target" with a hairline and a bead instead. Two marks, two
 * languages, deliberately — a dense list reads a chip faster than geometry, a
 * single glanceable state reads geometry faster than a chip. What they share is
 * the number, and that comes from `progress().over` for both.
 */
export const macroEdgeColor = (macro) => MACRO_EDGE[macro]

/* ------------------------------------------------------------------ header */

/**
 * The page header. There are exactly two of these and no third.
 *
 * `pageHeader(title)` is the plain one — Trends and Settings, which are the
 * same component and differ in the string and nothing else. There is no second
 * argument for them to differ BY, which is the point of the signature: a page
 * cannot reach in and set its own title size, its own alignment or its own
 * distance from the content under it, because none of those are parameters.
 *
 * `pageHeader(title, days)` adds the day steppers and belongs to Today alone.
 *
 * ---
 *
 * **Today is the template and does not move.** The plain variant used to
 * collapse to its own 32.5px line box while Today's stood 44 tall on the
 * chevrons inside it, and Settings hand-rolled a third arrangement with a
 * `pt-[10px]` of its own — so the one element on all three screens sat at three
 * different heights, and its baseline spread over 10px between tabs. Both
 * variants now hold the same 44px slot, so the baseline is 31.25 everywhere and
 * the first section heading starts at 64. The arithmetic is on `.page-header`.
 *
 * **The title is centred on both, and centring is what makes the two variants
 * agree without any spacers.** The steppers are 44 and the gaps are 10, so the
 * dated variant's title box is inset by the same amount on both sides and its
 * centre is the page's centre — which is exactly where the plain variant, with
 * nothing beside it and the full width to sit in, puts its own. The pair of
 * `w-11` spacers this used to carry existed only to fake that symmetry when one
 * chevron was missing, and with no chevrons at all they were never needed.
 *
 * **`fitText` is the dated variant's alone.** It exists for `Wed, Jan 13, 2027`
 * at 230px in a 227px gap between two chevrons — a real string, reached by
 * paging back months. `Trends` and `Settings` are two short words that fit at
 * 26 with room to spare, and a plain title that could silently render at 25.5
 * on some future longer word is a title that has stopped being 26.
 *
 * Both chevrons are always drawn on the dated variant, the forward one dimmed
 * rather than swapped for a gap. A day view showing one chevron on the left
 * with empty space opposite reads as Back, on the screen where iOS has trained
 * everyone that a lone top-left chevron means exactly that. Two chevrons
 * flanking a date read as a stepper, and the pair stays put as the date changes
 * instead of the header re-forming under the thumb.
 */
export function pageHeader(title, days = null) {
  /**
   * A tappable title carries no mark, and the button sits INSIDE the heading.
   *
   * No chevron beside the date. The row already has two, and a third of the same
   * family reads as a third step rather than as "this opens something" — and the
   * app has made this call before: the day card on Today is a toggle with
   * nothing on it to say so, for the same reason. The cost is the same one
   * written up on `.day-card-toggle` and is stated rather than hidden: nothing
   * advertises the gesture, so it is either already known or never found.
   *
   * `h1 > button` rather than `button > h1` — a heading takes phrasing content
   * and a button is phrasing content, so this nests the way the content model
   * allows. It also leaves `fitText` measuring the same `h1` it always did.
   *
   * The padding-and-negative-margin pair grows the hit area to about 45px
   * without growing the row: the target gets the vertical space, the layout box
   * does not.
   */
  // `truncate` stays as the backstop for anything `fitText` cannot shrink to
  // fit by the floor — better a clipped title than one at 14px.
  const heading = h(
    'h1',
    { class: 'min-w-0 flex-1 truncate text-center text-title font-semibold' },
    days?.onPick
      ? h(
          'button',
          {
            class: '-my-[6px] max-w-full truncate py-[6px]',
            'aria-haspopup': 'dialog',
            'aria-label': `${title}. Pick a day`,
            onclick: days.onPick,
          },
          title
        )
      : title
  )

  if (!days) return h('header', { class: 'page-header' }, heading)

  // Named here rather than passed in. This variant only ever steps days, so a
  // caller supplying the words could only ever supply the same two.
  const btn = (label, handler, name, disabled = false) =>
    h(
      'button',
      { class: 'icon-btn', 'aria-label': label, disabled, onclick: handler },
      icon(name, { size: 20, stroke: 2 })
    )

  return h(
    'header',
    { class: 'page-header' },
    btn('Previous day', days.onPrev, 'chevronLeft'),
    fitText(heading),
    btn('Next day', days.onNext, 'chevronRight', days.nextDisabled)
  )
}

/* -------------------------------------------------------------- macro line */

/**
 * `650 cal · 35 P · 22 F · 70 C`
 * Numbers stay in ink so the data is readable; only the unit carries colour.
 * Fixed order, always.
 */
export function macroLine(totals, { size = 12, muted = false, omit = [] } = {}) {
  const parts = []
  const shown = MACRO_ORDER.filter((m) => !omit.includes(m))
  shown.forEach((macro, i) => {
    const value = macro === 'kcal' ? kcal(totals.kcal) : g(totals[macro])
    if (i > 0) parts.push(h('span', { class: 'text-muted', 'aria-hidden': 'true' }, '·'))
    parts.push(
      h(
        'span',
        { class: 'whitespace-nowrap' },
        h('span', { class: muted ? 'text-muted' : '' }, value),
        ' ',
        macroUnit(macro, 'font-semibold')
      )
    )
  })

  return h(
    'div',
    {
      /**
       * 400, and it moves with the row title above it — see `foodRowBody`.
       *
       * The two were one step apart at 600 and 500, and that step is what keeps
       * a name ahead of its own numbers. Dropping only the title would have put
       * them on the same weight and flattened the row; dropping both keeps the
       * relationship and moves the pair down together.
       *
       * The units do NOT follow. `macroUnit` stays at 600 because it is the
       * only thing on this line carrying colour, and colour here means macro
       * identity — see spec 7. Lightening the anchor with everything else would
       * spend the one distinction the line is built on.
       */
      class: 'flex flex-wrap items-baseline gap-x-[6px] font-normal',
      style: { fontSize: `${size}px` },
      'aria-label': `${kcal(totals.kcal)} calories, ${g(totals.protein)} grams protein, ${g(
        totals.fat
      )} grams fat, ${g(totals.carbs)} grams carbs`,
    },
    parts
  )
}

/* --------------------------------------------------------- the food row */

/**
 * One food, as two lines: what it is, then what it costs.
 *
 * **This is the log's row, generalised.** It was `entryRow`'s inner block and
 * nothing else used it, so every other list of foods in the app grew its own
 * near-copy — the add sheet's Recents at three lines and a 16px name, the
 * plate's items at three lines and a 14px one. They are the same object at
 * three moments of its life: one you might eat, one you are about to eat, one
 * you ate. Three shapes for that is two too many, and the versions drifted
 * because nothing held them together.
 *
 * So the callers keep what genuinely differs — what wraps it and what sits
 * beside it — and this holds what does not.
 *
 * **There are two slots for the qualifier, and which one a caller uses is about
 * how long the qualifier can get.**
 *
 * `detail` sits beside the name after a middot. It is for something short and
 * fixed: a logged entry's time is five characters and never grows, so it costs
 * the name almost nothing and the row stays two lines.
 *
 * `sub` takes a line of its own. It is for the serving, which is the same job —
 * telling you WHICH of this food you are looking at — but a variable-length
 * version of it: `1 × 170 g`, `2 × 450 g`, `1 × 1 biscuit (15 g)`. Put beside
 * the name it truncated the name on most rows, and all three arrangements were
 * built and looked at before this was settled. Sharing the macro line was the
 * worst of them: it fits for short numbers and wraps for long ones, so one list
 * held rows of two different heights with an orphaned middot at the wrap.
 *
 * A clipped name is recognisable from its first two-thirds and a clipped
 * `1 × 2…` is not, so wherever the two do compete the name is what yields:
 * `min-w-0 truncate` on it, `shrink-0` on everything after it.
 *
 * The 2px between lines is deliberate and not 4: they are one thing said in
 * parts, so they want to sit as a block rather than as a list. The weight change
 * from a semibold name to muted figures already separates them.
 */
/**
 * `name` is cased here rather than at the twenty call sites that reach this
 * function, because this is the one place every food row in the app passes
 * through — the log rows, the add sheet's results, the plate. See
 * `displayName`: it is a display rule, the stored record is untouched, and a
 * caller that wants the raw string simply does not render it through a food
 * row. The editable fields are the ones that must not come through here, and
 * they do not: the custom sheet's name input and the meal rename prompt both
 * take the record's own value, because an edit box that shows you something
 * other than what you are editing is a trap.
 */
export function foodRowBody({ name, detail, sub, totals, badge = null, missing = false }) {
  return h(
    'div',
    { class: 'min-w-0 flex-1' },
    h(
      'div',
      {
        /**
         * 500, not 600.
         *
         * This is the app's main body copy — every logged entry, every food in
         * a list — and at 14px semibold it was too dense to be one. SF Text is
         * already the heavier of the family's two optical designs, drawn with
         * more weight at small sizes on purpose, so 600 on top of that thickened
         * the strokes until the name and the macro line under it competed and
         * the row read as two headings rather than a heading and its detail.
         *
         * The other half of the argument is the line itself. `detail` beside it
         * is 400, so the row used to make a two-step jump inside a single line.
         * 500 against 400 is one step, which is all a name needs to lead a
         * timestamp.
         *
         * 400 was drawn and rejected: it matches `detail` exactly, and a name
         * that weighs the same as the time after it stops leading the row.
         */
        class:
          'flex items-baseline text-[14px] font-medium leading-tight' +
          (missing ? ' text-muted line-through' : ''),
      },
      badge,
      h('span', { class: 'min-w-0 truncate' }, displayName(name)),
      detail ? h('span', { class: 'shrink-0 whitespace-pre text-muted' }, ' · ') : null,
      detail ? h('span', { class: 'shrink-0 font-normal' }, detail) : null
    ),
    sub ? h('div', { class: 'mt-[2px] truncate text-[12px] text-muted' }, sub) : null,
    totals ? h('div', { class: 'mt-[2px]' }, macroLine(totals, { size: 12 })) : null
  )
}

/**
 * The mark for macros that came from the model rather than from a database.
 *
 * It goes BEFORE the name, in the `badge` slot of `foodRowBody`, which is what
 * puts it on the plate, on Today and in the full log from one definition. Quick
 * add tiles draw from `foodTile` and so are excluded by construction — a tile is
 * a repeat of something already reviewed, and the space is not there.
 *
 * **Filled, with the stroke off.** `icon()` gives an outline by default and adds
 * the fill on top when asked, so a filled sparkle at this size arrives as a
 * 1.75px stroke around a solid shape — at 14px that is most of the glyph, and
 * the two stars close up into blobs. `stroke: 0` leaves the fill alone.
 *
 * Muted grey rather than a colour. Protein, fat, carbs and calories each own a
 * hue and a fifth accent would be a new term in a system that has four; red in
 * particular is spoken for twice over, by carbs and by everything destructive.
 *
 * `shrink-0`, because the name beside it is `min-w-0 truncate` and a long name
 * must clip rather than squeeze the mark.
 *
 * **14px, and the 2px nudge is measured rather than guessed.** `items-baseline`
 * puts the svg's bottom EDGE on the baseline, and the sparkle art carries about
 * 15% empty height beneath the small star — so the box sits right and the ink
 * floats. Measured at 390pt: the name's cap height is 10.19px and the glyph's
 * ink is 10.09px, which is the size the brief asked for, sitting 1.87px clear of
 * the baseline. `relative top-[2px]` drops it back onto it, so the mark occupies
 * exactly the cap band of the word beside it — same ceiling, same floor.
 *
 * The offset is on the svg and is `position: relative`, not a margin: vertical
 * margins do not apply to inline elements at all, so a `-mb` here would be a
 * line of CSS that reads as an adjustment and does nothing.
 */
export function estimateBadge() {
  return h(
    'span',
    {
      class: 'mr-[4px] shrink-0 text-muted',
      role: 'img',
      // The icon is not the only carrier: the plate keeps its "Estimated" text
      // beside it, and this is what the log rows say in place of one.
      'aria-label': 'Estimated by AI',
    },
    icon('sparkle', { size: 14, filled: true, stroke: 0, class: 'relative top-[2px]' })
  )
}

/* ------------------------------------------------------------------- bars */

/**
 * Where each bar was last drawn, so a re-render resumes from the previous fill
 * instead of replaying from zero. Screens rebuild their whole subtree on any
 * data change, and without this every keystroke elsewhere would re-run the
 * entrance animation — bars animate on value change only.
 */
const lastPct = new Map()

/**
 * A track and an inset fill. Going over fills the track and shows the excess as
 * a chip inside the fill — no colour change, no error state. Over is
 * information.
 *
 * Zero draws no fill at all. A zero-width fill is not invisible: its own 1px
 * stroke collapses into a 2px coloured tick against the left cap, and four of
 * those stacked up on a fresh day read as a rendering fault rather than as
 * "nothing logged". The empty track is the zero state.
 */
export function progressBar({ value, target, macro, animate = true, key = macro }) {
  const { pct, over } = progress(value, target)
  const from = animate ? (lastPct.get(key) ?? 0) : pct
  lastPct.set(key, pct)

  // Kept when it has somewhere to animate FROM, so deleting the last entry
  // still shrinks the bar away instead of snapping.
  const fill =
    pct > 0 || from > 0
      ? h(
          'div',
          {
            class: 'bar-fill',
            style: {
              width: `${from}%`,
              background: MACRO_VAR[macro],
              borderColor: MACRO_EDGE[macro],
              // A 2% sliver would render as a broken-looking nub; below the
              // width of its own cap the fill is better shown as nothing at all.
              minWidth: pct > 0 ? '24px' : '0px',
            },
          },
          // A full-height segment of the darker shade, butted against the fill's
          // right end and clipped to its cap by the fill's own overflow:hidden.
          over > 0
            ? h(
                'span',
                { class: 'bar-over', style: { background: MACRO_EDGE[macro] } },
                `+${over}`
              )
            : null
        )
      : null

  const track = h(
    'div',
    {
      class: 'bar-track',
      role: 'progressbar',
      'aria-valuenow': Math.round(value),
      'aria-valuemin': '0',
      'aria-valuemax': Math.round(target) || 0,
    },
    fill
  )

  if (fill && animate && from !== pct) {
    requestAnimationFrame(() => {
      fill.style.width = `${pct}%`
      // Fades the stroke out with the width, so the shrink does not land on the
      // same 2px tick the zero state exists to avoid.
      if (pct === 0) fill.style.opacity = '0'
    })
  }
  return track
}

/**
 * Coloured macro heading, `consumed / target` beneath it, then the bar.
 * The heading and its numbers are one typographic unit; the 10px gap is
 * between that unit and the bar.
 */
export function macroRow({ macro, value, target }) {
  return h(
    'div',
    { class: 'flex flex-col gap-[10px]' },
    h(
      'div',
      {},
      h(
        'div',
        {
          class: 'text-[16px] font-semibold leading-tight',
          style: { color: MACRO_TEXT[macro] },
        },
        MACRO_META[macro].label
      ),
      h(
        'div',
        { class: 'tnum text-[16px] leading-tight' },
        h('span', { class: 'font-semibold' }, ...digits(`${g(value)}g`)),
        h('span', { class: 'text-muted' }, ...digits(` / ${g(target)}g`))
      )
    ),
    progressBar({ value, target, macro })
  )
}

/**
 * The calories block: the number at display size with the target trailing small
 * and grey, the label beneath it, then a full-width bar.
 */
let lastKcal = 0

export function caloriesBlock({ value, target }) {
  const number = h('span', { class: 'tnum text-display font-semibold' })
  // Same reasoning as the bars: count up from wherever the number last was, so
  // logging one more thing ticks 2255 → 2489 rather than restarting at zero.
  number.dataset.value = String(lastKcal)
  lastKcal = value
  countTo(number, value, { format: (n) => kcal(n) })

  return h(
    'div',
    { class: 'flex flex-col gap-[10px]' },
    h(
      'div',
      {},
      h(
        'div',
        { class: 'flex items-baseline gap-[8px]' },
        number,
        tnum(`/ ${kcal(target)}`, 'text-[16px] text-muted')
      ),
      h(
        'div',
        {
          class: 'text-[16px] font-semibold leading-tight',
          style: { color: MACRO_TEXT.kcal },
        },
        'Calories'
      )
    ),
    progressBar({ value, target, macro: 'kcal' })
  )
}

/* ------------------------------------------------------------------- lists */

export function card(...children) {
  return h('div', { class: 'card' }, children)
}

/**
 * A container whose contents get painted in later, and may stay empty.
 *
 * `empty:hidden` is the whole point. Panels lay out in a `gap` column, and an
 * empty flex child still takes a full gap — so an offline notice that is not
 * showing, or a hint line with nothing to say, silently spends 20px it has no
 * content to justify. Left alone, the sheet's rhythm depends on state nobody
 * can see. Anything painted unconditionally can stay a plain div.
 */
export function slot(className = '') {
  return h('div', { class: `empty:hidden ${className}`.trim() })
}

export function sectionLabel(text, right) {
  return h(
    'div',
    { class: 'flex items-center justify-between gap-[10px]' },
    h('div', { class: 'section-label' }, text),
    right || null
  )
}

/**
 * A row inside a grouped card. Single-line rows are exactly 48px; rows with a
 * subtitle grow. `right` sits at the end, before the chevron.
 */
export function listRow({
  title,
  subtitle,
  right,
  onclick,
  href,
  chevron = false,
  leading,
  dim = false,
}) {
  // A real link, not `window.open`: that is popup-blocked without a user
  // gesture and unreliable from the installed app, and a link is neither.
  const tag = href ? 'a' : onclick ? 'button' : 'div'
  return h(
    tag,
    {
      class: `row${subtitle ? '' : ' row-single'}${dim ? ' opacity-60' : ''}`,
      onclick,
      type: tag === 'button' ? 'button' : null,
      href,
      target: href ? '_blank' : null,
      rel: href ? 'noopener' : null,
    },
    leading || null,
    h(
      'div',
      { class: 'min-w-0 flex-1' },
      h('div', { class: 'truncate text-[16px] font-semibold' }, title),
      subtitle ? h('div', { class: 'truncate text-[12px] text-muted' }, subtitle) : null
    ),
    right || null,
    chevron ? rowChevron() : null
  )
}

/**
 * The disclosure chevron at the end of a row, with its optical correction.
 *
 * **Pulled 7px into the row's own right padding, so the INK lands on the inset
 * rather than the box.** A chevron is 7 units wide in a 24 box, so at `size: 20`
 * it carries about 7px of empty bearing on each flank. The svg's right edge sat
 * exactly on `.row`'s 20px padding, which put the visible glyph 26.7px from the
 * card against a label whose ink starts at 20 — the row read as inset further on
 * the right than the left, which is what it was. Measured at 20.1 now.
 *
 * Optical, not metrical: the box deliberately overhangs the padding. Same
 * correction `.back-btn` makes with its 14/18 padding, for the same reason — a
 * glyph's box is not where the glyph is.
 *
 * **The same 7px on the LEFT flank, because the bearing is symmetrical and the
 * gap next to it was not.** That first paragraph is an argument about a glyph
 * having empty air around it, and it was only ever spent on the flank that
 * meets the card's edge. The other flank meets `.row`'s 10px `gap`, so every
 * value in the app that ends a row — a Settings value, a weigh-in, History's
 * calorie figure — was declaring 10 and drawing about 17. On a row whose other
 * gaps are a true 10 that is the value drifting away from the mark that says
 * the row opens, which is what it was reported as, on History.
 *
 * So the box now overhangs at both ends and the ink sits where the numbers say:
 * 20 from the card on the right, 10 from whatever precedes it on the left.
 * There is no risk of collision in the 7px it takes back — that space is inside
 * the svg and has nothing drawn in it.
 *
 * **A function rather than a line inside `listRow`, because three rows in this
 * app are hand-rolled and cannot use `listRow`.** The Source code row is an
 * `<a href>`, History's day row carries three rings and a figure before its
 * chevron, and the weigh-in row is a swipe target — none of them fit the
 * component, and all three drew their own chevron without the correction. A
 * correction that lives inside one caller is one the other three will keep not
 * getting.
 *
 * No size parameter. It was 20 in three places and 16 in History's row, which is
 * a disclosure affordance meaning the same thing at two sizes; the dense row is
 * an argument for taking something off that row, not for shrinking the one mark
 * that says it opens. The 4px comes out of a `min-w-0 truncate` title, so it
 * costs a slightly earlier ellipsis and nothing else.
 */
export function rowChevron() {
  return icon('chevronRight', { size: 20, class: '-ml-[7px] -mr-[7px] shrink-0 text-muted' })
}

/** Ids for label association. Monotonic, since a rebuild makes new elements. */
let rowSeq = 0

/**
 * A label on the left and an editable value on the right, on one line.
 *
 * This is `listRow` with its `right` slot handed an input instead of a static
 * span — the same `.row` in the same `card()`, so the hairline between rows,
 * the outer inset and the corner radius all come from rules that already exist.
 * The only new idea is that the value on the right is typed into.
 *
 * The row IS a `<label>`, which is what makes "tap the row to edit" true with
 * no JavaScript, no focus handler and nothing that could shift the layout: the
 * input was always live and always in place, it simply was not wearing a pill.
 * `for` is redundant beside the wrapping and kept anyway — the association is
 * the requirement, the mechanism is not.
 *
 * Pair it with `numberInput({ bare: true })`, which is the value side of the
 * same idea.
 *
 * `color` tints the LABEL only, and takes a `MACRO_TEXT` value rather than a
 * fill — see the note on that table for why the fills cannot carry type. The
 * split is the one `macroRow` and `caloriesBlock` already use on Today: the
 * macro's name carries its colour, the number stays in ink so it is readable.
 */
export function valueRow(label, control, { color } = {}) {
  const inputs = [...control.querySelectorAll('input')]
  const first = control.input ?? inputs[0]
  if (first && !first.id) first.id = `field-${++rowSeq}`

  /**
   * Two inputs under one label is the imperial height row, where the wrapping
   * label names both of them and neither says which one is feet. The suffix
   * beside each is on screen doing that job and is invisible to anything not
   * looking at it.
   */
  if (inputs.length > 1) {
    for (const input of inputs) {
      const unit = input.nextElementSibling?.textContent
      input.setAttribute('aria-label', unit ? `${label}, ${unit}` : label)
    }
  }

  return h(
    'label',
    { class: 'row', for: first?.id ?? null },
    h(
      'span',
      {
        class: 'min-w-0 flex-1 truncate text-[16px] font-semibold',
        style: color ? { color } : null,
      },
      label
    ),
    control
  )
}

/**
 * The way back from a pushed screen.
 *
 * Top-left, naming where it goes rather than saying "Back" — on a stack exactly
 * one deep, the name of the parent is more use than the direction. It was
 * written twice inside the food library before Settings grew subpages that
 * wanted the same thing; this is that, once.
 *
 * **It is Today's chevron button with the label brought inside it.** The icon
 * and its size are `pageHeader`'s exactly — `size: 20, stroke: 2` — and the
 * capsule is `.icon-btn`'s fill and radius stretched to hold the word. Before
 * this it was a bare 18px chevron beside 12px type on the page tint, which is
 * the one arrangement in the app that had no fill at all: the only control on
 * the screen, drawn quieter than the body text under it. See `.back-btn`.
 *
 * Deliberately not `pageHeader`. That is a fixed 44px slot with a centred title
 * in it, and these screens carry their own large title beneath this row — the
 * pill is a control at the start of the page, not a header the page hangs from.
 * A pushed screen is the one place the app still has a third title arrangement,
 * and it is out of scope of the two-variant rule rather than an exception to it.
 *
 * No `pt` of its own any more. At 25px tall it needed the nudge to sit where a
 * header would; at 44 it IS that height, so it starts flush at the screen's own
 * 20px inset and lands on the same line as Today's chevron.
 *
 * The caller passes the handler rather than a route, so this file keeps out of
 * the router — `ui.js` knows how things look and nothing about where they go.
 */
export function backRow({ label, onclick }) {
  return h(
    'button',
    { class: 'back-btn self-start', type: 'button', onclick },
    icon('chevronLeft', { size: 20, stroke: 2 }),
    label
  )
}

export function emptyRow(text, { action, onAction } = {}) {
  return h(
    'div',
    { class: 'row justify-between' },
    h('span', { class: 'text-[14px] text-muted' }, text),
    action
      ? h(
          'button',
          { class: 'chip-sm', onclick: onAction },
          action
        )
      : null
  )
}

/** A full-screen "nothing here yet" state. Text only, no illustration. */
export function emptyState(title, body, action) {
  return h(
    'div',
    { class: 'flex flex-col items-center gap-[10px] px-[20px] py-[50px] text-center' },
    h('p', { class: 'text-[16px] font-semibold' }, title),
    h('p', { class: 'text-[14px] leading-snug text-muted' }, body),
    action || null
  )
}

/* ---------------------------------------------------------------- controls */

/** Scrolling row of pill chips. Selected chip goes solid ink. */
export function segmented({ options, value, onChange, class: cls = '' }) {
  return h(
    'div',
    { class: `flex gap-[10px] overflow-x-auto no-scrollbar ${cls}` },
    options.map((opt) =>
      h(
        'button',
        {
          class: 'chip',
          'aria-pressed': String(opt.value === value),
          onclick: () => onChange(opt.value),
        },
        opt.label
      )
    )
  )
}

/**
 * The pill each segmented control is currently using, so its replacement can
 * pick up exactly where it left off.
 *
 * The same problem `progressBar` solves with `lastPct`, and harder. Almost
 * every caller repaints this control inside its own `onChange` — `paint()`,
 * `paintUnits()`, `rerender()` — so the element that was clicked is thrown away
 * mid-slide, and a screen rebuild behind an IndexedDB write can take half a
 * second to arrive. Remembering the chosen INDEX is not enough: the outgoing
 * pill is somewhere between two segments by then, and starting the new one at a
 * whole index snaps it backwards or forwards to a position the eye was not
 * expecting.
 *
 * So what is remembered is the element, and what is read off it is the live
 * transform — wherever it had actually travelled to at the instant it was
 * replaced. The new pill starts there and carries on. Two elements, one
 * continuous movement.
 *
 * Keyed by the option values, which identify a control well enough: no screen
 * carries two segmented controls offering the same choices.
 */
const lastSegmentPill = new Map()

/** The px offset an element is currently painted at, mid-transition included. */
function translateXOf(el) {
  const matrix = getComputedStyle(el).transform
  const values = matrix?.match(/matrix\(([^)]+)\)/)
  return values ? parseFloat(values[1].split(',')[4]) || 0 : 0
}

/**
 * Full-width segmented control that splits the row evenly.
 *
 * The selection is one pill that slides, not a background switched on and off
 * per segment — the argument is written out on `.tab-pill` and applies here
 * unchanged. A pill that travels says the selection MOVED and says which way it
 * came from; a background appearing somewhere else says two unrelated things
 * happened.
 *
 * Nothing is selected when `value` matches no option, which is a real state —
 * sex is unset until someone sets it. The pill fades rather than sliding in
 * from a position it was never at.
 */
export function segmentedWide({ options, value, onChange, key }) {
  const id = key ?? options.map((opt) => opt.value).join('|')
  const selected = options.findIndex((opt) => opt.value === value)

  const pill = h('span', { class: 'segment-pill', 'aria-hidden': 'true' })
  const outgoing = lastSegmentPill.get(id)
  const resumeFrom = outgoing?.isConnected ? translateXOf(outgoing) : null
  lastSegmentPill.set(id, pill)

  const buttons = options.map((opt, i) =>
    h(
      'button',
      {
        class: 'segment',
        'aria-pressed': String(i === selected),
        onclick: () => {
          onChange(opt.value)
          /**
           * Moved here and now, rather than waiting for the caller's repaint.
           * That repaint is usually behind a database write, and half a second
           * of nothing after a tap is what makes a control feel broken. The
           * replacement inherits this pill's position mid-flight, so starting
           * the movement early costs the handoff nothing.
           */
          requestAnimationFrame(() => {
            if (!track.isConnected) return
            place(i)
            buttons.forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)))
          })
        },
      },
      opt.label
    )
  )

  const track = h('div', { class: 'segmented' }, pill, buttons)
  track.style.setProperty('--seg-n', String(options.length))

  function place(index) {
    track.dataset.selected = index < 0 ? 'none' : 'one'
    if (index >= 0) track.style.setProperty('--seg-i', String(index))
  }

  place(selected)

  /**
   * Pinned to where the outgoing pill had actually reached, then released on
   * the next frame so the CSS transition carries it the rest of the way. With
   * no predecessor there is nothing to resume from and it simply appears in
   * place — a control arriving on screen has not chosen anything, it is showing
   * what was chosen.
   */
  if (resumeFrom != null) {
    pill.style.transition = 'none'
    pill.style.transform = `translateX(${resumeFrom}px)`
    requestAnimationFrame(() => {
      void pill.offsetWidth
      pill.style.transition = ''
      pill.style.transform = ''
    })
  }

  return track
}

/* Removed in v1.2.1. Its one caller was the day card's Eaten / Remaining
   switch, and that control is gone — see `modeDots` in screens/today.js for
   what replaced it and why. */

/**
 * `color` tints the LABEL only, and takes a `MACRO_TEXT` value rather than a
 * fill — the same option `valueRow` carries, for the same reason and with the
 * same rule. A field named for a macro says which macro in the hue the app uses
 * everywhere else for that; the number inside it stays in ink so it is
 * readable. `macroRow` and `caloriesBlock` on Today are the original of this
 * split, and `valueRow` is how the Settings targets take it.
 *
 * Fields that are not macros pass nothing and get the ordinary ink label.
 */
export function labelledField({ label, hint, children, color }) {
  return h(
    'label',
    { class: 'flex flex-col gap-[10px]' },
    h(
      'span',
      { class: 'text-[14px] font-semibold', style: color ? { color } : null },
      label
    ),
    children,
    hint ? h('span', { class: 'text-[12px] text-muted' }, hint) : null
  )
}

/**
 * A labelled on/off row.
 *
 * The app's other binary is `segmented`, which names both sides and demands a
 * choice — right for "per serving or per 100", where neither is a default and
 * getting it wrong changes what the numbers mean. This is for the other kind:
 * one side is the ordinary case and the other is an opt-in, and the control
 * should be quiet about it rather than asking every time.
 *
 * A switch rather than a checkbox, because "off" here is not "unticked, please
 * tick" — it is a complete, correct answer.
 *
 * A native `<input type="checkbox" switch>` under the drawn control — review
 * finding 8. This was a button with `role="switch"`, and the input keeps that
 * meaning: WebKit exposes the `switch` attribute as a switch, not a checkbox.
 * What the native element adds is the one haptic the platform gives a web page
 * at all — iOS plays its toggle haptic when a `switch` input flips under a
 * finger, and `navigator.vibrate` does nothing there, so this is the only
 * control in the app that can be felt. The input is invisible, keeps its
 * native appearance so the renderer that owns the haptic stays alive, and
 * covers the whole drawn control at the 44px hit size, so the finger lands on
 * the native element itself rather than on a label forwarding to it.
 * `:has(:checked)` draws the state. Unverified on a phone at the time of
 * writing: the control works identically either way, and the haptic is the
 * platform's to give.
 */
export function switchRow({ label, hint, checked = false, onChange }) {
  const input = h('input', {
    type: 'checkbox',
    switch: true,
    class: 'switch-input',
    'aria-label': label,
    checked,
    onchange: () => onChange?.(input.checked),
  })
  const control = h('label', { class: 'switch' }, input, h('span', { class: 'switch-knob' }))

  return h(
    'div',
    { class: 'flex items-center gap-[20px]' },
    h(
      'div',
      { class: 'flex min-w-0 flex-1 flex-col gap-[2px]' },
      h('span', { class: 'text-[14px] font-semibold' }, label),
      hint ? h('span', { class: 'text-[12px] leading-snug text-muted' }, hint) : null
    ),
    control
  )
}

/**
 * `bare` drops the pill and right-aligns the number.
 *
 * For a field that sits in the value slot of a `.row` rather than under a label
 * of its own. The row's card is already the container, so a `.field` inside one
 * draws a second box around the first — and a pill at full row width says "type
 * here" about a number that is mostly there to be read.
 *
 * The width has to be stated because a bare `type="number"` sizes itself to
 * roughly twenty characters and there is no `size` attribute for it. 76 is the
 * same numeric column the food detail table already uses, and it holds four
 * digits with room; the imperial height pair passes something narrower, since
 * `5` in a 76px box sits an inch away from its own `ft`.
 *
 * The default placeholder is an em dash rather than `0` because almost every
 * number this app asks for can genuinely be zero — 0 g of fat, a 0 cal drink,
 * midnight as the hour a block starts — so a greyed `0` in an empty field is
 * not a prompt, it is a wrong answer that someone has to notice is not theirs.
 * A dash cannot be mistaken for data. Callers pass a placeholder only when the
 * number is a real suggestion (`1` serving, a `100` g basis), where the point
 * is to show what a plausible answer looks like.
 */
export function numberInput({
  value,
  onInput,
  placeholder,
  suffix,
  /**
   * The macro whose hue the suffix carries, when the suffix IS a macro's unit.
   * `cal` after a calorie field is the same token as `cal` after the hero
   * number two screens away and reads in the same colour. `g`, `mg`, `cm` and
   * `ft` are units of measure and stay muted — the hue means macro identity,
   * and a green `g` would mean nothing.
   */
  suffixMacro = null,
  step = 'any',
  bare = false,
  width = 76,
  ...rest
}) {
  const input = h('input', {
    class: bare
      ? 'shrink-0 text-right text-[16px] font-semibold'
      : 'w-full min-w-0 text-[16px] font-semibold',
    style: bare ? { width: `${width}px` } : null,
    type: 'number',
    inputmode: 'decimal',
    step,
    value: value ?? '',
    placeholder: placeholder ?? '—',
    oninput: (e) => onInput?.(e.target.value, e),
    ...rest,
  })
  const wrapper = h(
    'div',
    { class: bare ? 'flex shrink-0 items-center gap-[10px]' : 'field' },
    input,
    suffix
      ? suffixMacro
        ? macroUnit(suffixMacro, 'shrink-0 text-[14px] font-semibold')
        : h('span', { class: 'shrink-0 text-[14px] text-muted' }, suffix)
      : null
  )
  // Callers that need to write a new value back (the unit toggle converting
  // 2 servings into 60 g) need the field itself, not the wrapper.
  wrapper.input = input
  return wrapper
}

/**
 * A day. Native `type="date"` rather than a hand-rolled calendar: it is the one
 * control where the platform picker is unambiguously better than anything worth
 * building here, and it comes with the locale's own date order for free.
 */
export function dateInput({ value, max, min, onChange }) {
  const input = h('input', {
    class: 'w-full min-w-0 bg-transparent text-[16px] font-semibold',
    type: 'date',
    value: value ?? '',
    max: max ?? null,
    min: min ?? null,
    onchange: (e) => onChange?.(e.target.value, e),
  })
  const wrapper = h('div', { class: 'field' }, input)
  wrapper.input = input
  return wrapper
}

/**
 * Height, in one field or two depending on the units preference.
 *
 * The two imperial fields are one measurement, so they report a single value in
 * centimetres and the caller never sees feet or inches at all. Inches over 11
 * are accepted while typing and carried on blur — normalising mid-keystroke
 * would move the digits under the finger, and 5 ft 13 in is a legible thing to
 * be halfway through typing.
 *
 * Neither imperial field suggests a number any more. `5` and `11` were the most
 * convincing placeholders in the app — a real height is a small number of feet
 * and a number of inches under twelve, so the suggestion and the answer were
 * the same shape, and an untouched pair read as 5 ft 11 in rather than as blank.
 * Both fall through to the dash `numberInput` uses everywhere else.
 */
export function heightInput({ cm, units, onChange, bare = false, placeholder }) {
  if (units !== 'imperial') {
    return numberInput({
      value: cm == null ? '' : round(cm, 1),
      suffix: 'cm',
      bare,
      placeholder,
      onInput: (v) => onChange(v === '' ? null : Number(v)),
    })
  }

  const start = cm == null ? { ft: '', in: '' } : cmToFtIn(cm)
  let ft = String(start.ft)
  let inches = String(start.in)

  const emit = () =>
    onChange(ft === '' && inches === '' ? null : ftInToCm(ft, inches))

  const normalise = () => {
    if (ft === '' && inches === '') return
    const carried = cmToFtIn(ftInToCm(ft, inches))
    ft = String(carried.ft)
    inches = String(carried.in)
    ftField.input.value = ft
    inField.input.value = inches
    emit()
  }

  const ftField = numberInput({
    value: ft,
    suffix: 'ft',
    step: '1',
    placeholder,
    bare,
    width: 40,
    onInput: (v) => {
      ft = v
      emit()
    },
    onblur: normalise,
  })

  const inField = numberInput({
    value: inches,
    suffix: 'in',
    step: '1',
    placeholder,
    bare,
    width: 40,
    onInput: (v) => {
      inches = v
      emit()
    },
    onblur: normalise,
  })

  return bare
    ? h('div', { class: 'flex shrink-0 items-center gap-[10px]' }, ftField, inField)
    : h(
        'div',
        { class: 'flex gap-[10px]' },
        h('div', { class: 'min-w-0 flex-1' }, ftField),
        h('div', { class: 'min-w-0 flex-1' }, inField)
      )
}

export function textInput({ value, onInput, placeholder, ...rest }) {
  const input = h('input', {
    class: 'w-full min-w-0 text-[16px] font-semibold',
    type: 'text',
    value: value ?? '',
    placeholder: placeholder ?? '',
    oninput: (e) => onInput?.(e.target.value, e),
    ...rest,
  })
  const wrapper = h('div', { class: 'field' }, input)
  wrapper.input = input
  return wrapper
}

/** Time-block picker, prefilled by the clock but always overrideable. */
export function blockSelector({ value, onChange, blockNames }) {
  return segmentedWide({
    options: ['morning', 'afternoon', 'night'].map((b, i) => ({
      value: b,
      label: blockNames[i],
    })),
    value,
    onChange,
  })
}

/**
 * A non-blocking notice. Used for OFF data that looks wrong, offline states,
 * and the iOS install hint. Ink and grey — never red, never an alert colour.
 */
export function notice(text, { iconName = 'info', action, onAction } = {}) {
  return h(
    'div',
    /**
     * 20 all round, which is the inset every other container in this app takes
     * — the day card, a card's own top and bottom rows, the sheet gutters.
     *
     * It was `min-h-[48px]` with `px-20 py-10`, on the argument that a notice
     * should be the same box as a `.row` so it lines up with the rows in the
     * card beneath it. Two things were wrong with that. It does not line up: a
     * notice carries an icon, so its text starts 50px from the panel edge
     * against a row's 20, and the only thing the 48 ever matched was height.
     * And the pair fought each other — `min-height` held a short notice open at
     * 48 while `items-start` pinned the words to the top, so one line sat with
     * **10 above and 18.8 below**, while three lines sat at 10 and 10 against
     * sides of 20. The vertical inset was not merely small, it CHANGED with the
     * length of the sentence, and was tightest exactly when the box was fullest.
     *
     * One number in all four directions cannot do that. `min-height` goes with
     * it as redundant: 20 + content + 20 clears 48 on its own.
     *
     * A single-line notice still comes out about 1.8px deeper below than above.
     * That is the icon — 20px plus a 1px optical nudge, against a 19.25px line
     * box — and it is left alone on purpose. Pinning the text to the icon's
     * height would fix one line and break every wrapped one.
     */
    { class: 'panel flex items-start gap-[10px] p-[20px]' },
    icon(iconName, { size: 20, class: 'mt-px shrink-0 text-muted' }),
    h(
      'div',
      { class: 'flex-1 text-[14px] leading-snug' },
      text,
      /**
       * The chip goes in a block of its own, and it has to.
       *
       * `chip-sm` is `inline-flex`, so as a direct sibling of a text node it
       * joins the paragraph and lays out as the last word of the sentence — on
       * its own line only while the text happened to fill the last one. The
       * first notice long enough to wrap tightly landed the chip mid-line
       * beside "without Gemini.", with the `mt-[10px]` pushing the whole line
       * box down and opening a gap through the middle of the sentence.
       *
       * A wrapper makes the margin do what it was always written to do: put
       * the action under the words rather than after them.
       */
      action
        ? h(
            'div',
            { class: 'mt-[10px]' },
            h('button', { class: 'chip-sm', onclick: onAction }, action)
          )
        : null
    )
  )
}

/**
 * What a button says while the thing it started is still happening.
 *
 * **The wait belongs to the control that began it.** This was a panel above the
 * field for one afternoon, and that was wrong: it left a dead greyed button
 * sitting underneath a box describing what the button was doing. The button
 * already claims the work, it is already about to grey out, and a stage
 * somewhere else is a second object saying the same thing in a worse place.
 *
 * There is no second line naming what is in flight, and there does not need to
 * be. Both callers have it on screen already — Describe has the sentence in the
 * field directly above, the plate has the rows the button counts.
 *
 * The mark INHERITS its colour rather than taking `text-muted` the way
 * `estimateBadge` does. There it is a note about where numbers came from and
 * belongs a step behind the words; here it is inside a control, and a glyph in
 * a different ink from the label beside it reads as something dropped in from
 * elsewhere.
 *
 * **The label is exposed rather than passed in on every change.** A long wait
 * rewrites it twice, and rebuilding this would restart both animations from
 * zero each time — a mark that resets its cycle at the six second mark is the
 * app announcing something that did not happen. Built once, edited in place.
 */
export function busyLabel(text) {
  const label = h('span', {}, text)
  const el = h(
    'span',
    {
      class: 'flex items-center justify-center gap-[10px]',
      // The copy changing is the only thing that happens during a long wait, so
      // it is what gets announced. `polite`, because nothing here interrupts.
      role: 'status',
      'aria-live': 'polite',
    },
    h('span', { class: 'sparkle-wait shrink-0' }, sparkleHalf('big'), sparkleHalf('small')),
    label
  )
  el.label = label
  return el
}

/* `spinner()` was removed in v1.2.3. It had no callers and never had — the app
   is local-first and the two places that do wait on something (the barcode
   lookup, the Gemini call) draw their own stage with the thing being waited on
   named in it, which is more use than the word "Loading". Its `py-[40px]` was
   the only 40 in the app and the third of three different paddings for a
   centred "nothing here" block; deleting it left `emptyState`'s 50 as the
   single value for that job. */
