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
 * Easy has to be a weaker player, not a different game.
 *
 * It was neither: `pickEasy` had no `MOVE_UNIT` in its action set at all, so it
 * played cards to its base and stopped. Scoring needs units *at* battlefields,
 * so easy could not win — 0 wins in 16 games, 0.38 points a game against
 * medium's 8.00, and **zero unit moves across eight whole games**.
 *
 * That is the worst shape for the person the setting exists for: a beginner
 * gets a walkover that teaches nothing, then meets medium and is crushed.
 * Easy should make the same kinds of move and simply choose worse.
 */

const POOL = poolData as unknown as Card[]
__setCardData(POOL)
setCardPool(POOL)
const DECKS = buildPresetDecks(POOL)

function games(difficulty: AIDifficulty, n = 10): GameState[] {
  const out: GameState[] = []
  for (let seed = 1; seed <= n; seed++) {
    out.push(
      playGame({
        playerDeck: DECKS[0],
        aiDeck: DECKS[1],
        pool: POOL,
        seed,
        rng: seededRng(seed),
        difficulty,
        label: `${difficulty} seed ${seed}`,
      }),
    )
  }
  return out
}

const count = (states: GameState[], re: RegExp) =>
  states.reduce((n, s) => n + s.log.filter((l) => re.test(l)).length, 0)

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('easy difficulty', () => {
  const easy = games('easy')

  it('moves units out of its base', () => {
    // The bug in one assertion. Without a move there is no conquer, no hold,
    // and therefore no way to score at all.
    expect(count(easy, /^ai moves /), 'easy never left its base').toBeGreaterThan(0)
  })

  it('scores points', () => {
    expect(avg(easy.map((s) => s.ai.points)), 'easy scored nothing').toBeGreaterThan(1)
  })

  it('wins sometimes', () => {
    const wins = easy.filter((s) => s.winner === 'ai').length
    expect(wins, 'easy lost every single game').toBeGreaterThan(0)
  })

  it('is still clearly easier than medium', () => {
    // The other half of the fix: making easy competent must not make it *as
    // good*, or the setting means nothing again — just in the other direction.
    //
    // Measured on the **opponent's** points, not the AI's. Both difficulties
    // reach the 8-point cap against the scripted bot, so comparing `ai.points`
    // cannot tell them apart — my first version of this assertion read 8 vs 8
    // and failed for that reason rather than a real one. How much the opponent
    // is allowed to score is sensitive, and it is also what a human feels.
    const medium = games('medium')
    const easyGave = avg(easy.map((s) => s.player.points))
    const mediumGave = avg(medium.map((s) => s.player.points))
    expect(
      easyGave,
      `easy let the opponent score ${easyGave}, medium ${mediumGave} — no real gap`,
    ).toBeGreaterThan(mediumGave + 1)
  })

  it('loses often enough to be worth playing', () => {
    // A beginner needs to be able to win. Against the scripted bot easy takes
    // about a third of the games; medium takes all of them.
    const wins = easy.filter((s) => s.winner === 'ai').length
    expect(wins, 'easy is unbeatable').toBeLessThan(easy.length)
  })

  it('is deterministic for a seed', () => {
    // `pickEasy` called `Math.random()` directly, bypassing the seeded RNG, so
    // the same seed gave different games and its behaviour could not be
    // measured — which is how "easy never moves" went unnoticed.
    const once = games('easy', 3).map((s) => s.log.join('|'))
    const twice = games('easy', 3).map((s) => s.log.join('|'))
    expect(once).toEqual(twice)
  })

  it('leaves no engine complaints in its logs', () => {
    for (const s of easy) {
      const tail = s.log.slice(-6).join(' | ')
      expect(tail).not.toMatch(/not implemented|undefined|NaN|Cannot read|Can't (play|move|hide)/i)
    }
  })
})
