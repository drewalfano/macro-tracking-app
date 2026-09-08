# Apple design review

Read-only pass, 2026-09-08, against the `apple-design` skill (Designing Fluid
Interfaces, the materials and typography talks, and the eight principles).
Nothing here has been changed. Line references are to the files as they stand.

Companion to `NOTES-motion-audit.md` and `NOTES-motion-gaps.md`. Most of what
those two found has shipped, and this pass does not re-report it. It asks a
different question: with that work done, where does the app still differ from
the skill, and is the difference a defect or a defensible choice?

Judged from the code, not on a phone. There is no simulator on this machine
(`no-ios-simulator-on-this-mac`), and the browser pane cannot exercise a touch
gesture. Every gesture finding below is a reading of `dom.js`, and the three
that are about feel (1, 2, 3) want a device reading before they are built.

> **Status, 2026-09-08, same day.** Findings 1a, 1b, 2, 3b, 4, 6, 7, 8 and 9
> are built, plus the confirm exit, the toast rubber band, the loops comment
> and `user-scalable` from the batch. Read the code rather than the fix text
> below where they differ; two of them changed when built:
>
> - **1a** does not use the fixed curve proposed below. A bezier whose first
>   control point sits above the diagonal starts at 2.7× the finger's speed,
>   which is a lurch the other way. The curve is now computed per release so
>   its starting slope reproduces the finger's speed exactly, and the old
>   `ease-in` turns out to be the limiting case for a slow far pull. See
>   `swipeToDismiss.onEnd`.
> - **The confirm box's exit** was worse than described. The premise that
>   `scrim-out` took the box with the scrim stopped being true when the wash
>   moved to `.sheet-dim`: the confirm had no dim child, so it popped in and
>   vanished. It now has one, and the box goes back down 12px on the toast's
>   exit timing.
> - **The sheet's upward hard stop stays.** Item 10 below says the sheet has
>   no reason for it; it has the row's: the panel is anchored to the screen's
>   bottom edge, and lifting it exposes the scrim under it. Not changed.
>
> Verified in the pane under touch emulation with synthetic touch events: a
> sheet closed 199px into its entry left from 199 rather than snapping open;
> a fast flick dismissed on a 120ms curve with a linear start and a slow far
> pull on 200ms with an ease-in start; the confirm fades on its own dim and
> leaves on `confirm-out`; the switch toggles through the native input at a
> 51×44 hit size. The haptic on that input is the platform's and is unverified.
> Reduced motion, transparency and contrast cannot be emulated in the pane and
> are unverified.
>
> **Decided, 2026-09-08:** 5 (Dynamic Type) is a no; the app has one user and
> he runs the default size. 3a (catching a glide) is left as it is. Small-text
> tracking was read on the phone and closed: the 12 and 13px labels read fine
> on SF. **Still open:** 1c (springs), pending a phone reading of 1a and 1b,
> and the three `width` fills, left unless the calorie bar ever stutters.

---

## Part 1 — what already meets the skill

Worth stating first, so nobody retunes it.

