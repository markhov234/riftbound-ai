import { describe, expect, it } from 'vitest'
import { GameState } from '../../types/game'
import { effectiveCost } from '../costs'
import { costOf } from '../runes'
import { dispatch } from '../actions'
import { makeCard, placeUnitAt, startedGame, withHand } from './fixtures'

const bump = (s: GameState, e: number): GameState => ({
  ...s,
  player: { ...s.player, runes: { ...s.player.runes, energy: e } },
})

describe('effectiveCost — cost modifiers', () => {
  it('an Empowered "your spells cost ⚡1✦1 less" aura discounts your spells (min ⚡1)', () => {
    const researcher = makeCard({
      name: 'Test Researchers',
      type: 'unit',
      domains: ['mind'],
      energy: 4,
      might: 2,
      text: '[Empowered][>] Your spells cost :rb_energy_1::rb_rune_rainbow: less, to a minimum of :rb_energy_1:.',
    })
    const spell = makeCard({ name: 'Big Spell', type: 'spell', domains: ['mind'], energy: 3, power: 2 })
    const cheap = makeCard({ name: 'Cheap Spell', type: 'spell', domains: ['mind'], energy: 1, power: 1 })

    let s = placeUnitAt(startedGame({ firstPlayer: 'player' }), 'player', researcher, 0)
    // Not Empowered yet → full price.
    expect(effectiveCost(s, 'player', spell)).toEqual(costOf(spell))

    s = {
      ...s,
      battlefields: s.battlefields.map((bf) => ({
        ...bf,
        units: bf.units.map((u) => (u.card.name === 'Test Researchers' ? { ...u, empowered: true } : u)),
      })),
    }
    // ⚡3 ✦2  →  ⚡2 ✦1
    expect(effectiveCost(s, 'player', spell)).toEqual({ energy: 2, power: 0, runes: ['colorless'] })
    // ⚡1 ✦1  →  floored at ⚡1, one pip removed
    expect(effectiveCost(s, 'player', cheap)).toEqual({ energy: 1, power: 0, runes: [] })
    // The AI's spells are unaffected by the player's aura.
    expect(effectiveCost(s, 'ai', spell)).toEqual(costOf(spell))
  })

  it('a battlefield surcharges [Reaction] cards during a showdown there', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? {
              ...bf,
              card: {
                ...bf.card!,
                text: 'During showdowns here, cards with [Reaction] cost :rb_rune_rainbow: more to play.',
              },
            }
          : bf,
      ),
    }
    const reaction = makeCard({
      name: 'Quick Trick',
      type: 'spell',
      domains: ['fury'],
      energy: 1,
      keywords: ['Reaction'],
      text: '[Reaction] Deal 1 to a unit.',
    })

    // No showdown → normal cost.
    expect(effectiveCost(s, 'player', reaction).runes).toEqual([])
    // Showdown at bf 0 → +1 pip.
    s = { ...s, pendingShowdown: { index: 0, declarer: 'ai' } }
    expect(effectiveCost(s, 'player', reaction).runes).toEqual(['colorless'])
  })

  it('Jayce free-gear grant: the next gear costs 0 Energy and the grant is spent', () => {
    const gear = makeCard({ name: 'Pricey Gear', type: 'gear', domains: ['fury'], energy: 5 })
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [gear])
    s = bump(s, 2) // can't afford ⚡5 normally
    s = { ...s, player: { ...s.player, identity: ['fury'], freeGearThisTurn: true } }

    expect(effectiveCost(s, 'player', gear).energy).toBe(0)

    const e0 = s.player.runes.energy
    s = dispatch(s, { type: 'PLAY_GEAR', card: gear, targetInstanceIds: [] }, 'player')
    expect(s.player.runes.energy).toBe(e0) // paid nothing
    expect(s.player.freeGearThisTurn).toBe(false) // grant consumed
    expect(s.stack.some((it) => it.card?.name === 'Pricey Gear')).toBe(true)
  })
})
