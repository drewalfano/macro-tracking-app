import { h, repaint } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { toast, confirm } from '../lib/toast.js'
import { getFood, getSettings, savePlate, clearPlate, deleteEntry } from '../lib/db.js'
import { computeMacros, emptyTotals, addTotals } from '../lib/compute.js'
import { logPlate, saveDraftAsMeal, mealDraftSkips, defaultServing } from '../lib/logging.js'
import { classifyItem, itemMacros, leftoversPayload, resolveModelItems } from '../lib/describeResolve.js'
import { describeLeftovers } from '../lib/describeModel.js'
import { aiEnabled } from '../lib/aiKey.js'
import { pushMatchItem } from './matchItem.js'
import {
  blockSelector,
  card,
  estimateBadge,
  foodRowBody,
  macroLine,
  macroUnit,
  numberInput,
  segmentedWide,
  labelledField,
  textInput,
  notice,
} from '../lib/ui.js'
import { qty, servingLabel, unitLabel, pluralize, round, displayName } from '../lib/format.js'
import { addDays, formatDayLabel, todayStr } from '../lib/dates.js'

/**
 * The plate: foods assembled, then logged in one commit.
 *
 * The add sheet used to write on every tap and close itself, so a four-item
 * dinner was four trips through it. This is the staging area — and because it
 * holds a running total, it is also the first place the app can answer "what
 * does this do to my day" before the day is changed rather than after.
 *
 * Amounts are adjusted here rather than before adding. Tuning a meal against
 * one total beats guessing food by food, and it keeps the row in the add sheet
 * down to two targets.
 */

/**
 * A plate row, whichever of the four shapes its item takes.
 *
 * `food` is the record the row draws from and may be a real library food or a
 * draft not yet adopted — `computeMacros` only ever reads `per100` and
 * `servingSize`, so a draft renders exactly like a food and the distinction
 * stays where it belongs, at commit.
 *
 * `state` is what the row is: `matched` and `estimated` are ready to commit,
 * `needs-amount` and `unmatched` are not, and `missing` is the pre-existing
 * case of a food deleted out from under a staged plate.
 */
async function resolve(items) {
  const rows = []
  for (const item of items) {
    const food = item.foodId ? await getFood(item.foodId) : null
    const record = food || item.draft || null
    const state = item.foodId && !food ? 'missing' : classifyItem(item)
    rows.push({ item, food: record, macros: itemMacros(item, food), state })
  }
  return rows
}

export const plateTotals = (rows) =>
  rows.reduce((acc, r) => (r.macros ? addTotals(acc, r.macros) : acc), emptyTotals())

/** Ready to become an entry. The rest are rows still being worked on. */
const isReady = (row) => row.state === 'matched' || row.state === 'estimated'

/**
 * What each state says on the row, and the only place these words are written.
 *
 * `matched` says nothing at all. Its macro line is already the whole statement
 * — the row has a food and an amount and it adds up — and a label reading
 * "Matched" beside it would be the screen congratulating itself on the ordinary
 * case. The other three all say something the row cannot say on its own:
 * "Estimated" is the honesty the log deliberately drops after commit, and the
 * two unfinished states name what is missing rather than that something is.
 */
const STATE_LABEL = {
  estimated: 'Estimated',
  'needs-amount': 'Needs an amount',
  unmatched: 'Needs a match',
  missing: 'No longer in your library',
}

/** The one place a food is added to a plate, so the defaults stay in one spot. */
export function plateItemFor(food) {
  const { quantity, unit } = defaultServing(food)
  return { foodId: food.id, quantity, unit }
}

/* --------------------------------------------------------------- the panel */

