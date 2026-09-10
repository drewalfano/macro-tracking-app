import { h, repaint } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { listEntries, getSettings, toggleFavourite, onChange } from '../lib/db.js'
import { sumEntries } from '../lib/compute.js'
import { saveEntriesAsMeal } from '../lib/logging.js'
import { card, macroLine, macroUnit } from '../lib/ui.js'
import { textInput, labelledField } from '../lib/ui.js'
import { entryRow } from '../lib/entryRow.js'
import { deleteEntryWithUndo, openDuplicateSheet } from '../lib/entryActions.js'
import { openEditEntry } from './serving.js'
import { openAddFood } from './addFood.js'
import { toast } from '../lib/toast.js'
import { displayName } from '../lib/format.js'
import { openSheet, presentSheet } from '../lib/sheet.js'
import { BLOCKS } from '../lib/dates.js'
import { state, subscribe } from '../state.js'

/**
 * The Log day view, as a sheet over Today.
 *
 * It was a routed screen, and the reason it stopped being one is that it had
 * three navigation models running at once and none of them left. A back chevron
 * that did not go back — it stepped the day — a tab bar saying this was a
 * top-level destination, and a History pill saying it was a browser. Three
 * controls that changed the date and nothing at all that closed it. The only way
 * out was the tab bar, which is a way of leaving the whole tab rather than this.
 *
 * A sheet answers that structurally instead of by relabelling: the scrim leaves
 * Today visibly behind it, so "this is temporary" needs no word to say it, and
 * the exit is the thing every other sheet in the app already has. What is left
 * in the header is one date control and one close button.
 *
 * This is the only surface where the time blocks are visible, which is still
 * correct: blocks are how you review a day, not how you log one.
 */

/* ------------------------------------------------------------- save as meal */

/**
 * `host` is the log's own ctx. Saving a meal is a step INTO the sheet rather
 * than a replacement for it — without this it would call `openSheet`, destroy
 * the log underneath it, and drop you on Today when it closed.
 */
async function promptSaveAsMeal(entries, defaultName, host) {
  return presentSheet(
    {
      title: 'Save as meal',
      render: (ctx) => {
        let name = defaultName
        const save = h(
          'button',
          {
            class: 'btn-primary',
            onclick: async () => {
              const meal = await saveEntriesAsMeal(name.trim() || defaultName, entries)
              await toggleFavourite('meal', meal.id)
              ctx.pop()
              toast(`Saved "${displayName(meal.name)}" and pinned it`)
            },
          },
          'Save meal'
        )
        ctx.setFooter(save)

        return h(
          'div',
          { class: 'flex flex-col gap-[20px] pb-[10px]' },
          labelledField({
            label: 'Name',
            hint: 'Saved meals are pinned to Favourites so they stay in one place.',
            children: textInput({
              value: name,
              autofocus: true,
              onInput: (v) => {
                name = v
                save.disabled = !v.trim()
              },
            }),
          }),
          card(
            entries.map((e) =>
              h(
                'div',
                { class: 'row' },
                h('span', { class: 'flex-1 truncate text-[12px]' }, displayName(e.foodName)),
                h(
                  'span',
                  { class: 'text-[12px] text-muted' },
                  String(Math.round(e.computed.kcal)),
                  ' ',
                  macroUnit('kcal', 'font-semibold')
                )
              )
            )
          )
        )
      },
    },
    host
  )
}

/* ------------------------------------------------------------------ totals */

/**
 * The day's four totals, on one pinned line: `1945 cal · 63 P · 94 F · 212 C`.
 *
 * **This replaced a summary card and is deliberately less than one.** What was
 * here was four `consumed / target` rows with thin bars and a `+14` overshoot
 * chip, in a `.panel` about 214px tall at the top of a height-capped sheet —
 * which is what pushed the third period below the fold. It was also the third
 * reading of the same four numbers: they are the largest element on Today, one
 * layer up and still visible above this sheet, and every row below is a share
 * of them.
 *
 * So this states them and does not measure them. No bar, no ring, no chip, no
 * progress of any kind — and no over-target mark either, because Today's rings
 * already carry that in the interior fill and the word "over", and any mark
 * here re-imports the language the card was removed for. If a total is over,
 * the surface that says so is one tap away and larger.
 *
 * **It is `macroLine`, at 15 instead of 12, and nothing else.** This was briefly
 * a hand-rolled version with its own unit map and its own spelling of the
 * spacing — `63P` closed up, `cal` spaced — and that is precisely the drift
 * `foodRowBody`'s own note describes: a component gets copied instead of
 * called, then the copy and the original disagree about a detail, and nothing
 * holds them together. There is no argument for this line reading differently
 * from the four identical lines eight pixels below it, because they are the
 * same statement about the same four numbers at two scales.
 *
 * So the convention comes with the component: the figure stays in ink so the
 * data is readable, the unit after it carries the hue, and colour means macro
 * identity here exactly as it does everywhere else.
 */
