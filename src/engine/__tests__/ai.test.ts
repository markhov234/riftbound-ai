import { describe, expect, it } from 'vitest'
import { AIDifficulty } from '../../types/game'
import { canPlay } from '../actions'
import { getAIActions, runAITurn } from '../ai'
import { initGame } from '../setup'
import { dispatch } from '../actions'
import { POOL, makeDeck, seededRng, startedGame } from './fixtures'

const DIFFICULTIES: AIDifficulty[] = ['easy', 'medium', 'hard']

describe('AI', () => {
  for (const difficulty of DIFFICULTIES) {
    it(`[${difficulty}] only proposes legal card plays (checked step by step)`, () => {
      const start = startedGame({ firstPlayer: 'ai', difficulty })
      const actions = getAIActions(start)
      let s = start
      for (const a of actions) {
        if (a.type === 'PLAY_UNIT' || a.type === 'PLAY_SPELL' || a.type === 'PLAY_GEAR') {
          expect(canPlay(s, 'ai', a.card).ok).toBe(true)
        }
        s = dispatch(s, a, 'ai')
      }
    })

    it(`[${difficulty}] never logs an illegal action during its turn`, () => {
      const after = runAITurn(startedGame({ firstPlayer: 'ai', difficulty }))
      expect(after.log.some((l) => /Can't (play|cast|move)/.test(l))).toBe(false)
    })

    it(`[${difficulty}] runAITurn terminates and yields priority`, () => {
      const state = startedGame({ firstPlayer: 'ai', difficulty })
      const after = runAITurn(state)
      // Either the game ended, or the AI handed priority to the player
      // (turn over, or a response window it opened — e.g. a declared showdown).
      expect(after.winner !== null || after.priority === 'player').toBe(true)
    })
  }

  it('actually develops a board over a few turns (medium & hard)', () => {
    for (const difficulty of ['medium', 'hard'] as AIDifficulty[]) {
      let s = startedGame({ firstPlayer: 'ai', difficulty })
      let guard = 0
      while (!s.winner && s.turn < 6 && guard++ < 60) {
        if (s.priority === 'ai' || s.pendingChoices[0]?.controller === 'ai') {
          s = runAITurn(s)
        } else if (s.stack.length > 0 || s.pendingShowdown) {
          s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')
        } else {
          s = dispatch(s, { type: 'END_TURN' }, 'player')
        }
      }
      const aiUnits =
        s.ai.base.length +
        s.battlefields.reduce((n, bf) => n + bf.units.filter((u) => u.owner === 'ai').length, 0)
      // The old greedy eval made every unit play a net score loss, so the AI
      // would pass every turn. It should now put real bodies on the table.
      expect(aiUnits, `${difficulty} AI board`).toBeGreaterThanOrEqual(2)
    }
  })

  it('resolves its mulligan automatically', () => {
    let state = initGame(makeDeck('A'), makeDeck('B'), POOL, {
      firstPlayer: 'player',
      rng: seededRng(),
    })
    state = dispatch(state, { type: 'KEEP_HAND' }, 'player')
    expect(state.ai.mulliganDone).toBe(false)
    state = runAITurn(state)
    expect(state.ai.mulliganDone).toBe(true)
    expect(state.phase).toBe('action')
  })
})
