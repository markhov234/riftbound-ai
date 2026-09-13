import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { canPlaceUnitAt, canPlay, dispatch, totalPlayCost, unitPlayOptions } from '../actions'
import { canAfford } from '../runes'
import {
  accelRuneUnit,
  accelUnit,
  bolt,
  grunt,
  makeCard,
  placeAtBase,
  placeUnitAt,
  startedGame,
  withHand,
} from './fixtures'
import { champion } from './fixtures'

function withEnergy(s: GameState, side: PlayerSide, energy: number): GameState {
  return side === 'player'
    ? { ...s, player: { ...s.player, runes: { ...s.player.runes, energy } } }
    : { ...s, ai: { ...s.ai, runes: { ...s.ai.runes, energy } } }
}

const at = (s: GameState, side: PlayerSide, i: number) =>
  s.battlefields[i].units.filter((u) => u.owner === side)

describe('unit placement', () => {
  it('has exactly two battlefields, one per contributor', () => {
    const s = startedGame()
    expect(s.battlefields).toHaveLength(2)
    expect(s.battlefields.map((b) => b.contributor)).toEqual(['player', 'ai'])
  })

  it('rejects playing a unit straight onto an empty battlefield', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [champion])
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
    const check = canPlaceUnitAt(s, 'player', champion, { kind: 'battlefield', index: 0 })
    expect(check.ok).toBe(false)

    s = dispatch(s, { type: 'PLAY_UNIT', card: champion, to: { kind: 'battlefield', index: 0 } }, 'player')
    expect(at(s, 'player', 0)).toHaveLength(0)
    expect(s.log.some((l) => /enter at your base/i.test(l))).toBe(true)
  })

  it('allows playing a unit to a battlefield where you already have one', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    s = withHand(s, 'player', [champion])
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
    s = dispatch(s, { type: 'PLAY_UNIT', card: champion, to: { kind: 'battlefield', index: 0 } }, 'player')
    expect(at(s, 'player', 0).length).toBe(2)
  })

  it('units enter exhausted', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [champion])
    s = withEnergy(s, 'player', 9)
    s = dispatch(s, { type: 'PLAY_UNIT', card: champion, to: { kind: 'base' } }, 'player')
    expect(s.player.base[0].exhausted).toBe(true)
  })

  it('the Chosen Champion is played from the Champion Zone, not the hand', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const champ = s.player.championZone!
    expect(champ).toBeTruthy()
    // It is NOT shuffled into the deck / hand.
    expect(s.player.mainDeck.some((c) => c.id === champ.id)).toBe(false)
    expect(s.player.hand.some((c) => c.id === champ.id)).toBe(false)

    s = withEnergy(s, 'player', 12)
    s = dispatch(s, { type: 'PLAY_UNIT', card: champ, to: { kind: 'base' } }, 'player')

    expect(s.player.base.some((u) => u.card.id === champ.id)).toBe(true)
    expect(s.player.championZone).toBeNull()
    expect(s.player.championPlayed).toBe(true)

    // Can't play it a second time.
    const before = s
    s = dispatch(s, { type: 'PLAY_UNIT', card: champ, to: { kind: 'base' } }, 'player')
    expect(s.player.base.length).toBe(before.player.base.length)
  })

  it('[Ambush] — a unit played to a battlefield you occupy has Reaction timing there', () => {
    const ambusher = makeCard({
      name: 'Shadow Striker',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 2,
      keywords: ['Ambush'],
      text: '[Ambush]',
    })
    const plain = makeCard({ name: 'Plain Recruit', type: 'unit', domains: ['fury'], energy: 2, might: 2 })

    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0) // player controls bf 0
    s = withEnergy(s, 'player', 9)
    // A spell sits on the stack — sorcery timing is now blocked.
    s = {
      ...s,
      priority: 'player',
      stack: [
        { id: 'x', kind: 'spell', controller: 'ai', scriptKey: 'play', targets: [], label: 'dummy' },
      ],
    } as GameState
    s = withHand(s, 'player', [ambusher, plain])

    const to = { kind: 'battlefield' as const, index: 0 }
    expect(canPlay(s, 'player', ambusher, to).ok).toBe(true) // Reaction — allowed
    expect(canPlay(s, 'player', plain, to).ok).toBe(false) // sorcery — blocked by the stack

    // Away from a battlefield the player occupies, Ambush confers nothing special.
    expect(canPlay(s, 'player', ambusher, { kind: 'base' }).ok).toBe(false)
  })
})

