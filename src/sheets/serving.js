import { h } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { openSheet, presentSheet } from '../lib/sheet.js'
import { toast } from '../lib/toast.js'
import {
  getFood,
  getSettings,
  putEntry,
  deleteEntry,
  isFavourite,
  toggleFavourite,
} from '../lib/db.js'
import { computeMacros, MACRO_META, MACRO_ORDER } from '../lib/compute.js'
import { logFood, defaultServing, DESCRIBE_SOURCE } from '../lib/logging.js'
import {
  blockSelector,
  estimateBadge,
  macroLine,
  macroTextColor,
  macroUnit,
  notice,
  segmentedWide,
  numberInput,
  labelledField,
} from '../lib/ui.js'
import { unitLabel, servingLabel, round, displayName, stripBrand } from '../lib/format.js'
import { blockForTime, formatDayLabel, addDays, todayStr } from '../lib/dates.js'
import { QUICK_ADD_SOURCE } from './quickAdd.js'
// serving.js and custom.js import each other — `custom.js` pushes this file's
// serving step after it saves a food, and the entry sheet pushes its editor.
// Neither reaches for the other at module scope, only inside a handler, so the
// cycle resolves whichever module the bundler evaluates first.
import { customPanel } from './custom.js'

/**
 * The serving sheet, shared by scan, search, custom, recents and favourites.
 *
 * This is the moment the app feels good or doesn't: the preview recalculates on
 * every keystroke, synchronously, off numbers already in memory. There is no
 * fetch and no await anywhere in the input path.
 */

/* ------------------------------------------------------- when and which block */

/**
 * `Block` and `Day`, as two components rather than as four hand-rolled copies.
 *
 * Both of these were written out inline in three places — the serving panel, the
 * no-food entry sheet below it, and the duplicate sheet — and each copy was the
 * same six lines: a holder div, a `paint` closing over the value, an `onChange`
 * that writes the value and paints again. The copies had already drifted, and in
 * the way that matters: the no-food sheet was the one that never grew a Day
 * beside its Block, so an estimate eaten at 1 AM was the single entry in the app
 * that could not be moved to the day it belonged to.
 *
 * The repaint is not incidental. A segmented control cannot show a selection it
 * has no segment for, so picking `Yesterday` has to re-centre the window on the
 * new day or the next tap has nowhere to go.
 */
function daySection({ value, onChange }) {
  const row = h('div')
  let date = value
  const paint = () => {
    row.replaceChildren(
      segmentedWide({
        options: [addDays(date, -1), date, addDays(date, 1)].map((d) => ({
          value: d,
          label: formatDayLabel(d),
        })),
        value: date,
        onChange: (v) => {
          date = v
          onChange(v)
          paint()
        },
      })
    )
  }
  paint()
  return h(
    'div',
    { class: 'flex flex-col gap-[10px]' },
    h('div', { class: 'section-label' }, 'Day'),
    row
  )
}

function blockSection({ value, blockNames, onChange }) {
  const row = h('div')
  let block = value
  const paint = () => {
    row.replaceChildren(
      blockSelector({
        value: block,
        blockNames,
        onChange: (v) => {
          block = v
          onChange(v)
          paint()
        },
      })
    )
  }
  paint()
  return h(
    'div',
    { class: 'flex flex-col gap-[10px]' },
    h('div', { class: 'section-label' }, 'Block'),
    row
  )
}

function unitOptions(food) {
  // Bare unit names only. Spelling the serving out here — "serving (1 scoop
  // (30 g))" — nests parentheses and wraps; it belongs in the hint line under
  // the amount field instead.
  const options = [{ value: 'serving', label: 'servings' }]
  // A one-item serving has nothing to toggle between.
  if (!(food.servingUnit === 'item' && Number(food.servingSize) === 1)) {
    options.push({ value: food.servingUnit, label: unitLabel(food.servingUnit, 2) })
  }
  return options
}

