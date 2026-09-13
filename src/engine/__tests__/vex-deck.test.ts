/**
 * The Vex, Gloomist preset is a card-for-card transcription of a real tournament
 * list (薇古丝 by 扶光, 4th of 122 at the S4 Fuzhou City Challenge, 2026-09-06).
 *
 * The other presets are approximations that `buildOne` backfills up to 40. This
 * one must not be: if a name stops resolving, the filler quietly swaps in some
 * other in-domain unit and the deck silently stops being the list it claims to
 * be. These tests exist to make that failure loud.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import poolData from './fixtures/card-pool.json'
import { Card } from '../../types/card'
import { __setCardData } from '../../data/cardStore'
import { PRESET_SPECS, buildPresetDecks } from '../../data/presetDecks'
import { isBanned } from '../../data/bannedCards'

const pool = poolData as unknown as Card[]

const SPEC = PRESET_SPECS.find((s) => s.id === 'preset-vex-gloomist')!

let deck: ReturnType<typeof buildPresetDecks>[number]
let byId: Map<string, Card>

beforeAll(() => {
  __setCardData(pool)
  deck = buildPresetDecks(pool).find((d) => d.id === 'preset-vex-gloomist')!
  byId = new Map(pool.map((c) => [c.id, c]))
})

/**
 * Champion names print as "Vex, Apathetic" on decklists but ship as
 * "Vex - Apathetic" in the card data (older sets use the dash). `resolveByName`
 * already bridges the two, so the comparison here has to as well — otherwise
 * this test fails on a naming convention rather than on a wrong card.
 */
const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s*,\s*/g, ' - ') // "Vex, Apathetic" — no space before the comma
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()

const qtyOf = (name: string, entries = deck.cards) =>
  entries
    .filter((e) => key(byId.get(e.cardId)?.name ?? '') === key(name))
    .reduce((n, e) => n + e.quantity, 0)

describe('Vex, Gloomist preset — exact transcription', () => {
  it('builds a legal deck: 40 main, 12 runes, 3 battlefields', () => {
    expect(deck.cards.reduce((n, e) => n + e.quantity, 0)).toBe(40)
    expect(deck.runes.reduce((n, e) => n + e.quantity, 0)).toBe(12)
    expect(deck.battlefieldIds).toHaveLength(3)
    expect(deck.legendId).toBeTruthy()
    expect(deck.chosenChampionId).toBeTruthy()
  })

  it('every listed name resolved — nothing was backfilled or substituted', () => {
    // The spec already sums to 40, so any filler would mean a name failed to
    // resolve and `fill` papered over it.
    const specTotal = SPEC.main.reduce((n, m) => n + m.qty, 0)
    expect(specTotal).toBe(40)
    for (const { name, qty } of SPEC.main) {
      expect(qtyOf(name), `${name} missing or wrong count`).toBe(qty)
    }
  })

  it('matches the published list exactly, card for card', () => {
    // Keys are the *card-data* names (dash form for older champion printings).
    const printed: Record<string, number> = {
      'Vex - Apathetic': 1,
      'Steel Paws': 3,
      'Evelynn - Entrancing': 2,
      'Scuttle Crab': 2,
      Tideturner: 2,
      'Tornado Warrior': 3,
      'Irelia, Fervent': 1,
      Kharox: 1,
      'Astral Heron': 2,
      "Zhonya's Hourglass": 2,
      'Boots of Swiftness': 2,
      'Edge of Night': 1,
      Charm: 1,
      Defy: 3,
      'Stacked Deck': 2,
      Abandon: 1,
      Block: 1,
      Discipline: 3,
      Rebuke: 2,
      'Ride The Wind': 1,
      Switcheroo: 3,
      'Back Off': 1,
    }
    const actual: Record<string, number> = {}
    for (const e of deck.cards) {
      const c = byId.get(e.cardId)!
      actual[c.name] = (actual[c.name] ?? 0) + e.quantity
    }
    expect(actual).toEqual(printed)
  })

  it('carries the 10-card sideboard, kept out of the main deck', () => {
    expect(deck.sideboard).toBeTruthy()
    expect(deck.sideboard!.reduce((n, e) => n + e.quantity, 0)).toBe(10) // 10 is the cap since July 2026
    const sideNames = deck.sideboard!.map((e) => byId.get(e.cardId)!.name).sort()
    expect(sideNames).toEqual(
      ['Decree of Focus', 'Disarming Rake', 'Gust', 'Not So Fast', 'Ravenbloom Prefect', 'Sanction'].sort(),
    )
    // Sideboard cards are not shuffled in — the 40 must not contain them.
    const mainIds = new Set(deck.cards.map((e) => e.cardId))
    for (const e of deck.sideboard!) expect(mainIds.has(e.cardId)).toBe(false)
  })

  it('respects the 3-copy limit across main deck AND sideboard', () => {
    // A tournament rule people trip over: the limit spans both piles.
    const counts = new Map<string, number>()
    for (const e of [...deck.cards, ...(deck.sideboard ?? [])]) {
      const name = byId.get(e.cardId)!.name
      counts.set(name, (counts.get(name) ?? 0) + e.quantity)
    }
    for (const [name, n] of counts) expect(n, name).toBeLessThanOrEqual(3)
  })

  it('uses no banned cards, in the deck or the sideboard', () => {
    for (const e of [...deck.cards, ...(deck.sideboard ?? []), ...deck.runes]) {
      expect(isBanned(byId.get(e.cardId)!), byId.get(e.cardId)!.name).toBe(false)
    }
    for (const id of deck.battlefieldIds) expect(isBanned(byId.get(id)!)).toBe(false)
  })
})