| Skill section | What the app does | Where |
|---|---|---|
| §1 Response | Press feedback on `touchstart`, delegated once on the document, 120ms dip on every control in `PRESSABLE`. | `dom.js:1399` |
| §2 Direct manipulation | All three gestures track 1:1, publish progress, and rebase at the claim so the axis threshold is not charged to the surface. | `dom.js:451`, `dom.js:914`, `dom.js:1298` |
| §3 Interruptibility | Row swipe, deck spring-back, and sheet entry all read the painted transform and pin it before taking over. `paintedTranslate` is the skill's "start from the presentation value", written down. | `dom.js:178` |
| §5 Velocity, partial | The deck's settle duration is derived from release velocity and remaining distance, floored and capped. | `dom.js:722` |
| §6 Momentum, partial | Flick sign decides direction on the row and the deck; a flick reverses a drag. | `dom.js:497`, `dom.js:1067` |
| §7 Spatial consistency | Sheet in from the bottom, out to the bottom. Panel push from the right, pop from the left. Toast leaves the way it came, relative to wherever the finger left it. | `styles.css:3650`, `toast.js:238` |
| §9 Rubber band | The deck's boundary is asymptotic, not a constant fraction. | `dom.js:578` |
| §10 Gesture details | 12px axis threshold, 1.5:1 ratio, press released at 10px, deck axis decision stays open until 24px of vertical travel. | `dom.js:250`, `dom.js:615` |
| §11 Frame smoothness | `transform`/`opacity` throughout the gestures. `will-change` raised at `touchstart` and dropped when motion ends, not held for the screen. | `dom.js:709` |
| §12 Scroll edge effects | Progressive compounding blur under the tab bar; a gradient veil at the sheet's head and foot instead of a 1px divider. This is exactly the skill's "scroll edge effects, not hard dividers". | `styles.css:2925`, `styles.css:3960` |
| §12 Header as frame | `view-in` and `panel-in` exclude the header. The chrome holds still and the payload moves. | `styles.css:3774`, `sheet.js:608` |
| §15 System font | One family, the OS's own, with the optical-size argument measured rather than asserted. Tracking tightens with size: −0.02em at 48 and 27, −0.01em at 20, 0 at body. | `styles.css:238`, `styles.css:282` |
| §16 Agency | Undo on every delete that goes through `deleteEntryWithUndo`, on the plate commit, on Describe. | `entryActions.js:13` |
| §16 Feedback | The busy state lives in the button that started it (`wait-lives-in-the-control`). | memory |

The motion vocabulary is also unusually disciplined: ten named durations, four
named curves, exits faster than entries everywhere both exist, and no
`ease-in-out` anywhere.

---

## Part 2 — findings, ranked by quality gained per unit of work

### 1. The seam between drag and animation is still a cut, not a handoff — §4, §5

The skill's central claim is that a release should *continue at the finger's
velocity* into a spring. The app uses velocity to **decide** (flick or not) and,
on the deck, to **time** the settle. It never hands velocity to the motion
itself, and every release is a CSS transition with a fixed bezier that starts
from rest.

Three places, in order of how visible each is:

**1a. A flicked sheet restarts from zero and accelerates — `dom.js:1353`.**
`transform ${duration}ms ease-in` from wherever the drag left the panel. This
is audit 1, finding 5b, and it is still open. The panel is moving at 0.6px/ms
or more at the moment of release, the curve begins at zero velocity, so the
sheet visibly hesitates and then leaves. The dim on `dom.js:1356` has the same
curve and the same problem.

Smallest fix: keep the CSS transition, but pick the curve and duration from the
velocity so the first frames match the finger.

```
const remaining = panel.offsetHeight - dy
const ms = Math.round(Math.min(260, Math.max(120, remaining / Math.max(velocity, 1.2))))
panel.style.transition = `transform ${ms}ms cubic-bezier(0.3, 0.8, 0.4, 1)`
dim.style.transition   = `opacity ${ms}ms ease-out`
```

A `cubic-bezier` whose first control point is above the diagonal starts at
speed, which is what a released object should do. Same shape as `settleMs` on
the deck, one surface over.

**1b. The row's settle is a fixed 260 or 200ms — `dom.js:505`, `dom.js:361`.**
Released 10px from open after a slow drag, the last 10px take the full 260ms on
an overshooting curve. Thrown hard from closed, the row trails the thumb. The
deck fixed exactly this with `settleMs`; the row never got it. Same ten lines,
with `width` as the full-travel distance.

**1c. Nothing carries velocity through a re-target — §3 "brick wall".** When a
finger catches a settling row or deck, the app pins the painted position (good)
and starts a fresh transition from rest (the discontinuity the skill names). A
CSS transition cannot do better than this. The honest options are a small
rAF-driven spring in `dom.js` for the three gesture surfaces, or accepting the
cut. My recommendation is to accept it *after* 1a and 1b land and are read on
device: a catch mid-settle is a 200ms window, and a critically-damped spring
library is a dependency the app has so far avoided on purpose. Decide with a
phone in hand, not here.

