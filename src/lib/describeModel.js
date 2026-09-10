import { getAiKey } from './aiKey.js'

/**
 * The model call, and the only file in the app that knows which model.
 *
 * Two calls share everything below the prompt. `describeMeal` reads a WHOLE
 * description and returns the foods in it, brands and modifications intact —
 * it is how the Describe sheet decides what the items are, before anything is
 * looked up. `describeLeftovers` is the older, narrower job the plate still
 * uses: finish the fragments a local read could not. Both speak in plain
 * arrays of items coming out. The endpoint, the auth header, the request
 * envelope and the response shapes are all in here, so changing provider is a
 * change to this file and nothing else.
 *
 * **Interpretation and estimation ride in one request, and are used apart.**
 * Every item the model names is put through the app's own lookup on the way
 * out — the library, the staples table, Open Food Facts — and the estimate it
 * came with is consulted only where that lookup finds nothing. Asking for the
 * estimate in the same call as the reading costs tokens that are already
 * being spent and saves a whole extra round trip; using it only as a fallback
 * is what keeps spec 9.3 true: a food that exists never takes an estimated
 * value.
 *
 * **What leaves the device is exactly the text passed in.** For `describeMeal`
 * that is the description as typed; for `describeLeftovers` it is the two
 * lists of fragments. No date, no targets, no profile, no library contents.
 * There is no logging, no proxy and no second recipient. The key is read here
 * and travels in the header of this one request.
 */

const HOST = 'https://generativelanguage.googleapis.com'

/**
 * Both, in order.
 *
 * A model can be listed by one API version and refuse `generateContent` on it,
 * which is what a 404 on a model the key can plainly see actually means. `v1`
 * is not a fallback for a broken request so much as a second place to ask.
 */
const API_VERSIONS = ['v1beta', 'v1']

/** How many models to actually try before giving up, across both versions. */
const MAX_ATTEMPTS = 5

/**
 * Flash rather than Pro. This is a short structured extraction against a
 * sentence, not a reasoning problem, and Pro is the model Google restricts
 * hardest on the free tier — 50 requests a day against Flash's 1,500.
 *
 * A LIST rather than a constant, because which of these a given key can reach
 * is not knowable from here. `gemini-2.5-flash` is a current stable model and
 * still returned 404 on a real device, which is the API saying "not for this
 * key" rather than "no such model" — a key scoped to a different project, or
 * an account on a different generation, will see a different set. Guessing
 * harder is not a fix; asking is.
 */
const PREFERRED_MODELS = ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-2.5-flash-lite']

/** Where the model that actually worked is remembered, so this costs once. */
const MODEL_KEY = 'mt:aiModel'

/** One retry, per the spec. Beyond that a failure should be visible. */
const RETRY_DELAY_MS = 700

function storedModel() {
  try {
    return localStorage.getItem(MODEL_KEY) || ''
  } catch {
    return ''
  }
}

function rememberModel(name) {
  try {
    localStorage.setItem(MODEL_KEY, name)
  } catch {
    /* a working model that has to be rediscovered next time is still working */
  }
}

export class DescribeError extends Error {}

/**
 * The response shape, declared to the API rather than asked for in prose.
 *
 * Gemini enforces this server-side, so the failure mode is a model that returns
 * nothing rather than a model that returns prose the app then has to parse out
 * of a code fence. Macros are nullable on purpose: a fragment nobody can read
 * should come back admitting that, not carrying four invented numbers.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'NUMBER', nullable: true },
          unit: { type: 'STRING', enum: ['g', 'ml', 'serving'] },
          packaged: { type: 'BOOLEAN' },
          kcal: { type: 'NUMBER', nullable: true },
          protein: { type: 'NUMBER', nullable: true },
          fat: { type: 'NUMBER', nullable: true },
          carbs: { type: 'NUMBER', nullable: true },
        },
        required: ['name', 'quantity', 'unit', 'packaged', 'kcal', 'protein', 'fat', 'carbs'],
      },
    },
  },
  required: ['items'],
}

/**
 * The shape of a whole-meal reading.
 *
 * `modifiers` is the field that fixes the latte problem: "with oat milk and no
 * sugar" is not two more foods, it is two facts about the one drink, and the
 * only way to keep the model from returning them as rows is to give them a
 * place of their own. `brand` is kept apart from `name` so the lookup can
 * tell a branded product from a generic food and refuse to match the first to
 * the second.
 */
const MEAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          brand: { type: 'STRING', nullable: true },
          quantity: { type: 'NUMBER', nullable: true },
          unit: { type: 'STRING', enum: ['g', 'ml', 'serving'] },
          modifiers: { type: 'ARRAY', items: { type: 'STRING' } },
          packaged: { type: 'BOOLEAN' },
          kcal: { type: 'NUMBER', nullable: true },
          protein: { type: 'NUMBER', nullable: true },
          fat: { type: 'NUMBER', nullable: true },
          carbs: { type: 'NUMBER', nullable: true },
        },
        required: ['name', 'brand', 'quantity', 'unit', 'modifiers', 'packaged', 'kcal', 'protein', 'fat', 'carbs'],
      },
    },
  },
  required: ['items'],
}

/**
 * The whole-meal prompt.
 *
 * The description goes in untouched. The rules parser used to split it first
 * and send only the pieces it could not place, and that is how "Tim Hortons
 * spinach & egg white bites" became two rows: the split happened before
 * anything that knows what a product name looks like had seen the words. So
 * the split is now the model's job, and the prompt spends most of its words
 * on the one thing the rules got wrong — that "and", "&" and commas are more
 * often inside a name or a modification than between two foods.
 */
function buildMealPrompt(text) {
  return `Someone typed what they ate into a food logging app. Read the whole description and return one entry per distinct food or drink in it.

Description:
${text}

For every entry return:
- name: the food or product as it would be written on a menu or a package, with the brand in front where one was named — "Tim Hortons Spinach & Egg White Bites", "Starbucks Caffè Latte", "scrambled eggs". Keep every word of a product name that was written, in the order it was written. No quantity words in the name.
- brand: the brand, chain or restaurant that was named, or null.
- quantity and unit: unit is exactly "g", "ml" or "serving". Use "serving" when the amount is a count or a portion rather than a weight, and keep whatever amount was written. Use 1 when no amount was written and the food is a single thing; null only when the amount is genuinely unknowable.
- modifiers: how it was customised — milk choice, size, syrups, "no sugar", "extra shot", "no cheese" — as short phrases, in the order written. Empty when there are none.
- packaged: true for a branded or packaged product or a chain menu item, false for a homemade or generic food.
- kcal, protein, fat, carbs: your best estimate of the TOTAL for that quantity with its modifiers, not per 100 g. Macros in grams.

Rules:
- "and", "&" and commas are often part of one product's name ("spinach & egg white bites", "mac and cheese", "salt and vinegar crisps") or join a modification to the thing it changes ("a latte with oat milk and no sugar"). Split only where the words clearly name a second food or drink.
- A modification is never its own entry. It belongs to the food or drink it changes.
- Return only foods that were written. Do not add dressings, sides, drinks or garnishes that were not written, however likely they are.
- If part of the description means nothing you can identify, return it as one entry with those words as the name and null for quantity and all four macros. Do not guess.
- If nothing in the description is a food or drink, return an empty list.`
}

/**
 * The prompt.
 *
 * It says what the app already did, because the model's job here is not to
 * parse a meal — the rules did that — but to finish two specific jobs the rules
 * refused. Told that, it stops re-splitting things that are already settled.
 *
 * The instruction not to invent foods is the one that matters most. A model
 * asked to describe a plate will helpfully add the dressing on the salad and
 * the butter on the toast, and every one of those is a row somebody has to
 * notice and delete before committing.
 */
function buildPrompt({ spans, unresolved }) {
  const lines = []

  if (spans.length) {
    lines.push(
      'SPLIT — each line below may be one food whose name contains commas, or several foods ' +
        'written without them. Decide which, and return one entry per real food:'
    )
    spans.forEach((s) => lines.push(`- ${s}`))
  }

  if (unresolved.length) {
    lines.push(
      'ESTIMATE — each line below is one food the app has already failed to find in the ' +
        "user's own library, in a table of common foods, and in Open Food Facts. Return one " +
        'entry for each, keeping the amount that was written:'
    )
    unresolved.forEach((u) => lines.push(`- ${u}`))
  }

  return `A food logging app has parsed what someone ate. These are the parts its own parser could not finish. Finish them.

${lines.join('\n')}

For every entry return:
- name: what the food is, said as briefly as it can be. No quantity words in the name.
- quantity and unit: unit is exactly "g", "ml" or "serving". Use "serving" when the amount is a portion rather than a weight, and keep whatever amount was written.
- packaged: true for a branded or packaged product, false for a homemade or restaurant dish.
- kcal, protein, fat, carbs: your best estimate of the TOTAL for that quantity, not per 100 g. Macros in grams.

Rules:
- Return only foods that appear above. Do not add dressings, sides, drinks or garnishes that were not written, however likely they are.
- A line that is one dish whose name happens to contain commas comes back as one entry, under its full name.
- Where an amount was written as a portion — "a small serving", "a few handfuls" — estimate what that portion weighs for that food and give the macros for it.
- If a line means nothing you can identify, return it as one entry with the line as the name and null for quantity and all four macros. Do not guess.`
}

