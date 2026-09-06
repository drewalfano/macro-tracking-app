# Visual changelog

The visual system is locked to the v1 mockups. Every change to it gets logged
here with the reason, because the record of what moved and why is part of the
case study, not a byproduct of it.

---

## v1.3.0 — Describe becomes one sheet, and the first day has one thing to do

### Describe: write, review, log

The old flow was a field with two buttons under it — "Make a plate" and "Send
it all to Gemini" — that opened the plate on top, where every row wore a pencil,
a search glyph and a cross, and every correction pushed another panel. It asked
the person to choose a processing method before it asked what they ate.

Now it is one panel with three states, and the panel never leaves. The field
sits under a heading that asks the only question, "What did you eat?", with one
primary action, "Review meal". The rows arrive in the same sheet: the sentence
collapses to a summary card with "Edit description" beside it, a totals tile
above the rows, and the rows themselves in one card. A row is a button with a
chevron; tapping it opens its editor beneath it, and everything that can be
done to the row — the amount, the unit, the words, the search, removal — is in
there. Nothing is drawn on a row that has nothing to say.

The footer holds one pinned action, "Log meal", and a muted line above it that
names what is in the way when it is disabled: "1 item needs a food and 2 items
need an amount." A food named without an amount opens ready to be answered, in
its own words — "About how much rice?" — rather than under a label reading
Quantity.

"Save as a meal" and the plate are demoted to two chips on the totals tile,
filling its width. They are real options, not the next thing to do.

### The sheet holds still

The panel asks for the whole screen and is then trimmed to exactly the
scroller's box, so the sheet is at its cap from the first frame and stays there
through typing, the read, the rows arriving and a row opening. The one
movement is the content fade the app already uses for a panel whose contents
changed. The keyboard lifts the sheet's bottom edge by its own height via
`visualViewport` — written to the standard arithmetic and **not yet measured on
the phone**, which is where it has to be.

### Sending is a switch, not a key

A stored key used to be read as permission. It is not: it is the ability. The
switch under it in Settings → AI Describe is the permission, off for every key,
and the sheet asks once — with both answers given equal weight — the first time
it has something it would send. The copy under the field says which state it is
in, in one line, every time.

### Today's first day

Two empty cards — "Tap + to log your first food" under a Quick add heading, and
"Nothing logged yet" under Logged — became one card in the log's place, with
the action in it: "Log your first meal" opens Describe. The Quick add section
appears with the first food, which is the moment it has something to show.

---

## v1.2.3 — the section heading gets a size of its own, and the log runs backwards

From use — [NOTES-use-audit.md](NOTES-use-audit.md), U4: *"the full log button
being bigger than the tile title is unproportionate. the hierarchy is off."*

### The heading and the caption were the same size

`.section-label` was 16px in both of the jobs it had. It headed a section —
"Log", "Morning", "Today's weight" — and it captioned a field inside a sheet —
"Block", "Serving", "Day". Those are not the same rank, and giving them the same
size means the only thing left setting hierarchy on that row is physical size.
A 34px pill with an ink stroke beats a 16px word at that, every time, which is
why the button read as the louder of the two.

Headings are 20px now, scoped to `.section-head` — the label only takes the
larger step when it is heading a list. Field labels are untouched at 16, which
is the size they should be, because they are captions. 20 lands between the 26
screen title and the 16 body step, so the day header still leads the screen and
the section heading still leads its own rows.

### The pill lost 4px, and kept its stroke

30px tall and 14px of padding, down from 34 and 16. The stroke stays exactly as
dark: the note above `.chip-sm` is still true — it is the only control on a
heading row and nothing else is there to say it is pressable. What was wrong was
its size against the heading, not its contrast. At 34 against 16 the pill stood
a shade over twice the heading's type; at 30 against 20 it is one and a half.

This is the local fix. The scale is the real one — five steps for the whole app
is *why* a heading and a caption were the same size, and that is still Phase 4.
The entry stays open for it.

**Found while measuring, not fixed:** `.chip-sm` is a 30px tap target where it
is a button of its own, under the 44 iOS asks for. It was under at 34 too, so
nothing here made it worse, but it is now written down.

### Today's log preview runs newest first

Not from U4 — a separate note the same day. `listEntries` returns oldest-first
and both screens took it as given. That is right for Log, which groups by block,
and a block reads forwards through the meal. It is wrong for Today, which is a
preview of the day so far: the thing you just ate is the thing you opened the
app to check, and oldest-first pushes it one row further down every time you
log. By evening the newest entry was ninth.

Reversed at the render site in [today.js](src/screens/today.js) rather than in
`listEntries`, so the order stays one screen's decision instead of silently
becoming both screens'. The two screens now disagree on purpose, and each has
its reason written next to it.

---

## v1.2.2 — over darkens in dark mode too

Found on device, in the app, which is the only place it could have been found:
the ring's second lap was getting BRIGHTER as it went over in dark mode and
darker in light. One state, two opposite marks, depending on the theme.

