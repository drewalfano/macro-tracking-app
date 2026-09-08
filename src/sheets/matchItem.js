import { h, repaint } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { searchFoods, SEARCH_DEBOUNCE_MS } from '../lib/db.js'
import { searchNewStaples, stapleDraft, stapleName } from '../lib/staples.js'
import { searchProducts, isOnline } from '../lib/off.js'
import { card, listRow, emptyRow } from '../lib/ui.js'
import { servingLabel, displayName } from '../lib/format.js'

/**
 * Attaching a food to a row that has none.
 *
 * This is the keyless path's other half. A row reading "Needs a match" can
 * always be removed, but removing it is not fixing it — and with no API key
 * stored, this panel is the ONLY way a described food that resolved to nothing
 * becomes a real entry. It has to be a first-class way through, not a
 * consolation.
 *
 * It is the add sheet's search, minus everything that screen does afterwards.
 * The same three sources in the same order, the same argument for that order,
 * the same row components — but where the add sheet's rows log or open a
 * serving panel, these hand a food back to the caller and pop. The amount is
 * already on the plate row; what is missing is the food.
 *
 * Deliberately NOT a copy of `openAddFood`'s body: that screen carries
 * favourites, recents, a plate bar and two route buttons, none of which mean
 * anything when the question is "which food is this one row".
 */

/**
 * @param {object} ctx        the sheet context to push onto
 * @param {string} initial    the phrase to search for, prefilled
 * @param {(picked: {foodId?: string, draft?: object, name: string}) => void} onPick
 */
export function pushMatchItem(ctx, { initial = '', onPick }) {
  ctx.push({
    title: 'Find a food',
    render: (c) => {
      let query = initial
      let timer = null
      let controller = null

      const results = h('div')

      const choose = (picked) => {
        onPick(picked)
        c.pop()
      }

      // Same field the add sheet uses, same placeholder grammar.
      const input = h('input', {
        class: 'w-full min-w-0 bg-transparent text-[16px] font-medium',
        type: 'search',
        value: initial,
        placeholder: 'Search foods…',
        enterkeyhint: 'search',
        autocomplete: 'off',
        autocorrect: 'off',
        spellcheck: 'false',
        autofocus: true,
        oninput: (e) => {
          query = e.target.value
          run()
        },
      })

      const field = h(
        'div',
        { class: 'field' },
        icon('search', { size: 18, class: 'shrink-0 text-muted' }),
        input
      )

      const setTail = (list, node) => {
        list.tail?.remove()
        list.tail = node
        if (node) list.appendChild(node)
      }

      /**
       * Library, then staples, then Open Food Facts — the order `describeResolve`
       * uses and the add sheet's search documents at length. Your own foods cost
       * no network and are the likely hit; a bare noun means the generic answer
       * beats the branded one.
       */
      async function paint(q) {
        const [found, staples] = await Promise.all([searchFoods(q, 20), searchNewStaples(q, 6)])
        if (q !== query.trim()) return

        const list = card([
          ...found.map((food) =>
            listRow({
              title: displayName(food.name),
              subtitle: [displayName(food.brand), servingLabel(food)].filter(Boolean).join(' · '),
              // `name` goes onto the plate item, where it is a search and re-match
              // target rather than a label — so it carries the RAW stored string.
              onclick: () => choose({ foodId: food.id, name: food.name }),
            })
          ),
          ...staples.map((staple) =>
            listRow({
              title: displayName(stapleName(staple)),
              subtitle: staple.servingLabel,
              onclick: () => {
                const draft = { ...stapleDraft(staple), name: stapleName(staple) }
                choose({ draft, name: draft.name })
              },
            })
          ),
        ])

        repaint(results, h('div', { class: 'flex flex-col gap-[10px]' }, list))
        paintRemote(q, found, list, found.length + staples.length)
      }

      async function paintRemote(q, local, list, offlineCount) {
        if (!isOnline()) {
          setTail(
            list,
            emptyRow(
              offlineCount
                ? 'Offline, showing what is on this device.'
                : 'Offline, and nothing on this device matches.'
            )
          )
          return
        }

        setTail(list, h('div', { class: 'row text-[14px] text-muted' }, 'Searching Open Food Facts…'))

        controller?.abort()
        controller = new AbortController()

        try {
          const products = await searchProducts(q, { signal: controller.signal })
          if (q !== query.trim()) return

          const known = new Set(local.map((f) => f.barcode).filter(Boolean))
          const fresh = products.filter((r) => !known.has(r.draft.barcode))

          setTail(list, null)
          fresh.slice(0, 20).forEach(({ draft }) =>
            list.appendChild(
              listRow({
                title: displayName(draft.name),
                subtitle: [displayName(draft.brand), draft.servingLabel].filter(Boolean).join(' · '),
                onclick: () => choose({ draft, name: draft.name }),
              })
            )
          )

          if (!fresh.length) {
            setTail(
              list,
              offlineCount
                ? emptyRow('Nothing on Open Food Facts to add to this.')
                : emptyRow(`Nothing matches “${q}”.`)
            )
          }
        } catch (err) {
          if (err.name === 'AbortError') return
          setTail(
            list,
            emptyRow('Could not reach Open Food Facts.', {
              action: 'Try again',
              onAction: () => paintRemote(q, local, list, offlineCount),
            })
          )
        }
      }

      function run() {
        clearTimeout(timer)
        controller?.abort()
        const q = query.trim()
        if (q.length < 2) {
          repaint(results)
          return
        }
        timer = setTimeout(() => paint(q), SEARCH_DEBOUNCE_MS)
      }

      c.onDispose(() => {
        clearTimeout(timer)
        controller?.abort()
      })

      run()

      return h('div', { class: 'flex flex-col gap-[20px]' }, field, results)
    },
  })
}
