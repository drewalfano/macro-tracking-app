import { h, repaint } from './dom.js'
import { icon } from './icons.js'
import { fromDateStr, toDateStr, todayStr } from './dates.js'
import { loggedDatesInRange } from './db.js'

/**
 * A month grid, in the app's own language.
 *
 * **This exists because the native one cannot be styled.** `ui.js` used to argue
 * the opposite — "the one control where the platform picker is unambiguously
 * better than anything worth building here" — and that was right about the
 * INPUT and wrong about the POPUP. `showPicker()` hands the whole surface to the
 * browser: on desktop Chrome that is a white card with blue accents, its own
 * radii, its own type, and its own idea of a selected day, sitting over an app
 * that has spent a design system's worth of decisions on all four. No CSS
 * reaches inside it. The choice is not "style it or leave it", it is "build it
 * or accept a foreign object".
 *
 * What the native picker was genuinely buying is kept, and it is the part nobody
 * wants to hand-roll: the locale's own week order and day names. Both come from
 * `Intl` here rather than being assumed — a hard-coded Sunday-first grid with
 * English initials is the usual way a custom picker is worse than the one it
 * replaced.
 */

/**
 * The locale's first weekday as 0=Sunday.
 *
 * `Intl` reports 1=Monday…7=Sunday, so Sunday arrives as 7 and `% 7` maps it
 * back to 0. `getWeekInfo` is not everywhere yet — Firefox exposes it as a
 * `weekInfo` property instead, and older Safari has neither — so both spellings
 * are tried before falling back to Sunday.
 */
function firstDayOfWeek() {
  try {
    const locale = new Intl.Locale(navigator.language)
    const info = typeof locale.getWeekInfo === 'function' ? locale.getWeekInfo() : locale.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    /* no Intl.Locale, or a language tag it will not parse */
  }
  return 0
}

/**
 * Narrow weekday initials, rotated to start on the locale's first day.
 *
 * Counted off a date known to be a Sunday rather than off today, so the labels
 * do not depend on when the picker happens to be opened.
 */
function weekdayLabels(first) {
  const sunday = new Date(2024, 0, 7)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday)
    d.setDate(sunday.getDate() + ((first + i) % 7))
    return d.toLocaleDateString(undefined, { weekday: 'narrow' })
  })
}

/**
 * Always six rows, never five.
 *
 * A grid sized to its month is 44px shorter in February, and paging months would
 * resize the sheet under the thumb every few taps. The trailing days are drawn
 * muted and stay pickable — they are real days, and a grid that shows you
 * September the 1st but refuses it is a worse answer than one that takes you
 * there.
 */