export function platePanel({ plate, rows, settings, onChange, onCommitted }) {
  return {
    title: 'Your plate',
    render: (ctx) => {
      let items = [...plate.items]
      let block = plate.block
      let date = plate.date

      const body = h('div', { class: 'flex flex-col gap-[20px]' })

      const persist = () => onChange({ ...plate, items, block, date })

      /** True while the leftovers call is in flight, so the action can say so. */
      let sending = false
      let controller = null
      ctx.onDispose(() => controller?.abort())

      /** The amount in words, for a real food or for an estimate that has none. */
      function amountLabel(item, food) {
        if (item.quantity == null) return null
        const n = Number(item.quantity)
        if (item.unit !== 'serving') return `${qty(n)} ${unitLabel(item.unit, n)}`
        return food
          ? `${qty(n)} × ${servingLabel(food)}`
          : `${qty(n)} ${n === 1 ? 'serving' : 'servings'}`
      }

      /**
       * One row. Same body as a logged entry and as an add-sheet row, because
       * it is the same object one step earlier — what differs is the second
       * line, which now has a state to say as well as an amount.
       */
      function plateRow({ item, food, macros, state, index: i }) {
        // `foodRowBody` cases what it draws; the two aria labels below are
        // built here, so this is the cased copy they share.
        const name = displayName(food?.name || item.name) || 'Deleted food'
        const sub = [amountLabel(item, food), STATE_LABEL[state]].filter(Boolean).join(' · ')

        const action =
          state === 'missing'
            ? null
            : state === 'unmatched'
              ? h(
                  'button',
                  {
                    class: 'icon-btn icon-btn-sm bg-canvas',
                    'aria-label': `Find a food for ${name}`,
                    onclick: () => openMatch(i, item),
                  },
                  icon('search', { size: 16 })
                )
              : h(
                  'button',
                  {
                    class: 'icon-btn icon-btn-sm bg-canvas',
                    'aria-label': `Change amount of ${name}`,
                    onclick: () => openAmount(i, food, item),
                  },
                  icon('pencil', { size: 16 })
                )

        /**
         * The sparkle AND the word, which is the one place both are wanted.
         *
         * Everywhere else the icon carries it alone, because by then the row is
         * history and the mark is a note about where the numbers came from. Here
         * it is the last screen before the numbers are committed, so the
         * redundancy is the point: the glyph is what the eye finds scanning a
         * list of rows, and "Estimated" is what says plainly what the glyph means
         * to someone meeting it for the first time.
         */
        const body = foodRowBody({
          name,
          sub,
          totals: macros,
          badge: state === 'estimated' ? estimateBadge() : null,
          missing: state === 'missing',
        })

        return h(
          'div',
          { class: 'row' },
          /**
           * On an unmatched row the body is the way to fix the WORDS.
           *
           * It costs no new control — that half of the row is dead space on
           * these rows, since there is no food to open — and it is the only
           * place the text that would be sent can be corrected before sending
           * it. A row reading "french toast made" can become the sentence it
           * should have been.
           */
          state === 'unmatched'
            ? h(
                'button',
                {
                  class: 'min-w-0 flex-1 text-left',
                  'aria-label': `Edit the words for ${name}`,
                  onclick: () => openEditText(i, item),
                },
                body
              )
            : body,
          action,
          h(
            'button',
            {
              class: 'icon-btn icon-btn-sm bg-canvas',
              'aria-label': `Remove ${name} from plate`,
              onclick: async () => {
                items = items.filter((_, j) => j !== i)
                await persist()
                if (!items.length) {
                  ctx.close()
                  return
                }
                repaintAll()
              },
            },
            icon('close', { size: 16 })
          )
        )
      }

      /**
       * Correct the words on a row before anything is done with them.
       *
       * The text on an unmatched row is both what the search starts from and
       * what would be sent, so this is the one place to fix a phrase the rules
       * read wrongly — without which the only options are accepting it or
       * deleting the row.
       */
      function openEditText(index, item) {
        ctx.push({
          title: 'Edit',
          render: (c) => {
            let value = item.text || item.name || ''
            const save = h(
              'button',
              {
                class: 'btn-primary',
                onclick: async () => {
                  const next = value.trim()
                  if (!next) return
                  items = items.map((it, j) =>
                    j === index ? { ...it, name: next, text: next } : it
                  )
                  await persist()
                  repaintAll()
                  c.pop()
                },
              },
              'Update'
            )
            c.setFooter(save)

            return h(
              'div',
              { class: 'flex flex-col gap-[10px] pb-[10px]' },
              textInput({
                value,
                autofocus: true,
                onInput: (v) => {
                  value = v
                  save.disabled = !v.trim()
                },
              }),
              h(
                'p',
                { class: 'px-0 text-[12px] leading-snug text-muted' },
                'What the app searches for, and what it would send if you ask Gemini.'
              )
            )
          },
        })
      }

      /** Attach a food to a row that has none. The keyless way through. */
      function openMatch(index, item) {
        pushMatchItem(ctx, {
          initial: item.text || item.name || '',
          onPick: async (picked) => {
            items = items.map((it, j) =>
              j === index
                ? {
                    ...it,
                    foodId: picked.foodId,
                    draft: picked.draft,
                    name: picked.name,
                    // A span never had an amount, so matching it leaves the row
                    // asking for one rather than inventing a serving.
                    quantity: it.quantity ?? null,
                    unit: it.unit || 'serving',
                    span: false,
                  }
                : it
            )
            await persist()
            repaintAll()
          },
        })
      }

      /**
       * The leftovers call. The only place in the app that sends anything.
       *
       * What goes is what `leftoversPayload` collects and nothing else: the
       * unplaced spans and the phrases that resolved nowhere, as written. What
       * comes back is put through resolution again before any estimate counts,
       * so a dish the model separates out of a compound name still takes real
       * values if the library has it.
       */
      async function sendLeftovers() {
        if (sending) return
        sending = true
        repaintAll()

        controller?.abort()
        controller = new AbortController()

        try {
          const { spans, unresolved } = leftoversPayload(items)
          const returned = await describeLeftovers({
            spans,
            unresolved,
            signal: controller.signal,
          })
          const replacements = await resolveModelItems(returned, { signal: controller.signal })

          // The replacements land where the first unplaced row was, so the
          // plate still reads in the order the sentence was written.
          let inserted = false
          const next = []
          for (const it of items) {
            if (classifyItem(it) === 'unmatched') {
              if (!inserted) {
                next.push(...replacements)
                inserted = true
              }
              continue
            }
            next.push(it)
          }
          items = next
          await persist()
        } catch (err) {
          if (err.name !== 'AbortError') toast(err.message || 'Could not reach Gemini.')
        } finally {
          sending = false
          repaintAll()
        }
      }

      async function repaintAll() {
        // The row carries its own index, because the list is split into two
        // groups for display and a position within a group is not a position
        // on the plate — which is what edit and remove act on.
        const resolved = (await resolve(items)).map((row, index) => ({ ...row, index }))
        const totals = plateTotals(resolved)
        const missing = resolved.filter((r) => r.state === 'missing').length
        // Deleted foods stay in the top group rather than the unfinished one:
        // there is nothing to fix about them, they are simply skipped.
        const settled = resolved.filter((r) => isReady(r) || r.state === 'missing')
        const unfinished = resolved.filter(
          (r) => r.state === 'unmatched' || r.state === 'needs-amount'
        )
        const sendable = resolved.filter((r) => r.state === 'unmatched')

        /**
         * Clearing lives on the totals tile, beside the number it would zero.
         *
         * It used to sit at the very bottom, under Day and Block, on the
         * reasoning that it is the least likely action and should not read as a
         * third primary next to the footer. That kept it quiet and also kept it
         * hidden: on a plate of any length it is below the fold, after two
         * controls nobody scrolls past looking for a way out, and "start again"
         * is a thing you want early rather than after a scroll.
         *
         * The tile is the honest home for it. It is the one element that
         * describes the plate as a whole, so the control that discards the plate
         * as a whole belongs on it — the same pairing `sectionLabel` uses for a
         * heading and its action. It stays a `chip-sm`, so moving it up buys
         * discoverability without claiming any more weight than it had, and the
         * confirm still stands between it and anything irreversible.
         */
        const clearBtn = h(
          'button',
          {
            class: 'chip-sm shrink-0',
            onclick: async () => {
              const ok = await confirm({
                title: 'Clear the plate?',
                message: 'Nothing has been logged yet, so nothing comes off your day.',
                confirmLabel: 'Clear',
              })
              if (!ok) return
              await clearPlate()
              ctx.close()
              toast('Plate cleared')
            },
          },
          'Clear plate'
        )

        repaint(
          body,

          /**
           * The reading on the left, the action on the right, centred against
           * the pair.
           *
           * Sitting the chip in the first row instead lined it up with the
           * calorie figure and left a hole under it, so the tile read as three
           * things in an L rather than two things side by side. The totals are
           * one block — a number and the macros that make it up — and the chip
           * answers to the block, not to its first line.
           */
          h(
            'div',
            { class: 'panel flex items-center justify-between gap-[20px] px-[20px] py-[20px]' },
            h(
              'div',
              { class: 'flex min-w-0 flex-col gap-[10px]' },
              h(
                'div',
                { class: 'flex items-baseline gap-[10px]' },
                h(
                  'span',
                  { class: 'tnum text-title font-semibold leading-none' },
                  String(Math.round(totals.kcal))
                ),
                macroUnit('kcal', 'text-[12px] font-medium')
              ),
              macroLine(totals, { size: 14, omit: ['kcal'] })
            ),
            clearBtn
          ),

          /**
           * What the app worked out, as the plate.
           *
           * The two groups used to be one card with a warning panel under it
           * and a second panel under that, and all three said "6 rows" — once
           * per row in the list, once in prose, once on the button. Three
           * statements of one fact, stacked, and the plate itself was the thing
           * they buried.
           *
           * So the identified rows are the plate, and everything still wanting
           * something is its own group with the action directly beneath it. The
           * heading does the job the warning panel was doing, and the disabled
           * button below already says the plate is not ready.
           */
          settled.length ? card(settled.map(plateRow)) : null,

          missing
            ? notice(
                `${pluralize(missing, 'food')} on this plate ${missing === 1 ? 'has' : 'have'} ` +
                  'been deleted from your library and will be skipped.',
                { iconName: 'alert' }
              )
            : null,

          unfinished.length
            ? h(
                'div',
                { class: 'flex flex-col gap-[10px]' },
                h('div', { class: 'section-label' }, 'Not ready'),
                card(unfinished.map(plateRow)),
                /**
                 * The one control in the app that sends anything anywhere, and
                 * it sits under the rows it would send so that "these" has
                 * something to point at. The label carries the whole
                 * disclosure: a verb, a count, and where it goes.
                 */
                // Gated on the PREFERENCE, not the key: a key alone was
                // never a decision to send. See `getAiMode`.
                sendable.length && aiEnabled()
                  ? h(
                      'button',
                      {
                        // Full width, as the secondary action it is. A chip
                        // made it look optional, and it is the only way forward
                        // for every row in the card above it.
                        class: 'btn-secondary',
                        disabled: sending,
                        onclick: sendLeftovers,
                      },
                      sending
                        ? 'Sending…'
                        : `Send ${pluralize(sendable.length, 'item')} to Gemini`
                    )
                  : null
              )
            : null,

          h(
            'div',
            { class: 'flex flex-col gap-[10px]' },
            h('div', { class: 'section-label' }, 'Day'),
            segmentedWide({
              options: [
                { value: addDays(date, -1), label: formatDayLabel(addDays(date, -1)) },
                { value: date, label: formatDayLabel(date) },
                { value: addDays(date, 1), label: formatDayLabel(addDays(date, 1)) },
              ],
              value: date,
              onChange: async (v) => {
                date = v
                await persist()
                repaintAll()
              },
            })
          ),

          h(
            'div',
            { class: 'flex flex-col gap-[10px]' },
            h('div', { class: 'section-label' }, 'Block'),
            blockSelector({
              value: block,
              onChange: async (v) => {
                block = v
                await persist()
                repaintAll()
              },
              blockNames: settings.blockNames,
            })
          )
        )

        const ready = resolved.filter(isReady)

        /**
         * Committing with estimates on the plate is allowed. Committing with a
         * row that has no food, or a food with no amount, is not — those are
         * not opinions the app is unsure about, they are blanks.
         */
        const logBtn = h(
          'button',
          {
            class: 'btn-primary',
            disabled: !ready.length || unfinished.length > 0 || sending,
            onclick: async () => {
              logBtn.disabled = true
              const entries = await logPlate({ items, date, block })
              await clearPlate()
              onCommitted(entries)
            },
          },
          `Log ${pluralize(ready.length, 'item')}`
        )

        // Both real actions live in the pinned footer, primary above secondary,
        // the same pairing the serving sheet uses for Add and Remove. Saving a
        // plate as a meal is a genuine second option rather than an afterthought
        // at the bottom of a scroll.
        ctx.setFooter(
          h(
            'div',
            { class: 'flex flex-col gap-[10px]' },
            logBtn,
            h(
              'button',
              { class: 'btn-secondary', onclick: () => openSaveAsMeal(items) },
              'Save as a meal'
            )
          )
        )
      }

      /**
       * An estimate has no food to convert against, so its amount is a single
       * number and the macros scale with it.
       *
       * Scaling rather than re-estimating is the honest arithmetic: the model
       * was asked for the total at the amount described, so half that amount is
       * half those numbers. Anything cleverer would be the app inventing a
       * second opinion on top of the first.
       */
      function openEstimateAmount(index, item) {
        ctx.push({
          title: displayName(item.name) || 'Estimate',
          render: (c) => {
            const base = { ...item.computed }
            const from = Number(item.quantity) || 1
            let quantity = String(item.quantity ?? 1)
            const previewEl = h('div')

            const scaled = () => {
              const factor = (Number(quantity) || 0) / from
              return {
                kcal: round(base.kcal * factor, 1),
                protein: round(base.protein * factor, 1),
                fat: round(base.fat * factor, 1),
                carbs: round(base.carbs * factor, 1),
              }
            }

            const paint = () => repaint(previewEl, macroLine(scaled(), { size: 14 }))
            paint()

            c.setFooter(
              h(
                'button',
                {
                  class: 'btn-primary',
                  onclick: async () => {
                    items = items.map((it, j) =>
                      j === index
                        ? { ...it, quantity: Number(quantity) || 0, computed: scaled() }
                        : it
                    )
                    await persist()
                    repaintAll()
                    c.pop()
                  },
                },
                'Update'
              )
            )

            return h(
              'div',
              { class: 'flex flex-col gap-[20px] pb-[10px]' },
              h('div', { class: 'panel px-[20px] py-[20px]' }, previewEl),
              labelledField({
                label: 'Servings',
                hint: 'These numbers are an estimate. Change the amount and they scale with it.',
                children: numberInput({
                  value: quantity,
                  autofocus: true,
                  onInput: (v) => {
                    quantity = v
                    paint()
                  },
                }),
              })
            )
          },
        })
      }

      /** Amount editing, in place — the plate is where servings get tuned. */
      function openAmount(index, food, item) {
        if (!food) return openEstimateAmount(index, item)
        let quantity = String(item.quantity ?? defaultServing(food).quantity)
        let unit = item.unit
        const options = [{ value: 'serving', label: 'servings' }]
        if (!(food.servingUnit === 'item' && Number(food.servingSize) === 1)) {
          options.push({ value: food.servingUnit, label: unitLabel(food.servingUnit, 2) })
        }

        ctx.push({
          title: displayName(food.name),
          render: (c) => {
            const previewEl = h('div')
            const field = numberInput({
              value: quantity,
              autofocus: true,
              onInput: (v) => {
                quantity = v
                paint()
              },
            })
            const unitRow = h('div')
            const paint = () => {
              repaint(previewEl, macroLine(computeMacros(food, Number(quantity) || 0, unit), { size: 14 }))
              repaint(
                unitRow,
                segmentedWide({
                  options,
                  value: unit,
                  onChange: (v) => {
                    const n = Number(quantity) || 0
                    if (v === 'serving' && unit !== 'serving') {
                      quantity = String(round(n / (Number(food.servingSize) || 1), 2))
                    } else if (v !== 'serving' && unit === 'serving') {
                      quantity = String(round(n * (Number(food.servingSize) || 1), 2))
                    }
                    unit = v
                    field.input.value = quantity
                    paint()
                  },
                })
              )
            }
            paint()

            c.setFooter(
              h(
                'button',
                {
                  class: 'btn-primary',
                  onclick: async () => {
                    items = items.map((it, j) =>
                      j === index
                        ? // `corrected` is what spec 5 turns on: a portion is
                          // remembered because YOU set it, never because the app
                          // filled one in. Written at commit, when a draft has
                          // become a food to hang it on.
                          { ...it, quantity: Number(quantity), unit, corrected: true }
                        : it
                    )
                    await persist()
                    repaintAll()
                    c.pop()
                  },
                },
                'Update'
              )
            )

            return h(
              'div',
              { class: 'flex flex-col gap-[20px]' },
              h('div', { class: 'panel px-[20px] py-[20px]' }, previewEl),
              labelledField({
                label: 'Amount',
                children: field,
                hint: `1 serving = ${servingLabel(food)}`,
              }),
              unitRow
            )
          },
        })
      }

      const openSaveAsMeal = (currentItems) => pushSaveAsMeal(ctx, currentItems)

      repaintAll()
      return body
    },
  }
}