v1.2.0 did that on purpose and the purpose was wrong. The reasoning was that the
edge had become a mark, a mark owes 3:1 against what it sits on, and the light
edges fail that on the dark card at 1.91:1 to 2.95:1.

**The ground was wrong.** A second lap only exists once the first lap has
closed, so it is painted on top of the fill every time and never touches the
card at all. The contrast that governs it is the separation from the fill, and
measured that way a darker lap sits at 1.75–1.85 in dark against the brighter
one's 1.74–1.84. The inversion was buying nothing, and it cost the one property
that mattered: that the mark means the same thing wherever you see it.

Dark edges are now each theme's own fill at the same −0.14 step. The test that
argued for the old values is gone, replaced by the note explaining which ground
applies — a passing test measuring the wrong thing is worse than no test, and
this one passed all the way to a device. 123 → 115 assertions, and the eight
that went were the eight that were wrong.

---

## v1.2.0 — the drawn colours, and the rule that was stopping them

From use — [NOTES-use-audit.md](NOTES-use-audit.md), U7. Three notes on one
screenshot of the rings: *the colour choices are all over the place*, *the fat
colour is two different and looks brown/muddy*, *the pink could go a touch dark*.

### What "all over the place" turned out to mean

Converted to OKLCH, the four fill→edge steps were ΔL **−0.087** (carbs), −0.105
(kcal), −0.129 (fat) and **−0.164** (protein). Protein's edge was nearly twice
the step carbs' was.

So it was not four wrong colours. It was four unrelated *distances*, each picked
on its own and never held up against the others — which is exactly what a set
looks like when it has been assembled rather than constructed. Every edge is now
its fill at ΔL −0.14 in light and +0.15 in dark.

### The brown was not a bad hex

At fat's old hue of 57° and its edge's lightness, sRGB has 0.130 of chroma left
to give, and the old edge was already taking 0.131 of it. **There was no better
orange available.** A dark orange with no chroma left in it is brown; that is
what brown is. No amount of picking fixes that at 57°.

### Then the colours arrived, and they were better

Picked off the ring mockup: `#2049B2`, `#F27E11`, `#C0189B`, each with a darker
stop under it. Two of the three were already tokens — the mockup builds the ring
on what this palette had been treating as its *dark* end, and goes darker still.

Measured against the gates, four of the six missed:

| pick | gate | measured |
| --- | --- | --- |
| `#2049B2` fill | 3:1 on the dark card | **1.91** |
| `#C0189B` fill | 3:1 on the dark card | **2.77** |
| `#F27E11` fill | 3:1 on a white card | **2.70** |
| `#C86304` edge | 4.5:1 as type on canvas | **3.52** |

The last two are fat, and fat failing on white is this palette's oldest bug
recurring — v1.1.6 has the same story about the gold. Both moved down by the
smallest step that clears: `#e67500` and `#ae5400`.

The first two are not a fault in the colours. **They are the old rule failing.**

### The fills move between themes now

The rule was that a fill never changes with the theme, and it is why every fill
in this app had been paler than anything drawn for it. One value clearing 3:1 on
white *and* on near-black lives in about a stop and a half, and the lightness was
therefore spent before the hue was chosen. `#2049B2` is 7.90:1 on white and
1.91:1 on the dark card; no single hex serves both, so the drawn blue could not
exist while that rule stood.

Type has moved between themes since v1.1.0 for precisely this reason. Marks now
do the same. The invariant that replaces it is a better one: **hue and chroma
hold across themes, lightness does not.** It is the same colour in both; only its
distance from the ground changes. Dark fills are lifted only as far as the gate
needs — protein 0.108, carbs 0.024, fat and kcal not at all.

Protein and carbs are used exactly as picked. Kcal was not drawn and keeps its
construction.

### The edge became a mark and nothing had noticed

v1.1.7 made the edge the ring's second lap. Until then it was type, or a chip
behind white text, both covered by the AA rows. A lap is a **mark**, and owes
3:1 — where the light-mode edges ran 1.91:1 (protein) to 2.95:1 (fat) on the
dark card. All four under. The coil in dark mode was darker paint on dark ground.

The step therefore inverts with the theme. **Light: the strand darkens as it
laps. Dark: it brightens.** Both say the strand moved away from where it
started, each in the direction its ground has room for. The dark step is +0.15
against light's −0.14, and the asymmetry is measured rather than eyeballed:
matching them exactly gave a visibly weaker pair (1.56:1 on kcal against 1.82:1
in light), because contrast ratios compress as luminance rises.

### Two new rows in the test, and one of them earned its place immediately

`npm test` now measures the edge **as a mark** in both themes, and the
**separation within each pair** in both themes. The second is the invariant this
version is really about: the ring's argument is that the second lap is the first
lap's colour *moved*, so a pair that closes up stops saying anything.

It failed on the first attempt at the dark step, which is the only evidence
worth having that a test is doing work. 107 → 123 passing.

