import { h, repaint, countTo, setTabularText, haptic, swipePages } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import {
  listEntries,
  getSettings,
  saveCardMode,
  quickAddFoods,
  firstLoggedDate,
  deleteEntry,
  saveSettings,
} from '../lib/db.js'
import { sumEntries, progress, computeMacros, MACRO_META } from '../lib/compute.js'
import { macroRing } from '../lib/ring.js'
import { tnum, card, emptyRow, macroTextColor, pageHeader, slot } from '../lib/ui.js'
import { foodTile } from '../lib/foodTile.js'
import { kcal, qty, servingLabel, unitLabel, displayName } from '../lib/format.js'
import { formatDayHeader, isToday, addDays, blockForTime } from '../lib/dates.js'
import { entryRow } from '../lib/entryRow.js'
import { deleteEntryWithUndo, openDuplicateSheet } from '../lib/entryActions.js'
import { quickLogFood, defaultServing } from '../lib/logging.js'
import { toast } from '../lib/toast.js'
import { openEditEntry, openServingSheet } from '../sheets/serving.js'
import { openAddFood } from '../sheets/addFood.js'
import { openLogSheet } from '../sheets/log.js'
import { openSheet } from '../lib/sheet.js'
import { datePickerPanel } from '../lib/datePicker.js'
import { state, setDate } from '../state.js'
import { isIOS, isStandalone } from '../lib/platform.js'
import { icon } from '../lib/icons.js'

/**
 * Today. A dashboard card, then the log.
 *
 * Calories is the summary and the macros are the breakdown that explains it,
 * so calories gets the number and the full-width bar while the macros get
 * three equal rings. Splitting the log into its own group is what lets the
 * dashboard be the thing you actually came for.
 *
 * ---
 *
 * The card states every value exactly once, and one switch changes WHICH value
 * that is: eaten, or remaining, everywhere at once.
 *
 * It used to say each one three times over. Calories read `1105`, then
 * `/ 2837`, then `-1732` at the end of the row; each ring read `115 / 180` and
 * then `65 left` underneath. Every one of those is the same fact — you have
 * eaten some of a number — and the third statement of a fact is not emphasis,
 * it is noise. The gap and the `left` line are gone.
 *
 * What makes that affordable is that the other reading stays reachable. Saying
 * it once is only economy if you can still ask for the half that is not on
 * screen, and both readings are one touch apart, neither permanently occupying
 * space to say what the other already said.
 *
 * Which one leads is not arbitrary. Eaten runs with its own arc — the number
 * grows as the ring fills — where remaining runs against it, counting down all
 * day while the mark beside it counts up. That disagreement is the reason
 * remaining is not the first-run default, and it stops being a problem the
 * moment it is the reading you asked for rather than the one you were handed.
 *
 * ---
 *
 * **How you get to the other reading has now been through six answers**, and
 * has arrived back where it started. The order is the useful part, because each
 * one only looked wrong once it existed:
 *
 *   1. A bare tap on the card, nothing on screen to say so — undiscoverable.
 *   2. A segmented Eaten / Remaining switch — redundant with the tap, redundant
 *      with the reading, and the reason the header band was as tall as it was.
 *   3. Two paging dots — on a card that pages horizontally with yesterday
 *      peeking in at the left, which made them read as "swipe for more cards".
 *   4. A vertical swap glyph — no longer a paging signal, still an object.
 *   5. A muted state label in the corner — the best of them, and still a fifth
 *      statement of a reading the card already gives four times.
 *   6. The bare tap again.
 *
 * Five of the six were built and looked at rather than argued about, which is
 * the only reason the sixth is a decision instead of the thing nobody got round
 * to. What is left underneath it is `modeReach`: a control with no pixels, so
 * the reading stays reachable without anything claiming space to say so.
 *
 * The discoverability problem is real and is now openly unsolved. See
 * `modeReach`.
 */

/**
 * Which reading the card is showing. Module scope, not screen scope, because
 * `createScreen` rebuilds the whole tree on every data change — logging a
 * banana would otherwise snap the card back under your thumb.
 *
 * Seeded from settings on every build, so the stored preference wins on first
 * paint and the module copy is what every render in between reads. There is no
 * frame of the wrong mode to fix afterwards: the build already awaits
 * `getSettings` for the targets, and nothing mounts until that resolves.
 */
let cardMode = 'consumed'

const MODE_OPTIONS = [
  { value: 'consumed', label: 'Eaten' },
  { value: 'remaining', label: 'Remaining' },
]

/**
 * Seeded from the store ONCE per session, on the first build, and not read from
 * settings again after that.
 *
 * The module copy is authoritative from then on, and it has to be: a build can
 * be triggered by a date swipe milliseconds after the switch was pressed, while
 * the write is still in flight, and re-reading settings there would hand back
 * the value the tap just replaced and snap the card under the thumb. The write
 * is one-way traffic — this screen is the only thing that sets `cardMode` and
 * the only thing that reads it.
 *
 * The cost is that a data import does not adopt the imported reading until the
 * next launch, which is the smallest thing in a backup and the one nobody
 * restores a backup for.
 */
let modeSeeded = false

/**
 * True only for the repaint a mode switch causes, and false again by the end of
 * it. Two things read it, and both are about the same distinction: **a mode
 * switch is not a data change.**
 *
 * The card cannot tell the difference on its own — it gets rebuilt either way,
 * with different numbers in it either way — so it has to be told, or it treats
 * "you asked a different question" exactly like "you ate something".
 */
let modeSwap = false

/**
 * The way to the other reading, for anything that is not a thumb.
 *
 * **Nothing visible marks the switch.** Four things were built and none of them
 * earned the space: a segmented Eaten / Remaining control, two paging dots, a
 * vertical swap glyph, and a muted state label in the corner. The sheet that
 * killed the last of them is in NOTES-use-audit.md, U2.
 *
 * The argument that outlived all four is the card's own, from the top of this
 * file: it already states its reading in words, in four places at once —
 * `1236 over` against `4073 / 2837`, and the same inside every ring. A control
 * that names the reading is the fifth statement of a fact the card was
 * deliberately rebuilt to stop saying twice, and every version of it read as
 * one more object on a card that had just been cleared of two.
 *
 * So the tap stands alone again, and this is what is left underneath it: a
 * control with no pixels, so that the reading is still reachable by keyboard
 * and still announced to a screen reader. Removing the visible one is a design
 * decision; removing the only way in is a regression, and they are not the same
 * edit.
 *
 * **The open cost, stated rather than hidden:** nothing on the screen says the
 * card can be tapped. `.day-card-toggle` in styles.css has admitted that since
 * it was written — "a press only answers the question after you have already
 * asked it" — and it is still true and still unsolved. A first-click test is
 * what would settle whether anyone finds it, and none of the four candidates
 * was worth shipping to avoid running one.
 */
function modeReach(mode, onMode) {
  const other = MODE_OPTIONS.find((o) => o.value !== mode)
  return h(
    'button',
    {
      type: 'button',
      class: 'reach-only',
      onclick: (e) => {
        // The card underneath is a toggle too; without this a press would flip
        // the mode and have the card flip it straight back.
        e.stopPropagation()
        onMode(other.value)
      },
    },
    `Show ${other.label.toLowerCase()}`
  )
}

