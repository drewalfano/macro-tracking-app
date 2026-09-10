import { h, repaint, replay } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { toast } from '../lib/toast.js'
import { openSheet } from '../lib/sheet.js'
import { getFood, getPlate, savePlate, getSettings } from '../lib/db.js'
import { logPlate, defaultServing } from '../lib/logging.js'
import { classifyItem, itemMacros, lookupItem } from '../lib/describeResolve.js'
import { interpretWithModel, interpretLocally } from '../lib/describeInterpret.js'
import { createDescribeSession } from '../lib/describeSession.js'
import { hasAiKey, getAiMode, setAiMode, aiUndecided } from '../lib/aiKey.js'
import { isOnline } from '../lib/off.js'
import {
  draftStatus,
  groupRows,
  describeTotals,
  mergeIntoPlate,
  stripDraft,
  amountQuestion,
  draftId,
} from '../lib/describeDraft.js'
import { pushMatchItem } from './matchItem.js'
import { pushSaveAsMeal, plateLoggedToast } from './plate.js'
import {
  notice,
  slot,
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
 * One panel, two states, and the panel never leaves. The sentence is read
 * into rows in place — the field collapses to a summary and the rows arrive
 * under it — and every correction happens on the row it is about. The plate
 * is not opened, nothing is pushed for an amount, and the only panel that is
 * ever stacked on this one is the food search, because a search needs the
 * room.
 *
 * **A read is two waits, and the review shows them as two.** First the
 * description is understood — WHAT was eaten — and the review says only
 * "Understanding your meal" while that happens, because until the item
 * boundaries are known there is nothing honest to show as a row. Then each
 * item is looked up — what it is WORTH — and that wait sits on the row it
 * belongs to, as a ring and "Finding a match". The rows still being checked
 * and the rows that are ready sit in separate groups while both exist, the
 * total is called a subtotal until every row is in, and the log button waits
 * for all of them. See `describeInterpret` for the first half and
 * `describeSession` for how an old read is kept from landing on a new list.
 *
 * **What is decided here, and what is not.** With sending on, the whole
 * description goes to Gemini to be read into foods; with it off, or with no
 * key, or with no network, the rules read it here and refuse any split they
 * cannot stand behind. Either way the library, the staples table and Open
 * Food Facts decide what each food is worth, in an order this file does not
 * choose. The one decision that is the person's to make is whether words may
 * leave the phone, and it is made once — in Settings, or the first time this
 * sheet has something it would send — and remembered.
 *
 * **The sentence is never lost.** It is kept in local storage as it is typed
 * and cleared only when the meal is logged, so a failed read, a closed sheet
 * or a trip to Settings to turn Gemini on all come back to the words as they
 * were. Editing it and reviewing again reads the whole revised sentence — it
 * never reuses an old split — and a row that was fixed by hand survives the
 * re-read; see `carryCorrections`.
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
 * The three points at which the model's wait stops being a wait.
 *
 * **6s: the copy changes.** A normal Flash round trip on this payload is a
 * couple of seconds, and `describeModel` will spend another 700ms plus a second
 * attempt on a dropped connection before it gives up. Six is roughly double
 * that, so this fires when something is genuinely slow rather than merely
 * unlucky.
 *
 * **15s: an escape appears.** Past the point where anyone still believes it is
 * coming. "Stop waiting" abandons the model and reads the description here.
 *
 * **30s: it is over.** There is no timeout in `describeModel` — the fetch has
 * none — so a connection that opens and then goes nowhere hangs for as long as
 * the platform allows. This is the ceiling, and it lands in the same local
 * fallback with a notice that says why. Each row's lookup has its own ceiling
 * in `describeSession`.
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
    return 'The description is sent to Gemini as words to pick the foods out of, and nothing else leaves this phone.'
  }
  if (mode === 'off') {
    return 'Everything stays on this phone. Gemini is off in Settings.'
  }
  return 'Everything stays on this phone unless you say otherwise. If the meal cannot be read here, you will be asked before any words are sent.'
}

/** Whether the sheet may send the description, or may ask to. */
const geminiUsable = () => hasAiKey() && getAiMode() !== 'off'

/** The amount in words, for a real food or for an estimate that has none. */
function amountLabel(item, record) {
  if (item.quantity == null) return null
  const n = Number(item.quantity)
  if (item.unit !== 'serving') return `${qty(n)} ${unitLabel(item.unit, n)}`
  return record ? `${qty(n)} × ${servingLabel(record)}` : `${qty(n)} ${n === 1 ? 'serving' : 'servings'}`
}