**Work:** 1a ~8 lines, 1b ~10 lines. 1c is a design decision, not a patch.

---

### 2. Closing a sheet during its entry snaps it fully open first — §3, §7

`teardown` at `sheet.js:793` sets `data-closing`, and `styles.css:4167` swaps
the animation to `sheet-out`, whose `from` is `translateY(0)`. A new
animation-name plays from its first keyframe. So a scrim tap, an Escape, a
hardware back, or a programmatic close that lands inside the 320ms `sheet-in`
window jumps the panel to fully open and then slides it out.

`swipeToDismiss` already solved this for the finger: read `paintedTranslate`,
set `data-dismissing`, and finish under an inline transition from where the
panel actually is. `teardown` should take the same path when the panel is
mid-entry. Checking `getAnimations()` on the panel, or simply always going the
inline route, both work; the inline route is one code path instead of two.

```
const { y } = paintedTranslate(panel)
panel.dataset.dismissing = 'true'   // suppresses every keyframe
panel.style.transition = 'none'
panel.style.transform = `translateY(${y}px)`
void panel.offsetHeight
panel.style.transition = `transform 200ms ease-in`
panel.style.transform = 'translateY(100%)'
```

This is the exact case the skill uses as its example: "a closing modal the
user grabs again should follow the finger, not finish closing first." The
app's version finishes *opening* first.

**Work:** ~12 lines in `teardown`, and `sheet-out` becomes dead CSS to remove.

---

### 3. Two lockouts remain on the deck — §3 "never lock out input during a transition"

**3a. `committing` refuses `touchstart` for the length of the glide —
`dom.js:758`.** A finger landing on a page mid-glide (200ms) is dropped. The
spring-back is catchable; the commit is not. The `caught` rebase on
`dom.js:771` would work for a glide too, since `currentX()` reads the running
transition. The complication is that catching a glide has to also cancel
`handOver`, which is what `settled` exists for. Worth doing only if a device
reading says people actually reach for a page mid-turn; my guess is they
reach for the *neighbour* they just revealed, which is the spring-back case
and already works.

**3b. `awaitingPaint` skips the rebase — `dom.js:771`.** The comment calls this
"its own open problem". It is: a touch in the window between the glide ending
and the rebuild landing (up to 400ms on a slow IndexedDB read) starts from
`startX = clientX` while the track sits a full page over, so the first
`onMove` yanks it. The fix is not a rebase but a refusal: treat `awaitingPaint`
like `committing` in `onStart` for the length of that window, so the gesture
that cannot be honoured is not accepted and then broken.

**Work:** 3b is one condition. 3a is ~20 lines and a device question.

---

### 4. A toast caught mid-snap-back jumps — §3

`swipeAway` at `dom.js:1524` has no painted-position read. Release under
threshold starts a 160ms transition back to `0`; a second touch inside it sets
`dy = 0`, `onHold` clears the transition, and the first `onMove` writes
`translateY(damp(rawY))` from a fresh origin, so the toast jumps from wherever
the snap-back had reached to within a few pixels of home. Same defect the row
had, same fix: `baseY = paintedTranslate(el).y` at the decide, track from
`baseY + rawY`.

**Work:** ~6 lines.

---

### 5. Dynamic Type is ignored — §15 "respect the user's text-size setting"

There are 393 `px` values in `styles.css` and zero `rem`. `-webkit-text-size-adjust:
100%` at `styles.css:598` switches off the one automatic accommodation Safari
would have made. On an iPhone set to a larger text size, Trackd renders at the
same size as on one set to the smallest.

This is the largest gap between the app and the skill, and it is also the one
where the skill's advice ("spacing in rem/em") is the wrong fix for this app:
the layout is measured in points against a 390pt screen and holds together
because it is. Converting the spacing scale to `rem` would scale the *gutters*
with the text setting, which is not what iOS itself does.

