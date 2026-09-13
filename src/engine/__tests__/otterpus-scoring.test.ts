import { describe, expect, it } from 'vitest'
import { Card } from '../../types/card'
import { GameState, PlayerSide, VICTORY_SCORE } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { setCardPool } from '../state'
import { scoreConquer, scoreHolds } from '../scoring'
import { startedGame } from './fixtures'
import poolData from './fixtures/card-pool.json'

const POOL = poolData as unknown as Card[]
__setCardData(POOL)
setCardPool(POOL)
const byName = (n: string) => POOL.find((c) => c.name === n)!

/**
 * Otterpus — "If a player would score 1 point from conquering or holding
 * during their first or second turn, they draw 1 instead." (VEN 053, read off
 * the printed card face.)
 *
 * Every clause here is load-bearing: *a player* (either side), *conquering or
 * holding* (not other point sources), and *their first or second turn*.
 */

/** Put a unit on battlefield `index` for `side`, bypassing play restrictions. */
function place(s: GameState, side: PlayerSide, name: string, index: number, tag = '1'): GameState {
  return {
    ...s,
    battlefields: s.battlefields.map((bf, i) =>
      i === index
        ? {
            ...bf,
            units: [
              ...bf.units,
              {
                instanceId: `${tag}-${side}-${index}`,
                card: byName(name),
                owner: side,
                location: { kind: 'battlefield' as const, index },
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

/** Otterpus sitting at a player's base — in play, but not contesting anything. */
function withOtterpus(s: GameState, side: PlayerSide): GameState {
  const unit = {
    instanceId: `otter-${side}`,
    card: byName('Otterpus'),
    owner: side,
    location: { kind: 'base' as const },
    exhausted: false,
    damage: 0,
    counters: {},
    sick: false,
  }
  return side === 'player'
    ? { ...s, player: { ...s.player, base: [...s.player.base, unit] } }
    : { ...s, ai: { ...s.ai, base: [...s.ai.base, unit] } }
}

const atRound = (s: GameState, round: number): GameState => ({ ...s, round, turn: (round - 1) * 2 })

describe('Otterpus — early points become draws', () => {
  it('turns a first-turn conquer into a draw, not a point', () => {
    let s = atRound(startedGame(), 1)
    s = withOtterpus(s, 'player')
    s = place(s, 'player', 'Pouty Poro', 0)
    const hand = s.player.hand.length
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points, 'no point on turn one').toBe(0)
    expect(out.player.hand.length, 'drew 1 instead').toBe(hand + 1)
  })

  it('turns a second-turn hold into a draw', () => {
    let s = atRound(startedGame(), 2)
    s = withOtterpus(s, 'player')
    s = place(s, 'player', 'Pouty Poro', 0)
    const hand = s.player.hand.length
    const out = scoreHolds(s, 'player')
    expect(out.player.points).toBe(0)
    expect(out.player.hand.length).toBe(hand + 1)
  })

  it('stops replacing from the third turn on', () => {
    let s = atRound(startedGame(), 3)
    s = withOtterpus(s, 'player')
    s = place(s, 'player', 'Pouty Poro', 0)
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points, 'round 3 scores normally').toBe(1)
  })

  it('replaces one point per battlefield held, not just the first', () => {
    let s = atRound(startedGame(), 1)
    s = withOtterpus(s, 'player')
    s = place(s, 'player', 'Pouty Poro', 0, 'a')
    s = place(s, 'player', 'Pouty Poro', 1, 'b')
    const hand = s.player.hand.length
    const out = scoreHolds(s, 'player')
    expect(out.player.points).toBe(0)
    expect(out.player.hand.length, 'two holds → two draws').toBe(hand + 2)
  })

  it('is symmetric — the AI\'s Otterpus blanks the player\'s early point too', () => {
    // The card says "a player", not "you".
    let s = atRound(startedGame(), 1)
    s = withOtterpus(s, 'ai')
    s = place(s, 'player', 'Pouty Poro', 0)
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points, "enemy Otterpus still replaces your point").toBe(0)
  })

  it('and blanks the AI\'s early point when the player owns it', () => {
    let s = atRound(startedGame(), 1)
    s = withOtterpus(s, 'player')
    s = place(s, 'ai', 'Pouty Poro', 0)
    const out = scoreConquer(s, 'ai', 0)
    expect(out.ai.points).toBe(0)
  })

  it('does nothing once it has left play', () => {
    let s = atRound(startedGame(), 1)
    s = place(s, 'player', 'Pouty Poro', 0)
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points, 'no Otterpus, normal scoring').toBe(1)
  })
})

describe('scoring does not draw a card in general (rule 466)', () => {
  it('a plain conquer scores a point and draws nothing', () => {
    // 466.1 gains a point; the only draw in the scoring rules is 466.1.b.2.
    // This used to draw on every conquer — a free card almost every turn.
    let s = atRound(startedGame(), 3)
    s = place(s, 'player', 'Pouty Poro', 0)
    const hand = s.player.hand.length
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points).toBe(1)
    expect(out.player.hand.length, 'no draw for conquering').toBe(hand)
  })

  it('a hold scores a point and draws nothing', () => {
    let s = atRound(startedGame(), 3)
    s = place(s, 'player', 'Pouty Poro', 0)
    const hand = s.player.hand.length
    const out = scoreHolds(s, 'player')
    expect(out.player.points).toBe(1)
    expect(out.player.hand.length).toBe(hand)
  })

  it('466.1.b.2 — a refused winning conquer draws instead', () => {
    let s = atRound(startedGame(), 3)
    s = { ...s, player: { ...s.player, points: VICTORY_SCORE - 1 } }
    // Hold only one of the two battlefields, so this is not a sweep.
    s = place(s, 'player', 'Pouty Poro', 0)
    s = place(s, 'ai', 'Pouty Poro', 1)
    const hand = s.player.hand.length
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points, 'winning point refused').toBe(VICTORY_SCORE - 1)
    expect(out.player.hand.length, 'draws 1 as consolation').toBe(hand + 1)
    expect(out.winner).toBeFalsy()
  })

  it('a sweep still takes the winning point', () => {
    let s = atRound(startedGame(), 3)
    s = { ...s, player: { ...s.player, points: VICTORY_SCORE - 1 } }
    for (let i = 0; i < s.battlefields.length; i++) s = place(s, 'player', 'Pouty Poro', i, `w${i}`)
    const out = scoreConquer(s, 'player', 0)
    expect(out.player.points).toBe(VICTORY_SCORE)
    expect(out.winner).toBe('player')
  })
})
