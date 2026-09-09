import { h, repaint, replay } from '../lib/dom.js'
import { icon, sparkleHalf } from '../lib/icons.js'
import { toast } from '../lib/toast.js'
import { openSheet } from '../lib/sheet.js'
import { getFood, getPlate, savePlate, getSettings } from '../lib/db.js'
import { emptyTotals, addTotals } from '../lib/compute.js'
import { logPlate, defaultServing } from '../lib/logging.js'
import { parseDescription } from '../lib/describeRules.js'
import {
  resolveParsed,
  resolveModelItems,
  classifyItem,
  itemMacros,
  leftoversPayload,
} from '../lib/describeResolve.js'
import { describeLeftovers } from '../lib/describeModel.js'
import { hasAiKey, getAiMode, setAiMode, aiUndecided } from '../lib/aiKey.js'
import { isOnline } from '../lib/off.js'
import {
  stampRows,
  carryCorrections,
  replaceSent,
  draftStatus,
  mergeIntoPlate,
  stripDraft,
  amountQuestion,
  draftId,
  draftKey,
} from '../lib/describeDraft.js'
import { pushMatchItem } from './matchItem.js'
import { pushSaveAsMeal, plateLoggedToast } from './plate.js'
import {
  notice,
  slot,
  busyLabel,
  foodRowBody,
  estimateBadge,
  macroLine,
  macroUnit,
  numberInput,
  segmentedWide,
  textInput,
  blockSelector,
  labelledField,
} from '../lib/ui.js'
import { qty, servingLabel, unitLabel, pluralize, round, displayName } from '../lib/format.js'
import { blockForTime, todayStr } from '../lib/dates.js'

/**
 * Describing a meal in words: write a sentence, review the meal, log it.
 *
 * One panel, three states, and the panel never leaves. The sentence is read
 * into rows in place — the field collapses to a summary and the rows arrive
 * under it — and every correction happens on the row it is about. The plate
 * is not opened, nothing is pushed for an amount, and the only panel that is
 * ever stacked on this one is the food search, because a search needs the
 * room.
 *
 * **What is decided here, and what is not.** The rules parser, the library,
 * the staples table and Open Food Facts run in an order this file does not
 * choose and does not show. The one decision that is the person's to make is
 * whether words may leave the phone, and it is made once — in Settings, or
 * the first time this sheet has something it would send — and remembered.
 * With sending on, the fragments the app could not place go to Gemini on
 * their own after the local read; with it off, or with no key, or with no
 * network, those rows say so and offer the search. Nothing is sent from any
 * other state and no button here reads "send".
 *
 * **The sentence is never lost.** It is kept in local storage as it is typed
 * and cleared only when the meal is logged, so a failed read, a closed sheet
 * or a trip to Settings to turn Gemini on all come back to the words as they
 * were. Editing it and reviewing again replaces the rows rather than adding
 * to them, and a row that was fixed by hand survives the re-read — see
 * `carryCorrections`.
 */

const DRAFT_KEY = 'mt:describeDraft'

function readDraft() {
  try {
    return localStorage.getItem(DRAFT_KEY) || ''
  } catch {
    return ''
  }
}

function writeDraft(text) {
  try {
    if (text) localStorage.setItem(DRAFT_KEY, text)
    else localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* the panel still holds it for as long as it is open */
  }
}

/**
 * The three points at which a wait stops being a wait.
 *
 * **6s: the copy changes.** A normal Flash round trip on this payload is a
 * couple of seconds, and `describeModel` will spend another 700ms plus a second
 * attempt on a dropped connection before it gives up. Six is roughly double
 * that, so this fires when something is genuinely slow rather than merely
 * unlucky. Only the words change; the mark keeps its cycle, because nothing
 * has actually happened yet and restarting it would say otherwise.
 *
 * **15s: an escape appears.** Past the point where anyone still believes it is
 * coming. A wait with no way out is worse than no animation at all.
 *
 * **30s: it is over.** There is no timeout in `describeModel` — the fetch has
 * none — so a connection that opens and then goes nowhere hangs for as long as
 * the platform allows. This is the ceiling, and it lands in the ordinary
 * failure path with "Try again" beside it.
 *
 * The local read gets the same ceiling. It can reach Open Food Facts, and a
 * search that never answers must not hold the sentence hostage.
 */
const WAIT_LONG_MS = 6000
const WAIT_ESCAPE_MS = 15000
const WAIT_CEILING_MS = 30000

/**
 * The one multi-line input in the app: a textarea in a `.panel`, not a tall
 * `.field`. A `.field` is a capsule — 48px with a 24px radius — and this box is
 * three times that height, so the container radius is the honest one. The
 * fill is what makes it the only thing on the screen to look at.
 *
 * Six rows, and a floor under them. The old five-row field was cramped on a
 * phone and it moved: the sheet was sized to its content, so it changed height
 * when a notice appeared under it. The panel it lives in now fills the sheet
 * — see `root` — and the field takes a comfortable share of that.
 */