function seedMode(settings) {
  if (modeSeeded) return
  modeSeeded = true
  if (MODE_OPTIONS.some((o) => o.value === settings.cardMode)) cardMode = settings.cardMode
}

/**
 * Which entries were not on screen a moment ago, so a new row can arrive rather
 * than appear.
 *
 * **Read from the DOM, not from a module-scoped memory, and that is the whole
 * design.** A remembered id set was written first and was wrong on the app's
 * most common action. `createScreen` serialises renders and DISCARDS one that
 * was superseded mid-flight — and `quickLogFood` writes twice, the entry and
 * then the food's recency, so logging emits two changes. The first build sees
 * the new id and is thrown away before it paints; the second build finds the id
 * already recorded and animates nothing. Every quick add took that path.
 *
 * The document does not have that problem. A build that is discarded never
 * touches it, so what is mounted is exactly what the user is looking at, which
 * is the only thing "was this row already there" can honestly mean.
 *
 * **Ids rather than a newest-timestamp**, because Undo restores a deleted
 * record verbatim — original id, original `createdAt` — so "newer than anything
 * we have seen" would miss the one case where a row coming back is the entire
 * point of the offer.
 *
 * **A date change animates nothing.** Every row on the day you just swiped to
 * is new by this test, and eight rows arriving at once is not an insertion, it
 * is a screen. The mounted list carries the day it was built for, so the
 * comparison is against what is on screen rather than against a second
 * remembered value that could drift from it.
 *
 * Scoped to `[data-today-log]`, which only this screen sets. The Full log sheet
 * builds `entryRow`s too, and an unscoped query would let the rows behind a
 * scrim answer for the rows in front of it.
 */
/**
 * Ids caught mid-arrival, and how long they stay that way.
 *
 * **Logging renders Today TWICE.** `quickLogFood` writes the entry and then the
 * food's recency, and both emit — so the first render mounts the new row with
 * its animation, and a second render lands about a frame later. By then the row
 * IS painted, so the DOM check below correctly reports nothing new, rebuilds the
 * list without the class, and destroys the animation before it has run a frame.
 *
 * The document is still the right thing to ask; it just has to be asked about a
 * window rather than an instant. A row stays "arriving" for slightly longer than
 * the animation it is playing, so a re-render inside that window re-applies the
 * class instead of cancelling it. Past the window it is simply a row.
 *
 * 300 against the 200ms of `row-in`, which leaves room for the second render to
 * be a few frames late without leaving so much that an unrelated repaint could
 * fall inside it.
 *
 * The restart this causes is invisible in practice — the second mount is
 * sub-frame — but it is a restart, and if the double render is ever collapsed
 * into one emit this whole map can go with it. That would be the better fix and
 * it belongs in the write path, not here: two full IndexedDB reads and two full
 * tree rebuilds per logged item is a cost this screen pays whether or not
 * anything is animating.
 */
const ARRIVAL_GRACE_MS = 300
const arriving = new Map()

/**
 * The day the card on screen is currently showing, or null on first paint.
 *
 * Read from the mounted list's own stamp for the reason `freshEntryIds` gives:
 * a render that gets discarded before it paints must not be able to claim the
 * day moved. Both callers read it before the new tree is built, while the
 * outgoing one is still the document.
 */
function paintedDate() {
  return document.querySelector('[data-today-log]')?.dataset.todayLog ?? null
}

function freshEntryIds(date, entries) {
  const now = performance.now()
  for (const [id, at] of arriving) {
    if (now - at > ARRIVAL_GRACE_MS) arriving.delete(id)
  }

  const list = document.querySelector('[data-today-log]')
  if (!list || list.dataset.todayLog !== date) {
    arriving.clear()
    return new Set()
  }

  const painted = new Set(
    [...list.querySelectorAll('[data-entry-id]')].map((el) => el.dataset.entryId)
  )
  const fresh = new Set(entries.filter((e) => !painted.has(e.id)).map((e) => e.id))
  for (const id of fresh) arriving.set(id, now)

  // Still arriving, even though it is on screen now: this is the second render
  // of the pair, and the row it is about to replace is mid-animation.
  for (const [id] of arriving) {
    if (entries.some((e) => e.id === id)) fresh.add(id)
  }
  return fresh
}


