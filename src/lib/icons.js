/**
 * The whole icon set. Single stroke weight, no fills except where a control is
 * in a selected state. Keeping these in one file makes it obvious when the set
 * is growing — if this list gets long, something has gone wrong with the UI.
 */

/**
 * Filled icons, used only in the tab bar. Everything else stays single stroke.
 *
 * All three are SF Symbols — `calendar`, `chart.line.uptrend.xyaxis`, and
 * `gearshape.fill` — copied out of the SF Symbols app as SVG at 20pt, Medium
 * symbol scale. Note Apple's licence covers these for Apple-platform software
 * and does not permit modification; this app is a web PWA and the transforms
 * below are modifications, so both feet are outside it.
 *
 * Three things are done to Apple's export on the way in, all of them required:
 *
 *   - The XML declaration, DOCTYPE, `<svg>` wrapper and the `<rect opacity="0">`
 *     bounding box are dropped. `icon()` builds its own wrapper.
 *   - `fill="black" fill-opacity="0.85"` comes off every path. Left on, the
 *     black overrides `currentColor` and the tab stops going grey-to-ink on
 *     selection; the 0.85 makes every glyph faintly translucent.
 *   - Each is wrapped in a `<g transform>` that lands it on the 24 grid.
 *
 * The scale factor is the SAME 0.98 for all three rather than fitted per icon.
 * Apple draws these to balance against each other at a shared point size, so
 * the differing bounding boxes are deliberate — a gear really is taller than a
 * calendar. Fitting each to 24 separately throws that away and leaves the
 * calendar visibly oversized next to the gear.
 *
 * `chart.line.uptrend.xyaxis` is a STROKE symbol, but Apple's SVG export bakes
 * the stroke into filled outlines, so it belongs here rather than in `P` and
 * has no live stroke-width. Its axis measures 1.54 units where the outline set
 * uses 1.75, which is why it reads lighter than the two icons beside it.
 * Changing that means re-exporting at a heavier weight, not editing this file.
 */
