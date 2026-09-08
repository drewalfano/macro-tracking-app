import './styles.css'

import { h, mount, clear, pressDelegate } from './lib/dom.js'
import { icon } from './lib/icons.js'
import { checkStorage, getSettings, saveSettings, onChange, firstLoggedDate } from './lib/db.js'
import { isIOS, isStandalone } from './lib/platform.js'
import { toast } from './lib/toast.js'
import { closeAnySheet } from './lib/sheet.js'
import { fadeLayers, FADE_RAMP } from './lib/fade.js'
import { captureViewportState } from './lib/viewportProbe.js'
import { setThemeIsDark } from './lib/statusBar.js'
import { route, startRouter, navigate, currentPath } from './router.js'
import { rollOverIfNeeded, setDate } from './state.js'
import { todayStr } from './lib/dates.js'

import { todayScreen } from './screens/today.js'
import { openLogSheet } from './sheets/log.js'
import { trendsScreen } from './screens/trends.js'
import { settingsScreen } from './screens/settings.js'
import { suggestTargetScreen } from './screens/suggestTarget.js'
import {
  preferencesScreen,
  aiDescribeScreen,
  dataScreen,
  aboutScreen,
  viewportScreen,
} from './screens/settingsPages.js'
import { foodsScreen, foodDetailScreen } from './screens/foods.js'
import { createOnboarding } from './screens/onboarding.js'
import { openAddFood } from './sheets/addFood.js'

const app = document.getElementById('app')

/* ------------------------------------------------------------------ theme */

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('mt:theme', theme)
  } catch {
    /* storage may be locked down; the default still works */
  }
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  /* The two media-scoped tags from index.html both match once a theme is forced
     against the system; drop them and let statusBar own the single live tag. */
  for (const meta of document.querySelectorAll('meta[name="theme-color"][media]')) meta.remove()
  setThemeIsDark(dark)
}

/* --------------------------------------------------------------- app shell */

const view = h('main', { class: 'screen', id: 'view' })

let currentScreen = null

let showToken = 0

/**
 * Must match `view-in`'s duration in styles.css. The attribute that drives it is
 * cleared just after it lands — see `show` for why leaving it on is not
 * cosmetic.
 */
const VIEW_IN_MS = 200
let enteringTimer = null

/**
 * Swap screens only once the new one has actually rendered.
 *
 * A screen's first render is async — it reads IndexedDB — so mounting it as
 * soon as it is constructed puts an empty div on screen until the read
 * resolves. On a phone that is a visible white flash on every tap. The outgoing
 * screen stays put until the incoming one has content.
 */
async function show(factory) {
  const token = ++showToken
  const next = factory()
  await next.ready
  // A faster tap already started another navigation; this one is stale.
  if (token !== showToken) {
    next.destroy()
    return
  }
  currentScreen?.destroy()
  currentScreen = next
  /**
   * Mark the arrival, since the swap itself had nothing to say it happened.
   *
   * Holding the outgoing screen through the read above is right and is why
   * there is no white flash — but it left the sequence reading as tap, a pause
   * of unpredictable length, then a pop, which is what a page load looks like.
   *
   * Cleared and re-set with a reflow between, the same idiom `syncTabs` uses on
   * the pill below: re-applying an attribute a node already carries does not
   * restart an animation, so the second navigation would be silent. Set BEFORE
   * `mount` so the first painted frame is the new tree at its starting opacity
   * rather than at full strength.
   */
  delete view.dataset.entering
  void view.offsetWidth
  view.dataset.entering = 'true'
  mount(view, next.el)
  window.scrollTo(0, 0)
  /**
   * **Taken off again, and leaving it on was a real bug.**
   *
   * The rule this drives matches `#view[data-entering] > * > * > *`, which is
   * the screen's content rather than `#view` itself — so while the attribute
   * stayed, EVERY later subtree replacement re-triggered it. `createScreen`
   * rebuilds on any data change, so logging a food faded Today's whole column,
   * and so did changing day, and so did anything else on any screen. A screen
   * arrival animation was playing on things that had not arrived.
   *
   * It only survived review because the reflow above restarts the animation
   * correctly for real navigations, so the case it was tested against looked
   * right.
   */
  clearTimeout(enteringTimer)
  enteringTimer = setTimeout(() => {
    delete view.dataset.entering
  }, VIEW_IN_MS + 40)
}

