import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { dispatch, spellTiming } from '../actions'
import { beginTurn, endTurn } from '../phases'
import { showdownMight } from '../keywords'
import { _clearCompileCache } from '../abilities/compile'
import { scriptFor } from '../abilities/scripts'
import { dealDamage, gearGrants, killUnit, readyGearById } from '../abilities/effects'
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
    const s = playGear(startedGame({ firstPlayer: 'player' }))
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

describe('[Quick-Draw]', () => {
  it('has Reaction timing and auto-attaches to the chosen unit on play', () => {
    _clearCompileCache()
    const qd = makeCard({
      name: 'Snap Blade',
      type: 'gear',
      domains: ['fury'],
      energy: 2,
      keywords: ['Quick-Draw'],
      text: '[Quick-Draw] The equipped unit has +1 :rb_might:.',
    })
    expect(spellTiming(qd)).toBe('reaction')

    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0) // might 2
    s = withHand(s, 'player', [qd])
    s = bumpEnergy(s, 9)
    const unitId = s.battlefields[0].units[0].instanceId

    s = dispatch(s, { type: 'PLAY_GEAR', card: qd, targetInstanceIds: [unitId] }, 'player')
    s = resolveTop(s)

    expect(s.player.gear).toHaveLength(1)
    expect(s.player.gear[0].attachedTo).toBe(unitId)
    expect(showdownMight(s, s.battlefields[0].units[0], 'attacker')).toBe(2 + 1)
  })
})

describe('[Weaponmaster]', () => {
  it('on entering play, attaches a controlled Equipment to itself', () => {
    _clearCompileCache()
    const wm = makeCard({
      name: 'Blade Sergeant',
      type: 'unit',
      domains: ['fury'],
      energy: 3,
      might: 3,
      keywords: ['Weaponmaster'],
      text: '[Weaponmaster]',
    })
    // Cutlass already in play, unattached.
    let s = playGear(startedGame({ firstPlayer: 'player' }), equipCutlass)
    s = withHand(s, 'player', [wm])
    s = bumpEnergy(s, 9)

    s = dispatch(s, { type: 'PLAY_UNIT', card: wm, to: { kind: 'base' } }, 'player')
    const u = s.player.base.find((x) => x.card.name === 'Blade Sergeant')!
    expect(s.player.gear[0].attachedTo).toBe(u.instanceId)
    // Cutlass grants +2 Might and [Assault 1].
    expect(showdownMight(s, s.player.base.find((x) => x.card.name === 'Blade Sergeant')!, 'attacker')).toBe(
      3 + 2 + 1,
    )
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

// ── Regressions from live play (Part 2.46) ────────────────────────────────

const platewyrmEgg = makeCard({
  name: 'Test Egg',
  type: 'gear',
  domains: ['fury'],
  energy: 3,
  text: 'This enters exhausted.[Empower] — :rb_energy_1:, :rb_exhaust: (Pay the cost: Empower this. Use only if not Empowered.)[Reaction][>] :rb_exhaust:: [Add] :rb_energy_1:. If this is [Empowered], [Add] :rb_energy_2: instead.',
})

const readyGearLegendText =
  ':rb_energy_1:, :rb_exhaust:: Ready a gear.'

describe('an ability whose effect starts with a [Keyword] still compiles', () => {
  // The cost/effect divider used to require `\s+[A-Z]` after the colon, so
  // "…:rb_exhaust:: [Add] :rb_energy_1:." found no divider and the whole
  // ability was silently dropped.
  const abilityIndex = () =>
    (scriptFor(platewyrmEgg)?.activated ?? []).findIndex((a) => /Add/.test(a.label))

  it('exposes the [Add] ability, not just [Empower]', () => {
    const labels = (scriptFor(platewyrmEgg)?.activated ?? []).map((a) => a.label)
    expect(labels.some((l) => /Empower/.test(l))).toBe(true)
    expect(labels.some((l) => /Add/.test(l))).toBe(true)
    // and the label renders its symbols rather than blanking them
    expect(labels.find((l) => /Add/.test(l))).toContain('1⚡')
  })

  it('adds 1 energy exhausted, 2 while Empowered', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }), platewyrmEgg)
    const idx = abilityIndex()
    expect(idx).toBeGreaterThanOrEqual(0)

    // ready it and zero the pool so the gain is unambiguous
    s = {
      ...s,
      player: {
        ...s.player,
        gear: s.player.gear.map((g) => ({ ...g, exhausted: false })),
        runes: { ...s.player.runes, energy: 0 },
      },
    }
    const id = s.player.gear[0].instanceId

    const plain = resolveTop(
      dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: idx }, 'player'),
    )
    expect(plain.player.runes.energy).toBe(1)
    expect(plain.player.gear[0].exhausted).toBe(true)

    const emp = {
      ...s,
      player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, empowered: true })) },
    }
    const boosted = resolveTop(
      dispatch(emp, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: idx }, 'player'),
    )
    expect(boosted.player.runes.energy).toBe(2)
  })
})