function describeField({ value, onInput, onSubmit }) {
  const input = h('textarea', {
    class:
      'block min-h-[150px] w-full min-w-0 resize-none bg-transparent text-[16px] font-medium leading-snug',
    rows: '6',
    // One line, not three. A placeholder long enough to wrap reads as content
    // already in the box, and this one has to look empty.
    placeholder: 'Two eggs on toast and a black coffee',
    'aria-label': 'What did you eat?',
    autocapitalize: 'sentences',
    autocorrect: 'on',
    spellcheck: 'true',
    enterkeyhint: 'enter',
    oninput: (e) => onInput(e.target.value),
    onkeydown: (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onSubmit()
      }
    },
  })
  input.value = value ?? ''
  const wrapper = h('div', { class: 'panel px-[20px] py-[14px]' }, input)
  wrapper.input = input
  return wrapper
}

/** The words the describe state shows under the field, for the mode it is in. */
function modeCopy() {
  if (!hasAiKey()) {
    return 'Everything stays on this phone. A food the app cannot place will ask you to pick one.'
  }
  const mode = getAiMode()
  if (mode === 'on') {
    return 'A food the app cannot place is sent to Gemini as words, and nothing else leaves this phone.'
  }
  if (mode === 'off') {
    return 'Everything stays on this phone. Gemini is off in Settings.'
  }
  return 'Everything stays on this phone unless you say otherwise. If a food cannot be placed, you will be asked before any words are sent.'
}

/** The amount in words, for a real food or for an estimate that has none. */
function amountLabel(item, record) {
  if (item.quantity == null) return null
  const n = Number(item.quantity)
  if (item.unit !== 'serving') return `${qty(n)} ${unitLabel(item.unit, n)}`
  return record ? `${qty(n)} × ${servingLabel(record)}` : `${qty(n)} ${n === 1 ? 'serving' : 'servings'}`
}

/**
 * A notice with two answers, for the one question this sheet asks that has two.
 *
 * `notice` carries a single action, which is right everywhere else it is used.
 * The consent question has to offer both answers with equal weight — a "yes"
 * with no "no" beside it is a nag, not a question.
 */
function choiceNotice(text, choices, { iconName = 'info' } = {}) {
  return h(
    'div',
    { class: 'panel flex items-start gap-[10px] p-[20px]' },
    icon(iconName, { size: 20, class: 'mt-px shrink-0 text-muted' }),
    h(
      'div',
      { class: 'flex-1 text-[14px] leading-snug' },
      text,
      h(
        'div',
        { class: 'mt-[10px] flex flex-wrap gap-[10px]' },
        choices.map(({ label, onChoose }) => h('button', { class: 'chip-sm', onclick: onChoose }, label))
      )
    )
  )
}

/* ---------------------------------------------------------------- the panel */

/**
 * @param {object} opts
 * @param {string} [opts.date]
 * @param {string} [opts.block]
 * @param {(entries: object[]) => void} [opts.onLogged]   after the meal is logged
 * @param {() => void} [opts.onStaged]                    after rows are put on the plate
 */