/**
 * `Trends`, not `Weight`. Every other tab names a job — what you are doing —
 * and Weight named a data type. It also stopped being true: the tab now holds
 * nutrition history alongside the weight chart, and neither is the whole of it.
 */
const TABS = [
  { path: 'today', label: 'Today', iconName: 'calendarFilled' },
  { path: 'trends', label: 'Trends', iconName: 'chartFilled' },
  { path: 'settings', label: 'Settings', iconName: 'gearFilled' },
]

/**
 * Progressive blur and gradient scrims behind the floating bar.
 *
 * Content scrolls underneath rather than stopping at it, so without this the
 * bar sits on top of live text and both become hard to read.
 * Purely decorative, so it is hidden from assistive tech and ignores pointers.
 */
function tabBarFade() {
  // One scrim, not two. The black shade that used to sit on top of the veil is
  // gone — see `.fade-veil` in styles.css for why. The ramp itself lives in
  // lib/fade.js now, shared with the sheet footer.
  return h(
    'div',
    { class: 'tabbar-fade', 'aria-hidden': 'true' },
    fadeLayers(FADE_RAMP),
    h('span', { class: 'fade-veil' })
  )
}

/**
 * The add button sits outside the pill, to its RIGHT, and is always available.
 * Both float clear of the bottom edge with content scrolling behind them.
 *
 * Right rather than left: it is the app's primary action and the only control
 * on this bar that is not navigation, so it belongs under the thumb rather than
 * across the hand. The tabs are destinations and can afford the longer reach.
 */
function tabBar() {
  /**
   * The Today tab means today.
   *
   * The date is shared across Today and Log on purpose — stepping back on one
   * and opening the other keeps your place, which is right for that pair. But
   * History also sets it, so tapping a row there and then reaching for the tab
   * left you on a past day, on a tab labelled Today, with only the forward
   * chevron to walk back one day at a time.
   *
   * Tapping the tab is the "go home" gesture rather than part of that pairing,
   * so it resets the day. Everything else about the shared date is unchanged.
   */
  // Purely decorative — the aria-current on each tab is what announces the
  // selection, so this is hidden from assistive tech rather than doubled up.
  const tabPill = h('span', { class: 'tab-pill', 'aria-hidden': 'true' })

  const tabButtons = TABS.map((tab) =>
    h(
      'button',
      {
        class: 'tab',
        'data-tab': tab.path,
        onclick: () => {
          if (tab.path === 'today') setDate(todayStr())
          navigate(tab.path)
        },
      },
      icon(tab.iconName, { size: 22 }),
      h('span', { class: 'text-[12px] font-semibold' }, tab.label)
    )
  )
  // The one control on this bar that does something rather than going
  // somewhere, so it is the one that most wants to feel like it was pressed.
  // Its press comes from `pressDelegate`, like every other control's — see the
  // note on it for why touch cannot be left to `:active`.
  const addButton = h(
    'button',
    { class: 'add-btn', 'aria-label': 'Add food', onclick: () => openAddFood() },
    icon('plus', { size: 28, stroke: 2.25 })
  )

  return h(
    'nav',
    {
      // `.screen-floor`, not `bottom-0` — see the note on that utility for the
      // measurement that made bottom-anchoring untrustworthy on the installed PWA.
      class: 'pointer-events-none screen-floor z-40 px-[20px]',
      style: { paddingBottom: 'var(--nav-inset)' },
    },
    h(
      'div',
      {
        /**
         * `w-full` is not decoration. `.screen-floor` makes the nav a flex
         * column so the bar can sit at the far end of a `100dvh` box, and this
         * row became a flex ITEM in it — where `mx-auto` stops being "centre a
         * block that already fills the line" and becomes an auto margin with
         * free space to eat. Auto margins outrank `stretch`, so the row
         * collapsed to the width of its own contents: three labels crushed
         * together inside a pill a third of the screen wide.
         *
         * Stating the width puts it back to what it was under a block parent —
         * fill the line, clamp at 430, centre the remainder.
         */
        class: 'pointer-events-auto mx-auto flex w-full max-w-[430px] items-center gap-[10px]',
      },
      h('div', { class: 'tabbar' }, tabPill, tabButtons),
      addButton
    )
  )
}

const nav = tabBar()
const fade = tabBarFade()

