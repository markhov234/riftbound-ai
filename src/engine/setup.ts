import { Card, Deck, DeckEntry, Domain } from '../types/card'
import { tokenCardFor, tokenNamesFor } from './abilities/effects'
import { newCopyId, setCardPool } from './state'
import {
  AIDifficulty,
  Battlefield,
  GameState,
  OPENING_HAND,
  PlayerSide,
  PlayerState,
  RunePool,
} from '../types/game'

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function expand(entries: DeckEntry[], lookup: Map<string, Card>): Card[] {
  return entries.flatMap((e) => {
    const card = lookup.get(e.cardId)
    if (!card) return []
    // Every physical copy is its own object with a unique id, so two copies of
    // the same card are never confused when targeting / picking / removing.
    return Array.from({ length: e.quantity }, () => ({ ...card, id: newCopyId(card.id) }))
  })
}

function identityOf(legend: Card): Domain[] {
  const ids = legend.domains.filter((d) => d !== 'colorless')
  return ids.length > 0 ? ids : ['fury', 'calm', 'mind', 'body', 'order', 'chaos']
}

function emptyRunePool(deck: Card[]): RunePool {
  return { energy: 0, power: 0, deck, channeled: [], recycled: [], spent: [] }
}

function buildPlayer(
  side: PlayerSide,
  deck: Deck,
  lookup: Map<string, Card>,
  pool: Card[],
  rng: () => number,
): PlayerState {
  const legend =
    (deck.legendId && lookup.get(deck.legendId)) ||
    pool.find((c) => c.type === 'legend') ||
    fallbackLegend()
  const chosenChampion =
    (deck.chosenChampionId && lookup.get(deck.chosenChampionId)) ||
    pool.find((c) => c.supertype === 'champion' && c.type === 'unit') ||
    fallbackChampion()

  // Tokens are never in a deck — they only enter play via an effect. Strip any
  // that slipped through (legacy saved decks, bad data).
  let mainDeck = shuffle(
    expand(deck.cards, lookup).filter((c) => c.supertype !== 'token' && c.type !== 'token'),
    rng,
  )
  if (mainDeck.length === 0) {
    // Defensive: never start with an empty deck.
    mainDeck = shuffle(
      pool.filter((c) => c.type === 'unit' && c.supertype !== 'token').slice(0, 30),
      rng,
    )
  }

  let runeDeck = shuffle(expand(deck.runes, lookup), rng)
  if (runeDeck.length === 0) {
    const rune = pool.find((c) => c.type === 'rune')
    if (rune) runeDeck = Array.from({ length: 12 }, () => rune)
  }

  const hand = mainDeck.slice(0, OPENING_HAND)
  const rest = mainDeck.slice(OPENING_HAND)

  // Token pile — explicit `deck.tokens` cards, else derived from what the deck's
  // cards (+ battlefields the deck brings) can create.
  const explicitTokens = expand(deck.tokens ?? [], lookup)
  const tokenPile: Card[] = []
  const pushToken = (card: Card) => {
    if (!tokenPile.some((c) => c.name.toLowerCase() === card.name.toLowerCase())) tokenPile.push(card)
  }
  if (explicitTokens.length > 0) {
    explicitTokens.forEach(pushToken)
  } else {
    const bfCards = deck.battlefieldIds.map((id) => lookup.get(id)).filter((c): c is Card => !!c)
    for (const name of tokenNamesFor([...mainDeck, legend, chosenChampion, ...bfCards])) {
      pushToken(tokenCardFor(name))
    }
  }

  return {
    side,
    points: 0,
    legend,
    chosenChampion,
    // The Chosen Champion starts in its own zone, playable any time on your turn.
    championZone: chosenChampion,
    identity: identityOf(legend),
    hand,
    mainDeck: rest,
    trash: [],
    banished: [],
    xp: 0,
    runes: emptyRunePool(runeDeck),
    bankedEnergy: 0,
    base: [],
    gear: [],
    tokenPile,
    mulliganDone: false,
    championPlayed: false,
    legendEmpowered: false,
    legendExhausted: false,
  }
}