/**
 * `onStage` is the plate's way in, and it is here because the `+` that used to
 * carry it on every tile and row now logs.
 *
 * That swap is the whole point of the rearrangement: `+` means the same thing
 * everywhere in the app — commit this, now, at the amount shown — and the
 * larger target always opens this panel first. Staging had to go somewhere, and
 * this is the honest place for it: you are building a meal out of specific
 * amounts, and this is the screen where an amount exists. The old `+` staged a
 * default serving and left you to fix it on the plate afterwards.
 *
 * It costs a tap per item against the old one-tap staging. A plate is a
 * deliberate, multi-item activity, so the tap buys a decision that was
 * previously deferred, on a path nobody walks by accident.
 *
 * Absent on `edit`, where there is nothing to stage — the entry is already in
 * the log.
 *
 * ---
 *
 * `onEditFood` is the one thing a custom food's entry sheet has that a scanned
 * product's does not, and the split is about who owns the record rather than
 * about who is looking at it.
 *
 * **This panel never edits macros, on either path.** The food has a serving
 * definition, so Amount is the lever and the four numbers are derived from it —
 * a second, independent way to write them would make the card above disagree
 * with the field below it and give no rule for which wins. A correction to an
 * INSTANCE is an amount, and that is what this sheet changes. A correction to
 * the FOOD is a per-serving number, and that is a different object, so it gets a
 * different sheet.
 *
 * Which leaves the database case with nothing to offer, correctly: the record
 * came from a barcode and is not yours to restate.
 */
