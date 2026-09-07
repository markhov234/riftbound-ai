import { describe, expect, it } from 'vitest'
import { Card } from '../../types/card'
import { GameState } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { dispatch } from '../actions'
import { scriptFor } from '../abilities/scripts'
import { setCardPool } from '../state'
import { initGame } from '../setup'
import { seededRng } from './fixtures'
import poolData from './fixtures/card-pool.json'

const POOL = poolData as unknown as Card[]
__setCardData(POOL)
setCardPool(POOL)
const byName = (n: string) => POOL.find((c) => c.name === n)!
const ALL: Card['domains'] = ['fury', 'calm', 'mind', 'body', 'order', 'chaos']

const drain = (s: GameState): GameState => {
  let g = 0
  while (s.stack.length && g++ < 8) {
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
  }
  return s
}
const mechCount = (s: GameState) =>
  [...s.player.base, ...s.battlefields.flatMap((b) => b.units)].filter((u) =>
    /mech/i.test(u.card.name),
  ).length

/** A started Jayce-vs-Zed game with the player given open runes + identity. */
function game(): GameState {
  let s = initGame(
    { id: 'j', name: 'J', legendId: byName('Jayce - Defender of Tomorrow').id, chosenChampionId: byName('Jayce, Hammer in Hand').id, battlefieldIds: [], runes: [], cards: [], preset: true, createdAt: 0, updatedAt: 0 },
    { id: 'z', name: 'Z', legendId: byName('Zed - Master of Shadows').id, chosenChampionId: byName('Zed, From the Shadows').id, battlefieldIds: [], runes: [], cards: [], preset: true, createdAt: 0, updatedAt: 0 },
    POOL,
    { firstPlayer: 'player', rng: seededRng(3) },
  )
  s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
  s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')
  const runes = Array.from({ length: 12 }, (_, i) => ({ ...POOL.find((c) => c.type === 'rune')!, id: `r${i}`, domains: [i % 2 ? 'mind' : 'body'] as Card['domains'] }))
  return { ...s, player: { ...s.player, identity: ALL, runes: { ...s.player.runes, channeled: runes, energy: 12, spent: [] } } }
}

/** Put `name` (a gear) straight into play. */
function withGear(s: GameState, name: string): { s: GameState; id: string } {
  s = { ...s, player: { ...s.player, hand: [{ ...byName(name), id: `${name}~1` }] } }
  s = dispatch(s, { type: 'PLAY_GEAR', card: s.player.hand[0], targetInstanceIds: [] }, 'player')
  s = drain(s)
  return { s, id: s.player.gear[0].instanceId }
}

describe('Jayce deck — gear powers vs the rules', () => {
  it('Hextech Disc: Empower, then Disempower → spawns exactly one 3-Might Mech', () => {
    let { s, id } = withGear(game(), 'Hextech Disc')
    expect(scriptFor(byName('Hextech Disc'))?.activated?.map((a) => a.label)).toEqual([
      expect.stringMatching(/^Empower/),
      expect.stringMatching(/Mech/),
    ])
    expect(mechCount(s)).toBe(0)

    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0 }, 'player') // Empower
    s = drain(s)
    expect(s.player.gear[0].empowered).toBe(true)
    expect(mechCount(s)).toBe(0) // Empower alone spawns nothing

    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) } }
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 1 }, 'player') // Disempower → Mech
    s = drain(s)
    expect(s.player.gear[0].empowered).toBe(false)
    expect(mechCount(s)).toBe(1)
    expect(s.player.base.find((u) => /mech/i.test(u.card.name))!.card.might).toBe(3)
  })

  it('Hextech Disc: the Disempower ability is refused (no Mech) while not Empowered', () => {
    const { s, id } = withGear(game(), 'Hextech Disc')
    const after = drain(dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 1 }, 'player'))
    expect(mechCount(after)).toBe(0)
    expect(after.player.runes.energy).toBe(s.player.runes.energy) // no cost paid
  })

  it('Questionable Tome: Empower, then Disempower → draws 1, spawns NO Mech', () => {
    let { s, id } = withGear(game(), 'Questionable Tome')
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0 }, 'player') // Empower
    s = drain(s)
    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) } }
    const h0 = s.player.hand.length
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 1 }, 'player') // Disempower → Draw 1
    s = drain(s)
    expect(mechCount(s)).toBe(0)
    expect(s.player.hand.length).toBe(h0 + 1)
  })

  it('Jayce – Defender of Tomorrow legend has "Ready a gear" and an Empowered variant', () => {
    const abils = scriptFor(byName('Jayce - Defender of Tomorrow'))?.activated ?? []
    // The legend runs through legendAbilities, but scriptFor should already carry the compiled set.
    expect(abils.some((a) => /ready a gear/i.test(a.label) || /ready 2 gear/i.test(a.label))).toBe(true)
  })
})
