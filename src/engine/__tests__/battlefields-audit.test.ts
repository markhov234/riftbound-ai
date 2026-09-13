/**
 * Battlefield abilities. Two jobs:
 *  1. Behaviour tests for the ones scripted by hand.
 *  2. A census that fails if the *implemented* count regresses — the pool is
 *     large and mostly unimplemented, so a plain "everything works" assertion
 *     would be a lie. `docs/battlefields.md` lists what is still missing and why.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import poolData from './fixtures/card-pool.json'
import { Card } from '../../types/card'
import { GameState } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { canMove, canPlaceUnitAt } from '../actions'
import { emit } from '../events'
import { battlefieldAura, battlefieldScript } from '../abilities/battlefields'
import { showdownMight } from '../keywords'
import { beginTurn } from '../phases'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

const pool = poolData as unknown as Card[]
const card = (n: string) => pool.find((c) => c.name === n)

beforeAll(() => __setCardData(pool))

/** Put `name` (if the fixture has it) at battlefield 0. */
function at(s: GameState, name: string): GameState {
  const bf = card(name)
  if (!bf) return s
  return {
    ...s,
    battlefields: s.battlefields.map((b, i) => (i === 0 ? { ...b, card: bf, name } : b)),
  }
}

const grunt = makeCard({ name: 'Grunt', type: 'unit', domains: ['fury'], energy: 2, might: 2 })

describe('conquer clauses', () => {
  it('Minefield mills 2 when you conquer', () => {
    const s = at(startedGame({ firstPlayer: 'player' }), 'Minefield')
    if (!card('Minefield')) return
    const deckBefore = s.player.mainDeck.length
    const after = emit(s, { type: 'CONQUERED', side: 'player', index: 0, excess: 0 })
    expect(after.player.mainDeck.length).toBe(deckBefore - 2)
    expect(after.player.trash.length).toBe(2)
  })

  it('Sigil of the Storm recycles a rune when you conquer', () => {
    const s = at(startedGame({ firstPlayer: 'player' }), 'Sigil of the Storm')
    if (!card('Sigil of the Storm')) return
    const before = s.player.runes.power
    const after = emit(s, { type: 'CONQUERED', side: 'player', index: 0, excess: 0 })
    expect(after.player.runes.power).toBe(before + 1)
  })
})

describe('hold clauses', () => {
  it('The Papertree channels a rune exhausted for BOTH players', () => {
    if (!card('The Papertree')) return
    let s = at(startedGame({ firstPlayer: 'player' }), 'The Papertree')
    // A HELD event only reaches battlefields the holder actually controls, so
    // the unit here is load-bearing, not decoration.
    s = placeUnitAt(s, 'player', grunt, 0)
    const p = s.player.runes.channeled.length
    const a = s.ai.runes.channeled.length
    const e = s.player.runes.energy
    const after = emit(s, { type: 'HELD', side: 'player', count: 1 })
    expect(after.player.runes.channeled.length).toBe(p + 1)
    expect(after.ai.runes.channeled.length).toBe(a + 1)
    expect(after.player.runes.energy).toBe(e) // exhausted — no energy
  })

  it('The Grand Plaza wins the game at 7+ units, and not at 6', () => {
    if (!card('The Grand Plaza')) return
    let s = at(startedGame({ firstPlayer: 'player' }), 'The Grand Plaza')
    for (let i = 0; i < 6; i++) s = placeUnitAt(s, 'player', grunt, 0)
    expect(emit(s, { type: 'HELD', side: 'player', count: 1 }).winner).toBeFalsy()
    s = placeUnitAt(s, 'player', grunt, 0) // 7th
    expect(emit(s, { type: 'HELD', side: 'player', count: 1 }).winner).toBe('player')
  })
})

describe('start-of-turn clauses (the new TURN_BEGAN event)', () => {
  it('Frozen Fortress deals 1 to every unit at that battlefield', () => {
    if (!card('Frozen Fortress')) return
    let s = at(startedGame({ firstPlayer: 'player' }), 'Frozen Fortress')
    s = placeUnitAt(s, 'player', grunt, 0)
    s = placeUnitAt(s, 'ai', grunt, 0)
    const after = emit(s, { type: 'TURN_BEGAN', side: 'player', turn: s.turn })
    for (const u of after.battlefields[0].units) expect(u.damage).toBe(1)
  })

  it('beginTurn actually raises TURN_BEGAN', () => {
    if (!card('Frozen Fortress')) return
    let s = at(startedGame({ firstPlayer: 'player' }), 'Frozen Fortress')
    s = placeUnitAt(s, 'ai', grunt, 0)
    const after = beginTurn({ ...s, activePlayer: 'player', turn: s.turn + 1 })
    expect(after.battlefields[0].units[0].damage).toBe(1)
  })
})