### And the ramp was too long

`BLEND` drops from a quarter turn to a sixth. At 112% the whole second lap sat
inside a quarter-turn blend, so 22g over looked very close to exactly on target —
the v1.1.7 complaint returning at the overages that actually happen rather than
at the extremes.

---

## v1.1.8 — the tab bar stops making a mess at the bottom of the screen

Second finding from real use — [NOTES-use-audit.md](NOTES-use-audit.md), U3.
Logged as one complaint, "the tab bar background feels unfinished"; it was three
faults with three different causes, and separating them was most of the work.

### The blur was over text with no reason to be blurred

The band is 159px. The bar occupies the bottom 88 of it — 20px inset plus 68px
tall — so **the top 71px of the band is open page**, and the mildest blur layer
was running the full height. That put a 1.5px blur across seventy pixels of
content that is nowhere near the bar, which on Today is usually a whole log row.

Blur under a floating bar is paying for one thing: content about to pass beneath
it should recede before it gets there. Seventy pixels up, nothing is about to
pass beneath anything. It was a cost with no matching benefit, and the reading
was exactly right — text that should be legible, slightly out of focus, for no
reason a person could name.

The ramp now tapers out by 62% of the band, 98px, ten above the top edge of the
bar. Close enough to the bar that it is doing its job, clear of anything worth
reading, and not ending on a line of its own.

### The black was the muddiness

The bottom carried two scrims: a veil in the canvas colour, then a black
gradient over it — 10% in light, 34% in dark.

**Black over the canvas does not darken the canvas, it desaturates it.** #f0f0f0
under 10% black is a flat dead grey, which is what "muddy" and "dirty" are the
words for. In dark it failed differently and worse: it pooled to something
*darker than the page itself*, so the bottom of every screen had a patch under
it that belonged to no object and could not be explained by anything on screen.

The fix was not a better black, and it was not researching what competitors use.
It was noticing why the black was there at all. The veil had been left at 92% —
8% of live content still coming through — and the black existed only to muddy
what that 8% let past. **Take the veil to the full canvas colour and both go at
once.** It now holds solid for the first 34% of the band, the 54px containing
the home indicator and the bottom of the pill, then ramps out over the remaining
105px.

The bottom of the screen is now exactly the page colour, which is the one tone
on the screen that cannot look dirty on the page.

Losing the shade costs the bar the edge it was sitting against, and it does not
need one: it carries `--color-surface` and a 1px outline, which is what an edge
is for. Five layers down to four, one of them deleted rather than tuned.

---

## v1.1.7 — the ring laps itself

One change, and it reverses a decision made three versions ago. First finding
from real use rather than from a read of the code — see
[NOTES-use-audit.md](NOTES-use-audit.md), U1.

### Going over draws a second lap

**Past the target the ring keeps going, in the darker edge shade, over the lap
it already drew.** It had saturated: the arc closed at 100% and stopped, and
everything past that was left to the number in the middle.

The original reasoning is still in the file and it was not stupid — a ring is a
0–100% container, a second lap is ambiguous about how many laps have gone by,
and the text was already stating the magnitude exactly. What it missed is that
it made `54g over` and `exactly on target` the same picture. Two states that
could not be less alike, rendered identically, and the app's whole argument is
that **over is information**. A mark with nowhere to put the excess cannot say
the one thing this app exists to say without shame.

That it survived to be shipped is the interesting part. It was reasoned about
carefully, written down, and wrong — and it took using the app on a day that
went over to see it, because the state simply never came up while building. The
bars had already solved this in v1.1.1 with the overage segment; the rings, added
later, quietly regressed it. **Same fact, two marks, two different answers** —
which is the failure the component vocabulary exists to prevent.

Three details:

**The lap is the edge shade, not a new colour.** `MACRO_EDGE` already means "the
part past the target" on `bar-over`. Reusing it makes overage one encoding across
both marks rather than a ring-specific invention, and it costs no new tokens.

**It arrives at that shade gradually, not at 12 o'clock.** The first build
stepped straight from fill to edge where the second lap began, and the step drew
a hard vertical seam at exactly the point the strand is supposed to be
continuous. The ring stopped reading as one thing that kept going and started
reading as two rings stacked up — a literal second ring rather than a coil.

So the strand now leaves the first lap at the first lap's own colour and deepens
into the edge shade over the following quarter turn. The seam is gone, and the
colour changes job while it's at it: it is no longer announcing *that* a second
lap has begun — the geometry already said that — but saying *how far into it*
you are. 103% is the strand barely lifting off; 200% is fully dark. That is a
reading the previous version could not give at all.

A quarter turn is the shortest blend that survives the small overages. At 105%
the entire second lap falls inside it, which is correct: being 5% over should
look like being barely over, not like a new ring appearing.

The lap is painted at full length and **revealed by a mask** rather than grown
directly, so the ramp stays fixed to the strand. Growing it would stretch the
blend as the day went on, and the shade at any point would depend on how far
over you were rather than on where it sits in the coil.