/* ------------------------------------------------------------------ call */

/** Thrown only for a model this key cannot reach, so discovery can catch it. */
class ModelNotFoundError extends DescribeError {}

function authHeaders() {
  const key = getAiKey()
  if (!key) throw new DescribeError('No API key is stored.')
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
}

async function post(version, model, body, { signal }) {
  const res = await fetch(`${HOST}/${version}/models/${model}:generateContent`, {
    method: 'POST',
    signal,
    headers: authHeaders(),
    body: JSON.stringify(body),
  })

  if (res.status === 404) throw new ModelNotFoundError(`No access to ${model}.`)
  if (res.status === 400) throw new DescribeError('That key was rejected. Check it in Settings.')
  if (res.status === 401 || res.status === 403) {
    throw new DescribeError('That key was refused. Check it in Settings.')
  }
  if (res.status === 429) {
    throw new DescribeError('Gemini is rate limiting. Wait a minute and try again.')
  }
  if (!res.ok) throw new DescribeError(`Gemini is unavailable (${res.status}).`)

  try {
    return await res.json()
  } catch {
    throw new DescribeError('Gemini returned something unreadable.')
  }
}

/**
 * What this key can actually reach.
 *
 * One GET, and only ever after a 404 has already proved the guess wrong. The
 * preference order is kept — Flash first, cheapest tier of it — but the list
 * itself is the authority, so a key on a different generation of models finds
 * its own rather than needing this file edited.
 *
 * An empty list is a different diagnosis entirely: the key reaches the API and
 * the API has nothing for it, which is a key or project problem rather than a
 * model-name one, and the message says so instead of naming a model.
 */
async function listModels(version, { signal }) {
  const res = await fetch(`${HOST}/${version}/models`, { signal, headers: authHeaders() })
  if (!res.ok) return []

  const data = await res.json().catch(() => null)
  const usable = (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter(Boolean)
    // Never a preview or a specialised variant — this is a text extraction.
    .filter((m) => !/preview|tts|audio|live|image|embedding|vision/.test(m))

  // Preference order first, then whatever Flash the key has, then the rest.
  return [
    ...PREFERRED_MODELS.filter((p) => usable.includes(p)),
    ...usable.filter((m) => /flash/.test(m) && !PREFERRED_MODELS.includes(m)),
    ...usable.filter((m) => !/flash/.test(m) && !PREFERRED_MODELS.includes(m)),
  ]
}

/**
 * Try models until one answers, rather than picking one and hoping.
 *
 * The first version of this asked `ListModels` and took its best match — which
 * on a real key returned `gemini-2.5-flash`, the model that had just 404ed, so
 * it confidently retried the exact failure. Being listed and being callable are
 * different facts, and only the second one matters here.
 *
 * So a 404 now removes that model from consideration and moves on, across both
 * API versions, bounded so that a key which can call nothing costs a handful of
 * requests rather than a rate limit.
 */
async function callAnyModel(body, { signal }) {
  const tried = new Set()
  let attempts = 0

  const attempt = async (version, model) => {
    if (!model || tried.has(`${version}/${model}`)) return null
    if (attempts >= MAX_ATTEMPTS) return null
    tried.add(`${version}/${model}`)
    attempts++
    try {
      const data = await post(version, model, body, { signal })
      rememberModel(`${version}|${model}`)
      return data
    } catch (err) {
      if (err instanceof ModelNotFoundError) return null
      throw err
    }
  }

  const [cachedVersion, cachedModel] = storedModel().split('|')
  const cached = await attempt(cachedVersion, cachedModel)
  if (cached) return cached

  for (const version of API_VERSIONS) {
    for (const model of PREFERRED_MODELS) {
      const data = await attempt(version, model)
      if (data) return data
    }
    for (const model of await listModels(version, { signal })) {
      const data = await attempt(version, model)
      if (data) return data
    }
  }

  throw new DescribeError(
    tried.size
      ? 'That key cannot call any Gemini model. It may need the Generative Language API ' +
        'enabled, or a key made in AI Studio rather than Cloud Console.'
      : 'That key cannot reach Gemini. Check it in Settings.'
  )
}

const number = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The four numbers, or null when the model admitted it could not say. */
function readEstimate(raw) {
  if (number(raw.kcal) == null) return null
  return {
    kcal: number(raw.kcal) ?? 0,
    protein: number(raw.protein) ?? 0,
    fat: number(raw.fat) ?? 0,
    carbs: number(raw.carbs) ?? 0,
  }
}

/**
 * The reply's text, as JSON, or a `DescribeError` that says which of the two
 * ways it can fail to be that. Shared by both calls.
 */
function readReply(data) {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new DescribeError('Gemini returned nothing to read.')
  try {
    return JSON.parse(text)
  } catch {
    throw new DescribeError('Gemini returned something unreadable.')
  }
}

/**
 * One request with one retry, and only for the thing a retry can fix.
 *
 * This used to retry on ANY failure, which meant a 404 — an answer that will
 * be identical every time — fired a second request behind a 700ms wait. On a
 * free tier metered per minute that is how one tap becomes two requests and
 * a handful of taps becomes a rate limit, which is exactly what happened on
 * the first real device: a 404 that could never succeed, quietly doubled,
 * until the next error to arrive was a 429 blaming the wrong thing.
 *
 * Model availability is handled inside `callAnyModel` rather than here, so
 * what is left is the genuine transient: a dropped connection.
 */
async function request(prompt, schema, { signal }) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      // Deterministic on purpose: the same sentence should not produce a
      // different plate depending on when it was sent.
      temperature: 0,
    },
  }
  try {
    return await callAnyModel(body, { signal })
  } catch (err) {
    if (err.name === 'AbortError' || err instanceof DescribeError) throw err
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return callAnyModel(body, { signal })
  }
}