describe('"Ready a gear" lets the controller choose which', () => {
  const legend = makeCard({ name: 'Test Ready Legend', type: 'legend', domains: ['fury'], text: readyGearLegendText })

  it('declares a friendlyGear target instead of readying array-order', () => {
    const ab = (scriptFor(legend)?.activated ?? []).find((a) => /Ready/.test(a.label))
    expect(ab).toBeTruthy()
    expect(ab!.targets?.[0]?.kind).toBe('friendlyGear')
  })

  it('only offers exhausted gear as a target', () => {
    const ab = (scriptFor(legend)?.activated ?? []).find((a) => /Ready/.test(a.label))!
    const spec = ab.targets![0]
    expect(spec.gearFilter).toBeTruthy()
    const ready = { exhausted: false } as never
    const spent = { exhausted: true } as never
    expect(spec.gearFilter!(spent, {} as never)).toBe(true)
    expect(spec.gearFilter!(ready, {} as never)).toBe(false)
  })

  it('readies the gear that was picked, not the first in the list', () => {
    let s = playGear(startedGame({ firstPlayer: 'player' }), exhaustGear)
    s = playGear(s, platewyrmEgg)
    // both exhausted
    s = { ...s, player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: true })) } }
    expect(s.player.gear).toHaveLength(2)

    const second = s.player.gear[1].instanceId
    const readied = readyGearById(s, second)
    expect(readied.player.gear[0].exhausted).toBe(true) // untouched
    expect(readied.player.gear[1].exhausted).toBe(false) // the one we picked
  })
})

describe('Guardian Angel replaces the equipped unit’s death', () => {
  // riftcodex's `text` for Guardian Angel carries only the [Equip] line and
  // omits the granted ability printed on the card, so this is scripted by hand.
  const guardianAngel = makeCard({
    name: 'Guardian Angel',
    type: 'gear',
    domains: ['fury'],
    energy: 2,
    text: '[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)',
  })

  /** A unit at a battlefield carrying Guardian Angel. */
  function equipped(): { s: GameState; unitId: string; gearId: string } {
    let s = playGear(startedGame({ firstPlayer: 'player' }), guardianAngel)
    s = placeUnitAt(s, 'player', grunt, 0)
    const unitId = s.battlefields[0].units[0].instanceId
    const gearId = s.player.gear[0].instanceId
    s = {
      ...s,
      player: {
        ...s.player,
        gear: s.player.gear.map((g) => ({ ...g, attachedTo: unitId })),
      },
    }
    return { s, unitId, gearId }
  }

  it('kills the gear instead and recalls the unit exhausted', () => {
    const { s, unitId, gearId } = equipped()
    const after = killUnit(s, unitId)

    // The unit survives — back at base, healed, exhausted, not in the trash.
    const unit = [...after.player.base, ...after.battlefields.flatMap((b) => b.units)].find(
      (u) => u.instanceId === unitId,
    )
    expect(unit, 'unit should still be in play').toBeTruthy()
    expect(unit!.location.kind).toBe('base')
    expect(unit!.exhausted).toBe(true)
    expect(unit!.damage).toBe(0)
    expect(after.player.trash.some((c) => c.name === grunt.name)).toBe(false)

    // The gear took the hit.
    expect(after.player.gear.some((g) => g.instanceId === gearId)).toBe(false)
  })

  it('replaces a death from combat damage too', () => {
    const { s, unitId } = equipped()
    const lethal = grunt.might + 5
    const after = dealDamage(s, unitId, lethal)
    const unit = after.player.base.find((u) => u.instanceId === unitId)
    expect(unit, 'lethal damage should be replaced, not kill').toBeTruthy()
    expect(after.player.trash.some((c) => c.name === grunt.name)).toBe(false)
  })

  it('does not fire UNIT_DIED, so Deathknell is skipped', () => {
    const { s, unitId } = equipped()
    const seen: string[] = []
    killUnit(s, unitId, (st, e) => {
      seen.push(e.type)
      return st
    })
    expect(seen).not.toContain('UNIT_DIED')
  })

  it('an unequipped unit still dies normally', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    const id = s.battlefields[0].units[0].instanceId
    const after = killUnit(s, id)
    expect(after.battlefields[0].units).toHaveLength(0)
    expect(after.player.trash.some((c) => c.name === grunt.name)).toBe(true)
  })
})