export function describePanel({ date = todayStr(), block: initialBlock, onLogged, onStaged } = {}) {
  return {
    title: 'Describe',
    render: (ctx) => {
      let text = readDraft()
      /** The rows under review. Plate-shaped, plus the draft's own fields. */
      let items = []
      /** The library records the rows draw from, by id. Missing means deleted. */
      const foods = new Map()
      /** The fragment each row was read from, keyed by row id, for the re-read. */
      let block = initialBlock
      let stage = 'describe'
      let working = false
      let sending = false
      let logged = false
      let openRow = null
      let controller = null
      let waitTimers = []
      /** The one stop control, set only once a wait has run long enough to earn it. */
      let onStop = null
      /** Set when Gemini's answer for this review has already been asked for and refused. */
      let declined = false
      const tag = draftId()

      const clearWaitTimers = () => {
        waitTimers.forEach(clearTimeout)
        waitTimers = []
      }
      ctx.onDispose(() => {
        controller?.abort()
        clearWaitTimers()
      })

      /* ------------------------------------------------------------ describe */

      const field = describeField({
        value: text,
        onInput: (v) => {
          text = v
          writeDraft(text)
          syncReviewBtn()
        },
        onSubmit: () => review(),
      })

      const describeStatus = slot()
      const modeLine = h('p', { class: 'px-0 text-[12px] leading-snug text-muted' }, modeCopy())

      const reviewBtn = h('button', {
        class: 'btn-primary',
        onclick: () => review(),
        /**
         * Pressing it must not close the keyboard, which is the whole point of
         * moving it up here: a blur would hide the keys, the sheet would grow
         * back to full height, and this button would be moved to the footer
         * between the finger going down and coming up — so the tap would land
         * on whatever the sheet put in its place. Declining the focus change
         * keeps the caret in the field and the button under the thumb. Harmless
         * in the footer, where the field is not focused anyway.
         */
        onmousedown: (e) => e.preventDefault(),
      }, 'Review meal')

      function syncReviewBtn() {
        reviewBtn.disabled = working || !text.trim()
      }

      /**
       * Where "Review meal" sits while the keyboard is up.
       *
       * The sheet lifts its bottom edge clear of the keys, so the floating
       * footer is not buried — but it is at the far end of a sheet that is now
       * mostly field, and reaching it means dismissing the keyboard to be sure
       * of where it went. The button belongs next to the words being typed:
       * finish the sentence, press the thing directly under it, keys still up.
       *
       * Filled and emptied by `placeReviewBtn`, which owns the one button and
       * moves it between here and the footer. Empty the rest of the time, so
       * the gap it would leave collapses.
       */
      const inlineFooter = h('div', { class: 'flex flex-col empty:hidden' })

      const describeView = h(
        'div',
        { class: 'flex flex-col gap-[20px]' },
        h('h3', { class: 'text-[20px] font-semibold leading-tight tracking-[-0.01em]' }, 'What did you eat?'),
        field,
        inlineFooter,
        describeStatus,
        modeLine
      )

      /* -------------------------------------------------------------- review */

      const sentenceEl = h('p', {
        class: 'min-w-0 flex-1 text-[14px] leading-snug',
        style: {
          display: '-webkit-box',
          WebkitLineClamp: '3',
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        },
      })
      // Centred against the sentence, however many lines it wraps to: the chip
      // is the way back to the whole sentence, not a note on its first line.
      const summary = h(
        'div',
        { class: 'panel flex items-center gap-[10px] px-[20px] py-[14px]' },
        sentenceEl,
        h(
          'button',
          { class: 'chip-sm shrink-0', onclick: () => showStage('describe') },
          'Edit description'
        )
      )

      const totalsTile = h('div', { class: 'panel flex flex-col gap-[10px] px-[20px] py-[20px]' })
      /** Notices about the review as a whole. Announced, since they arrive on their own. */
      const reviewStatus = slot()
      reviewStatus.setAttribute('aria-live', 'polite')
      const rowsCard = h('div', { class: 'card' })
      const blockRow = h('div', { class: 'flex flex-col gap-[10px]' })

      const reviewView = h(
        'div',
        { class: 'hidden flex-col gap-[20px]' },
        summary,
        totalsTile,
        reviewStatus,
        rowsCard,
        blockRow
      )

      const blockedLine = h('p', {
        class: 'px-[20px] text-center text-[12px] leading-snug text-muted empty:hidden',
        role: 'status',
      })
      const logBtn = h('button', { class: 'btn-primary', onclick: () => log() }, 'Log meal')
      const reviewFooter = h('div', { class: 'flex flex-col gap-[10px]' }, blockedLine, logBtn)

      /**
       * The whole sheet, whichever state it is in.
       *
       * `min-height` is the screen, so the sheet sits at its cap from the first
       * frame and stays there: typing, the read, the rows arriving, a row
       * opening — none of them move the sheet's top edge, because the surface
       * was already as tall as it can be. What changes is inside the scroller.
       */
      const root = h(
        'div',
        { class: 'flex flex-col', style: { minHeight: 'var(--screen-h)' } },
        describeView,
        reviewView
      )

      /**
       * Fill the sheet exactly, and no more.
       *
       * The root asks for the whole screen so the sheet rises to its cap, then
       * is trimmed to what the scroller actually shows between its two bands.
       * Without the trim the scroller would hold a screen's worth of content
       * inside a box a screen minus two bands tall, and the describe state
       * would scroll through 180px of nothing. Re-run whenever the box could
       * have changed: a state change swaps the footer, the keyboard changes
       * the cap, and a panel popping back over this one animates its height.
       */
      function fitRoot() {
        if (!root.isConnected) return
        const body = ctx.body
        root.style.minHeight = 'var(--screen-h)'
        void body.offsetHeight
        const cs = getComputedStyle(body)
        const inner = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
        if (inner > 0) root.style.minHeight = `${inner}px`
      }
      let fitTimer = null
      const scheduleFit = (delay = 0) => {
        clearTimeout(fitTimer)
        fitTimer = setTimeout(() => requestAnimationFrame(fitRoot), delay)
      }
      const vv = window.visualViewport
      const onViewport = () => scheduleFit(60)
      vv?.addEventListener('resize', onViewport)
      window.addEventListener('resize', onViewport)
      ctx.onDispose(() => {
        clearTimeout(fitTimer)
        vv?.removeEventListener('resize', onViewport)
        window.removeEventListener('resize', onViewport)
      })

      /**
       * The primary button has one home at a time: under the field while the
       * keyboard is up on the describe state, in the sheet's footer otherwise.
       * Moving the node rather than making a second one keeps `syncReviewBtn`
       * and the wait's label rewrite pointing at the button that is on screen.
       *
       * The review state keeps its footer either way — its keyboard, when one
       * opens at all, belongs to a number in a row rather than to the button.
       */
      function placeReviewBtn() {
        const inline = stage !== 'review' && ctx.keyboardOpen()
        if (inline) {
          if (reviewBtn.parentNode !== inlineFooter) inlineFooter.replaceChildren(reviewBtn)
          ctx.setFooter(null)
        } else {
          inlineFooter.replaceChildren()
          ctx.setFooter(stage === 'review' ? reviewFooter : reviewBtn)
        }
        scheduleFit()
      }
      ctx.onKeyboard(() => placeReviewBtn())

      function showStage(next) {
        stage = next
        const toReview = next === 'review'
        describeView.classList.toggle('hidden', toReview)
        reviewView.classList.toggle('hidden', !toReview)
        reviewView.classList.toggle('flex', toReview)
        // The app's fade for a panel whose contents changed, on whichever half
        // just arrived. Never both, so the two cannot argue.
        replay(toReview ? reviewView : describeView, 'panel-in')
        ctx.setTitle(toReview ? 'Review' : 'Describe')
        placeReviewBtn()
        ctx.body.scrollTop = 0
        scheduleFit()
        if (toReview) {
          // The rows are read, not typed. Nothing here wants the keyboard, and
          // it was only still up because the button declines to blur the field.
          field.input.blur()
        } else {
          syncReviewBtn()
          // Back to the words to change them, so the caret goes there.
          field.input.focus({ preventScroll: true })
        }
      }

      /* ------------------------------------------------------------ the read */

      /**
       * Wait, in the control that started it, and stop it if it goes on.
       *
       * The same shape for both waits — the local read, which can reach Open
       * Food Facts, and the model — because they are the same kind of thing
       * from where the person is sitting: a button was pressed and the answer
       * has not arrived. The label changes at 6s, the button turns back into a
       * control at 15s, and the ceiling aborts at 30s.
       */
      function startWait(button, label, live, { onStopped, onTimedOut }) {
        const busy = busyLabel(label)
        repaint(button, busy)
        button.disabled = true
        clearWaitTimers()
        waitTimers = [
          setTimeout(() => {
            busy.label.textContent = `Still ${label.charAt(0).toLowerCase()}${label.slice(1)}`
            replay(busy.label, 'reading-swap')
          }, WAIT_LONG_MS),
          setTimeout(() => {
            busy.label.textContent = 'Stop waiting'
            replay(busy.label, 'reading-swap')
            onStop = () => {
              onStopped()
              live.abort()
            }
            button.disabled = false
          }, WAIT_ESCAPE_MS),
          setTimeout(() => {
            onTimedOut()
            live.abort()
          }, WAIT_CEILING_MS),
        ]
      }

      function endWait(button, label) {
        clearWaitTimers()
        onStop = null
        button.textContent = label
      }

      // The review button is the wait AND the stop, and which one it is doing
      // is whatever its label currently says — see `startWait`.
      reviewBtn.onclick = () => (working ? onStop?.() : review())

      async function review() {
        if (working) return
        const input = text.trim()
        if (!input) return

        working = true
        repaint(describeStatus)
        controller?.abort()
        controller = new AbortController()
        const live = controller
        let stopped = false
        let timedOut = false
        let read = false
        startWait(reviewBtn, 'Reading your meal', live, {
          onStopped: () => (stopped = true),
          onTimedOut: () => (timedOut = true),
        })

        try {
          const parsed = parseDescription(input)
          if (!parsed.parts.length) {
            repaint(
              describeStatus,
              notice('Nothing in that reads as a food. Try naming what you ate.', { iconName: 'alert' })
            )
            return
          }

          const resolved = await resolveParsed(parsed, { signal: live.signal })
          /**
           * Keyed by the fragment each row was read from, which is what lets
           * a re-read find the row it replaces. `resolveParsed` hands back one
           * row per part, in order, so the two lists pair up by position.
           */
          const fresh = stampRows(
            resolved.map((row, i) => ({ ...row, key: draftKey(parsed.parts[i]?.text ?? row.text ?? row.name) }))
          )
          items = carryCorrections(items, fresh)
          declined = false
          await loadFoods()
          sentenceEl.textContent = input
          paintReview({ arriving: true })
          showStage('review')
          read = true
        } catch (err) {
          if (err?.name === 'AbortError') {
            if (stopped) {
              repaint(
                describeStatus,
                notice('Stopped. Your words are still here.', { iconName: 'info' })
              )
              return
            }
            if (!timedOut) return
            repaint(
              describeStatus,
              notice('That took too long. Check the connection and try again; your words are still here.', {
                iconName: 'alert',
                action: 'Try again',
                onAction: () => review(),
              })
            )
            return
          }
          repaint(
            describeStatus,
            notice('That could not be read. Your words are still here, or add the foods the usual way.', {
              iconName: 'alert',
            })
          )
          console.warn('Describe: read failed', err)
        } finally {
          working = false
          endWait(reviewBtn, 'Review meal')
          syncReviewBtn()
        }
        // After the read has settled, not inside it: a re-read started while
        // Gemini is still out must not be refused as "already working".
        if (read) maybeSend()
      }

      /** The library records the rows point at. A row whose food is gone is marked. */
      async function loadFoods() {
        for (const row of items) {
          if (!row.foodId) continue
          if (!foods.has(row.foodId)) foods.set(row.foodId, (await getFood(row.foodId)) || null)
          row.missing = foods.get(row.foodId) == null
        }
      }

      const recordFor = (row) => (row.foodId ? foods.get(row.foodId) : row.draft) || null
      const stateOf = (row) => (row.missing ? 'missing' : classifyItem(row))

      /* --------------------------------------------------------------- Gemini */

      /**
       * Send what could not be placed, if sending is allowed, and ask once if
       * it has never been decided.
       *
       * `only` narrows it to particular rows — the "Ask Gemini" chip on one
       * row — and `force` is the consent answer arriving, which has already
       * been written to the preference by the time this runs.
       */
      async function maybeSend({ only = null, force = false } = {}) {
        const targets = items.filter(
          (row) => stateOf(row) === 'unmatched' && !row.pending && (!only || only.includes(row.id))
        )
        if (!targets.length || !hasAiKey()) return
        if (!force && getAiMode() !== 'on') {
          if (aiUndecided() && !declined) askConsent(targets)
          return
        }
        if (!isOnline()) {
          setReviewNotice(
            notice(
              'Offline, so Gemini cannot be asked. Pick a food for each item, or try again when you are back online.',
              { iconName: 'offline', action: 'Try again', onAction: () => maybeSend({ only, force: true }) }
            )
          )
          return
        }
        await send(targets)
      }

      /**
       * The one question, asked once.
       *
       * Both answers are written to the preference, so it is never asked
       * again: "Use Gemini" turns sending on for good, "Keep it local" turns
       * it off for good, and either can be changed in Settings. The words
       * that would be sent are named in the question, because that is the
       * whole of what is being consented to.
       */
      function askConsent(targets) {
        const n = targets.length
        setReviewNotice(
          choiceNotice(
            `${pluralize(n, 'item')} could not be placed. Gemini can read ${n === 1 ? 'those words' : 'the words'} and estimate ${n === 1 ? 'it' : 'them'}. Only the words of the unplaced ${n === 1 ? 'item are' : 'items are'} sent, and this is remembered.`,
            [
              {
                label: 'Use Gemini',
                onChoose: () => {
                  setAiMode('on')
                  modeLine.textContent = modeCopy()
                  toast('Describe will ask Gemini. Change this in Settings.')
                  maybeSend({ force: true })
                },
              },
              {
                label: 'Keep it local',
                onChoose: () => {
                  setAiMode('off')
                  declined = true
                  modeLine.textContent = modeCopy()
                  setReviewNotice(null)
                  toast('Describe stays on this phone. Change this in Settings.')
                },
              },
            ],
            { iconName: 'sparkle' }
          )
        )
      }

      async function send(targets) {
        if (sending) return
        sending = true
        const sentIds = targets.map((row) => row.id)
        for (const row of targets) {
          row.pending = true
          paintRowHead(row)
        }
        syncFooter()

        controller?.abort()
        controller = new AbortController()
        const live = controller
        let stopped = false
        let timedOut = false

        /**
         * The wait lives on the rows being read — the sparkle moves on each of
         * them — and the notice above them names it and, after 15s, offers the
         * way out. The log button is already blocked by the rows it is waiting
         * on, so it is not the control that says anything about this.
         */
        setReviewNotice(
          notice(`Asking Gemini about ${pluralize(sentIds.length, 'item')}.`, { iconName: 'sparkle' })
        )
        clearWaitTimers()
        waitTimers = [
          setTimeout(() => {
            setReviewNotice(notice('Still waiting on Gemini.', { iconName: 'sparkle' }))
          }, WAIT_LONG_MS),
          setTimeout(() => {
            setReviewNotice(
              notice('Still waiting on Gemini.', {
                iconName: 'sparkle',
                action: 'Stop waiting',
                onAction: () => {
                  stopped = true
                  live.abort()
                },
              })
            )
          }, WAIT_ESCAPE_MS),
          setTimeout(() => {
            timedOut = true
            live.abort()
          }, WAIT_CEILING_MS),
        ]

        const settle = (message, opts = {}) => {
          for (const row of items) {
            if (sentIds.includes(row.id)) {
              row.pending = false
              paintRowHead(row)
            }
          }
          setReviewNotice(message ? notice(message, opts) : null)
        }

        try {
          const { spans, unresolved } = leftoversPayload(targets)
          const returned = await describeLeftovers({ spans, unresolved, signal: live.signal })
          const replacements = stampRows(await resolveModelItems(returned, { signal: live.signal }))
          if (!replacements.length) {
            settle('Gemini did not find a food in that. Pick one for each item, or edit the description.', {
              iconName: 'alert',
            })
            return
          }
          items = replaceSent(items, sentIds, replacements)
          await loadFoods()
          setReviewNotice(null)
          paintRows({ arriving: true })
          syncTotals()
        } catch (err) {
          if (err?.name === 'AbortError') {
            if (stopped) {
              settle('Stopped. The items are still here to pick a food for.', {
                iconName: 'info',
                action: 'Try again',
                onAction: () => maybeSend({ only: sentIds, force: true }),
              })
              return
            }
            // Not stopped and not timed out means the panel is going away.
            if (!timedOut) return
          }
          const reason = timedOut
            ? 'Gemini did not answer in time.'
            : err?.message || 'Gemini could not be reached.'
          settle(`${reason} The rest of the meal is unchanged.`, {
            iconName: 'alert',
            action: 'Try again',
            onAction: () => maybeSend({ only: sentIds, force: true }),
          })
        } finally {
          clearWaitTimers()
          sending = false
          syncFooter()
        }
      }

      function setReviewNotice(node) {
        repaint(reviewStatus, node)
        if (node) node.classList.add('panel-in')
      }

      /* ----------------------------------------------------------- painting */

      function paintReview({ arriving = false } = {}) {
        openRow = null
        paintRows({ arriving })
        syncTotals()
        repaint(
          blockRow,
          h('div', { class: 'section-label' }, 'Block'),
          blockSelector({
            value: block,
            onChange: (v) => (block = v),
            blockNames: settingsBlockNames,
          })
        )
        setReviewNotice(null)
      }

      let settingsBlockNames = ['Morning', 'Afternoon', 'Night']
      getSettings().then((s) => {
        settingsBlockNames = s.blockNames
        if (stage === 'review') paintReview()
      })

      const rowNodes = new Map()

      function paintRows({ arriving = false } = {}) {
        rowNodes.clear()
        const nodes = items.map((row) => {
          const node = rowNode(row)
          if (arriving) node.classList.add('row-in')
          return node
        })
        repaint(
          rowsCard,
          nodes.length
            ? nodes
            : h('div', { class: 'row text-[14px] text-muted' }, 'Nothing left to log. Edit the description to start again.')
        )
        /**
         * The question is asked where it is needed. A food named without an
         * amount opens ready to be answered; if there are several, the first,
         * since one open editor is a question and three is a form.
         */
        const first = items.find((row) => stateOf(row) === 'needs-amount')
        if (first) toggleRow(first.id, true)
        syncFooter()
      }

      /**
       * One row: a button that opens its editor beneath it.
       *
       * The row is the control. No pencil, no search glyph, no cross beside
       * every line — a chevron on the right says it opens, `aria-expanded`
       * says whether it has, and everything that can be done to the row is
       * inside it once it is open.
       */
      function rowNode(row) {
        const head = h('button', {
          class: 'row w-full',
          'aria-expanded': 'false',
          onclick: () => toggleRow(row.id),
        })
        const editor = h('div', { class: 'hidden flex-col gap-[20px] px-[20px] pb-[20px]' })
        const node = h('div', { 'data-row': row.id }, head, editor)
        node.head = head
        node.editor = editor
        rowNodes.set(row.id, node)
        paintRowHead(row)
        return node
      }

      const STATE_SUB = {
        'needs-amount': 'Needs an amount',
        unmatched: 'Not found yet',
        missing: 'No longer in your library',
      }

      function paintRowHead(row) {
        const node = rowNodes.get(row.id)
        if (!node) return
        const state = stateOf(row)
        const record = recordFor(row)
        const name = displayName(record?.name || row.name) || 'Deleted food'
        const status = row.pending ? 'Asking Gemini' : STATE_SUB[state] || (state === 'estimated' ? 'Estimated' : null)
        const sub = [amountLabel(row, record), status].filter(Boolean).join(' · ')
        const macros = state === 'missing' ? null : itemMacros(row, record)
        node.head.setAttribute('aria-label', `${name}. ${sub || ''} Tap to change.`.trim())
        repaint(
          node.head,
          foodRowBody({
            name,
            sub,
            totals: macros,
            badge: state === 'estimated' ? estimateBadge() : null,
            missing: state === 'missing',
          }),
          row.pending
            ? h('span', { class: 'sparkle-wait shrink-0 text-muted' }, sparkleHalf('big'), sparkleHalf('small'))
            : icon('chevronDown', {
                size: 18,
                class: `shrink-0 text-muted transition-transform ${openRow === row.id ? 'rotate-180' : ''}`,
              })
        )
      }

      /**
       * One open row at a time. Opening one closes the other, so the list
       * stays a list with one question in it rather than a stack of forms.
       */
      function toggleRow(id, open = openRow !== id) {
        if (openRow && openRow !== id) {
          const prev = rowNodes.get(openRow)
          if (prev) {
            prev.editor.classList.add('hidden')
            prev.editor.classList.remove('flex')
            prev.head.setAttribute('aria-expanded', 'false')
          }
          const prevRow = items.find((r) => r.id === openRow)
          openRow = null
          if (prevRow) paintRowHead(prevRow)
        }
        const row = items.find((r) => r.id === id)
        const node = rowNodes.get(id)
        if (!row || !node) return
        openRow = open ? id : null
        node.editor.classList.toggle('hidden', !open)
        node.editor.classList.toggle('flex', open)
        node.head.setAttribute('aria-expanded', String(open))
        if (open) paintEditor(row)
        else repaint(node.editor)
        paintRowHead(row)
      }

      /** The row changed under an open editor: the head and the totals follow it. */
      function rowChanged(row) {
        paintRowHead(row)
        syncTotals()
        syncFooter()
      }

      function paintEditor(row) {
        const node = rowNodes.get(row.id)
        const state = stateOf(row)
        const record = recordFor(row)
        const name = displayName(record?.name || row.name) || 'this'

        const removeChip = h(
          'button',
          { class: 'chip-sm', onclick: () => removeRow(row) },
          'Remove'
        )
        const doneChip = h('button', { class: 'chip-sm', onclick: () => toggleRow(row.id, false) }, 'Done')

        if (state === 'estimated') {
          // Scaling rather than re-estimating is the honest arithmetic: the
          // model was asked for the total at the amount described, so half
          // that amount is half those numbers.
          row.base = row.base || { quantity: Number(row.quantity) || 1, computed: { ...row.computed } }
          const scale = (q) => {
            const factor = (Number(q) || 0) / (row.base.quantity || 1)
            row.computed = {
              kcal: round(row.base.computed.kcal * factor, 1),
              protein: round(row.base.computed.protein * factor, 1),
              fat: round(row.base.computed.fat * factor, 1),
              carbs: round(row.base.computed.carbs * factor, 1),
            }
          }
          repaint(
            node.editor,
            labelledField({
              label: 'Servings',
              hint: 'Estimated by Gemini. Change the amount and the numbers scale with it.',
              children: numberInput({
                value: String(row.quantity ?? 1),
                autofocus: true,
                onInput: (v) => {
                  row.quantity = Number(v) || 0
                  row.fixed = true
                  scale(v)
                  rowChanged(row)
                },
              }),
            }),
            h('div', { class: 'flex flex-wrap gap-[10px]' }, doneChip, removeChip)
          )
          return
        }

        if (state === 'matched' || state === 'needs-amount') {
          const asking = state === 'needs-amount'
          const options = [{ value: 'serving', label: 'servings' }]
          if (!(record.servingUnit === 'item' && Number(record.servingSize) === 1)) {
            options.push({ value: record.servingUnit, label: unitLabel(record.servingUnit, 2) })
          }
          let unit = row.unit || 'serving'
          const suggested = defaultServing(record)
          const amount = numberInput({
            value: row.quantity == null ? '' : String(row.quantity),
            placeholder: String(suggested.quantity),
            autofocus: true,
            onInput: (v) => {
              const n = v.trim() === '' ? null : Number(v)
              row.quantity = n == null || Number.isNaN(n) ? null : n
              row.unit = unit
              row.fixed = true
              row.corrected = true
              rowChanged(row)
            },
          })
          const unitRow = h('div')
          const paintUnit = () =>
            repaint(
              unitRow,
              segmentedWide({
                options,
                value: unit,
                key: `describe-unit-${row.id}`,
                onChange: (v) => {
                  const n = Number(row.quantity) || 0
                  if (row.quantity != null) {
                    if (v === 'serving' && unit !== 'serving') {
                      row.quantity = round(n / (Number(record.servingSize) || 1), 2)
                    } else if (v !== 'serving' && unit === 'serving') {
                      row.quantity = round(n * (Number(record.servingSize) || 1), 2)
                    }
                    amount.input.value = String(row.quantity)
                  }
                  unit = v
                  row.unit = v
                  row.fixed = true
                  row.corrected = true
                  paintUnit()
                  rowChanged(row)
                },
              })
            )
          paintUnit()
          repaint(
            node.editor,
            labelledField({
              label: asking ? amountQuestion(name) : 'Amount',
              hint: `1 serving = ${servingLabel(record)}`,
              children: amount,
            }),
            options.length > 1 ? unitRow : null,
            h('div', { class: 'flex flex-wrap gap-[10px]' }, doneChip, removeChip)
          )
          return
        }

        if (state === 'missing') {
          repaint(
            node.editor,
            h(
              'p',
              { class: 'text-[14px] leading-snug text-muted' },
              'This food was deleted from your library, so it will be skipped. Pick another, or remove it.'
            ),
            h(
              'div',
              { class: 'flex flex-wrap gap-[10px]' },
              h('button', { class: 'chip-sm', onclick: () => findFood(row) }, 'Pick a food'),
              removeChip
            )
          )
          return
        }

        // Unmatched: the words are editable, a search is one tap away, and
        // Gemini is offered only where it is allowed.
        const words = textInput({
          value: row.text || row.name || '',
          placeholder: 'What was it?',
          onInput: (v) => {
            row.text = v
            row.name = v
            paintRowHead(row)
          },
        })
        const chips = [h('button', { class: 'chip-sm', onclick: () => findFood(row) }, 'Pick a food')]
        if (hasAiKey() && getAiMode() !== 'off' && !row.pending) {
          chips.push(
            h(
              'button',
              { class: 'chip-sm', onclick: () => maybeSend({ only: [row.id] }) },
              'Ask Gemini'
            )
          )
        }
        chips.push(removeChip)
        repaint(
          node.editor,
          h(
            'p',
            { class: 'text-[14px] leading-snug text-muted' },
            row.pending
              ? 'Gemini is reading this now.'
              : 'Not in your foods, the staples table or Open Food Facts. Fix the words, pick a food, or remove it.'
          ),
          labelledField({ label: 'Words', children: words }),
          h('div', { class: 'flex flex-wrap gap-[10px]' }, chips)
        )
      }

      /** The search, on its own panel, because a list of results needs the room. */
      function findFood(row) {
        pushMatchItem(ctx, {
          initial: row.text || row.name || '',
          onPick: async (picked) => {
            row.foodId = picked.foodId ?? null
            row.draft = picked.draft
            row.name = picked.name
            row.span = false
            row.missing = false
            row.fixed = true
            // A phrase never had an amount, so matching it leaves the row
            // asking for one rather than inventing a serving.
            if (row.quantity == null) row.unit = row.unit || 'serving'
            if (row.foodId && !foods.has(row.foodId)) foods.set(row.foodId, await getFood(row.foodId))
            rowChanged(row)
            if (stateOf(row) === 'needs-amount') toggleRow(row.id, true)
            else toggleRow(row.id, false)
            // The search panel pops back over this one with a height
            // animation; refit once it has landed.
            scheduleFit(300)
          },
        })
      }

      /**
       * Removal, from inside the row, with a way back.
       *
       * The row collapses out of the list and the toast offers it back for
       * five seconds. No confirm: nothing has been logged, and a removed row is
       * one tap from being restored.
       */
      function removeRow(row) {
        const index = items.indexOf(row)
        if (index < 0) return
        items = items.filter((r) => r !== row)
        if (openRow === row.id) openRow = null
        rowNodes.get(row.id)?.remove()
        rowNodes.delete(row.id)
        if (!items.length) paintRows()
        syncTotals()
        syncFooter()
        const name = displayName(recordFor(row)?.name || row.name) || 'item'
        toast(`Removed ${name}`, {
          action: 'Undo',
          onAction: () => {
            if (logged) return
            items = [...items.slice(0, index), row, ...items.slice(index)]
            paintRows()
            syncTotals()
          },
        })
      }

      /* -------------------------------------------------------------- totals */

      function syncTotals() {
        let totals = emptyTotals()
        let estimates = 0
        for (const row of items) {
          if (row.missing) continue
          const m = itemMacros(row, recordFor(row))
          if (m) totals = addTotals(totals, m)
          if (classifyItem(row) === 'estimated') estimates++
        }
        repaint(
          totalsTile,
          h(
            'div',
            { class: 'flex items-baseline gap-[10px]' },
            h('span', { class: 'tnum text-title font-semibold leading-none' }, String(Math.round(totals.kcal))),
            macroUnit('kcal', 'text-[12px] font-medium'),
            estimates
              ? h(
                  'span',
                  { class: 'ml-auto flex items-center text-[12px] text-muted' },
                  estimateBadge(),
                  `${estimates === 1 ? '1 estimate' : `${estimates} estimates`}`
                )
              : null
          ),
          macroLine(totals, { size: 14, omit: ['kcal'] }),
          /**
           * The second options, quiet, on the tile that describes the meal as
           * a whole. Neither is the next thing to do — that is the footer's —
           * and neither is hidden either.
           */
          /**
           * Two equal halves of the tile's width. `.chip-sm` is `flex: none`
           * by design — a chip is sized to its word everywhere else — so the
           * stretch is written inline: here the pair is a row of two options,
           * and two words tucked into the left of a tile read as an afterthought.
           */
          h(
            'div',
            { class: 'flex gap-[10px] pt-[10px]' },
            h(
              'button',
              { class: 'chip-sm justify-center', style: { flex: '1 1 0' }, onclick: () => stage_addToPlate() },
              'Add to plate'
            ),
            h(
              'button',
              {
                class: 'chip-sm justify-center',
                style: { flex: '1 1 0' },
                onclick: () =>
                  pushSaveAsMeal(ctx, items.filter((r) => !r.missing).map(stripDraft)),
              },
              'Save as meal'
            )
          )
        )
      }

      /**
       * What stands between the rows and the log, said above the button that
       * is waiting on it. When nothing does, the line is empty and hides.
       */
      function syncFooter() {
        const status = draftStatus(items)
        const busy = sending || working || logged
        logBtn.disabled = busy || !status.canLog
        blockedLine.textContent = sending
          ? 'Waiting on Gemini.'
          : status.canLog
            ? ''
            : status.reason
      }

      /* -------------------------------------------------------------- commit */

      async function log() {
        if (logged || working || sending) return
        const status = draftStatus(items)
        if (!status.canLog) return
        logged = true
        syncFooter()
        logBtn.textContent = 'Logging…'
        try {
          const entries = await logPlate({
            items: items.filter((r) => !r.missing).map(stripDraft),
            date,
            block,
          })
          writeDraft('')
          ctx.close()
          plateLoggedToast(entries)
          onLogged?.(entries)
        } catch (err) {
          logged = false
          logBtn.textContent = 'Log meal'
          syncFooter()
          toast(err?.message || 'Could not log that')
        }
      }

      /**
       * The plate, as a second destination. The rows go on tagged, so doing
       * this twice from one review replaces the first batch rather than adding
       * to it, and whatever else was on the plate stays where it was.
       */
      async function stage_addToPlate() {
        const staged = items.filter((r) => !r.missing)
        if (!staged.length) return
        const plate = await getPlate()
        await savePlate({
          items: mergeIntoPlate(plate.items, tag, staged),
          date: plate.items.length ? plate.date : date,
          block: plate.items.length ? plate.block : block,
          startedAt: plate.startedAt ?? Date.now(),
        })
        writeDraft('')
        toast('Added to your plate')
        if (onStaged) {
          onStaged()
          ctx.pop()
        } else {
          ctx.close()
        }
      }

      /* ---------------------------------------------------------------- boot */

      placeReviewBtn()
      syncReviewBtn()
      scheduleFit()
      // The sheet's own arrival is 320ms; a fit taken mid-slide reads a box
      // still moving.
      scheduleFit(400)
      return root
    },
  }
}

/** On the add sheet: a panel pushed over it, with the plate a pop away. */
export function pushDescribe(ctx, opts = {}) {
  return ctx.push(describePanel(opts))
}

/** On its own, from Today's first-use state: a sheet, with the same insides. */
export async function openDescribe(opts = {}) {
  const settings = await getSettings()
  const block = opts.block ?? blockForTime(new Date(), settings.blockThresholds)
  return openSheet(describePanel({ ...opts, block }))
}
