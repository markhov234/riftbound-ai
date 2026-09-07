import {
  Card,
  CardType,
  Domain,
  Rarity,
  RawCard,
  RawCardsResponse,
  Supertype,
} from '../types/card'

const CACHE_KEY = 'riftbound_cards_v2'
const CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours
const API_BASE = 'https://api.riftcodex.com'
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
let _byName: Map<string, Card> | null = null

async function fetchPage(page: number): Promise<RawCardsResponse> {
  const url = `${API_BASE}/cards?size=${PAGE_SIZE}&page=${page}`
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status} for page ${page}`)
      return (await res.json()) as RawCardsResponse
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

function indexCards(cards: Card[]): void {
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

export async function fetchAllCards(): Promise<Card[]> {
  if (_cache) return _cache

  try {
    const stored = localStorage.getItem(CACHE_KEY)
    if (stored) {
      const { cards, timestamp } = JSON.parse(stored) as {
        cards: Card[]
        timestamp: number
      }
      if (Date.now() - timestamp < CACHE_TTL && Array.isArray(cards) && cards.length > 0) {
        indexCards(cards)
        return cards
      }
    }
  } catch {
    // ignore corrupt cache
  }

  const first = await fetchPage(1)
  let items: RawCard[] = [...first.items]
  for (let page = 2; page <= first.pages; page++) {
    const next = await fetchPage(page)
    items = items.concat(next.items)
  }

  const cards = items.map(normalize)
  indexCards(cards)

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
  _cache = cards
  indexCards(cards)
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
