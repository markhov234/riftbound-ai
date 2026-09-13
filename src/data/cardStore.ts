import {
  Card,
  CardType,
  Domain,
  Rarity,
  RawCard,
  RawCardsResponse,
  Supertype,
} from '../types/card'
import { applyErrata } from './errata'

const CACHE_KEY = 'riftbound_cards_v2'
const CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours
const API_BASE = 'https://api.riftcodex.com'
// The API rejects anything above 100 with a 422, so the page count is fixed.
const PAGE_SIZE = 100

// ── Normalization helpers ──────────────────────────────────────────────────

function stripSymbols(text: string): string {
  // Collapse whitespace but keep :rb_*: tokens in place for now.
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function parseKeywords(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/\[([A-Za-z][A-Za-z '/-]*)\]/g)) {
    const kw = m[1].trim()
    // Skip templating brackets like [Level 6] or [>] which aren't keywords.
    if (/^level\b/i.test(kw) || kw === '>' || /^\d/.test(kw)) continue
    out.add(kw)
  }
  return [...out]
}

function parseSymbols(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/:rb_[a-z0-9_]+:/g)) out.add(m[0])
  return [...out]
}

function normalizeType(raw: RawCard): CardType {
  const t = (raw.classification?.type ?? '').toLowerCase()
  if (t.includes('unit')) return 'unit'
  if (t.includes('spell')) return 'spell'
  if (t.includes('gear')) return 'gear'
  if (t.includes('battlefield')) return 'battlefield'
  if (t.includes('legend')) return 'legend'
  if (t.includes('rune')) return 'rune'
  if (t.includes('token')) return 'token'
  return 'unit'
}

function normalizeSupertype(raw: RawCard): Supertype {
  const s = (raw.classification?.supertype ?? '').toLowerCase()
  if (s.includes('champion')) return 'champion'
  if (s.includes('signature')) return 'signature'
  if (s.includes('token')) return 'token'
  return null
}

const DOMAIN_SET: Domain[] = ['fury', 'calm', 'mind', 'body', 'order', 'chaos']

function normalizeDomains(raw: RawCard): Domain[] {
  const mapped = (raw.classification?.domain ?? [])
    .map((d) => d.toLowerCase())
    .filter((d): d is Domain => (DOMAIN_SET as string[]).includes(d))
  return mapped.length > 0 ? mapped : ['colorless']
}

function normalizeRarity(raw: RawCard): Rarity {
  const r = (raw.classification?.rarity ?? '').toLowerCase()
  const known: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'promo', 'signature']
  return (known as string[]).includes(r) ? (r as Rarity) : 'common'
}

function stripNameSuffix(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

function normalize(raw: RawCard): Card {
  const plain = raw.text?.plain ?? raw.media?.accessibility_text ?? ''
  const text = stripSymbols(plain)
  const a = raw.attributes ?? { energy: null, might: null, power: null }
  return {
    id: raw.id,
    riftboundId: raw.riftbound_id,
    name: raw.name,
    cleanName: raw.metadata?.clean_name?.trim() || stripNameSuffix(raw.name),
    type: normalizeType(raw),
    supertype: normalizeSupertype(raw),
    rarity: normalizeRarity(raw),
    domains: normalizeDomains(raw),
    energy: a.energy ?? 0,
    power: a.power ?? 0,
    might: a.might ?? 0,
    text,
    flavour: stripSymbols(raw.text?.flavour ?? ''),
    keywords: parseKeywords(text),
    symbols: parseSymbols(text),
    tags: raw.tags ?? [],
    set: raw.set?.set_id ?? '',
    setName: raw.set?.label ?? '',
    collectorNumber: String(raw.collector_number ?? ''),
    imageUrl: raw.media?.image_url ?? '',
    artist: raw.media?.artist ?? '',
  }
}

// ── Fetching (paginated) ───────────────────────────────────────────────────

let _cache: Card[] | null = null
/** The pool exactly as the API shipped it, before errata. See `__rawCards`. */
let _raw: Card[] | null = null
let _byName: Map<string, Card> | null = null
/** De-dupes overlapping loads — StrictMode runs App's effect twice in dev, and
 *  two passes over 15 pages meant 30 requests racing for the same data. */
let _inflight: Promise<Card[]> | null = null

/** Page requests allowed in the air at once. */
const CONCURRENCY = 5
/** Per-request ceiling. The API answers a page in 10-35s when it is warm, so
 *  this is a "something is wrong" bound, not a normal-latency one. */
const REQUEST_TIMEOUT = 45_000

export interface LoadProgress {
  done: number
  total: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(page: number): Promise<RawCardsResponse> {
  const url = `${API_BASE}/cards?size=${PAGE_SIZE}&page=${page}`
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) })
      if (!res.ok) throw new Error(`HTTP ${res.status} for page ${page}`)
      return (await res.json()) as RawCardsResponse
    } catch (err) {
      lastErr = err
      // Back off before retrying: an immediate second attempt just rejoins the
      // same queue that timed the first one out.
      if (attempt < 2) await sleep(600 * (attempt + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/**
 * Fetch `pages` with at most CONCURRENCY requests outstanding, preserving order.
 *
 * The pool is 15 pages (the API caps `size` at 100 — anything larger is a 422)
 * and each page takes 10-35s, so the old one-after-another loop spent about
 * three minutes on a cold load. Long enough that the loading screen read as a
 * hang, which is exactly what it was reported as.
 */
async function fetchPages(pages: number[], onPage: () => void): Promise<RawCard[][]> {
  const out: RawCard[][] = []
  let next = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= pages.length) return
      out[i] = (await fetchPage(pages[i])).items
      onPage()
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages.length) }, worker))
  return out
}

