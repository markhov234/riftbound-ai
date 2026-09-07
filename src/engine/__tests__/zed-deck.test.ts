import { describe, expect, it } from 'vitest'
import { Card } from '../../types/card'
import { GameState, PlayerSide, UnitInPlay } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { dispatch, flowCost } from '../actions'
import { emit } from '../events'
import { showdownMight } from '../keywords'
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

/** A started Zed-vs-Irelia game with the player given open runes + identity. */
function game(): GameState {
  const zed = POOL // deck built ad-hoc below via initGame's own build path
  void zed
  let s = initGame(
    { id: 'z', name: 'Zed', legendId: byName('Zed - Master of Shadows').id, chosenChampionId: byName('Zed, From the Shadows').id, battlefieldIds: [], runes: [], cards: [], preset: true, createdAt: 0, updatedAt: 0 },
    { id: 'i', name: 'Irelia', legendId: byName('Irelia - Blade Dancer').id, chosenChampionId: byName('Irelia - Fervent').id, battlefieldIds: [], runes: [], cards: [], preset: true, createdAt: 0, updatedAt: 0 },
    POOL,
    { firstPlayer: 'player', rng: seededRng(3) },
  )
  s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
  s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')
  const runes = Array.from({ length: 8 }, (_, i) => ({
    ...byName('Chaos Rune') ?? POOL.find((c) => c.type === 'rune')!,
    id: `rune-${i}`,
    domains: [i % 2 ? 'fury' : 'chaos'] as Card['domains'],
  }))
  return {
    ...s,
    player: {
      ...s.player,
      identity: ALL,
      runes: { ...s.player.runes, channeled: runes, energy: 8, spent: [] },
    },
  }
}

const mkUnit = (
  card: Card,
  owner: PlayerSide,
  loc: UnitInPlay['location'],
  extra: Partial<UnitInPlay> = {},
): UnitInPlay => ({
  instanceId: `u-${card.name}-${owner}-${loc.kind}`,
  card,
  owner,
  location: loc,
  exhausted: false,
  damage: 0,
  counters: {},
  sick: false,
  ...extra,
})

const flat = (s: GameState) => [
  ...s.player.base,
  ...s.ai.base,
  ...s.battlefields.flatMap((b) => b.units),
]
const drainStack = (s: GameState): GameState => {
  let g = 0
  while (s.stack.length && g++ < 6) {
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
  }
  return s
}