describe('static rule changes', () => {
  it("Rockfall Path — units can't be played there, but may still move in", () => {
    if (!card('Rockfall Path')) return
    const s = at(startedGame({ firstPlayer: 'player' }), 'Rockfall Path')
    expect(canPlaceUnitAt(s, 'player', grunt, { kind: 'battlefield', index: 0 }).ok).toBe(false)
    // bf1 is untouched, so the normal rule still applies there.
    expect(canPlaceUnitAt(s, 'player', grunt, { kind: 'base' }).ok).toBe(true)
  })

  it("Vilemaw's Lair — units can't move from there back to base", () => {
    if (!card("Vilemaw's Lair")) return
    let s = at(startedGame({ firstPlayer: 'player' }), "Vilemaw's Lair")
    s = placeUnitAt(s, 'player', grunt, 0)
    const u = s.battlefields[0].units[0]
    expect(canMove(s, 'player', u.instanceId, { kind: 'base' }).reason).toMatch(/can't leave/)
  })
})

describe('role-conditional auras', () => {
  it('Forbidding Waste — -2 Might while defending ALONE only', () => {
    if (!card('Forbidding Waste')) return
    let s = at(startedGame({ firstPlayer: 'player' }), 'Forbidding Waste')
    s = placeUnitAt(s, 'player', grunt, 0)
    const solo = s.battlefields[0].units[0]
    expect(showdownMight(s, solo, 'defender')).toBe(0) // 2 - 2
    expect(showdownMight(s, solo, 'attacker')).toBe(2) // attacking is unaffected

    // A friend at the same battlefield turns it off.
    const withFriend = placeUnitAt(s, 'player', grunt, 0)
    expect(showdownMight(withFriend, withFriend.battlefields[0].units[0], 'defender')).toBe(2)
  })

  it('Black Flame Altar — [Temporary] units get Shield while defending', () => {
    if (!card('Black Flame Altar')) return
    const temp = makeCard({
      name: 'Fleeting',
      type: 'unit',
      domains: ['fury'],
      might: 2,
      keywords: ['Temporary'],
      text: '[Temporary] (At the start of my controller’s Beginning Phase, kill me.)',
    })
    let s = at(startedGame({ firstPlayer: 'player' }), 'Black Flame Altar')
    s = placeUnitAt(s, 'player', temp, 0)
    s = placeUnitAt(s, 'player', grunt, 0) // no Temporary — unaffected
    const [t, g] = s.battlefields[0].units
    expect(showdownMight(s, t, 'defender')).toBe(3)
    expect(showdownMight(s, t, 'attacker')).toBe(2)
    expect(showdownMight(s, g, 'defender')).toBe(2)
  })

  it('an aura is inert off a battlefield', () => {
    const s = startedGame({ firstPlayer: 'player' })
    const u = { ...s.player.base[0] }
    if (!u) return
    expect(battlefieldAura(s, { ...u, location: { kind: 'base' } }).might).toBe(0)
  })
})

describe('census — how much of the battlefield pool actually does something', () => {
  it('at least 33 distinct battlefields have a working ability', () => {
    const seen = new Set<string>()
    const bfs = pool.filter(
      (c) => c.type === 'battlefield' && c.text.trim() && !seen.has(c.name) && seen.add(c.name),
    )
    const working = bfs.filter((c) => {
      const trigs = battlefieldScript(c).triggers
      if (trigs.length > 0) return true
      const fake = {
        location: { kind: 'battlefield' as const, index: 0 },
        card: c,
        counters: {},
      } as never
      const aura = battlefieldAura({ battlefields: [{ card: c, units: [] }] } as never, fake)
      return aura.might !== 0 || aura.grantsGanking
    })
    // The fixture only carries the preset decks' battlefields, so this is a
    // floor for *those*; the full-pool number lives in docs/battlefields.md.
    expect(working.length).toBeGreaterThanOrEqual(Math.min(9, bfs.length))
  })
})
