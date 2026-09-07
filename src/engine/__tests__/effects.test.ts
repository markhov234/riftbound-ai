import { describe, expect, it } from 'vitest'
import {
  addEnergy,
  addPower,
  buff,
  burn,
  createToken,
  discardChoice,
  draw,
  giveMight,
  giveMightPermanent,
  heal,
  predict,
  predictChoice,
  recall,
  stun,
} from '../abilities/effects'
import { dispatch } from '../actions'
import { endTurn } from '../phases'
import { initGame } from '../setup'
import { lethalMight, showdownMight } from '../keywords'
import { setCardPool } from '../state'
import { GameState, PlayerSide } from '../../types/game'
import {
  POOL,
  bf1,
  bf2,
  grunt,
  makeCard,
  makeDeck,
  placeAtBase,
  placeUnitAt,
  seededRng,
  startedGame,
} from './fixtures'

const baseId = (s: GameState, side: PlayerSide = 'player') => s[side].base[0].instanceId
const findBase = (s: GameState, side: PlayerSide = 'player') => s[side].base[0]

describe('buff / debuff primitives', () => {
  it('buff adds a non-stacking +1 Might counter', () => {
    let s = placeAtBase(startedGame(), 'player', grunt)
    s = buff(s, baseId(s))
    expect(findBase(s).counters.buffed).toBe(1)
    expect(findBase(s).counters.mightPerm).toBe(1)

    s = buff(s, baseId(s)) // second buff is a no-op
    expect(findBase(s).counters.mightPerm).toBe(1)
    expect(s.log.some((l) => /already has a buff counter/.test(l))).toBe(true)
  })

  it('giveMightPermanent survives end-of-turn cleanup; giveMight does not', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeAtBase(s, 'player', grunt)
    const id = baseId(s)
    s = giveMightPermanent(s, id, 2)
    s = giveMight(s, id, 3)
    expect(findBase(s).counters.mightPerm).toBe(2)
    expect(findBase(s).counters.mightTurn).toBe(3)

    s = endTurn(s) // player's turn ends → cleanup runs on player units
    const g = s.player.base[0]
    expect(g.counters.mightPerm).toBe(2)
    expect(g.counters.mightTurn ?? 0).toBe(0)
  })

  it('a debuff via giveMight lowers effective Might but never below 0', () => {
    let s = placeAtBase(startedGame(), 'player', grunt) // might 2
    s = giveMight(s, baseId(s), -5)
    expect(showdownMight({} as GameState, findBase(s))).toBe(0)
  })
})

describe('stun', () => {
  it('sets the counter, zeroes combat Might, but keeps lethal Might', () => {
    let s = placeAtBase(startedGame(), 'player', grunt) // might 2
    s = stun(s, baseId(s))
    const g = findBase(s)
    expect(g.counters.stunned).toBe(1)
    expect(showdownMight({} as GameState, g, 'defender')).toBe(0)
    expect(lethalMight(g)).toBe(2)

    s = stun(s, baseId(s)) // can't stun twice
    expect(s.log.some((l) => /already stunned/.test(l))).toBe(true)
  })
})

describe('heal', () => {
  it('removes all damage, or a capped amount', () => {
    let s = placeAtBase(startedGame(), 'player', grunt)
    s = { ...s, player: { ...s.player, base: s.player.base.map((u) => ({ ...u, damage: 2 })) } }
    s = heal(s, baseId(s), 1)
    expect(findBase(s).damage).toBe(1)
    s = heal(s, baseId(s))
    expect(findBase(s).damage).toBe(0)
  })
})