describe('Zed deck — card powers vs the rules', () => {
  it('the deck gives Zed a token pile derived from its cards (Shadow Clone)', () => {
    const s = game()
    expect(s.player.tokenPile.some((c) => /shadow clone/i.test(c.name))).toBe(true)
    expect(s.player.tokenPile.every((c) => c.supertype === 'token')).toBe(true)
  })

  it('flowCost parses the printed [Flow] cost (energy + rune pips), not 0', () => {
    expect(flowCost(byName('Twilight Step'))).toEqual({ energy: 4, power: 0, runes: ['chaos'] })
    expect(flowCost(byName('Perfect Execution'))).toEqual({ energy: 3, power: 0, runes: ['fury'] })
    expect(flowCost(byName('Death Mark'))).toEqual({ energy: 1, power: 0, runes: ['colorless', 'colorless'] })
    expect(flowCost(byName('Ruthless Strike'))).toBeNull() // no Flow
  })

  it('banishing a card Empowers Zed – Master of Shadows', () => {
    let s = game()
    s = { ...s, player: { ...s.player, trash: [byName('Twilight Step')] } }
    expect(s.player.legendEmpowered).toBe(false)
    s = emit(s, { type: 'CARD_BANISHED', card: byName('Twilight Step'), owner: 'player' })
    expect(s.player.legendEmpowered).toBe(true)
  })

  it("Zed's legend Disempower ability needs him Empowered, then draws", () => {
    let s = game()
    const abilities = scriptFor(byName('Zed - Master of Shadows'))
    void abilities
    // Not Empowered → refused, no cost paid.
    const before = s
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: 'legend:player', abilityIndex: 0 }, 'player')
    expect(s.stack).toHaveLength(0)
    expect(s.log.some((l) => /not Empowered|can't be used/i.test(l))).toBe(true)
    expect(before.player.runes.energy).toBe(s.player.runes.energy)

    // Empower him, then it resolves: discard 1, then draw 1.
    s = { ...s, player: { ...s.player, legendEmpowered: true, hand: [byName('Twilight Step'), byName('Death Mark')] } }
    const hand0 = s.player.hand.length
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: 'legend:player', abilityIndex: 0 }, 'player')
    s = drainStack(s)
    expect(s.player.legendEmpowered).toBe(false)
    expect(s.player.hand.length).toBe(hand0) // -1 discard, +1 draw
  })

  it('Flow-casting Twilight Step from the trash spends the runes and banishes it', () => {
    let s = game()
    const mover = mkUnit(byName('Shadow Order Disciple'), 'player', { kind: 'base' })
    s = { ...s, player: { ...s.player, trash: [byName('Twilight Step')], base: [mover] } }
    const e0 = s.player.runes.energy
    s = dispatch(
      s,
      { type: 'CAST_FLOW', card: byName('Twilight Step'), targetInstanceIds: [mover.instanceId] },
      'player',
    )
    expect(s.stack).toHaveLength(1)
    s = drainStack(s)
    expect(s.player.banished.map((c) => c.name)).toContain('Twilight Step')
    expect(s.player.runes.energy).toBe(e0 - 4) // 4 energy; the chaos pip floats (recycled rune)
    expect(s.player.runes.spent).toHaveLength(1)
    expect(s.player.legendEmpowered).toBe(true) // banish → Empower
  })

  it('Death Mark burns 3 and makes a Shadow Clone token', () => {
    let s = game()
    s = { ...s, player: { ...s.player, hand: [byName('Death Mark')] } }
    const deck0 = s.player.mainDeck.length
    s = dispatch(s, { type: 'PLAY_SPELL', card: byName('Death Mark') }, 'player')
    s = drainStack(s)
    expect(deck0 - s.player.mainDeck.length).toBe(3)
    expect(flat(s).some((u) => /shadow clone/i.test(u.card.name) && u.owner === 'player')).toBe(true)
  })

  it('Shadow Fiend: [Empower] costs 2 energy + a Fury rune; Empowered → [Assault 3]', () => {
    let s = game()
    s = { ...s, player: { ...s.player, base: [mkUnit(byName('Shadow Fiend'), 'player', { kind: 'base' })] } }
    const id = s.player.base[0].instanceId
    const e0 = s.player.runes.energy
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0 }, 'player')
    s = drainStack(s)
    const fiend = s.player.base[0]
    expect(fiend.empowered).toBe(true)
    expect(s.player.runes.energy).toBe(e0 - 2) // 2 energy; the Fury rune pip floats
    expect(s.player.runes.spent.some((r) => r.domains[0] === 'fury')).toBe(true)
    expect(showdownMight(s, fiend, 'attacker')).toBe(fiend.card.might + 3) // [Assault 3]
  })

  it('Zed, Without a Sound: conquer makes a Shadow Clone; the swap ability costs a Chaos rune', () => {
    const sc = scriptFor(byName('Zed, Without a Sound'))
    expect(sc?.activated?.[0].cost).toEqual({ energy: 1, runes: ['chaos'] })

    let s = game()
    const zws = mkUnit(byName('Zed, Without a Sound'), 'player', { kind: 'battlefield', index: 0 })
    s = { ...s, battlefields: s.battlefields.map((b) => (b.index === 0 ? { ...b, units: [zws] } : b)) }
    const base0 = s.player.base.length
    s = emit(s, { type: 'CONQUERED', side: 'player', index: 0, excess: 0 })
    expect(s.player.base.length).toBe(base0 + 1)
    expect(s.player.base.some((u) => /shadow clone/i.test(u.card.name))).toBe(true)
  })

  it('Kennen: conquer grants [Flow] to trash spells for the turn', () => {
    let s = game()
    const ken = mkUnit(byName('Kennen, Storm of Shuriken'), 'player', { kind: 'battlefield', index: 0 })
    s = {
      ...s,
      player: { ...s.player, trash: [byName('Death Mark'), byName('Ruthless Strike')] },
      battlefields: s.battlefields.map((b) => (b.index === 0 ? { ...b, units: [ken] } : b)),
    }
    s = emit(s, { type: 'CONQUERED', side: 'player', index: 0, excess: 0 })
    expect(s.flowGranted).toContain(byName('Death Mark').id)
    expect(s.flowGranted).toContain(byName('Ruthless Strike').id)
    // Ruthless Strike (no printed Flow) is now Flow-eligible for its own cost.
    expect(flowCost(byName('Ruthless Strike'), s.flowGranted)).not.toBeNull()
  })

  it('Irelia - Blade Dancer legend: exhaust + a rune readies a friendly unit', () => {
    // Player is Irelia here (swap the two legends from `game()`).
    let s = initGame(
      { id: 'i', name: 'Irelia', legendId: byName('Irelia - Blade Dancer').id, chosenChampionId: byName('Irelia - Fervent').id, battlefieldIds: [], runes: [], cards: [], preset: true, createdAt: 0, updatedAt: 0 },
      { id: 'z', name: 'Zed', legendId: byName('Zed - Master of Shadows').id, chosenChampionId: byName('Zed, From the Shadows').id, battlefieldIds: [], runes: [], cards: [], preset: true, createdAt: 0, updatedAt: 0 },
      POOL,
      { firstPlayer: 'player', rng: seededRng(3) },
    )
    s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
    s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')
    const spent = mkUnit(byName('Irelia - Fervent'), 'player', { kind: 'base' }, { exhausted: true })
    s = {
      ...s,
      player: {
        ...s.player,
        identity: ALL,
        base: [spent],
        runes: { ...s.player.runes, channeled: Array.from({ length: 3 }, (_, i) => ({ ...POOL.find((c) => c.type === 'rune')!, id: `r${i}` })), energy: 3, spent: [] },
      },
    }

    const before = s.player.runes.energy
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: 'legend:player', abilityIndex: 0, targetInstanceIds: [spent.instanceId] }, 'player')
    // resolve the ability off the stack
    s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')
    s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')

    expect(s.player.base[0].exhausted).toBe(false) // unit readied
    expect(s.player.legendExhausted).toBe(true)
    expect(s.player.runes.energy).toBe(before) // rune pip floats — no energy cost
    expect(s.player.runes.spent).toHaveLength(1) // one rune recycled for the pip

    // Can't use it again this turn.
    const again = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: 'legend:player', abilityIndex: 0, targetInstanceIds: [spent.instanceId] }, 'player')
    expect(again.log.some((l) => /exhausted/i.test(l))).toBe(true)
  })
})