**The ramp is a real gradient, not ten steps of `color-mix`.** Segments were the
first attempt and they banded — at 84px each step is six device pixels wide at
3x, so the blend read as a staircase, which is worse than the hard seam it
replaced. A seam is at least deliberate.

The gradient's axis is positional rather than path-length based, which is the
property that matters: full shade at the top of the ring, edge shade a quarter
turn later, and everything past that padded. The colour at any point on the
strand depends on **where it is**, not on how far over you are, so the ramp is
nailed to the ring and cannot slide.

**Nothing marks the crossing but the cap itself.** Two other answers were built
first and both are gone.

A **drop shadow** under the leading cap — what Apple's activity rings use, and
the reference this was worked against. It reads, and it was still wrong here:
depth is a channel this app does not otherwise use. Every mark in it is flat, so
one shadow in one place would have been the only lit object on the screen.

Then a **2px gap** cut as a hole in the lap below, outlining the cap. Cheaper,
flatter, in the vocabulary already here — an edge rather than a light source. It
was also nearly invisible at 84px, and once the ramp underneath was smooth it
turned out to be answering a question that had stopped being asked. A round cap
in the darker shade, sitting on a lighter strand, reads as lapping unaided.

The order is worth keeping, because it is what actually happened: shadow → gap →
neither. Each removal only became obvious once the thing before it was built and
looked at, and none of the three could have been picked on paper.

**It stops at two laps.** Past 200% the second lap closes too and the ring stops
counting. A third lap is not something a circle can say without becoming a
puzzle, and by then the centre number is doing the work anyway — the reading
becomes "at least twice over", which is true, legible, and enough.

The `MIN_ARC` floor applies to the second lap as it does to the first, so 1g over
draws a short arc rather than a dot at 12 o'clock. Both laps animate, and both
keep their previous length while there is somewhere to run from, so deleting the
entry that put you over unwinds the lap instead of snapping it away.

### Two bugs found by drawing it large

Neither would have surfaced at 84px, and both were found by scaling one ring to
3x on screen and looking at it. Worth the thirty seconds it costs.

**A patch of the darkest paint on the strand, hanging at 11 o'clock.** The mask
that reveals the second lap was round-capped at both ends, and the cap at the
*start* reaches half a stroke backwards past 12 o'clock — which on a closed path
is the far end of the ring. It was uncovering the tail of the strand and leaving
it there, detached, on a ring that was only 129% full. The body is now square at
both ends, which is correct anyway: the strand leaves the first lap where the
first lap stopped, so a cap there is a second nose on something that never
ended. The round tip is a separate zero-length dash parked on the leading end.

**A carbs ring painting itself with the fat gradient.** `url(#id)` resolves
against the whole document and takes the first match, so the per-ring counter
was not enough — a second copy of the module starts counting at one again and
every ring it draws reaches into the first copy's gradients. The ids are now
namespaced per module instance. The symptom is the memorable part: not a crash,
not a blank, just the wrong macro's colour, sometimes.

Verified at 100 / 103 / 110 / 129 / 150 / 180 / 200%, in both schemes, on all
three macros, and at 3x. Contrast suite unchanged at 107 passing. **Still
unverified on device.**

One thing left open: at 103% the whole second lap sits inside the blend, so it
is very nearly the same picture as 100%. That is the blend behaving as designed
— barely over should look barely over — but it is the original complaint in
miniature, and `BLEND` is the one number that trades the two against each other.

---

## v1.1.6 — the status bar joins the scrim, and the add sheet gets its spacing back

Four changes, all of them about a sheet's relationship to the space around it.

### The strip behind the clock

**While a sheet is open, the status bar takes the scrimmed colour.** It had been
staying at full canvas brightness while everything below it dimmed, which put a
hard horizontal edge across the top of the screen for as long as a sheet was up
— the one moment in the app where the eye should be travelling downward, and
instead there was a line at the top competing for it.

The cause is worth stating because it is not a CSS problem and no amount of
looking at the stylesheet would have found it. On an installed PWA that strip is
painted by iOS, from the `theme-color` meta tag, before the page gets a say. The
scrim is a page element and cannot reach it. So the fix is not to extend the
scrim but to publish a second colour: `theme-color` now carries the scrimmed
value while a sheet is open and the canvas value the rest of the time.

The two values are the arithmetic the scrim already does — canvas at 65%, which
is what `black/35` over it computes to — rather than a colour picked to look
close. Sampled rather than eyeballed, so if the canvas ever moves, the mismatch
is a wrong number in one file instead of a drift nobody can name.

The cost: this is invisible in a browser and only real once the app is
installed. It is the first thing in the visual system that cannot be checked by
looking at localhost.

### One step and a half step

**The add sheet's sections are 20 apart, and the parts inside a section are 10.**
They had been 30 and 10.