describe('recall', () => {
  it('moves a unit home and wipes damage + counters', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    let id = s.battlefields[0].units[0].instanceId
    s = giveMight(s, id, 2)
    s = { ...s, battlefields: s.battlefields.map((bf) => ({ ...bf, units: bf.units.map((u) => ({ ...u, damage: 1 })) })) }

    s = recall(s, id)
    expect(s.battlefields[0].units).toHaveLength(0)
    expect(s.player.base).toHaveLength(1)
    expect(s.player.base[0].damage).toBe(0)
    expect(s.player.base[0].counters.mightTurn ?? 0).toBe(0)
  })

  it('a recalled token ceases to exist', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const tok = makeCard({ name: 'Sprite', type: 'unit', supertype: 'token', domains: ['fury'], energy: 0, might: 1 })
    setCardPool([tok])
    s = createToken(s, 'player', 'Sprite', { kind: 'base' })
    const trashBefore = s.player.trash.length
    s = recall(s, s.player.base[0].instanceId)
    expect(s.player.base).toHaveLength(0)
    expect(s.player.trash.length).toBe(trashBefore)
  })
})

describe('deck actions', () => {
  it('burn X moves the top X of the deck to the trash', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const deckBefore = s.player.mainDeck.length
    const trashBefore = s.player.trash.length
    s = burn(s, 'player', 3)
    expect(s.player.mainDeck.length).toBe(deckBefore - 3)
    expect(s.player.trash.length).toBe(trashBefore + 3)
  })

  it('predict recycles the chosen card to the bottom, keeps the rest on top', () => {
    const a = makeCard({ name: 'A', type: 'unit', energy: 1 })
    const b = makeCard({ name: 'B', type: 'unit', energy: 5 })
    const c = makeCard({ name: 'C', type: 'unit', energy: 3 })
    let s = startedGame()
    s = { ...s, player: { ...s.player, mainDeck: [a, b, c, ...s.player.mainDeck] } }

    s = predict(s, 'player', 3, [b.id])
    expect(s.player.mainDeck[0].id).toBe(a.id)
    expect(s.player.mainDeck[1].id).toBe(c.id)
    expect(s.player.mainDeck[s.player.mainDeck.length - 1].id).toBe(b.id)
  })

  it('predict with no picks recycles the lowest-energy card (auto heuristic)', () => {
    const a = makeCard({ name: 'A', type: 'unit', energy: 1 })
    const b = makeCard({ name: 'B', type: 'unit', energy: 5 })
    let s = startedGame()
    s = { ...s, player: { ...s.player, mainDeck: [b, a, ...s.player.mainDeck] } }
    s = predict(s, 'player', 2)
    expect(s.player.mainDeck[0].id).toBe(b.id)
    expect(s.player.mainDeck[s.player.mainDeck.length - 1].id).toBe(a.id)
  })
})

describe('add (rune pool)', () => {
  it('addPower / addEnergy bump the pool', () => {
    let s = startedGame()
    const p0 = s.player.runes.power
    const e0 = s.player.runes.energy
    s = addPower(s, 'player', 2)
    s = addEnergy(s, 'player', 1)
    expect(s.player.runes.power).toBe(p0 + 2)
    expect(s.player.runes.energy).toBe(e0 + 1)
  })
})

describe('tokens are never in a deck', () => {
  it('a token entry in the deck list is stripped before the game starts', () => {
    const tok = makeCard({
      name: 'Recruit',
      type: 'unit',
      supertype: 'token',
      domains: ['fury'],
      energy: 0,
      might: 1,
    })
    const base = makeDeck('T')
    const deck = { ...base, cards: [...base.cards, { cardId: tok.id, quantity: 8 }] }
    const s = initGame(deck, makeDeck('B'), [...POOL, tok], {
      firstPlayer: 'player',
      rng: seededRng(1),
      playerBattlefieldId: bf1.id,
      aiBattlefieldId: bf2.id,
    })
    const everywhere = [...s.player.hand, ...s.player.mainDeck]
    expect(everywhere.some((c) => c.supertype === 'token')).toBe(false)
  })
})