export function servingPanel({
  food,
  initial = {},
  mode = 'add',
  settings,
  onSubmit,
  onStage,
  onDelete,
  onEditFood,
}) {
  return {
    title: mode === 'edit' ? 'Edit entry' : 'Add',
    render: (ctx) => {
      const options = unitOptions(food)
      let quantity = String(initial.quantity ?? defaultServing(food).quantity)
      let unit = initial.unit ?? defaultServing(food).unit
      if (!options.some((o) => o.value === unit)) unit = options[0].value
      let block =
        initial.block ?? blockForTime(new Date(), settings.blockThresholds)
      let date = initial.date ?? todayStr()

      const kcalEl = h('span', { class: 'text-title font-semibold leading-none' })
      const macrosEl = h('div')

      const repaintPreview = () => {
        const m = computeMacros(food, Number(quantity) || 0, unit)
        kcalEl.textContent = String(Math.round(m.kcal))
        // Calories are already the display number above, so omit them here.
        macrosEl.replaceChildren(macroLine(m, { size: 14, omit: ['kcal'] }))
        submitBtn.disabled = !(Number(quantity) > 0)
      }

      const submitBtn = h(
        'button',
        {
          class: 'btn-primary',
          onclick: async () => {
            submitBtn.disabled = true
            await onSubmit({ quantity: Number(quantity), unit, block, date })
          },
        },
        /**
         * "Log it", not "Add", and the reason is the button underneath.
         *
         * Alone, "Add" was fine — the sheet is titled Add and there was nowhere
         * else for a food to go. Once staging moved in here, the pair read as
         * one action and a more specific version of it: "Add" never named its
         * destination, so "Add to plate" looked like the same button with
         * detail attached rather than a different place to send the food.
         *
         * Four footers were built and looked at rather than argued about. Two
         * of them kept the verb and named both destinations — "Add to log" over
         * "Add to plate" — which is the tidier pair on paper and still two
         * near-identical pills at a glance. Different verbs is what actually
         * separates them at the speed anyone reads a footer.
         *
         * `Save` still wins on edit: nothing is being logged there, the entry
         * already exists, and staging is absent on that path anyway.
         */
        mode === 'edit' ? 'Save' : 'Log it'
      )

      const unitRow = h('div')
      const paintUnits = () => {
        unitRow.replaceChildren(
          segmentedWide({
            options,
            value: unit,
            onChange: (v) => {
              // Keep the amount meaningful when switching: 1 serving ⇄ 30 g.
              const n = Number(quantity) || 0
              if (v === 'serving' && unit !== 'serving') {
                quantity = String(round(n / (Number(food.servingSize) || 1), 2))
              } else if (v !== 'serving' && unit === 'serving') {
                quantity = String(round(n * (Number(food.servingSize) || 1), 2))
              }
              unit = v
              qtyInput.input.value = quantity
              paintUnits()
              repaintPreview()
            },
          })
        )
      }

      const qtyInput = numberInput({
        value: quantity,
        onInput: (v) => {
          quantity = v
          repaintPreview()
        },
        placeholder: '1',
        autofocus: mode === 'add',
      })

      /**
       * The day is on screen when it matters and out of the way when it does
       * not.
       *
       * Editing always shows it — spec 9, a meal eaten at 1 AM belongs to the
       * day the user says it does. Adding shows it only when the target is not
       * today, which is the case that used to be silent: "Log this" from the
       * food library passes `state.date`, and because History moves that shared
       * date, it can be a day you were only looking at. You would find out when
       * Today did not change.
       */
      const showDate = mode === 'edit' || date !== todayStr()

      /**
       * In the header, beside the close — not in the body.
       *
       * It used to sit on the row under the title, to the right of the food's
       * name, and the two problems there were the same problem. It carried
       * `bg-canvas`, which is what an `.icon-btn` wears when it sits ON a card
       * where the page tint reads as a well cut into white — but this sheet
       * already IS the canvas, so the button was #f0f0f0 on #f0f0f0. Measured,
       * not guessed: 1:1, no edge at all. A star with no visible control around
       * it, hanging beside a line of body text, is not obviously a button.
       *
       * Both go away in the header. It takes the plain surface fill every other
       * `.icon-btn` has, and it sits in the frame with the close rather than in
       * the payload — which is what it is. The two match exactly: same class,
       * same `size: 20, stroke: 2`.
       *
       * `stroke: 2` rather than the 1.75 default because the star is ten
       * vertices with concave curves where most icons here are two or three
       * strokes, so it loses more weight than they do at the same number. The
       * `+` on a food tile takes 2.25 for the same reason.
       */
      const favBtn = h('button', {
        class: 'icon-btn',
        'aria-label': 'Pin to favourites',
        onclick: async () => {
          const now = await toggleFavourite('food', food.id)
          favBtn.replaceChildren(icon('star', { size: 20, stroke: 2, filled: now }))
          toast(now ? 'Pinned to Favourites' : 'Unpinned')
        },
      })
      isFavourite('food', food.id).then((on) =>
        favBtn.replaceChildren(icon('star', { size: 20, stroke: 2, filled: on }))
      )
      ctx.setAction(favBtn)

      /**
       * Beneath the macro card, as a `chip-sm`, which is what the app's other
       * "step sideways into a different object" controls already are — Save as
       * meal on a log heading, Use that under the calorie field.
       *
       * It sits under the card rather than in the header because the header is
       * the sheet's frame: the close and the star are about this sheet and this
       * entry, and a control that opens a DIFFERENT record among them reads as
       * another way to act on the one you are in. Under the card it is directly
       * beneath the four numbers it exists to correct, which is the sentence it
       * needs to say without words.
       */
      const editFoodBtn =
        onEditFood &&
        h(
          'button',
          {
            class: 'chip-sm self-start',
            onclick: () =>
              onEditFood(ctx, { quantity: Number(quantity), unit, block, date }),
          },
          'Edit food'
        )

      paintUnits()
      repaintPreview()

      const stageBtn =
        onStage &&
        mode !== 'edit' &&
        h(
          'button',
          {
            class: 'btn-secondary',
            /**
             * Pops back to the list rather than closing or staying put.
             *
             * A plate is built one food at a time, so staging is almost never
             * the last thing you do — the next action is finding the next item,
             * which is on the panel underneath. Closing the sheet outright
             * would throw away the search or the rail position you were using
             * to find things; staying here leaves you on a dead panel with a
             * spent button, holding an amount for a food already on the plate.
             *
             * The `+` this replaced kept you on the list for exactly this
             * reason. That property was worth carrying over even though the
             * control moved.
             */
            onclick: async () => {
              stageBtn.disabled = true
              await onStage({ quantity: Number(quantity), unit, block, date })
              ctx.pop()
            },
          },
          'Add to plate'
        )

      ctx.setFooter(
        h(
          'div',
          { class: 'flex flex-col gap-[10px]' },
          submitBtn,
          // Under the primary, not beside it. Side by side they read as two
          // equal choices and the panel stops having an obvious way out;
          // logging is what this sheet is for, and staging is the variant.
          stageBtn || null,
          onDelete &&
            h(
              'button',
              {
                class: 'btn-secondary',
                onclick: async () => {
                  /**
                   * No confirm — review finding 7. The dialog that stood here
                   * said "you can undo straight after" in its own message,
                   * which is the case against asking: `onDelete` puts up the
                   * Undo, and the swipe row removes the same entry with no
                   * question at all. One action, one answer.
                   */
                  await onDelete()
                  ctx.close()
                },
              },
              'Remove from log'
            )
        )
      )

      return h(
        'div',
        { class: 'flex flex-col gap-[20px]' },
        h(
          'div',
          { class: 'min-w-0' },
          h('div', { class: 'text-[16px] font-semibold leading-tight' }, displayName(stripBrand(food.name, food.brand))),
          food.brand ? h('div', { class: 'text-[12px] text-muted' }, displayName(food.brand)) : null
        ),

        // The card and its one affordance are a unit, so they sit 10 apart
        // inside their own column rather than 20 apart in the panel's.
        h(
          'div',
          { class: 'flex flex-col items-start gap-[10px]' },
          h(
            'div',
            { class: 'panel flex w-full flex-col gap-[10px] px-[20px] py-[20px]' },
            h(
              'div',
              { class: 'flex items-baseline gap-[10px]' },
              kcalEl,
              macroUnit('kcal', 'text-[12px] font-medium')
            ),
            macrosEl
          ),
          editFoodBtn || null
        ),

        labelledField({
          label: 'Amount',
          children: qtyInput,
          hint: `1 serving = ${servingLabel(food)}`,
        }),
        unitRow,

        blockSection({
          value: block,
          blockNames: settings.blockNames,
          onChange: (v) => (block = v),
        }),

        showDate ? daySection({ value: date, onChange: (v) => (date = v) }) : null
      )
    },
  }
}

