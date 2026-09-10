import { h, s } from './dom.js'
import { rowChevron } from './ui.js'

/**
 * One tile on the Trends grid.
 *
 * **The header is the same on every tile.** Title in ink on the left, a
 * chevron on the right when the tile opens somewhere, and nothing else. Accent
 * colour comes from the content underneath, never from the title, so the grid
 * reads as one set of boxes whatever each one is about.
 *
 * **The header row is the tap target, not the tile.** A tile can carry its own
 * controls — Weight has a Log button — and a button cannot sit inside another
 * button. So when there is an `onPress` the header becomes the button, padded
 * out to the 44px row the rest of the app taps, and the body stays inert. The
 * cost is that a tap on the chart does nothing; the chevron is where it says
 * it is.
 *
 * `size` is 'full' or 'half'. The tile does not lay itself out. It says which
 * it is, and `.trends-grid` reads that.
 */
/** Apple's reorder control: three lines, muted, on a 44px target. */
function grip(title) {
  return h(
    'button',
    {
      class: 'grip',
      type: 'button',
      'aria-label': `Reorder ${title}. Use the arrow keys to move it.`,
    },
    s(
      'svg',
      {
        width: 20,
        height: 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'aria-hidden': 'true',
      },
      s('path', { d: 'M4 7h16M4 12h16M4 17h16' }),
    ),
  )
}

/**
 * The content picker a tile shows in edit mode. Each option names the most
 * that variant shows, so the choice reads as "how much of this do I want"
 * rather than as a size. A tile with one variant shows none.
 */
function variantControl({ options, value, onChange, short = false }) {
  return h(
    'div',
    { class: 'variant-control', role: 'radiogroup', 'aria-label': 'Tile size' },
    ...options.map((o) =>
      h(
        'button',
        {
          class: 'variant-option',
          type: 'button',
          role: 'radio',
          'aria-checked': o.value === value ? 'true' : 'false',
          'aria-label': short ? o.label : null,
          onclick: () => o.value !== value && onChange(o.value),
        },
        short ? o.label[0] : o.label,
      ),
    ),
  )
}

export function trendTile(
  {
    id,
    title,
    size = 'full',
    onPress = null,
    editing = false,
    variants = null,
    variant = null,
    onVariant = null,
  },
  ...children
) {
  const label = h('span', { class: 'text-[16px] font-semibold leading-tight text-ink' }, title)

  /**
   * In edit mode the chevron gives way to a grip and the header stops being
   * a button; the tile's only job then is to be moved or resized. The picker
   * sits beside the title on a full tile, where it fits, and under the header
   * on a half tile, where it does not. Wrapping was tried and put the three
   * things on three lines.
   */
  // A half tile has 130px for the picker. Two words fit; three do not, so a
  // three-way picker on a half tile shows initials and keeps the words for
  // the accessible name.
  const picker =
    editing && variants
      ? variantControl({
          options: variants,
          value: variant,
          onChange: onVariant,
          short: size !== 'full' && variants.length > 2,
        })
      : null

  const header = editing
    ? h(
        'div',
        { class: 'trend-tile-head flex items-center gap-[10px]' },
        label,
        size === 'full' ? picker : null,
        h('span', { class: 'ml-auto' }, grip(title)),
      )
    : onPress
      ? h(
          'button',
          {
            class:
              'trend-tile-head -my-[10px] flex w-full items-center justify-between gap-[10px] py-[10px] text-left',
            type: 'button',
            onclick: onPress,
          },
          label,
          rowChevron(),
        )
      : h('div', { class: 'trend-tile-head flex items-center justify-between gap-[10px]' }, label)

  return h(
    'section',
    {
      class: 'trend-tile flex flex-col gap-[16px]',
      dataset: { size, tile: id },
      'aria-label': title,
    },
    header,
    editing && size !== 'full' ? picker : null,
    ...children,
  )
}

/**
 * Two columns with the app's 10px gap. Full tiles span both, halves take one
 * cell each, so a pair of halves lands side by side with no row bookkeeping.
 * Tiles are given in display order.
 */
export function trendsGrid(tiles) {
  return h('div', { class: 'trends-grid' }, ...tiles)
}
