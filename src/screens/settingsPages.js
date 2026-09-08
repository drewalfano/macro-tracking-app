import { h, repaint } from '../lib/dom.js'
import { icon } from '../lib/icons.js'
import { createScreen } from '../lib/screen.js'
import { openSheet } from '../lib/sheet.js'
import { toast, confirm } from '../lib/toast.js'
import {
  getSettings,
  saveSettings,
  exportAll,
  importAll,
  previewImport,
  clearAll,
  storageEstimate,
  listFoods,
} from '../lib/db.js'
import {
  backRow,
  card,
  listRow,
  segmentedWide,
  numberInput,
  textInput,
  labelledField,
  notice,
  rowChevron,
  switchRow,
} from '../lib/ui.js'
import { round, pluralize } from '../lib/format.js'
import { todayStr } from '../lib/dates.js'
import { navigate } from '../router.js'
import { getAiKey, setAiKey, clearAiKey, getAiMode, setAiMode } from '../lib/aiKey.js'
import { VERSION, BUILD_ID, REPO_URL } from '../config.js'
import { readViewport, formatViewport, readCaptures } from '../lib/viewportProbe.js'

/**
 * The four set-once corners of Settings, one tap in from the root.
 *
 * They share a file because they are one destination that was split by how
 * often anyone opens it, not four unrelated screens that happened to be
 * written together. Each is a lift of a section that used to sit in the root
 * scroll; the markup is moved rather than rewritten, so the diff that created
 * them is readable as the move it is.
 *
 * `suggestTarget.js` is the exception and has a file of its own, because it is
 * the only one of the five that computes anything.
 */

/**
 * The frame every pushed Settings screen wears: the way back, then the title.
 *
 * The back row names its destination rather than saying "Back". On a stack
 * exactly one deep the parent's name is the more useful of the two, and it is
 * the shape the food library already used before Settings had subpages.
 */
export function settingsPage(title, ...children) {
  return h(
    'div',
    { class: 'flex flex-col gap-[20px] pb-[20px]' },
    backRow({ label: 'Settings', onclick: () => navigate('settings') }),
    h('h1', { class: 'text-title font-semibold leading-tight' }, title),
    ...children
  )
}

/**
 * A labelled row whose control sits under the label. Stacked, not beside.
 *
 * `pref-row` buys the bottom padding four extra pixels — see the rule in
 * styles.css. The control below this label ends in ink exactly at its box edge
 * and the label below the next divider does not, so the two sides of a divider
 * need different numbers to look like the same gap.
 */
export function prefRow(label, control) {
  return h(
    'div',
    { class: 'row pref-row flex-col items-stretch gap-[10px]' },
    h('span', { class: 'text-[16px] font-semibold' }, label),
    control
  )
}

/* ----------------------------------------------------------- preferences */

function editBlocksSheet(settings) {
  return openSheet({
    title: 'Time blocks',
    render: (ctx) => {
      const names = [...settings.blockNames]
      const thresholds = { ...settings.blockThresholds }

      ctx.setFooter(
        h(
          'button',
          {
            class: 'btn-primary',
            onclick: async () => {
              await saveSettings({ blockNames: names, blockThresholds: thresholds })
              ctx.close()
              toast('Blocks updated')
            },
          },
          'Save'
        )
      )

      return h(
        'div',
        { class: 'flex flex-col gap-[20px] pb-[10px]' },
        h(
          'div',
          { class: 'flex flex-col gap-[10px]' },
          h('div', { class: 'section-label' }, 'Names'),
          ...names.map((name, i) => textInput({ value: name, onInput: (v) => (names[i] = v) }))
        ),
        h(
          'div',
          { class: 'flex flex-col gap-[10px]' },
          h('div', { class: 'section-label' }, 'When a new entry defaults to each block'),
          labelledField({
            label: `${names[1]} starts at`,
            children: numberInput({
              value: thresholds.afternoon,
              suffix: ':00',
              step: '1',
              onInput: (v) => (thresholds.afternoon = Number(v)),
            }),
          }),
          labelledField({
            label: `${names[2]} starts at`,
            children: numberInput({
              value: thresholds.night,
              suffix: ':00',
              step: '1',
              onInput: (v) => (thresholds.night = Number(v)),
            }),
          }),
          notice('These only set the prefill. You can always override the block when logging.')
        )
      )
    },
  })
}