/**
 * The fade only exists for content passing under the bar. On a screen short
 * enough not to scroll, nothing ever does — and what is left is a grey band
 * across the bottom of the page with nothing behind it to justify itself. An
 * empty Today, Settings on a large phone, and a one-item log all land there.
 *
 * Turned off with `display: none` rather than opacity, so the three
 * backdrop-filter layers stop compositing as well as stop showing. That cost is
 * paid every frame while the band exists, which is exactly the note above
 * `BLUR_RAMP` — this is the case where the right number of layers is zero.
 *
 * Measured against the document rather than any one screen: `.screen` already
 * reserves the bar's height as bottom padding, so "does the page scroll at all"
 * and "can anything reach the bar" are the same question. 1px of slack because
 * a fractional viewport height reports as scrollable when it is not.
 */
function syncFade() {
  /**
   * `clientHeight`, not `innerHeight`. They disagree by the top inset on the
   * installed PWA — 812 against 874, measured; see `.screen-floor` in styles.css
   * — and the one that decides whether the document scrolls is the scrolling
   * box, which is `clientHeight`. Against `innerHeight` a page 60px taller than
   * the viewport reported as not scrolling, so the band switched itself off for
   * exactly the content most likely to pass under the bar.
   */
  /**
   * `body.scrollHeight`, because the DOCUMENT now has a floor.
   *
   * `html` carries `min-height: var(--screen-h)` so the surface never shrinks — see
   * the note there — which means the document is nominally scrollable on every
   * screen and `documentElement.scrollHeight` can no longer answer "is there
   * content under the bar". The body's own height still can: it is the content.
   */
  const scrollable = document.body.scrollHeight > document.documentElement.clientHeight + 1
  fade.dataset.active = String(scrollable)
}

/**
 * The viewport probe rides along with the fade, because they need the same
 * moment: after the box has settled into whatever the new screen made it.
 *
 * The bug the probe is chasing only shows on a screen too short to scroll, and
 * navigating to the readout to take a measurement leaves that screen — so the
 * app takes the reading itself and stashes it. See `captureViewportState`.
 *
 * A frame late on purpose. A ResizeObserver callback runs after layout but the
 * chrome above reads `.tabbar`'s box, and on a sheet open the panel is still
 * mid-animation on the frame the body resizes.
 */
function syncChrome() {
  syncFade()
  requestAnimationFrame(() => captureViewportState())
}

// Content height changes on every data load, not just on navigation, so this
// watches the box rather than hooking the router.
if (typeof ResizeObserver === 'function') {
  new ResizeObserver(syncChrome).observe(document.body)
}
window.addEventListener('resize', syncChrome)

/** Whether the pill has been placed once. The first placement must not slide. */
let pillPlaced = false

/** The active tab gets the pill; the rest stay muted. */
function syncTabs(path) {
  const root = path.split('/')[0]
  const active =
    root === 'log' ? 'today' : root === 'foods' ? 'settings' : root
  for (const btn of nav.querySelectorAll('[data-tab]')) {
    btn.setAttribute('aria-current', btn.dataset.tab === active ? 'page' : 'false')
  }

  const index = TABS.findIndex((tab) => tab.path === active)
  if (index < 0) return

  const pill = nav.querySelector('.tab-pill')
  // Opening straight onto Settings should find the pill already there, not
  // watch it travel across the bar on first paint. Suppress the transition for
  // that one placement, forcing a reflow so the next move still animates.
  if (!pillPlaced) {
    pill.style.transition = 'none'
    pill.style.transform = `translateX(${index * 100}%)`
    void pill.offsetWidth
    pill.style.transition = ''
    pillPlaced = true
    return
  }
  pill.style.transform = `translateX(${index * 100}%)`
}

/* ----------------------------------------------------------------- routing */