function calorieBlock({ live = true }) {
  /**
   * Built once, then written to. The four marks that move — the number, its
   * qualifier, the bar and the overage chip — are the same elements for the life
   * of the card, so each one remembers where it was last drawn and there is no
   * module-scoped memory to keep in step with it.
   *
   * `lastKcal` and `lastKbarPct` are gone with this. Both existed to carry a
   * value across a rebuild that no longer happens, and both carried a hazard
   * with them: only the LIVE card was allowed to write, because a neighbour that
   * did would leave its own total behind as the next card's starting point. Per
   * element, that cannot arise — each card remembers itself.
   *
   * What does NOT come for free is the two suppressions those memories also
   * carried, and they are the reason this is not simply a deletion. See `update`.
   */
  const number = h('span', { class: 'tnum text-display font-semibold' })
  const qualifier = tnum('', 'text-[16px] text-muted')
  const controlSlot = h('div', { class: 'contents' })
  const over = h('span', { class: 'kbar-over' })
  const fill = h('div', { class: 'kbar-fill', style: { width: '0%' } })
  const reading = h('div', { class: 'reading flex items-baseline gap-[8px]' }, number, qualifier)
  const bar = h(
    'div',
    { class: 'mt-[10px] kbar', role: 'progressbar', 'aria-valuemin': '0' },
    fill
  )

  const el = h(
    'div',
    {},
    // The label and the switch share a top edge, and the switch — the taller of
    // the two — is what the band is as tall as. The hero then starts at the
    // bottom of that band, so the number clears the control instead of running
    // up alongside it.
    //
    // `items-start` rather than `items-center` for exactly that reason: centred,
    // the switch hangs 4px below the label and the digits crowd it from
    // underneath. And no gap under the band at all — the label and the number
    // are one typographic unit, and the space the switch already contributes is
    // the only separation they need.
    //
    // The switch is opposite the label rather than under the number because the
    // label is the only thing up here at its own weight; anything nearer the
    // hero would argue with the one mark the card exists to show.
    h(
      'div',
      { class: 'flex items-start justify-between gap-[10px]' },
      h(
        'div',
        {
          class: 'text-[16px] font-semibold leading-tight',
          style: { color: macroTextColor('kcal') },
        },
        MACRO_META.kcal.label
      ),
      controlSlot
    ),
    reading,
    bar
  )

  const update = ({ value, target, mode, control = null, swapping = false, animate = true }) => {
    const { pct, over: overBy } = progress(value, target)
    // Round the operands, then difference — same rule the rings use.
    const diff = Math.round(Number(value) || 0) - Math.round(Number(target) || 0)
    const remainingMode = mode === 'remaining'
    const shown = remainingMode ? Math.abs(diff) : value

    /**
     * The two suppressions, re-earned rather than inherited.
     *
     * They used to be a side effect of the rebuild: the number was a new element
     * every time, so it only counted from wherever `lastKcal` said, and seeding
     * that with the destination made it write outright instead. Now the element
     * survives and remembers on its own, which means it counts BY DEFAULT — and
     * the two cases that must not count are exactly the two that were hardest to
     * get right.
     *
     * **A mode switch does not count.** Counting means the number changed; on a
     * toggle the number did not change, the question did. 3366 winding down to
     * 1236 asserts that a thousand calories left the day, and the eye reads a
     * count as new data arriving, so it lands as the card glitching rather than
     * as the card answering.
     *
     * **A DAY change does not count either, and it was the louder of the two.**
     * Paging to yesterday made the hero count from today's total down to
     * yesterday's — asserting that a thousand calories had just left a day you
     * were not looking at when it happened — and it landed after the deck had
     * finished sliding, so the card came to rest and then kept moving. That is
     * most of what made changing day feel long.
     *
     * Both take the same route: write the destination into the element's own
     * memory first, so `countTo` finds `from === to` and simply sets the text.
     */
    const instant = swapping || !animate
    if (instant) number.dataset.value = String(shown)
    countTo(number, shown, { format: (n) => kcal(n) })

    // The qualifier the rings use, in the row's own size: the target in
    // consumed mode, the word in remaining.
    setTabularText(qualifier, remainingMode ? (diff > 0 ? 'over' : 'left') : `/ ${kcal(target)}`)

    /**
     * `.reading-swap` is an animation on an element that is now permanent, so it
     * has to be restarted rather than applied — adding a class the element
     * already carries does nothing. The forced reflow between the two writes is
     * what makes the browser treat it as a new run. Same helper, same argument,
     * as `replay` in screens/onboarding.js.
     */
    reading.classList.remove('reading-swap')
    if (swapping) {
      void reading.offsetWidth
      reading.classList.add('reading-swap')
    }

    /**
     * The bar resumes from where it is painted, because it is the same bar. The
     * instant case has to suppress its own transition to jump, and the forced
     * reflow is load-bearing: style is computed once at the end of a task, so
     * setting `transition: none` and the new width together would leave only the
     * final pair and the bar would glide anyway.
     */
    if (instant) {
      fill.style.transition = 'none'
      fill.style.width = `${pct}%`
      void fill.offsetWidth
      fill.style.transition = ''
    } else {
      fill.style.width = `${pct}%`
    }

    /**
     * The overage rides inside the fill, at its right end.
     *
     * The three rings say "over" with geometry and the Log sheet says it with a
     * chip; this bar said it with nothing at all — past target it simply ran full
     * and stayed full, which is the saturation problem the rings' second lap was
     * built to fix, still unfixed on the one mark above them.
     *
     * **In remaining mode there is nothing for it to fix.** The hero says
     * `79 over` one line up, so the full bar is already accounted for and `+79`
     * inside it is the same number twice, adjacent — the exact thing the card was
     * rebuilt to stop doing. Consumed mode is different: `3366 / 2837` leaves the
     * overage to be subtracted rather than stating it, so there the pill is the
     * only place the bar admits it ran past the end.
     *
     * Showing calories eaten here instead was the other way out, and it fails on
     * the card's own rule: the switch is what gets you the other reading, and a
     * view that quietly carries both makes the switch half redundant. It also
     * only ever appears past target, so eaten would arrive because you crossed
     * and say nothing about the crossing.
     */
    if (overBy > 0 && !remainingMode) {
      over.textContent = `+${overBy}`
      if (!over.isConnected) fill.appendChild(over)
    } else if (over.isConnected) {
      over.remove()
    }

    bar.setAttribute('aria-valuenow', String(Math.round(value)))
    bar.setAttribute('aria-valuemax', String(Math.round(target) || 0))

    // Drawn on the neighbours too, not just the live card. They are the real
    // card at rest and a drag brings them fully into view — one that arrived
    // without the indicator, or with it on the other dot, would be a lie that
    // resolves halfway through the gesture. `inert` is what keeps them from
    // being operable; it is not their job to look different.
    repaint(controlSlot, control)
  }

  // `live` is read by the caller to decide what to pass; nothing here needs it
  // now that the memory is per element rather than shared.
  void live

  return { el, update }
}

/**
 * One day's card. `live` is the one you are actually on.
 *
 * The neighbours are the same component with the same numbers drawn the same
 * way — not a placeholder, not a blurred rectangle. At rest you see 14px of
 * one, so a cheaper stand-in would pass; a drag brings the whole thing into
 * view, and the moment it does, anything less than the real card is a lie that
 * resolves into the truth halfway through the gesture.
 *
 * What `live` gates is everything that is about the day you are ON rather than
 * the day you are looking at: the count-up's memory, the button role, the
 * focus stop, and being visible to a screen reader at all. Three days of
 * numbers announced as one card would be unreadable.
 */
function dayCard({ live = false, position = 'current', onMode }) {
  const el = h('div', {
    class: live ? 'day-card day-card-toggle' : 'day-card',
    'data-day': position,
    // `inert` as well as `aria-hidden` on the neighbours. Hiding a subtree from
    // assistive tech while leaving real buttons inside it focusable is the one
    // way to make a card that is not on screen answer the Tab key, and the
    // switch put buttons in there for the first time.
    ...(live ? {} : { 'aria-hidden': 'true', inert: true }),
  })

  const calories = calorieBlock({ live })
  // Fixed order: protein, fat, carbs. Equal diameter, evenly distributed —
  // comparable to each other, which is the one thing concentric rings cannot do.
  const rings = h('div', { class: 'day-rings' })
  el.append(calories.el, rings)

  /**
   * The card holds the last data it was given, so `setMode` can repaint all
   * three with the new reading and no caller has to hand the numbers back.
   */
  let held = null

  const paint = (next) => {
    if (next) held = next
    if (!held) return
    const { totals, targets, dayChanged = false } = held

    calories.update({
      value: totals.kcal,
      target: targets.kcal,
      mode: cardMode,
      swapping: live && modeSwap,
      /**
       * Nothing on this card moves when the DAY moved.
       *
       * The deck has already slid to say what happened; a number that then
       * counts, a bar that then fills and three arcs that then sweep are all
       * describing a change to a day, and the day is what changed. They also all
       * land AFTER the slide finishes, so the card arrives and then keeps going
       * — which is what made paging feel long and unsettled.
       *
       * The neighbours have never had a reason to animate at all: they are drawn
       * at rest, two thirds off screen.
       */
      animate: live && !dayChanged,
      control: modeReach(cardMode, onMode),
    })

    /**
     * The rings are still rebuilt, and `lastLen` is still what carries them.
     *
     * `macroRing` builds a whole svg — two laps, a clip path with an id minted
     * per instance, a centre — and converting it to write in place is its own
     * piece of work rather than a rider on this one. Repainting them keeps the
     * behaviour exactly as it was: the arcs animate from the remembered length,
     * and `animate: false` seeds `from` with `to` so a day change draws them
     * where they belong instead of sweeping there.
     */
    repaint(
      rings,
      ...['protein', 'fat', 'carbs'].map((macro) =>
        macroRing({
          macro,
          value: totals[macro],
          target: targets[macro],
          mode: cardMode,
          // Arc animation is remembered per key. The live card keeps the bare
          // macro name so its arcs carry across a re-render; the neighbours get
          // their own, or all three cards would fight over one memory and every
          // render would replay somebody's entrance.
          key: live ? macro : `${macro}:${position}`,
          animate: live && !dayChanged,
          swapping: live && modeSwap,
        })
      )
    )
  }

  return { el, paint }
}

