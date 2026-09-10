import { h, swipeAway, paintedTranslate } from './dom.js'
import { icon } from './icons.js'

/**
 * Toasts, including the undo path after a delete.
 *
 * Note what is missing: colour. Red belongs to carbs, so a destructive
 * confirmation is ink and grey like everything else. Spec 7.
 */

let host = null
let deck = null

function getDeck() {
  if (!deck) {
    // The bottom inset moved to `.toast-host` in styles.css, because it is not
    // one number: a toast clears the tab bar when the tab bar is there, and
    // sits on the bottom edge when a sheet has covered it. See the rule.
    //
    // pointer-events-none is load-bearing. This host spans the full width and
    // sits above the tab bar, and its bottom padding overlaps the add button;
    // without it the first toast permanently swallows every tap on the tab
    // bar. Individual toasts opt back in.
    //
    // The deck is the one grid cell every toast shares — see THE DECK below.
    deck = h('div', { class: 'toast-deck w-full' })
    host = h(
      'div',
      {
        class: 'toast-host pointer-events-none screen-floor z-[80] items-center px-[20px]',
        role: 'status',
        'aria-live': 'polite',
      },
      deck
    )
    document.body.appendChild(host)
  }
  return deck
}

/**
 * THE DECK: toasts stack in depth, not in a column.
 *
 * They used to sit in a flex column, oldest on top, newest under it, and the
 * column grew upward from the tab bar by a full toast and a gap for every one on
 * screen. That is why the cap was two — three of them reached halfway up a
 * phone and buried Today's Quick add rail.
 *
 * Now every toast occupies the same grid cell, bottoms aligned, and the newest
 * is in front. The ones behind it are lifted a few pixels and drawn a little
 * narrower, so what shows of each is a strip along its top edge — enough to say
 * there is a queue, and nothing more. Three toasts cost one toast plus two
 * strips instead of three toasts and two gaps.
 *
 * Depth is a number on the element, `--depth`, and the stylesheet turns it into
 * the lift and the scale. `layout()` is the only writer; it runs after every
 * arrival and every departure, so a card behind comes forward on the same
 * transition whether the front left by a tap, a swipe, or its own timer.
 *
 * **Only the front is live.** A card behind is covered except for its strip,
 * and a swipe that started on the strip would drag a toast down behind the one
 * in front — a gesture with no legible result. Its Undo is unreachable until it
 * comes forward, which it does the moment the front is swiped away. That is the
 * cost of the deck, taken deliberately: a burst of deletes used to show every
 * Undo at once, and it also used to cover the screen.
 */
const MAX_VISIBLE = 3

/** Live toasts, oldest first. Each is `{ el, dismiss }`. */
const open = []

function layout() {
  const n = open.length
  open.forEach(({ el }, i) => {
    const depth = n - 1 - i
    el.style.setProperty('--depth', String(depth))
    el.dataset.depth = String(depth)
  })
}

/**
 * Layer order is the order of arrival, and it never changes.
 *
 * Written once, from a counter, rather than recomputed by `layout()`. A card on
 * its way out keeps the layer it had, so the front leaving stays under a toast
 * that arrived a moment later and over the one it had been covering. Recomputed
 * from position, a leaving front sat above the newcomer for its last 160ms and
 * its edge crossed the new card's face.
 */
let layer = 0

/**
 * Escape clears everything.
 *
 * The tap is the real dismissal and works with a thumb; this is the same
 * affordance for a keyboard, which otherwise has no way past a toast at all.
 * Registered once, on first use, and never removed — the app is a single page
 * and the listener is idle whenever the deck is empty.
 */
let escBound = false
function bindEscape() {
  if (escBound) return
  escBound = true
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open.length) return
    for (const { dismiss } of [...open]) dismiss()
  })
}

/**
 * `actionDismisses` says the labelled button IS the way out.
 *
 * An Undo toast has two different jobs on it — take the recovery, or decline it
 * — so it draws two controls. A toast that is only telling you something has
 * one job, and "Got it" is it. Drawing the bare circle beside it put two
 * buttons on the same toast that did the same thing, with the toast's only
 * emphasised control spending its weight on a choice that was not there.
 *
 * One flag rather than two options, because both of the things it changes
 * follow from the same fact: the button gets the close glyph instead of the
 * undo arrow, and the circle is not drawn at all.
 */