function defineRoutes() {
  route('today', () => show(todayScreen))
  /**
   * The Log is a sheet now, not a screen, so `#/log` has nothing to render.
   *
   * The route stays as a redirect rather than being deleted, because it is a URL
   * that exists in the wild: the app is a standalone PWA that restores its last
   * hash on launch, and the service worker will happily serve someone straight
   * back onto `#/log` weeks after the screen stopped existing. Deleting it would
   * fall through to the router's catch-all and land them on Today with no
   * explanation for where the thing they were looking at went.
   *
   * The URL is rewritten with `replaceState` rather than `navigate`, and that is
   * load-bearing rather than tidiness. `navigate` fires a hashchange, the router
   * hook below closes any open sheet on every navigation, and the two would race
   * — the redirect would close the log it had just opened, or not, depending on
   * whether the IndexedDB read beat the hashchange. Rewriting the URL silently
   * keeps this to one resolution, and the sheet opens once Today is mounted
   * under it rather than over an empty view.
   */
  route('log', () => {
    history.replaceState(history.state, '', '#/today')
    show(todayScreen).then(openLogSheet)
  })
  route('trends', () => show(trendsScreen))
  /**
   * Both of these are URLs that exist in the wild and no longer resolve to a
   * screen. The tab was `#/weight` for the app's whole life so far, and
   * `#/history` was a real destination — a standalone PWA restores its last hash
   * on launch, so either can arrive weeks after the screen behind it stopped
   * existing. History's content is on Trends now, so both land in the right
   * place rather than on the router's catch-all.
   */
  route('weight', () => navigate('trends', { replace: true }))
  route('history', () => navigate('trends', { replace: true }))
  route('settings', () => show(settingsScreen))
  /**
   * The set-once corners of Settings, one tap in.
   *
   * Namespaced under `settings/` rather than given top-level paths, which is
   * what keeps `syncTabs` correct for free — it reads `path.split('/')[0]`, so
   * every one of these already resolves to the Settings tab. `foods` needs its
   * own case below precisely because it is not nested this way.
   */
  route('settings/target', () => show(suggestTargetScreen))
  route('settings/preferences', () => show(preferencesScreen))
  route('settings/ai', () => show(aiDescribeScreen))
  route('settings/data', () => show(dataScreen))
  route('settings/about', () => show(aboutScreen))
  route('settings/viewport', () => show(viewportScreen))
  route('foods', () => show(foodsScreen))
  route('foods/:id', (params) => show(() => foodDetailScreen(params.id)))
}

/* ------------------------------------------------------- service worker */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  try {
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    })

    /**
     * Never swap versions underneath someone mid-entry. Ask first.
     *
     * The new worker has already installed by the time this shows — its whole
     * shell is on disk, verified — and is waiting. Nothing changes until Update
     * is tapped. Dismissing the toast costs nothing: the worker keeps waiting,
     * and the next time the app comes to the front it is offered again.
     */
    let updateRequested = false
    const promptUpdate = (worker) => {
      toast('A new version is ready.', {
        action: 'Update',
        duration: 20000,
        onAction: () => {
          updateRequested = true
          worker.postMessage({ type: 'SKIP_WAITING' })
        },
      })
    }

    if (reg.waiting) promptUpdate(reg.waiting)

    reg.addEventListener('updatefound', () => {
      const worker = reg.installing
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(worker)
      })
    })

    /**
     * Ask whether there is a new version, every time the app comes to the front.
     *
     * Registration on its own checks once, at boot, and boot is not something an
     * installed PWA does often — iOS keeps the page alive across app switches and
     * restores it from the page cache, so `register` can go days without running
     * again. The practical effect is that "force-quit and relaunch to get the
     * update" does not reliably fetch a new `sw.js` at all, and the old bundle
     * keeps being served from the precache with nothing on screen to say so.
     *
     * That is not a theoretical cost. It sent a whole round of device readings
     * back stamped with a build two fixes behind, and the time went into
     * re-diagnosing something that was already fixed.
     *
     * `update()` only re-fetches the worker script; if the bytes match, nothing
     * happens and nothing is prompted. If a worker is already waiting — installed
     * on a previous visit and never activated — say so now rather than waiting for
     * an `updatefound` that has already been and gone.
     */
    const checkForUpdate = () => {
      reg
        .update()
        .then(() => {
          if (reg.waiting) promptUpdate(reg.waiting)
        })
        .catch(() => {
          /* offline, which is the normal case for this app and not an error */
        })
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.addEventListener('pageshow', checkForUpdate)

    /**
     * Reload only for a REPLACEMENT, never for the first worker.
     *
     * The first install claims the page so that its fetches are answered from
     * the cache from then on, and that claim fires `controllerchange` exactly
     * like an update does. Reloading on it threw away whatever was on screen a
     * second or two into the very first visit — the page already running is
     * the same build the worker just cached, so there is nothing to reload
     * for. A page that was controlled before, or that asked for the update
     * itself, is on an old build and does need the new one.
     */
    const hadController = !!navigator.serviceWorker.controller
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      if (!hadController && !updateRequested) return
      reloading = true
      location.reload()
    })
  } catch (err) {
    console.warn('Service worker registration failed', err)
  }
}