function totalsLine(totals) {
  return h(
    'div',
    {
      /**
       * Pinned by `sticky`, not by a slot in the sheet chrome.
       *
       * `sheet.js` carried a per-sheet `header` option once and lost it for
       * having exactly one caller — this one — so a `subhead` option would be
       * the same mistake with a different name. Sticky gets the same result and
       * leaves the chrome saying what every other sheet's says.
       *
       * The construction is `labelPhoto`'s, which already does this inside a
       * sheet body: bled to the sheet's edges with `-mx`/`px` so the periods
       * scroll UNDER the line rather than beside it, and `pb-20 -mb-20` to
       * paint the body's transparent 20px flex gap — without it the first card
       * reappears in that gap, clipped halfway, once it starts moving.
       *
       * **No rule under it**, which is the one place this departs from
       * `labelPhoto`. That component argues the hairline is what makes the clip
       * legible, and it is right about a photo strip with form fields sliding
       * under it — but here what slides under is a `.section-head`, and a rule
       * hard against a 20px heading reads as that heading's divider rather than
       * as this line's edge. The clip is legible without one anyway: a card is
       * `--color-surface` on canvas, so its own top edge is the mark going.
       *
       * `bg-canvas` is the sheet's own fill: `--color-sheet` resolves to it.
       *
       * 10 + a 20px line box + 10 is the 40 this is meant to cost, and the
       * painted gap below it is the 20 that was already between the old card
       * and Morning.
       */
      class:
        'sticky top-0 z-10 -mx-[20px] -mb-[20px] bg-canvas px-[20px] pb-[20px] pt-[10px]',
    },
    /**
     * The wrapper is what sets the line box, not `macroLine`, which takes a
     * size and leaves leading alone. 20 rather than the 21 a 14px line would
     * default to, so the pinned slot is 10 + 20 + 10 = the 40 it is meant to
     * cost — and `tnum` here rather than on the row below it, because this
     * number is re-rendered under the eye every time an entry lands and a
     * proportional `1` would shuffle the whole line sideways.
     */
    h('div', { class: 'tnum pb-[10px] leading-[20px]' }, macroLine(totals, { size: 14 }))
  )
}

/* -------------------------------------------------------------------- body */

function loadDay(date) {
  return Promise.all([listEntries(date), getSettings()]).then(([entries, settings]) => ({
    entries,
    settings,
  }))
}

/**
 * A period with nothing in it: one row, the name at reduced weight, and the same
 * `Add` pill a populated period's heading carries.
 *
 * The whole row is the target and the pill is a span rather than a button — a
 * button inside a button is two things to tab to and one thing to tap, and the
 * row is what the thumb actually goes for.
 */
function emptyBlock({ name, block, date, host }) {
  return h(
    'section',
    { class: 'flex flex-col' },
    h(
      'button',
      {
        class: 'block-add section-head w-full py-[5px]',
        'aria-label': `Add to ${name.toLowerCase()}`,
        onclick: () => openAddFood({ date, block }, host),
      },
      h('span', { class: 'block-empty-label' }, name),
      h('span', { class: 'chip-sm' }, icon('plus', { size: 16 }), 'Add')
    )
  )
}

/**
 * A meal is a combination, so one entry is not one.
 *
 * Below this the button offered to bundle a single food into a named, pinned
 * group — which the app can already do, better, one screen away: the entry's
 * Edit sheet carries a star that pins the underlying food to Favourites, and
 * pinned foods and saved meals land in the same list. So at one entry the
 * control was not a shortcut to something else, it was a worse spelling of
 * something that existed.
 */
const SAVE_AS_MEAL_MIN = 2

function populatedBlock({ name, entries, host, settings }) {
  return h(
    'section',
    { class: 'flex flex-col gap-[10px]' },
    h(
      'div',
      { class: 'section-head' },
      h('div', { class: 'section-label' }, name),
      entries.length >= SAVE_AS_MEAL_MIN
        ? h(
            'button',
            {
              class: 'chip-sm',
              onclick: () => promptSaveAsMeal(entries, `Usual ${name.toLowerCase()}`, host),
            },
            'Save as meal'
          )
        : null
    ),
    card(
      entries.map((entry) =>
        entryRow(entry, {
          settings,
          onEdit: (e) => openEditEntry(e, host),
          onDelete: deleteEntryWithUndo,
          onDuplicate: (e) => openDuplicateSheet(e, host),
        })
      )
    )
  )
}

