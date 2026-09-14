import { describe, expect, it } from 'vitest'
import { __setCardData } from '../../data/cardStore'
import { setCardPool } from '../state'
import { buildPresetDecks } from '../../data/presetDecks'
import poolData from './fixtures/card-pool.json'
import type { Card } from '../../types/card'
import { playGame } from './_fuzzlib'
import { seededRng } from './fixtures'
import type { AIDifficulty, GameState } from '../../types/game'

/**
 * The difficulty setting has to mean something, and the AI must never argue
 * with the rules engine.
 *
 * Measured over every preset pairing (200 games each) while tuning:
 *
 *   easy    62.0% wins   opponent scores 5.445
 *   medium  97.0%        opponent scores 1.810
 *   hard    98.5%        opponent scores 1.730
 *
 * The sample here is smaller so the suite stays fast, which is also why this
 * does **not** assert hard > medium: that gap is ~0.08 points and at this many
 * games it is noise — an earlier 80-game run had them the other way round. Only
 * the gap that is real at this sample size is asserted.
 */

const POOL = poolData as unknown as Card[]
__setCardData(POOL)
setCardPool(POOL)
const DECKS = buildPresetDecks(POOL)

function sample(difficulty: AIDifficulty): GameState[] {
  const out: GameState[] = []
  for (let a = 0; a < DECKS.length; a++) {
    const b = (a + 1) % DECKS.length
    for (let seed = 1; seed <= 4; seed++) {
      out.push(
        playGame({
          playerDeck: DECKS[a],
          aiDeck: DECKS[b],
          pool: POOL,
          seed,
          rng: seededRng(seed),
          difficulty,
          label: `${difficulty} ${a}v${b} seed ${seed}`,
        }),
      )
    }
  }
  return out
}

const avgOpponentPoints = (games: GameState[]) =>
  games.reduce((n, s) => n + s.player.points, 0) / games.length

describe('difficulty means something', () => {
  const easy = sample('easy')
  const medium = sample('medium')

  it('lets the opponent score far more on easy than on medium', () => {
    const e = avgOpponentPoints(easy)
    const m = avgOpponentPoints(medium)
    expect(e, `easy conceded ${e.toFixed(2)}, medium ${m.toFixed(2)}`).toBeGreaterThan(m + 1.5)
  })

  it('is beatable on easy and rarely on medium', () => {
    const easyWins = easy.filter((s) => s.winner === 'ai').length / easy.length
    const mediumWins = medium.filter((s) => s.winner === 'ai').length / medium.length
    expect(easyWins, 'easy is unbeatable').toBeLessThan(0.9)
    expect(mediumWins, 'medium stopped being a challenge').toBeGreaterThan(0.85)
  })
})

describe('the AI never argues with the rules engine', () => {
  it('proposes no action the engine refuses', () => {
    // `dispatch` reports an illegal action by appending a line and returning a
    // *new* state, so `after !== before` does not mean anything happened. The
    // AI treated a refusal as a real candidate and could pick it again next
    // step — a loop that ate the turn until the 80-action guard stopped it.
    //
    // The live case: [Deflect] adds a surcharge for choosing that particular
    // unit, so `canPlay` prices Charm as affordable and aiming it makes it
    // unaffordable. Any cost that depends on the chosen target does this, which
    // is why the guard is generic rather than a Charm special case.
    // The pairing and seeds here are not arbitrary: the Charm loop lives at
    // deck 0 vs deck 4, seed 8. A first version of this test sampled only
    // seeds 1-4 of neighbouring pairings and passed happily against the
    // unguarded build — it proved nothing. The suite's other fuzzers have the
    // same blind spot, which is why the bug survived this long.
    const refusals: string[] = []
    for (const difficulty of ['easy', 'medium', 'hard'] as AIDifficulty[]) {
      const games = [...sample(difficulty)]
      for (let seed = 1; seed <= 10; seed++) {
        games.push(
          playGame({
            playerDeck: DECKS[0],
            aiDeck: DECKS[4],
            pool: POOL,
            seed,
            rng: seededRng(seed),
            difficulty,
            label: `${difficulty} 0v4 seed ${seed}`,
          }),
        )
      }
      for (const s of games) {
        for (const line of s.log) {
          if (/^(Can't|Cannot|Not enough|Invalid)/i.test(line)) {
            refusals.push(`${difficulty}: ${line}`)
          }
        }
      }
    }
    expect(
      [...new Set(refusals)],
      `the AI attempted ${refusals.length} illegal action(s)`,
    ).toEqual([])
  })
})