/* ---------------------------------------------------------- save as meal */

/**
 * Name a set of rows that has not been logged, and keep it.
 *
 * Shared between the plate and Describe: both hold a list of plate-shaped
 * items that could be committed, and both want the same second option. It
 * pushes onto whichever sheet it was called from.
 *
 * Logging is blocked while a row is unfinished; saving is not, and an
 * unfinished row has nothing in it to save. Said here rather than in the
 * toast afterwards, so the count is a warning instead of a receipt.
 */
export function pushSaveAsMeal(ctx, currentItems, { onSaved } = {}) {
  ctx.push({
    title: 'Save as a meal',
    render: (c) => {
      let name = ''
      const skipped = mealDraftSkips(currentItems)
      const save = h(
        'button',
        {
          class: 'btn-primary',
          disabled: true,
          onclick: async () => {
            save.disabled = true
            await saveDraftAsMeal(name.trim(), currentItems)
            c.pop()
            toast(`Saved "${name.trim()}"`)
            onSaved?.()
          },
        },
        'Save meal'
      )
      c.setFooter(save)
      return h(
        'div',
        { class: 'flex flex-col gap-[20px]' },
        labelledField({
          label: 'Name',
          hint: 'Saved meals are reusable. Saving does not log anything.',
          children: textInput({
            value: '',
            autofocus: true,
            placeholder: 'Usual breakfast',
            onInput: (v) => {
              name = v
              save.disabled = !v.trim()
            },
          }),
        }),
        skipped
          ? notice(
              `${pluralize(skipped, 'row')} still ${
                skipped === 1 ? 'needs' : 'need'
              } a match or an amount and will not be saved. ` +
                'The rest becomes the meal.',
              { iconName: 'alert' }
            )
          : null
      )
    },
  })
}

