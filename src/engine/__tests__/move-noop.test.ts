import { beforeAll, describe, expect, it } from 'vitest'
import { canMove, dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { findUnit } from '../state'
import { makeCard, placeAtBase, placeUnitAt, startedGame } from './fixtures'

/**
 * Reported in play: Mister Root sat at the base, the player started dragging it
 * to a battlefield, changed their mind and dropped it back on the base. The unit
 * never left the base — and came back exhausted, having gained 2 XP from
 * "When I move to a battlefield, gain 2 XP".
 *
 * Two separate faults met there:
 *   1. `canMove` never asked whether the unit was already at the destination, so
 *      a move to where you already are was legal. Moving exhausts, so the unit
 *      paid the whole cost of a move that did not happen.
 *   2. The "when I move to a battlefield" trigger swallowed the words "to a
 *      battlefield" as decoration and fired on *any* move, base included.
 *
 * XP is a player pool (`gainXP` in effects.ts), not a unit counter — asserting
 * on `unit.counters.xp` reads 0 forever and makes these tests prove nothing.
 */

const rooted = makeCard({
  name: 'Rooted Thing',
  type: 'unit',
  energy: 2,
  might: 1,
  text: 'When I move to a battlefield, gain 2 XP.',
})

const ganker = makeCard({
  name: 'Ganker',
  type: 'unit',
  energy: 2,
  might: 1,
  keywords: ['Ganking'],
})

const wanderer = makeCard({
  name: 'Wanderer',
  type: 'unit',
  energy: 2,
  might: 1,
  text: 'When I move, draw 1.',
})

beforeAll(() => _clearCompileCache())

describe('moving to where you already are', () => {
  it('is refused at the base, so the unit does not exhaust for nothing', () => {
    let s = startedGame()
    s = placeAtBase(s, 'player', rooted)
    const id = s.player.base[s.player.base.length - 1].instanceId

    expect(canMove(s, 'player', id, { kind: 'base' }).ok, 'base → base is not a move').toBe(false)

    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'base' } }, 'player')
    const after = findUnit(s, id)!
    expect(after.location.kind, 'still at base').toBe('base')
    expect(after.exhausted, 'not exhausted by a move that never happened').toBe(false)
  })

  it('is refused at a battlefield too', () => {
    let s = startedGame()
    // Ganking, so the battlefield → battlefield ban is not what refuses this —
    // without it the test would pass for the wrong reason.
    s = placeUnitAt(s, 'player', ganker, 0)
    const id = s.battlefields[0].units[s.battlefields[0].units.length - 1].instanceId
    expect(canMove(s, 'player', id, { kind: 'battlefield', index: 1 }).ok, 'can gank').toBe(true)

    expect(canMove(s, 'player', id, { kind: 'battlefield', index: 0 }).ok).toBe(false)

    s = dispatch(
      s,
      { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } },
      'player',
    )
    expect(findUnit(s, id)!.exhausted).toBe(false)
  })

  it('does not fire "when I move" triggers', () => {
    let s = startedGame()
    s = placeAtBase(s, 'player', wanderer)
    const id = s.player.base[s.player.base.length - 1].instanceId
    const before = s.player.hand.length

    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'base' } }, 'player')
    expect(s.player.hand.length, 'no free card off a non-move').toBe(before)
  })

  it('still allows a real move out of the base', () => {
    let s = startedGame()
    s = placeAtBase(s, 'player', rooted)
    const id = s.player.base[s.player.base.length - 1].instanceId

    expect(canMove(s, 'player', id, { kind: 'battlefield', index: 0 }).ok).toBe(true)
    s = dispatch(
      s,
      { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } },
      'player',
    )
    const after = findUnit(s, id)!
    expect(after.location).toEqual({ kind: 'battlefield', index: 0 })
    expect(after.exhausted, 'a real move does exhaust').toBe(true)
  })
})

describe('"when I move to a battlefield"', () => {
  it('fires on a move to a battlefield', () => {
    let s = startedGame()
    s = placeAtBase(s, 'player', rooted)
    const id = s.player.base[s.player.base.length - 1].instanceId
    const xpBefore = s.player.xp

    s = dispatch(
      s,
      { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } },
      'player',
    )
    expect(s.player.xp - xpBefore).toBe(2)
  })

  it('does not fire on a retreat to the base', () => {
    let s = startedGame()
    s = placeUnitAt(s, 'player', rooted, 0)
    const id = s.battlefields[0].units[s.battlefields[0].units.length - 1].instanceId
    const xpBefore = s.player.xp

    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'base' } }, 'player')
    expect(findUnit(s, id)!.location.kind, 'the retreat itself is legal').toBe('base')
    expect(s.player.xp - xpBefore, 'but the battlefield trigger stays quiet').toBe(0)
  })

  it('leaves an unqualified "when I move" firing on a retreat', () => {
    let s = startedGame()
    s = placeUnitAt(s, 'player', wanderer, 0)
    const id = s.battlefields[0].units[s.battlefields[0].units.length - 1].instanceId
    const before = s.player.hand.length

    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'base' } }, 'player')
    expect(s.player.hand.length).toBe(before + 1)
  })
})