export function preferencesScreen() {
  return createScreen(
    async ({ rerender }) => {
      const settings = await getSettings()

      return settingsPage(
        'Preferences',
        card(
          // One control for both heights and weights. It was two — this row
          // and a kg/lb row under it — while onboarding set both from this
          // one, so the same preference could be stated twice and the two
          // screens disagreed about which statement counted. `weightUnit`
          // now follows `units`; see `weightUnitFor`.
          prefRow(
            'Units',
            segmentedWide({
              options: [
                { value: 'metric', label: 'Metric' },
                { value: 'imperial', label: 'Imperial' },
              ],
              value: settings.units,
              onChange: (v) => saveSettings({ units: v }).then(rerender),
            })
          ),
          prefRow(
            'Theme',
            segmentedWide({
              options: [
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ],
              value: settings.theme,
              onChange: (v) => saveSettings({ theme: v }).then(rerender),
            })
          ),
          prefRow(
            'Trend window',
            segmentedWide({
              options: [
                { value: 7, label: '7 days' },
                { value: 14, label: '14 days' },
              ],
              value: settings.trendWindow,
              onChange: (v) => saveSettings({ trendWindow: v }).then(rerender),
            })
          ),
          listRow({
            title: 'Time blocks',
            subtitle: settings.blockNames.join(' · '),
            chevron: true,
            onclick: () => editBlocksSheet(settings).then(rerender),
          })
        )
      )
    },
    { watch: [], watchDate: false }
  )
}

/* ----------------------------------------------------------- ai describe */

export function aiDescribeScreen() {
  return createScreen(
    async () => {
      /**
       * The key field, and nothing that uses the key.
       *
       * It is a `.field` with a chip appended rather than a new shared input,
       * because `textInput` already spreads its extra props onto the element
       * and `type: 'password'` is the only thing that makes this field
       * different. One caller does not earn a component, and `ui.js` is the
       * app's whole visual vocabulary — a `secretInput` in there would be a
       * word the system does not otherwise speak.
       *
       * Show/Hide is a `chip-sm` for the same reason: it is the pattern this
       * screen already uses for a small inline action, and it costs the icon
       * set nothing. There is no eye glyph in `icons.js` and the file's own
       * header argues against the set growing.
       */
      let storedKey = getAiKey()
      let keyDraft = storedKey
      let keyShown = false

      const keyField = textInput({
        value: storedKey,
        type: 'password',
        placeholder: 'Paste your key',
        autocomplete: 'off',
        autocorrect: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        onInput: (v) => {
          keyDraft = v
          syncKey()
        },
      })

      const revealBtn = h(
        'button',
        {
          class: 'chip-sm shrink-0',
          onclick: () => {
            keyShown = !keyShown
            keyField.input.type = keyShown ? 'text' : 'password'
            revealBtn.textContent = keyShown ? 'Hide' : 'Show'
          },
        },
        'Show'
      )
      keyField.appendChild(revealBtn)

      const saveKeyBtn = h(
        'button',
        {
          class: 'btn-primary',
          disabled: true,
          onclick: () => {
            setAiKey(keyDraft)
            storedKey = getAiKey()
            keyDraft = storedKey
            keyField.input.value = storedKey
            syncKey()
            toast('Key saved')
          },
        },
        'Save'
      )

      // Clearing is reversible by pasting the key back, so it does not confirm
      // the way the Data screen's destructive rows do.
      const clearKeyBtn = h(
        'button',
        {
          class: 'chip-sm self-start',
          onclick: () => {
            clearAiKey()
            storedKey = ''
            keyDraft = ''
            keyField.input.value = ''
            keyShown = false
            keyField.input.type = 'password'
            revealBtn.textContent = 'Show'
            syncKey()
            toast('Key cleared')
          },
        },
        'Clear'
      )

      const clearKeySlot = h('div', { class: 'empty:hidden' })

      /**
       * The switch is what turns sending on. The key is not.
       *
       * It sits in a slot so it is only on screen when there is a key for it
       * to mean anything — a switch that can be flipped with nothing behind it
       * would be a promise the sheet cannot keep. Off is the default for every
       * key, including keys saved before the switch existed: a key was pasted
       * to make sending possible, and the switch is where it is made to happen.
       */
      const sendSlot = h('div', { class: 'empty:hidden' })
      const sendSwitch = () =>
        switchRow({
          label: 'Send unmatched foods to Gemini',
          hint: 'Only the words it could not place leave the phone.',
          checked: getAiMode() === 'on',
          onChange: (on) => {
            setAiMode(on ? 'on' : 'off')
            toast(on ? 'Describe will ask Gemini' : 'Describe stays on this phone')
          },
        })

      function syncKey() {
        const draft = keyDraft.trim()
        saveKeyBtn.disabled = !draft || draft === storedKey
        clearKeySlot.replaceChildren(...(storedKey ? [clearKeyBtn] : []))
        sendSlot.replaceChildren(...(storedKey ? [card(h('div', { class: 'p-[20px]' }, sendSwitch()))] : []))
      }
      syncKey()

      return settingsPage(
        'AI Describe',
        h(
          'div',
          { class: 'flex flex-col gap-[20px]' },
          h(
            'div',
            { class: 'flex flex-col gap-[10px]' },
            labelledField({
              label: 'API key',
              hint:
                'Optional. With a key, Describe can take "a Starbucks iced latte" or ' +
                '"a plate of homemade pasta with turkey meatballs".',
              children: keyField,
            }),
            saveKeyBtn,
            clearKeySlot
          ),
          card(
            listRow({
              title: 'Get a free key',
              subtitle: 'Google AI Studio',
              chevron: true,
              href: 'https://aistudio.google.com/apikey',
            })
          ),
          sendSlot,
          h(
            'p',
            { class: 'text-[12px] leading-snug text-muted' },
            'Only the words of foods it cannot place are sent. No date, targets or history. ' +
              'The key stays on this phone and is left out of backups.'
          )
        )
      )
    },
    { watch: [], watchDate: false }
  )
}

