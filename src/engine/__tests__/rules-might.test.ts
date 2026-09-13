/**
 * Conformance tests for Might, damage and the combat damage step, checked line
 * by line against the official Riftbound Core Rules (2026-03-30). Rule numbers
 * in the test names refer to that document.
 *
 * The load-bearing rule for this whole file is 143.2:
 *   "Might: The combat statistic of a Unit. Used to determine a Unit's
 *    contribution to Combat, as well as when it is Killed by damaging effects."
 *   143.2.a "If a Unit ever has nonzero damage marked on it equalling or
 *    exceeding its Might, it is Killed."
 * There is no separate health stat, so *anything* that changes a unit's current
 * Might changes how much damage kills it — including the role-conditional
 * keywords Assault (807) and Shield (814).
 */
import { describe, expect, it } from 'vitest'
import { GameState, UnitInPlay } from '../../types/game'
import { autoAssign, autoAssignmentList, effHp, forecastShowdown, resolveShowdown } from '../combat'
import {
  combatRoleOf,
  isMighty,
  keywordValue,
  lethalMight,
  mightBreakdown,
  showdownMight,
} from '../keywords'
import { dealDamage, giveMight, grantKeywordThisTurn } from '../abilities/effects'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

const unit = (name: string, might: number, keywords: string[] = [], text = '') =>
  makeCard({ name, type: 'unit', domains: ['fury'], energy: 2, might, keywords, text })

/** One `player` unit and one `ai` unit at bf0, plus handles on both. */
function facing(mine: ReturnType<typeof unit>, theirs: ReturnType<typeof unit>) {
  let s = startedGame({ firstPlayer: 'player' })
  s = placeUnitAt(s, 'player', mine, 0)
  s = placeUnitAt(s, 'ai', theirs, 0)
  const at = (st: GameState, side: 'player' | 'ai') =>
    st.battlefields[0].units.find((u) => u.owner === side)!
  return { s, at }
}

const namesAt = (s: GameState, side: 'player' | 'ai') =>
  s.battlefields[0].units.filter((u) => u.owner === side).map((u) => u.card.name)

// ── 143.2 — Might is the kill threshold ──────────────────────────────────

describe('143.2 Might is both attack and health', () => {
  it('143.2.a kills at damage equal to Might, not before', () => {
    const { s, at } = facing(unit('Mine', 3), unit('Theirs', 3))
    const u = at(s, 'player')
    expect(lethalMight(u, s)).toBe(3)

    const chipped = dealDamage(s, u.instanceId, 2)
    expect(namesAt(chipped, 'player')).toEqual(['Mine']) // 2 < 3, survives
    expect(dealDamage(chipped, u.instanceId, 1).battlefields[0].units).toHaveLength(1) // only the AI's
  })

  it('143.2.b a Might-0 unit is killed by any nonzero damage', () => {
    const { s, at } = facing(unit('Wisp', 0), unit('Theirs', 3))
    const u = at(s, 'player')
    // Might treated as 0, but 143.2.a needs *nonzero* damage — so 1 kills.
    expect(lethalMight(u, s)).toBe(1)
    expect(namesAt(dealDamage(s, u.instanceId, 1), 'player')).toEqual([])
  })
})

// ── 807 Assault / 814 Shield are role-conditional Might ──────────────────

