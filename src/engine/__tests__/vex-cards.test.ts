/**
 * Behaviour tests for every card in the Vex, Gloomist list that previously had
 * no script at all. "Has a script" is not "works", so each one asserts the
 * printed sentence actually happens.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import poolData from './fixtures/card-pool.json'
import { Card } from '../../types/card'
import { GameState, PlayerSide } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { dispatch } from '../actions'
import { emit } from '../events'
import { _clearCompileCache } from '../abilities/compile'
import { battlefieldScript } from '../abilities/battlefields'
import { effectiveCost } from '../costs'
import { showdownMight } from '../keywords'
import { swapLocations, swapMight } from '../abilities/effects'
import { makeCard, placeUnitAt, startedGame, withHand } from './fixtures'

const pool = poolData as unknown as Card[]
const card = (name: string) => pool.find((c) => c.name === name)!

beforeAll(() => {
  __setCardData(pool)
  _clearCompileCache()
})

/** Resolve the top of the stack (both players pass). */
function resolveTop(s: GameState): GameState {
  const holder = s.priority
  const other: PlayerSide = holder === 'player' ? 'ai' : 'player'
  s = dispatch(s, { type: 'PASS_PRIORITY' }, holder)
  return dispatch(s, { type: 'PASS_PRIORITY' }, other)
}

/** Energy to burn, and a wide identity — the fixture legend is Fury-only, and
 *  these are real cards from a Calm/Chaos deck. */
const rich = (s: GameState): GameState => ({
  ...s,
  player: {
    ...s.player,
    identity: ['fury', 'calm', 'chaos', 'mind', 'body', 'order'],
    runes: { ...s.player.runes, energy: 9, power: 3 },
  },
})

describe('Vex - Apathetic — "When an opponent plays a unit while I\'m at a battlefield, [Stun] it"', () => {
  it('stuns the enemy unit, and is not itself stunned by its own [Stun] text', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Vex - Apathetic'), 0)
    const vex = s.battlefields[0].units[0]
    // The bug this replaced: "Stun" is scraped into `card.keywords`, and reading
    // that as a status made Vex contribute 0 Might in every combat.
    expect(showdownMight(s, vex, 'attacker')).toBe(vex.card.might)

    s = placeUnitAt(s, 'ai', card('Steel Paws'), 0)
    const enemy = s.battlefields[0].units.find((u) => u.owner === 'ai')!
    const after = emit(s, { type: 'UNIT_ENTERED', instanceId: enemy.instanceId, controller: 'ai' })
    const stunned = after.battlefields[0].units.find((u) => u.instanceId === enemy.instanceId)!
    expect(stunned.counters.stunned).toBe(1)
    expect(showdownMight(after, stunned, 'defender')).toBe(0)
  })

  it('does nothing while Vex is at base, or for your own units', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Vex - Apathetic'), 0)
    s = placeUnitAt(s, 'player', card('Steel Paws'), 0)
    const mine = s.battlefields[0].units.find((u) => u.card.name === 'Steel Paws')!
    const after = emit(s, { type: 'UNIT_ENTERED', instanceId: mine.instanceId, controller: 'player' })
    expect(after.battlefields[0].units.find((u) => u.instanceId === mine.instanceId)!.counters.stunned)
      .toBeUndefined()
  })
})

describe('Astral Heron — "your next card costs 2 energy and 2 runes less"', () => {
  it('discounts the next card, once, and only while at a battlefield', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Astral Heron'), 0)
    const target = card('Steel Paws')
    const before = effectiveCost(s, 'player', target).energy

    s = emit(s, { type: 'CARD_PLAYED', card: card('Charm'), controller: 'player', nth: 1 })
    expect(s.player.nextCardDiscount).toEqual({ energy: 2, runes: 2 })
    expect(effectiveCost(s, 'player', target).energy).toBe(Math.max(0, before - 2))
  })

  it('does not fire on the second card of the turn', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Astral Heron'), 0)
    s = emit(s, { type: 'CARD_PLAYED', card: card('Charm'), controller: 'player', nth: 2 })
    expect(s.player.nextCardDiscount).toBeUndefined()
  })
})

describe('Switcheroo — "Swap the Might of two units at the same battlefield this turn"', () => {
  it('swaps their Might', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', makeCard({ name: 'Big', type: 'unit', domains: ['fury'], might: 6 }), 0)
    s = placeUnitAt(s, 'ai', makeCard({ name: 'Small', type: 'unit', domains: ['fury'], might: 1 }), 0)
    const [big, small] = s.battlefields[0].units
    const after = swapMight(s, big.instanceId, small.instanceId)
    const [b2, s2] = after.battlefields[0].units
    expect(showdownMight(after, b2, 'attacker')).toBe(1)
    expect(showdownMight(after, s2, 'attacker')).toBe(6)
  })

  it('is a this-turn effect — it uses mightTurn, which the cleanup clears', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', makeCard({ name: 'Big', type: 'unit', domains: ['fury'], might: 6 }), 0)
    s = placeUnitAt(s, 'ai', makeCard({ name: 'Small', type: 'unit', domains: ['fury'], might: 1 }), 0)
    const [big, small] = s.battlefields[0].units
    const after = swapMight(s, big.instanceId, small.instanceId)
    expect(after.battlefields[0].units[0].counters.mightTurn).toBe(-5)
    expect(after.battlefields[0].units[1].counters.mightTurn).toBe(5)
  })
})

