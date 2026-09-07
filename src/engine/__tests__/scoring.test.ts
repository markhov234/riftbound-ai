import { describe, expect, it } from 'vitest'
import { GameState } from '../../types/game'
import { controlledCount, scoreConquer, scoreHolds } from '../scoring'
import { newInstanceId } from '../state'
import { grunt, makeCard, startedGame } from './fixtures'

function control(state: GameState, indices: number[]): GameState {
  return {
    ...state,
    battlefields: state.battlefields.map((bf) =>
      indices.includes(bf.index)
        ? {
            ...bf,
            units: [
              {
                instanceId: newInstanceId(),
                card: grunt,
                owner: 'player' as const,
                location: { kind: 'battlefield' as const, index: bf.index },
                exhausted: false,
                damage: 0,
                counters: {},
                sick: false,
              },
            ],
          }
        : bf,
    ),
  }
}

describe('holding', () => {
  it('scores one point per controlled battlefield', () => {
    let state = startedGame()
    state = control(state, [0, 1])
    expect(controlledCount(state, 'player')).toBe(2)
    const scored = scoreHolds(state, 'player')
    expect(scored.player.points).toBe(2)
  })

  it('caps holding a battlefield at one point per turn', () => {
    let state = startedGame()
    state = control(state, [0])
    state = scoreHolds(state, 'player')
    expect(state.player.points).toBe(1)
    state = scoreHolds(state, 'player') // same turn — no extra point
    expect(state.player.points).toBe(1)
  })
})

describe('Otterpus — early-point replacement', () => {
  const otterpus = makeCard({ name: 'Otterpus', type: 'unit', domains: ['mind'], energy: 2, might: 2 })
  const withOtterpus = (s: GameState): GameState => ({
    ...s,
    player: {
      ...s.player,
      base: [
        ...s.player.base,
        {
          instanceId: newInstanceId(),
          card: otterpus,
          owner: 'player' as const,
          location: { kind: 'base' as const },
          exhausted: false,
          damage: 0,
          counters: {},
          sick: false,
        },
      ],
    },
  })

  it('a 1st/2nd-turn hold point becomes a draw instead', () => {
    let s = withOtterpus(control(startedGame(), [0]))
    const hand = s.player.hand.length
    s = scoreHolds(s, 'player')
    expect(s.player.points).toBe(0)
    expect(s.player.hand.length).toBe(hand + 1)
    expect(s.log.some((l) => /Otterpus/.test(l))).toBe(true)
  })

  it('from round 3 the point scores normally', () => {
    let s = { ...withOtterpus(control(startedGame(), [0])), round: 3 }
    s = scoreHolds(s, 'player')
    expect(s.player.points).toBe(1)
  })

  it('no Otterpus in play → normal early scoring', () => {
    let s = control(startedGame(), [0])
    s = scoreHolds(s, 'player')
    expect(s.player.points).toBe(1)
  })
})

describe('final-point rule', () => {
  it('lets you win on your 8th point from a hold', () => {
    let state = startedGame()
    state = control(state, [0, 1])
    state = { ...state, player: { ...state.player, points: 7 } }
    const scored = scoreHolds(state, 'player')
    expect(scored.winner).toBe('player')
  })

  it('refuses an 8th point from a conquer that is not a sweep', () => {
    let state = startedGame()
    state = { ...state, player: { ...state.player, points: 7 } }
    const handBefore = state.player.hand.length

    const scored = scoreConquer(state, 'player', 0)
    expect(scored.winner).toBeNull()
    expect(scored.player.points).toBe(7)
    expect(scored.player.hand.length).toBe(handBefore + 1)
  })

  it('allows an 8th point from a conquer when every battlefield is controlled', () => {
    let state = startedGame()
    state = control(state, [0, 1])
    state = { ...state, player: { ...state.player, points: 7 } }
    const scored = scoreConquer(state, 'player', 0)
    expect(scored.winner).toBe('player')
  })
})
