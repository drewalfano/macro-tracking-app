/**
 * Drag-to-reorder for a grid of tiles, by handle.
 *
 * The Apple Fitness "Edit Summary" gesture: press the grip, the tile lifts
 * and follows the finger, the others slide out of its way, release and it
 * settles into the gap. Nothing here knows what a tile is; it moves the
 * children of `grid` and reports their ids.
 *
 * **Layout is read from `offsetTop` and `offsetLeft`, never from
 * `getBoundingClientRect`.** During a slide the neighbours carry transforms,
 * and a bounding rect includes the transform, so measuring one mid-slide
 * would put a tile where it is drawn rather than where it lives. Offsets
 * ignore transforms. That is the whole reason the grid has to be the
 * tiles' `offsetParent`, which `position: relative` on it guarantees.
 *
 * **The dragged tile's centre decides the order, not the finger.** Comparing
 * the finger's point against the neighbours flickers at the moment a swap
 * changes the row heights: the layout moves under a still finger, the
 * finger is now on the other side, and the swap undoes itself. Comparing
 * centres is stable because a swap moves the neighbour away from the dragged
 * tile's centre on the axis the swap happened on, so the condition that
 * caused the swap still holds after it.
 *
 * **Only a tile that moved is animated.** A swap between a half and a full
 * tile can leave some neighbours exactly where they were, and a tile that
 * did not move does not get a transition that says it did.
 */