30 was not wrong on its own — it is the ratio that was doing the work, and 30:10
is a stronger one than 20:10. It was wrong because nothing else in the app is at
30. Every row, card, gutter and inset is on 10 or 20, so a sheet spending 30
between its sections was running a second rhythm inside the first one, and the
sections read as floating rather than as grouped.

The grouping is the whole point of the number. A label belongs to the card under
it because it sits half as far from it as the next section does — that is the
only thing saying so, since there are no rules or boxes drawing the boundary.
It survives the change to 20:10 intact and now uses the same scale as the rest
of the app to do it.

### Space that belonged to nothing

**Containers that may be empty now collapse instead of holding their place.**

A sheet lays out in a gap column, and an empty child still takes a full gap. So
the plate bar with nothing staged, the offline notice while online, the
derived-calories hint with nothing to derive, and the validation warnings on a
valid form were each spending 20 they had no content to justify. The add sheet
opened with a 50px void under its header on that account — the header's own 20
plus a gap belonging to something that was not there.

The reason this is a design problem and not a bug is that the rhythm was
depending on state nobody could see. The sheet was correctly spaced only in the
condition it happened to be tested in, and every other condition inherited
whitespace by accident.

### Edges belong to the frame, not the contents

**The sheet's chrome owns all four insets: 20 on every side.** Each panel had
been adding 10 of its own on top of the 20 the body already held, so content
stopped at 20 from the sides and 30 from the bottom — and 30 from a footer
button that carries its own 20 underneath it.

Three values went with it that were not on the scale: the plate bar's padding,
its `Log` button, and `notice()`, which now takes exactly the box a `.row` does
so a notice sitting above a card lines up with the rows inside it.

The `Log` pill sits 10 from the three edges it touches. It had been pinned at 10
above and below by its own height while taking 20 to the right, so it read as
sitting in a slot it did not fill. The left side of that bar keeps 20, because
that side is text: a glyph needs the gutter every other row in the app gives it,
and a filled pill carries its own padding and does not. Matching the numbers on
both sides would have made the pill look further from the edge than the text.

---

## v1.1.4 — an empty bar is empty, and buttons are capsules

Two things that read as someone else's design system.

### The zero state of a bar

**A bar with nothing logged now draws no fill at all.** It had been drawing one
at `width: 0`, which is not the same as drawing nothing: the fill carries a 1px
stroke, and at zero width the left and right edges of that stroke collapse into
each other and paint a 2px coloured tick against the inside of the left cap.
One of those is a smudge. Four of them stacked down a fresh day read as a
rendering fault — the eye takes them for a bar that failed to load rather than
for a bar with nothing in it. The empty track *is* the zero state, and it does
not need a marker to say so; the coloured heading above it already carries the
macro's identity.

The fill is still built when there is a previous value to animate away from, so
deleting the last entry of the day shrinks the bar out instead of snapping. On
that path the stroke fades with the width, so the shrink does not land on the
same tick.

### Buttons

**`.btn-primary` and `.btn-secondary` are capsules** — `999px`, where they had
been `--radius-card` at 24px. 24px on a 56px box is a corner that is *smaller
than half the height*, which is the Material signature: a token-sized radius
applied to whatever it lands on. Everything else on the screen was already a
true capsule — the field, the chips, the segments, the tab bar, the icon
buttons — so a squarish button sitting in a row next to a pill field was the one
control that did not belong to the family.

The rest of the treatment is deliberately *not* Material either. No elevation,
no ripple, no letter-spacing on the label. Press feedback is a 120ms
scale-to-0.97 and a slight dim of the whole control, which is the iOS gesture
and what gives a 56px slab the sense of physical give. `.icon-btn` gets the
same, scaled harder (0.92) because it is small enough that 3% would not register.

**`.btn-compact`** is new: 48px tall, auto width, for a button that shares a row
with a field rather than owning a footer. The weight input used it immediately —
a 56px button beside a 48px field looked like it had been lifted out of a sheet,
and matching the heights is what makes the pair read as one control. The
hard-coded `w-[104px]` wrapper around it is gone; the label sizes the button now.

---

## v1.1.3 — tab bar placement, and a shorter fade

Measured off the Figma frame rather than estimated.

- **The bar sits 20px from the bottom and 20px from each side.** A flat inset,
  deliberately *not* `safe-area-inset-bottom`. That inset is 34pt on this device
  and is sized for content running edge to edge; adding it on top of a gutter
  pushed the bar ~54px up, which is what made it look like it was floating too
  high. A floating pill only has to clear the home indicator, which occupies
  about the bottom 13pt, so 20px clears it with room to spare.

- **The fade is 159px, bottom-anchored** — the exact height of the blur rect in
  the frame — where it had been 260px and washed out most of the log card.

- **The blur itself is much lighter**: three compounding layers reaching ~6px,
  down from four reaching ~25px. The Figma effect is a progressive blur of
  0 → 4, and the depth there comes from the gradient fill layered over it, not
  from the radius. Heavy blur reads as frosted glass; this reads as content
  receding. The veil ramps harder to compensate for the shorter band.