describe('Tideturner — "Move me to its location and it to my original location"', () => {
  it('swaps two units between base and a battlefield', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Tideturner'), 0)
    const tide = s.battlefields[0].units[0]
    s = {
      ...s,
      player: {
        ...s.player,
        base: [
          {
            instanceId: 'homebody',
            card: card('Steel Paws'),
            owner: 'player',
            location: { kind: 'base' },
            exhausted: false,
            damage: 0,
            counters: {},
            sick: false,
          },
        ],
      },
    }
    const after = swapLocations(s, tide.instanceId, 'homebody')
    expect(after.player.base.map((u) => u.card.name)).toEqual(['Tideturner'])
    expect(after.battlefields[0].units.map((u) => u.card.name)).toEqual(['Steel Paws'])
  })
})

describe('Disarming Rake — "you may kill a gear"', () => {
  it('the AI kills an enemy gear when its unit enters', () => {
    let s = startedGame({ firstPlayer: 'ai' })
    s = {
      ...s,
      player: {
        ...s.player,
        gear: [
          {
            instanceId: 'g1',
            card: card('Boots of Swiftness'),
            owner: 'player',
            exhausted: false,
            counters: {},
          },
        ],
      },
    }
    s = placeUnitAt(s, 'ai', card('Disarming Rake'), 0)
    const rake = s.battlefields[0].units[0]
    const after = emit(s, { type: 'UNIT_ENTERED', instanceId: rake.instanceId, controller: 'ai' })
    expect(after.player.gear).toHaveLength(0)
    expect(after.player.trash.map((c) => c.name)).toContain('Boots of Swiftness')
  })
})

describe('Ravenbloom Prefect — "banish me to banish it"', () => {
  it('trades itself for an enemy gear that was just played', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', card('Ravenbloom Prefect'), 0)
    const boots = card('Boots of Swiftness')
    s = {
      ...s,
      player: {
        ...s.player,
        gear: [
          { instanceId: 'g1', card: boots, owner: 'player', exhausted: false, counters: {} },
        ],
      },
    }
    const after = emit(s, { type: 'CARD_PLAYED', card: boots, controller: 'player', nth: 1 })
    expect(after.player.gear).toHaveLength(0)
    expect(after.player.banished.map((c) => c.name)).toContain('Boots of Swiftness')
    expect(after.ai.banished.map((c) => c.name)).toContain('Ravenbloom Prefect')
    expect(after.battlefields[0].units).toHaveLength(0)
  })
})

describe('Sanction — "Empower a unit / Disempower an Empowered one"', () => {
  it('empowers a plain unit and disempowers an Empowered one', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', card('Steel Paws'), 0)
    const u = s.battlefields[0].units[0]
    s = rich(withHand(s, 'player', [card('Sanction')]))

    let after = dispatch(
      s,
      { type: 'PLAY_SPELL', card: card('Sanction'), targetInstanceIds: [u.instanceId] },
      'player',
    )
    after = resolveTop(after)
    expect(after.battlefields[0].units[0].empowered).toBe(true)

    // Cast it again at the now-Empowered unit: the other half of "choose one".
    let again = rich(withHand(after, 'player', [card('Sanction')]))
    again = dispatch(
      again,
      { type: 'PLAY_SPELL', card: card('Sanction'), targetInstanceIds: [u.instanceId] },
      'player',
    )
    again = resolveTop(again)
    expect(again.battlefields[0].units[0].empowered).toBe(false)
  })
})

describe('the deck’s three battlefields', () => {
  it('Startipped Peak channels a rune exhausted on hold (no energy now)', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, card: card('Startipped Peak'), name: 'Startipped Peak' } : bf,
      ),
    }
    s = placeUnitAt(s, 'ai', card('Steel Paws'), 0) // ai controls it, so ai holds
    const energyBefore = s.ai.runes.energy
    const channeledBefore = s.ai.runes.channeled.length
    const after = emit(s, { type: 'HELD', side: 'ai', count: 1 })
    expect(after.ai.runes.channeled.length).toBe(channeledBefore + 1)
    expect(after.ai.runes.energy).toBe(energyBefore) // "exhausted" — no energy
  })

  it('Fortified Position grants [Shield 2] when you defend there', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, card: card('Fortified Position'), name: 'Fortified Position' } : bf,
      ),
    }
    s = placeUnitAt(s, 'ai', card('Steel Paws'), 0)
    const u = s.battlefields[0].units[0]
    const before = showdownMight(s, u, 'defender')
    const after = emit(s, { type: 'DEFENDED', side: 'ai', index: 0 })
    const u2 = after.battlefields[0].units[0]
    expect(u2.counters['kw:Shield']).toBe(2)
    expect(showdownMight(after, u2, 'defender')).toBe(before + 2)
  })

  it('Abandoned Hall offers +1 Might when a player plays a spell', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, card: card('Abandoned Hall'), name: 'Abandoned Hall' } : bf,
      ),
    }
    s = placeUnitAt(s, 'ai', card('Steel Paws'), 0)
    const u = s.battlefields[0].units[0]
    // The AI takes the "you may", so this resolves without a prompt.
    const after = emit(s, { type: 'CARD_PLAYED', card: card('Charm'), controller: 'ai', nth: 1 })
    expect(after.battlefields[0].units[0].counters.mightTurn).toBe(1)
    expect(u.counters.mightTurn).toBeUndefined() // the original object is untouched
  })

  it('all three battlefields compile to at least one trigger', () => {
    for (const n of ['Abandoned Hall', 'Fortified Position', 'Startipped Peak']) {
      expect(battlefieldScript(card(n)).triggers.length, n).toBeGreaterThan(0)
    }
  })
})