describe('807 Assault: "While I am an attacker, I have +X Might"', () => {
  const fiend = unit('Fiend', 2, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')

  it('raises attack AND the kill threshold, but only as an attacker', () => {
    const { s, at } = facing(fiend, unit('Wall', 6))
    const u = at(s, 'player')

    expect(showdownMight(s, u, 'attacker')).toBe(5)
    expect(lethalMight(u, s, 'attacker')).toBe(5) // the rule has no damage carve-out

    expect(showdownMight(s, u, 'defender')).toBe(2)
    expect(lethalMight(u, s, 'defender')).toBe(2)
  })

  it('does not apply outside combat — 807.1.d ties it to the Attacker designation', () => {
    const { s, at } = facing(fiend, unit('Wall', 6))
    const u = at(s, 'player')
    expect(lethalMight(u, s)).toBe(2)
    // A burn spell in the main phase only has to get through printed Might.
    expect(namesAt(dealDamage(s, u.instanceId, 2), 'player')).toEqual([])
  })

  it('807.2 sums Assault from every source', () => {
    const { s, at } = facing(fiend, unit('Wall', 6))
    const granted = grantKeywordThisTurn(s, at(s, 'player').instanceId, 'Assault', 3)
    const u = at(granted, 'player')
    expect(keywordValue(u, 'Assault')).toBe(6) // 3 printed + 3 granted, summed
    expect(showdownMight(granted, u, 'attacker')).toBe(8) // 2 printed + 3 + 3
    expect(lethalMight(u, granted, 'attacker')).toBe(8)
  })
})

describe('814 Shield: "While I am a defender, I have +X Might"', () => {
  const mouser = unit('Mouser', 1, ['Shield'], "[Shield 2] (+2 :rb_might: while I'm a defender.)")

  it('raises attack AND the kill threshold, but only as a defender', () => {
    const { s, at } = facing(unit('Mine', 2), mouser)
    const u = at(s, 'ai')

    expect(showdownMight(s, u, 'defender')).toBe(3)
    expect(lethalMight(u, s, 'defender')).toBe(3)

    // The mirror of the Assault bug: Shield must not pad an *attacker's* health.
    expect(showdownMight(s, u, 'attacker')).toBe(1)
    expect(lethalMight(u, s, 'attacker')).toBe(1)
    expect(lethalMight(u, s)).toBe(1)
  })

  it('814.2 sums Shield from every source', () => {
    const { s, at } = facing(unit('Mine', 2), mouser)
    const granted = grantKeywordThisTurn(s, at(s, 'ai').instanceId, 'Shield', 3)
    const u = at(granted, 'ai')
    expect(lethalMight(u, granted, 'defender')).toBe(6) // 1 + 2 printed + 3 granted
  })
})

// ── 423.1 Stun ───────────────────────────────────────────────────────────

describe('423.1 Stun', () => {
  it('423.1.b contributes no Might but 423.1.c still needs full Might to kill', () => {
    const mouser = unit('Mouser', 4, ['Shield'], "[Shield 2] (+2 :rb_might: while I'm a defender.)")
    const { s, at } = facing(unit('Mine', 2), mouser)
    const stunned: GameState = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? {
              ...bf,
              units: bf.units.map((u) =>
                u.owner === 'ai' ? { ...u, counters: { ...u.counters, stunned: 1 } } : u,
              ),
            }
          : bf,
      ),
    }
    const u = at(stunned, 'ai')
    expect(showdownMight(stunned, u, 'defender')).toBe(0)
    // "its full might value" — Shield is part of that while it defends.
    expect(lethalMight(u, stunned, 'defender')).toBe(6)
  })
})

// ── 460.2 The Combat Damage Step ─────────────────────────────────────────

