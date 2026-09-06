import { h, clear, swipeToDismiss, reduceMotion } from './dom.js'
import { fadeLayers, SHEET_HEAD_RAMP } from './fade.js'
import { icon } from './icons.js'
import { setScrimmed } from './statusBar.js'
import { captureViewportState } from './viewportProbe.js'

/**
 * Bottom sheet with a panel stack.
 *
 * The Add Food action row is a route picker, not a tab set, so choosing Scan or
 * Search or Custom pushes a panel rather than swapping the body. Panels keep
 * their DOM when you push past them, so going back to a search restores the
 * query and results instead of starting over.
 *
 * The hardware/gesture back button pops one panel, which is why each push gets
 * its own history entry.
 */

let active = null

const STATE = 'mt-sheet'

/**
 * A panel change is ONE movement, so the content and the sheet that holds it
 * are given the same duration and the same curve.
 *
 * They were tuned separately at first and that is exactly what read as wrong:
 * the contents slid on one clock and the container resized on another (which is
 * to say, instantly). Declared here rather than in the stylesheet because the
 * height is animated from JS — see `resizeTo` — and two numbers that have to
 * agree should not live in two files. `.panel-in` in styles.css carries the
 * matching pair and a note pointing here.
 */
const PANEL_MS = 240
const PANEL_EASE = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)'

/**
 * iOS-safe scroll lock.
 *
 * `overflow: hidden` on body does not reliably lock scrolling in mobile Safari,
 * and the page loses its scroll offset while the sheet is open — so closing it
 * snaps the list back to the top. Pinning the body at a negative offset holds
 * the position visually, and it is restored on unlock.
 *
 * The height is given rather than left to `height: auto`, which would shrink the
 * pinned body to its content, and rather than `bottom: 0`, which is the edge
 * `.screen-floor` in styles.css exists because WebKit will not commit to. It uses
 * `--screen-h` for the same reason everything else does: `dvh` is short here. The box
 * runs from `-lockedScrollY` to the bottom of the screen — so the page still
 * shows the row it was showing, and the `overflow: hidden` clip lands a full
 * viewport below the fold rather than mid-screen.
 */
let lockedScrollY = 0

function lockScroll(lock) {
  const { style } = document.body
  if (lock) {
    lockedScrollY = window.scrollY
    style.position = 'fixed'
    style.top = `-${lockedScrollY}px`
    style.height = `calc(var(--screen-h) + ${lockedScrollY}px)`
    style.left = '0'
    style.right = '0'
  } else {
    style.position = ''
    style.top = ''
    style.height = ''
    style.left = ''
    style.right = ''
    window.scrollTo(0, lockedScrollY)
  }
}

/**
 * A pinned `<body>` with no sheet on screen, released.
 *
 * This has gone wrong once already and the note on `onPop` describes what it
 * cost: a sheet whose history entry was misread never reached `destroy`, so
 * `lockScroll(false)` never ran and the body stayed at `position: fixed;
 * overflow: hidden` for the rest of the session. **On iOS that is not a quiet
 * failure.** A pinned layout viewport drags fixed chrome off the bottom of the
 * screen — the tab bar stops sitting 20px up, the sheet's own bottom edge stops
 * meeting the screen's, and a list ends well above where the screen does.
 *
 * That specific route is closed: history entries carry the sheet's id, and
 * `destroy` is idempotent. This is not a substitute for either. It is the
 * admission that the balance of one `lockScroll(true)` against one
 * `lockScroll(false)` is a property of every close path there is — the close
 * button, the scrim, Escape, the swipe, the hardware back, a sheet replaced by
 * another mid-teardown — and that the cost of getting it wrong is paid on the
 * screen the app is looked at first, silently, until the app is relaunched.
 *
 * So the invariant is checked rather than argued: no sheet in the document
 * means the body is not pinned. Checked on the events that bracket where the
 * failure would be noticed — coming back to a backgrounded PWA, a viewport
 * change, a restore from the page cache — rather than on a timer, because there
 * is nothing here worth a wakeup.
 *
 * `active` is deliberately not the test on its own. It stays set through the
 * 200ms exit animation, and what matters is whether anything is actually on
 * screen holding the lock, which is a fact about the document.
 */
function releaseOrphanedLock() {
  if (active || document.querySelector('.sheet-scrim')) return
  if (document.body.style.position !== 'fixed') return
  lockScroll(false)
}

window.addEventListener('pageshow', releaseOrphanedLock)
window.addEventListener('resize', releaseOrphanedLock)
document.addEventListener('visibilitychange', releaseOrphanedLock)

export function isSheetOpen() {
  return !!active
}

/**
 * Open a spec as a sheet, or as a PANEL on a sheet that is already open.
 *
 * `openSheet` destroys any live sheet before building its own — "one sheet at a
 * time", and every top-level entry point in the app relies on that. It stopped
 * being the whole story when the Log screen became a sheet, because everything
 * you can do to a row in there — edit, duplicate, save as meal, add to a block —
 * is itself an `openSheet` call. Each one would have destroyed the log out from
 * under the finger, and closing it would have landed you on Today rather than
 * back in the log you were reading.
 *
 * The panel stack already models exactly this: a sheet within a sheet, with a
 * back chevron and a history entry to unwind. So the fix is not a second sheet,
 * it is the caller saying which one it is inside. `host` is the ctx of the sheet
 * the action was launched FROM, and is threaded down from the log's row
 * handlers. Absent — every other caller in the app — this is `openSheet`
 * unchanged, which is why nothing else had to move.
 */