/* ------------------------------------------------------------------ data */

async function doExport() {
  const data = await exportAll()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = h('a', { href: url, download: `trackd-${todayStr()}.json` })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('Export downloaded')
}

function doImport() {
  const input = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'hidden',
    onchange: async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      let data
      try {
        data = JSON.parse(await file.text())
      } catch {
        toast('That file is not valid JSON.')
        return
      }
      openImportSheet(data)
    },
  })
  document.body.appendChild(input)
  input.click()
  setTimeout(() => input.remove(), 60000)
}

function openImportSheet(data) {
  return openSheet({
    title: 'Import data',
    render: (ctx) => {
      let mode = 'merge'
      const body = h('div', { class: 'flex flex-col gap-[20px]' })

      async function paint() {
        let preview
        try {
          preview = await previewImport(data, mode)
        } catch (err) {
          body.replaceChildren(notice(err.message, { iconName: 'alert' }))
          return
        }
        const { counts, duplicates, settings } = preview
        const collapsed = Object.values(duplicates).reduce((n, d) => n + d, 0)

        const rows = Object.entries(counts).map(([store, c]) =>
          h(
            'div',
            { class: 'row' },
            h('div', { class: 'flex-1 text-[14px] font-semibold capitalize' }, store),
            h(
              'div',
              { class: 'text-right text-[12px] leading-tight text-muted' },
              h('div', {}, `${c.existing} → ${c.after}`),
              h(
                'div',
                {},
                mode === 'replace'
                  ? `${c.incoming} imported, ${c.removed} replaced`
                  : `${c.added} new, ${c.overwritten} updated`
              )
            )
          )
        )

        /**
         * Settings are a row of their own, because they are the one thing the
         * two modes treat differently and the notice above only says so in
         * prose. On a replace the row says what happens to them; on a merge it
         * is left off, since nothing happens.
         */
        if (mode === 'replace') {
          rows.push(
            h(
              'div',
              { class: 'row' },
              h('div', { class: 'flex-1 text-[14px] font-semibold' }, 'Settings'),
              h(
                'div',
                { class: 'text-right text-[12px] leading-tight text-muted' },
                settings.applied ? 'replaced from the file' : 'not in the file, kept as they are'
              )
            )
          )
        }

        // Same null-child trap: an export taken before `exportedAt` existed
        // would otherwise put the word "null" under the preview.
        repaint(
          body,
          segmentedWide({
            options: [
              { value: 'merge', label: 'Merge' },
              { value: 'replace', label: 'Replace' },
            ],
            value: mode,
            onChange: (v) => {
              mode = v
              paint()
            },
          }),
          notice(
            mode === 'merge'
              ? 'Anything with a matching id is updated, everything else is added. Your settings are left alone.'
              : 'Everything currently on this device is deleted first, including settings and targets.',
            { iconName: mode === 'replace' ? 'alert' : 'info' }
          ),
          card(rows),
          // Two rows with one id are one row once written, and the count above
          // already says so. This says why it is smaller than the file.
          collapsed
            ? h(
                'p',
                { class: 'px-0 text-[12px] text-muted' },
                `${pluralize(collapsed, 'row')} in the file ${collapsed === 1 ? 'repeats' : 'repeat'} ` +
                  'an earlier one and will be counted once, keeping the later copy.'
              )
            : null,
          data.exportedAt
            ? h(
                'p',
                { class: 'px-0 text-[12px] text-muted' },
                `Exported ${new Date(data.exportedAt).toLocaleString()}`
              )
            : null
        )
      }

      ctx.setFooter(
        h(
          'button',
          {
            class: 'btn-primary',
            onclick: async () => {
              if (mode === 'replace') {
                const ok = await confirm({
                  title: 'Replace everything?',
                  message: 'All data on this device is deleted and rebuilt from the file.',
                  confirmLabel: 'Replace',
                })
                if (!ok) return
              }
              try {
                await importAll(data, mode)
                ctx.close()
                toast('Import complete')
              } catch (err) {
                toast(err.message || 'Import failed')
              }
            },
          },
          'Import'
        )
      )

      paint()
      return h('div', { class: 'pb-[10px]' }, body)
    },
  })
}

