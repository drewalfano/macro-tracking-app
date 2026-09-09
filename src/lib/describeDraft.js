import { classifyItem } from './describeResolve.js'
import { portionKey } from './db.js'

/**
 * The described meal while it is being reviewed: what the rows are, what is
 * still wanted, and how a re-read or a model reply changes them without losing
 * anything the person has already fixed.
 *
 * Pure, so the rules can be tested without a sheet. The sheet owns the DOM and
 * calls these; nothing here reads or writes the store.
 *
 * A draft item is a plate item — the same shape `logPlate` commits — with a
 * few fields of its own: `key`, the fragment of the sentence it came from,
 * normalized, so a re-read can find its predecessor; `id`, so a row can be
 * addressed while the list is being edited around it; and `fixed`, set when
 * the person matched or re-measured it themselves, which is what a re-read is
 * not allowed to undo.
 */

let seq = 0
/** Row ids are local to one review and never stored. */
export const draftId = () => `d${++seq}-${Math.random().toString(36).slice(2, 7)}`

/** The fragment a row was read from, as a key. Case and spacing are not identity. */
export const draftKey = (text) => portionKey(text)

/**
 * Stamp fresh rows from the resolver with what the draft needs of them.
 *
 * @param {object[]} items  plate items from `resolveParsed` or `resolveModelItems`
 * @param {string} [from]   the fragment they were read from, when they all share one
 */
export function stampRows(items, from = null) {
  return items.map((item) => ({
    ...item,
    id: item.id || draftId(),
    key: item.key || draftKey(from ?? item.text ?? item.name ?? ''),
  }))
}

/**
 * A re-read keeps what was fixed by hand.
 *
 * Editing the sentence and reviewing again produces a fresh set of rows, and
 * for every fragment that reads the same as before there is an old row that
 * may already have been matched to a food or given an amount. Those are the
 * person's decisions and the new parse has no better information than they
 * did, so the old row stands in for the new one. Anything not fixed by hand
 * takes the new read, which may well be better — that is why they re-read.
 *
 * Matched by fragment, not by position: adding "and a banana" at the front
 * moves every other row down one, and the eggs are still the eggs.
 *
 * Never duplicates. The result is exactly one row per fragment in the new
 * read; old rows whose fragment is gone go with it.
 */
export function carryCorrections(previous, next) {
  const fixed = new Map()
  for (const row of previous) {
    if (row.fixed && row.key) fixed.set(row.key, row)
  }
  const used = new Set()
  return next.map((row) => {
    const old = row.key ? fixed.get(row.key) : null
    if (old && !used.has(old.id)) {
      used.add(old.id)
      return old
    }
    return row
  })
}

/**
 * What the model handed back goes where the unplaced rows were.
 *
 * The replacements land at the position of the first row that was sent, so
 * the meal still reads in the order the sentence was written, and every other
 * row — already matched, already measured, already fixed — is left exactly
 * where and as it was. Only rows that were actually sent are removed; a row
 * that became unmatched after the call went out (the person removed its match
 * mid-flight) is not swept up with them.
 *
 * An empty reply changes nothing. The rows stay, still asking for a match,
 * and the sheet says the model found nothing rather than quietly dropping the
 * words that were typed.
 */
export function replaceSent(items, sentIds, replacements) {
  if (!replacements.length) return items
  const sent = new Set(sentIds)
  const out = []
  let placed = false
  for (const row of items) {
    if (sent.has(row.id)) {
      if (!placed) {
        out.push(...replacements)
        placed = true
      }
      continue
    }
    out.push(row)
  }
  if (!placed) out.push(...replacements)
  return out
}

/**
 * What still stands between the rows and the log.
 *
 * `missing` rows — a food deleted out from under a draft — are skipped at
 * commit rather than blocking it, the same reading the plate takes. The two
 * unfinished states block: a row with no food and a food with no amount are
 * not opinions the app is unsure about, they are blanks.
 */
export function draftStatus(items) {
  const counts = {
    matched: 0,
    estimated: 0,
    'needs-amount': 0,
    unmatched: 0,
    ambiguous: 0,
    pending: 0,
    missing: 0,
  }
  for (const item of items) {
    const state = classifyItem(item)
    counts[state] = (counts[state] || 0) + 1
  }
  const ready = counts.matched + counts.estimated
  const blocked = counts.unmatched + counts.ambiguous + counts['needs-amount'] + counts.pending
  return {
    ...counts,
    ready,
    blocked,
    canLog: ready > 0 && blocked === 0,
    reason: blockedReason(counts, ready),
  }
}