/**
 * A whole-meal reply, checked field by field.
 *
 * Exported for the tests, and pure on purpose: the sheet's behaviour on a
 * reply that keeps "spinach & egg white bites" whole, or that hands back the
 * latte's milk as a modifier rather than a row, is decided here and nowhere
 * else. Anything without a usable name is dropped rather than shown as an
 * empty row, and a name that is only the brand is left as it came — the
 * lookup will fail on it honestly rather than this file inventing a food.
 *
 * @param {unknown} parsed  the reply, already JSON
 * @returns {Array<{name, brand, quantity, unit, modifiers, packaged, estimate}>}
 */
export function normalizeMealReply(parsed) {
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  return items
    .filter((raw) => raw && typeof raw.name === 'string' && raw.name.trim())
    .map((raw) => ({
      name: raw.name.trim().replace(/\s+/g, ' '),
      brand: typeof raw.brand === 'string' && raw.brand.trim() ? raw.brand.trim() : null,
      quantity: number(raw.quantity),
      unit: ['g', 'ml', 'serving'].includes(raw.unit) ? raw.unit : 'serving',
      modifiers: Array.isArray(raw.modifiers)
        ? raw.modifiers.filter((m) => typeof m === 'string' && m.trim()).map((m) => m.trim())
        : [],
      packaged: raw.packaged === true,
      /**
       * Kept apart from the item rather than spread onto it, so that nothing
       * downstream can use these by accident. They are consulted only where
       * the lookup has already come back empty.
       */
      estimate: readEstimate(raw),
    }))
}

/**
 * Read a whole description into its foods.
 *
 * What leaves the device is the description and nothing else. No date, no
 * targets, no profile, no library contents. The reply is a list of foods with
 * their brands, amounts and modifications, plus an estimate per food that is
 * only ever used where the app's own sources have nothing.
 *
 * @param {{text: string, signal?: AbortSignal}} input
 * @returns {Promise<ReturnType<typeof normalizeMealReply>>}
 */
export async function describeMeal({ text, signal } = {}) {
  const description = String(text || '').trim()
  if (!description) return []
  const data = await request(buildMealPrompt(description), MEAL_SCHEMA, { signal })
  return normalizeMealReply(readReply(data))
}

/**
 * Ask the model to finish what the rules would not.
 *
 * @param {{spans: string[], unresolved: string[], signal?: AbortSignal}} input
 * @returns {Promise<Array<{name, quantity, unit, packaged, estimate}>>}
 */
export async function describeLeftovers({ spans = [], unresolved = [], signal } = {}) {
  if (!spans.length && !unresolved.length) return []

  const data = await request(buildPrompt({ spans, unresolved }), RESPONSE_SCHEMA, { signal })
  const parsed = readReply(data)
  const items = Array.isArray(parsed?.items) ? parsed.items : []

  return items
    .filter((raw) => raw && typeof raw.name === 'string' && raw.name.trim())
    .map((raw) => ({
      name: raw.name.trim(),
      quantity: number(raw.quantity),
      unit: ['g', 'ml', 'serving'].includes(raw.unit) ? raw.unit : 'serving',
      packaged: raw.packaged === true,
      estimate: readEstimate(raw),
    }))
}
