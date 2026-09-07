import { Card, Deck, Domain } from '../../types/card'
import { AIDifficulty, GameState, PlayerSide } from '../../types/game'
import { dispatch } from '../actions'
import { initGame } from '../setup'

let n = 0
export function makeCard(partial: Partial<Card> & Pick<Card, 'name' | 'type'>): Card {
  n += 1
  return {
    id: partial.id ?? `fix-${n}-${partial.name}`,
    riftboundId: partial.riftboundId ?? `fix-${n}`,
    name: partial.name,
    cleanName: partial.cleanName ?? partial.name,
    type: partial.type,
    supertype: partial.supertype ?? null,
    rarity: partial.rarity ?? 'common',
    domains: partial.domains ?? ['fury'],
    energy: partial.energy ?? 0,
    power: partial.power ?? 0,
    might: partial.might ?? 0,
    text: partial.text ?? '',
    flavour: '',
    keywords: partial.keywords ?? [],
    symbols: [],
    tags: [],
    set: 'FIX',
    setName: 'Fixtures',
    collectorNumber: String(n),
    imageUrl: '',
    artist: '',
  }
}

const fury: Domain[] = ['fury']

export const legend = makeCard({ name: 'Test Legend', type: 'legend', domains: fury, supertype: 'champion' })
export const champion = makeCard({
  name: 'Test Champion',
  type: 'unit',
  supertype: 'champion',
  domains: fury,
  energy: 3,
  might: 3,
})
export const grunt = makeCard({ name: 'Grunt', type: 'unit', domains: fury, energy: 2, might: 2 })
export const accelUnit = makeCard({
  name: 'Rusher',
  type: 'unit',
  domains: fury,
  energy: 2,
  might: 2,
  keywords: ['Accelerate'],
  text: '[Accelerate] (You may pay :rb_energy_1: as an additional cost to have me enter ready.)',
})
export const accelRuneUnit = makeCard({
  name: 'Fury Rusher',
  type: 'unit',
  domains: fury,
  energy: 2,
  might: 2,
  keywords: ['Accelerate'],
  text: '[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)',
})
export const bruiser = makeCard({ name: 'Bruiser', type: 'unit', domains: fury, energy: 4, might: 4 })
export const titan = makeCard({ name: 'Titan', type: 'unit', domains: fury, energy: 6, might: 6 })
export const bolt = makeCard({
  name: 'Bolt',
  type: 'spell',
  domains: fury,
  energy: 2,
  text: 'Deal 3 damage to target unit.',
})
export const offDomain = makeCard({ name: 'Calm Card', type: 'unit', domains: ['calm'], energy: 1, might: 1 })

// ── Cards that match entries in the ability script registry ───────────────
// (scriptFor matches on normalized name, so the domain here is irrelevant.)
export const stellacorn = makeCard({
  name: 'Stellacorn Herder',
  type: 'unit',
  domains: fury,
  energy: 2,
  might: 3,
  text: 'When I move, draw 1.',
})
export const voidSeeker = makeCard({
  name: 'Void Seeker',
  type: 'spell',
  domains: fury,
  energy: 1,
  keywords: ['Action'],
  text: 'Deal 4 to a unit at a battlefield. Draw 1.',
})
export const gust = makeCard({
  name: 'Gust',
  type: 'spell',
  domains: fury,
  energy: 1,
  keywords: ['Reaction'],
  text: 'Return a unit at a battlefield with 3 might or less to hand.',
})
export const defy = makeCard({
  name: 'Defy',
  type: 'spell',
  domains: fury,
  energy: 1,
  keywords: ['Reaction'],
  text: 'Counter a spell that costs no more than 4.',
})
export const discipline = makeCard({
  name: 'Discipline',
  type: 'spell',
  domains: fury,
  energy: 1,
  keywords: ['Reaction'],
  text: 'Give a unit +2 might this turn. Draw 1.',
})
export const annieStubborn = makeCard({
  name: 'Annie - Stubborn',
  type: 'unit',
  supertype: 'champion',
  domains: fury,
  energy: 1,
  might: 3,
  text: 'When you play me, return a spell from your trash to your hand.',
})