/**
 * Push the serving sheet onto an existing sheet (the add-food flow).
 *
 * `onStage` is optional and comes from the add sheet, which is the only caller
 * that has a plate to stage onto. Left off, the panel simply has no plate
 * button — the food library and Today's rail both open this without one,
 * because a plate assembled from a screen that cannot show you the plate is a
 * buffer you have no way of seeing.
 *
 * **The option belongs to the surface, not the route.** Which is a rule the
 * code stated and then broke: a recent carried `onStage` and a scanned barcode
 * did not, so the same food on the same sheet offered a plate or withheld it
 * depending on how you had arrived at it. Scan and Custom now hand it down the
 * same way, and the passing test is the one the rule already implies — if the
 * plate bar is on screen behind this panel, the plate button is in its footer.
 *
 * The `food` handed back alongside the item is what makes that pass-through
 * possible: the add sheet knows it has a plate, but on the scan and Custom
 * routes it does not yet know WHICH food is going onto it, because the food is
 * created or adopted several panels deeper. So the item comes back with the
 * record it was built from rather than the caller having to have held one.
 */
export async function pushServing(ctx, { food, date, block, onStage }) {
  const settings = await getSettings()
  ctx.push(
    servingPanel({
      food,
      settings,
      initial: { ...defaultServing(food), date, block },
      onSubmit: async ({ quantity, unit, block: b, date: d }) => {
        const entry = await logFood({ food, quantity, unit, date: d, block: b })
        ctx.close()
        toast(`Logged ${displayName(food.name)}`, {
          action: 'Undo',
          onAction: () => deleteEntry(entry.id),
        })
      },
      onStage:
        onStage &&
        (({ quantity, unit }) => onStage({ foodId: food.id, quantity, unit }, food)),
    })
  )
}

