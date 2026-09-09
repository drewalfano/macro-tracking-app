import { stampRows, carryCorrections } from './describeDraft.js'

/**
 * The state behind the review, with no DOM in it.
 *
 * A read is two asynchronous phases — understand the description, then look
 * up every food it named — and both can be overtaken: the description gets
 * edited mid-read, "Reanalyse" is pressed while the first answer is still
 * out, a row is retried twice. Every one of those used to be a way for an old
 * answer to land on a new list. So the session numbers each read, and no
 * result is allowed to touch the rows unless it belongs to the read that is
 * current. A superseded read's answers are dropped on arrival, not merged.
 *
 * Injected readers, so the whole state machine runs in node: `interpret`
 * turns text into rows, `lookup` turns one row into the fields that settle
 * it. The sheet composes the real ones — the model with a local fallback, and
 * the resolution chain — and the tests hand in deferreds.
 *
 * The rows are plain objects the sheet is allowed to mutate (an amount typed
 * into an editor is written straight onto the row). What the session owns is
 * the LIST and the pending flags, and it is the only thing that sets either
 * from an asynchronous result.
 */

/** A lookup that has not answered by this point is a lookup that failed. */
const LOOKUP_CEILING_MS = 30000

/**
 * A signal that fires on the parent's abort or after `ms`, whichever is first.
 * Returns the controller and a way to stop the clock, for the happy path.
 */
function linkedTimeout(parent, ms) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  if (parent.aborted) controller.abort()
  else parent.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), ms)
  const release = () => {
    clearTimeout(timer)
    parent.removeEventListener('abort', onAbort)
  }
  return { controller, release }
}

/**
 * @param {object} deps
 * @param {(text: string, opts: {signal: AbortSignal}) => Promise<{items: object[], source: string, notice?: string|null}>} deps.interpret
 * @param {(row: object, opts: {signal: AbortSignal}) => Promise<object>} deps.lookup  resolves to a patch for the row
 * @param {(state: object) => void} [deps.onChange]
 * @param {number} [deps.lookupCeilingMs]
 */
export function createDescribeSession({ interpret, lookup, onChange = () => {}, lookupCeilingMs = LOOKUP_CEILING_MS }) {
  let generation = 0
  let controller = null

  const state = {
    /** 'idle' | 'interpreting' | 'looking-up' | 'done' | 'failed' */
    phase: 'idle',
    /** The rows under review, in the order the sentence named them. */
    items: [],
    /** Where the current rows came from: 'gemini' | 'local' | null. */
    source: null,
    /** A sentence about the read as a whole, from the interpreter, or null. */
    notice: null,
    /** The error that ended a read in 'failed', or null. */
    error: null,
  }

  const current = (gen) => gen === generation
  const emit = () => onChange(state)
  const busy = () => state.phase === 'interpreting' || state.items.some((row) => row.pending)

  /** The pending flag comes off and the phase follows the last row to land. */
  const settle = (gen) => {
    if (!current(gen)) return
    if (state.phase === 'looking-up' && !state.items.some((row) => row.pending)) state.phase = 'done'
    emit()
  }

  /**
   * Look one row up under one read. The answer is applied only if that read
   * is still the current one AND the row is still on the list — a row removed
   * mid-flight stays removed, and a row retried twice takes the later answer
   * only because the earlier one was cancelled by the retry's own abort.
   */
  async function lookupRow(row, gen, signal) {
    const { controller: own, release } = linkedTimeout(signal, lookupCeilingMs)
    row.pending = true
    row.failed = null
    row.lookup = own
    try {
      const patch = await lookup(row, { signal: own.signal })
      if (!current(gen) || !state.items.includes(row) || row.lookup !== own) return
      Object.assign(row, patch)
    } catch (err) {
      if (!current(gen) || !state.items.includes(row) || row.lookup !== own) return
      row.failed = err?.name === 'AbortError' ? 'stopped' : 'error'
    } finally {
      release()
      if (current(gen) && row.lookup === own) {
        row.pending = false
        row.lookup = null
        settle(gen)
      }
    }
  }

  const lookupAll = (rows, gen, signal) => Promise.all(rows.map((row) => lookupRow(row, gen, signal)))

  /**
   * Read a description from the start. Any read in flight is abandoned —
   * its interpretation and every lookup it started — and rows the person had
   * fixed by hand are carried over by the fragment they came from, as before.
   */
  async function read(text) {
    const gen = ++generation
    controller?.abort()
    controller = new AbortController()
    const { signal } = controller
    const previous = state.items

    state.phase = 'interpreting'
    state.items = []
    state.source = null
    state.notice = null
    state.error = null
    emit()

    let result
    try {
      result = await interpret(text, { signal })
    } catch (err) {
      if (!current(gen)) return
      state.phase = 'failed'
      state.error = err
      emit()
      return
    }
    if (!current(gen)) return

    const fresh = stampRows(result.items.map((row) => ({ ...row, pending: true })))
    state.items = carryCorrections(previous, fresh)
    state.source = result.source
    state.notice = result.notice ?? null
    state.phase = 'looking-up'
    emit()

    await lookupAll(
      state.items.filter((row) => row.pending),
      gen,
      signal
    )
    settle(gen)
  }

  /** Look one row up again, under the current read. Never adds a row. */
  async function retry(row) {
    if (!state.items.includes(row) || !controller) return
    row.lookup?.abort()
    if (state.phase === 'done' || state.phase === 'failed') state.phase = 'looking-up'
    emit()
    await lookupRow(row, generation, controller.signal)
  }

  /**
   * Accept the split a local read proposed but would not make on its own.
   * The one row becomes its pieces, in place, and each piece is looked up.
   */
  async function split(row) {
    const index = state.items.indexOf(row)
    if (index < 0 || !row.proposed?.length || !controller) return
    const pieces = stampRows(row.proposed.map((piece) => ({ ...piece, pending: true })))
    state.items = [...state.items.slice(0, index), ...pieces, ...state.items.slice(index + 1)]
    if (state.phase === 'done' || state.phase === 'failed') state.phase = 'looking-up'
    emit()
    await lookupAll(pieces, generation, controller.signal)
  }

  /** Take a row off the list. A lookup in flight for it is cancelled. */
  function remove(row) {
    const index = state.items.indexOf(row)
    if (index < 0) return -1
    row.lookup?.abort()
    state.items = state.items.filter((r) => r !== row)
    settle(generation)
    return index
  }

  /** Put a removed row back where it was. */
  function restore(index, row) {
    if (state.items.includes(row)) return
    const at = Math.max(0, Math.min(index, state.items.length))
    state.items = [...state.items.slice(0, at), row, ...state.items.slice(at)]
    emit()
  }

  /**
   * Abandon whatever is in flight. Used when the description goes back to
   * being edited, and on dispose: nothing that was started before this may
   * change the rows afterwards.
   */
  function cancel() {
    generation++
    controller?.abort()
    for (const row of state.items) {
      if (row.pending) {
        row.pending = false
        row.failed = 'stopped'
        row.lookup = null
      }
    }
    if (state.phase === 'interpreting' || state.phase === 'looking-up') state.phase = 'idle'
  }

  return { state, read, retry, split, remove, restore, cancel, busy }
}