export function dataScreen() {
  return createScreen(
    async ({ rerender }) => {
      // Dev only, and compiled out with the row that reads it.
      const sampleLoaded =
        import.meta.env.DEV &&
        (await listFoods()).some((f) => String(f.id).startsWith('sample-'))

      return settingsPage(
        'Data',
        card(
          listRow({
            title: 'Export data',
            subtitle: 'One JSON file with everything',
            leading: icon('download', { size: 19, class: 'text-muted' }),
            onclick: doExport,
          }),
          listRow({
            title: 'Import data',
            subtitle: 'Merge or replace, with a preview first',
            leading: icon('upload', { size: 19, class: 'text-muted' }),
            onclick: doImport,
          }),
          listRow({
            title: 'Clear all data',
            subtitle: 'Cannot be undone',
            leading: icon('trash', { size: 19, class: 'text-muted' }),
            onclick: async () => {
              const ok = await confirm({
                title: 'Delete everything?',
                message:
                  'Every food, entry, meal and weigh-in on this device is removed. ' +
                  'Export first if you want a copy.',
                confirmLabel: 'Delete everything',
                requireText: 'DELETE',
              })
              if (ok) {
                await clearAll()
                toast('All data cleared')
                rerender()
              }
            },
          }),
          /**
           * Dev only. `import.meta.env.DEV` is a literal at build time, so
           * the installed app gets `false && …` and the bundler drops both
           * this row and the module behind it — the filler cannot ship.
           *
           * It lives under Data rather than in a console command because the
           * person who needs it is looking at the design, not at a terminal.
           */
          import.meta.env.DEV
            ? listRow({
                title: sampleLoaded ? 'Remove sample favourites' : 'Load sample favourites',
                subtitle: sampleLoaded
                  ? 'Takes back exactly what it added'
                  : 'Six foods, pinned, for looking at the rail',
                leading: icon('star', { size: 19, class: 'text-muted' }),
                onclick: async () => {
                  const { loadSampleFoods, clearSampleFoods } = await import(
                    '../lib/sampleData.js'
                  )
                  const n = sampleLoaded ? await clearSampleFoods() : await loadSampleFoods()
                  toast(sampleLoaded ? `Removed ${n} sample foods` : `Added ${n} sample foods`)
                  rerender()
                },
              })
            : null
        ),
        h(
          'p',
          { class: 'px-0 text-[12px] leading-snug text-muted' },
          'Export is the only backup. Clearing this browser’s site data deletes everything ' +
            'here, and nothing is stored anywhere else.'
        )
      )
    },
    { watch: ['foods'], watchDate: false }
  )
}