`--nav-inset`, `--nav-height` and `--nav-fade` are now shared custom properties,
so the screen's bottom padding and the toast's offset track the bar instead of
each hard-coding their own copy of the arithmetic.

---

## v1.1.2 — Inclusive Sans, and the type scale

### The family

**Inclusive Sans**, self-hosted rather than linked from Google Fonts, because a
webfont request in front of first paint is the one dependency this app cannot
have. Both files are the variable font — a single 300–700 axis covers Regular
and SemiBold — so the whole family is 46 KB. `latin-ext` is included on purpose:
Open Food Facts returns a lot of French and German product names, and without it
they would render in the fallback mid-list. OFL, license bundled.

Vite hashes the woff2 files into `assets/`, so the service worker picks them up
in the precache automatically and the font survives a cold offline launch.

### The scale, measured off the mockups

| | size | weight |
|---|---|---|
| calorie total | 48 | SemiBold |
| screen titles | 30 | SemiBold |
| section + macro labels | 16 | SemiBold |
| body, `/ 2837`, values | 16 | Regular |
| log row titles | 14 | SemiBold + Regular |
| macro line | 12 | Regular |

Five steps, and everything bold is now SemiBold (600) rather than Bold (700).

This is a step *down* from v1.1.0, which had run the scale up to 20px section
headings and a 15px macro line. That was a mistake I made reading the mockups at
low zoom — the real values were smaller, and Inclusive Sans carries enough
x-height that 12px holds up where the old system-font scale needed 15px.

### It has no tabular figures

The brief requires tabular lining figures throughout, because every number in
this app either updates live or sits in a column. Inclusive Sans has no `tnum`
feature — `font-variant-numeric` is measurably a no-op in it, and its digits vary
by **0.165em**, which is about 8px per digit at 48px. A four-digit calorie
count-up would have wobbled by ~30px.

So digits get a synthetic fixed advance instead: `.tnum > .d` sets each digit to
0.66em (the width of its widest glyph, `0`) and centres it. Every four-digit
value now measures exactly the same width. Applied only where position matters —
the calorie count-up, the history calorie column, the weekly averages, the weight
readouts, and the macro target line. Numbers inline in running text keep the
font's natural proportional spacing, which is what it was drawn for.

### Green

The mockups specify `#278544` for the Calories label. It is 4.64:1 on the white
page but **4.07:1 on the grey cards**, where the `cal` suffix in every log row
lives, so the token stays `#2A7340` — a hair darker, and 5.08:1 on grey. Same
reasoning that moved gold from `#8C7000` to `#7A6200` in v1.1.1.

### Frame

Layout is verified at **402 × 874** (iPhone 17 Pro), which with 20px gutters
gives the 363px content width the mockups are built on.

---

## v1.1.1 — overage segment, and a measured palette

### Overage is a segment of the bar, not a chip on it

Was a small pill floating inside the fill. Now a full-height segment of the
macro's darker shade, butted against the right end of the fill and clipped to
its cap by the fill's own `overflow: hidden`. The bar is one object that changes
tone where it passes the target, which is both closer to the mockups and a
better description of what actually happened.

It also fixes the legibility problem. White on a *fill* is 2.10:1 on gold and
3.28:1 on green — both unreadable. White on the darker shades runs 4.74:1 to
6.54:1, so putting the label on the darker segment is what makes `+7` work on
the gold bar at all.

### The palette is now measured, not chosen

Gold moved to `#D2B02A` as the fill. Every macro is three values:

| | fill | edge — stroke + overage | text (light) | text (dark) |
|---|---|---|---|---|
| calories | `#44A057` | `#2A7340` | `#2A7340` | `#44A057` |
| protein | `#5075BE` | `#3D5C9C` | `#3D5C9C` | `#7E9FD6` |
| fat | `#D2B02A` | `#7A6200` | `#7A6200` | `#D2B02A` |
| carbs | `#CD493D` | `#B42A2A` | `#B42A2A` | `#E2796E` |

**A fill is never used as type.** The obvious version of this rule — "measure it
on white" — is wrong, and measuring caught it: the `P`/`F`/`C` letters mostly
appear inside log rows, which are the grey `#F0F0F0` card, not the white page.
Against grey, all four fills land between 3.98:1 and 4.16:1 and every one of
them fails. The edges clear 5.0:1 there.

That is also why gold's darker shade is `#7A6200` rather than the `#8C7000` in
the brief. `#8C7000` is correct for the white page at 4.74:1, but it is 4.16:1
on a card. Two steps darker clears both grounds.

Dark mode inverts the problem — the darker shades sink into the ground, where
protein and carbs only reach 3.66:1 — so macro *type* lifts to a tint there. The
**fills still never move between themes**; only type does.

`--color-muted` went `#717171` → `#6B6B6B` for the same reason: 4.28:1 on a card.