/** Open the serving sheet standalone, e.g. from the food library. */
export async function openServingSheet({ food, date, block }) {
  const settings = await getSettings()
  const panel = servingPanel({
    food,
    settings,
    initial: { ...defaultServing(food), date, block },
    onSubmit: async ({ quantity, unit, block: b, date: d }) => {
      const entry = await logFood({ food, quantity, unit, date: d, block: b })
      closeCurrent()
      toast(`Logged ${displayName(food.name)}`, {
        action: 'Undo',
        onAction: () => deleteEntry(entry.id),
      })
    },
  })
  let closeCurrent = () => {}
  const promise = openSheet({
    title: panel.title,
    render: (ctx) => {
      closeCurrent = () => ctx.close()
      return panel.render(ctx)
    },
  })
  return promise
}

/* --------------------------------------------- an entry with no food behind it */

/**
 * The entry sheet for a row that stands on its own four numbers.
 *
 * **Editability follows whether the entry has a scalable basis, not who wrote
 * the numbers.** With a food behind it there is a serving definition, so Amount
 * is the lever and the macros are derived; a second way to write them would be
 * two controls for one value. With no food there is nothing to scale, the four
 * numbers ARE the object, and they are the only lever there is. So this sheet
 * is the mirror image of `servingPanel`: no amount, no unit toggle, no serving
 * line, and four fields where that one had a read-only card.
 *
 * **What this replaced was a paragraph.** Three of them, in fact, one per
 * reason, each opening with a variant of "there is no amount to change" — which
 * is a form apologising for a control it is not showing you. The absent Amount
 * field was never the confusing part; the numbers being unreachable was, and no
 * amount of prose fixes that. A control does. The one sentence kept is the
 * deleted-food case, because that one is not justifying an absence: it states a
 * fact about your library that nothing else on screen carries.
 *
 * All three reasons land here, which is the point rather than an economy. An
 * estimate, a quick add and an entry whose food has since been deleted have
 * different histories and identical structure, and the sheet's job is to act on
 * the structure. The history shows in exactly two places: the sparkle beside the
 * name, and the provenance written on save.
 */
