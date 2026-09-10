import { h, repaint } from '../lib/dom.js'
import { openSheet } from '../lib/sheet.js'
import { toast, openDialog } from '../lib/toast.js'
import {
  getWeight,
  putWeight,
  deleteWeight,
  listWeights,
  getSettings,
  onChange,
} from '../lib/db.js'
import {
  card,
  dateInput,
  numberInput,
  labelledField,
  notice,
  slot,
  tnum,
  emptyRow,
  rowChevron,
} from '../lib/ui.js'
import { kgToUnit, unitToKg, weight as fmtWeight } from '../lib/format.js'
import { dayPhrase, formatDayLabel, todayStr } from '../lib/dates.js'

/**
 * Every weigh-in, and the editor for one of them.
 *
 * The Weight tab's own field is deliberately today-only — weighing yourself is a
 * morning habit and the field should be one tap from the tab, not a form. This
 * is where the rest of the record lives.
 *
 * **It used to be a single-day form, and that was the wrong shape.** It opened on
 * today by default, which made it an exact duplicate of the `Remove` chip that
 * sat above it: both edited or deleted today's reading, one of them from a
 * heading row, for the least common action in the group. And a screen whose
 * whole subject is a line through sixty readings offered no way to see those
 * readings — only a date picker to guess at them one at a time.
 *
 * So the root is the list. The single-day editor is still here, unchanged in what
 * it does, but reached by tapping the day you want rather than by hunting for it
 * in a picker. `Add a day` opens the same editor with nothing in it.
 *
 * One record per day throughout: `putWeight` overwrites rather than appending, so
 * saving onto an existing day is an edit, and the editor says so.
 */

/**
 * The editor for one day, as a pushed panel.
 *
 * The date stays editable rather than being fixed by the row you arrived
 * through. Logging to the wrong morning is the mistake this whole surface exists
 * to fix, and correcting it should not mean deleting one day and creating
 * another.
 */
function dayPanel({ day: initialDay, unit }) {
  return {
    title: 'Weigh-in',
    render: (ctx) => {
      let day = initialDay
      let draft = ''
      let existing = null

      const amount = numberInput({
        value: '',
        suffix: unit,
        placeholder: '—',
        step: '0.1',
        onInput: (v) => {
          draft = v
          syncFooter()
        },
      })

      const status = slot()

      const saveBtn = h(
        'button',
        {
          class: 'btn-primary',
          onclick: async () => {
            const value = Number(draft)
            if (!(value > 0)) return
            saveBtn.disabled = true
            await putWeight(day, unitToKg(value, unit))
            // Back to the list, which is subscribed to `weights` and will have
            // repainted by the time it is on screen again.
            ctx.pop()
            toast(`${existing ? 'Updated' : 'Saved'} ${dayPhrase(day)}`)
          },
        },
        'Save'
      )

      const removeBtn = h(
        'button',
        {
          class: 'btn-secondary',
          onclick: async () => {
            // Undo rather than a dialog, which is how removing an entry already
            // works: the weigh-in comes back exactly as it was, so there is
            // nothing irreversible to ask about. Review finding 7. `existing`
            // is captured now because the panel reassigns it on a day change.
            const removed = existing
            await deleteWeight(day)
            ctx.pop()
            toast('Weigh-in removed', {
              action: 'Undo',
              onAction: () => putWeight(day, removed.kg),
            })
          },
        },
        'Remove this weigh-in'
      )

      function syncFooter() {
        saveBtn.disabled = !(Number(draft) > 0)
        saveBtn.textContent = existing ? 'Update' : 'Save'
        ctx.setFooter(
          h('div', { class: 'flex flex-col gap-[10px]' }, saveBtn, ...(existing ? [removeBtn] : []))
        )
      }

      /** Re-read the picked day so the field always shows what is stored. */
      async function loadDay() {
        existing = await getWeight(day)
        draft = existing ? String(kgToUnit(existing.kg, unit).toFixed(1)) : ''
        amount.input.value = draft
        repaint(
          status,
          existing
            ? notice(
                `${formatDayLabel(day)} already has ${kgToUnit(existing.kg, unit).toFixed(1)} ${unit}. ` +
                  'Saving replaces it. There is only ever one reading a day.'
              )
            : null
        )
        syncFooter()
      }

      loadDay()

      return h(
        'div',
        { class: 'flex flex-col gap-[20px]' },
        labelledField({
          label: 'Day',
          // No future weigh-ins. You cannot have stood on the scales tomorrow.
          children: dateInput({
            value: day,
            max: todayStr(),
            onChange: (v) => {
              if (!v) return
              day = v
              loadDay()
            },
          }),
        }),
        labelledField({ label: 'Weight', children: amount }),
        status
      )
    },
  }
}