### It is a test now, not a claim

`npm test` reads the hexes out of `styles.css` and checks 21 pairings — every
macro as type on both grounds in both themes, white on all four overage
segments, and ink and muted on both grounds. Changing a colour without
re-measuring it fails the build. Colour is the one part of this system where
"looks fine" and "is legible" genuinely diverge; the gold fill reads perfectly
as a bar and is unreadable as 15px type.

### Blur with depth

The four fixed bands read flat because the eye finds the seams between them. The
layers now compound — each is a stacked sibling that re-blurs the output of the
one beneath, so radii accumulate downward to roughly 28px at the bottom edge and
taper to nothing. Radii double while mask windows halve (`BLUR_RAMP` in
`main.js`), since perceived blur scales with the square root of the summed
radii, not linearly. The fade is 170px → 260px.

The scrim is two layers now. A veil in the **canvas** colour, so content
dissolves into the page rather than being greyed out — that is what makes the
bar read as floating above a surface instead of pasted onto one. Then a low
black gradient that only really shows in the last 60px, giving the bar an edge
to sit against.

---

## v1.1.0 — mockup pass

Reconciled against the Figma mockups. Four of these are changes to the locked
system rather than additions to it, so they are listed first.

### Changed: the ground inverted

The page is now white (`canvas #FFFFFF`) and cards are grey (`surface #F0F0F0`)
with a **1px `#D9D9D9` outline**. v1 had it the other way round — white cards on
a grey page, grouping communicated by surface alone.

The outline is what makes the inversion work. With both grounds light, surface
change alone is too weak to separate a card from the page, and it fails entirely
for a component nested inside another component. Everything structural now
carries the outline: cards, bar tracks, fields, chips, buttons, the tab bar, the
segmented control, the camera viewfinder.

### Changed: colour is allowed on macro headings

v1 restricted the four hues to bar fills and the letter suffix. The mockups
colour the "Calories" / "Protein" / "Fat" / "Carbs" headings as well, and that
is now the rule.

What has *not* changed is the constraint underneath it: colour still only ever
means macro identity. Nothing is coloured for decoration, mood, or state, there
is still no second red anywhere, and the four hues still sit in the same narrow
lightness band. The heading is macro identity, so it is allowed; an error state
is not, so it still is not.

### Changed: every filled shape carries a darker edge

Bar fills now have a 1px stroke of a darker shade of their own hue
(`--color-kcal-edge` and friends; the fat and carbs values come straight from
the mockups). The fill also sits inside its track with a 3px inset rather than
filling it edge to edge. Both together make the bar read as an object in a
channel instead of a painted region — and the inset is what keeps the track's
own outline visible behind a full bar.

### Changed: the calorie block reads number-first

Was label, number, bar. Now number at display size with the target trailing
small and grey, then the coloured label, then the bar. Display size went 40px →
56px.

### Geometry, on a grid

- **Corner radius is 24px** on everything that is not a pill: cards, sheets,
  buttons, fields, chips, the route buttons, the camera view.
- **Single-line rows are exactly 48px** with a 24px radius, which makes them
  read as pills. Rows with a subtitle grow from a 48px minimum.
- **Layout spacing is on a 10px grid**: 10 inside a group, 20 between groups, 30
  between sections, 20px screen gutters. The only sub-10 values left are
  typographic — a heading and the line directly beneath it are one unit, not
  two, and get 2–4px.
- Type scale moved up throughout. Body 15px, row titles 17px, section headings
  20px bold ink, screen titles 28px. v1's 12–13px muted labels were below the
  mockups' floor.

### Safe areas

The screen container now pads by `env(safe-area-inset-top) + 20px`, so an
installed launch clears the notch or Dynamic Island instead of running the
header underneath it. Sheets cap their height at
`100svh - env(safe-area-inset-top) - 20px` for the same reason. In a browser tab
both resolve to the 20px base, since the browser chrome already does the job.

### Tab bar

- The pill is `surface` with an outline; the **active tab is a `canvas` pill
  with an ink edge**, matching the segmented control.
- Tab icons are **filled**, not stroked — the one place the icon set departs
  from single-stroke. The gear is generated rather than hand-authored, because
  eyeballing 32 path points produces a visible wobble at 22px.
- Add button and bar are both 68px.

### Progressive blur under the tab bar

Content scrolls underneath the floating bar, so without treatment the bar sits
on live text and both become hard to read. Four banded `backdrop-filter` layers
(1 / 3 / 7 / 14px), each masked to its own window, ramp the blur toward the
bottom edge; a single blurred layer with one mask shows a visible seam where the
mask crosses 50%. A black gradient scrim rides on top — 13% at the bottom in
light, 62% in dark — giving the bar an edge to sit against. It is decorative, so
it is `aria-hidden` and `pointer-events: none`.

### Two structural fixes found while doing this