export const FILLED = {
  calendarFilled:
    '<g transform="translate(2.29 3.18) scale(0.98)"><path d="M3.06641 17.998L16.4062 17.998C18.4473 17.998 19.4629 16.9824 19.4629 14.9707L19.4629 3.04688C19.4629 1.03516 18.4473 0.0195312 16.4062 0.0195312L3.06641 0.0195312C1.02539 0.0195312 0 1.02539 0 3.04688L0 14.9707C0 16.9922 1.02539 17.998 3.06641 17.998ZM2.91992 16.4258C2.05078 16.4258 1.57227 15.9668 1.57227 15.0586L1.57227 5.84961C1.57227 4.95117 2.05078 4.48242 2.91992 4.48242L16.5332 4.48242C17.4023 4.48242 17.8906 4.95117 17.8906 5.84961L17.8906 15.0586C17.8906 15.9668 17.4023 16.4258 16.5332 16.4258ZM7.83203 7.98828L8.4082 7.98828C8.75 7.98828 8.85742 7.89062 8.85742 7.54883L8.85742 6.97266C8.85742 6.63086 8.75 6.52344 8.4082 6.52344L7.83203 6.52344C7.49023 6.52344 7.37305 6.63086 7.37305 6.97266L7.37305 7.54883C7.37305 7.89062 7.49023 7.98828 7.83203 7.98828ZM11.0742 7.98828L11.6504 7.98828C11.9922 7.98828 12.1094 7.89062 12.1094 7.54883L12.1094 6.97266C12.1094 6.63086 11.9922 6.52344 11.6504 6.52344L11.0742 6.52344C10.7324 6.52344 10.6152 6.63086 10.6152 6.97266L10.6152 7.54883C10.6152 7.89062 10.7324 7.98828 11.0742 7.98828ZM14.3164 7.98828L14.8926 7.98828C15.2344 7.98828 15.3516 7.89062 15.3516 7.54883L15.3516 6.97266C15.3516 6.63086 15.2344 6.52344 14.8926 6.52344L14.3164 6.52344C13.9746 6.52344 13.8672 6.63086 13.8672 6.97266L13.8672 7.54883C13.8672 7.89062 13.9746 7.98828 14.3164 7.98828ZM4.58984 11.1816L5.15625 11.1816C5.50781 11.1816 5.61523 11.084 5.61523 10.7422L5.61523 10.166C5.61523 9.82422 5.50781 9.72656 5.15625 9.72656L4.58984 9.72656C4.23828 9.72656 4.13086 9.82422 4.13086 10.166L4.13086 10.7422C4.13086 11.084 4.23828 11.1816 4.58984 11.1816ZM7.83203 11.1816L8.4082 11.1816C8.75 11.1816 8.85742 11.084 8.85742 10.7422L8.85742 10.166C8.85742 9.82422 8.75 9.72656 8.4082 9.72656L7.83203 9.72656C7.49023 9.72656 7.37305 9.82422 7.37305 10.166L7.37305 10.7422C7.37305 11.084 7.49023 11.1816 7.83203 11.1816ZM11.0742 11.1816L11.6504 11.1816C11.9922 11.1816 12.1094 11.084 12.1094 10.7422L12.1094 10.166C12.1094 9.82422 11.9922 9.72656 11.6504 9.72656L11.0742 9.72656C10.7324 9.72656 10.6152 9.82422 10.6152 10.166L10.6152 10.7422C10.6152 11.084 10.7324 11.1816 11.0742 11.1816ZM14.3164 11.1816L14.8926 11.1816C15.2344 11.1816 15.3516 11.084 15.3516 10.7422L15.3516 10.166C15.3516 9.82422 15.2344 9.72656 14.8926 9.72656L14.3164 9.72656C13.9746 9.72656 13.8672 9.82422 13.8672 10.166L13.8672 10.7422C13.8672 11.084 13.9746 11.1816 14.3164 11.1816ZM4.58984 14.3848L5.15625 14.3848C5.50781 14.3848 5.61523 14.2773 5.61523 13.9355L5.61523 13.3594C5.61523 13.0176 5.50781 12.9199 5.15625 12.9199L4.58984 12.9199C4.23828 12.9199 4.13086 13.0176 4.13086 13.3594L4.13086 13.9355C4.13086 14.2773 4.23828 14.3848 4.58984 14.3848ZM7.83203 14.3848L8.4082 14.3848C8.75 14.3848 8.85742 14.2773 8.85742 13.9355L8.85742 13.3594C8.85742 13.0176 8.75 12.9199 8.4082 12.9199L7.83203 12.9199C7.49023 12.9199 7.37305 13.0176 7.37305 13.3594L7.37305 13.9355C7.37305 14.2773 7.49023 14.3848 7.83203 14.3848ZM11.0742 14.3848L11.6504 14.3848C11.9922 14.3848 12.1094 14.2773 12.1094 13.9355L12.1094 13.3594C12.1094 13.0176 11.9922 12.9199 11.6504 12.9199L11.0742 12.9199C10.7324 12.9199 10.6152 13.0176 10.6152 13.3594L10.6152 13.9355C10.6152 14.2773 10.7324 14.3848 11.0742 14.3848Z"/></g>',

  chartFilled:
    '<g transform="translate(1.53 3.09) scale(0.98)"><path d="M7.25586 6.5332L10.8496 10.2148C10.9375 10.3027 11.0352 10.3516 11.1133 10.3516C11.2012 10.3516 11.2988 10.293 11.3867 10.2148L15.2418 6.32939L16.421 7.5112L12.4414 11.5137C12.002 11.9434 11.582 12.1582 11.1133 12.1582C10.6543 12.1582 10.2148 11.9531 9.79492 11.5137L6.20117 7.83203C6.11328 7.74414 6.02539 7.69531 5.9375 7.69531C5.84961 7.69531 5.76172 7.74414 5.67383 7.83203L1.57227 12.0115L1.57227 9.62911L4.61914 6.5332C5.05859 6.07422 5.47852 5.88867 5.9375 5.88867C6.39648 5.88867 6.82617 6.09375 7.25586 6.5332Z"/><path d="M20.4102 3.03711L18.9648 8.75977C18.8379 9.25781 18.3789 9.47266 18.0273 9.12109L13.623 4.70703C13.2715 4.35547 13.4863 3.90625 13.9844 3.76953L19.6973 2.33398C20.1367 2.2168 20.5273 2.58789 20.4102 3.03711Z"/><path d="M0 17.4023C0 17.8711 0.3125 18.1738 0.78125 18.1738L20.2051 18.1738C20.6348 18.1738 20.9961 17.832 20.9961 17.3926C20.9961 16.9629 20.6348 16.6113 20.2051 16.6113L1.8457 16.6113C1.64062 16.6113 1.57227 16.543 1.57227 16.3379L1.57227 0.898438C1.57227 0.478516 1.2207 0.117188 0.791016 0.117188C0.351562 0.117188 0 0.478516 0 0.898438Z"/></g>',

  gearFilled:
    '<g transform="translate(1.82 1.99) scale(0.98)"><path d="M9.30664 20.4102L11.1035 20.4102C11.6113 20.4102 11.9727 20.1074 12.0898 19.6094L12.5977 17.4609C12.9785 17.334 13.3496 17.1875 13.6719 17.0312L15.5566 18.1836C15.9766 18.4473 16.4551 18.4082 16.8066 18.0566L18.0664 16.8066C18.418 16.4551 18.4668 15.9473 18.1836 15.5273L17.0312 13.6621C17.1973 13.3203 17.3438 12.9688 17.4512 12.6172L19.6191 12.0996C20.1172 11.9824 20.4102 11.6211 20.4102 11.1133L20.4102 9.3457C20.4102 8.84766 20.1172 8.48633 19.6191 8.36914L17.4707 7.85156C17.3438 7.45117 17.1875 7.08984 17.0508 6.78711L18.2031 4.89258C18.4668 4.46289 18.4473 4.00391 18.0859 3.64258L16.8066 2.38281C16.4453 2.05078 16.0059 1.97266 15.5859 2.23633L13.6719 3.41797C13.3594 3.25195 12.998 3.10547 12.5977 2.97852L12.0898 0.800781C11.9727 0.302734 11.6113 0 11.1035 0L9.30664 0C8.79883 0 8.4375 0.302734 8.31055 0.800781L7.80273 2.95898C7.42188 3.08594 7.05078 3.23242 6.71875 3.4082L4.82422 2.23633C4.4043 1.97266 3.94531 2.03125 3.59375 2.38281L2.32422 3.64258C1.96289 4.00391 1.93359 4.46289 2.20703 4.89258L3.34961 6.78711C3.22266 7.08984 3.06641 7.45117 2.93945 7.85156L0.791016 8.36914C0.292969 8.48633 0 8.84766 0 9.3457L0 11.1133C0 11.6211 0.292969 11.9824 0.791016 12.0996L2.95898 12.6172C3.06641 12.9688 3.21289 13.3203 3.36914 13.6621L2.22656 15.5273C1.93359 15.9473 1.99219 16.4551 2.34375 16.8066L3.59375 18.0566C3.94531 18.4082 4.43359 18.4473 4.85352 18.1836L6.72852 17.0312C7.06055 17.1875 7.42188 17.334 7.80273 17.4609L8.31055 19.6094C8.4375 20.1074 8.79883 20.4102 9.30664 20.4102ZM10.2051 13.6523C8.30078 13.6523 6.75781 12.1094 6.75781 10.2051C6.75781 8.30078 8.30078 6.75781 10.2051 6.75781C12.1094 6.75781 13.6523 8.30078 13.6523 10.2051C13.6523 12.1094 12.1094 13.6523 10.2051 13.6523Z"/></g>',
}