/**
 * One sentence naming what is in the way, or null when nothing is.
 *
 * A lookup still running comes first and alone: while anything is still
 * being checked the other counts are not final, and naming them would be
 * asking for a fix to something that may settle itself in a second.
 */
function blockedReason(counts, ready) {
  if (counts.pending) {
    return counts.pending === 1 ? 'Still checking 1 item.' : `Still checking ${counts.pending} items.`
  }
  const parts = []
  const needFood = counts.unmatched + counts.ambiguous
  if (needFood) {
    parts.push(needFood === 1 ? '1 item needs a food' : `${needFood} items need a food`)
  }
  if (counts['needs-amount']) {
    parts.push(
      counts['needs-amount'] === 1
        ? '1 item needs an amount'
        : `${counts['needs-amount']} items need an amount`
    )
  }
  if (parts.length) return parts.join(' and ') + '.'
  if (!ready) return 'Nothing to log yet.'
  return null
}

/**
 * The rows sorted into the three groups the review shows.
 *
 * `pending` is still being looked up. `attention` is settled and needs a
 * hand — no food, no amount, an unconfirmed split, a deleted food. `ready`
 * counts towards the total and can be logged. Sentence order is kept within
 * each group, and the review shows headings only when more than one group
 * has anything in it: a list that is all one thing does not need to say so.
 */
export function groupRows(items) {
  const groups = { pending: [], attention: [], ready: [] }
  for (const item of items) {
    const state = classifyItem(item)
    if (state === 'pending') groups.pending.push(item)
    else if (state === 'matched' || state === 'estimated') groups.ready.push(item)
    else groups.attention.push(item)
  }
  return groups
}

/**
 * What the meal adds up to, counting only what is actually known.
 *
 * `macrosOf` is handed in because the sheet is the thing holding the library
 * records; this file never reads the store. A row that is pending, unmatched
 * or without an amount contributes nothing — and says so through `confirmed`
 * and `pending`, so the tile can call the number a subtotal while it is one.
 */
export function describeTotals(items, macrosOf) {
  let totals = { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  let confirmed = 0
  let pending = 0
  let estimates = 0
  let unresolved = 0
  for (const item of items) {
    const state = classifyItem(item)
    if (state === 'missing') continue
    if (state === 'pending') {
      pending++
      continue
    }
    if (state !== 'matched' && state !== 'estimated') {
      unresolved++
      continue
    }
    const m = macrosOf(item)
    if (!m) {
      unresolved++
      continue
    }
    totals = {
      kcal: totals.kcal + (m.kcal || 0),
      protein: totals.protein + (m.protein || 0),
      fat: totals.fat + (m.fat || 0),
      carbs: totals.carbs + (m.carbs || 0),
    }
    confirmed++
    if (state === 'estimated') estimates++
  }
  return { totals, confirmed, pending, estimates, unresolved, partial: pending + unresolved > 0 }
}

/**
 * Put a draft on the plate without doubling it.
 *
 * Rows carry the draft they came from, so sending the same review to the
 * plate twice — once, then again after a correction — replaces the earlier
 * batch in place rather than adding a second copy of the meal. Anything on
 * the plate from elsewhere is untouched and keeps its position.
 */
export function mergeIntoPlate(plateItems, draftTag, items) {
  const tagged = items.map((item) => stripDraft({ ...item, describe: draftTag }))
  const out = []
  let placed = false
  for (const existing of plateItems) {
    if (existing.describe === draftTag) {
      if (!placed) {
        out.push(...tagged)
        placed = true
      }
      continue
    }
    out.push(existing)
  }
  if (!placed) out.push(...tagged)
  return out
}

/** What leaves the draft: the plate item, without the review's own bookkeeping. */
export function stripDraft(item) {
  const {
    id,
    key,
    fixed,
    pending,
    missing,
    base,
    failed,
    lookup,
    estimate,
    ambiguous,
    proposed,
    brand,
    modifiers,
    packaged,
    ...rest
  } = item
  return rest
}

/**
 * The question a row asks when a food was named without an amount.
 *
 * The one place the sheet asks anything, and it asks in the words of the row
 * rather than with a label reading "Quantity".
 */
export function amountQuestion(name) {
  const n = String(name || '').trim()
  if (!n) return 'About how much?'
  // Mid-sentence, so Title Case comes down — "Dried Soft Apricots" reads as
  // "dried soft apricots" — while a word that is all capitals is an acronym
  // and keeps them.
  const spoken = n.replace(/\S+/g, (w) => (/^\p{Lu}\p{Ll}*$/u.test(w) ? w.toLowerCase() : w))
  return `About how much ${spoken}?`
}
