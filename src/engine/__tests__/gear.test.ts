import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { dispatch } from '../actions'
import { beginTurn, endTurn } from '../phases'
import { showdownMight } from '../keywords'
import { _clearCompileCache } from '../abilities/compile'
import { killUnit } from '../abilities/effects'
import { grunt, makeCard, placeUnitAt, startedGame, withHand } from './fixtures'

_clearCompileCache()

/** Both players pass — resolve the top of the stack. */
function resolveTop(s: GameState): GameState {
  const holder = s.priority
  const other: PlayerSide = holder === 'player' ? 'ai' : 'player'
  s = dispatch(s, { type: 'PASS_PRIORITY' }, holder)
  return dispatch(s, { type: 'PASS_PRIORITY' }, other)
}

const bumpEnergy = (s: GameState, e: number): GameState => ({
  ...s,
  player: { ...s.player, runes: { ...s.player.runes, energy: e } },
})

const toolsOfEmpire = makeCard({
  name: 'Test Tools',
  type: 'gear',
  domains: ['fury'],
  energy: 2,
  text: '[Empower] :rb_energy_2: (:rb_energy_2:: Empower this. Use only if not Empowered.):rb_exhaust:: Give a unit +2 :rb_might: this turn. If this is [Empowered], give that unit +4 :rb_might: this turn instead.',
})
const tome = makeCard({
  name: 'Test Tome',
  type: 'gear',
  domains: ['fury'],
  energy: 3,
  text: '[Empower] — :rb_exhaust: (Pay the cost: Empower me. Use only if not Empowered.)Disempower this, :rb_energy_1:, :rb_exhaust:: Draw 1.',
})
const exhaustGear = makeCard({
  name: 'Slow Gear',
  type: 'gear',
  domains: ['fury'],
  energy: 1,
  text: 'This enters exhausted. :rb_exhaust:: Draw 1.',
})
const equipCutlass = makeCard({
  name: 'Test Cutlass',
  type: 'gear',
  domains: ['fury'],
  energy: 3,
  text: 'Equip :rb_rune_body: The equipped unit has +2 :rb_might: and [Assault 1].',
})

function playGear(s: GameState, card = toolsOfEmpire): GameState {
  s = withHand(s, 'player', [card])
  s = bumpEnergy(s, 9)
  s = dispatch(s, { type: 'PLAY_GEAR', card, targetInstanceIds: [] }, 'player')
  return resolveTop(s)
}

describe('gear enters and stays in play', () => {
  it('a played gear goes to player.gear (not the trash)', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }))
    expect(s.player.gear.map((g) => g.card.name)).toEqual(['Test Tools'])
    expect(s.player.trash.map((c) => c.name)).not.toContain('Test Tools')
    expect(s.player.gear[0].exhausted).toBe(false)
  })

  it('"This enters exhausted." → the gear enters exhausted', () => {
    const s = playGear(startedGame({ firstPlayer: 'player' }), exhaustGear)
    expect(s.player.gear[0].exhausted).toBe(true)
  })

  it('beginTurn readies gear; end-of-turn strips its transient counters', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }), exhaustGear)
    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, counters: { mightTurn: 3 } })) } }
    s = endTurn(s) // player ends → cleanup on player gear
    expect(s.player.gear[0].counters.mightTurn ?? 0).toBe(0)
    // back to the player's turn → gear readies
    s = beginTurn({ ...s, activePlayer: 'player', turn: s.turn + 1 })
    expect(s.player.gear[0].exhausted).toBe(false)
  })
})

describe('gear activated abilities', () => {
  it('Empower sets the status; the exhaust ability gives +2, or +4 while Empowered', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }))
    s = placeUnitAt(s, 'player', grunt, 0)
    const gearId = s.player.gear[0].instanceId
    const unitId = s.battlefields[0].units[0].instanceId

    // exhaust: +2 while NOT empowered
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 1, targetInstanceIds: [unitId] }, 'player')
    s = resolveTop(s)
    expect(s.battlefields[0].units[0].counters.mightTurn).toBe(2)
    expect(s.player.gear[0].exhausted).toBe(true)

    // ready the gear, Empower it, then the ability gives +4
    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) } }
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 0 }, 'player') // Empower
    s = resolveTop(s)
    expect(s.player.gear[0].empowered).toBe(true)
    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) } }
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 1, targetInstanceIds: [unitId] }, 'player')
    s = resolveTop(s)
    expect(s.battlefields[0].units[0].counters.mightTurn).toBe(2 + 4)
  })

  it('"Disempower this, …" requires the Empowered status and clears it', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }), tome)
    const gearId = s.player.gear[0].instanceId

    // not Empowered → the Disempower ability is refused
    const refused = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 1 }, 'player')
    expect(refused.stack).toHaveLength(0)
    expect(refused.log.some((l) => /not Empowered/i.test(l))).toBe(true)

    // Empower, then Disempower: draws, clears Empowered, exhausts
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 0 }, 'player')
    s = resolveTop(s)
    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) } }
    const handBefore = s.player.hand.length
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 1 }, 'player')
    s = resolveTop(s)
    expect(s.player.gear[0].empowered).toBe(false)
    expect(s.player.gear[0].exhausted).toBe(true)
    expect(s.player.hand.length).toBe(handBefore + 1)
  })
})

describe('Equipment attach', () => {
  it('[Equip] attaches to a friendly unit, grants its bonus, and detaches on death', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }), equipCutlass)
    s = placeUnitAt(s, 'player', grunt, 0) // might 2
    const gearId = s.player.gear[0].instanceId
    const unitId = s.battlefields[0].units[0].instanceId

    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: gearId, abilityIndex: 0, targetInstanceIds: [unitId] }, 'player')
    s = resolveTop(s)
    expect(s.player.gear[0].attachedTo).toBe(unitId)
    const u = s.battlefields[0].units[0]
    expect(showdownMight(s, u, 'attacker')).toBe(2 + 2 /*+2 Might grant*/ + 1 /*[Assault 1]*/)

    // kill the unit → gear stays in play, unattached, and the grant is gone
    s = killUnit(s, unitId)
    expect(s.player.gear).toHaveLength(1)
    expect(s.player.gear[0].attachedTo).toBeUndefined()
  })
})

describe('gear-count payoffs', () => {
  it('Repair Specialist has [Assault] equal to the number of gear you control', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const repair = makeCard({
      name: 'Repair Specialist',
      type: 'unit',
      domains: ['fury'],
      energy: 3,
      might: 3,
      keywords: ['Assault'],
      text: 'I have [Assault] equal to the number of gear you control.',
    })
    s = placeUnitAt(s, 'player', repair, 0)
    const u = s.battlefields[0].units[0]
    expect(showdownMight(s, u, 'attacker')).toBe(3)

    s = { ...s, player: { ...s.player, gear: [
      { instanceId: 'g1', card: exhaustGear, owner: 'player', exhausted: false, counters: {} },
      { instanceId: 'g2', card: tome, owner: 'player', exhausted: false, counters: {} },
    ] } }
    expect(showdownMight(s, s.battlefields[0].units[0], 'attacker')).toBe(3 + 2)
  })
})
