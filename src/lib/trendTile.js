import { h } from './dom.js'
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
export function trendTile({ id, title, size = 'full', onPress = null }, ...children) {
  const label = h('span', { class: 'text-[16px] font-semibold leading-tight text-ink' }, title)

  const header = onPress
    ? h(
        'button',
        {
          class: 'trend-tile-head -my-[10px] flex w-full items-center justify-between gap-[10px] py-[10px] text-left',
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