describe('460.2 combat damage uses each unit’s current Might', () => {
  it('an 8-Might attacker survives a 6-Might defender and conquers', () => {
    const fiend = unit('Fiend', 5, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')
    const { s } = facing(fiend, unit('Wall', 6))

    const f = forecastShowdown(s, 0, 'player')!
    expect(f.attackerMight).toBe(8)
    expect(f.attackerHealth).toBe(8) // 460.2 "using their current Might"
    expect(f.attackerLosses).toBe(0)

    const after = resolveShowdown(s, 0, 'player')
    expect(namesAt(after, 'player')).toEqual(['Fiend'])
    expect(namesAt(after, 'ai')).toEqual([])
  })

  it('a Shield defender survives damage that would kill its printed Might', () => {
    const mouser = unit('Mouser', 3, ['Shield'], "[Shield 2] (+2 :rb_might: while I'm a defender.)")
    const { s } = facing(unit('Mine', 3), mouser)
    const after = resolveShowdown(s, 0, 'player')
    // 3 damage vs a defending 5 — the Mouser lives; 5 back kills the 3-Might attacker.
    expect(namesAt(after, 'ai')).toEqual(['Mouser'])
    expect(namesAt(after, 'player')).toEqual([])
  })

  it('460.2.c.3 assigns lethal in full before moving on, cheapest first', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('Big', 5), 0)
    s = placeUnitAt(s, 'ai', unit('Small', 2), 0)
    const targets = s.battlefields[0].units
    const list = autoAssignmentList(4, targets, s, 'defender')
    // 4 damage: kill the 2, spill the rest onto the 5 rather than splitting 2/2.
    expect(list.map((a) => a.amount).sort()).toEqual([2, 2])
    expect(autoAssign(4, targets, s, 'defender').destroyed).toHaveLength(1)
  })

  it('460.2.c.4 never over-kills while another unit could still take damage', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('A', 2), 0)
    s = placeUnitAt(s, 'ai', unit('B', 2), 0)
    const targets = s.battlefields[0].units
    for (const a of autoAssignmentList(3, targets, s, 'defender')) {
      const t = targets.find((u) => u.instanceId === a.targetInstanceId)!
      expect(a.amount).toBeLessThanOrEqual(effHp(t, s, 'defender'))
    }
    // Excess needs a wipe, and 3 damage cannot wipe 4 Might.
    expect(autoAssign(3, targets, s, 'defender').excess).toBe(0)
    // 5 damage does wipe them, so the spare 1 is genuine excess.
    expect(autoAssign(5, targets, s, 'defender').excess).toBe(1)
  })

  it('815 Tank takes lethal first and 826 Backline last', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('Back', 1, ['Backline']), 0)
    s = placeUnitAt(s, 'ai', unit('Mid', 1), 0)
    s = placeUnitAt(s, 'ai', unit('Tank', 3, ['Tank']), 0)
    const targets = s.battlefields[0].units
    const order = autoAssignmentList(5, targets, s, 'defender').map(
      (a) => targets.find((u) => u.instanceId === a.targetInstanceId)!.card.name,
    )
    expect(order).toEqual(['Tank', 'Mid', 'Back'])
  })

  it('460.2.c.5 a Tank soaks damage it cannot die to, instead of the pool vanishing', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('Tank', 6, ['Tank']), 0)
    s = placeUnitAt(s, 'ai', unit('Squishy', 1), 0)
    const targets = s.battlefields[0].units
    const list = autoAssignmentList(4, targets, s, 'defender')
    const tank = targets.find((u) => u.card.name === 'Tank')!
    expect(list).toEqual([{ targetInstanceId: tank.instanceId, amount: 4 }])
    expect(autoAssign(4, targets, s, 'defender')).toEqual({ destroyed: [], excess: 0 })
  })
})

// ── 459.2.b / 461.7.a designations, and damage dealt mid-combat ──────────

describe('459.2.b designations while a showdown is live', () => {
  it('a Reaction burn must get through the attacker’s Assault Might', () => {
    const fiend = unit('Fiend', 2, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')
    const { s, at } = facing(fiend, unit('Wall', 6))
    const live: GameState = { ...s, pendingShowdown: { index: 0, declarer: 'player' } }
    const u = at(live, 'player')

    expect(combatRoleOf(live, u)).toBe('attacker')
    expect(combatRoleOf(live, at(live, 'ai'))).toBe('defender')
    // 4 damage does not kill a unit whose current Might is 5.
    expect(namesAt(dealDamage(live, u.instanceId, 4), 'player')).toEqual(['Fiend'])
    expect(namesAt(dealDamage(live, u.instanceId, 5), 'player')).toEqual([])
  })

  it('no showdown means no designation, so the same burn kills', () => {
    const fiend = unit('Fiend', 2, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')
    const { s, at } = facing(fiend, unit('Wall', 6))
    expect(combatRoleOf(s, at(s, 'player'))).toBeNull()
    expect(namesAt(dealDamage(s, at(s, 'player').instanceId, 2), 'player')).toEqual([])
  })
})

// ── 461.1.a Combat Cleanup ───────────────────────────────────────────────

describe('461.1.a the combat cleanup', () => {
  it('461.1.a.1 heals every surviving unit', () => {
    const { s } = facing(unit('Mine', 9), unit('Theirs', 2))
    const after = resolveShowdown(s, 0, 'player')
    const survivors: UnitInPlay[] = [
      ...after.battlefields.flatMap((bf) => bf.units),
      ...after.player.base,
      ...after.ai.base,
    ]
    expect(survivors.every((u) => u.damage === 0)).toBe(true)
  })

  it('461.1.a.2 recalls the attackers when both sides survive, and 453.1 leaves them ready', () => {
    // Since Might is both stats, two lone units can only both survive when one
    // is stunned: the 6-Might defender contributes 0 (423.1.b) yet still needs
    // 6 to die (423.1.c), so the 2-Might attacker can neither kill nor be
    // killed. That is 461.3.d "No Result".
    const { s } = facing(unit('Mine', 2), unit('Theirs', 6))
    const bumped: GameState = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? {
              ...bf,
              units: bf.units.map((u) =>
                u.owner === 'ai' ? { ...u, counters: { ...u.counters, stunned: 1 } } : u,
              ),
            }
          : bf,
      ),
    }
    const after = resolveShowdown(bumped, 0, 'player')
    expect(namesAt(after, 'player')).toEqual([]) // recalled
    expect(namesAt(after, 'ai')).toEqual(['Theirs']) // defender holds
    const recalled = after.player.base.find((u) => u.card.name === 'Mine')!
    // 453.1 — a Recall does not alter the permanent's state; it was ready, so it
    // stays ready rather than being force-exhausted by the retreat.
    expect(recalled.exhausted).toBe(false)
    expect(recalled.damage).toBe(0)
  })
})

