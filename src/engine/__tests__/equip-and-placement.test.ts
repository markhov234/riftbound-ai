/**
 * Four things a real game exposed:
 *  - rule 355.2.a — where a unit may be played;
 *  - two Equipment whose granted "Attached:" box the API text omits;
 *  - Fortified Position asking the player which unit to Shield.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import poolData from './fixtures/card-pool.json'
import { Card } from '../../types/card'
import { GameState } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { canPlaceUnitAt } from '../actions'
import { emit } from '../events'
import { attachGear, gearGrants } from '../abilities/effects'
import { hasGanking, showdownMight } from '../keywords'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

const pool = poolData as unknown as Card[]
const card = (n: string) => pool.find((c) => c.name === n)!
const grunt = makeCard({ name: 'Grunt', type: 'unit', domains: ['fury'], energy: 2, might: 2 })

beforeAll(() => __setCardData(pool))

describe('355.2.a — a unit is played to your Base or a battlefield you CONTROL', () => {
  it('allows your base, and a battlefield only you occupy', () => {
    let s = startedGame({ firstPlayer: 'player' })
    expect(canPlaceUnitAt(s, 'player', grunt, { kind: 'base' }).ok).toBe(true)
    s = placeUnitAt(s, 'player', grunt, 0)
    expect(canPlaceUnitAt(s, 'player', grunt, { kind: 'battlefield', index: 0 }).ok).toBe(true)
  })

  it('refuses an empty battlefield — that is Open, not controlled', () => {
    const s = startedGame({ firstPlayer: 'player' })
    expect(canPlaceUnitAt(s, 'player', grunt, { kind: 'battlefield', index: 0 }).ok).toBe(false)
  })

  it('refuses a CONTESTED battlefield even though you have units there', () => {
    // The old check was "do I have a unit here?", which let you reinforce a
    // battlefield you did not control. Contested is controlled by nobody.
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    s = placeUnitAt(s, 'ai', grunt, 0)
    const check = canPlaceUnitAt(s, 'player', grunt, { kind: 'battlefield', index: 0 })
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/don't control/)
  })

  it('refuses a battlefield the opponent holds', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0)
    expect(canPlaceUnitAt(s, 'player', grunt, { kind: 'battlefield', index: 0 }).ok).toBe(false)
  })

  it('355.2.b — a card that grants permission still works', () => {
    const opener = makeCard({
      name: 'Vanguard',
      type: 'unit',
      domains: ['fury'],
      might: 2,
      text: 'You may play me to an open battlefield.',
    })
    const s = startedGame({ firstPlayer: 'player' })
    expect(canPlaceUnitAt(s, 'player', opener, { kind: 'battlefield', index: 0 }).ok).toBe(true)
  })
})

describe("Equipment whose 'Attached:' box the API text omits", () => {
  it('Boots of Swiftness grants +2 Might and Ganking', () => {
    const g = gearGrants(card('Boots of Swiftness'))
    expect(g.might).toBe(2)
    expect(g.keywords).toContainEqual({ name: 'Ganking', x: 1 })
  })

  it('Edge of Night grants +2 Might and no keyword', () => {
    const g = gearGrants(card('Edge of Night'))
    expect(g.might).toBe(2)
    expect(g.keywords).toHaveLength(0)
  })

  it('the bonus actually reaches the equipped unit', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Vex - Apathetic'), 0) // Might 4
    const unit = s.battlefields[0].units[0]
    expect(showdownMight(s, unit, 'attacker')).toBe(4)
    expect(hasGanking(unit, s)).toBe(false)

    s = {
      ...s,
      player: {
        ...s.player,
        gear: [
          {
            instanceId: 'boots',
            card: card('Boots of Swiftness'),
            owner: 'player',
            exhausted: false,
            counters: {},
          },
        ],
      },
    }
    const after = attachGear(s, 'boots', unit.instanceId)
    const u2 = after.battlefields[0].units[0]
    expect(showdownMight(after, u2, 'attacker')).toBe(6) // 4 + 2
    expect(hasGanking(u2, after)).toBe(true)
  })
})

describe('Fortified Position asks which unit to Shield', () => {
  const withFp = (): GameState => {
    let s = startedGame({ firstPlayer: 'ai' })
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, card: card('Fortified Position'), name: 'Fortified Position' } : bf,
      ),
    }
    return s
  }

  it('prompts the human when there is a real choice', () => {
    let s = withFp()
    s = placeUnitAt(s, 'player', grunt, 0)
    s = placeUnitAt(s, 'player', card('Vex - Apathetic'), 0)
    const after = emit(s, { type: 'DEFENDED', side: 'player', index: 0 })
    // Nothing is granted yet — the player has to pick first.
    expect(after.pendingChoices).toHaveLength(1)
    expect(after.pendingChoices[0].label).toMatch(/Fortified Position/)
    expect(after.pendingChoices[0].legalIds).toHaveLength(2)
    for (const u of after.battlefields[0].units) expect(u.counters['kw:Shield']).toBeUndefined()

    // Resolving the choice applies it to the unit that was picked.
    const pick = after.pendingChoices[0].legalIds[1]
    const done = after.pendingChoices[0].resolve([pick])(after)
    expect(done.battlefields[0].units.find((u) => u.instanceId === pick)!.counters['kw:Shield']).toBe(2)
  })

  it('does not prompt when there is only one unit', () => {
    let s = withFp()
    s = placeUnitAt(s, 'player', grunt, 0)
    const after = emit(s, { type: 'DEFENDED', side: 'player', index: 0 })
    expect(after.pendingChoices).toHaveLength(0)
    expect(after.battlefields[0].units[0].counters['kw:Shield']).toBe(2)
  })

  it('never prompts the AI', () => {
    let s = withFp()
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = placeUnitAt(s, 'ai', card('Steel Paws'), 0)
    const after = emit(s, { type: 'DEFENDED', side: 'ai', index: 0 })
    expect(after.pendingChoices).toHaveLength(0)
    expect(after.battlefields[0].units.some((u) => u.counters['kw:Shield'] === 2)).toBe(true)
  })
})