/** The lookup ring, sized for a row's chevron slot or for a line of text. */
const spinner = (small = false) =>
  h('span', {
    class: `spinner shrink-0${small ? ' spinner-sm' : ''}`,
    role: 'img',
    'aria-label': 'Working',
  })

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
      /** The library records the rows draw from, by id. `null` means deleted. */
      const foods = new Map()
      let block = initialBlock
      let stage = 'describe'
      let logged = false
      let openRow = null
      let waitTimers = []
      /** Abandons the model's attempt on the current read, once the wait has earned an escape. */
      let stopModel = null
      /** Set when Gemini has been offered for this review and refused. */
      let declined = false
      /** The consent question is on screen, and must not be painted over. */
      let asking = false
      /** The first amount question has been opened for this read. */
      let askedAmount = false
      const tag = draftId()

      const clearWaitTimers = () => {
        waitTimers.forEach(clearTimeout)
        waitTimers = []
      }

      /* ---------------------------------------------------------- the read */

      /**
       * What the foods are.
       *
       * The model reads the whole description when it may; when it cannot,
       * or fails, or is stopped, or runs past the ceiling, the rules read it
       * here instead and the notice says which happened. The model's attempt
       * has a controller of its own so that stopping IT does not stop the
       * read — the local fallback still runs under the read's own signal.
       */
      async function interpret(input, { signal }) {
        if (!(hasAiKey() && getAiMode() === 'on')) return interpretLocally(input, { signal })
        if (!isOnline()) {
          const local = await interpretLocally(input, { signal })
          return { ...local, notice: 'Offline, so Gemini was not asked. The description was read on this phone.' }
        }

        const attempt = new AbortController()
        const onAbort = () => attempt.abort()
        signal.addEventListener('abort', onAbort, { once: true })
        let timedOut = false
        let stopped = false
        const ceiling = setTimeout(() => {
          timedOut = true
          attempt.abort()
        }, WAIT_CEILING_MS)
        stopModel = () => {
          stopped = true
          attempt.abort()
        }
        try {
          return await interpretWithModel(input, { signal: attempt.signal })
        } catch (err) {
          if (signal.aborted) throw err
          const local = await interpretLocally(input, { signal })
          const reason =
            err?.name === 'AbortError'
              ? timedOut
                ? 'Gemini did not answer in time'
                : stopped
                  ? 'Stopped waiting on Gemini'
                  : 'Gemini was not asked'
              : (err?.message || 'Gemini could not be reached').replace(/\.\s*$/, '')
          if (err?.name !== 'AbortError') console.warn('Describe: Gemini failed', err)
          return { ...local, notice: `${reason}. The description was read on this phone instead.` }
        } finally {
          clearTimeout(ceiling)
          signal.removeEventListener('abort', onAbort)
          stopModel = null
        }
      }

      /** What one food is worth, with the library record fetched for the row. */
      async function lookup(row, { signal }) {
        const patch = await lookupItem(row, { signal })
        if (patch.foodId && !foods.has(patch.foodId)) {
          foods.set(patch.foodId, (await getFood(patch.foodId)) || null)
        }
        return patch
      }

      const session = createDescribeSession({
        interpret,
        lookup,
        onChange: () => {
          if (stage === 'review') paintState()
        },
      })
      const items = () => session.state.items

      ctx.onDispose(() => {
        session.cancel()
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
        reviewBtn.disabled = !text.trim()
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

      /** Notices about the review as a whole. Announced, since they arrive on their own. */
      const reviewStatus = slot()
      reviewStatus.setAttribute('aria-live', 'polite')

      /**
       * The first wait. One panel, one line, and no rows under it: until the
       * description has been understood there are no items to show, and a
       * speculative row that later turns out to be half a product name is
       * exactly the thing this state exists to avoid.
       */
      const understandingLabel = h('span', { class: 'text-[14px] leading-snug' }, 'Understanding your meal…')
      const understandingStop = h('div', { class: 'empty:hidden' })
      const understanding = h(
        'div',
        { class: 'panel flex items-center gap-[10px] px-[20px] py-[14px]', role: 'status', 'aria-live': 'polite' },
        spinner(),
        h('div', { class: 'flex min-w-0 flex-1 flex-col gap-[10px]' }, understandingLabel, understandingStop)
      )

      /** The rows, in their groups. Rebuilt from the session on every change. */
      const itemsArea = h('div', { class: 'flex flex-col gap-[20px]' })
      const totalsTile = h('div', { class: 'panel flex flex-col gap-[10px] px-[20px] py-[20px]' })
      /** The second options, quiet, in a row under the total rather than inside it. */
      const actionsRow = h('div', { class: 'flex flex-wrap gap-[10px]' })
      const blockRow = h('div', { class: 'flex flex-col gap-[10px]' })

      const reviewView = h(
        'div',
        { class: 'hidden flex-col gap-[20px]' },
        summary,
        reviewStatus,
        understanding,
        itemsArea,
        totalsTile,
        actionsRow,
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
       * pointing at the button that is on screen.
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
          /**
           * Back to the words to change them. Whatever was in flight for the
           * old words is abandoned here and now, so that nothing it returns
           * can land on the review the new words will produce.
           */
          session.cancel()
          clearWaitTimers()
          syncReviewBtn()
          field.input.focus({ preventScroll: true })
        }
      }

      /**
       * Read the description — from the field, or again from the summary.
       *
       * Both go through the session, which abandons any read in flight, and
       * both read the WHOLE sentence: an edit is never a patch on an old
       * split, and a reanalysis replaces the previous reading outright.
       */
      function review() {
        const input = text.trim()
        if (!input) return
        repaint(describeStatus)
        sentenceEl.textContent = input
        openRow = null
        asking = false
        askedAmount = false
        rowNodes.clear()
        setReviewNotice(null)
        startWait()
        if (stage !== 'review') showStage('review')
        session.read(input)
      }

      /** The model's wait, as the understanding panel tells it. */
      function startWait() {
        clearWaitTimers()
        understandingLabel.textContent = 'Understanding your meal…'
        repaint(understandingStop)
        if (!geminiUsable() || getAiMode() !== 'on' || !isOnline()) return
        waitTimers = [
          setTimeout(() => {
            understandingLabel.textContent = 'Still understanding your meal…'
            replay(understandingLabel, 'reading-swap')
          }, WAIT_LONG_MS),
          setTimeout(() => {
            repaint(
              understandingStop,
              h(
                'button',
                { class: 'chip-sm', onclick: () => stopModel?.() },
                'Stop waiting'
              )
            )
          }, WAIT_ESCAPE_MS),
        ]
      }

      /** Ask again, from the summary, with sending allowed or asked for. */
      function reanalyse() {
        if (!geminiUsable()) return
        if (aiUndecided()) {
          askConsent()
          return
        }
        review()
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
      function askConsent() {
        asking = true
        setReviewNotice(
          choiceNotice(
            'Gemini can read the description and pick the foods out of it, brands and all. Only the words you typed are sent, and this is remembered.',
            [
              {
                label: 'Use Gemini',
                onChoose: () => {
                  setAiMode('on')
                  modeLine.textContent = modeCopy()
                  toast('Describe will ask Gemini. Change this in Settings.')
                  review()
                },
              },
              {
                label: 'Keep it local',
                onChoose: () => {
                  setAiMode('off')
                  declined = true
                  asking = false
                  modeLine.textContent = modeCopy()
                  setReviewNotice(null)
                  paintActions()
                  toast('Describe stays on this phone. Change this in Settings.')
                },
              },
            ],
            { iconName: 'sparkle' }
          )
        )
      }

      function setReviewNotice(node) {
        repaint(reviewStatus, node)
        if (node) node.classList.add('panel-in')
      }

      const recordFor = (row) => (row.foodId ? foods.get(row.foodId) : row.draft) || null
      const stateOf = (row) => classifyItem(row)

      /* ----------------------------------------------------------- painting */

      let settingsBlockNames = ['Morning', 'Afternoon', 'Night']
      getSettings().then((s) => {
        settingsBlockNames = s.blockNames
        paintBlock()
      })

      function paintBlock() {
        repaint(
          blockRow,
          h('div', { class: 'section-label' }, 'Block'),
          blockSelector({
            value: block,
            onChange: (v) => (block = v),
            blockNames: settingsBlockNames,
          })
        )
      }
      paintBlock()

      /**
       * Everything on the review, from the session's state.
       *
       * Called on every change the session reports — the interpretation
       * landing, each lookup landing, a row removed — so the groups, the
       * total and the footer never disagree about what is still being
       * checked. The row nodes themselves are kept across paints, so a row
       * that moves from "Still checking" to "Ready to log" keeps its open
       * editor and its typed amount.
       */
      function paintState() {
        const { phase, notice: noticeText, source, error } = session.state
        const interpreting = phase === 'interpreting'

        for (const row of items()) {
          row.missing = Boolean(row.foodId) && foods.has(row.foodId) && foods.get(row.foodId) == null
        }

        understanding.classList.toggle('hidden', !interpreting)
        understanding.classList.toggle('flex', interpreting)
        if (!interpreting) clearWaitTimers()

        if (phase === 'failed') {
          setReviewNotice(
            notice('That could not be read. Edit the description, or add the foods the usual way.', {
              iconName: 'alert',
            })
          )
          console.warn('Describe: read failed', error)
        } else if (noticeText && !reviewStatus.firstChild) {
          setReviewNotice(
            notice(noticeText, {
              iconName: 'alert',
              action: geminiUsable() ? 'Reanalyse' : undefined,
              onAction: geminiUsable() ? () => reanalyse() : undefined,
            })
          )
        } else if (!noticeText && !asking) {
          setReviewNotice(null)
        }

        paintRows()
        syncTotals()
        paintActions()
        syncFooter()

        /**
         * Offer the model once, when the local read left something it could
         * not place and nobody has said yet whether words may leave. Never
         * while a read is still landing, and never again after "Keep it local".
         */
        if (phase === 'done' && source === 'local' && aiUndecided() && !declined && !asking && !noticeText) {
          const { attention } = groupRows(items())
          if (attention.some((row) => stateOf(row) !== 'needs-amount' && stateOf(row) !== 'missing')) {
            askConsent()
          }
        }
      }

      const rowNodes = new Map()

      const GROUP_LABEL = {
        pending: 'Still checking',
        attention: 'Needs attention',
        ready: 'Ready to log',
      }

      /**
       * The rows, grouped, with headings only when there is more than one
       * group to tell apart. Nodes are reused, so an open editor survives the
       * move between groups, and only rows that were not on screen before
       * get the arrival fade.
       */
      function paintRows() {
        const { phase } = session.state
        if (phase === 'interpreting' || phase === 'idle') {
          repaint(itemsArea)
          return
        }
        const groups = groupRows(items())
        const present = ['pending', 'attention', 'ready'].filter((g) => groups[g].length)

        if (!present.length) {
          repaint(
            itemsArea,
            h(
              'div',
              { class: 'card' },
              h(
                'div',
                { class: 'row text-[14px] text-muted' },
                phase === 'failed'
                  ? 'Nothing could be read. Edit the description to try again.'
                  : 'Nothing in that reads as a food. Edit the description to name what you ate.'
              )
            )
          )
          return
        }

        const seen = new Set()
        const cardFor = (rows) =>
          h(
            'div',
            { class: 'card' },
            rows.map((row) => {
              let node = rowNodes.get(row.id)
              if (!node) {
                node = rowNode(row)
                node.classList.add('row-in')
              } else {
                paintRowHead(row)
              }
              seen.add(row.id)
              return node
            })
          )

        repaint(
          itemsArea,
          present.map((g) =>
            present.length > 1
              ? h(
                  'div',
                  { class: 'flex flex-col gap-[10px]' },
                  h('div', { class: 'section-label' }, GROUP_LABEL[g]),
                  cardFor(groups[g])
                )
              : cardFor(groups[g])
          )
        )
        for (const id of [...rowNodes.keys()]) if (!seen.has(id)) rowNodes.delete(id)

        /**
         * The question is asked where it is needed. A food named without an
         * amount opens ready to be answered; if there are several, the first,
         * since one open editor is a question and three is a form. Only once
         * everything has landed, so the editor does not open under a list
         * that is still moving.
         */
        if (!groups.pending.length && !openRow && !askedAmount) {
          const first = items().find((row) => stateOf(row) === 'needs-amount')
          if (first) {
            askedAmount = true
            toggleRow(first.id, true)
          }
        }
      }

      /**
       * One row: a button that opens its editor beneath it.
       *
       * The row is the control. No pencil, no search glyph, no cross beside
       * every line — a chevron on the right says it opens, `aria-expanded`
       * says whether it has, and everything that can be done to the row is
       * inside it once it is open. While the row is being looked up the
       * chevron's slot holds the ring instead, so the wait is visibly the
       * row's own.
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
        pending: 'Finding a match…',
        'needs-amount': 'Needs an amount',
        unmatched: 'Not found yet',
        ambiguous: 'Needs confirming',
        missing: 'No longer in your library',
        estimated: 'Estimated',
      }

      function paintRowHead(row) {
        const node = rowNodes.get(row.id)
        if (!node) return
        const state = stateOf(row)
        const record = recordFor(row)
        const name = displayName(record?.name || row.name) || 'Deleted food'
        const status =
          state === 'unmatched' && row.failed ? 'Could not be checked' : STATE_SUB[state] || null
        const modifiers = row.modifiers?.length ? row.modifiers.join(', ') : null
        const sub = [state === 'pending' ? null : amountLabel(row, record), modifiers, status]
          .filter(Boolean)
          .join(' · ')
        const macros = state === 'missing' || state === 'pending' ? null : itemMacros(row, record)
        node.head.setAttribute(
          'aria-label',
          `${name}. ${sub || ''} ${state === 'pending' ? '' : 'Tap to change.'}`.replace(/\s+/g, ' ').trim()
        )
        repaint(
          node.head,
          foodRowBody({
            name,
            sub,
            totals: macros,
            badge: state === 'estimated' ? estimateBadge() : null,
            missing: state === 'missing',
          }),
          state === 'pending'
            ? spinner()
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
          const prevRow = items().find((r) => r.id === openRow)
          openRow = null
          if (prevRow) paintRowHead(prevRow)
        }
        const row = items().find((r) => r.id === id)
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

      /** The row changed under an open editor: the head, the total and the footer follow it. */
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
        const pickChip = h('button', { class: 'chip-sm', onclick: () => findFood(row) }, 'Pick a food')

        if (state === 'pending') {
          repaint(
            node.editor,
            h(
              'p',
              { class: 'text-[14px] leading-snug text-muted' },
              'Looking this up in your foods, the staples table and Open Food Facts.'
            ),
            h('div', { class: 'flex flex-wrap gap-[10px]' }, removeChip)
          )
          return
        }

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
            h('div', { class: 'flex flex-wrap gap-[10px]' }, doneChip, pickChip, removeChip)
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
            h('div', { class: 'flex flex-wrap gap-[10px]' }, doneChip, pickChip, removeChip)
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
            h('div', { class: 'flex flex-wrap gap-[10px]' }, pickChip, removeChip)
          )
          return
        }

        if (state === 'ambiguous') {
          /**
           * The local read would not split this on its own. The proposal is
           * named in full so what "Split" would do is visible before it is
           * done, and keeping it whole is the other honest answer: pick the
           * one food it is.
           */
          const pieces = (row.proposed || []).map((p) => displayName(p.name))
          repaint(
            node.editor,
            h(
              'p',
              { class: 'text-[14px] leading-snug text-muted' },
              `This could be one food or ${pieces.length}: ${pieces.join(', ')}. ` +
                'Pick the food it is, or split it and check each part.'
            ),
            h(
              'div',
              { class: 'flex flex-wrap gap-[10px]' },
              pickChip,
              h(
                'button',
                { class: 'chip-sm', onclick: () => session.split(row) },
                `Split into ${pluralize(pieces.length, 'item')}`
              ),
              removeChip
            )
          )
          return
        }

        // Unmatched: the words are editable, a search is one tap away, and the
        // lookup can be run again on the words as they now are.
        const words = textInput({
          value: row.text || row.name || '',
          placeholder: 'What was it?',
          onInput: (v) => {
            row.text = v
            row.name = v
            paintRowHead(row)
          },
        })
        repaint(
          node.editor,
          h(
            'p',
            { class: 'text-[14px] leading-snug text-muted' },
            row.failed
              ? 'The lookup did not finish. Try it again, pick a food, or remove it.'
              : 'Not in your foods, the staples table or Open Food Facts. Fix the words, pick a food, or remove it.'
          ),
          labelledField({ label: 'Words', children: words }),
          h(
            'div',
            { class: 'flex flex-wrap gap-[10px]' },
            h(
              'button',
              {
                class: 'chip-sm',
                onclick: () => {
                  toggleRow(row.id, false)
                  session.retry(row)
                },
              },
              'Try again'
            ),
            pickChip,
            removeChip
          )
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
            row.computed = null
            row.span = false
            row.ambiguous = false
            row.proposed = null
            row.failed = null
            row.missing = false
            row.fixed = true
            // A phrase never had an amount, so matching it leaves the row
            // asking for one rather than inventing a serving.
            if (row.quantity == null) row.unit = row.unit || 'serving'
            if (row.foodId && !foods.has(row.foodId)) foods.set(row.foodId, await getFood(row.foodId))
            paintState()
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
        if (openRow === row.id) openRow = null
        rowNodes.delete(row.id)
        const index = session.remove(row)
        if (index < 0) return
        const name = displayName(recordFor(row)?.name || row.name) || 'item'
        toast(`Removed ${name}`, {
          action: 'Undo',
          onAction: () => {
            if (logged) return
            session.restore(index, row)
          },
        })
      }

      /* -------------------------------------------------------------- totals */

      /**
       * The number the meal comes to, called what it is.
       *
       * Only rows that are matched or estimated count, and while any row is
       * still being checked or still needs a hand, the tile says "Confirmed
       * items subtotal" rather than presenting a running figure as the meal.
       * With nothing confirmed yet there is no number at all — a zero here
       * would read as a meal of nothing, which is never what is happening.
       */
      function syncTotals() {
        const { phase } = session.state
        const t = describeTotals(items(), (row) => itemMacros(row, recordFor(row)))
        const interpreting = phase === 'interpreting'

        if (interpreting || (t.confirmed === 0 && t.pending > 0)) {
          repaint(
            totalsTile,
            h(
              'div',
              { class: 'flex items-center gap-[10px] text-[14px] leading-snug text-muted' },
              spinner(true),
              interpreting ? 'Totals follow once the meal is understood.' : 'Totals follow as foods are matched.'
            )
          )
          return
        }

        if (t.confirmed === 0) {
          repaint(
            totalsTile,
            h('p', { class: 'text-[14px] leading-snug text-muted' }, 'No confirmed items yet.')
          )
          return
        }

        repaint(
          totalsTile,
          h(
            'div',
            { class: 'flex items-baseline justify-between gap-[10px] text-[12px] text-muted' },
            h('span', {}, t.partial ? 'Confirmed items subtotal' : 'Meal total'),
            t.estimates
              ? h(
                  'span',
                  { class: 'flex items-center' },
                  estimateBadge(),
                  `${t.estimates === 1 ? '1 estimate' : `${t.estimates} estimates`}`
                )
              : null
          ),
          h(
            'div',
            { class: 'flex items-baseline gap-[10px]' },
            h('span', { class: 'tnum text-title font-semibold leading-none' }, String(Math.round(t.totals.kcal))),
            macroUnit('kcal', 'text-[12px] font-medium')
          ),
          macroLine(t.totals, { size: 14, omit: ['kcal'] })
        )
      }

      /**
       * The second options, as chips under the total rather than in it.
       *
       * None of these is the next thing to do — that is the footer's — and
       * none commits what is not finished: every one of them waits for the
       * read to land. "Reanalyse description" is only offered where the
       * model may be, or may be asked to be, involved; without a key the
       * read is deterministic and asking again would give the same answer.
       */
      function paintActions() {
        const busy = session.busy() || session.state.phase === 'idle'
        const staged = items().filter((r) => !r.missing)
        const chips = []
        if (geminiUsable()) {
          chips.push(
            h(
              'button',
              { class: 'chip-sm', disabled: busy, onclick: () => reanalyse() },
              'Reanalyse description'
            )
          )
        }
        chips.push(
          h(
            'button',
            { class: 'chip-sm', disabled: busy || !staged.length, onclick: () => stageAddToPlate() },
            'Add to plate'
          ),
          h(
            'button',
            {
              class: 'chip-sm',
              disabled: busy || !staged.length,
              onclick: () => pushSaveAsMeal(ctx, staged.map(stripDraft)),
            },
            'Save as meal'
          )
        )
        repaint(actionsRow, chips)
      }

      /**
       * What stands between the rows and the log, said above the button that
       * is waiting on it. When nothing does, the line is empty and hides.
       */
      function syncFooter() {
        const { phase } = session.state
        const status = draftStatus(items())
        const busy = session.busy() || logged
        logBtn.disabled = busy || !status.canLog
        blockedLine.textContent =
          phase === 'interpreting' ? 'Understanding your meal…' : status.canLog ? '' : status.reason
      }

      /* -------------------------------------------------------------- commit */

      async function log() {
        if (logged || session.busy()) return
        const status = draftStatus(items())
        if (!status.canLog) return
        logged = true
        syncFooter()
        logBtn.textContent = 'Logging…'
        try {
          const entries = await logPlate({
            items: items().filter((r) => !r.missing).map(stripDraft),
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
      async function stageAddToPlate() {
        if (session.busy()) return
        const staged = items().filter((r) => !r.missing)
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