function monthCells(year, month, first) {
  const lead = (new Date(year, month, 1).getDay() - first + 7) % 7
  const start = new Date(year, month, 1 - lead)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

/**
 * A panel spec for the sheet's own stack — push it, do not open it.
 *
 * Being a panel rather than a popover is what makes this work on a phone: the
 * grid gets the sheet's full width, so a day is a 44px target instead of the
 * 30-odd a floating card would allow, and it arrives with a back chevron and a
 * title for free. Picking a day pops straight back to the log.
 *
 * `max` defaults to today, matching the log header's forward chevron — the day
 * after today is a day nothing can have been eaten on, and the two controls
 * should not disagree about that.
 */
/**
 * Which days get a dot: `(from, to) => Promise<Set<dateStr>>`, the days in that
 * range with something logged on them.
 *
 * A grid of identical numbers says nothing about where the food is, and picking
 * through a week to find the day you meant is what the dot saves. Default rather
 * than a required argument because every picker in the app is picking a day to
 * look at a log, and one that did not mark them would be the odd one out; `null`
 * turns them off for a picker where the question does not apply.
 */
export function datePickerPanel({
  value,
  max = todayStr(),
  min = null,
  onPick,
  marks = loggedDatesInRange,
}) {
  return {
    title: 'Pick a day',
    render: (ctx) => {
      const selected = value
      const today = todayStr()
      const first = firstDayOfWeek()
      const cursor = fromDateStr(selected)
      let year = cursor.getFullYear()
      let month = cursor.getMonth()

      const label = h('div', { class: 'cal-month' })
      const grid = h('div', { class: 'cal-grid', role: 'grid' })

      const prev = h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': 'Previous month',
          onclick: () => {
            month -= 1
            if (month < 0) {
              month = 11
              year -= 1
            }
            paint()
          },
        },
        icon('chevronLeft', { size: 20, stroke: 2 })
      )

      const next = h(
        'button',
        {
          class: 'icon-btn',
          'aria-label': 'Next month',
          onclick: () => {
            month += 1
            if (month > 11) {
              month = 0
              year += 1
            }
            paint()
          },
        },
        icon('chevronRight', { size: 20, stroke: 2 })
      )

      /**
       * Picking pops the panel itself rather than leaving that to the caller.
       * Choosing a day IS finishing with this screen, and a picker that stayed
       * open after you had answered it would be asking twice.
       */
      const choose = (iso) => {
        onPick(iso)
        ctx.pop()
      }

      const jumpToday = h(
        'button',
        {
          class: 'btn-secondary',
          onclick: () => choose(today),
        },
        'Today'
      )
      ctx.setFooter(jumpToday)

      /**
       * The marked days, accumulated as months are visited.
       *
       * Two sets rather than one: `logged` is every marked day learnt so far,
       * `loaded` the months already asked about. Without the second, a month
       * with nothing logged in it would be re-read on every visit, since an
       * empty answer and an unasked question look the same in the first.
       *
       * A month's read covers all 42 cells, so the neighbouring days it shows
       * come back with it and are not asked for again on their own.
       */
      const logged = new Set()
      const loaded = new Set()
      /** The month a read was started for; a later one supersedes it. */
      let marksToken = ''

      async function loadMarks(from, to) {
        const key = `${year}-${month}`
        if (!marks || loaded.has(key)) return
        marksToken = key
        try {
          const days = await marks(from, to)
          loaded.add(key)
          for (const d of days) logged.add(d)
        } catch (err) {
          // A calendar without dots is the calendar as it was. Nothing here is
          // worth a notice on a sheet the person opened to press one day.
          console.warn('Could not read which days have entries', err)
          return
        }
        // Paged on while the read was out: those cells are not these cells.
        if (marksToken !== key || !grid.isConnected) return
        // A second pass over the month now showing, rather than a dot poked
        // onto each cell: the marked days say so in their labels as well, and
        // one paint keeps the two from drifting apart. It re-enters `loadMarks`
        // and stops at the `loaded` guard above.
        paint()
      }

      function paint() {
        label.textContent = new Date(year, month, 1).toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        })

        // A month whose every day is past `max` has nothing to offer, so the
        // chevron that would reach it is closed off rather than left to land on
        // a grid of dead cells.
        next.disabled = !!max && toDateStr(new Date(year, month + 1, 1)) > max
        prev.disabled = !!min && toDateStr(new Date(year, month, 0)) < min

        const cells = monthCells(year, month, first)
        repaint(
          grid,
          ...cells.map((d) => {
            const iso = toDateStr(d)
            const outside = d.getMonth() !== month
            const disabled = (max && iso > max) || (min && iso < min)

            return h(
              'button',
              {
                class: 'cal-day',
                role: 'gridcell',
                'data-outside': String(outside),
                'data-today': String(iso === today),
                'data-date': iso,
                'data-logged': String(logged.has(iso)),
                'aria-pressed': String(iso === selected),
                'aria-current': iso === today ? 'date' : null,
                // The visible cell is a bare number, which says nothing on its
                // own once it is read aloud out of the grid it sits in.
                // The dot is the one thing on the cell that is not the number,
                // so it is the one thing the label has to add to it.
                'aria-label': `${d.toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}${logged.has(iso) ? '. Logged' : ''}`,
                disabled,
                onclick: () => choose(iso),
              },
              String(d.getDate())
            )
          })
        )

        loadMarks(toDateStr(cells[0]), toDateStr(cells[cells.length - 1]))
      }

      paint()

      return h(
        'div',
        { class: 'flex flex-col gap-[10px]' },
        h('div', { class: 'cal-head' }, prev, label, next),
        h(
          'div',
          { class: 'cal-dow-row', 'aria-hidden': 'true' },
          ...weekdayLabels(first).map((d) => h('div', { class: 'cal-dow' }, d))
        ),
        grid
      )
    },
  }
}