/* ------------------------------------------------------------------ bar */

/**
 * The running total, pinned above the add sheet's footer.
 *
 * This is the whole discoverability story: if it is not obvious that `+` fills
 * this bar, nothing else about the plate works. Tapping the bar opens it;
 * the button commits without opening it, which is the fast path.
 */
export function plateBar({ rows, onOpen, onLog }) {
  const totals = plateTotals(rows)
  /**
   * Counted the same way the plate counts, which is not the same as "has a
   * food record" any more.
   *
   * An estimate has no food and never will, so the old test read a plate
   * holding one as `0 items · 248 cal` — a bar disagreeing with itself in the
   * space of four words.
   */
  const count = rows.filter(isReady).length

  /**
   * The fast path stops being a fast path when something is unfinished.
   *
   * `Log` here commits without opening the plate, which is exactly right when
   * every row is settled and exactly wrong when one of them has no food:
   * `logPlate` would skip it and the day would quietly be missing something you
   * typed. So with anything outstanding the button opens the plate instead,
   * which is where the row can actually be fixed.
   */
  const unfinished = rows.some((r) => r.state === 'unmatched' || r.state === 'needs-amount')

  return h(
    'div',
    /**
     * 10 on three sides, 20 on the left.
     *
     * The `Log` pill is what the padding has to answer to, and a uniform 20
     * gave it 10 above and below (its own height sets the bar's) against 20 to
     * the right — sitting in a slot it did not fill. Its inset is now equal on
     * the three edges it touches. The left keeps 20 because that side is text,
     * and a glyph needs the gutter every other row in the app gives it; a
     * filled pill carries its own padding and does not.
     */
    {
      class:
        'flex items-center gap-[10px] rounded-[24px] bg-ink py-[10px] pl-[20px] pr-[10px] text-canvas',
    },
    /**
     * The count and the calories, and nothing else.
     *
     * `P · F · C` used to sit under them at 70% opacity, and it was three
     * numbers nobody was going to act on. This bar is a running tally of a
     * plate still being assembled: the question it answers is "how much have I
     * put on here so far", and calories are the answer to that. The macro
     * split matters when the plate is being tuned — which is the plate screen,
     * one tap away through this very button, where every row carries its own
     * full line.
     *
     * It also cost the bar a second line to say it, which pushed the two
     * buttons below it further down a sheet whose whole layout argument is
     * keeping Favourites above the fold.
     */
    h(
      'button',
      {
        class: 'tap-44 min-w-0 flex-1 text-left text-[14px] font-semibold leading-tight',
        onclick: onOpen,
        'aria-label': 'Open your plate',
      },
      `${pluralize(count, 'item')} · ${Math.round(totals.kcal)} cal`
    ),
    h(
      'button',
      {
        class:
          'tap-44 shrink-0 rounded-[999px] bg-canvas px-[20px] py-[10px] text-[14px] font-semibold text-ink',
        onclick: unfinished ? onOpen : onLog,
      },
      /**
       * `Log`, bare.
       *
       * Not "Log 1" — the count is already three words to the left of it, and a
       * bar that says the number twice is a bar with nothing else to say. Not
       * "Add to log" either, which is what this read for several versions: the
       * verb in a direct-log flow is `log`, and "add" was the one place it
       * became something else.
       *
       * The old objection to `Log` alone was that it is the weakest verb in the
       * app — the noun on Today, the name of a screen, a section heading — so a
       * button carrying it says which it means only from where it sits. That is
       * true and it is answered by where this sits: it is on a bar reading
       * `3 items · 812 cal`, which is a sentence with exactly one verb missing.
       *
       * The plate screen keeps `Log {n} items`, because a screen you navigated
       * to has no such sentence beside the button and confirming what is being
       * committed is worth the repetition there.
       */
      'Log'
    )
  )
}

/* --------------------------------------------------------------- opening */

export async function pushPlate(ctx, { plate, onCommitted }) {
  const [settings, rows] = await Promise.all([getSettings(), resolve(plate.items)])
  ctx.push(
    platePanel({
      plate,
      rows,
      settings,
      onChange: savePlate,
      onCommitted,
    })
  )
}

/** Shared commit toast: one undo for the whole plate, never one per item. */
export function plateLoggedToast(entries) {
  toast(`Logged ${pluralize(entries.length, 'item')}`, {
    action: 'Undo',
    onAction: () => Promise.all(entries.map((e) => deleteEntry(e.id))),
  })
}

export { resolve as resolvePlate }
