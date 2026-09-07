import { describe, expect, it } from 'vitest'
import { canAfford, channelRune, costOf, payCost, recycleRune } from '../runes'
import { startedGame } from './fixtures'

describe('runes', () => {
  it('channelRune adds energy and pulls from the rune deck', () => {
    const state = startedGame()
    const before = state.player.runes
    const next = channelRune(state, 'player')
    expect(next.player.runes.energy).toBe(before.energy + 1)
    expect(next.player.runes.deck).toHaveLength(before.deck.length - 1)
    expect(next.player.runes.channeled).toHaveLength(before.channeled.length + 1)
  })

  it('recycleRune adds power for the turn', () => {
    const state = startedGame()
    const next = recycleRune(state, 'player')
    expect(next.player.runes.power).toBe(1)
    expect(next.player.runes.recycled).toHaveLength(1)
  })

  it('canAfford / payCost — a channeled rune pays an energy OR a power pip', () => {
    const state = startedGame() // player has 2 energy, 0 power
    expect(canAfford(state, 'player', { energy: 2, power: 0 })).toBe(true)
    expect(canAfford(state, 'player', { energy: 3, power: 0 })).toBe(false)
    // A power pip with no recycled power is now covered by the energy pool.
    expect(canAfford(state, 'player', { energy: 1, power: 1 })).toBe(true)
    expect(canAfford(state, 'player', { energy: 2, power: 1 })).toBe(false) // 2e + 1p > 2 runes
    // Power can never pay the energy cost.
    expect(canAfford(state, 'player', { energy: 0, power: 3 })).toBe(false)

    const spilled = payCost(state, 'player', { energy: 1, power: 1 })
    expect(spilled.player.runes.energy).toBe(0) // 1 energy + 1 pip from energy
    expect(spilled.player.runes.power).toBe(0)

    const withPower = payCost(recycleRune(state, 'player'), 'player', { energy: 1, power: 1 })
    expect(withPower.player.runes.energy).toBe(1) // 2 energy − 1 energy cost; pip took the recycled power
    expect(withPower.player.runes.power).toBe(0)
  })

  it('costOf turns a card\'s power pips into rainbow rune symbols', () => {
    expect(costOf({ energy: 3, power: 1 })).toEqual({ energy: 3, power: 0, runes: ['colorless'] })
    expect(costOf({ energy: 2, power: 0 })).toEqual({ energy: 2, power: 0, runes: [] })
  })

  it('a domain Power pip recycles a channeled rune of that domain (it floats — no extra energy)', () => {
    let s = startedGame() // 2 channeled runes (Fury deck fixtures), 2 energy
    s = channelRune(s, 'player') // 3 channeled, 3 energy
    const chaos = { ...s.player.runes.channeled[0], domains: ['chaos' as const] }
    s = {
      ...s,
      player: {
        ...s.player,
        runes: { ...s.player.runes, channeled: [chaos, ...s.player.runes.channeled.slice(1)] },
      },
    }
    expect(canAfford(s, 'player', { energy: 1, power: 0, runes: ['chaos'] })).toBe(true)
    const paid = payCost(s, 'player', { energy: 1, power: 0, runes: ['chaos'] })
    expect(paid.player.runes.spent).toHaveLength(1)
    expect(paid.player.runes.spent[0].domains[0]).toBe('chaos') // matching domain preferred
    expect(paid.player.runes.energy).toBe(2) // 3 − 1 explicit energy; the chaos pip floats

    // With every rune already spent, the same cost is refused.
    const drained = {
      ...paid,
      player: { ...paid.player, runes: { ...paid.player.runes, spent: paid.player.runes.channeled } },
    }
    expect(canAfford(drained, 'player', { energy: 0, power: 0, runes: ['chaos'] })).toBe(false)
  })
})
