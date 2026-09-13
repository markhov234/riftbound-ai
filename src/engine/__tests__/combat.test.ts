import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import {
  autoAssign,
  autoAssignmentList,
  effHp,
  forecastShowdown,
  resolveShowdown,
  validateAssignment,
} from '../combat'
import { dispatch } from '../actions'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

const unit = (name: string, might: number, keywords: string[] = []) =>
  makeCard({ name, type: 'unit', domains: ['fury'], energy: 2, might, keywords })

/** bf0 with `player` attackers and `ai` defenders; returns the paused showdown. */
function pausedShowdown(atk: number[], def: Array<[string, number, string[]?]>): GameState {
  let s = startedGame({ firstPlayer: 'player' })
  atk.forEach((m, i) => (s = placeUnitAt(s, 'player', unit(`Atk${i}`, m), 0)))
  def.forEach(([n, m, kw]) => (s = placeUnitAt(s, 'ai', unit(n, m, kw ?? []), 0)))
  return resolveShowdown(s, 0, 'player')
}

function aiUnitNames(s: GameState): string[] {
  return s.battlefields[0].units.filter((u) => u.owner === 'ai').map((u) => u.card.name)
}

describe('manual showdown damage assignment', () => {
  it('pauses for the human declarer and holds priority when it is a real choice', () => {
    const paused = pausedShowdown([3, 3], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])

    expect(paused.pendingDamage).not.toBeNull()
    expect(paused.pendingDamage!.assigningSide).toBe<PlayerSide>('player')
    expect(paused.pendingDamage!.stage).toBe('def')
    expect(paused.pendingDamage!.pool).toBe(6)
    expect(paused.pendingDamage!.targetIds).toHaveLength(3)
    // Nothing has died yet — combat is suspended.
    expect(aiUnitNames(paused)).toEqual(['Wall', 'A', 'B'])
  })

  it('auto-resolves (no prompt) when every defender dies anyway', () => {
    const paused = pausedShowdown([9], [['A', 2], ['B', 2]])
    expect(paused.pendingDamage).toBeNull()
    expect(aiUnitNames(paused)).toEqual([])
  })

  it('rejects piling damage onto a non-Tank while a Tank is still under lethal', () => {
    const paused = pausedShowdown([4, 3], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])
    const [, aId] = paused.pendingDamage!.targetIds
    expect(validateAssignment(paused, [{ targetInstanceId: aId, amount: 7 }])).toBeNull()
  })

  it('accepts a Tank-first split and destroys exactly the lethal targets', () => {
    // Pool 7 vs three 3-Might defenders: Tank lethal first, then A, and the
    // last point must be spilled onto B (460.2.c.4 forbids stacking it on A
    // while B is still standing).
    const paused = pausedShowdown([3, 4], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])
    const [wallId, aId, bId] = paused.pendingDamage!.targetIds

    const split = [
      { targetInstanceId: wallId, amount: 3 },
      { targetInstanceId: aId, amount: 3 },
      { targetInstanceId: bId, amount: 1 },
    ]
    const res = validateAssignment(paused, split)
    expect(res).not.toBeNull()
    expect(res!.destroyed.sort()).toEqual([wallId, aId].sort())
    expect(res!.excess).toBe(0) // B survived, so nothing was "excess"

    const done = dispatch(paused, { type: 'ASSIGN_DAMAGE', assignments: split }, 'player')
    expect(done.pendingDamage).toBeNull()
    expect(aiUnitNames(done)).toEqual(['B'])
  })

  it('rejects over-killing one unit while another is still alive (460.2.c.4)', () => {
    const paused = pausedShowdown([3, 4], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])
    const [wallId, aId] = paused.pendingDamage!.targetIds
    // 3 to the Tank and 4 to A wastes a point that B is entitled to receive.
    expect(
      validateAssignment(paused, [
        { targetInstanceId: wallId, amount: 3 },
        { targetInstanceId: aId, amount: 4 },
      ]),
    ).toBeNull()
  })

  it('only counts damage past a full wipe as excess, and logs it', () => {
    // Pool 10 kills all three 3-Might defenders with 1 to spare — the one case
    // 460.2.c.4 allows piling past lethal. Everything dies, so there is nothing
    // to choose and the showdown resolves without a prompt.
    const done = pausedShowdown([4, 6], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])
    expect(done.pendingDamage).toBeNull()
    expect(aiUnitNames(done)).toEqual([])
    expect(done.log.some((l) => /1 excess/i.test(l))).toBe(true)
  })

  it('a pool too small to kill anything is still fully assigned, not written off as excess', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('Wall', 3, ['Tank']), 0)
    s = placeUnitAt(s, 'ai', unit('A', 3), 0)
    const targets = s.battlefields[0].units.filter((u) => u.owner === 'ai')
    const wallId = targets.find((u) => u.card.name === 'Wall')!.instanceId

    // 2 damage vs a 3-Might Tank: it survives, but all 2 must still be assigned
    // to it (460.2.c) — none of it is excess, which needs a full wipe.
    const list = autoAssignmentList(2, targets, s, 'defender')
    expect(list).toEqual([{ targetInstanceId: wallId, amount: 2 }])
    const res = autoAssign(2, targets, s, 'defender')
    expect(res.destroyed).toEqual([])
    expect(res.excess).toBe(0)
  })

  it('autoAssign and autoAssignmentList always agree on who dies', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('Wall', 4, ['Tank']), 0)
    s = placeUnitAt(s, 'ai', unit('A', 2), 0)
    s = placeUnitAt(s, 'ai', unit('Back', 1, ['Backline']), 0)
    const targets = s.battlefields[0].units.filter((u) => u.owner === 'ai')

    for (let pool = 0; pool <= 10; pool++) {
      const list = autoAssignmentList(pool, targets, s, 'defender')
      const byId = new Map(list.map((a) => [a.targetInstanceId, a.amount]))
      const fromList = targets
        .filter((t) => (byId.get(t.instanceId) ?? 0) >= effHp(t, s, 'defender'))
        .map((t) => t.instanceId)
        .sort()
      expect(autoAssign(pool, targets, s, 'defender').destroyed.sort()).toEqual(fromList)
      // The whole pool is always accounted for.
      expect(list.reduce((n, a) => n + a.amount, 0)).toBe(pool)
    }
  })

  it('an illegal assignment leaves the showdown paused', () => {
    const paused = pausedShowdown([4, 3], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])
    const [, aId] = paused.pendingDamage!.targetIds
    const after = dispatch(
      paused,
      { type: 'ASSIGN_DAMAGE', assignments: [{ targetInstanceId: aId, amount: 7 }] },
      'player',
    )
    expect(after.pendingDamage).not.toBeNull()
  })

  it("Might is health: an Empowered unit's flat +N Might also raises its lethal HP", () => {
    let s = startedGame({ firstPlayer: 'player' })
    const emp = makeCard({
      name: 'Emp Attacker',
      type: 'unit',
      domains: ['fury'],
      energy: 5,
      might: 5,
      text: '[Empower] :rb_energy_1: [Empowered][>] I have +7 :rb_might:.',
    })
    s = placeUnitAt(s, 'player', emp, 0)
    s = placeUnitAt(s, 'ai', unit('Chip', 6), 0) // the AI deals 6 damage back
    s = {
      ...s,
      battlefields: s.battlefields.map((bf) => ({
        ...bf,
        units: bf.units.map((u) => (u.card.name === 'Emp Attacker' ? { ...u, empowered: true } : u)),
      })),
    }
    // player 12 Might vs ai 6 — the player wins the race and their 12-HP unit
    // shrugs off the return 6 (before the fix, lethalMight ignored empoweredMight
    // so it "died" to 6 and the battlefield went open).
    const after = resolveShowdown(s, 0, 'player')
    expect(after.battlefields[0].units.filter((u) => u.owner === 'player').map((u) => u.card.name)).toEqual([
      'Emp Attacker',
    ])
    expect(after.battlefields[0].units.filter((u) => u.owner === 'ai')).toHaveLength(0)
    expect(after.player.points).toBe(1) // conquered
  })

  it('autoAssignmentList spends on the Tank first', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('A', 3), 0)
    s = placeUnitAt(s, 'ai', unit('Wall', 3, ['Tank']), 0)
    const targets = s.battlefields[0].units.filter((u) => u.owner === 'ai')
    const wallId = targets.find((u) => u.card.name === 'Wall')!.instanceId

    const list = autoAssignmentList(4, targets, s, 'defender')
    expect(list[0].targetInstanceId).toBe(wallId)
    expect(list.reduce((n, a) => n + a.amount, 0)).toBeLessThanOrEqual(4)
  })
})