describe('createToken', () => {
  it('synthesises a Token-supertype unit when the pool has no matching printing', () => {
    let s = startedGame({ firstPlayer: 'player' })
    setCardPool([]) // nothing named "Mech"
    s = createToken(s, 'player', 'Mech', { kind: 'base' }, { might: 3, keywords: ['Ganking'] })
    const t = s.player.base[s.player.base.length - 1]
    expect(t.card.supertype).toBe('token')
    expect(t.card.name).toBe('Mech')
    expect(t.card.might).toBe(3)
    expect(t.card.keywords).toContain('Ganking')
    expect(t.sick).toBe(true)
  })
})

describe('predictChoice', () => {
  it('the AI resolves it synchronously with the heuristic + continuation', () => {
    const a = makeCard({ name: 'Ax', type: 'unit', energy: 1 })
    const b = makeCard({ name: 'Bx', type: 'unit', energy: 6 })
    let s = startedGame({ firstPlayer: 'ai' })
    s = { ...s, ai: { ...s.ai, mainDeck: [a, b, ...s.ai.mainDeck] } }
    const handBefore = s.ai.hand.length
    s = predictChoice(s, 'ai', 2, (st) => draw(st, 'ai', 1))
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.ai.mainDeck[s.ai.mainDeck.length - 1].id).toBe(a.id) // lowest energy recycled to bottom
    expect(s.ai.hand.length).toBe(handBefore + 1) // continuation drew
  })

  it('the player is prompted; resolving recycles the picks then runs the continuation', () => {
    const a = makeCard({ name: 'Aa', type: 'unit', energy: 1 })
    const b = makeCard({ name: 'Bb', type: 'unit', energy: 6 })
    let s = startedGame({ firstPlayer: 'player' })
    s = { ...s, player: { ...s.player, mainDeck: [a, b, ...s.player.mainDeck] } }
    const handBefore = s.player.hand.length

    s = predictChoice(s, 'player', 2, (st) => draw(st, 'player', 1))
    expect(s.pendingChoices).toHaveLength(1)
    expect(s.pendingChoices[0].kind).toBe('deckTop')

    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: [b.id] }, 'player')
    expect(s.pendingChoices).toHaveLength(0)
    // Order after predict is [a, ...rest, b]; the continuation then drew `a`.
    expect(s.player.mainDeck[s.player.mainDeck.length - 1].id).toBe(b.id) // b recycled to bottom
    expect(s.player.hand.some((c) => c.id === a.id)).toBe(true) // a was on top → drawn
    expect(s.player.hand.length).toBe(handBefore + 1)
  })
})

describe('discardChoice', () => {
  it('the player picks a card to discard, then the continuation draws', () => {
    const c1 = makeCard({ name: 'C1', type: 'unit', energy: 2 })
    const c2 = makeCard({ name: 'C2', type: 'unit', energy: 3 })
    let s = startedGame({ firstPlayer: 'player' })
    s = { ...s, player: { ...s.player, hand: [c1, c2] } }

    s = discardChoice(s, 'player', 1, (st) => draw(st, 'player', 1))
    expect(s.pendingChoices[0].kind).toBe('handCard')

    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: [c1.id] }, 'player')
    expect(s.player.trash.some((c) => c.id === c1.id)).toBe(true)
    expect(s.player.hand.some((c) => c.id === c1.id)).toBe(false)
    expect(s.player.hand.length).toBe(2) // had 2 → -1 discard +1 draw
  })

  it('picking one of two identical cards only discards that copy', () => {
    const copyA = makeCard({ name: 'Twin', type: 'unit', energy: 2, id: 'twin~1' })
    const copyB = makeCard({ name: 'Twin', type: 'unit', energy: 2, id: 'twin~2' })
    let s = startedGame({ firstPlayer: 'player' })
    s = { ...s, player: { ...s.player, hand: [copyA, copyB], mainDeck: [] } }

    s = discardChoice(s, 'player', 1)
    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: ['twin~1'] }, 'player')

    expect(s.player.hand.map((c) => c.id)).toEqual(['twin~2'])
    expect(s.player.trash.map((c) => c.id)).toEqual(['twin~1'])
  })
})
