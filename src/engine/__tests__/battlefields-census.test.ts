import { describe, expect, it } from 'vitest'
import poolData from './fixtures/card-pool.json'
import { Card } from '../../types/card'
import { battlefieldScript } from '../abilities/battlefields'
import { isBanned } from '../../data/bannedCards'

/**
 * A census guard for `docs/battlefields.md`.
 *
 * That doc carries a named list of battlefields whose abilities do nothing, and
 * nothing verified it. It drifted: Piltovan Forge and Risen Altar were listed
 * as unimplemented for days after `effectiveAbilityCost` was written for
 * exactly those two, and I nearly reported the stale list as fact.
 *
 * The per-battlefield behaviour tests live in `battlefields-audit.test.ts`.
 * This file only asserts the *shape* of the list: every battlefield is either
 * implemented or named below as a known gap, and every name below is a real
 * card. Implementing one makes this fail until it is struck from the list,
 * which is the point.
 */

const POOL = poolData as unknown as Card[]

/**
 * Battlefields whose rules text still does nothing, grouped by what the engine
 * is missing. Keep in step with `docs/battlefields.md`.
 */
const UNIMPLEMENTED = new Set([
  // Needs a cost hook in `effectiveCost`
  "Ornn's Forge",
  'Marai Spire',
  'Sandswept Tomb',
  'Vaults of Helia',
  // Needs an event the engine doesn't raise
  'Star Spring',
  'Valley of Idols',
  'Back-Alley Bar',
  "Ripper's Bay",
  'Forgotten Library',
  'Dragon Roost',
  // Needs a replacement effect or rules-level hook
  'Altar of Blood',
  'Void Gate',
  'Heisho, Shell of the World',
  'Gardens of Becoming',
  'Forge of the Fluft',
  'Forgotten Monument',
  // Needs machinery that doesn't exist yet
  'The Academy',
  "Reckoner's Arena",
  'Bandle Tree',
  'Treasure Hoard',
])

/**
 * Implemented somewhere other than a trigger — a static aura, or a rule change
 * checked at the point of the rule (`canPlaceUnitAt`, `canMove`,
 * `effectiveCost`, `effectiveAbilityCost`). A trigger-based one is detected
 * directly, so only these need naming.
 */
const NON_TRIGGER = new Set([
  // Static auras, read by `battlefieldAura` at combat / move time
  'Windswept Hillock',
  'Kinkou Temple',
  'Trifarian War Camp',
  'Forbidding Waste',
  'Black Flame Altar',
  'Rockfall Path',
  "Vilemaw's Lair",
  'Mystic Vortex',
  'Piltovan Forge',
  'Risen Altar',
  'Scuttle Crab',
  'The Grand Plaza',
])

// The pool ships duplicate printings of some cards; the census is about
// distinct battlefields, so dedupe by name.
const seen = new Set<string>()
const battlefields = POOL.filter((c) => {
  if (c.type !== 'battlefield' || !c.text?.trim() || isBanned(c)) return false
  if (seen.has(c.name)) return false
  seen.add(c.name)
  return true
})
const implemented = (c: Card) =>
  battlefieldScript(c).triggers.length > 0 || NON_TRIGGER.has(c.name)

describe('battlefield census', () => {
  it('has battlefields to audit at all', () => {
    expect(battlefields.length).toBeGreaterThan(20)
  })

  it('lists every unimplemented battlefield, and nothing else', () => {
    const silent = battlefields.filter((c) => !implemented(c)).map((c) => c.name)
    const unlisted = silent.filter((n) => !UNIMPLEMENTED.has(n)).sort()
    expect(
      unlisted,
      `${unlisted.length} battlefield(s) do nothing but are not listed as gaps — ` +
        `add them to UNIMPLEMENTED here and to docs/battlefields.md`,
    ).toEqual([])
  })

  it('has no stale entries — a listed gap that now works must be struck', () => {
    const fixed = battlefields.filter((c) => UNIMPLEMENTED.has(c.name) && implemented(c))
    expect(
      fixed.map((c) => c.name).sort(),
      'these are implemented now; remove them from UNIMPLEMENTED and from docs/battlefields.md',
    ).toEqual([])
  })

  it('names only real, unbanned battlefields', () => {
    const names = new Set(battlefields.map((c) => c.name))
    const bogus = [...UNIMPLEMENTED].filter((n) => !names.has(n)).sort()
    expect(bogus, 'listed as a gap but not a playable battlefield in the pool').toEqual([])
  })

  it('Threshold of the Gray is implemented and off the list', () => {
    const card = battlefields.find((c) => c.name === 'Threshold of the Gray')
    expect(card, 'in the fixture pool').toBeTruthy()
    expect(UNIMPLEMENTED.has('Threshold of the Gray')).toBe(false)
    expect(battlefieldScript(card!).triggers.some((t) => t.on === 'COMBAT_STARTED')).toBe(true)
  })
})