/**
 * The strip of surface past the neighbour, for the length of a page turn.
 *
 * A committed swipe travels a full page, and over the last 19px of that the
 * neighbour it is bringing in clears the far gutter — so where a card edge
 * should be peeking there is 20px of page tint instead, and it stays there
 * until the rebuild lands and the track resets. Measured at 390 and at 375:
 * 58ms on this machine, of which 45 is the tail of the animation and the rest
 * is the repaint, and the repaint is the half that grows on a phone.
 *
 * **It carries no data, and that is a measurement rather than a shortcut.** The
 * exposed strip is the outer 10px of where the card would sit, and `.day-card`
 * is padded by 20 — so nothing inside a real card would be visible in it at
 * any point. What shows is the surface colour and the corner radius, which is
 * all this is. The rule the neighbours are held to, that a card sliding into
 * view must be the real thing and never a stand-in, is a rule about cards that
 * come into view; `withinReach` caps a gesture at one page, so these two never
 * can.
 *
 * The height has to be asked for. An empty card is its padding and nothing
 * else, so it would draw as a 40px stub against a 270px deck; `100%` resolves
 * against the track, which takes its own height from the live card.
 */
function edgeCard(position) {
  return h('div', {
    class: 'day-card day-card-edge',
    'data-day': position,
    // Same treatment as the neighbours. There is nothing in here to read or
    // focus, but a screen reader should not meet a third and fourth card
    // either.
    'aria-hidden': 'true',
    inert: true,
  })
}

/**
 * The deck: the day you are on, with its neighbours parked either side.
 *
 * The 14px of yesterday showing past the left gutter is the entire affordance.
 * There is no arrow and no hint text — a card that is visibly one of a row is
 * already saying it is one of a row, and it says it in the same breath as
 * showing you that yesterday exists and has been filled in.
 *
 * The neighbours are absolutely positioned rather than laid out in a row, which
 * is what keeps the resting state free. A scroller would have to be scrolled to
 * the middle on every build, and `createScreen` builds a fresh tree on every
 * data change — so there would be a frame of yesterday under the header before
 * the correction landed. That is the exact failure the screen swap was written
 * to avoid. Here, rest IS `transform: none`, so a newly built deck is already
 * where it belongs and there is nothing to correct.
 *
 * Which is also why the commit fires at the END of the slide: the outgoing
 * animation parks the incoming card precisely where a fresh deck will draw it,
 * so the rebuild has nothing to move.
 */
function deckCards() {
  /**
   * Three cards, built once and written to for the life of the screen.
   *
   * They are POSITIONS rather than dates — the middle one is always the day you
   * are on, and paging rewrites its numbers rather than handing the slot to a
   * different element. That is what lets the hero and the bar remember where
   * they were last drawn, which is the whole point of this pass.
   *
   * `setMode` lives here rather than in the painter because it has to outlive a
   * render too: it is bound into every card's control at construction, and a
   * fresh one per build would leave the controls calling into a closure whose
   * cards are no longer the ones on screen.
   */
  const slots = {}

  /**
   * Set the reading, everywhere, and remember it.
   *
   * Paints first and writes after, without waiting: the switch answers on the
   * frame it was pressed, and the trip to IndexedDB is bookkeeping for the next
   * launch rather than something the finger should be held up for. A failed
   * write costs the preference, not the interaction — the card in front of you
   * is already showing what you asked for.
   *
   * Every card repaints, not just the live one. The neighbours are two thirds
   * of what a drag reveals, and a card that changed its mind about what it was
   * showing while sliding into view would be worse than one that never offered
   * the choice.
   */
  const setMode = (next) => {
    if (next === cardMode) return
    cardMode = next
    haptic()
    // Raised for the length of the repaint and lowered again on the far side.
    // Nothing schedules in between — `paint` writes its card synchronously — so
    // the flag is read by exactly the elements this switch is repainting, and
    // the next repaint from any other cause finds it down.
    modeSwap = true
    for (const c of [slots.prev, slots.current, slots.next]) c.paint()
    modeSwap = false
    saveCardMode(next).catch(() => {})
  }

  slots.prev = dayCard({ position: 'prev', onMode: setMode })
  slots.current = dayCard({ live: true, position: 'current', onMode: setMode })
  slots.next = dayCard({ position: 'next', onMode: setMode })
  // Bare elements rather than `dayCard`s, and they are never painted — see
  // `edgeCard`. They outlive every render for the same reason the cards do.
  slots.prev2 = edgeCard('prev2')
  slots.next2 = edgeCard('next2')

  // The tap that predates the switch, kept for the hands that learned it. It
  // goes through the same setter, so the control it did not come from still
  // ends up marking the right segment.
  //
  // No guard against a swipe landing here as a tap — `swipePages` swallows that
  // click in the capture phase before it reaches this. The switch's own clicks
  // stop short of here on their own; see `modeReach`.
  //
  // Bound once, with the card it belongs to: the live card is now the same
  // element for the life of the screen, so wiring this per render would add a
  // second handler on every log and toggle the mode twice on the next tap.
  slots.current.el.addEventListener('click', () => {
    setMode(cardMode === 'consumed' ? 'remaining' : 'consumed')
  })

  return slots
}

function paintDeck(deck, track, slots, pager, { current, prev, next, dayChanged = false }) {
  slots.prev.paint({ ...prev, dayChanged })
  slots.current.paint({ ...current, dayChanged })
  // Painted even when it is not shown, so the card behind the forward edge is
  // never a frame out of date if tomorrow becomes reachable.
  slots.next.paint({ ...(next || prev), dayChanged })

  const cards = [slots.prev, slots.current, next ? slots.next : null].filter(Boolean)
  const live = slots.current

  /**
   * Put the track back where a freshly built deck used to sit.
   *
   * This is the invariant the rebuild used to satisfy for free, and the one
   * NOTES-node-identity.md flags as most likely to break silently. `swipePages`
   * commits on `transitionend` precisely BECAUSE the track is then parked a full
   * page width over, exactly where the incoming day would be drawn — the swap
   * had nothing to animate and nothing to correct. What made that true was the
   * caller throwing the whole deck away. The deck stays now, so the offset stays
   * with it, and the day change would land a page width off screen.
   *
   * The forced reflow is load-bearing and not decoration. Style is computed once
   * at the end of a task, so setting `transition: none` and clearing the
   * transform together would leave only the final pair — a live transition
   * against a changed transform — and the track would glide back over 200ms
   * instead of being where it belongs. Reading `offsetWidth` commits the
   * suppression first. Same idiom, same reason, as `entryRow`'s collapse.
   *
   * `data-paging` goes with it. `swipePages` puts its own flag down now, but a
   * gesture interrupted by an unrelated rebuild never reaches the code that
   * does, and a deck stuck in `paging` suppresses the day card's press dip for
   * good.
   */
  track.style.transition = 'none'
  track.style.transform = ''
  void track.offsetWidth
  track.style.transition = ''
  delete deck.dataset.paging

  /**
   * The track's children are only touched when the SET of them changes, which is
   * when tomorrow becomes reachable or stops being.
   *
   * Repainting unconditionally would hand the track the very cards it is already
   * holding, and `replaceChildren` detaches and reattaches — cancelling the
   * count-up and the bar mid-flight on every log. That is the one operation this
   * whole pass exists to avoid, and it is easiest to reintroduce here, where the
   * call reads like a repaint of somebody else's nodes.
   *
   * Same identity check `createScreen` makes for the same reason.
   */
  /**
   * The edges bracket the cards, and `next2` exists only where `next` does.
   *
   * They have to be listed here rather than appended once at construction:
   * `repaint` is clear-and-append, so anything not in this array is dropped the
   * next time the set changes. Ordered as they sit on screen, which costs
   * nothing — all four are out of flow — and makes the identity check below
   * read against the DOM rather than against an arbitrary order.
   *
   * On today there is no tomorrow and so no edge past it either. That is the
   * same asymmetry the deck already draws at rest: yesterday peeks, tomorrow
   * does not, because one of them has happened.
   */
  const wanted = [slots.prev2, ...cards.map((c) => c.el), next ? slots.next2 : null].filter(Boolean)
  const settled =
    wanted.length === track.children.length && wanted.every((el, i) => track.children[i] === el)
  if (!settled) repaint(track, ...wanted)

  // The gesture is not wired here any more, and neither is the card's tap. Both
  // bind once — see `deckCards` and the shell in `todayScreen` — because the
  // elements they bind to now outlive every one of these repaints, and binding
  // per render would stack a fresh listener on each.
  void live

  /**
   * Last, and it has to be last.
   *
   * This is the deck telling the pager that the day it committed to is now the
   * day on screen — which is exactly what the block above just finished making
   * true, and the reason `drain` is a hook here rather than a new coupling. A
   * chevron tapped during a slide is parked until this line, because a step
   * started any earlier would be sliding the cards this function is in the
   * middle of replacing, and the reset above would cut it off mid-flight.
   *
   * After the reset and after `repaint`, so a queued step measures and moves a
   * track that is settled at zero and holding the right three cards.
   */
  pager.drain()
}