/**
 * The sparkle, named in halves.
 *
 * `sparkle` below is these two concatenated and is what every ordinary caller
 * uses. They are separate constants because the waiting mark draws them as two
 * elements on two different clocks — see `sparkleHalf` and the `sparkle-big` /
 * `sparkle-small` keyframes in styles.css.
 *
 * They are separate CONSTANTS rather than duplicated path data because there is
 * exactly one definition of this glyph in the app and it stays that way. An
 * edit to the star's geometry lands in both places by construction.
 */
const SPARKLE_BIG =
  '<path d="M11 3.5l1.6 4.4a2 2 0 001.2 1.2l4.4 1.6-4.4 1.6a2 2 0 00-1.2 1.2L11 17.9l-1.6-4.4a2 2 0 00-1.2-1.2L3.8 10.7l4.4-1.6a2 2 0 001.2-1.2z"/>'
const SPARKLE_SMALL =
  '<path d="M17.8 15.2l.6 1.6a1 1 0 00.6.6l1.6.6-1.6.6a1 1 0 00-.6.6l-.6 1.6-.6-1.6a1 1 0 00-.6-.6l-1.6-.6 1.6-.6a1 1 0 00.6-.6z"/>'

const P = {
  /**
   * The four chevrons, centred in the 24 box. Two of them were not.
   *
   * `chevronLeft` spanned x 8–15 and `chevronRight` x 9–16, so each sat half a
   * unit off the box's own centre — and, being mirror images drawn from
   * different start points, they were off in OPPOSITE directions. The pair at
   * the top of Today are the visible case: two 44px circles either side of the
   * day title, their glyphs leaning apart by a combined 0.83px at `size: 20`.
   * Small, and exactly the kind of thing that reads as "slightly wrong" without
   * being nameable.
   *
   * Both now span 8.5–15.5, centre 12. The vertical pair were already centred
   * (5–19 about 12) and are unchanged; they are here for the symmetry of having
   * the set written the same way.
   *
   * Note this does NOT close the gap between a trailing chevron's ink and a
   * row's right inset — the glyph is 7 units wide in a 24 box, so it carries
   * about 7px of bearing at `size: 20` whatever its position. That is handled
   * where the chevron is placed; see `listRow` in lib/ui.js.
   */
  chevronLeft: '<path d="M15.5 5l-7 7 7 7"/>',
  chevronRight: '<path d="M8.5 5l7 7-7 7"/>',
  /** Apple's reorder control: three lines. */
  grip: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevronDown: '<path d="M5 9l7 7 7-7"/>',
  chevronUp: '<path d="M19 15l-7-7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',

  search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5L16.5 16.5"/>',
  /**
   * Brackets with bars inside, per the mock. The single horizontal line this
   * used to carry was a scanner beam — it says "a laser passes over this",
   * which is a picture of the machine rather than of the thing you point the
   * phone at. The bars say barcode, which is what someone is looking for when
   * they hold a packet up.
   */
  scan:
    '<path d="M4 8.5V6a2 2 0 012-2h2.5M15.5 4H18a2 2 0 012 2v2.5M20 15.5V18a2 2 0 01-2 2h-2.5M8.5 20H6a2 2 0 01-2-2v-2.5"/><path d="M8.5 8.5v7M11.5 8.5v7M14.5 8.5v7M17 8.5v7"/>',
  custom: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 9v6M9 12h6"/>',
  /**
   * Two four-point stars, the larger one off-centre.
   *
   * The convention every app has landed on for "a model did this", and the one
   * place this set borrows a meaning from outside itself rather than drawing
   * the thing. There is no picture of "describe it in words" — a speech bubble
   * would say "chat", which this deliberately is not, and a pencil is already
   * the app's edit glyph.
   *
   * Concave curves rather than straight-sided points: at 24px a star drawn with
   * straight edges reads as a plus sign with the corners knocked off.
   */
  sparkle: SPARKLE_BIG + SPARKLE_SMALL,
  barcode: '<path d="M4 6v12M8 6v12M11.5 6v12M15 6v12M20 6v12"/>',
  camera:
    '<path d="M3 8.5A2.5 2.5 0 015.5 6h1.7a1 1 0 00.83-.45l.94-1.4A1 1 0 019.8 3.7h4.4a1 1 0 01.83.45l.94 1.4A1 1 0 0016.8 6h1.7A2.5 2.5 0 0121 8.5v9a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z"/><circle cx="12" cy="13" r="3.5"/>',

  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  weight:
    '<rect x="3" y="4" width="18" height="17" rx="4"/><path d="M8.5 15a3.5 3.5 0 117 0"/><path d="M12 15l2.6-3"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/><path d="M19.1 14.5a1.6 1.6 0 00.32 1.77l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.6 1.6 0 00-1.77-.32 1.6 1.6 0 00-.97 1.46V21a2 2 0 11-4 0v-.11a1.6 1.6 0 00-1.05-1.46 1.6 1.6 0 00-1.77.32l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.6 1.6 0 00.32-1.77 1.6 1.6 0 00-1.46-.97H3a2 2 0 110-4h.11a1.6 1.6 0 001.46-1.05 1.6 1.6 0 00-.32-1.77l-.06-.06a2 2 0 112.83-2.83l.06.06a1.6 1.6 0 001.77.32H9a1.6 1.6 0 00.97-1.46V3a2 2 0 114 0v.11a1.6 1.6 0 00.97 1.46 1.6 1.6 0 001.77-.32l.06-.06a2 2 0 112.83 2.83l-.06.06a1.6 1.6 0 00-.32 1.77V9a1.6 1.6 0 001.46.97H21a2 2 0 110 4h-.11a1.6 1.6 0 00-1.46.97z"/>',
  home: '<path d="M4 10.5L12 4l8 6.5V19a2 2 0 01-2 2H6a2 2 0 01-2-2z"/>',
  library:
    '<path d="M5 4.5A1.5 1.5 0 016.5 3H19v18H6.5A1.5 1.5 0 015 19.5z"/><path d="M5 17.5h14"/><path d="M9 7h6"/>',

  pencil: '<path d="M12.5 20H21"/><path d="M16.4 3.6a2.1 2.1 0 113 3L7.5 18.5l-4 1 1-4z"/>',
  trash: '<path d="M3.5 6.5h17"/><path d="M9 6.5V4.5h6v2"/><path d="M18.5 6.5l-1 14h-11l-1-14"/>',
  undo: '<path d="M3.5 10h11a5.5 5.5 0 010 11h-3"/><path d="M7.5 6l-4 4 4 4"/>',
  duplicate:
    '<rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.8-5.2-2.73-5.2 2.73 1-5.8-4.2-4.1 5.8-.85z"/>',

  download: '<path d="M12 3.5v12"/><path d="M7 10.5l5 5 5-5"/><path d="M4 20.5h16"/>',
  upload: '<path d="M12 20.5v-12"/><path d="M7 13.5l5-5 5 5"/><path d="M4 3.5h16"/>',
  share: '<path d="M12 15V3"/><path d="M8 7l4-4 4 4"/><path d="M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.5v5M12 7.75v.5"/>',
  alert:
    '<path d="M10.3 4.3L2.8 17.5A2 2 0 004.5 20.5h15a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z"/><path d="M12 9.5v4M12 16.75v.25"/>',
  offline:
    '<path d="M3 3l18 18"/><path d="M5.5 10.5a10 10 0 013.2-2.1M12 5c3 0 5.8 1.1 8 3"/><path d="M8.5 14a6 6 0 015-1.1"/><path d="M12 18.5v.01"/>',
}