const SLIDE_MS = 200
const SLIDE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const SETTLE_MS = 220
const EDGE = 80 // px from the viewport edge where auto-scroll starts
const MAX_SCROLL = 14 // px per frame at the very edge

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function reorderable(grid, { handle, onChange, getId = (el) => el.dataset.tile }) {
  const tiles = () => [...grid.children]
  const ids = () => tiles().map(getId)
  const box = (el) => ({
    left: el.offsetLeft,
    top: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight,
  })

  let drag = null

  /** Slide every tile that moved from `before` to where it is now. */
  function flip(before, except) {
    const motion = !reduceMotion()
    for (const el of tiles()) {
      if (el === except) continue
      const was = before.get(el)
      if (!was) continue
      const now = box(el)
      const dx = was.left - now.left
      const dy = was.top - now.top
      if (!dx && !dy) continue
      if (!motion) continue
      el.style.transition = 'none'
      el.style.transform = `translate(${dx}px, ${dy}px)`
      void el.offsetWidth
      el.style.transition = `transform ${SLIDE_MS}ms ${SLIDE_EASE}`
      el.style.transform = ''
      el.addEventListener(
        'transitionend',
        () => {
          el.style.transition = ''
        },
        { once: true },
      )
    }
  }

  const isFull = (el) => el.dataset.size !== 'half'

  /**
   * A full tile never lands between two halves that share a row.
   *
   * Dropped there it would split the pair: one half above it alone in a row
   * with an empty cell, the other below the same way. So when the index for
   * a full tile falls inside a pair, it snaps to the side of the pair its
   * centre is on, and both halves move together. A half tile may go between
   * two halves; that is how pairs are made.
   */
  function snapPairs(el, others, index, cy) {
    if (!isFull(el) || index <= 0 || index >= others.length) return index
    const above = others[index - 1]
    const below = others[index]
    if (isFull(above) || isFull(below)) return index
    const a = box(above)
    const b = box(below)
    if (a.top !== b.top) return index
    const rowCentre = a.top + a.h / 2
    return cy < rowCentre ? index - 1 : index + 1
  }

  /** Where the dragged tile's centre says it belongs in the current layout. */
  function targetIndex(el, cx, cy) {
    const others = tiles().filter((t) => t !== el)
    const mine = box(el)
    let index = others.length
    for (let i = 0; i < others.length; i++) {
      const b = box(others[i])
      const ocx = b.left + b.w / 2
      const ocy = b.top + b.h / 2
      const sameRow = Math.abs(cy - ocy) < Math.min(mine.h, b.h) / 2
      const before = sameRow ? cx < ocx : cy < ocy
      if (before) {
        index = i
        break
      }
    }
    return snapPairs(el, others, index, cy)
  }

  function moveTo(el, index) {
    const others = tiles().filter((t) => t !== el)
    // The tile's index among all tiles is its index among the others once it
    // is lifted out, so equal means "already there".
    if (index === tiles().indexOf(el)) return false
    const before = new Map(tiles().map((t) => [t, box(t)]))
    const ref = others[index] || null
    grid.insertBefore(el, ref)
    flip(before, el)
    return true
  }

  function place() {
    const { el, offX, offY, clientX, clientY } = drag
    const g = grid.getBoundingClientRect()
    // Where the tile's top-left wants to be, in the grid's own coordinates.
    const x = clientX - g.left - offX
    const y = clientY - g.top - offY
    const home = box(el)
    el.style.transform = `translate(${x - home.left}px, ${y - home.top}px)`
    const index = targetIndex(el, x + home.w / 2, y + home.h / 2)
    if (moveTo(el, index)) {
      // The tile has a new home; keep it under the finger, not at the new slot.
      const moved = box(el)
      el.style.transform = `translate(${x - moved.left}px, ${y - moved.top}px)`
    }
  }

  function autoScroll() {
    if (!drag) return
    const { clientY } = drag
    let dy = 0
    if (clientY < EDGE) dy = -Math.ceil(((EDGE - clientY) / EDGE) * MAX_SCROLL)
    else if (clientY > innerHeight - EDGE)
      dy = Math.ceil(((clientY - (innerHeight - EDGE)) / EDGE) * MAX_SCROLL)
    if (dy) {
      const beforeY = scrollY
      scrollBy(0, dy)
      if (scrollY !== beforeY) place()
    }
    drag.raf = requestAnimationFrame(autoScroll)
  }

  function onMove(e) {
    if (!drag) return
    drag.clientX = e.clientX
    drag.clientY = e.clientY
    place()
  }

  function start(e, grip, el) {
    const g = grid.getBoundingClientRect()
    const home = box(el)
    drag = {
      el,
      grip,
      offX: e.clientX - g.left - home.left,
      offY: e.clientY - g.top - home.top,
      clientX: e.clientX,
      clientY: e.clientY,
      from: ids().join(),
      raf: 0,
    }
    /**
     * Capture goes to the GRID, not the grip, and every listener with it.
     *
     * The grip was the captured element, and a drag ended itself after one
     * slot: `moveTo` re-inserts the dragged tile to make room, and removing
     * a node from the document releases its pointer capture, which arrives
     * as `lostpointercapture` and reads as "let go". The grid is never moved,
     * so it holds the capture for the whole gesture and a tile can cross as
     * many slots as the finger does. `lostpointercapture` still ends the
     * drag, for the cases it was added for: a system gesture, a tab switch,
     * a context menu taking the pointer away.
     */
    grid.addEventListener('pointermove', onMove)
    grid.addEventListener('pointerup', end)
    grid.addEventListener('pointercancel', end)
    grid.addEventListener('lostpointercapture', end)
    try {
      grid.setPointerCapture(e.pointerId)
    } catch {
      // No capture: moves still arrive while the pointer is over the grid,
      // and the window catches the release wherever it lands.
      window.addEventListener('pointerup', end, { once: true })
    }
    el.classList.add('is-dragging')
    el.style.transition = 'none'
    drag.raf = requestAnimationFrame(autoScroll)
  }

  function end() {
    if (!drag) return
    const { el, grip, from, raf } = drag
    cancelAnimationFrame(raf)
    drag = null
    grid.removeEventListener('pointermove', onMove)
    grid.removeEventListener('pointerup', end)
    grid.removeEventListener('pointercancel', end)
    grid.removeEventListener('lostpointercapture', end)
    window.removeEventListener('pointerup', end)
    el.classList.remove('is-dragging')
    if (reduceMotion()) {
      el.style.transform = ''
      el.style.transition = ''
    } else {
      // Settle into the slot from wherever the finger left it.
      el.style.transition = `transform ${SETTLE_MS}ms ${SLIDE_EASE}`
      el.style.transform = ''
      el.addEventListener(
        'transitionend',
        () => {
          el.style.transition = ''
        },
        { once: true },
      )
    }
    const now = ids()
    if (now.join() !== from) onChange?.(now)
  }

  function onPointerDown(e) {
    if (drag || e.button !== 0) return
    const grip = e.target.closest(handle)
    if (!grip || !grid.contains(grip)) return
    const el = tiles().find((t) => t.contains(grip))
    if (!el) return
    e.preventDefault()
    start(e, grip, el)
  }

  /** Arrow keys on a focused grip move the tile one step. */
  function onKeyDown(e) {
    const grip = e.target.closest(handle)
    if (!grip || drag) return
    const el = tiles().find((t) => t.contains(grip))
    if (!el) return
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key]
    if (!step) return
    e.preventDefault()
    const order = tiles()
    const i = order.indexOf(el)
    let j = i + step
    if (j < 0 || j >= order.length) return
    // A full tile steps over a paired row rather than into it.
    if (isFull(el) && !isFull(order[j])) {
      const k = j + step
      if (k >= 0 && k < order.length && !isFull(order[k]) && box(order[j]).top === box(order[k]).top) j = k
    }
    const before = new Map(order.map((t) => [t, box(t)]))
    grid.insertBefore(el, step < 0 ? order[j] : order[j].nextSibling)
    flip(before, null)
    grip.focus()
    onChange?.(ids())
  }

  grid.addEventListener('pointerdown', onPointerDown)
  grid.addEventListener('keydown', onKeyDown)

  return {
    destroy() {
      end()
      grid.removeEventListener('pointerdown', onPointerDown)
      grid.removeEventListener('keydown', onKeyDown)
    },
  }
}