**`.panel` split out from `.card`.** `.card > * + *` draws the row dividers, so
a card used as a padded container for a laid-out block ruled a line between
every child of that layout. The weight chart, the weekly averages, the serving
preview and the notice component are `.panel` now: same surface and outline, no
dividers.

**The toast host was swallowing taps on the tab bar.** It spans the full width
at `z-[80]` and its bottom padding overlaps the add button; its children opted
into pointer events but the host never opted out. After the first toast — that
is, after your first log of the day — the add button silently stopped working.
It is `pointer-events: none` now.

---

## v1.0.0 — initial build

### The system as locked

A neutral, near-monochrome interface where colour carries exactly one job.
Black, white and grey do all the structural work. The only saturated colour in
the app is macro identity.

**Neutrals** — `ink #232323`, `canvas #F0F0F0`, `surface #FFFFFF`,
`muted #717171`, `hairline #D8D8D8`.

**Macros** — calories `#44A057`, protein `#5075BE`, fat `#CAAF3A`, carbs
`#CD493D`. All four sit in a 45–60% lightness band, which is why they read as
one deliberate set rather than four unrelated brights.

Three rules that keep it from going tacky, all of which held through the build:

1. The four hues appear in exactly two places: progress bar fills, and the
   single-letter suffix on macro values.
2. The order is fixed everywhere: calories, protein, fat, carbs.
3. Nothing else in the app is ever red, because carbs own it.

Dark mode inverts neutrals only (`#141414` / `#1E1E1E` / `#F0F0F0`). The macro
hues do not move and were not brightened.

---

### Decisions the mockups did not cover

**Progress bar height: 16 px, uniform across calories and macros.**
The overshoot chip has to sit legibly *inside* the fill, and 16 px is the
smallest height that allows a 12 px chip with 10 px text. Making the calorie bar
taller than the macro bars was tried and rejected — a uniform height keeps the
block reading as one system, and the calorie bar already carries more weight
from the display number above it.

**Overshoot chip: a 26%-black overlay pill with white text, inside the fill.**
Going over fills the track completely and shows the excess as `+74`. No colour
change, no error state. Confirmed against real data at `2911 / 2837`.

**Destructive and error states are ink and grey.**
Resolving the flag raised in the brief. Delete confirmations, the offline
notice, the storage-unavailable screen, and every "this looks wrong" warning on
imported nutrition data are neutral. There is no second red in the app.

**A "remaining" number was not added.** `2504 / 2837` covers it.

---

### Deviations from the written spec, with reasons

**Secondary action buttons in the Add sheet are `surface`, not "light grey".**
The spec asks for Scan in solid dark with the other two "in light grey". The
sheet's ground *is* light grey (`canvas`), so grey-on-grey would disappear. They
use `surface` white, which is already the established treatment for an
unselected control elsewhere in the app (chips, segmented controls). The
intent — neutral, clearly unselected, visibly secondary to Scan — is preserved.

**Segmented controls carry two ground variants.**
Same problem in reverse: a white track vanishes on a white card. `on: 'card'`
switches the track to `canvas`. No new colour, just the existing two neutrals
swapping roles by context.

**The serving sheet's unit toggle uses bare unit names.**
It first read `serving (1 scoop (30 g))`, which nests parentheses, wraps to two
lines, and squeezes the adjacent `g` segment into a sliver. The segments are now
`servings` / `g`, and the serving definition moved to a hint line under the
amount field: `1 serving = 1 scoop (30 g)`.

**The serving sheet shows calories once, not twice.**
The live preview was printing the calorie total as the display number *and*
again at the head of the macro line. The macro line now omits calories there.

**The food detail nutrition table drops the colour-coded letter suffix.**
"Calories cal" reads badly, and the table's label column already uses full
words. Colour identity in that view is carried by the macro line directly above
it. This is the one place a macro value appears without its coloured letter, and
it is deliberate.

**A pin affordance was added to the serving sheet.**
The spec puts favourites management in Settings, and it stays there — reorder,
rename and unpin all live in Settings → Favourites. But the moment you realise
you eat something constantly is the moment you are logging it, not the next time
you open Settings, so the serving sheet carries a star. Same icon, same filled
state convention as the food detail view.

**Type is the system grotesque stack, not a webfont.**
SF Pro on the target device is a neo-grotesque with tabular figures, costs
nothing to load, and cannot fail offline. Tabular lining figures are on
globally, so every number that updates live or sits in a column holds its width.

---

### Motion

Implemented as specified — fires once, in response to the user, then gets out of
the way. Bar fills 250 ms ease-out, numbers count up over 200 ms, sheets slide
up with the background dimming behind, swipe-to-reveal tracks the finger with no
spring. All of it collapses under `prefers-reduced-motion`.

One correction during the build: bars and the calorie total were replaying their
entrance animation from zero on *every* re-render, because screens rebuild their
subtree whenever data changes. They now remember their last drawn value and
animate from it, so logging one more item ticks `2255 → 2489` rather than
restarting at zero. The spec said "animate on value change only"; this is what
that actually requires.