What iOS does is scale type and let layout reflow. The web equivalent on
Safari is the `-apple-system-*` font keywords, which resolve to the user's
Dynamic Type size:

```
body { font: -apple-system-body; }           /* 17pt at default, tracks the setting */
.text-title { font: -apple-system-title1; }
```

With the numeric overrides the app already applies for size and weight, the
keyword contributes the *scale factor* and the tokens contribute the design.
The fitText backstop on the day header and the `overflow: hidden` on truncated
titles are the two places that would need a reading at the largest setting.

This is a scope decision for Drew, not a patch. Three things to weigh: the app
has one user today and he can say whether he changes the setting; the
`-apple-system-*` keywords are WebKit-only, which is fine for an iOS PWA; and
every screen would need a reading at 390pt at the "Larger Accessibility Sizes"
end. Recorded so the choice is made rather than defaulted.

**Work:** L, and a device session per screen.

---

### 6. Reduced motion is "instant", not "gentler" — §14

The blanket at `styles.css:4700` sets every animation and transition to 0.01ms.
The skill's rule is that reduced motion "doesn't mean *no* feedback, it means a
gentler, non-vestibular equivalent": sheets should cross-fade rather than
either slide or pop.

Under the blanket, a sheet appears fully formed on one frame with the dim
already at 35%. The value-continuity system (`countTo`, the rings, the bar)
also drops to instant, which is fine, those are the elastic/overshoot class
the skill says to drop. The sheet, the panel push and `view-in` are the ones
that want an opacity ramp instead of nothing.

Two of the three are already opacity-only (`panel-in`, `view-in`), so they need
nothing but exemption from the blanket. The sheet needs a reduced-motion
variant of `sheet-in` that is `opacity 0 → 1` at 200ms with no transform.

The blanket's 0.01ms also has a stated reason: `transitionend` must still fire
so `swipePages` does not deadlock. The `fallback` timer at `dom.js:850` has
since removed that dependency, so the number could now be a real `0`, or the
blanket could become a list of the animations that should be dropped rather
than everything.

Separately, **`prefers-reduced-transparency` and `prefers-contrast` are not
handled at all.** The tab bar's compounding blur and the sheet head's blur
layers are the surfaces that would need a solid fallback. `fade.js` already
has a plain-gradient mode (the sheet foot uses it), so the fallback exists and
only needs the media query to select it.

**Work:** S for the reduced-motion split, XS for the two missing queries.

---

### 7. Confirm *and* undo on the same delete — §16 Agency, Familiarity

`serving.js:375` and `serving.js:612` show a confirm dialog whose message is
"You can undo straight after", then delete, then offer Undo in a toast. The
dialog is telling you it is unnecessary. The skill is explicit: a confirmation
dialog only for genuinely destructive, *irreversible* actions, and overusing
it trains people to click through.

The same action from the swipe row (`deleteEntryWithUndo`) has no dialog. So
removing an entry asks a question in one place and not in another, which is
the Familiarity principle's "things that look the same must behave the same".

Recommendation: drop the two confirms in `serving.js` and rely on the Undo
toast, which is what the row already does. Keep the dialog on the three
genuinely irreversible ones (`foods.js:396` delete food, `settingsPages.js:509`
replace all, `settingsPages.js:563` delete everything, which correctly requires
typed text). The weigh-in delete at `weighIn.js:100` has no Undo and a dialog;
either is fine, but it should have the Undo rather than the dialog to match
entries.

**Work:** XS. Two deletions, one toast added on the weigh-in.

---

### 8. `haptic()` cannot fire on the platform it is written for — §13

`navigator.vibrate` at `dom.js:150` is not implemented in Safari on iOS, which
is the only platform this ships to (`runs-as-ios-pwa`). The three calls (mode
switch `today.js:643`, long press `dom.js:1616`, scan `scan.js:53`) are no-ops
in production. Not a bug, but it is feedback the design counts on that nobody
has ever felt.