describe('Accelerate (optional cost)', () => {
  it('offers the option for a unit with the keyword', () => {
    expect(unitPlayOptions(accelUnit).map((o) => o.id)).toEqual(['accelerate'])
    expect(unitPlayOptions(grunt)).toEqual([])
  })

  it('paying it costs +1 energy and the unit enters ready', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [accelUnit])
    s = withEnergy(s, 'player', 5)
    s = dispatch(
      s,
      { type: 'PLAY_UNIT', card: accelUnit, to: { kind: 'base' }, paidAccelerate: true },
      'player',
    )
    expect(s.player.base[0].exhausted).toBe(false)
    expect(s.player.base[0].sick).toBe(false)
    expect(s.player.runes.energy).toBe(5 - accelUnit.energy - 1)
  })

  it('not paying it: the unit enters exhausted at base cost', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [accelUnit])
    s = withEnergy(s, 'player', 5)
    s = dispatch(s, { type: 'PLAY_UNIT', card: accelUnit, to: { kind: 'base' } }, 'player')
    expect(s.player.base[0].exhausted).toBe(true)
    expect(s.player.runes.energy).toBe(5 - accelUnit.energy)
  })

  it('a :rb_rune_<domain>: in the Accelerate cost exhausts a channeled rune', () => {
    const opt = unitPlayOptions(accelRuneUnit).find((o) => o.id === 'accelerate')!
    expect(opt.extraEnergy).toBe(1)
    expect(opt.extraRunes).toEqual(['fury'])

    let s = startedGame({ firstPlayer: 'player' }) // 2 channeled Fury runes
    s = withHand(s, 'player', [accelRuneUnit])
    s = withEnergy(s, 'player', 6)
    s = dispatch(
      s,
      { type: 'PLAY_UNIT', card: accelRuneUnit, to: { kind: 'base' }, paidAccelerate: true },
      'player',
    )
    expect(s.player.base[0].exhausted).toBe(false)
    // base 2 + explicit +1 energy; the Fury rune pip floats (no extra energy)
    expect(s.player.runes.energy).toBe(6 - accelRuneUnit.energy - 1)
    expect(s.player.runes.spent).toHaveLength(1)
    expect(s.player.runes.spent[0].domains[0]).toBe('fury')
  })

  it('refuses Accelerate when no channeled rune is free for the pip', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [accelRuneUnit])
    s = withEnergy(s, 'player', 9)
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, spent: s.player.runes.channeled } } }
    s = dispatch(
      s,
      { type: 'PLAY_UNIT', card: accelRuneUnit, to: { kind: 'base' }, paidAccelerate: true },
      'player',
    )
    expect(s.player.base).toHaveLength(0)
    expect(s.log.some((l) => /not enough energy\/runes/i.test(l))).toBe(true)
  })
})

describe('only units go on the board', () => {
  it('PLAY_UNIT with a spell is rejected at the base and on a battlefield', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0) // so the battlefield would otherwise be legal
    s = withHand(s, 'player', [bolt])
    s = withEnergy(s, 'player', 9)

    s = dispatch(s, { type: 'PLAY_UNIT', card: bolt, to: { kind: 'base' } }, 'player')
    expect(s.player.base.some((u) => u.card === bolt)).toBe(false)

    s = dispatch(s, { type: 'PLAY_UNIT', card: bolt, to: { kind: 'battlefield', index: 0 } }, 'player')
    expect(at(s, 'player', 0).some((u) => u.card === bolt)).toBe(false)
    expect(s.log.some((l) => /only units/i.test(l))).toBe(true)
  })
})