/**
 * ONE ROW: the message, and the action if there is one.
 *
 * What this replaces was two rows and a circle — a message row, then a control
 * row holding a full-width Undo beside a 44px X. It measured **115px** with an
 * action and **84px** without, on a box that exists for five seconds over the
 * bottom of whatever you were just looking at.
 *
 * The two rows were bought for a specific reason and the reason does not survive
 * being measured. Row one was given to the message alone so a name like
 * `Grilled Chicken Breast, 180g` would have the full 295px and not wrap.
 *
 * That name does wrap here, and the wrap costs **6px**: the line box goes 21 to
 * 42, the action holds the row at 36, so the taller of the two wins and the
 * toast goes 60 to 66. The old shape spent ~50px making sure it never happened.
 * Paying fifty to avoid six is the whole of the change.
 *
 * The X is gone with it. It existed so the toast could be dismissed early, and
 * it was the app's only control drawn at 44px purely so it would not look
 * smaller than itself elsewhere — the note that used to be here admitted it
 * cost 17px on the commonest toast in the app and took that deliberately. Early
 * dismissal is now the swipe, which costs no pixels at all.
 *
 * **The one thing the X was genuinely protecting is still protected.** A toast
 * sits where a thumb rests, and the thing it covers is the thing you just
 * changed, so a stray tap is likely — and on an Undo toast a stray tap that
 * dismissed would destroy the recovery you were just offered. There is still no
 * tap-to-dismiss surface. The only tappable thing on a toast is its action, and
 * a swipe is a deliberate gesture that a resting thumb does not perform.
 *
 * The action is a 36px pill rather than a 44px full-width bar. It keeps its fill
 * so it still reads as a control, at a size proportional to a message that is
 * leaving on its own in five seconds — a full-width filled button is the shape
 * of a primary action, and Undo is an offer, not an instruction.
 *
 * Measured at 375pt: **60px with an action, 45px without, 66px when the message
 * wraps.** Against 115 and 84 before, and the old two-row shape was 115 whether
 * the message wrapped or not.
 */
