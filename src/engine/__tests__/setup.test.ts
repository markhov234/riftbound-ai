import { describe, expect, it } from 'vitest'
import { OPENING_HAND } from '../../types/game'
import { initGame } from '../setup'
import { dispatch } from '../actions'
import { basePrintingId } from '../state'
import { POOL, bf1, bf2, makeDeck, seededRng } from './fixtures'

describe('initGame', () => {
  const state = initGame(makeDeck('A'), makeDeck('B'), POOL, {
    firstPlayer: 'player',
    rng: seededRng(),
    playerBattlefieldId: bf1.id,
    aiBattlefieldId: bf2.id,
  })

  it('starts in the mulligan phase', () => {
    expect(state.phase).toBe('mulligan')
    expect(state.winner).toBeNull()
  })

  it('deals an opening hand of the right size to both players', () => {
    expect(state.player.hand).toHaveLength(OPENING_HAND)
    expect(state.ai.hand).toHaveLength(OPENING_HAND)
  })

  it('builds a 40-card main deck (minus the opening hand)', () => {
    expect(state.player.mainDeck).toHaveLength(40 - OPENING_HAND)
  })

  it('builds a 12-card rune deck', () => {
    expect(state.player.runes.deck).toHaveLength(12)
  })

  it('gives every copy of a card its own unique id', () => {
    const all = [...state.player.mainDeck, ...state.player.hand, ...state.player.runes.deck]
    const ids = all.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length) // no id shared by two objects
    // …but copies of the same printing still resolve to one printing id.
    const grunts = all.filter((c) => c.name === 'Grunt')
    expect(grunts.length).toBeGreaterThan(1)
    expect(new Set(grunts.map(basePrintingId)).size).toBe(1)
    grunts.forEach((c) => expect(c.id).not.toBe(basePrintingId(c)))
  })

  it('puts two battlefields in play — one presented by each player', () => {
    expect(state.battlefields).toHaveLength(2)
    expect(state.battlefields.map((b) => b.name)).toEqual(['Field One', 'Field Two'])
    expect(state.battlefields.map((b) => b.contributor)).toEqual(['player', 'ai'])
  })

  it('derives the domain identity from the legend', () => {
    expect(state.player.identity).toEqual(['fury'])
  })
})

describe('mulligan', () => {
  it('swaps the chosen cards and keeps the hand size stable', () => {
    let state = initGame(makeDeck('A'), makeDeck('B'), POOL, {
      firstPlayer: 'player',
      rng: seededRng(7),
    })
    state = dispatch(state, { type: 'MULLIGAN', cardIndices: [0, 1] }, 'player')
    expect(state.player.hand).toHaveLength(OPENING_HAND)
    expect(state.player.mulliganDone).toBe(true)
  })

  it('starts the first turn once both players have resolved', () => {
    let state = initGame(makeDeck('A'), makeDeck('B'), POOL, {
      firstPlayer: 'player',
      rng: seededRng(),
    })
    state = dispatch(state, { type: 'KEEP_HAND' }, 'player')
    expect(state.phase).toBe('mulligan')
    state = dispatch(state, { type: 'KEEP_HAND' }, 'ai')
    expect(state.phase).toBe('action')
    expect(state.activePlayer).toBe('player')
  })
})
