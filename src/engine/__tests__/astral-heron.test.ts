import { beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { effectiveCost } from '../costs'
import { makeCard, placeUnitAt, startedGame, withHand } from './fixtures'
import { GameState } from '../../types/game'

/**
 * Astral Heron — "When you play your **first** card each turn, if I'm at a
 * battlefield, your **next** card costs 2 Energy + 2 runes less."
 *
 * The first card is the *trigger*, not the beneficiary: it pays full price, and
 * the card played after it is the discounted one. That is the card as printed,
 * and a report of "my first card still cost something" is the rule working.
 *
 * What is *not* right is two Herons paying out like one.
 */

const heron = makeCard({
  name: 'Astral Heron',
  type: 'unit',
  energy: 7,
  might: 7,
  text: "When you play your first card each turn, if I'm at a battlefield, your next card costs :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: less.",
})

const cheap = makeCard({ name: 'Cheap Unit', type: 'unit', energy: 1, might: 1 })
const pricey = makeCard({ name: 'Pricey Unit', type: 'unit', energy: 6, might: 5 })

beforeAll(() => _clearCompileCache())

/** `n` Herons at a battlefield, two spare cards in hand, plenty of energy. */
function withHerons(n: number): GameState {
  let s = startedGame({ firstPlayer: 'player', seed: 9 })
  for (let i = 0; i < n; i++) s = placeUnitAt(s, 'player', heron, 0)
  s = withHand(s, 'player', [cheap, pricey])
  return {
    ...s,
    player: {
      ...s.player,
      runes: { ...s.player.runes, energy: 12 },
    },
  }
}

describe('Astral Heron', () => {
  it('does not discount the first card — that card is the trigger', () => {
    const s = withHerons(1)
    expect(effectiveCost(s, 'player', cheap).energy, 'full price before anything is played')
      .toBe(cheap.energy)
  })

  it('discounts the second card of the turn', () => {
    let s = withHerons(1)
    s = dispatch(s, { type: 'PLAY_UNIT', card: cheap, to: { kind: 'base' } }, 'player')
    expect(s.player.nextCardDiscount, 'the trigger fired').toBeTruthy()
    expect(effectiveCost(s, 'player', pricey).energy).toBe(pricey.energy - 2)
  })

  it('stacks two Herons onto the same card', () => {
    // Both are separate ability sources and both conditions hold, so both pay
    // out. Overwriting `nextCardDiscount` instead of adding to it made the
    // second Heron worth nothing at all.
    let s = withHerons(2)
    s = dispatch(s, { type: 'PLAY_UNIT', card: cheap, to: { kind: 'base' } }, 'player')
    expect(s.player.nextCardDiscount?.energy, 'two Herons, two discounts').toBe(4)
    expect(effectiveCost(s, 'player', pricey).energy).toBe(pricey.energy - 4)
  })

  it('spends the discount on one card only', () => {
    let s = withHerons(1)
    s = dispatch(s, { type: 'PLAY_UNIT', card: cheap, to: { kind: 'base' } }, 'player')
    s = dispatch(s, { type: 'PLAY_UNIT', card: pricey, to: { kind: 'base' } }, 'player')
    expect(s.player.nextCardDiscount, 'used up by the second card').toBeFalsy()
  })

  it('does nothing while the Heron sits at the base', () => {
    // "if I'm at a battlefield" — the control for the whole card.
    let s = startedGame({ firstPlayer: 'player', seed: 9 })
    s = withHand(s, 'player', [cheap, pricey])
    s = {
      ...s,
      player: {
        ...s.player,
        base: [
          ...s.player.base,
          {
            instanceId: 'heron-base',
            card: heron,
            owner: 'player' as const,
            location: { kind: 'base' as const },
            exhausted: false,
            damage: 0,
            counters: {},
            sick: false,
          },
        ],
        runes: { ...s.player.runes, energy: 12 },
      },
    }
    s = dispatch(s, { type: 'PLAY_UNIT', card: cheap, to: { kind: 'base' } }, 'player')
    expect(s.player.nextCardDiscount).toBeFalsy()
  })
})
