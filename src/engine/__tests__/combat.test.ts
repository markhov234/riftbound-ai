import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { autoAssignmentList, resolveShowdown, validateAssignment } from '../combat'
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

  it('accepts a Tank-first split, destroys exactly the lethal targets, logs the excess', () => {
    const paused = pausedShowdown([3, 4], [['Wall', 3, ['Tank']], ['A', 3], ['B', 3]])
    const [wallId, aId] = paused.pendingDamage!.targetIds

    const res = validateAssignment(paused, [
      { targetInstanceId: wallId, amount: 3 },
      { targetInstanceId: aId, amount: 4 },
    ])
    expect(res).not.toBeNull()
    expect(res!.destroyed.sort()).toEqual([wallId, aId].sort())
    expect(res!.excess).toBe(1)

    const done = dispatch(
      paused,
      {
        type: 'ASSIGN_DAMAGE',
        assignments: [
          { targetInstanceId: wallId, amount: 3 },
          { targetInstanceId: aId, amount: 4 },
        ],
      },
      'player',
    )
    expect(done.pendingDamage).toBeNull()
    expect(aiUnitNames(done)).toEqual(['B'])
    expect(done.log.some((l) => /excess/i.test(l))).toBe(true)
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

  it('autoAssignmentList spends on the Tank first', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', unit('A', 3), 0)
    s = placeUnitAt(s, 'ai', unit('Wall', 3, ['Tank']), 0)
    const targets = s.battlefields[0].units.filter((u) => u.owner === 'ai')
    const wallId = targets.find((u) => u.card.name === 'Wall')!.instanceId

    const list = autoAssignmentList(4, targets, s)
    expect(list[0].targetInstanceId).toBe(wallId)
    expect(list.reduce((n, a) => n + a.amount, 0)).toBeLessThanOrEqual(4)
  })
})