/* ----------------------------------------------------------------- about */

export function aboutScreen() {
  return createScreen(
    async () => {
      const estimate = await storageEstimate()

      return settingsPage(
        'About',
        card(
          listRow({
            title: 'Version',
            right: h('span', { class: 'text-[12px] text-muted' }, VERSION),
          }),
          estimate?.usage != null
            ? listRow({
                title: 'Storage used',
                right: h(
                  'span',
                  { class: 'text-[12px] text-muted' },
                  `${round(estimate.usage / 1024, 0)} KB`
                ),
              })
            : null,
          listRow({
            title: 'Build',
            right: h('span', { class: 'text-[12px] text-muted' }, BUILD_ID),
          }),
          listRow({
            title: 'Viewport',
            subtitle: 'What the screen measures on this device',
            chevron: true,
            onclick: () => navigate('settings/viewport'),
          }),
          h(
            'a',
            { class: 'row', href: REPO_URL, target: '_blank', rel: 'noreferrer noopener' },
            h('span', { class: 'flex-1 text-[16px] font-semibold' }, 'Source code'),
            rowChevron()
          )
        ),

        /**
         * Where the food data comes from.
         *
         * Neither source requires this. Open Food Facts is ODbL and the
         * obligation attaches to redistributing the database, which the app
         * does not do — it copies a product into your library when you log
         * it. USDA FoodData Central is a work of the US federal government
         * and is in the public domain outright.
         *
         * It is here anyway, because both are volunteer or public efforts the
         * app leans on entirely for the half of its data it did not author,
         * and saying so costs two lines.
         */
        h(
          'p',
          { class: 'px-0 text-[12px] leading-snug text-muted' },
          'Barcode and product data from Open Food Facts. Common foods from USDA ' +
            'FoodData Central.'
        )
      )
    },
    { watch: [], watchDate: false }
  )
}

/* -------------------------------------------------------------- viewport */

/**
 * The numbers behind the bottom-of-the-screen bug, read on the device that has
 * it.
 *
 * This is a debugging instrument in the shipped app, which wants a reason. The
 * bug only exists on the installed iOS PWA — a Safari tab does not have it, the
 * desktop dev view does not have it, and there is no simulator on the machine
 * this is written on. Two fixes were reasoned out from screenshots and shipped,
 * and both missed, because a screenshot shows that the tab bar is high and
 * cannot show which of four viewport heights it is high against. One screen of
 * measured numbers costs less than a third guess.
 *
 * A SCREEN and not a sheet, deliberately. Opening a sheet pins `<body>`, which
 * is one of the two states being measured — the instrument would change the
 * thing it is reading.
 *
 * `watch: []` so nothing in the database can rebuild this out from under a
 * reading, and the values are repainted in place rather than by `rerender` for
 * the same reason.
 */