/* ----------------------------------------------------------------- the log */

/**
 * How many entries the card shows before it hands over to the sheet.
 *
 * Eight, matching the quick-add rail, and for a related reason: past that a
 * preview stops being a preview. The card's job on this screen is "what have I
 * eaten today", answered at a glance under the dashboard — a fourteen-item day
 * scrolled past the fold turns the summary card into a header for a list, which
 * is the shape the Log sheet exists to be.
 */
const LOG_PREVIEW_MAX = 8

/**
 * The log preview's card, stamped with the day it was built for.
 *
 * The stamp is what `freshEntryIds` reads on the next build, and it is on the
 * card rather than held in a variable up here so that the record of what is on
 * screen lives in the same place as the thing on screen. A discarded render
 * cannot desynchronise them, because a discarded render never mounts.
 */
function logCard(date, children, { dayStep = 0 } = {}) {
  const el = card(children)
  el.dataset.todayLog = date
  /**
   * The arrival belongs to the CARD, not to the section around it.
   *
   * It was on the section, which also holds `Logged` and the `Full log` chip —
   * and those two read the same on every day of the year. Moving them claimed a
   * change that had not happened, which is the exact test `.day-swap` already
   * applies to the Quick add rail one group up: the rail is byte-identical
   * across days, so it does not wear this. A heading is no different from a
   * rail in that respect, and it sat inside the element wearing it only because
   * the section was the convenient node to put a class on.
   *
   * What is left underneath is the part that genuinely became a different day's
   * content, which is the whole claim this animation is allowed to make.
   *
   * The direction comes from which way the date moved, so the list arrives from
   * the same side the deck above just travelled from — see the keyframes. A
   * jump from the date picker has a direction too: a day in April is behind
   * you, whatever route you took to it.
   */
  if (dayStep) el.classList.add(dayStep > 0 ? 'day-swap-fwd' : 'day-swap-back')
  return el
}

/**
 * The way into the Log sheet, in the section head.
 *
 * It was briefly the last row of the card instead, on the argument that "there
 * is more of this" belongs at the end of the list it continues. Tried and
 * reverted: at the bottom it is only found by scrolling past the eight rows it
 * exists to say are not all of them, so the one day you most want it — a long
 * one — is the day it sits furthest from the thumb. In the head it is in the
 * same place regardless of how much is under it.
 *
 * **It renders at every count, and reads the same at every count.** The sheet
 * holds the day's targets, the time blocks and the date picker, so it has to be
 * reachable from a three-item day as well as a twenty-item one — an affordance
 * that appears only once a list is long enough is one most people meet for the
 * first time on the day they least want to go looking.
 *
 * It briefly carried `(4 more)` when the list was capped, on the argument that
 * nothing else says the eight rows are a selection. Removed: a control that
 * changes its own label is a control you have to re-read, and this one is a
 * fixed destination — the label is where it goes, not how much is behind it. The
 * cost is that a long day and a short one now look alike from here, which is
 * what the sheet is one tap away to answer.
 */
function fullLogChip(onOpen) {
  return h('button', { class: 'chip-sm', onclick: onOpen }, 'Full log')
}

/* ------------------------------------------------------------- quick add */

/**
 * Eight, and the number is a judgement rather than a fit.
 *
 * Four and a bit fit across a 375 screen, so this is roughly two flicks of
 * rail. Past that a shortcut stops being a shortcut: scanning a horizontal row
 * for the ninth card is slower than typing three letters into the search field
 * one tap away, and a rail long enough to get lost in is a worse version of the
 * list it was meant to save you from.
 */
const RAIL_MAX = 8

/**
 * One tile in the Quick add rail.
 *
 * **The card opens the amount sheet; only `+` writes to the log.** The two were
 * built the other way round first — card logs, `+` adjusts, matching the add
 * sheet — and the pair were compared on device before this was settled. The
 * comparison is worth recording because it did not work the way comparisons
 * usually do: the two builds are pixel-identical. Nothing on the card changes
 * between them. So this could not be decided by looking, only by arguing about
 * what each target should mean.
 *
 * What settled it is the serving. A tile logs the LAST serving you used for
 * that food, which is right far more often than a default of one would be and
 * is still wrong sometimes — you had 200g of yoghurt yesterday and want 150
 * today. With the card opening the sheet, that case costs nothing: the amount
 * is sitting in a field, prefilled, one edit from correct. With the card
 * logging outright it costs a wrong entry and a correction afterwards.
 *
 * So the big target asks and the small one commits, which inverts the usual
 * reading of a large surface being the primary action. It is the right way
 * round here because the irreversible half is the one that should be harder to
 * hit by accident while scrolling a rail with a thumb, and because the
 * shortcut is not lost — `+` is still one tap and still skips everything.
 *
 * The cost, stated plainly: a tile on this screen and a tile on the add sheet
 * now look identical and do different things on a body tap. See `favCard` in
 * sheets/addFood.js, which still logs outright.
 *
 * Logging goes through `quickLogFood`, the same call the add sheet's favourites
 * make — so the serving used, the `computed` snapshot and the recency bump that
 * reorders this very rail all happen on one path. A second logging route with
 * its own idea of any of that is how two screens start disagreeing about what
 * you ate.
 *
 * `state.date`, not today. Today's screen shows whichever day you have stepped
 * to, and a rail that quietly logged into today from a screen showing Saturday
 * would put food on the wrong day with nothing on screen to say so. The block
 * still comes from the clock, which is the same compromise the add sheet makes:
 * the hour you are logging AT is the best guess available for a day you are not
 * living through.
 */