// ── 707–710 Mighty ───────────────────────────────────────────────────────

describe('708/710 Mighty reads current Might', () => {
  it('a defending Shield unit can be Mighty while its printed Might is not', () => {
    const mouser = unit('Mouser', 4, ['Shield'], "[Shield 2] (+2 :rb_might: while I'm a defender.)")
    const { s, at } = facing(unit('Mine', 2), mouser)
    const u = at(s, 'ai')
    expect(isMighty(u, s)).toBe(false) // printed 4
    expect(isMighty(u, s, 'defender')).toBe(true) // current 6 while defending
  })
})

// ── The explanation must equal the number ───────────────────────────────

describe('mightBreakdown explains exactly the Might the engine uses', () => {
  it('sums to showdownMight for both roles, on a unit with every kind of term', () => {
    const fiend = unit('Fiend', 2, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')
    const { s, at } = facing(fiend, unit('Wall', 6))
    let st = grantKeywordThisTurn(s, at(s, 'player').instanceId, 'Shield', 2)
    st = giveMight(st, at(st, 'player').instanceId, 1)
    const u = at(st, 'player')

    for (const role of ['attacker', 'defender'] as const) {
      const terms = mightBreakdown(st, u, role)
      const sum = terms.reduce((n, tm) => n + tm.n, 0)
      // This is the whole point: the panel cannot drift from the fight.
      expect(sum, role).toBe(showdownMight(st, u, role))
      expect(sum, role).toBe(lethalMight(u, st, role))
    }
  })

  it('names each source, and tags role-specific ones correctly', () => {
    const fiend = unit('Fiend', 2, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')
    const { s, at } = facing(fiend, unit('Wall', 6))
    const u = at(s, 'player')

    const atk = mightBreakdown(s, u, 'attacker').map((tm) => tm.key)
    expect(atk).toEqual(['might.printed', 'might.assault'])
    // Assault is attacker-only, so a defender sees just the printed line.
    expect(mightBreakdown(s, u, 'defender').map((tm) => tm.key)).toEqual(['might.printed'])
  })

  it('carries the keyword magnitude for the label', () => {
    const fiend = unit('Fiend', 2, ['Assault'], '[Assault 3] (+3 :rb_might: while I am an attacker.)')
    const { s, at } = facing(fiend, unit('Wall', 6))
    const assault = mightBreakdown(s, at(s, 'player'), 'attacker').find((tm) => tm.key === 'might.assault')
    expect(assault).toMatchObject({ n: 3, vars: { n: 3 } })
  })

  it('a unit with no modifiers is a single printed line', () => {
    const { s, at } = facing(unit('Plain', 4), unit('Wall', 6))
    expect(mightBreakdown(s, at(s, 'player'), null)).toEqual([{ key: 'might.printed', n: 4 }])
  })
})