/**
 * Open the log for whatever day `state.date` is on.
 *
 * **This sheet reads the date and never writes it.** It briefly owned a full set
 * of day controls — two chevrons and a tappable date opening a picker — and that
 * was the wrong half of the problem to solve. The sheet does not cover the
 * viewport, so Today's own header stays visible above it, and the result was two
 * date steppers on screen at once doing the same job to the same value. Dimming
 * one does not make it not a control.
 *
 * Navigation belongs to the layer that already had it. Today steps the day; this
 * is the detail view of whichever day that landed on, and its header is a label
 * rather than a control. The only thing it can do is close.
 *
 * The date cannot change while the sheet is open — Today is behind a scrim and
 * cannot be reached — but the subscription stays anyway, because "cannot happen"
 * is a property of today's layout rather than a guarantee, and a sheet listing
 * one day's entries after the date has moved is the worst thing it could do.
 *
 * The first read is awaited BEFORE the sheet is built, so it animates in with
 * the day already in it. Every read after that repaints in place, where there is
 * no empty frame to show because the previous day is still on screen until the
 * new one replaces it.
 */
export async function openLogSheet() {
  let data = await loadDay(state.date)

  return openSheet({
    /**
     * `Full log`, which is what the control that opens this says.
     *
     * It named the day — `Today, Aug 6` — and the date header on the screen
     * behind it says exactly that, at a larger size, and stays visible because
     * every sheet now stops below it. So the first thing you read on opening the
     * sheet was a word-for-word repeat of the line directly above it, and the
     * sheet spent its one piece of naming on a fact already on screen.
     *
     * The day is not lost: it is still up there, still legible, and now the only
     * place it is stated. What the title says instead is which sheet this is,
     * matching the chip that opened it so the tap and its result share a name.
     */
    title: 'Full log',
    // The `inset: 60` that used to be here is gone, and what it was buying is
    // not: every sheet now stops at the top of Today's dashboard card, so the
    // visible band of the page above this one — the thing that says the log is
    // temporary without spending a word on it — is the rule rather than this
    // sheet's exception. See `--content-top`.
    render: (ctx) => {
      const body = h('div', { class: 'flex flex-col gap-[20px]' })

      const paint = () => {
        const { entries, settings } = data
        const totals = sumEntries(entries)

        const sections = BLOCKS.map((block, i) => {
          const blockEntries = entries.filter((e) => e.block === block)
          const name = settings.blockNames[i]
          return blockEntries.length
            ? populatedBlock({ name, entries: blockEntries, host: ctx, settings })
            : emptyBlock({ name, block, date: state.date, host: ctx })
        })

        repaint(
          body,
          // Not drawn on an empty day. `0 · 0P · 0F · 0C` pinned above
          // `Nothing logged yet` is the same fact twice, and the second telling
          // is the one made of zeros.
          entries.length ? totalsLine(totals) : null,
          /**
           * A day with nothing on it gets one line, not three empty periods.
           *
           * Three rows that each say a different part of the day is empty are
           * three statements of one fact, and the fact is "you have not logged
           * anything yet". The periods come back the moment there is anything to
           * sort into them.
           */
          entries.length
            ? sections
            : card(
                h(
                  'button',
                  {
                    class: 'row justify-between',
                    onclick: () => openAddFood({ date: state.date }, ctx),
                  },
                  h('span', { class: 'text-[14px] text-muted' }, 'Nothing logged yet'),
                  h('span', { class: 'chip-sm' }, icon('plus', { size: 16 }), 'Add')
                )
              )
        )
      }

      const reload = () =>
        loadDay(state.date).then((next) => {
          data = next
          paint()
        })

      paint()

      /**
       * The sheet keeps itself current, which a routed screen got from
       * `createScreen` for free and a sheet does not.
       *
       * Both subscriptions are registered as disposers, so they are torn down
       * when the sheet closes — and also when this panel is re-rendered, since
       * `ctx.refresh` runs the disposers before calling `render` again. Without
       * that, every refresh would leave a live listener behind holding a body
       * that is no longer on screen.
       */
      ctx.onDispose(
        onChange((scope) => {
          if (['entries', 'settings', 'meals', 'all'].includes(scope)) reload()
        })
      )
      // The title no longer names the day, so this no longer sets it — but the
      // reload stays, because the CONTENT is still a single day's entries and a
      // sheet showing one day's rows after the date moved would be the same
      // error one level down.
      ctx.onDispose(subscribe(reload))

      return body
    },
  })
}