function quickAddTile(food, { date, block }) {
  const { quantity, unit } = defaultServing(food)
  const serving =
    unit === 'serving'
      ? `${qty(quantity)} × ${servingLabel(food)}`
      : `${qty(quantity)} ${unitLabel(unit, quantity)}`

  // The tile cases its own visible name; these labels and the toast are strings
  // built here, so they case the name themselves or the spoken and written
  // versions of the same food drift apart.
  const name = displayName(food.name)

  return foodTile({
    title: food.name,
    subtitle: serving,
    totals: computeMacros(food, quantity, unit),
    onBody: () => openServingSheet({ food, date, block }),
    // Spelled out rather than shortened, because the two targets are a sentence
    // apart and a screen reader gets no help from the shapes. Nothing about a
    // card and a circle says one asks and one commits, so the labels have to.
    bodyLabel: `Change the amount of ${name}`,
    onAction: async () => {
      const entry = await quickLogFood(food, { date, block })
      toast(`Logged ${name}`, {
        action: 'Undo',
        onAction: () => deleteEntry(entry.id),
      })
    },
    actionLabel: `Log ${name}, ${serving}`,
  })
}

/**
 * The rail, or the line that stands in for it before anything has been logged.
 *
 * `firstRun` is the state of the whole database, not a flag anybody set —
 * `firstLoggedDate` returning null is the only condition, so the line cannot
 * survive its own usefulness the way a dismissal flag can. It goes away when
 * the first entry exists and never comes back, including after a data import,
 * which is correct: an imported history is a history.
 *
 * **The line needs an empty rail as well as an empty history**, which the brief
 * did not anticipate because it assumed recents were derived from entries.
 * They are derived from the food records, and a food can be in the library
 * without ever having been logged — the sample favourites do exactly this, and
 * so does creating a custom food and not eating it yet. In that state there are
 * real tiles to show, and telling someone to log their first food while
 * suppressing six working shortcuts to do it would be the screen arguing with
 * itself.
 *
 * With entries in the database but no recents, the whole section drops. That
 * only happens if every food behind those entries has since been deleted, and a
 * heading over an empty rail would be a section announcing that it has nothing
 * to say.
 */
/**
 * **This section does NOT dissolve on a day change, because it does not change.**
 *
 * `quickAddFoods` takes no date: it ranks over a rolling window ending at the
 * real today, so the rail holds the same eight foods in the same order whichever
 * day you are looking at. Only the tiles' `date` changes, and that is where a
 * tap writes to rather than anything you can see.
 *
 * It briefly faded with the log below it, and that was the same dishonesty this
 * screen keeps being cleared of: motion is a claim that something changed, and
 * nothing here did. The log fades because the log is a different day's entries.
 */
/**
 * **No rail, no section.** It used to render a "Quick add" heading over a
 * one-line card reading "Tap + to log your first food" on first run, which
 * was a section announcing it had nothing in it, sitting above a second card
 * announcing the same thing. First run is one state, and it is said once, in
 * the log's place — see `firstMealCard`. The rail appears the moment there is
 * a food to put in it, which is the moment the first meal is logged.
 */
function quickAddSection({ foods, date, block }) {
  if (!foods.length) return null

  return h(
    'section',
    { class: 'flex flex-col gap-[10px]' },
    h('div', { class: 'section-head' }, h('div', { class: 'section-label' }, 'Quick add')),
    h('div', { class: 'food-rail' }, foods.map((food) => quickAddTile(food, { date, block })))
  )
}

/**
 * The first-use state: one card, one thing to do.
 *
 * Before anything has ever been logged the screen held two empty cards, each
 * a muted line pointing at the `+` in the corner. Neither did anything, and
 * between them they made a fresh install read as a screen that had failed to
 * load. This is the one card that replaces both: it says what the screen is
 * for, and it holds the action rather than pointing at one.
 *
 * The button opens the Add sheet, not Describe. Describe is the shortest route
 * to one logged meal, but a first run is also the one time someone is looking
 * at everything the app can do, and the Add sheet is where all of it is:
 * search, scan, describe, type the numbers. The `+` opens the same sheet.
 *
 * Shown while nothing has ever been logged and the card has not been waved
 * away. The first part is the state of the whole database, not a flag. It
 * goes away with the first entry and never comes back, including after an
 * import, which is right — an imported history is a history. An empty day
 * later on keeps its one-line "Nothing logged yet", because by then the rail
 * above it is doing the work.
 */
function firstMealCard(date, block) {
  return h(
    'div',
    { class: 'relative flex flex-col gap-[10px] px-[20px] py-[20px]' },
    dismissButton(() => saveSettings({ firstMealSeen: true })),
    h('p', { class: 'text-[16px] font-semibold leading-tight pr-[32px]' }, 'Nothing logged yet'),
    h(
      'p',
      { class: 'text-[14px] leading-snug text-muted' },
      'Log a meal and the rings above start to fill. ' +
        'The + in the corner does the same thing whenever you need it.'
    ),
    h(
      'button',
      { class: 'btn-primary mt-[10px]', onclick: () => openAddFood({ date, block }) },
      'Log your first meal'
    )
  )
}

/**
 * The plain X in a card's corner, and the 44pt behind it.
 *
 * The box is drawn at 44 and sits 4px in from the card's edges, which puts the
 * glyph's centre 26px in: level with the 20px content inset, not floating in
 * the padding. `.tap-44` is not used because it sets `position: relative`, and
 * this has to be absolute.
 */
function dismissButton(onDismiss) {
  return h(
    'button',
    {
      class:
        'absolute top-[4px] right-[4px] flex h-[44px] w-[44px] items-center justify-center text-muted',
      'aria-label': 'Dismiss',
      onclick: onDismiss,
    },
    icon('close', { size: 18 })
  )
}

/**
 * The install step, directly under the dashboard.
 *
 * On iOS the app in a Safari tab and the app on the Home Screen are two
 * different things: only the second is full screen, keeps its place between
 * opens, and runs with no signal. Safari gives no prompt for it, so this is
 * the one place the route is spelled out. There is no action button, because
 * the action lives in Safari's share sheet and nothing in the page can trigger
 * it.
 *
 * Shown while nothing has ever been logged, on iOS, outside the installed app,
 * and until it is waved away. The X sets `firstRunSeen`, the same flag the
 * boot-time toast honours, so dismissing the card is also the end of the
 * reminder. It is a plain `card`, not a `logCard`: it reads the same on every
 * day, so it must not wear the day-swap.
 */
function installCard(settings, everLogged) {
  if (everLogged !== null || settings.firstRunSeen || !isIOS() || isStandalone()) return null
  return card(
    h(
      'div',
      { class: 'relative flex flex-col gap-[10px] px-[20px] py-[20px]' },
      dismissButton(() => saveSettings({ firstRunSeen: true })),
      h(
        'p',
        { class: 'text-[16px] font-semibold leading-tight pr-[32px]' },
        'Put it on your Home Screen'
      ),
      h(
        'ol',
        { class: 'list-decimal pl-[20px] flex flex-col gap-[6px] text-[14px] leading-snug text-muted' },
        h('li', {}, 'Tap the Share button at the bottom of Safari.'),
        h('li', {}, 'Scroll down and tap Add to Home Screen.'),
        h('li', {}, 'Tap Add in the top corner.')
      ),
      h(
        'p',
        { class: 'text-[14px] leading-snug text-muted' },
        'Trackd then opens like an app, full screen, and works with no signal.'
      )
    )
  )
}