export function toast(message, { action, onAction, actionDismisses = false, duration = 5000 } = {}) {
  /**
   * The action, and the only thing on a toast you can tap.
   *
   * `shrink-0` so the message yields to it rather than the other way round: the
   * label is two known words and the message is arbitrary, so the message is the
   * one that should wrap. `min-w-0` on the message is what allows that — without
   * it a long word refuses to go under its own content width and pushes the pill
   * off the end.
   */
  const actionBtn = action
    ? h(
        'button',
        {
          class:
            'toast-act flex h-[36px] shrink-0 items-center gap-[6px] rounded-full ' +
            'px-[16px] text-[13px] font-semibold',
          style: { background: 'color-mix(in srgb, currentColor 16%, transparent)' },
          onclick: () => {
            dismiss()
            onAction?.()
          },
        },
        // Leading for the undo arrow, which is a verb the label completes: the
        // glyph says what happens and the word says to what. Trailing for the X,
        // because an X is not a verb — it is the exit, and the exit goes last.
        ...(actionDismisses
          ? [action, icon('close', { size: 16, stroke: 2.25 })]
          : [icon('undo', { size: 16 }), action])
      )
    : null

  const el = h(
    'div',
    {
      class:
        'toast pointer-events-auto flex w-full max-w-[430px] items-center ' +
        'gap-[12px] rounded-[24px] bg-ink py-[12px] pl-[20px] text-canvas ' +
        // 12 behind the pill because the pill's own fill carries the edge; 20
        // when there is nothing there, so a message-only toast is padded evenly.
        (actionBtn ? 'pr-[12px]' : 'pr-[20px]'),
    },
    h('span', { class: 'min-w-0 flex-1 text-[14px] font-medium' }, message),
    actionBtn
  )

  let timer = null
  const dismiss = () => {
    clearTimeout(timer)
    const i = open.findIndex((o) => o.el === el)
    if (i === -1) return
    const wasFront = i === open.length - 1
    open.splice(i, 1)
    // Whatever is left takes its new place on the same frame this one starts to
    // leave, so a card coming forward and a card going out are one movement.
    layout()
    if (!el.isConnected) return
    /**
     * TWO EXITS, and which one runs is decided by where the toast was.
     *
     * **The front leaves the way it came.** It arrived up 12px, so it goes back
     * down 12 and fades, and the card behind it, if there is one, comes forward
     * on `layout()` above.
     *
     * Written inline rather than left to the stylesheet, because a swipe has
     * already put an inline transform and opacity on this element and inline
     * wins. A rule that said `translateY(12px)` would haul a toast the finger
     * had dragged to 60 back UP before fading it.
     *
     * So the exit is relative: wherever it is now, 12 further in the direction
     * it was already going. A tapped toast starts at 0 and drifts 12 — the
     * reverse of its arrival — and a swiped one carries on out.
     */
    if (wasFront) {
      const { y } = paintedTranslate(el)
      el.dataset.removing = 'front'
      el.style.transition =
        'opacity var(--dur-fast) ease-in, transform var(--dur-fast) ease-in'
      void el.offsetHeight
      el.style.transform = `translateY(${y + 12}px)`
      el.style.opacity = '0'
      setTimeout(() => el.remove(), 170)
      return
    }
    /**
     * **A card behind drops out from behind.** It is under the front card
     * already, so it sinks to the front card's own position, a little smaller,
     * and fades — the strip that was showing slides down under the front edge
     * and is gone. The front never moves, because nothing about the front has
     * changed. The rule is `.toast[data-removing='behind']`.
     */
    el.dataset.removing = 'behind'
    setTimeout(() => el.remove(), 170)
  }

  // Before appending, so the cap counts what will be on screen rather than one
  // frame of four. The OLDEST goes, not the newest: the newest is the one whose
  // consequence you are still looking for, and the oldest has had the longest
  // to be read and undone.
  while (open.length >= MAX_VISIBLE) open[0].dismiss()

  open.push({ el, dismiss })
  bindEscape()

  /**
   * THE ENTRANCE IS A TRANSITION, NOT AN ANIMATION.
   *
   * It used to be `toast-in`, a keyframe from 12px below. A keyframe owns the
   * transform for its 200ms, and the deck writes the transform too: a toast
   * bumped to depth 1 while its own entrance was still running finished rising
   * to 0, then snapped to its lifted, narrower place on the frame the keyframe
   * released it. Two taps on the Quick add tile inside a fifth of a second was
   * enough, and the stack sat uneven for a frame and jumped.
   *
   * So the arrival is written as a start state that the deck's own transition
   * carries to rest: 12 below and clear, appended, reflowed, then let go. A
   * second arrival mid-flight retargets that transition from wherever the card
   * is, which is what a keyframe cannot do. Same numbers, same curve, one owner.
   */
  el.style.zIndex = String(++layer)
  el.style.transform = 'translateY(12px)'
  el.style.opacity = '0'
  getDeck().appendChild(el)
  layout()
  void el.offsetHeight
  el.style.transform = ''
  el.style.opacity = ''
  timer = setTimeout(dismiss, duration)

  /**
   * The gesture that replaced the X.
   *
   * Wired here rather than beside `el`, because it needs `dismiss` — which needs
   * `el` — and the pause needs `timer`. All three exist by this line.
   *
   * The hold is the point of `onHold`/`onRelease`: a finger on the toast stops
   * the clock, and letting go without committing starts a full fresh five
   * seconds rather than resuming a partly spent one. Resuming would mean a toast
   * you deliberately grabbed could still vanish a few hundred milliseconds
   * later, which is the behaviour the pause exists to prevent.
   *
   * `transition: none` for the length of the hold, because the deck's own
   * transform transition — the one that carries a card forward — would
   * otherwise put 200ms of lag between the finger and the toast. The swipe
   * writes its own spring on release and clears it, which hands the stylesheet
   * transition back.
   */
  swipeAway(el, {
    onDismiss: dismiss,
    onHold: () => {
      clearTimeout(timer)
      el.style.transition = 'none'
    },
    onRelease: () => {
      timer = setTimeout(dismiss, duration)
    },
  })

  return dismiss
}

/**
 * Blocking confirm. Used for deletes and other one-way doors.
 * `destructive` changes the wording weight, not the colour.
 */