/* --------------------------------------------------------- failure states */

/**
 * Spec 9: IndexedDB is unavailable in private browsing on some browsers.
 * Blocking on this is the honest move — a tracker that silently forgets is
 * worse than one that says it cannot run.
 */
function renderStorageBlocked() {
  mount(
    app,
    h(
      'div',
      {
        // `--screen-h` for the reason given on that token: both `svh` and `dvh`
        // come back 62px short of the screen on the installed PWA.
        class: 'mx-auto flex min-h-[var(--screen-h)] max-w-md flex-col justify-center gap-3 px-6',
        /**
         * The one surface that is not a `.screen`, so it carries its own
         * insets. It is centred and short enough never to reach the status bar
         * in practice — but "in practice" stops being true at the largest text
         * sizes, and this is the screen that has to render when nothing else in
         * the app can.
         */
        style: {
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        },
      },
      icon('alert', { size: 28, class: 'text-muted' }),
      h('h1', { class: 'text-title font-semibold' }, 'Storage is unavailable'),
      h(
        'p',
        { class: 'text-[14px] leading-snug text-muted' },
        'Trackd keeps everything on this device, so it needs local storage to run. ' +
          'This usually means private browsing is on, or site data is blocked for this page.'
      ),
      h(
        'p',
        { class: 'text-[14px] leading-snug text-muted' },
        'Open the app in a normal window, or allow site data, then reload.'
      ),
      h('button', { class: 'btn-primary mt-2', onclick: () => location.reload() }, 'Reload')
    )
  )
}

/* -------------------------------------------------------------- first run */

/**
 * iOS gives no install prompt, so the app has to explain itself once.
 *
 * Not while nothing has ever been logged: Today's first-run state carries the
 * same instruction as a card, and a toast over it would say it twice. This is
 * the reminder for whoever logged a meal first and installed never.
 */
async function maybeShowInstallHint(settings) {
  if (settings.firstRunSeen || isStandalone() || !isIOS()) return
  if ((await firstLoggedDate()) === null) return
  setTimeout(() => {
    toast('Add to Home Screen from the Share menu to use this offline.', {
      action: 'Got it',
      // Nothing to undo and nothing to decline: this toast tells you one thing,
      // and acknowledging it is the same act as closing it.
      actionDismisses: true,
      duration: 15000,
      onAction: () => saveSettings({ firstRunSeen: true }),
    })
  }, 1200)
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  /**
   * Before anything is built, and never torn down.
   *
   * It is delegated on the document, so it does not care what is mounted — the
   * storage-blocked screen, onboarding, or the app — and it covers controls
   * built long after this line ran, which is every control in the app given
   * that screens rebuild their own subtrees.
   */
  pressDelegate()

  try {
    await checkStorage()
  } catch {
    renderStorageBlocked()
    return
  }

  const settings = await getSettings()
  applyTheme(settings.theme)
  onChange((scope) => {
    if (scope === 'settings' || scope === 'all') getSettings().then((s) => applyTheme(s.theme))
  })

  /**
   * First launch: onboarding owns the whole screen, and the shell is not built
   * until it is done.
   *
   * Mounting it over the app instead would mean rendering Today first — an
   * empty dashboard reading 0 against a target nobody chose — and then covering
   * it up. Nothing behind means nothing to flash, and no tab bar to tap through
   * to a version of the app that has not been set up yet.
   */
  if (!settings.onboardingComplete) {
    clear(app)
    await new Promise((resolve) => {
      createOnboarding({ onDone: resolve }).then((el) => mount(app, el))
    })
  }

  clear(app)
  app.appendChild(view)
  app.appendChild(fade)
  app.appendChild(nav)
  syncFade()

  defineRoutes()
  startRouter((path) => {
    syncTabs(path)
    closeAnySheet()
  })

  registerServiceWorker()
  maybeShowInstallHint(settings)

  // Resuming after midnight should land on the new day, not yesterday.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rollOverIfNeeded()
  })

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    getSettings().then((s) => s.theme === 'system' && applyTheme('system'))
  })
}

boot()