export function todayScreen() {
  /**
   * The shell, built once per mount and never repainted.
   *
   * Everything here is furniture the data cannot change: the row the header sits
   * in, the column's rhythm, and the deck's own box and track. The payload — the
   * header's contents, the three day cards, the rail, the log — is repainted
   * into it, always with a freshly built subtree, so nothing on screen is ever
   * detached and reattached. That is onboarding's pattern and the rule that
   * makes it safe; `createScreen` leaves the root alone because `build` hands
   * back the same one it was given last time.
   *
   * The deck has to be in here rather than repainted with the rest, and it is
   * the reason any of this is happening: `swipePages` binds to `deck` and
   * `track`, and a gesture cannot survive its own element being replaced three
   * times a second. Everything else on this screen is here so that it can be —
   * the column persists because a fresh column handed the persistent deck would
   * detach it on the way in, which is the exact operation this pattern exists to
   * avoid.
   *
   * `slot()` rather than a plain div: an empty flex child still spends a full
   * 20px gap, and Quick add genuinely goes away on a day with no recents. That
   * used to be free — `appendAll` dropped the null before it could become a flex
   * item — and a permanent wrapper would have quietly started paying for it.
   */
  const track = h('div', { class: 'day-deck-track' })
  const deck = h('div', { class: 'day-deck' }, track)
  // The three day cards, and the mode setter bound into their controls. Both
  // outlive every render — see `deckCards`.
  const slots = deckCards()
  const headerSlot = slot()
  const railSlot = slot()
  const logSlot = slot()
  const installSlot = slot()
  const column = h('div', { class: 'flex flex-col gap-[20px]' }, deck, installSlot, railSlot, logSlot)
  /**
   * The header is a sibling of the column, not a member of it.
   *
   * `.page-header` carries the 20px that puts the first card at 64, and a flex
   * gap would ADD to that margin rather than absorbing it — so a header inside
   * the column would sit 20 + 20 clear of the deck here and a different total on
   * every other screen. Outside, the 20 is the whole distance and it is the same
   * 20 on all three tabs. See `.page-header`.
   *
   * `headerSlot` wraps it without changing that: the wrapper is a plain block
   * with no padding or border, so the header's bottom margin collapses straight
   * through it. Measured at 390 and 320 rather than assumed — 44px to the bottom
   * of the header and 20 to the deck, both unchanged.
   */
  const root = h('div', {}, headerSlot, column)

  /**
   * Bound once, to elements that outlive every render.
   *
   * It used to be re-wired inside `dayDeck` on every build, which was not a
   * choice so much as the only option: the deck it bound to was thrown away and
   * rebuilt each time, taking the listeners with it. Now the deck stays, so
   * binding per render would stack a fresh set of touch handlers on the same
   * element on every log.
   *
   * The cost is that nothing here may close over a render's variables, and
   * `pageWidth` did. It read `live`, `prev` and `cards` from the build that
   * created it — fine when the closure died with them, stale the moment it does
   * not. It reads the track instead, which is the same measurement taken from
   * the only thing that is still guaranteed to be there.
   */
  const pager = swipePages(deck, {
    track,
    // Measured, not computed from the gap token, so the two cannot drift. Both
    // cards sit on the same track, so the distance holds mid-drag.
    pageWidth: () => {
      const liveEl = track.querySelector('[data-day="current"]')
      if (!liveEl) return 0
      const a = liveEl.getBoundingClientRect()
      // The previous day where there is one, the next where there is not —
      // whichever neighbour exists is the same distance away.
      const other =
        track.querySelector('[data-day="prev"]') || track.querySelector('[data-day="next"]')
      if (!other || other === liveEl) return a.width
      return Math.abs(other.getBoundingClientRect().left - a.left)
    },
    // Forward off today would be tomorrow, which has not happened. Same rule
    // the header's forward chevron is disabled by.
    reach: (dir) => dir === -1 || !isToday(state.date),
    onCommit: (dir) => setDate(dir),
  })

  /**
   * The rail's order is decided once and then holds still — gaps item 6.
   *
   * `quickAddFoods` ranks by frequency and recency, and its cache is dropped on
   * every `entries` or `foods` change, so logging re-ranked it. Measured before
   * this: logging the tile in position five moved it to position one and its
   * left edge went from 660px to 20px — 640px of travel on a 390pt screen, on
   * the tile still under your thumb, delivered as the feedback for the tap
   * having worked. The node was replaced, so it was a hard cut with no motion at
   * all.
   *
   * **The fix is not to animate that.** Node identity would make the reorder
   * legible, and a legible reorder is still a rail that will not hold still
   * while it is being used. It is the same call `today.js:99` already makes for
   * the card's mode, and for the same reason: the surface under the thumb does
   * not get to move as a side effect of a successful action.
   *
   * So: ranked on mount, held for the life of the screen, ranked again next
   * time you arrive. Navigating away and back is the re-rank, which is often
   * enough for a list built from a thirty-day window.
   *
   * **An empty rail keeps asking, and that matters more than it looks.** Frozen
   * unconditionally, the very first food anyone ever logs would not appear in
   * Quick add until they navigated away and back — trading a teleport for a rail
   * that looks broken on the one day it is most closely watched. So the freeze
   * only takes hold once there is something to freeze.
   */
  let railFoods = null

  return createScreen(
    async () => {
      // The neighbours are read alongside the day itself rather than lazily on
      // the first drag. A gesture that has to wait on IndexedDB before it can
      // show you what it is dragging in is a gesture that stutters exactly
      // once, on the first use, which is the worst possible time.
      const forward = isToday(state.date) ? null : addDays(state.date, 1)
      const [entries, prevEntries, nextEntries, settings, rankedFoods, everLogged] =
        await Promise.all([
          listEntries(state.date),
          listEntries(addDays(state.date, -1)),
          forward ? listEntries(forward) : Promise.resolve(null),
          getSettings(),
          railFoods?.length ? railFoods : quickAddFoods(RAIL_MAX),
          firstLoggedDate(),
        ])
      railFoods = rankedFoods
      const totals = sumEntries(entries)
      const t = settings.targets
      // Before anything is built, so the first card drawn is already in the
      // stored reading. `createScreen` does not mount until this build resolves,
      // which is what makes that a guarantee rather than a fast correction.
      seedMode(settings)
      // Both read BEFORE the new tree is built, while the outgoing one is still
      // the document — `createScreen` does not mount until this whole build
      // resolves. `was` is null on first paint, which is not a day change: the
      // card has nowhere to have come from and should fill in normally.
      const was = paintedDate()
      /**
       * Which way the day moved, not merely whether it did.
       *
       * `dayChanged` still says whether, and is what holds the card's hero, bar
       * and arcs still — that decision does not care about direction. The log
       * does: it arrives from the side the deck travelled from, so the sign has
       * to survive down to `logCard`.
       *
       * String comparison rather than a date diff. These are `YYYY-MM-DD`, so
       * they sort lexically in calendar order, which is the property the whole
       * app already leans on for ranges and cutoffs.
       */
      const dayStep = was == null || was === state.date ? 0 : state.date > was ? 1 : -1
      const dayChanged = dayStep !== 0
      const freshRows = freshEntryIds(state.date, entries)

      /**
       * Every payload gets a freshly built subtree, and none of them is ever the
       * node its slot is already holding. That is the whole safety rule — see
       * the shell above.
       */

      // Both chevrons are always drawn; forward dims on today rather than
      // vanishing. One chevron on the left of a root screen reads as Back,
      // which is not what it does — it steps the day, and the pair is what
      // says so.
      repaint(
        headerSlot,
        pageHeader(formatDayHeader(state.date), {
          /**
           * The chevrons page the deck rather than setting the date, and the
           * deck sets the date when it gets there.
           *
           * They called `setDate` directly, so the two ways of changing the day
           * disagreed about whether anything moved: a swipe slid a card a full
           * page width, a tap swapped the numbers where they stood. The card's
           * hero, bar and arcs are all held still on a day change on the stated
           * grounds that "the deck has already slid to say what happened" —
           * true of the gesture, and never true of these until now. So the tap
           * was getting the suppression without the motion it was traded for.
           *
           * Same `dir` either function would have taken, which is what keeps
           * the mapping honest: `-1` is the previous day and slides the track
           * right, exactly as dragging right does. `page` returns false where
           * there is nothing that way and the return is ignored, because the
           * forward chevron is already disabled on today — the check inside
           * `page` is the mechanism's own, not this caller's.
           */
          onPrev: () => pager.page(-1),
          onNext: () => pager.page(1),
          nextDisabled: isToday(state.date),
          /**
           * The date is a control as well as a label.
           *
           * The chevrons step one day, which is right for yesterday and useless
           * for the day before last month. This is the jump, and it is the app's
           * own month grid rather than the platform's — see lib/datePicker.js
           * for why `showPicker()` is not an option here.
           *
           * Opened as a sheet rather than pushed as a panel, because Today is a
           * screen with no sheet to push onto. The spec is the same object
           * either way; picking a day pops it, which at the root of a sheet
           * means closing it.
           */
          onPick: () => openSheet(datePickerPanel({ value: state.date, onPick: setDate })),
        })
      )

      /**
       * The date does NOT animate, and this was tried both ways.
       *
       * `.reading-swap` fits it on the merits: a stepper is an instrument, the
       * date is its reading, and the chevrons either side deliberately hold
       * still — so a 3px rise says the right thing where the log's horizontal
       * travel would say the wrong one. It was built, and then removed for a
       * reason that has nothing to do with whether it was the right word.
       *
       * **Three animations for one event is one too many.** A day change
       * already moves the deck for 200ms and brings the log in over 140. Adding
       * 180 in the header means three separate durations resolving at three
       * separate moments, all describing a single tap — and the screen stops
       * reading as one thing happening and starts reading as several things
       * reacting.
       *
       * Two marks cover it completely: the surface that travelled, and the
       * content that became a different day. The date is the caption on that
       * change, and a caption that holds still while the thing it names moves
       * is doing its job.
       */

      // Targets are `settings.targets` for every card in the deck, including
      // the neighbours. That is what Today already did for the day you step
      // to with a chevron, so the deck is not inventing a second rule —
      // per-day targets are History's job, and this is not History.
      paintDeck(deck, track, slots, pager, {
        current: { totals, targets: t },
        prev: { totals: sumEntries(prevEntries), targets: t },
        next: nextEntries ? { totals: sumEntries(nextEntries), targets: t } : null,
        dayChanged,
      })

          /**
           * Quick add sits ABOVE the log, and the argument is what it is for.
           *
           * It was below for as long as the screen has existed, on the reading that
           * the day so far is the headline and a shortcut is a footnote to it. That
           * is right about the reading order and wrong about the cost: the rail is
           * the one-tap route to logging, and below the log its distance from the
           * thumb grows with every row above it. On the day with the most in it —
           * eight rows and a card — the shortcut is furthest away, which is the same
           * shape of mistake `fullLogChip` was moved out of the card's last row to
           * avoid. A shortcut you scroll to has stopped being one.
           *
           * The log loses nothing by moving down. It renders at every count and it
           * carries its own heading, so it is still named and still positioned; what
           * it stops being is the thing between you and the fastest way to log.
           */
      const firstRun = everLogged === null && !settings.firstMealSeen
      repaint(installSlot, installCard(settings, everLogged))

      repaint(
        railSlot,
        quickAddSection({
          foods: railFoods,
          date: state.date,
          block: blockForTime(new Date(), settings.blockThresholds),
        })
      )

          /**
           * The log. Its own group, and the route to the full Log screen — which
           * is in turn the only route to History, so this link keeps both
           * reachable.
           *
           * **It renders at every count, including zero.** It used to drop
           * entirely on an unlogged day, and dropping it was the larger half of
           * why a fresh morning read as a screen that had failed to load: with no
           * section here, the card sat above nothing at all, and there was no way
           * to tell "the log is empty" from "the log is not on this screen".
           * Naming the void and giving it a position is what turns nothing here
           * into nothing here yet.
           *
           * `Logged`, not `Log`. The heading is now describing a state rather
           * than labelling a list, and it has to make sense with one muted line
           * under it as well as with six rows.
           *
           * No bare item count on the right. That side carries `Full log`, which
           * is not decoration — it is the only way to the Log sheet, and
           * therefore to the day's targets, its time blocks and the date picker.
           * The count rides along with it rather than standing alone, where it
           * would be the weakest fact available: it sits directly above the list
           * it counts.
           */
      repaint(
        logSlot,
        h(
          'section',
            // The dissolve is on the card below rather than here — see
            // `logCard`. The heading and its chip are the same on every day, so
            // the section is the wrong scope for a mark that means "this became
            // a different day".
            { class: 'flex flex-col gap-[10px]' },
            h(
              'div',
              { class: 'section-head' },
              h('div', { class: 'section-label' }, 'Logged'),
              fullLogChip(openLogSheet)
            ),
            // Newest first, which is the opposite of the full Log screen and
            // is meant to be. `listEntries` returns oldest-first because Log
            // groups by block and a block reads forwards through the meal.
            // This is a preview of the day so far, and the thing you just ate
            // is the thing you came to check — putting it fifth down means
            // the answer moves further from the top every time you log.
            // Reversed here rather than in `listEntries`, so the sort stays
            // one screen's decision instead of both screens'.
            entries.length
              ? // Stamped with the day, on both branches, so the first entry of
                // a day still reads as having arrived rather than as the list
                // appearing for the first time.
                logCard(
                  state.date,
                  [...entries]
                    .reverse()
                    .slice(0, LOG_PREVIEW_MAX)
                    .map((entry) =>
                      entryRow(entry, {
                        settings,
                        onEdit: openEditEntry,
                        onDelete: deleteEntryWithUndo,
                        onDuplicate: openDuplicateSheet,
                        isNew: freshRows.has(entry.id),
                      })
                    ),
                  { dayStep }
                )
              : firstRun
                ? // Never logged anything, and the card has not been waved
                  // away. See `firstMealCard`.
                  logCard(
                    state.date,
                    firstMealCard(state.date, blockForTime(new Date(), settings.blockThresholds)),
                    { dayStep }
                  )
                : // One line, in the same card every list on this screen sits in,
                  // so an empty day has the same edges as a full one. "Nothing
                  // logged yet" and not "Your log is empty" — the heading directly
                  // above it already said the word log, and a sentence that repeats
                  // its own heading is saying one thing twice.
                  //
                  // No route into the sheet needed down here: `Full log` sits in the
                  // head above and renders at every count, including this one.
                  logCard(state.date, emptyRow('Nothing logged yet'), { dayStep })
        )
      )

      return root
    },
    { watch: ['entries', 'settings', 'foods'] }
  )
}