describe("Zhonya's Hourglass saves any friendly unit, not just an attached one", () => {
  // Errata'd text: "If a friendly unit would die, kill this instead. Heal that
  // unit, exhaust it, and recall it." It is a standalone gear — nothing is ever
  // attached to it, which is exactly why it used to do nothing: the death
  // replacement only looked at gear attached to the dying unit.
  const zhonyas = makeCard({
    name: "Zhonya's Hourglass",
    type: 'gear',
    // scriptFor matches on the name, so the test domain just has to be legal here.
    domains: ['fury'],
    energy: 2,
    text: "[Hidden] If a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it. (Send it to base. This isn't a move.)",
  })

  /** Zhonya's in play (unattached) plus an unrelated friendly unit at bf0. */
  function inPlay(): { s: GameState; unitId: string; gearId: string } {
    let s = playGear(startedGame({ firstPlayer: 'player' }), zhonyas)
    s = placeUnitAt(s, 'player', grunt, 0)
    return {
      s,
      unitId: s.battlefields[0].units[0].instanceId,
      gearId: s.player.gear[0].instanceId,
    }
  }

  it('is never attached to anything', () => {
    const { s } = inPlay()
    expect(s.player.gear[0].attachedTo).toBeFalsy()
  })

  it('replaces the death: the gear dies, the unit is healed and recalled exhausted', () => {
    const { s, unitId, gearId } = inPlay()
    const after = killUnit(s, unitId)

    const unit = after.player.base.find((u) => u.instanceId === unitId)
    expect(unit, 'unit should be saved, not trashed').toBeTruthy()
    expect(unit!.location.kind).toBe('base')
    expect(unit!.exhausted).toBe(true)
    expect(unit!.damage).toBe(0)
    expect(after.player.trash.some((c) => c.name === grunt.name)).toBe(false)
    expect(after.player.gear.some((g) => g.instanceId === gearId)).toBe(false)
    expect(after.player.trash.some((c) => c.name === zhonyas.name)).toBe(true)
  })

  it('saves a unit killed by combat damage — the reported bug', () => {
    const { s, unitId } = inPlay()
    const after = dealDamage(s, unitId, grunt.might + 5)
    expect(after.player.base.find((u) => u.instanceId === unitId)).toBeTruthy()
    expect(after.player.trash.some((c) => c.name === grunt.name)).toBe(false)
  })

  it('does not protect the opponent’s units', () => {
    let { s } = inPlay()
    s = placeUnitAt(s, 'ai', grunt, 0)
    const enemyId = s.battlefields[0].units.find((u) => u.owner === 'ai')!.instanceId
    const after = killUnit(s, enemyId)
    expect(after.ai.trash.some((c) => c.name === grunt.name)).toBe(true)
    expect(after.player.gear).toHaveLength(1) // the gear is untouched
  })

  it('only saves one unit — once it is gone the next death is real', () => {
    const { s, unitId } = inPlay()
    const saved = killUnit(s, unitId)
    const again = killUnit(saved, unitId)
    expect(again.player.base.find((u) => u.instanceId === unitId)).toBeFalsy()
    expect(again.player.trash.some((c) => c.name === grunt.name)).toBe(true)
  })
})

describe('a script can supply a gear grant the API text omits', () => {
  it('Guardian Angel gives its equipped unit Shield 1', () => {
    // riftcodex's text has no granted box at all, so `gearGrants` parses
    // nothing from it — the script fills that in via `gearGrant`.
    const ga = makeCard({
      name: 'Guardian Angel',
      type: 'gear',
      domains: ['fury'],
      energy: 2,
      text: '[Equip] :rb_rune_fury: (:rb_rune_fury:: Attach this to a unit you control.)',
    })
    expect(gearGrants(ga).keywords).toContainEqual({ name: 'Shield', x: 1 })
  })

  it('leaves gear whose text does spell it out alone', () => {
    expect(gearGrants(equipCutlass).might).toBe(2)
    expect(gearGrants(equipCutlass).keywords).toContainEqual({ name: 'Assault', x: 1 })
  })
})
