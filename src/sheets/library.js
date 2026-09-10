import { h } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { openSheet } from '../lib/sheet.js'
import { toast, confirm } from '../lib/toast.js'
import {
  getSettings,
  listMeals,
  getFood,
  getMeal,
  putMeal,
  deleteMeal,
  moveFavourite,
  toggleFavourite,
} from '../lib/db.js'
import { card, emptyRow, textInput } from '../lib/ui.js'
import { pluralize, displayName, stripBrand } from '../lib/format.js'

/**
 * Curating what is already in the library: the pinned order, and the saved
 * meals.
 *
 * These lived in `settings.js` while Settings was the only door to them. They
 * are reached from the food library now, which is where the rest of the
 * database interface is, so they belong beside the other sheets rather than
 * inside the screen that used to own them.
 */

export function favouritesSheet() {
  return openSheet({
    title: 'Favourites',
    render: () => {
      const list = h('div')

      async function paint() {
        const settings = await getSettings()
        const rows = []
        for (const [index, fav] of settings.favourites.entries()) {
          const item = fav.type === 'food' ? await getFood(fav.id) : await getMeal(fav.id)
          if (!item) continue
          rows.push(
            h(
              'div',
              { class: 'row' },
              h(
                'div',
                { class: 'min-w-0 flex-1' },
                h('div', { class: 'truncate text-[14px] font-semibold' }, displayName(stripBrand(item.name, item.brand))),
                h(
                  'div',
                  { class: 'text-[12px] text-muted' },
                  fav.type === 'meal' ? pluralize(item.items.length, 'item') : 'Food'
                )
              ),
              h(
                'button',
                {
                  class: 'icon-btn bg-canvas',
                  'aria-label': 'Move up',
                  disabled: index === 0,
                  style: index === 0 ? { opacity: '0.3' } : null,
                  onclick: async () => {
                    await moveFavourite(index, -1)
                    paint()
                  },
                },
                icon('chevronUp', { size: 18 })
              ),
              h(
                'button',
                {
                  class: 'icon-btn bg-canvas',
                  'aria-label': 'Move down',
                  disabled: index === settings.favourites.length - 1,
                  style: index === settings.favourites.length - 1 ? { opacity: '0.3' } : null,
                  onclick: async () => {
                    await moveFavourite(index, 1)
                    paint()
                  },
                },
                icon('chevronDown', { size: 18 })
              ),
              h(
                'button',
                {
                  class: 'icon-btn bg-canvas',
                  'aria-label': 'Unpin',
                  onclick: async () => {
                    await toggleFavourite(fav.type, fav.id)
                    paint()
                  },
                },
                icon('close', { size: 16 })
              )
            )
          )
        }

        list.replaceChildren(
          card(rows.length ? rows : emptyRow('Nothing pinned yet.')),
          h(
            'p',
            { class: 'px-0 pt-[10px] text-[12px] leading-snug text-muted' },
            'Favourites never re-sort themselves. Fixed positions are what make the tap ' +
              'muscle memory, so the order here is the order in the add sheet.'
          )
        )
      }

      paint()
      return list
    },
  })
}

export function mealsSheet() {
  return openSheet({
    title: 'Saved meals',
    render: () => {
      const list = h('div')

      async function paint() {
        const [meals, settings] = await Promise.all([listMeals(), getSettings()])
        meals.sort((a, b) => (b.useCount || 0) - (a.useCount || 0))

        list.replaceChildren(
          card(
            meals.length
              ? meals.map((meal) =>
                  h(
                    'div',
                    { class: 'row' },
                    h(
                      'div',
                      { class: 'min-w-0 flex-1' },
                      h('div', { class: 'truncate text-[14px] font-semibold' }, displayName(meal.name)),
                      h(
                        'div',
                        { class: 'text-[12px] text-muted' },
                        `${pluralize(meal.items.length, 'item')} · used ${meal.useCount || 0}×`
                      )
                    ),
                    h(
                      'button',
                      {
                        class: 'icon-btn bg-canvas',
                        'aria-label': 'Pin or unpin',
                        onclick: async () => {
                          await toggleFavourite('meal', meal.id)
                          paint()
                        },
                      },
                      icon('star', {
                        size: 17,
                        filled: settings.favourites.some(
                          (f) => f.type === 'meal' && f.id === meal.id
                        ),
                      })
                    ),
                    h(
                      'button',
                      {
                        class: 'icon-btn bg-canvas',
                        'aria-label': 'Rename',
                        onclick: async () => {
                          // The RAW name, not the cased one. This field edits the
                          // record, and an edit box prefilled with a display
                          // transform would write the transform back on save.
                          const name = await promptText('Rename meal', meal.name)
                          if (name) {
                            await putMeal({ ...meal, name })
                            paint()
                          }
                        },
                      },
                      icon('pencil', { size: 16 })
                    ),
                    h(
                      'button',
                      {
                        class: 'icon-btn bg-canvas',
                        'aria-label': 'Delete',
                        onclick: async () => {
                          const ok = await confirm({
                            title: `Delete "${displayName(meal.name)}"?`,
                            message: 'Entries already logged from it are not affected.',
                          })
                          if (ok) {
                            await deleteMeal(meal.id)
                            paint()
                          }
                        },
                      },
                      icon('trash', { size: 16 })
                    )
                  )
                )
              : emptyRow('Save a block from the Log day view to create one.')
          )
        )
      }

      paint()
      return list
    },
  })
}

/** Small one-field sheet, used for renames. */
function promptText(title, initial) {
  return openSheet({
    title,
    render: (ctx) => {
      let value = initial
      ctx.setFooter(
        h('button', { class: 'btn-primary', onclick: () => ctx.close(value.trim()) }, 'Save')
      )
      return h(
        'div',
        { class: 'pb-[10px]' },
        textInput({ value, autofocus: true, onInput: (v) => (value = v) })
      )
    },
  })
}