export function confirm(
  { title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', requireText = null } = {}
) {
  return new Promise((resolve) => {
    let input = null

    const close = (result) => {
      scrim.dataset.closing = 'true'
      setTimeout(() => scrim.remove(), 200)
      document.removeEventListener('keydown', onKey)
      resolve(result)
    }

    const onKey = (e) => {
      if (e.key === 'Escape') close(false)
    }

    const confirmBtn = h(
      'button',
      {
        class: 'btn-primary',
        disabled: !!requireText,
        onclick: () => close(true),
      },
      confirmLabel
    )

    /**
     * The wash is its own element, for the reason `.sheet-dim` in lib/sheet.js
     * gives: an opacity fade on the scrim would fade the box with it. It also
     * means the confirm's backdrop now arrives and leaves the way a sheet's
     * does — `scrim-in` and `scrim-out` are keyed on `.sheet-dim` — where
     * before it had no fade at all and popped in and out around a box that
     * animated. See `.confirm-dim` in styles.css.
     */
    const dim = h('div', { class: 'sheet-dim confirm-dim', 'aria-hidden': 'true' })

    const box = h(
      'div',
      {
        // `confirm-in`, because the box used to arrive at full size on frame
        // one while the scrim was still fading in behind it — the app's one
        // blocking dialog turning up ahead of its own backdrop. See the rule.
        // `relative` so it paints over the dim, which is absolute.
        class:
          'confirm-in relative w-full max-w-[380px] rounded-[24px] border border-outline bg-canvas p-[20px]',
        role: 'alertdialog',
        'aria-modal': 'true',
      },
      h('h2', { class: 'text-[20px] font-semibold' }, title),
      message && h('p', { class: 'mt-[10px] text-[14px] leading-snug text-muted' }, message),
      requireText &&
        h(
          'div',
          { class: 'mt-[20px]' },
          h('p', { class: 'mb-[10px] text-[14px] text-muted' }, `Type ${requireText} to confirm.`),
          h('input', {
            class: 'field text-[16px] font-semibold',
            autocapitalize: 'characters',
            autocomplete: 'off',
            ref: (el) => (input = el),
            oninput: () => {
              confirmBtn.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase()
            },
          })
        ),
      h(
        'div',
        { class: 'mt-[20px] flex flex-col gap-[10px]' },
        confirmBtn,
        h('button', { class: 'btn-secondary', onclick: () => close(false) }, cancelLabel)
      )
    )

    const scrim = h(
      'div',
      {
        class: 'sheet-scrim screen-cover z-[90] flex items-center justify-center px-[20px]',
        // Anywhere outside the box. That includes the dim, which sits between
        // the scrim and the box, so `e.target === scrim` stopped being true.
        onclick: (e) => {
          if (!box.contains(e.target)) close(false)
        },
      },
      dim,
      box
    )

    document.body.appendChild(scrim)
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => input?.focus())
  })
}

/**
 * A floating card over the dimmed page, for a task with one field in it.
 *
 * The confirm dialog's surface, opened up: same scrim, same dim, same box on
 * the same entrance, holding whatever `render` returns. A sheet is the
 * app's surface for a task with a body — a list, a picker, a set of fields.
 * Logging today's weight is one number and one button, and a sheet rising
 * from the foot of the screen for that was a whole surface arriving for a
 * question that fits in a card.
 *
 * **The box sits high, not centred.** On the phone this runs on the number
 * keyboard takes the lower half of the screen the moment the field takes
 * focus, and a box centred in the layout viewport lands under it. Anchored
 * at the top it stays in view with the keyboard up. UNVERIFIED ON DEVICE.
 *
 * `render(close)` gets the function that dismisses the dialog, so a save
 * can close it. Backdrop and Escape close it too.
 */
export function openDialog({ title, render }) {
  const close = () => {
    if (scrim.dataset.closing) return
    scrim.dataset.closing = 'true'
    setTimeout(() => scrim.remove(), 200)
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close()
  }

  const dim = h('div', { class: 'sheet-dim confirm-dim', 'aria-hidden': 'true' })
  const box = h(
    'div',
    {
      class:
        'confirm-in relative w-full max-w-[380px] rounded-[24px] border border-outline bg-canvas p-[20px]',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': title,
    },
    h(
      'div',
      { class: 'mb-[20px] flex items-center justify-between gap-[10px]' },
      h('h2', { class: 'text-[20px] font-semibold' }, title),
      h(
        'button',
        { class: 'icon-btn -my-[7px] -mr-[7px]', 'aria-label': 'Close', onclick: close },
        icon('close', { size: 20, stroke: 2 }),
      ),
    ),
    render(close),
  )
  const scrim = h(
    'div',
    {
      class:
        'sheet-scrim screen-cover z-[90] flex items-start justify-center px-[20px] pt-[calc(env(safe-area-inset-top,0px)+96px)]',
      onclick: (e) => {
        if (!box.contains(e.target)) close()
      },
    },
    dim,
    box,
  )
  document.body.appendChild(scrim)
  document.addEventListener('keydown', onKey)
  // The field is the point of the dialog, so it takes focus on arrival and
  // the keyboard comes with it.
  requestAnimationFrame(() => box.querySelector('input')?.focus())
  return { close }
}