function fixedEntryPanel({ entry, settings, kind }) {
  return {
    title: 'Edit entry',
    render: (ctx) => {
      let block = entry.block
      let date = entry.date

      // Strings, not numbers, because that is what an input holds — and a field
      // being cleared mid-edit is an empty string rather than a zero.
      const values = {}
      for (const macro of MACRO_ORDER) {
        values[macro] = String(round(entry.computed[macro] ?? 0, 1))
      }

      const numeric = () => {
        const out = {}
        for (const macro of MACRO_ORDER) out[macro] = round(Number(values[macro]) || 0, 1)
        return out
      }

      /**
       * A blank field is zero, and zero is a real answer here — a 0 cal drink,
       * 0 g of fat. The only thing that is not an answer is a negative macro,
       * which would subtract from the day.
       *
       * Deliberately NOT gated on "something has changed". Save is how you close
       * a sheet you opened to check something, and a primary button greyed out
       * because you looked without touching is a dead end.
       */
      const valid = () =>
        MACRO_ORDER.every((m) => values[m] === '' || Number(values[m]) >= 0)

      const saveBtn = h(
        'button',
        {
          class: 'btn-primary',
          onclick: async () => {
            saveBtn.disabled = true
            const computed = numeric()
            /**
             * `estimate` is what the model said; `edited` is the claim that the
             * row no longer says it.
             *
             * The original is backfilled from `computed` for entries logged
             * before it was recorded — at that moment `computed` still IS the
             * estimate, because this is the first surface that could ever have
             * changed it.
             *
             * Compared field by field rather than trusting the keystrokes: retyping
             * 245 over 245 is not an edit, and a sheet opened, poked at and put
             * back the way it was must not leave a mark. `edited` is sticky once
             * set — the honest reading is "this differs from what was estimated",
             * and correcting a correction back does not un-estimate it.
             */
            const original = kind === 'estimate' ? (entry.estimate ?? entry.computed) : null
            const changed =
              original && MACRO_ORDER.some((m) => computed[m] !== round(original[m] ?? 0, 1))

            await putEntry({
              ...entry,
              block,
              date,
              computed,
              ...(original ? { estimate: { ...original }, edited: entry.edited || changed } : null),
            })
            ctx.close()
          },
        },
        'Save'
      )

      ctx.setFooter(
        h(
          'div',
          { class: 'flex flex-col gap-[10px]' },
          saveBtn,
          h(
            'button',
            {
              class: 'btn-secondary',
              onclick: async () => {
                // No confirm: the Undo on the toast is the whole safety net,
                // and the swipe row removes an entry with no question either.
                // Review finding 7.
                await deleteEntry(entry.id)
                ctx.close()
                toast('Removed', { action: 'Undo', onAction: () => putEntry(entry) })
              },
            },
            'Remove from log'
          )
        )
      )

      /**
       * The label carries the macro's hue and the number inside stays in ink —
       * the split `macroRow` sets on Today and the Settings targets take through
       * `valueRow`. `g` after protein stays muted: it is a unit of measure, and
       * the hue means macro identity. `cal` is a macro's own token and is
       * coloured as one, exactly as it is beside every other calorie figure.
       *
       * The field is `numberInput` unbared, so it is the Amount field's pill at
       * the Amount field's height and type scale — which is what makes this sheet
       * and the serving sheet read as two arrangements of one form rather than as
       * two forms.
       */
      const macroField = (macro) =>
        labelledField({
          label: MACRO_META[macro].label,
          color: macroTextColor(macro),
          children: numberInput({
            value: values[macro],
            suffix: macro === 'kcal' ? 'cal' : 'g',
            suffixMacro: macro === 'kcal' ? 'kcal' : null,
            onInput: (v) => {
              values[macro] = v
              saveBtn.disabled = !valid()
            },
          }),
        })

      return h(
        'div',
        { class: 'flex flex-col gap-[20px]' },

        /**
         * The sparkle stays, and it is the same `estimateBadge` the log row and
         * the plate draw — before the name, on the baseline. Editing the numbers
         * does not stop them having been estimated, so the mark that says where
         * they came from is not a thing this sheet can spend.
         */
        h(
          'div',
          { class: 'flex min-w-0 items-baseline text-[16px] font-semibold leading-tight' },
          kind === 'estimate' ? estimateBadge() : null,
          h(
            'span',
            { class: 'min-w-0' },
            displayName(entry.foodName) || 'Deleted food'
          )
        ),

        // The one surviving sentence, and it is not about a missing control: the
        // food is gone from the library, which is a fact about somewhere else.
        kind === 'orphan'
          ? notice(
              'This food was deleted from your library. The numbers below are this ' +
                'entry’s own now, and changing them changes nothing else.'
            )
          : null,

        // Calories full width, the three macros in equal columns — the same
        // arrangement, and the same reasoning, as the Custom sheet: calories are
        // the number most likely to run to four digits, and three stacked
        // single-word fields spend a third of a form on twelve characters.
        labelledField({
          label: MACRO_META.kcal.label,
          color: macroTextColor('kcal'),
          children: numberInput({
            value: values.kcal,
            suffix: 'cal',
            suffixMacro: 'kcal',
            onInput: (v) => {
              values.kcal = v
              saveBtn.disabled = !valid()
            },
          }),
        }),
        h(
          'div',
          { class: 'macro-row flex gap-[10px]' },
          ...['protein', 'fat', 'carbs'].map((m) =>
            h('div', { class: 'min-w-0 flex-1' }, macroField(m))
          )
        ),

        blockSection({
          value: block,
          blockNames: settings.blockNames,
          onChange: (v) => (block = v),
        }),
        daySection({ value: date, onChange: (v) => (date = v) })
      )
    },
  }
}

/**
 * Edit an existing entry, on whichever of the three sheets its type earns.
 *
 * A database food and a custom food get `servingPanel`, identical apart from the
 * Edit food control; everything with no food behind it gets `fixedEntryPanel`.
 * The branch is on whether a food record can be loaded, which is the same
 * question as whether there is anything to scale against.
 *
 * **No sheet here shows a control it cannot act on.** That is why the star is
 * absent below rather than disabled: an estimate has no food record to pin, so
 * starring one would have to invent a custom food out of it, and a greyed star
 * is a promise that the sheet cannot keep. `servingPanel` sets it through
 * `ctx.setAction`; this branch simply never calls that.
 *
 * `host` is the sheet this was opened from, when there is one. From the log it
 * pushes a panel rather than replacing the sheet the row is in; from Today,
 * where there is no sheet to be inside, it opens one as it always did.
 */