describe('forecastShowdown — the pre-fight preview', () => {
  const setup = (mine: number[], theirs: number[]) => {
    let s = startedGame({ firstPlayer: 'player' })
    mine.forEach((m, i) => (s = placeUnitAt(s, 'player', unit(`Mine${i}`, m), 0)))
    theirs.forEach((m, i) => (s = placeUnitAt(s, 'ai', unit(`Theirs${i}`, m), 0)))
    return s
  }

  it('reports both sides’ Might and predicts a clean conquer', () => {
    const f = forecastShowdown(setup([5], [2]), 0, 'player')!
    expect(f.attackerMight).toBe(5)
    expect(f.defenderMight).toBe(2)
    expect(f.defenderLosses).toBe(1) // 5 ≥ their 2 HP
    expect(f.attackerLosses).toBe(0) // their 2 < our 5 HP
    expect(f.outcome).toBe('conquer')
  })

  it('predicts a mutual wipeout on an even trade', () => {
    const f = forecastShowdown(setup([3], [3]), 0, 'player')!
    expect(f.outcome).toBe('wipeout')
    expect(f.attackerLosses).toBe(1)
    expect(f.defenderLosses).toBe(1)
  })

  it('predicts losing your attackers when they are outgunned', () => {
    const f = forecastShowdown(setup([1], [6]), 0, 'player')!
    expect(f.outcome).toBe('lose')
    expect(f.attackerLosses).toBe(1)
    expect(f.defenderLosses).toBe(0)
  })

  it('counts Assault / Shield in the projection, and is null when uncontested', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', unit('Raider', 2, ['Assault 3']), 0)
    expect(forecastShowdown(s, 0, 'player')).toBeNull() // nobody to fight
    s = placeUnitAt(s, 'ai', unit('Guard', 2, ['Shield 2']), 0)
    const f = forecastShowdown(s, 0, 'player')!
    expect(f.attackerMight).toBe(5) // 2 + Assault 3
    expect(f.defenderMight).toBe(4) // 2 + Shield 2
  })

})
