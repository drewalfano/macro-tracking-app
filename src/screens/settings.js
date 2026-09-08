import { h, repaint } from '../lib/dom.js'
import { createScreen } from '../lib/screen.js'
import { getSettings, saveSettings, listFoods, listWeights } from '../lib/db.js'
import { kcalFromMacros } from '../lib/compute.js'
import { belowFloor, canCalculate, computeTargets } from '../lib/targets.js'
import {
  card,
  listRow,
  valueRow,
  numberInput,
  notice,
  macroTextColor,
  pageHeader,
} from '../lib/ui.js'
import { pluralize } from '../lib/format.js'
import { navigate } from '../router.js'
import { getAiKey } from '../lib/aiKey.js'
import { VERSION } from '../config.js'
import { openOnboardingOverlay } from './onboarding.js'

/** Flip to `true` to show the Preview onboarding row at the bottom of Settings. */
const PREVIEW_ONBOARDING = false

/**
 * Settings root: the targets, and a door onto everything else.
 *
 * The split is by frequency of use rather than by category. Targets are the
 * reason this screen gets opened, so they stay here and stay editable in
 * place. Everything else is set once and then left — units, a key, an export,
 * the body stats that feed the suggestion — and one tap is the right price for
 * a thing you touch twice a year.
 *
 * The subpages are hash routes under `settings/`, which is not cosmetic:
 * `syncTabs` in main.js reads `path.split('/')[0]`, so nesting them here keeps
 * the Settings tab lit without the special case `foods` needs.
 */

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1)