/** Each player presents one battlefield from their deck; both are in play. */
function resolveBattlefields(
  playerDeck: Deck,
  aiDeck: Deck,
  lookup: Map<string, Card>,
  pool: Card[],
  opts: InitOptions,
  rng: () => number,
): Battlefield[] {
  const anyBattlefield = () => pool.find((c) => c.type === 'battlefield')

  const present = (deck: Deck, chosenId: string | undefined): Card | undefined => {
    if (chosenId) {
      const c = lookup.get(chosenId)
      if (c) return c
    }
    const own = deck.battlefieldIds.map((id) => lookup.get(id)).filter(Boolean) as Card[]
    if (own.length > 0) return own[Math.floor(rng() * own.length)]
    return anyBattlefield()
  }

  const playerBf = present(playerDeck, opts.playerBattlefieldId)
  const aiBf = present(aiDeck, opts.aiBattlefieldId)

  const make = (card: Card | undefined, index: number, contributor: PlayerSide): Battlefield => ({
    index,
    card: card ?? null,
    name: card?.name ?? `Battlefield ${index + 1}`,
    contributor,
    units: [],
    scoredThisTurn: [],
  })

  return [make(playerBf, 0, 'player'), make(aiBf, 1, 'ai')]
}

export interface InitOptions {
  difficulty?: AIDifficulty
  rng?: () => number
  firstPlayer?: PlayerSide
  /** The battlefield card id the player presents (defaults to a random one from the deck). */
  playerBattlefieldId?: string
  aiBattlefieldId?: string
}

export function initGame(
  playerDeck: Deck,
  aiDeck: Deck,
  pool: Card[],
  opts: InitOptions = {},
): GameState {
  const rng = opts.rng ?? Math.random
  const difficulty = opts.difficulty ?? 'medium'
  const first = opts.firstPlayer ?? (rng() < 0.5 ? 'player' : 'ai')

  setCardPool(pool)
  const lookup = new Map(pool.map((c) => [c.id, c]))

  const player = buildPlayer('player', playerDeck, lookup, pool, rng)
  const ai = buildPlayer('ai', aiDeck, lookup, pool, rng)
  const battlefields = resolveBattlefields(playerDeck, aiDeck, lookup, pool, opts, rng)

  return {
    round: 1,
    turn: 0,
    activePlayer: first,
    phase: 'mulligan',
    priority: first,
    passesInARow: 0,
    stack: [],
    cardsPlayedThisTurn: 0,
    battlefields,
    player,
    ai,
    pendingShowdown: null,
    pendingDamage: null,
    pendingChoices: [],
    flowGranted: [],
    lastResolved: null,
    lastShowdown: null,
    log: [`Game start. ${first === 'player' ? 'You' : 'AI'} will take the first turn.`],
    winner: null,
    difficulty,
    firstChannelBonusUsed: false,
  }
}

// ── Fallbacks (only hit if the card pool is unexpectedly missing types) ─────

function fallbackLegend(): Card {
  return synthCard('legend', 'Nameless Legend', 'champion')
}
function fallbackChampion(): Card {
  return { ...synthCard('unit', 'Nameless Champion', 'champion'), might: 3, energy: 3 }
}

function synthCard(
  type: Card['type'],
  name: string,
  supertype: Card['supertype'],
): Card {
  return {
    id: `synth-${name}`,
    riftboundId: `synth-${name}`,
    name,
    cleanName: name,
    type,
    supertype,
    rarity: 'common',
    domains: ['colorless'],
    energy: 0,
    power: 0,
    might: 0,
    text: '',
    flavour: '',
    keywords: [],
    symbols: [],
    tags: [],
    set: 'SYN',
    setName: 'Synthetic',
    collectorNumber: '0',
    imageUrl: '',
    artist: '',
  }
}
