import { describe, it } from 'vitest'
import { AIDifficulty } from '../../types/game'
import { POOL, makeDeck, seededRng } from './fixtures'
import { playGame } from './_fuzzlib'

/**
 * Invariant fuzzer over the synthetic fixture pool: play many full games (AI vs a
 * tiny random player bot) and assert the engine's state machine never violates a
 * core rule — no negative resources, no unit in two places, points in [0,8], the
 * stack / turn count stay bounded, nothing logs an "unimplemented / crashed" line.
 */
describe('full-game invariant fuzz (synthetic pool)', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as AIDifficulty[]) {
    it(`[${difficulty}] 8 seeded games keep every engine invariant`, () => {
      for (let i = 1; i <= 8; i++) {
        const seed = i * 7 + 1
        playGame({
          playerDeck: makeDeck('A'),
          aiDeck: makeDeck('B'),
          pool: POOL,
          seed,
          rng: seededRng(seed),
          difficulty,
          label: `synthetic seed ${seed} [${difficulty}]`,
          maxSteps: 600,
        })
      }
    })
  }
})