The one haptic WebKit does expose is on `<input type="checkbox" switch>`
(Safari 17.4 and later): the OS plays its toggle haptic when it flips. The
app's `switch` at `ui.js:940` is a `role="switch"` button, so it does not get
it. Rebuilding it on the native input would give the settings toggles a real
haptic for free, and it is the only place the skill's "causality, harmony,
utility" rules can currently be honoured at all. Everything else should be
read as motion-only until WebKit ships more.

**Work:** S for the switch. The other three calls can stay as documentation of
intent.

---

### 9. Two debounces on the same local search — §1

`addFood.js:57` waits 120ms before running `searchFoods`; `matchItem.js:29`
waits 300ms before running the same `searchFoods` against the same IndexedDB.
Neither is a network call. The skill's line is "audit debounces, artificial
timers": 300ms is a quarter-second of nothing after each keystroke on the
Describe match panel, and the food list's own filter (`foods.js:76`) argues in
its comment that an in-memory filter should have no debounce at all.

Recommendation: one constant, 120ms, shared. If the 300 was chosen because
`searchNewStaples` is slow, that is the thing to measure.

**Work:** XS.

---

### 10. Smaller things, batched

- **Three fills still animate `width`** (`styles.css:1523`, `:1665`, `:1733`).
  Audit 1, finding 8, still open. The calorie bar is now a stable element that
  remembers itself, so it no longer replays, which takes most of the sting out.
  Still the only non-compositor animation on the busiest screen.
- **The confirm box leaves differently from how it arrived.** It borrows
  `toast-in` (rises 12px) and exits on `scrim-out` alone (fades in place).
  §7 says exit the way you entered. Twelve pixels down on the way out.
- **The sheet hard-stops upward** (`dom.js:1332`, `Math.max(0, …)`). §9 wants
  progressive resistance at every boundary. iOS sheets give a few pixels
  here; `rubber(deltaY, 24)` would match. The row's hard clamp past closed is
  argued for at `dom.js:263` and the argument holds; the sheet has no such
  reason.
- **The toast's upward damping is a constant third** (`dom.js:1531`), the same
  shape the deck replaced with `rubber()`. Use `rubber()`.
- **"No loops, no ambient motion"** at `styles.css:3508` is false: `bubble-pan`
  runs 60 to 90s infinite and the sparkle runs 1.6s infinite. Both are
  defensible (an onboarding backdrop, a wait indicator, both parked or short
  under reduce) but the comment is a claim, not a fact
  (`comments-are-claims-not-facts`).
- **`user-scalable=no`** in `index.html:7`. iOS has ignored it since iOS 10, so
  it does nothing, but it states an intent the Flexibility principle argues
  against. Remove it so the file says what the app does.
- **Small text has no positive tracking.** 12 and 13px labels
  (`styles.css:1249`, `:1574` and on) sit at 0. The skill wants a slight
  positive value at small sizes. SF Text below 20px is already drawn open, so
  this may be nothing; a reading at 12px on device would settle it.

---

## Summary

| # | Finding | Skill § | Impact | Work |
|---|---|---|---|---|
| 1 | Release restarts from rest: sheet `ease-in`, row fixed duration | 4, 5 | High | S |
| 2 | Close during sheet entry snaps fully open first | 3, 7 | High | S |
| 3 | Deck refuses a touch mid-glide; skips rebase while awaiting paint | 3 | Medium | XS + M |
| 4 | Toast jumps when caught mid-snap-back | 3 | Low | XS |
| 5 | Dynamic Type ignored | 15 | High for anyone who uses it | L, decision |
| 6 | Reduced motion is instant, not a cross-fade; no transparency/contrast queries | 14 | Medium | S |
| 7 | Confirm dialog plus Undo on the same delete; inconsistent across surfaces | 16 | Medium | XS |
| 8 | Haptics cannot fire on iOS; the switch could have a real one | 13 | Low | S |
| 9 | 300ms debounce on a local search | 1 | Low | XS |
| 10 | Batch | various | Low | S |

Findings 1, 2, 7 and 9 are about 40 lines between them and are where the
perceived gain is. Finding 5 is the one that needs a decision before any code.
