import { describe, expect, it } from 'vitest'
import { MAX_HAND_SIZE, RUNES_PER_TURN } from '../../types/game'
import { dispatch } from '../actions'
import { beginTurn, endTurn } from '../phases'
import { scoreHolds } from '../scoring'
import { newInstanceId } from '../state'
import { champion, makeCard, startedGame, withHand } from './fixtures'

describe('turn start (awaken)', () => {
  it('channels runes for the active player; the player on the play skips the first draw', () => {
    const state = startedGame({ firstPlayer: 'player' })
    // Opening hand 4 — no draw on turn 0 for the player on the play.
    expect(state.player.hand).toHaveLength(4)
    expect(state.log.some((l) => /on the play — no draw/i.test(l))).toBe(true)
    expect(state.player.runes.energy).toBe(RUNES_PER_TURN)
    expect(state.player.runes.channeled).toHaveLength(RUNES_PER_TURN)
  })

  it('the player on the draw does draw on their first turn', () => {
    let state = startedGame({ firstPlayer: 'ai' })
    state = endTurn(state) // ai (turn 0, no draw) → player's first turn (turn 1)
    expect(state.player.hand).toHaveLength(5) // opening 4 + the turn draw
  })

  it('gives the second player one extra rune on their first turn only', () => {
    let state = startedGame({ firstPlayer: 'ai' })
    // player is going second here
    state = endTurn(state) // ai ends -> player's first turn
    expect(state.player.runes.energy).toBe(RUNES_PER_TURN + 1)
    expect(state.firstChannelBonusUsed).toBe(true)
  })

  it('ramps energy by RUNES_PER_TURN each of the active player\'s turns', () => {
    let state = startedGame({ firstPlayer: 'player' })
    expect(state.player.runes.energy).toBe(2)
    state = endTurn(state) // -> ai turn
    state = endTurn(state) // -> player turn 2
    expect(state.player.runes.energy).toBe(4)
  })

  it('scores a point for each held battlefield at the start of the turn', () => {
    const state = startedGame({ firstPlayer: 'player' })
    // Put a player unit on battlefield 0, then run beginTurn again.
    const withUnit = {
      ...state,
      battlefields: state.battlefields.map((bf, i) =>
        i === 0
          ? {
              ...bf,
              units: [
                {
                  instanceId: newInstanceId(),
                  card: champion,
                  owner: 'player' as const,
                  location: { kind: 'battlefield' as const, index: 0 },
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
    const scored = scoreHolds(withUnit, 'player')
    expect(scored.player.points).toBe(1)
  })
})

describe('passing', () => {
  it('ends the turn after two consecutive priority passes on an empty stack', () => {
    const state = startedGame({ firstPlayer: 'player' })
    const once = dispatch(state, { type: 'PASS_PRIORITY' }, 'player')
    expect(once.activePlayer).toBe('player')
    const twice = dispatch(once, { type: 'PASS_PRIORITY' }, 'ai')
    expect(twice.activePlayer).toBe('ai')
  })
})

describe('round counter', () => {
  it('advances every two turns', () => {
    let state = startedGame({ firstPlayer: 'player' })
    expect(state.round).toBe(1)
    state = endTurn(state) // -> ai, turn 1
    expect(state.round).toBe(1)
    state = endTurn(state) // -> player, turn 2
    expect(state.round).toBe(2)
  })
})

describe('deck-out', () => {
  it('a player who cannot draw for the turn loses', () => {
    let s = startedGame({ firstPlayer: 'player' })
    // turn 2 so the mandatory draw actually happens (turn 0 is the free skip).
    s = { ...s, turn: 2, player: { ...s.player, mainDeck: [] } }
    s = beginTurn(s) // player's Awaken → must draw → can't
    expect(s.winner).toBe('ai')
    expect(s.log.some((l) => /deck-out/i.test(l))).toBe(true)
  })

  it('a non-empty deck draws normally', () => {
    const s = beginTurn({ ...startedGame({ firstPlayer: 'player' }), turn: 2 })
    expect(s.winner).toBeNull()
  })
})

describe('end-of-turn hand limit', () => {
  const flood = (side: 'player' | 'ai', size = 9) =>
    withHand(
      { ...startedGame({ firstPlayer: side }), turn: 2 },
      side,
      Array.from({ length: size }, (_, i) => makeCard({ name: `Filler ${i}`, type: 'unit', energy: 1 })),
    )

  it('the AI auto-discards down to the maximum', () => {
    const s = endTurn(flood('ai'))
    expect(s.ai.hand.length).toBe(MAX_HAND_SIZE)
    expect(s.ai.trash.length).toBe(2)
    expect(s.activePlayer).toBe('player') // turn advanced
  })

  it('a human over the cap pauses on an interactive discard, then the turn ends', () => {
    let s = endTurn(flood('player'))
    // paused: not yet the AI's turn, a mandatory hand-card pick is queued
    expect(s.activePlayer).toBe('player')
    const ch = s.pendingChoices[0]
    expect(ch?.kind).toBe('handCard')
    expect(ch?.min).toBe(2)

    const drop = s.player.hand.slice(0, 2).map((c) => c.id)
    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: drop }, 'player')
    expect(s.player.hand.length).toBe(MAX_HAND_SIZE)
    expect(s.player.trash.length).toBe(2)
    expect(s.activePlayer).toBe('ai') // turn advanced after the pick
  })

  it('no discard when at or under the cap', () => {
    const s = endTurn({ ...startedGame({ firstPlayer: 'ai' }), turn: 2 })
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.activePlayer).toBe('player')
  })
})
