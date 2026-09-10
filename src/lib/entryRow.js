import { h, swipeToReveal, longPress } from './dom.js'
import { icon } from './icons.js'
import { estimateBadge, foodRowBody } from './ui.js'
import { DESCRIBE_SOURCE } from './logging.js'
import { entryWhen } from './dates.js'

/**
 * One logged entry.
 *
 * Swiping left reveals edit and delete. The actions sit behind the row, the
 * surface tracks the finger, and the two circles grow into place as it uncovers
 * them. Only one row in the app is open at a time.
 *
 * They are full-size ink circles rather than the small tinted ones this used
 * to draw. Those were `bg-canvas` sitting on a `bg-canvas` track, so the only
 * thing marking either control was a 17px hairline glyph floating on the page
 * tint — no edge, no fill, nothing to say where one button ended and the next
 * began. A control revealed by a gesture has no label and no permanent home;
 * the shape has to do all of that work by itself, so it gets the full 44px and
 * the fill.
 */
/**
 * How long the row spends collapsing before the delete is actually written.
 *
 * The write is what triggers the rebuild that replaces this list, so the
 * animation has to finish first or it is replaced mid-flight. See
 * `.swipe-row[data-removing]` for why 180 and why `ease-in`.
 */
const REMOVE_MS = 180

export function entryRow(
  entry,
  { onEdit, onDelete, onDuplicate, onTap, isNew = false, settings = null } = {},
) {
  /**
   * `collapse` is for the one action that removes this row from the list.
   *
   * Edit and duplicate both open a sheet over a row that is still there, so
   * they close the swipe and hand over immediately. Delete does not: the row is
   * about to stop existing, and it should be seen to leave.
   *
   * The delete path deliberately does NOT close the swipe first. Snapping the
   * surface 128px back to the right while the box collapses downward is two
   * movements arguing, and the honest picture is the one where the circle you
   * just pressed stays under your finger as the row goes. The open-row bookkeeping
   * survives it: `openSwipeRow` is guarded by `isConnected` at every use, and
   * this row is a frame away from leaving the document.
   */
  const actionBtn = (name, label, handler, collapse = false) =>
    h(
      'button',
      {
        class: 'icon-btn icon-btn-ink',
        'aria-label': label,
        onclick: (e) => {
          e.stopPropagation()
          if (!collapse) {
            wrapper._closeSwipe?.(false)
            handler(entry)
            return
          }
          // Measured, then written, so there is a real number to animate from —
          // `height: auto` does not interpolate and a guessed `max-height`
          // spends the front of the animation closing space that was not there.
          wrapper.style.height = `${wrapper.offsetHeight}px`
          wrapper.dataset.removing = 'true'
          /**
           * The forced reflow is load-bearing, and a `requestAnimationFrame`
           * here is NOT a substitute — it was tried and the row snapped shut.
           *
           * rAF callbacks run before the frame's style recalculation, so the
           * measured height and the zero can both land before the browser has
           * computed a style for either. What it then sees is `auto → 0`, which
           * does not interpolate. Reading `offsetHeight` back commits the
           * measured value first, so there is a real number to leave from.
           *
           * Same idiom, same reason, as the tab pill's first placement in
           * main.js and the segment pill's handoff in lib/ui.js.
           */
          void wrapper.offsetHeight
          wrapper.style.height = '0px'
          setTimeout(() => handler(entry), REMOVE_MS)
        },
      },
      icon(name, { size: 20 })
    )

  const surface = h(
    'div',
    {
      class: 'row relative',
      'data-swipe-surface': '',
      onclick: onTap ? () => onTap(entry) : null,
    },
    // The shape lives in `foodRowBody` now, shared with the add sheet's lists
    // and the plate. What is left here is what is genuinely this row's: the
    // swipe wrapper, the two revealed controls, the time in the detail slot, and
    // the sparkle on anything whose numbers a model guessed.
    //
    // The badge with no words beside it, unlike the plate, which keeps both. A
    // logged row has already been through the plate once — the label did its
    // explaining there — and this list is read by scanning names, where a
    // repeated word on some rows and not others is noise the glyph is not.
    foodRowBody({
      name: entry.foodName || 'Deleted food',
      // The clock, or the block when the clock disagrees with it. See `entryWhen`.
      detail: entryWhen(entry, settings),
      totals: entry.computed,
      badge: entry.source === DESCRIBE_SOURCE ? estimateBadge() : null,
    })
  )

  const wrapper = h(
    'div',
    // `data-entry-id` is how Today works out, on its NEXT build, which rows
    // were already on screen — see `freshEntryIds`. It is on the row rather
    // than held in a module-scoped set because a render that gets discarded
    // before it mounts must not be able to claim a row was drawn.
    //
    // `row-in` is the one-shot that follows from that answer. Undo restoring a
    // deleted entry counts as an arrival, since the row coming back is the
    // whole point of the offer.
    {
      class: isNew ? 'swipe-row row-in' : 'swipe-row',
      'data-entry-id': entry.id,
    },
    // 20px on the right is the row's own side padding, so the trailing circle
    // lands on the same margin every other thing in the card lines up on.
    h(
      'div',
      { class: 'swipe-actions absolute inset-y-0 right-0 flex items-center gap-[10px] pr-[20px]' },
      onEdit && actionBtn('pencil', 'Edit entry', onEdit),
      onDelete && actionBtn('trash', 'Delete entry', onDelete, true)
    ),
    surface
  )

  // 20 to the card's edge, 44, 10, 44 — 118 of track — and 10 more between the
  // row's rounded end and the first circle, which is the same 10 that separates
  // the two circles. 128 of travel.
  swipeToReveal(wrapper, { width: 128 })
  if (onDuplicate) longPress(wrapper, () => onDuplicate(entry))

  return wrapper
}