export async function openEditEntry(entry, host) {
  const [food, settings] = await Promise.all([
    entry.foodId ? getFood(entry.foodId) : null,
    getSettings(),
  ])
  if (!food) {
    /**
     * Three histories, one structure — and the kind is read off `source` in the
     * order the sources are specific in.
     *
     * An estimate satisfies `!entry.foodId` as much as a quick add does, so it
     * has to be tested first or the sparkle would go to whichever branch was
     * written first. `orphan` is what is left: an entry that DID name a food and
     * cannot find it, which is the only one of the three the reader could not
     * work out from the sheet alone.
     */
    const kind =
      entry.source === DESCRIBE_SOURCE
        ? 'estimate'
        : entry.source === QUICK_ADD_SOURCE || !entry.foodId
          ? 'quick'
          : 'orphan'

    return presentSheet(fixedEntryPanel({ entry, settings, kind }), host)
  }

  /**
   * The amount lives out here so it survives a trip into the food editor.
   *
   * `ctx.refresh` re-runs the panel's render, which reads `initial` again — so
   * a half-typed 1.5 servings would be thrown away by the very refresh that
   * exists to show the corrected food. Writing the panel's current values back
   * before pushing is what makes the round trip invisible.
   */
  const initial = {
    quantity: entry.quantity,
    unit: entry.unit,
    block: entry.block,
    date: entry.date,
  }

  const panel = servingPanel({
    food,
    settings,
    mode: 'edit',
    initial,
    /**
     * Yours to correct, or someone else's to trust.
     *
     * `source` is the whole test: `custom` is a food you authored, so its
     * per-serving numbers are a thing you can be wrong about and fix. `off` came
     * from Open Food Facts against a barcode, and `staple` from the built-in
     * table — both are external records, and an entry sheet is not where you
     * rewrite one. (The food library still offers Edit food on all of them,
     * which is a different surface with a different claim: there you are looking
     * at the record itself, not at one night's dinner.)
     *
     * **A saved edit changes the food and this entry, and no other.** The app
     * has always snapshotted `computed` at log time — it is why deleting a food
     * leaves a month of history intact, and the delete confirmation says so in
     * as many words — so past entries do not shift under a correction. This one
     * does, because you are stood in front of it: `onSubmit` recomputes from the
     * food record, and by then the record is the corrected one.
     */
    onEditFood:
      food.source === 'custom'
        ? (panelCtx, current) => {
            Object.assign(initial, current)
            panelCtx.push(
              customPanel({
                initial: food,
                mode: 'edit',
                onSaved: async (saved) => {
                  // Mutated rather than reassigned: `servingPanel` closed over
                  // this object, and the refresh below has to see the new
                  // numbers through the same reference.
                  Object.assign(food, saved)
                  panelCtx.refresh()
                  panelCtx.pop()
                  toast('Saved')
                },
              })
            )
          }
        : null,
    onSubmit: async ({ quantity, unit, block, date }) => {
      const macros = computeMacros(food, quantity, unit)
      await putEntry({
        ...entry,
        quantity,
        unit,
        block,
        date,
        computed: {
          kcal: round(macros.kcal, 1),
          protein: round(macros.protein, 1),
          fat: round(macros.fat, 1),
          carbs: round(macros.carbs, 1),
        },
      })
      close()
    },
    onDelete: async () => {
      await deleteEntry(entry.id)
      toast('Removed', { action: 'Undo', onAction: () => putEntry(entry) })
    },
  })

  let close = () => {}
  return presentSheet({
    title: panel.title,
    render: (ctx) => {
      close = () => ctx.close()
      return panel.render(ctx)
    },
  }, host)
}