export function presentSheet(spec, host) {
  return host ? host.push(spec) : openSheet(spec)
}

/**
 * There was an `inset` option here — the gap left above the sheet, defaulting to
 * the 20px notch clearance, with the log asking for 60 so it would read as
 * temporary. Two sheets opened over the same screen therefore came to rest at
 * two different heights, and neither height was anchored to anything on the page
 * behind them: 20 clipped the day's title, 60 clipped the dashboard card.
 *
 * The cap is now `--content-top` for every sheet, in CSS on `.sheet-panel`, so a
 * sheet's top edge is the dashboard card's top edge. What the log wanted is what
 * that gives — a visible band of Today above the sheet — except it is a whole
 * element rather than an arbitrary distance, and every other sheet gets it too.
 *
 * There was briefly a `header` option here too, letting the root panel swap the
 * default back/title/close row for one of its own. The log was its only caller
 * and used it for a date stepper, which turned out to be the duplicate of a
 * control already visible on Today through the scrim. With the stepper gone the
 * log wants a plain title like everything else, so the option went with it.
 */
export function openSheet({ title, render, footer = null, action = null }) {
  // One sheet at a time. A second open replaces the first.
  if (active) active.destroy()

  /**
   * Where focus goes when this closes.
   *
   * Captured before anything is built, because building the panel is what moves
   * focus off it. Restored in `destroy` rather than `teardown` so it lands after
   * the exit animation, not in the middle of one.
   */
  const opener = document.activeElement

  let resolveResult
  const result = new Promise((r) => (resolveResult = r))

  const panels = []
  let closing = false
  let destroyed = false

  /**
   * The status strip, moved off both ends of the sheet's life — gaps item 10.
   *
   * On an installed iOS PWA the band behind the clock is painted by the browser
   * from `theme-color`. No CSS reaches it and nothing about it can be
   * transitioned, so the only thing available is WHEN the value is published.
   * Both ends used to be published at the wrong moment: the scrimmed colour
   * landed on the frame the scrim was appended, so the strip snapped to its
   * darkest while the scrim below it had 260ms still to fade, and the canvas
   * colour landed inside `destroy()` at the 200ms mark, so the strip stayed dark
   * for the whole exit and then snapped back after the scrim had already gone.
   * A quarter second of the app looking like two layers composited separately,
   * at both ends, which is the exact artefact `statusBar.js` exists to close.
   *
   * Going in, it is published at the midpoint of `scrim-in` instead of at its
   * start — where the scrim is closest to matching it. Coming out, at the START
   * of the exit rather than its end, for the same reason.
   *
   * The pair is balanced by `scrimHeld` rather than by trusting the two call
   * sites to fire once each. `destroy()` is the guaranteed teardown and runs
   * directly when a new sheet replaces a live one, bypassing the animated close
   * entirely — so the decrement has to be idempotent and has to be skipped
   * outright when the sheet closed before the delay had even elapsed. The count
   * in `statusBar` is shared across sheets and a single unbalanced call leaves
   * the strip dark for the life of the app.
   *
   * **None of the above is observable on the installed iOS PWA**, which is the
   * only place the artefact it was written for was ever seen. `theme-color` does
   * not paint anything under `black-translucent` — tested by shipping a red one
   * and looking — so this timing is answering a question about a band that is
   * not there. See the note at the top of lib/statusBar.js.
   *
   * Left in place rather than deleted: the tag is still live on every browser
   * that paints chrome from it, and 130ms is the right moment to publish for
   * those. What it is NOT is a fix for the gradient across the top of Drew's
   * phone, and it was standing in the way of looking for the real one.
   */
  const SCRIM_TINT_DELAY = 130
  let scrimTimer = null
  let scrimHeld = false
  const holdScrim = () => {
    // Under reduce there is no fade to meet in the middle: the scrim is opaque
    // on the first frame, so waiting would show a bright strip over a dark page.
    if (reduceMotion()) {
      scrimHeld = true
      setScrimmed(true)
      return
    }
    scrimTimer = setTimeout(() => {
      scrimTimer = null
      scrimHeld = true
      setScrimmed(true)
    }, SCRIM_TINT_DELAY)
  }
  const releaseScrim = () => {
    if (scrimTimer) {
      clearTimeout(scrimTimer)
      scrimTimer = null
    }
    if (!scrimHeld) return
    scrimHeld = false
    setScrimmed(false)
  }
  /** Distinguishes this sheet's history entries from a previous sheet's. */
  const id = Math.random().toString(36).slice(2)

  const titleEl = h('h2', {
    class: 'flex-1 truncate text-title font-semibold',
  })
  const backBtn = h(
    'button',
    { class: 'icon-btn', 'aria-label': 'Back', onclick: () => history.back() },
    icon('chevronLeft', { size: 20, stroke: 2 })
  )
  const closeBtn = h(
    'button',
    { class: 'icon-btn', 'aria-label': 'Close', onclick: () => closeAll() },
    icon('close', { size: 20, stroke: 2 })
  )

  /**
   * One optional control, in front of the close button.
   *
   * This is deliberately a SLOT and not a return of the old `header` option: a
   * panel hands over one `.icon-btn` and the frame decides where it sits, where
   * the old option handed the panel the whole row. The distinction is what kept
   * the back chevron, the title and the close where they are on every sheet.
   *
   * It swaps in `syncHeader` with the title, because it belongs to the panel on
   * top rather than to the sheet — push a second panel and the root's action has
   * to leave with the root's title.
   *
   * The amount sheet is the caller: its favourite star used to sit in the body,
   * on the row under the title, where it read as an orphaned control rather than
   * as part of the frame. Beside the close it is unmistakably chrome, and the two
   * match — both `.icon-btn`, both `size: 20, stroke: 2`.
   *
   * **A real box rather than `display: contents`, now that the header floats.**
   * The band behind the header is absolutely positioned, so every element that
   * has to draw on top of it must be positioned too — and `position` does
   * nothing to a box that has no box. `contents` handed the button straight to
   * the header's flex line and left it static, which put the one optional
   * control in the frame UNDER the veil. A flex item holding a single 44px
   * button lays out identically on that same line, and `empty:hidden` keeps the
   * `gap` from opening for a slot with nothing in it.
   */
  const actionSlot = h('div', { class: 'flex items-center empty:hidden' })

  /**
   * The band behind the header, sized to the header and one rise below it.
   *
   * The mirror of `footerFade`, and the header floats for the same reason the
   * footer does: a scroller that ENDS at a piece of chrome cuts its first row
   * through the middle with a hard horizontal line, and no gradient over the
   * chrome can soften an edge that has bare surface below it. The scroller runs
   * up behind the header instead and reserves this band's height, so the first
   * row's resting line and the band's bottom edge are the same edge — at rest
   * it covers nothing, exactly as the footer's does.
   *
   * Progressive blur here where the footer takes a plain gradient. `.sheet-fade`
   * reaches full sheet colour at the button's top edge and has nothing left to
   * see into; this one has a whole list running under a title that carries no
   * surface of its own. The ramp and the argument are `SHEET_HEAD_RAMP` in
   * lib/fade.js; the geometry is `.sheet-head-fade` in styles.css.
   *
   * A permanent child, unlike the footer's: every sheet has a header, so there
   * is no empty case to hide.
   */
  const headFade = h(
    'div',
    { class: 'sheet-head-fade', 'aria-hidden': 'true' },
    fadeLayers(SHEET_HEAD_RAMP, 'to bottom'),
    h('span', { class: 'fade-veil' })
  )

  /**
   * `absolute`, over the scroller rather than above it — see `headFade`. The
   * gutters are unchanged: this is the same row in the same place, with the
   * content it used to sit on top of now passing behind it.
   */
  const header = h(
    'header',
    {
      class:
        'sheet-head absolute inset-x-0 top-0 flex items-center gap-[10px] px-[var(--sheet-gutter)] pb-[var(--sheet-gutter)] pt-[var(--sheet-gutter)]',
    },
    headFade,
    backBtn,
    titleEl,
    actionSlot,
    closeBtn
  )
  /**
   * The body owns every edge inset a panel gets: one `--sheet-gutter` on all
   * four sides, the same gutter the sheet's header and footer hold. Panels used
   * to add a further 10 of their own, which put their last element at 30 from
   * the bottom while sitting at 20 from the sides — and 30 from a footer button
   * that already has its own 20. Panels lay out their content; the chrome
   * decides where the content stops.
   *
   * That sentence used to be a claim about six literals agreeing. It is now a
   * token, declared on `.sheet-panel` — see the note there for why it is not
   * `--nav-inset`, which is also 20 and is a different argument.
   */
  /**
   * `isolate` matters now that the footer floats over this.
   *
   * Anything positioned inside a panel is free to set its own `z-index` — the
   * segmented control's segments carry `z-index: 1` so the travelling pill sits
   * under its labels — and while the footer was a flex sibling BELOW the
   * scroller that never mattered. Overlapping it, those inner stacks were
   * climbing straight over the footer: a disabled `Add` button with `Afternoon`
   * printed across it.
   *
   * Isolating the scroller contains every one of them, so no panel can reach the
   * chrome no matter what it does internally. Raising the footer's own z-index
   * would have fixed this instance and left the next one to be found by eye.
   */
  const body = h('div', {
    /**
     * `overflow-x-clip` is load-bearing, not tidying.
     *
     * A panel arriving with `panel-in-fwd` is translated 10px sideways, and a
     * translated child in an `overflow-y: auto` box grows a horizontal scroll
     * range — which on iOS is a sheet you can drag off its own edge for the
     * length of the animation. `.step-body` hit exactly this one flow over and
     * documents it at length, including that `clip` computes to `hidden` here
     * because one axis cannot clip while the other scrolls.
     */
    class:
      'sheet-body isolate min-h-0 flex-1 overflow-y-auto overflow-x-clip overscroll-contain px-[var(--sheet-gutter)]',
  })

  /**
   * The footer FLOATS over the scroller; it is not a slab below it.
   *
   * This is the whole difference between the sheet's bottom edge and the tab
   * bar's, and it took three attempts at a gradient to notice that the gradient
   * was never the problem. The tab bar works because the page scrolls UNDER it —
   * `.screen` reserves the bar's height as bottom padding, so a card runs on
   * behind the bar rather than stopping at it. The footer was a flex sibling,
   * which meant the scroller ENDED at its top edge: the card stopped dead there,
   * and below it was bare canvas. No band above a hard edge like that can look
   * like content receding, because there is no content down there to recede.
   *
   * So the footer is taken out of flow and the scroller is padded by its height
   * instead.
   *
   * The gradient that rode along with that fix was the tab bar's, scaled, and
   * it has since been cut down to the footer's own box — it reached 51px above
   * it and dimmed the last field at rest. `.sheet-fade` in styles.css carries
   * the measurement and the sizing rule. The reservation below is what the band
   * is now sized against.
   */
  const footerEl = h('div', {
    // One gutter on the top too, not the half-gutter. The body reserves this
    // whole box as its bottom padding, so the footer's own top inset IS the gap
    // between the last of the content and the button — and one gutter is what
    // that gap is everywhere else.
    //
    // The bottom is that same gutter, flat, with no safe-area inset added: the
    // sheet's bottom edge IS the screen's, so this is the tab bar's situation
    // exactly and it takes the tab bar's answer. `--nav-inset` makes the whole
    // argument — the 34pt inset is sized for content running edge to edge, and
    // adding it under a floating pill lifts it visibly high. The pill only has
    // to clear the home indicator, about 13pt. Adding it here would also put
    // this pill and the tab bar's at two different heights while both are on
    // screen a tap apart, which is the tell. Footerless sheets still get the
    // full inset, in the body's own padding below — different case, content
    // running to the edge rather than a control floating off it.
    class:
      'sheet-footer absolute inset-x-0 bottom-0 px-[var(--sheet-gutter)] pb-[var(--sheet-gutter)] pt-[var(--sheet-gutter)] empty:hidden',
  })

  /**
   * The band behind the button. One element and no children — the geometry and
   * the ramp are entirely `.sheet-fade`'s in styles.css, which is where the
   * argument for both is written.
   *
   * Added and removed WITH the footer's content in `syncHeader`, so
   * `empty:hidden` still works. A permanent child would make every footerless
   * sheet render an empty slab.
   *
   * **No `data-active` flag, unlike the tab bar's.** That flag exists to stop a
   * band washing a panel that never scrolls, and it needed a ResizeObserver to
   * answer "does this overflow" on content that arrives late. It buys nothing
   * here: the band is the footer's box, so on a short panel it lies over the
   * sheet's own ground and paints `--color-sheet` onto `--color-sheet`. There is
   * nothing to hide, so there is nothing to switch off.
   */
  const footerFade = h('div', { class: 'sheet-fade', 'aria-hidden': 'true' })

  const panel = h(
    'div',
    {
      /**
       * Capped so a tall sheet stops clear of the notch or Dynamic Island
       * rather than running its header underneath them.
       *
       * `border-t` is the one stroke left after controls and containers went to
       * fills, and it is kept deliberately. Measured against the scrim, the
       * sheet's own edge is 2.41:1 in light — which carries it alone — but
       * 1.05:1 in dark, where the top edge would simply disappear. This is not
       * a card on a page; it is a surface meeting a dimmed one, and in dark mode
       * the hairline is the only thing drawing it.
       */
      // `safe-b` moved to the footer, which is the bottom-most element now that
      // it floats. The body carries the same inset in its own padding.
      //
      // `bottom-0` is safe HERE, unlike everywhere else in the app: the scrim is
      // `.screen-cover`, so this is absolute inside a box whose own height is
      // already the screen's. It is the FIXED bottom edge that was ambiguous.
      // No `bottom-0` here: `.sheet-panel` owns its bottom edge in CSS, so
      // the keyboard inset below can move it. See `syncKeyboard`.
      class: 'sheet-panel absolute inset-x-0 flex flex-col border-t border-outline',
      /**
       * The `max-height` that used to be written here as an inline style now
       * lives on `.sheet-panel`, since it no longer varies per sheet. Its two
       * standing arguments moved with it: `100%` of the scrim rather than a
       * viewport unit — `100svh` measured 812 on Drew's phone against a real
       * 874, and then had the 62px top inset taken out of a height that had
       * already lost it, capping every sheet in the app 62px short — and the
       * scrim being `.screen-cover` is what makes the percentage trustworthy.
       */
      role: 'dialog',
      'aria-modal': 'true',
      /**
       * Focusable so the dialog itself can take focus on open. Without a target
       * of its own, focus stays on whatever was behind the scrim, and the trap
       * below has nothing to trap.
       */
      tabindex: '-1',
      onclick: (e) => e.stopPropagation(),
    },
    header,
    body,
    footerEl
  )

  /**
   * The dimming is a child of the scrim rather than the scrim itself, and the
   * panel is its sibling.
   *
   * **`opacity` applies to a whole subtree.** There is no way to fade a box and
   * hold a child of it solid — so for as long as the scrim carried both the wash
   * and the panel, `scrim-in` faded the panel along with it. Measured on the way
   * up: the sheet was drawn at 11% at 20ms, 52% at 96ms and 82% at 171ms. Half
   * see-through for the whole entry, with the page it was covering legible
   * through it.
   *
   * The panel's own opacity was 1 throughout, which is why the note on
   * `sheet-in` in styles.css claims the sheet does not fade. That claim is true
   * of the animation and was wrong about the screen, and it is the reason this
   * survived: nothing in either file mentioned the parent.
   *
   * The same inheritance ran two more moments. `swipeToDismiss` writes the wash
   * down to 0.35 as you pull, so the sheet went 65% transparent under the finger
   * holding it; and `scrim-out` took it with it on the way out.
   *
   * Source order is what stacks these two: both are absolutely positioned in the
   * same stacking context, so the panel draws over the dim by coming second. The
   * scrim keeps the click-to-close, which the dim's clicks bubble up to.
   */
  const dim = h('div', { class: 'sheet-dim', 'aria-hidden': 'true' })

  const scrim = h(
    'div',
    {
      class: 'sheet-scrim screen-cover z-[60]',
      onclick: () => closeAll(),
    },
    dim,
    panel
  )

  function syncHeader() {
    const top = panels[panels.length - 1]
    titleEl.textContent = top?.title ?? ''
    backBtn.style.display = panels.length > 1 ? '' : 'none'
    actionSlot.replaceChildren(...(top?.actionNode ? [top.actionNode] : []))
    const hasFooter = !!top?.footerNode
    footerEl.replaceChildren(...(hasFooter ? [footerFade, top.footerNode] : []))
    /**
     * Reserve the floating footer's height at the foot of the scroller, so the
     * last row can be scrolled clear of the button rather than parking under it
     * permanently.
     *
     * **The BAND is measured, not the footer.** The footer's box would be the
     * obvious thing to reserve, and it is the wrong one by exactly the height
     * of the fade's rise: `.sheet-fade` stands above the footer so its ramp has
     * room to be soft, and a field parked at the footer's top edge would sit
     * under the top of that ramp. That is the bug this whole area started with,
     * at a third of the size.
     *
     * Reserving the band instead makes the two edges the same edge by
     * construction. The band is bottom-anchored to the footer and contains it,
     * so this is still "button height + button bottom margin + one gap" with
     * the fade's rise added, and it is still right for the weigh-in editor,
     * whose footer is two stacked buttons rather than one. A literal would
     * under-pad that one and put its last row under the lower button.
     *
     * Measured rather than assumed for that reason, and because the sum would
     * have to be kept in step with `.btn-primary`'s min-height and the fade's
     * rise, in two other files.
     *
     * **Synchronously, and that matters now.** This used to run in a
     * `requestAnimationFrame`, on the reasoning that the height is only knowable
     * once the new content has laid out — which is true, and which reading
     * `offsetHeight` achieves on its own by forcing the layout rather than
     * waiting for one. Deferring it put the padding change a frame INTO the
     * panel resize, so the contents shifted vertically by the difference between
     * the old footer and the new one while the sheet was already moving. One
     * forced layout per panel change is the cost, and it was being paid a frame
     * later anyway.
     */
    body.style.paddingBottom = hasFooter
      ? `${footerFade.offsetHeight}px`
      : 'calc(var(--sheet-gutter) + env(safe-area-inset-bottom, 0px))'
    /**
     * The same reservation at the other end, and the same reasoning: the BAND
     * is measured, not the header.
     *
     * The header's own box would leave the first row parked under the rise —
     * the part of the band that stands below the header so its ramp has room to
     * be soft — which is a row dimmed and blurred at rest with nowhere further
     * to go. That is the bug `.sheet-fade` was cut down to fix, arrived at from
     * the top this time. Reserving the band makes the row's resting line and
     * the band's bottom edge the same edge by construction.
     *
     * Measured rather than written down for the same reason as the footer: the
     * sum is `.icon-btn`'s height plus two gutters plus the fade's rise, and
     * those three live in two other files.
     *
     * Unconditional, because there is no headerless sheet.
     *
     * **It carries the sticky rows too, and for free.** `totalsLine` in
     * sheets/log.js and the photo slot in lib/labelPhoto.js both pin themselves
     * with `sticky top-0` inside this scroller, and the obvious reading is that
     * they now park under the veil — the scrollport's top edge is up behind the
     * header. They do not: a sticky offset is resolved against the scroll
     * container's CONTENT box, so this padding moves the parking line down with
     * it and `top: 0` lands them exactly on the band's bottom edge. Verified on
     * both, at rest and pinned. An explicit offset would double the padding and
     * park them a whole band too low, which is what the first attempt did.
     */
    body.style.paddingTop = `${headFade.offsetHeight}px`
  }

  /**
   * `dir` says whether this is a navigation at all. It no longer says which
   * way: the panels used to slide in from the side they came from, and that
   * movement was dropped — see `panel-in` in styles.css. The argument is kept
   * because it is what distinguishes a navigation from the two cases that must
   * NOT animate: the ROOT panel, where the sheet itself is arriving and a
   * second movement inside it would be two arrivals for one event, and
   * `ctx.refresh`, which repaints a panel in place and has not gone anywhere.
   *
   * The class is stripped before it is re-added because panels keep their DOM
   * when you push past them — so a panel being come BACK to already carries it,
   * and re-adding an identical class to a node the browser has already animated
   * does nothing. Setting it while the node is detached and animating on
   * insertion is what makes it replay.
   *
   * **The header does not animate.** The title briefly faded with the body, on
   * the reasoning that it is the other half of the same change — and that is the
   * wrong model. The header is the sheet's chrome, not its content: the back
   * chevron, the title and the close button are a fixed frame that the content
   * moves through. Apple's sheets and nav bars hold exactly this line, and
   * fading the title made the frame look like part of the payload. The title
   * swaps outright; only the body crosses over.
   */
  function showTop(dir = null) {
    const top = panels[panels.length - 1]
    const arrival = dir ? 'panel-in' : null
    // Measured before the swap, while the outgoing panel is still setting the
    // sheet's height. See `resizeTo`.
    const fromHeight = arrival && panel.isConnected ? panel.offsetHeight : null
    clear(body)
    if (top?.node) {
      // All three, because a panel kept in the DOM while you pushed past it
      // still carries whichever one it arrived with.
      top.node.classList.remove('panel-in', 'panel-in-fwd', 'panel-in-back')
      if (arrival) top.node.classList.add(arrival)
      body.appendChild(top.node)
    }
    syncHeader()
    body.scrollTop = top?.scrollTop ?? 0
    if (fromHeight != null) resizeTo(fromHeight, top?.node, dir)
  }

  /**
   * Carry the sheet's own height across a panel change.
   *
   * **This is the half that was missing, and it was the whole complaint.** A
   * panel sets the sheet's height, so pushing from a tall panel to a short one
   * — the add sheet's search and favourites, to the Custom form — resized the
   * whole surface on one frame. Sliding the CONTENTS in over 240ms while the
   * container they sit in snapped to a new size read as the sheet lurching,
   * and no amount of tuning the slide could fix a container that was not
   * moving with it.
   *
   * A first/last measurement rather than a CSS transition, because the height
   * being animated from and to is `auto` at both ends — the panel is sized by
   * whatever is in it, and `auto` does not interpolate. So: read the old height,
   * let the new content lay out to get the new one, pin the old back, and
   * release it on the next frame.
   *
   * The explicit height is removed when it lands so the panel goes back to being
   * content-sized. A timer rather than `transitionend`, because `swipeToDismiss`
   * writes `panel.style.transition` for its transform and would swallow the
   * event — and if a drag DOES start mid-resize it simply wins, which is
   * correct: the finger outranks a transition it interrupted.
   */
  let resizeTimer = null
  function resizeTo(fromHeight, node = null, dir = null) {
    panel.style.transition = 'none'
    panel.style.height = ''
    // Measured with the new panel's padding already applied — `syncHeader` is
    // synchronous for exactly this reason. A measurement taken before it would
    // animate to a height the sheet then corrects a frame later.
    const toHeight = panel.offsetHeight
    if (toHeight === fromHeight) {
      panel.style.transition = ''
      /**
       * No resize, so the CONTENT carries the change instead.
       *
       * This branch is not the rare one it looks like. The sheet is capped at
       * `calc(100% - 64px)`, so any two panels that both overflow the cap are
       * the same height as each other — which on a phone is the add sheet's
       * root and every form you can push from it. The height comes back equal,
       * this returns early, and the arrival was left as a bare opacity ramp
       * under a layout that had already changed: the panel appearing rather
       * than arriving, which is what it was reported as.
       *
       * Upgrading the class here rather than choosing it in `showTop` is what
       * keeps the rule honest — the answer depends on a height that cannot be
       * measured until the new panel is laid out, and this is the only place
       * that knows it. Nothing has painted yet: `showTop` and this both run
       * inside the click, so swapping the class now starts the directional
       * animation cleanly rather than restarting a visible one.
       */
      if (node && dir) {
        node.classList.remove('panel-in')
        node.classList.add(dir === 'pop' ? 'panel-in-back' : 'panel-in-fwd')
      }
      return
    }
    panel.style.height = `${fromHeight}px`
    void panel.offsetHeight
    panel.style.transition = `height ${PANEL_MS}ms ${PANEL_EASE}`
    panel.style.height = `${toHeight}px`
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      panel.style.height = ''
      panel.style.transition = ''
    }, PANEL_MS + 20)
  }

  function makeCtx(entry) {
    return {
      close: (value) => closeAll(value),
      pop: () => history.back(),
      push: (spec) => pushPanel(spec),
      /**
       * Runs when this panel is popped or the sheet closes. Anything holding a
       * hardware resource — the camera, an in-flight fetch — registers here.
       */
      onDispose: (fn) => entry.disposers.push(fn),
      setTitle: (t) => {
        entry.title = t
        syncHeader()
      },
      setFooter: (node) => {
        entry.footerNode = node
        syncHeader()
      },
      /** One `.icon-btn` in the header, in front of the close. See `actionSlot`. */
      setAction: (node) => {
        entry.actionNode = node
        syncHeader()
      },
      /** Re-run this panel's render in place, e.g. after a data change. */
      refresh: () => {
        runDisposers(entry)
        const next = entry.render(makeCtx(entry))
        entry.node = next
        if (panels[panels.length - 1] === entry) showTop()
      },
      body,
    }
  }

  function pushPanel(spec) {
    const current = panels[panels.length - 1]
    if (current) current.scrollTop = body.scrollTop

    const entry = {
      title: spec.title,
      render: spec.render,
      footerNode: spec.footer ?? null,
      actionNode: spec.action ?? null,
      disposers: [],
    }
    entry.node = spec.render(makeCtx(entry))
    panels.push(entry)

    history.pushState({ [STATE]: { id, depth: panels.length } }, '')
    // The root panel arrives with the sheet, so it does not slide as well.
    showTop(panels.length > 1 ? 'push' : null)
    return entry
  }

  function runDisposers(entry) {
    for (const fn of entry.disposers.splice(0)) {
      try {
        fn()
      } catch (err) {
        console.warn('Sheet panel cleanup failed', err)
      }
    }
  }

  function destroy() {
    /* Idempotent: opening a sheet over a live one destroys it early, and that
       sheet's own teardown timer still fires afterwards. */
    if (destroyed) return
    destroyed = true
    // Idempotent, and the guaranteed one: the animated close has usually
    // released this already, but a sheet destroyed outright never went through
    // it. See `releaseScrim`.
    releaseScrim()
    for (const entry of panels) runDisposers(entry)
    window.removeEventListener('popstate', onPop)
    document.removeEventListener('keydown', onKey)
    if (vv) {
      vv.removeEventListener('resize', syncKeyboard)
      vv.removeEventListener('scroll', syncKeyboard)
    }
    /**
     * Whether the focus we are about to strip belonged to us.
     *
     * Read BEFORE the scrim leaves the document, since `contains` stops being
     * true the moment it does. If focus had already moved on — a replacing sheet
     * has taken it, or the user clicked into the page — it is not ours to put
     * back, and yanking it to the opener would be the sheet interrupting
     * whatever came after it.
     */
    const heldFocus = scrim.contains(document.activeElement)
    scrim.remove()
    lockScroll(false)
    if (heldFocus && opener?.isConnected && typeof opener.focus === 'function') {
      opener.focus({ preventScroll: true })
    }
    if (active?.scrim === scrim) active = null
  }

  function teardown(value) {
    if (closing) return
    closing = true
    scrim.dataset.closing = 'true'
    panel.dataset.closing = 'true'
    // At the start of the exit, not in `destroy()` at the end of it, so the
    // strip clears while the scrim is clearing rather than a frame after it has
    // gone. See `releaseScrim`.
    releaseScrim()
    setTimeout(destroy, 200)
    resolveResult(value)
  }

  /** Close every panel at once, unwinding the history entries we pushed. */
  function closeAll(value) {
    if (closing) return
    const depth = panels.length
    pendingValue = value
    history.go(-depth)
  }

  let pendingValue

  /**
   * `STATE` alone is not enough to tell one sheet's history entries from
   * another's, and that was leaving the page scroll-locked.
   *
   * Every sheet stamped the same key, so an entry left behind by an EARLIER
   * sheet still reads as `{'mt-sheet': 1}` — and when a later sheet went back
   * onto it, `depth >= panels.length` said "not mine" and returned. `teardown`
   * never ran, `destroy` never ran, and `lockScroll(false)` never ran: the sheet
   * stayed in the DOM and `<body>` stayed at `position: fixed; overflow: hidden`
   * for the rest of the session. The page stopped scrolling, and on iOS a
   * pinned layout viewport is what makes fixed chrome — the tab bar, the sheet's
   * own bottom edge — drift away from where it should be.
   *
   * The id makes each sheet's entries its own, so an entry that is not this
   * sheet's is now correctly read as "we have left the sheet entirely" rather
   * than as a depth to compare against.
   */
  function onPop(event) {
    const state = event.state?.[STATE]
    const mine = state && state.id === id
    const depth = mine ? state.depth : 0
    if (mine && depth >= panels.length) return
    if (depth <= 0) {
      teardown(pendingValue)
      return
    }
    // Popped back to a panel we still have — drop everything above it.
    for (const entry of panels.splice(depth)) runDisposers(entry)
    showTop('pop')
  }

  const FOCUSABLE =
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), ' +
    'textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

  /**
   * Only what is actually reachable. A panel that has been pushed past keeps its
   * DOM so its scroll position and form state survive being come back to, and
   * the hidden `input[type=date]` behind a date label is deliberately not a tab
   * stop — neither should answer the Tab key.
   */
  function focusables() {
    return [...panel.querySelectorAll(FOCUSABLE)].filter(
      (el) =>
        /**
         * `tabIndex < 0` is checked on the ELEMENT rather than left to the
         * selector, which cannot catch it. The date label's picker is an
         * `input` carrying `tabindex="-1"`, so it matches
         * `input:not(:disabled)` on its own and slips past the
         * `[tabindex]:not([tabindex="-1"])` clause entirely. It is a full-size
         * transparent overlay, so it passes the visibility test too — and being
         * in this list at the wrong end would hand Tab to something the browser
         * itself will not focus, and the cycle would stall there.
         */
        el.tabIndex >= 0 &&
        (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement)
    )
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      closeAll()
      return
    }
    if (e.key !== 'Tab') return

    /**
     * The trap. A modal that can be tabbed out of is a modal in appearance
     * only — behind it sits a whole screen of live controls that are covered,
     * inert to the eye, and perfectly reachable by keyboard.
     */
    const list = focusables()
    if (!list.length) {
      e.preventDefault()
      panel.focus({ preventScroll: true })
      return
    }
    const first = list[0]
    const last = list[list.length - 1]
    const current = document.activeElement

    if (!panel.contains(current)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus({ preventScroll: true })
    } else if (e.shiftKey && current === first) {
      e.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!e.shiftKey && current === last) {
      e.preventDefault()
      first.focus({ preventScroll: true })
    }
  }

  /**
   * Pull the sheet down to close it.
   *
   * `closeAll()` rather than `teardown()` on purpose: the sheet's exit is
   * history-driven, and every panel it pushed has an entry to unwind. Tearing
   * down directly would leave those behind, so the next hardware back would
   * step through a sheet that is no longer on screen.
   */
  // `scrim` carries the drag's state flags, `dim` is what its opacity writes
  // land on. Two arguments rather than one because they used to be one element.
  swipeToDismiss(panel, { scroller: body, scrim, dim, onDismiss: () => closeAll() })

  /**
   * The software keyboard, and where the sheet's bottom edge goes when it
   * opens.
   *
   * On a phone the keyboard does not resize the page. The layout viewport —
   * `window.innerHeight`, the box every `fixed` element is placed against —
   * stays the full screen, and the keyboard covers the bottom of it. A sheet
   * anchored to that edge keeps its footer exactly where the keyboard now is:
   * the primary button is under the keys, and the field being typed into may
   * be as well. `visualViewport` is the box that DOES shrink, and the
   * difference between the two is the keyboard's height.
   *
   * So the sheet's bottom edge is lifted by that difference, and its cap is
   * reduced by the same amount so it still fits above the keys. The body
   * scrolls inside whatever is left. On a desktop the two viewports agree and
   * the inset is zero, so nothing here has any effect.
   *
   * `offsetTop` is in the sum because iOS may scroll the visual viewport up to
   * bring a focused field into view even with the page pinned; the space below
   * the visual viewport is what the keyboard is covering, wherever the visual
   * viewport currently sits.
   *
   * Written as a CSS variable rather than a style, so the stylesheet's rule
   * for `.sheet-panel` stays the one place its geometry is declared, and the
   * height transition is switched off for the change: a keyboard arriving is
   * not a panel change and must not be animated like one.
   *
   * **Not verified on a real phone.** There is no simulator on the machine
   * this was written on, and a desktop browser has no keyboard to open. The
   * arithmetic is the standard one; the reading that confirms it belongs in
   * lib/viewportProbe.js when the phone next takes one with a sheet and the
   * keyboard both up.
   */
  const vv = window.visualViewport
  let keyboardInset = 0
  function syncKeyboard() {
    if (!vv || destroyed) return
    const inset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
    if (inset === keyboardInset) return
    keyboardInset = inset
    panel.style.transition = 'none'
    panel.style.setProperty('--kb-inset', `${inset}px`)
    void panel.offsetHeight
    panel.style.transition = ''
  }
  if (vv) {
    vv.addEventListener('resize', syncKeyboard)
    vv.addEventListener('scroll', syncKeyboard)
  }

  window.addEventListener('popstate', onPop)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(scrim)
  holdScrim()
  lockScroll(true)
  syncKeyboard()

  active = { scrim, destroy, closeAll }
  pushPanel({ title, render, footer, action })

  /**
   * A reading of the sheet, once it has finished arriving.
   *
   * The body's ResizeObserver in main.js fires when `lockScroll` pins the page,
   * which is a frame before this panel has slid anywhere — measuring `.sheet-panel`
   * then reports its opening transform rather than where it comes to rest. The
   * 260ms `sheet-in` plus a margin is what makes the number mean something.
   *
   * See `captureViewportState`: a sheet is one of the two states the readout
   * cannot be navigated to, because looking at the readout closes it.
   */
  setTimeout(captureViewportState, 400)

  /**
   * Focus the dialog itself rather than the first control in it.
   *
   * The first control is whatever happens to be top-left — a close button, a
   * back chevron, a day step — and starting there both announces the wrong
   * thing and puts the very first Enter on a control nobody was reaching for.
   * The panel carries `role="dialog"`, so landing on it is what gets the sheet
   * announced, and one Tab from there reaches the same controls in order.
   *
   * `preventScroll` because the panel is inside a fixed, scroll-locked scrim on
   * iOS, where focusing a tall element is enough to shift the layout viewport
   * out from under everything.
   */
  panel.focus({ preventScroll: true })

  return result
}

/** Used by the router: navigating away should not leave a sheet floating. */
export function closeAnySheet() {
  active?.closeAll()
}