/**
 * @param {keyof typeof P} name
 * @param {{size?: number, stroke?: number, filled?: boolean, class?: string}} opts
 */
export function icon(name, opts = {}) {
  const { size = 22, stroke = 1.75, filled = false } = opts
  const solid = FILLED[name]
  const inner = solid ?? P[name]
  if (!inner) throw new Error(`Unknown icon: ${name}`)

  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.setAttribute('viewBox', '0 0 24 24')
  el.setAttribute('width', size)
  el.setAttribute('height', size)
  el.setAttribute('fill', solid || filled ? 'currentColor' : 'none')
  el.setAttribute('stroke', solid ? 'none' : 'currentColor')
  el.setAttribute('stroke-width', stroke)
  el.setAttribute('stroke-linecap', 'round')
  el.setAttribute('stroke-linejoin', 'round')
  el.setAttribute('aria-hidden', 'true')
  if (opts.class) el.setAttribute('class', opts.class)
  el.innerHTML = inner
  return el
}

/**
 * One star of the sparkle, on its own, for the waiting mark to animate.
 *
 * Filled with the stroke off, which is the same treatment `estimateBadge` gives
 * the whole glyph and for the same reason: at this size an outline star is
 * mostly stroke and the concave points close up into a blob.
 *
 * The two halves come back as two SEPARATE `<svg>` elements rather than as two
 * paths in one, and that is the whole point of this function. A `transform` on
 * a path INSIDE an svg is not reliably promoted to the compositor in WebKit, so
 * animating the halves that way would repaint the glyph every frame on the one
 * platform this ships to. A whole svg element transforms like any other box.
 *
 * Both are the full 24 viewBox with one star in it, so each sits where it sits
 * in the complete mark and the pair stacks into the same glyph. Which means the
 * scale origin has to be written per star — see the keyframes.
 *
 * @param {'big'|'small'} which
 */
export function sparkleHalf(which, opts = {}) {
  const { size = 20 } = opts
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  el.setAttribute('viewBox', '0 0 24 24')
  el.setAttribute('width', size)
  el.setAttribute('height', size)
  el.setAttribute('fill', 'currentColor')
  el.setAttribute('stroke', 'none')
  el.setAttribute('aria-hidden', 'true')
  if (opts.class) el.setAttribute('class', opts.class)
  el.innerHTML = which === 'small' ? SPARKLE_SMALL : SPARKLE_BIG
  return el
}

export const ICON_NAMES = [...Object.keys(P), ...Object.keys(FILLED)]