describe('moving = attacking', () => {
  it('moving into an enemy-held battlefield contests it but does not fight yet', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = placeAtBase(s, 'player', grunt)
    const id = s.player.base[0].instanceId

    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } }, 'player')
    expect(s.pendingShowdown).toBeNull()
    expect(s.priority).toBe('player') // mover keeps priority
    expect(at(s, 'player', 0)).toHaveLength(1)
    expect(s.log.some((l) => /contested\. Declare a showdown/i.test(l))).toBe(true)
  })

  it('DECLARE_SHOWDOWN opens the priority window at a contested battlefield', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = placeAtBase(s, 'player', grunt)
    const id = s.player.base[0].instanceId
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } }, 'player')

    s = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'player')
    expect(s.pendingShowdown).toEqual({ index: 0, declarer: 'player' })
    expect(s.priority).toBe('ai')
  })

  it('you can reinforce a contested battlefield with more units before declaring', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = placeAtBase(s, 'player', grunt)
    s = placeAtBase(s, 'player', grunt)
    const [a, b] = s.player.base.map((u) => u.instanceId)
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: a, to: { kind: 'battlefield', index: 0 } }, 'player')
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: b, to: { kind: 'battlefield', index: 0 } }, 'player')
    expect(at(s, 'player', 0)).toHaveLength(2)
    expect(s.pendingShowdown).toBeNull()
  })

  it('un-declared attackers are forced to fight at end of turn', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0) // 2 might defender
    s = placeAtBase(s, 'player', grunt)
    s = placeAtBase(s, 'player', grunt) // 2 attackers, 4 might total → they win
    const [a, b] = s.player.base.map((u) => u.instanceId)
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: a, to: { kind: 'battlefield', index: 0 } }, 'player')
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: b, to: { kind: 'battlefield', index: 0 } }, 'player')

    s = dispatch(s, { type: 'END_TURN' }, 'player')
    expect(s.log.some((l) => /did not declare/i.test(l))).toBe(true)
    expect(at(s, 'ai', 0)).toHaveLength(0) // defender destroyed
    expect(s.player.points).toBe(1) // conquered
  })

  it('moving a base unit into an open battlefield conquers it immediately', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeAtBase(s, 'player', grunt)
    const id = s.player.base[0].instanceId
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } }, 'player')
    expect(s.pendingShowdown).toBeNull()
    expect(s.player.points).toBe(1)
  })

  it('battlefield → battlefield needs Ganking', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    const id = at(s, 'player', 0)[0].instanceId
    const before = s
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 1 } }, 'player')
    expect(s.log.some((l) => /Ganking/.test(l))).toBe(true)
    expect(at(s, 'player', 1)).toHaveLength(0)
    expect(at(before, 'player', 0)).toHaveLength(1)
  })
})

describe('totalPlayCost is the single source of truth for play costs', () => {
  // The Accelerate toggle in the UI used to re-derive this from the *printed*
  // energy and ignore the card's own rune pips, so it enabled plays that
  // `playUnit` then refused.
  const accelPipUnit = makeCard({
    name: 'Pip Accelerant',
    type: 'unit',
    domains: ['fury'],
    energy: 2,
    power: 1, // one :rb_rune_fury: pip of its own
    keywords: ['Accelerate'],
    text: '[Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional cost to have me enter ready.)',
  })

  it('counts the card’s own rune pips as well as the option’s', () => {
    const s = startedGame({ firstPlayer: 'player' })
    const opt = unitPlayOptions(accelPipUnit).find((o) => o.id === 'accelerate')!
    const plain = totalPlayCost(s, 'player', accelPipUnit, [])
    const accelerated = totalPlayCost(s, 'player', accelPipUnit, [opt])

    expect(plain.energy).toBe(2)
    expect(plain.runes).toHaveLength(1) // its own pip
    expect(accelerated.energy).toBe(3) // +1 from Accelerate
    expect(accelerated.runes).toHaveLength(2) // its pip + Accelerate's
  })

  it('agrees with what playUnit will actually accept', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [accelPipUnit])
    const opt = unitPlayOptions(accelPipUnit).find((o) => o.id === 'accelerate')!
    const cost = totalPlayCost(s, 'player', accelPipUnit, [opt])

    // Rune pips *float* — they cost a free channeled rune, not extra energy.
    // With plenty of energy but only one free rune, the accelerated play needs
    // two pips (the card's own plus Accelerate's) and must be refused. The old
    // UI gate only counted the option's pips, so it said yes here.
    const tight = {
      ...s,
      player: {
        ...s.player,
        runes: { ...s.player.runes, energy: 9, channeled: s.player.runes.channeled.slice(0, 1), spent: [] },
      },
    }
    expect(canAfford(tight, 'player', cost)).toBe(false)
    const refused = dispatch(
      tight,
      { type: 'PLAY_UNIT', card: accelPipUnit, to: { kind: 'base' }, paidAccelerate: true },
      'player',
    )
    expect(refused.player.base).toHaveLength(0)
    expect(refused.log.some((l) => /not enough/i.test(l))).toBe(true)
  })
})