// ── Keyword / action demo cards (match entries in CARD_SCRIPTS) ───────────
export const deflectUnit = makeCard({
  name: 'Bulwark',
  type: 'unit',
  domains: fury,
  energy: 2,
  might: 3,
  keywords: ['Deflect'],
  text: '[Deflect]',
})
export const legionBrute = makeCard({
  name: 'Legion Brute',
  type: 'unit',
  domains: fury,
  energy: 1,
  might: 2,
  text: '[Legion][>] When I enter, buff me.',
})
export const empoweredSentinel = makeCard({
  name: 'Empowered Sentinel',
  type: 'unit',
  domains: fury,
  energy: 2,
  might: 2,
  text: '[Empower] — [Empowered][>] When I conquer, gain 1 XP.',
})
export const cripplingHex = makeCard({
  name: 'Crippling Hex',
  type: 'spell',
  domains: fury,
  energy: 1,
  keywords: ['Action'],
  text: 'Stun a unit and give it -1 [M].',
})
export const furyRune = makeCard({ name: 'Fury Rune', type: 'rune', domains: fury })
export const bf1 = makeCard({ name: 'Field One', type: 'battlefield', domains: ['colorless'] })
export const bf2 = makeCard({ name: 'Field Two', type: 'battlefield', domains: ['colorless'] })
export const bf3 = makeCard({ name: 'Field Three', type: 'battlefield', domains: ['colorless'] })

export const POOL: Card[] = [
  legend,
  champion,
  grunt,
  bruiser,
  titan,
  bolt,
  offDomain,
  furyRune,
  bf1,
  bf2,
  bf3,
]

export function makeDeck(id: string): Deck {
  return {
    id,
    name: id,
    legendId: legend.id,
    chosenChampionId: champion.id,
    battlefieldIds: [bf1.id, bf2.id, bf3.id],
    runes: [{ cardId: furyRune.id, quantity: 12 }],
    cards: [
      { cardId: champion.id, quantity: 3 },
      { cardId: grunt.id, quantity: 18 },
      { cardId: bruiser.id, quantity: 10 },
      { cardId: titan.id, quantity: 4 },
      { cardId: bolt.id, quantity: 5 },
    ],
    createdAt: 0,
    updatedAt: 0,
  }
}

/** Deterministic RNG for reproducible shuffles. */
export function seededRng(seed = 42): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

export interface StartOpts {
  firstPlayer?: PlayerSide
  difficulty?: AIDifficulty
  seed?: number
}

let _fixInstance = 0

/** Put a ready unit for `side` onto battlefield `bfIndex`. */
export function placeUnitAt(
  state: GameState,
  side: PlayerSide,
  card: Card,
  bfIndex: number,
): GameState {
  const unit = {
    instanceId: `fu${++_fixInstance}`,
    card,
    owner: side,
    location: { kind: 'battlefield' as const, index: bfIndex },
    exhausted: false,
    damage: 0,
    counters: {},
    sick: false,
  }
  return {
    ...state,
    battlefields: state.battlefields.map((bf, i) =>
      i === bfIndex ? { ...bf, units: [...bf.units, unit] } : bf,
    ),
  }
}

/** Put a ready unit for `side` at its base. */
export function placeAtBase(state: GameState, side: PlayerSide, card: Card): GameState {
  const unit = {
    instanceId: `fu${++_fixInstance}`,
    card,
    owner: side,
    location: { kind: 'base' as const },
    exhausted: false,
    damage: 0,
    counters: {},
    sick: false,
  }
  return side === 'player'
    ? { ...state, player: { ...state.player, base: [...state.player.base, unit] } }
    : { ...state, ai: { ...state.ai, base: [...state.ai.base, unit] } }
}

/** Replace a side's hand with the given cards. */
export function withHand(state: GameState, side: PlayerSide, cards: Card[]): GameState {
  return side === 'player'
    ? { ...state, player: { ...state.player, hand: cards } }
    : { ...state, ai: { ...state.ai, hand: cards } }
}

/** A game past the mulligan step (both players keep), ready for the action phase. */
export function startedGame(opts: StartOpts = {}): GameState {
  let state = initGame(makeDeck('A'), makeDeck('B'), POOL, {
    firstPlayer: opts.firstPlayer ?? 'player',
    difficulty: opts.difficulty ?? 'medium',
    rng: seededRng(opts.seed ?? 42),
    // Pin the two battlefields for deterministic tests: player brings bf1, AI brings bf2.
    playerBattlefieldId: bf1.id,
    aiBattlefieldId: bf2.id,
  })
  state = dispatch(state, { type: 'KEEP_HAND' }, 'player')
  state = dispatch(state, { type: 'KEEP_HAND' }, 'ai')
  return state
}
