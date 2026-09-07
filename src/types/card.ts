// ── Domains ────────────────────────────────────────────────────────────────
// Riftbound has six domains plus "colorless" for cards with no domain identity
// (most battlefields, some neutral cards).

export type Domain =
  | 'fury'
  | 'calm'
  | 'mind'
  | 'body'
  | 'order'
  | 'chaos'
  | 'colorless'

export const DOMAINS: Domain[] = ['fury', 'calm', 'mind', 'body', 'order', 'chaos']

export type CardType =
  | 'unit'
  | 'spell'
  | 'gear'
  | 'battlefield'
  | 'legend'
  | 'rune'
  | 'token'

export type Supertype = 'champion' | 'signature' | 'token' | null

export type Rarity =
  | 'common'
  | 'uncommon'
  | 'rare'
  | 'epic'
  | 'promo'
  | 'signature'

// ── Raw API shape (https://api.riftcodex.com/cards) ─────────────────────────
// The endpoint is paginated: { items: RawCard[], total, page, size, pages }.

export interface RawCardsResponse {
  items: RawCard[]
  total: number
  page: number
  size: number
  pages: number
}

export interface RawCard {
  id: string
  name: string
  riftbound_id: string
  tcgplayer_id?: string | null
  collector_number?: number | string | null
  attributes: {
    energy: number | null
    might: number | null
    power: number | null
  }
  classification: {
    type: string
    supertype: string | null
    rarity: string
    domain: string[]
  }
  text: {
    rich?: string | null
    plain?: string | null
    flavour?: string | null
  }
  set: {
    set_id: string
    label: string
  }
  media: {
    image_url?: string | null
    artist?: string | null
    accessibility_text?: string | null
  }
  tags?: string[]
  orientation?: string
  metadata?: {
    clean_name?: string
    updated_on?: string
    alternate_art?: boolean
    overnumbered?: boolean
    signature?: boolean
  }
  new?: boolean
}

// ── Normalized card used everywhere in the app ─────────────────────────────

export interface Card {
  id: string
  riftboundId: string
  name: string
  /** Name with any " (Signature)" / " (Alternate Art)" suffix removed. */
  cleanName: string
  type: CardType
  supertype: Supertype
  rarity: Rarity
  domains: Domain[]

  // Costs / stats. Riftbound keeps these distinct — do not collapse them.
  energy: number // primary cost (channeled runes)
  power: number // secondary cost (recycled runes), 0 for most units
  might: number // combat strength for units, 0 otherwise

  text: string // plain ability text (still contains :rb_*: symbol tokens)
  flavour: string
  keywords: string[] // parsed from [Bracket] tokens in the text
  symbols: string[] // :rb_*: tokens found in the text, for later icon rendering
  tags: string[] // character / faction tags (e.g. "Vi", "Noxus")

  set: string // set id, e.g. "OGN"
  setName: string
  collectorNumber: string
  imageUrl: string
  artist: string
}

// ── Deck model ─────────────────────────────────────────────────────────────
// A Riftbound deck is: 1 legend, a 40-card main deck (incl. the chosen
// champion), a 12-card rune deck, and 3 battlefields.

export interface DeckEntry {
  cardId: string
  quantity: number
}

export interface Deck {
  id: string
  name: string
  legendId: string | null
  chosenChampionId: string | null
  battlefieldIds: string[] // expected length 3
  runes: DeckEntry[] // quantities sum to 12
  cards: DeckEntry[] // main deck; quantities sum to 40 (incl. champion)
  /** Token pile — separate from the 40; the token types this deck's cards create. */
  tokens?: DeckEntry[]
  /** Preset decks are code-defined and never written to localStorage. */
  preset?: boolean
  createdAt: number
  updatedAt: number
}