function indexCards(input: Card[]): void {
  // Both the network path and the test hook come through here, so this is the
  // one place errata need to be applied.
  _raw = input
  const cards = applyErrata(input)
  _cache = cards
  _byName = new Map()
  const add = (key: string, c: Card) => {
    if (key && !_byName!.has(key)) _byName!.set(key, c)
  }
  const hasSuffix = (name: string) => /\([^)]*\)\s*$/.test(name)

  // Exact names first.
  for (const c of cards) add(normalizeKey(c.name), c)
  // Then separator / clean-name variants, preferring un-suffixed printings.
  for (const c of cards.filter((c) => !hasSuffix(c.name))) {
    for (const key of nameKeys(c.name)) add(key, c)
    add(normalizeKey(c.cleanName), c)
  }
  // Finally let suffixed printings fill any gaps.
  for (const c of cards.filter((c) => hasSuffix(c.name))) {
    for (const key of nameKeys(c.name)) add(key, c)
    add(normalizeKey(c.cleanName), c)
  }
}

/** Whatever is in localStorage, regardless of age. */
function readStoredCards(): { cards: Card[]; timestamp: number } | null {
  try {
    const stored = localStorage.getItem(CACHE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored) as { cards: Card[]; timestamp: number }
    if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) return null
    return parsed
  } catch {
    return null // corrupt cache
  }
}

export async function fetchAllCards(
  onProgress?: (p: LoadProgress) => void,
): Promise<Card[]> {
  if (_cache) return _cache
  if (_inflight) return _inflight
  _inflight = loadCards(onProgress).finally(() => {
    _inflight = null
  })
  return _inflight
}

async function loadCards(onProgress?: (p: LoadProgress) => void): Promise<Card[]> {
  const stored = readStoredCards()
  if (stored && Date.now() - stored.timestamp < CACHE_TTL) {
    indexCards(stored.cards)
    return _cache!
  }

  try {
    const first = await fetchPage(1)
    const total = first.pages
    let done = 1
    onProgress?.({ done, total })

    const rest = Array.from({ length: total - 1 }, (_, i) => i + 2)
    const later = await fetchPages(rest, () => onProgress?.({ done: ++done, total }))
    indexCards([...first.items, ...later.flat()].map(normalize))
  } catch (err) {
    // An expired cache still plays a perfectly good game; only the newest
    // printings would be missing. Failing outright when we hold a usable pool
    // is the worse outcome, so keep it and let the user in.
    if (!stored) throw err
    indexCards(stored.cards)
    return _cache!
  }

  const cards = _cache!
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ cards, timestamp: Date.now() }))
  } catch {
    // storage full / unavailable — in-memory cache still works
  }

  return cards
}

// ── Lookups ────────────────────────────────────────────────────────────────

/** Test hook — seed the pool + name index directly, bypassing the network. */
export function __setCardData(cards: Card[]): void {
  indexCards(cards) // sets `_cache` to the errata'd copy
}

/**
 * The pool as the API shipped it, *before* errata — for the test-fixture
 * generator only. Writing the errata'd copy into the fixture would bake the
 * corrections in, and then the test that checks each erratum still matches the
 * printed text would be checking our own output instead of the API's.
 */
export function __rawCards(): Card[] | null {
  return _raw
}

export function getCardById(id: string): Card | undefined {
  return _cache?.find((c) => c.id === id)
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’‘]/g, "'") // curly → straight apostrophe
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Champion / legend names appear as "Name - Title" in older sets and
 * "Name, Title" in newer ones. Generate both separators plus a
 * suffix-stripped variant so preset decklists resolve regardless of source.
 */
function nameKeys(name: string): string[] {
  const base = normalizeKey(name)
  const noSuffix = normalizeKey(stripNameSuffix(name))
  const keys = new Set<string>([base, noSuffix])
  for (const k of [base, noSuffix]) {
    if (k.includes(' - ')) keys.add(k.replace(/ - /g, ', '))
    if (k.includes(', ')) keys.add(k.replace(/, /g, ' - '))
  }
  return [...keys]
}

/** Resolve a card by display name, tolerant of separator / suffix / case. */
export function resolveByName(name: string): Card | undefined {
  if (!_byName) return undefined
  for (const key of nameKeys(name)) {
    const hit = _byName.get(key)
    if (hit) return hit
  }
  return undefined
}

// ── Search / filter ────────────────────────────────────────────────────────

export interface CardFilters {
  type?: CardType
  domain?: Domain
  set?: string
  rarity?: Rarity
}

export function searchCards(cards: Card[], query: string, filters: CardFilters): Card[] {
  const q = query.toLowerCase().trim()
  return cards.filter((c) => {
    if (q && !c.name.toLowerCase().includes(q) && !c.text.toLowerCase().includes(q)) {
      return false
    }
    if (filters.type && c.type !== filters.type) return false
    if (filters.domain && !c.domains.includes(filters.domain)) return false
    if (filters.set && c.set !== filters.set) return false
    if (filters.rarity && c.rarity !== filters.rarity) return false
    return true
  })
}
