/**
 * Where the API key lives.
 *
 * `localStorage`, not IndexedDB, and the reason is `exportAll`. Every backup
 * this app produces is a walk over the IndexedDB stores, so a key kept there
 * would ride along in the JSON file on every export — a file whose whole purpose
 * is to be saved somewhere else, and which somebody might reasonably hand to a
 * second device or attach to an email. The settings store is also the one place
 * an import can overwrite, which would mean a restore silently swapping the key.
 *
 * Keeping it out of that store is the only way to make "not included in an
 * export" true by construction rather than by remembering to filter it.
 *
 * The namespace matches the one key the app already keeps here, `mt:theme`.
 * The database is still called `macro-tracker` and this is the same generation
 * of that name; renaming the prefix to match the app's would orphan the theme.
 *
 * Nothing in this module logs the value, and nothing outside it should either.
 */

const STORAGE_KEY = 'mt:aiKey'

/**
 * Every access is guarded.
 *
 * `localStorage` is not merely empty in some private-browsing modes — reading
 * the property throws outright. `db.js` already treats storage as something
 * that can fail rather than something that is simply there, and a Settings
 * screen that white-screens on the way to a field somebody may never use would
 * be a much worse bargain than a field that quietly reads empty.
 */
function read() {
  try {
    return localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/** @returns {string} the stored key, or '' when there is none. */
export function getAiKey() {
  return read().trim()
}

/**
 * Whether AI Describe has a key to work with.
 *
 * NOT whether the feature is available. The rules parser and the resolution
 * chain run with no key at all, so this answers "can it estimate and can it
 * split what the rules would not", which is a smaller question.
 */
export function hasAiKey() {
  return getAiKey().length > 0
}

/** @returns {boolean} false when storage refused the write. */
export function setAiKey(value) {
  const next = String(value ?? '').trim()
  if (!next) return clearAiKey()
  try {
    localStorage.setItem(STORAGE_KEY, next)
    return true
  } catch {
    return false
  }
}

export function clearAiKey() {
  try {
    localStorage.removeItem(STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------ preference */

/**
 * Whether Describe may send anything, kept apart from whether it could.
 *
 * A stored key says a request would be accepted. It does not say the person
 * wants one made, and for a while the two were read as the same thing: the
 * sheet offered a "send to Gemini" button to anyone with a key, and every tap
 * of it was a fresh decision to let words leave the phone. That is honest and
 * it is also what made the flow feel like a choice of processing methods
 * rather than a way to log a meal.
 *
 * So the decision is made once and remembered here. `on` means the sheet
 * sends the fragments it could not place itself, automatically, every time.
 * `off` means it never sends and says so. Unset — the state every existing
 * key is in — means the sheet asks the first time it has something it would
 * send, records the answer, and does not ask again. A key on its own never
 * turns this on; the switch in Settings and the one-time question in the
 * sheet are the only two things that write it.
 *
 * Stored beside the key and for the same reason: it is not data, it does not
 * belong in a backup, and a restore must not flip it.
 */
const MODE_KEY = 'mt:aiDescribe'

/** @returns {'on' | 'off' | ''} '' means never decided. */
export function getAiMode() {
  try {
    const v = localStorage.getItem(MODE_KEY)
    return v === 'on' || v === 'off' ? v : ''
  } catch {
    return ''
  }
}

/** @param {'on' | 'off'} mode */
export function setAiMode(mode) {
  try {
    if (mode === 'on' || mode === 'off') localStorage.setItem(MODE_KEY, mode)
    else localStorage.removeItem(MODE_KEY)
    return true
  } catch {
    return false
  }
}

/** Sending is allowed: there is a key, and the person has said yes. */
export function aiEnabled() {
  return hasAiKey() && getAiMode() === 'on'
}

/** There is a key and no decision yet, so the sheet may ask once. */
export function aiUndecided() {
  return hasAiKey() && getAiMode() === ''
}
