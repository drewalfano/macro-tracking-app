import { createHash } from 'node:crypto'

/**
 * The service worker's cache identity, derived from what is actually in it.
 *
 * It used to be the combined byte LENGTH of the bundle in base 36. That is not
 * a content hash and it was not close to one: a fix that swaps one character
 * for another, a colour token changed in place, or a corrected number the same
 * width as the wrong one all produce a bundle of exactly the same length, and
 * the worker would look at the new build, see the version it already had, and
 * keep serving the old one out of the shell cache. The icons were not counted
 * at all, so a new icon could never change the version by itself.
 *
 * A digest cannot be fooled that way. Every part is fed in under its name, so
 * two builds that differ only in which file a byte lives in still differ, and
 * the parts are sorted first so the answer does not depend on the order Rollup
 * happened to hand them over in.
 *
 * Twelve hex characters, which is 48 bits. Plenty for "did the shell change",
 * and short enough to read in a cache name.
 *
 * @param {Array<{name: string, content: string | Uint8Array}>} parts
 * @returns {string}
 */
export function cacheVersion(parts) {
  const hash = createHash('sha256')
  const sorted = [...parts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const { name, content } of sorted) {
    hash.update(name)
    hash.update('\0')
    hash.update(typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content))
    hash.update('\0')
  }
  return hash.digest('hex').slice(0, 12)
}