export function settingsScreen() {
  return createScreen(
    async ({ rerender }) => {
      const settings = await getSettings()
      const [foods, weights] = await Promise.all([listFoods(), listWeights()])

      /* --------------------------------------------------------- targets */

      const targets = { ...settings.targets }
      let kcalOverridden = true
      let saveTimer = null

      const kcalField = numberInput({
        value: targets.kcal,
        suffix: 'cal',
        suffixMacro: 'kcal',
        bare: true,
        onInput: (v) => {
          targets.kcal = Number(v) || 0
          kcalOverridden = true
          syncFloorHint()
          queueSave()
        },
      })

      const derivedHint = h('div', { class: 'px-0 text-[12px] text-muted' })

      /**
       * Said once, under the card, and never again. A target below the floor
       * is accepted — this is the user's tool and they may have a reason — but
       * it should not pass without the app having mentioned it.
       *
       * `empty:hidden` because it usually is: an empty flex child still spends
       * a full 10px gap under the card it is not saying anything about.
       */
      const floorHint = h('div', { class: 'empty:hidden' })
      const syncFloorHint = () => {
        const floor = belowFloor(targets.kcal, settings.profile.sex)
        repaint(
          floorHint,
          floor
            ? notice(
                `That is below ${floor} cal, which is the point where this is worth talking ` +
                  'to someone about rather than typing into an app. Saved either way.',
                { iconName: 'alert' }
              )
            : null
        )
      }

      const syncDerived = () => {
        const derived = kcalFromMacros(targets)
        if (!kcalOverridden) {
          targets.kcal = Math.round(derived)
          kcalField.input.value = targets.kcal
        }

        /**
         * The chip appears only when pressing it would change the number.
         *
         * **Its condition used to be `kcalOverridden` alone, which is set to
         * `true` on every load and never consulted the calorie target at all.**
         * So a target of 2368 with macros working out to 2368 still carried a
         * button offering to write 2368 over 2368: a control whose entire
         * effect was to confirm that nothing needed doing.
         *
         * The test is the outcome rather than a tolerance. `Use that` writes
         * `Math.round(derived)`, so rounding both sides and comparing asks
         * exactly the question the button is for — would this change the stored
         * value — and absorbs sub-1-cal float noise on the way past, since
         * 2367.9999 and 2368 both round to 2368.
         *
         * Deliberately not a wider band. At ±10 the chip would hide while
         * still having an effect, and someone whose macros say 2363 against a
         * 2368 target would have no way left to reconcile them. A control that
         * is hidden while it still does something is the worse bug.
         *
         * Zero is the same reasoning from the other end: with the macro fields
         * empty the sentence reads `0 cal`, and offering to make that the
         * calorie target is a no-op that happens to be destructive. `quickAdd`
         * has always guarded this and this screen never did.
         */
        const rounded = Math.round(derived)
        const wouldChange = rounded > 0 && rounded !== Math.round(targets.kcal)

        derivedHint.replaceChildren(
          h(
            'div',
            /* The chip sits beside the sentence rather than under it: it is the
               answer to that sentence, and stacking spent a whole line saying
               so. It holds the right edge — the same edge the card above and
               the rows inside it end on — so the sentence takes the slack and
               wraps into it rather than the chip drifting with the text. */
            { class: 'flex items-center gap-[10px]' },
            h(
              'span',
              { class: 'min-w-0 flex-1' },
              `Protein, fat and carbs work out to ${rounded} cal.`,
              kcalOverridden ? '' : ' Calories now follow the macros.'
            ),
            /**
             * Nothing takes the chip's place when the two figures agree, and
             * the sentence is not rewritten to announce it.
             *
             * The confirmation is already on screen: this line states the
             * derived total and the Calories field two rows above states the
             * target, and they are the same number. A clause saying "which
             * matches your target" narrates something the reader can see, and
             * it is not free — every version of that sentence wraps to a second
             * line and grows this row by another 6px.
             *
             * **`invisible` rather than not building it, and that is the whole
             * no-shift mechanism.** A `min-height` was tried first and was only
             * right at one screen width. The chip takes 86.6px out of the line,
             * so at 375pt the sentence beside it wraps to two lines and without
             * it fits on one: dropping the element changed the row from 36 to
             * 30 and moved everything below by 6px, at 390pt it happened to fit
             * either way, and a fix that holds at one width and not the next is
             * not a fix. Reserving the box keeps the wrap identical in both
             * states, so the two layouts are the same layout rather than two
             * layouts that agree at one size.
             *
             * `visibility: hidden` and not `opacity: 0` or `disabled`: it is out
             * of the tab order and out of the accessibility tree, so nothing
             * reads or reaches a button that is not offering anything. A
             * disabled chip would still say there is an action here you may not
             * take, when the truth is there is no action at all.
             */
            h(
              'button',
              {
                /**
                 * `self-end`, so the group has ONE bottom edge.
                 *
                 * The chip is 30 and the sentence beside it wraps to two 18px
                 * lines, so centred it floated 3px clear of the text's own
                 * bottom — which put the 20 under the last line of type and 23
                 * under the chip. The section gap was right the whole time;
                 * what was ragged was this row's lower edge.
                 *
                 * It costs nothing when the sentence fits on one line: the chip
                 * is the taller of the two then, so the row is its height and
                 * bottom-aligning it changes nothing. The text stays centred
                 * either way — it is `flex-1` and fills the row, so
                 * `items-center` above still governs it.
                 */
                class: `chip-sm self-end${kcalOverridden && wouldChange ? '' : ' invisible'}`,
                onclick: () => {
                  kcalOverridden = false
                  syncDerived()
                  queueSave()
                },
              },
              'Use that'
            )
          )
        )
      }

      /**
       * Any hand edit flips the source to manual. Typed numbers win over
       * calculated ones permanently, rather than until the next time the
       * profile changes and something quietly recomputes over the top.
       *
       * The historical-days rule lives in `saveSettings`, not here: today gets
       * re-stamped, days already logged keep what they were logged against.
       */
      function queueSave() {
        clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          saveSettings({ targets, targetsSource: 'manual' })
        }, 400)
      }

      /**
       * The macro's name carries its colour and the number stays in ink, which
       * is the split Today already uses on `macroRow` and `caloriesBlock`. These
       * four rows ARE those four numbers, so they should be findable the same
       * way — you look for the gold one, not for the word "Fat".
       */
      const macroTargetRow = (key, label) =>
        valueRow(
          label,
          numberInput({
            value: targets[key],
            suffix: 'g',
            bare: true,
            onInput: (v) => {
              targets[key] = Number(v) || 0
              syncDerived()
              queueSave()
            },
          }),
          { color: macroTextColor(key) }
        )

      syncDerived()
      syncFloorHint()

      /* ------------------------------------------------------ the doors */

      // Enough of the suggestion to say whether there is one, without opening
      // the screen that works it out.
      const suggestion = canCalculate(settings.profile, weights.at(-1)?.kg ?? null)
        ? `${computeTargets(settings.profile, { weightKg: weights.at(-1).kg }).kcal} cal from your profile`
        : 'Needs a few body stats'

      return h(
        'div',
        {},
        /**
         * The same call Trends makes, with a different string in it.
         *
         * This screen used to hand-roll its own: a bare `h1` in a wrapper with a
         * `pt-[10px]`, which is how the title ended up 4.25px below Today's
         * baseline and left-aligned while the other two were centred. There is
         * no argument for a third arrangement and there never was one written
         * down — it is just that the shared header component only ever covered
         * the two tabs that had chevrons, and this one was built without it.
         */
        pageHeader('Settings'),

        h(
          'div',
          /**
           * 20, not the 30 this column carried.
           *
           * Today and Trends both space their sections at 20 and this was the one
           * screen at 30, which made Settings scroll to a different rhythm than
           * the two tabs either side of it. `ui.js` states the grid at the top —
           * 10 inside a group, 20 between groups — and three cards under three
           * headings is the same shape of thing on all three screens.
           */
          { class: 'flex flex-col gap-[20px] pb-[20px]' },

          h(
            'section',
            { class: 'flex flex-col gap-[10px]' },
            h('div', { class: 'section-title' }, 'Targets'),
            h(
              'p',
              { class: 'px-0 text-[12px] leading-snug text-muted' },
              settings.targetsSource === 'calculated'
                ? 'Worked out from your profile. Editing anything here makes them yours instead.'
                : 'Set by hand. Nothing recalculates these unless you ask.'
            ),
            card(
              valueRow('Calories', kcalField, { color: macroTextColor('kcal') }),
              macroTargetRow('protein', 'Protein'),
              macroTargetRow('fat', 'Fat'),
              macroTargetRow('carbs', 'Carbs')
            ),
            // Both of these describe the four numbers above rather than any one of
            // them, so they sit under the card instead of between the rows.
            floorHint,
            derivedHint
          ),

          h(
            'section',
            {},
            card(
              listRow({
                // Named for what is inside it, not for what it produces — the
                // subtitle is already carrying the output.
                title: 'About you',
                subtitle: suggestion,
                chevron: true,
                onclick: () => navigate('settings/target'),
              }),
              listRow({
                title: 'Foods',
                subtitle: pluralize(foods.length, 'food'),
                chevron: true,
                onclick: () => navigate('foods'),
              }),
              listRow({
                title: 'Preferences',
                subtitle: `${capitalise(settings.units)} · ${capitalise(settings.theme)}`,
                chevron: true,
                onclick: () => navigate('settings/preferences'),
              }),
              listRow({
                title: 'AI Describe',
                subtitle: getAiKey() ? 'Key saved' : 'No key',
                chevron: true,
                onclick: () => navigate('settings/ai'),
              }),
              listRow({
                title: 'Data',
                chevron: true,
                onclick: () => navigate('settings/data'),
              }),
              listRow({
                title: 'About',
                right: h('span', { class: 'text-[12px] text-muted' }, VERSION),
                chevron: true,
                onclick: () => navigate('settings/about'),
              })
            )
          ),

          /* ---------------------------------------------------------------- *
           * Preview onboarding, behind `PREVIEW_ONBOARDING` at the top of this
           * file. Off by default, everywhere: it is scaffolding for reviewing
           * the first-run flow, not a feature. Set the constant to `true` for a
           * round of testing and back to `false` after.
           *
           * Kept at the root and in a card of its own rather than tucked into
           * About, so it is one contiguous block.
           *
           * Runs as a preview: blank draft, nothing written unless the last step
           * is taken deliberately, so walking through it cannot cost someone the
           * profile they already have.
           * ---------------------------------------------------------------- */
          PREVIEW_ONBOARDING &&
            h(
              'section',
              {},
              card(
                listRow({
                  title: 'Preview onboarding',
                  subtitle: 'The first-run flow, full screen, as a new person sees it',
                  chevron: true,
                  onclick: () => openOnboardingOverlay({ preview: true }).then(rerender),
                })
              )
            )
        )
      )
    },
    { watch: [], watchDate: false }
  )
}