/**
 * `day` opens straight onto that day's editor, with no list underneath it.
 *
 * The Weight tile's Log button is a promise of one step, and the list is a
 * step: a person who tapped Log already knows which day they mean. The editor
 * is the same panel the list pushes, so what saves and how it says so is
 * unchanged; `pop` on a lone panel is `history.back()`, which closes the sheet.
 */
export async function openWeighInSheet({ day = null } = {}) {
  const [settings, initial] = await Promise.all([getSettings(), listWeights()])
  const unit = settings.weightUnit
  let weights = initial

  if (day) return openSheet(dayPanel({ day, unit }))

  return openSheet({
    title: 'Weigh-ins',
    render: (ctx) => {
      const body = h('div')

      const addBtn = h(
        'button',
        {
          class: 'btn-primary',
          onclick: () => ctx.push(dayPanel({ day: todayStr(), unit })),
        },
        'Add a day'
      )
      ctx.setFooter(addBtn)

      const paint = () => {
        repaint(
          body,
          card(
            weights.length
              ? // Newest first. The record is read backwards from now, the same
                // way the History list on Trends is.
                [...weights]
                  .reverse()
                  .map((w) =>
                    h(
                      'button',
                      {
                        class: 'row row-single justify-between',
                        onclick: () => ctx.push(dayPanel({ day: w.date, unit })),
                      },
                      h(
                        'span',
                        { class: 'min-w-0 flex-1 truncate text-[14px] font-semibold' },
                        formatDayLabel(w.date)
                      ),
                      h(
                        'span',
                        { class: 'shrink-0 text-[14px]' },
                        tnum(fmtWeight(w.kg, unit)),
                        h('span', { class: 'ml-[4px] text-[12px] text-muted' }, unit)
                      ),
                      rowChevron()
                    )
                  )
              : emptyRow('No weigh-ins yet')
          )
        )
      }

      paint()

      /**
       * The list outlives every edit made through it, since those happen in a
       * panel pushed on top of this one. Subscribing is what makes popping back
       * land on the corrected record rather than the one that was there when the
       * sheet opened — a panel keeps its DOM while it is buried.
       */
      ctx.onDispose(
        onChange((scope) => {
          if (scope !== 'weights' && scope !== 'all') return
          listWeights().then((next) => {
            weights = next
            paint()
          })
        })
      )

      return body
    },
  })
}

/**
 * Today's weight as one card: a field, a Save that becomes Update once the
 * day has a value, and the line that says saving twice replaces rather than
 * adds. It is the entry block the Weight page shows at its foot, and the
 * whole of the sheet the Trends tile's Log button opens, so the two are one
 * function rather than a card and its copy.
 *
 * `onSaved` is what differs: the page has nothing to do after a save because
 * it is watching the store, the sheet closes.
 */
export function todayWeightCard({ unit, today, todayEntry, onSaved = null }) {
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
        onSaved?.()
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

  return card(
    h(
      'div',
      // The plain 20 all round, which is what a card's inset is.
      { class: 'flex flex-col gap-[10px] px-[20px] py-[20px]' },
      h(
        'div',
        { class: 'flex items-center gap-[10px]' },
        h('div', { class: 'min-w-0 flex-1' }, input),
        saveBtn,
      ),
      /**
       * Shown whether or not today already has a value. The thing it answers
       * is "what happens if I weigh myself twice today", and that question
       * arrives BEFORE the first save, not after.
       */
      h(
        'p',
        { class: 'text-[12px] text-muted' },
        'Saving again replaces today’s value rather than adding a second one.',
      ),
    ),
  )
}

/**
 * The Log button's dialog: today's card and nothing else, floating over
 * the dimmed page. Not the list, not the day editor, not a sheet. A tap
 * that said Log gets a field to type in and a button to press, and the
 * card leaves on the save.
 */
export async function openTodayWeightDialog() {
  const today = todayStr()
  const [settings, todayEntry] = await Promise.all([getSettings(), getWeight(today)])
  const unit = settings.weightUnit
  return openDialog({
    title: 'Today’s weight',
    render: (close) => todayWeightCard({ unit, today, todayEntry, onSaved: close }),
  })
}