export function viewportScreen() {
  return createScreen(
    async () => {
      const rows = h('div', { class: 'card' })
      const stamp = h('p', { class: 'px-0 text-[12px] leading-snug text-muted' })
      const captured = h('div', { class: 'flex flex-col gap-[20px]' })

      /**
       * The rows that decide it, for a reading taken on some other screen. A
       * subset rather than a count — the count drifted the first time a row was
       * added — and the rest are the working behind these.
       *
       * The bar asks for 20px off the bottom of the screen, so
       * `gapBelowBarFromScreen` should read 20 and `100dvh` should equal
       * `screen.height`. The last three are the newer question: where the PAGE
       * stops. `gapRestLineToBandTop` should read 0 — the resting line and the
       * band's top edge are the same edge by construction — and both gaps only
       * describe the resting state while `scrollLeftToGo` reads 0.
       *
       * Copy still exports every field of all three readings.
       */
      const KEYS = [
        'route',
        'screen.height',
        'innerHeight',
        'documentElement.clientHeight',
        '--screen-h',
        '100dvh',
        'scrollable',
        'body pinned',
        'tabbar.bottom',
        'gapBelowBarFromScreen',
        'panel.bottom',
        'gapBelowPanel',
        'gapRestLineToBandTop',
        'gapRestLineToBarTop',
        'scrollLeftToGo',
      ]

      const capturedBlock = (title, reading) =>
        h(
          'div',
          { class: 'flex flex-col gap-[10px]' },
          h('div', { class: 'section-label' }, title),
          reading
            ? card(
                ...KEYS.map((key) =>
                  listRow({
                    title: key,
                    right: h(
                      'span',
                      {
                        class: `text-[12px] ${
                          key.startsWith('gap') ? 'font-semibold' : 'text-muted'
                        }`,
                      },
                      String(reading[key] ?? '—')
                    ),
                  })
                )
              )
            : notice('Nothing captured yet. Visit the screen, then come back here.')
        )

      /**
       * Repainted in place, because the interesting readings are the ones taken
       * while something is moving — a rebuild would drop the row that is being
       * read.
       *
       * The two gap rows are the answer this page exists for, so they are marked
       * rather than left for the eye to find: the tab bar asks for 20px off the
       * bottom of whatever it is anchored to, and if it gets 20 from
       * `innerHeight` and something else from `screen.height`, then the bar is
       * where the CSS put it and the anchor is what is wrong.
       */
      const paint = () => {
        const reading = readViewport()
        rows.replaceChildren(
          ...Object.entries(reading).map(([key, value]) =>
            listRow({
              title: key,
              right: h(
                'span',
                {
                  class: `text-[12px] ${
                    key.startsWith('gap') ? 'font-semibold' : 'text-muted'
                  }`,
                },
                String(value)
              ),
            })
          )
        )
      }

      const paintCaptures = () => {
        const { short, sheet } = readCaptures()
        captured.replaceChildren(
          capturedBlock('Last screen too short to scroll', short),
          capturedBlock('Last sheet open', sheet)
        )
      }

      paint()
      paintCaptures()

      /**
       * The states worth catching are the ones that arrive without a tap:
       * coming back to a backgrounded PWA, the keyboard changing the viewport,
       * and a scroll ending. Same three events `releaseOrphanedLock` watches, on
       * the same reasoning — they bracket where the failure gets noticed.
       */
      const el = settingsPage(
        'Viewport',
        captured,
        h('div', { class: 'section-label' }, 'Now, on this screen'),
        rows,
        h(
          'button',
          {
            class: 'btn-secondary',
            onclick: () => {
              paint()
              paintCaptures()
              const { short, sheet } = readCaptures()
              const text = [
                ['NOW (this screen scrolls, so it always looks fine)', readViewport()],
                ['SHORT SCREEN', short],
                ['SHEET OPEN', sheet],
              ]
                .map(
                  ([label, reading]) =>
                    `== ${label}\n${reading ? formatViewport(reading) : '(nothing captured)'}`
                )
                .join('\n\n')
              navigator.clipboard
                ?.writeText(text)
                .then(() => toast('Copied. Paste it into the chat.'))
                .catch(() => toast('Could not copy. Screenshot it instead.'))
            },
          },
          'Copy readings'
        ),
        stamp
      )

      stamp.textContent =
        'This screen always scrolls, so the two rows above it are the ones that matter. ' +
        'They are recorded on the screens that do not.'

      const onEvent = () => {
        paint()
        paintCaptures()
      }
      window.addEventListener('resize', onEvent)
      window.addEventListener('scroll', onEvent, { passive: true })
      window.visualViewport?.addEventListener('resize', onEvent)
      window.visualViewport?.addEventListener('scroll', onEvent)
      document.addEventListener('visibilitychange', onEvent)

      /**
       * Nothing here removes those listeners, and that is a leak with a bound:
       * `createScreen` builds this once per visit to the page, the handler only
       * reads and repaints detached nodes after the screen is gone, and the page
       * comes out with the fix. A `destroy` hook on `createScreen` would be the
       * right home for it and is not worth adding for an instrument.
       */
      return el
    },
    { watch: [], watchDate: false }
  )
}
