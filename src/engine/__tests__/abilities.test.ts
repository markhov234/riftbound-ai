import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide, UnitInPlay } from '../../types/game'
import { dispatch } from '../actions'
import { beginTurn } from '../phases'
import { showdownMight } from '../keywords'
import {
  annieStubborn,
  bolt,
  deflectUnit,
  discipline,
  empoweredSentinel,
  grunt,
  gust,
  legionBrute,
  makeCard,
  placeAtBase,
  placeUnitAt,
  startedGame,
  stellacorn,
  voidSeeker,
  withHand,
} from './fixtures'

function resolveTop(s: GameState): GameState {
  const holder = s.priority
  const other: PlayerSide = holder === 'player' ? 'ai' : 'player'
  s = dispatch(s, { type: 'PASS_PRIORITY' }, holder)
  s = dispatch(s, { type: 'PASS_PRIORITY' }, other)
  return s
}
const enemyUnits = (s: GameState) =>
  s.battlefields.flatMap((bf) => bf.units.filter((u) => u.owner === 'ai'))
const myUnits = (s: GameState) =>
  s.battlefields.flatMap((bf) => bf.units.filter((u) => u.owner === 'player'))

describe('spell effects', () => {
  it('Void Seeker deals 4 to a battlefield unit and draws a card', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [voidSeeker])
    s = placeUnitAt(s, 'ai', grunt, 0) // might 2
    const handBefore = 0 // hand is just [voidSeeker], which is spent on cast

    s = dispatch(s, { type: 'PLAY_SPELL', card: voidSeeker, targetInstanceIds: [enemyUnits(s)[0].instanceId] }, 'player')
    s = resolveTop(s)

    expect(enemyUnits(s)).toHaveLength(0)
    expect(s.player.hand.length).toBe(handBefore + 1) // drew from "Draw 1"
  })

  it('Discipline gives +2 might this turn', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [discipline])
    s = placeUnitAt(s, 'player', grunt, 0)
    const id = myUnits(s)[0].instanceId

    s = dispatch(s, { type: 'PLAY_SPELL', card: discipline, targetInstanceIds: [id] }, 'player')
    s = resolveTop(s)

    const buffed = myUnits(s)[0]
    expect(buffed.counters.mightTurn).toBe(2)
    expect(showdownMight(s, buffed)).toBe(grunt.might + 2)
  })

  it('Gust only bounces units with 3 might or less', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [gust])
    s = placeUnitAt(s, 'ai', grunt, 0) // might 2 — legal target

    s = dispatch(s, { type: 'PLAY_SPELL', card: gust, targetInstanceIds: [enemyUnits(s)[0].instanceId] }, 'player')
    s = resolveTop(s)

    expect(enemyUnits(s)).toHaveLength(0)
    expect(s.ai.hand.map((c) => c.name)).toContain('Grunt')
  })
})

describe('triggered abilities', () => {
  it('Annie – Stubborn prompts the player to pick which trashed spell to return', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [annieStubborn])
    s = {
      ...s,
      player: {
        ...s.player,
        runes: { ...s.player.runes, energy: 5 },
        trash: [bolt, { ...voidSeeker, id: 'trash-vs' }],
      },
    }

    s = dispatch(s, { type: 'PLAY_UNIT', card: annieStubborn, to: { kind: 'base' } }, 'player')
    expect(s.pendingChoices).toHaveLength(1)
    expect(s.pendingChoices[0].kind).toBe('trashCard')
    expect(s.pendingChoices[0].legalIds).toHaveLength(2)

    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: ['trash-vs'] }, 'player')
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.player.hand.some((c) => c.id === 'trash-vs')).toBe(true)
    expect(s.player.trash.some((c) => c.id === 'trash-vs')).toBe(false)
  })

  it("blocks the player's other actions while a choice is pending", () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [annieStubborn])
    s = {
      ...s,
      player: {
        ...s.player,
        runes: { ...s.player.runes, energy: 5 },
        trash: [bolt, { ...voidSeeker, id: 'trash-vs' }],
      },
    }
    s = dispatch(s, { type: 'PLAY_UNIT', card: annieStubborn, to: { kind: 'base' } }, 'player')
    const before = s
    s = dispatch(s, { type: 'END_TURN' }, 'player')
    expect(s).toBe(before) // ignored — must resolve the choice first
  })

  it('Stellacorn Herder draws a card when it moves', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', stellacorn, 0)
    const id = myUnits(s)[0].instanceId
    const handBefore = s.player.hand.length

    // Move back to base — no conquer, so only the "when I move, draw 1" trigger fires.
    s = dispatch(s, { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'base' } }, 'player')

    expect(s.player.hand.length).toBe(handBefore + 1)
  })
})

describe('Deflect X cost', () => {
  function setup() {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [discipline]) // reaction spell, {kind:'unit'} target
    s = placeUnitAt(s, 'ai', deflectUnit, 0) // enemy unit with [Deflect]
    const enemyId = s.battlefields[0].units.find((u) => u.owner === 'ai')!.instanceId
    return { s, enemyId }
  }

  it('refuses the cast when the caster is short the extra Power', () => {
    let { s } = setup()
    const enemyId = s.battlefields[0].units.find((u) => u.owner === 'ai')!.instanceId
    // Discipline is 1 energy; Deflect adds a +1 pip → needs 2 runes' worth. Leave
    // the caster with exactly 1, so the pip can't be covered from energy either.
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 1, power: 0 } } }
    const after = dispatch(
      s,
      { type: 'PLAY_SPELL', card: discipline, targetInstanceIds: [enemyId] },
      'player',
    )
    expect(after.stack).toHaveLength(0)
    expect(after.log.some((l) => /energy\/power|Deflect/.test(l))).toBe(true)
  })

  it('charges +1 Power and lets the spell through when it is available', () => {
    let { s, enemyId } = setup()
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, power: 1 } } }
    s = dispatch(s, { type: 'PLAY_SPELL', card: discipline, targetInstanceIds: [enemyId] }, 'player')
    expect(s.stack).toHaveLength(1)
    expect(s.player.runes.power).toBe(0)
  })
})

describe('ability guards (when)', () => {
  it('Legion — the trigger only fires after another card was played this turn', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [grunt, legionBrute])
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }

    // Legion Brute alone → no other card played → not buffed.
    let solo = dispatch(s, { type: 'PLAY_UNIT', card: legionBrute, to: { kind: 'base' } }, 'player')
    expect(solo.player.base[0].counters.buffed ?? 0).toBe(0)

    // Play a card first, then Legion Brute → Legion active → buffed.
    s = dispatch(s, { type: 'PLAY_UNIT', card: grunt, to: { kind: 'base' } }, 'player')
    s = dispatch(s, { type: 'PLAY_UNIT', card: legionBrute, to: { kind: 'base' } }, 'player')
    const brute = s.player.base.find((u) => u.card.name === 'Legion Brute')!
    expect(brute.counters.buffed).toBe(1)
  })

  it('Empower — the activated ability grants the Empowered status', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeAtBase(s, 'player', empoweredSentinel)
    const id = s.player.base[0].instanceId

    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0 }, 'player')
    s = resolveTop(s)

    expect(s.player.base[0].empowered).toBe(true)
  })
})

describe('UNIT_READIED — Jayce, Hammer in Hand', () => {
  const jayce = makeCard({
    name: 'Jayce, Hammer in Hand',
    type: 'unit',
    domains: ['body'],
    energy: 4,
    might: 5,
  })
  const flat = (s: GameState) =>
    [...s.player.base, ...s.battlefields.flatMap((b) => b.units)]
  const exhaust = (s: GameState, id: string, extra: Partial<UnitInPlay> = {}): GameState => ({
    ...s,
    battlefields: s.battlefields.map((bf) => ({
      ...bf,
      units: bf.units.map((u) =>
        u.instanceId === id ? { ...u, exhausted: true, sick: false, ...extra } : u,
      ),
    })),
  })

  it('readying at Awaken queues the keyword choice; the pick grants it for the turn', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', jayce, 0)
    const id = s.battlefields[0].units[0].instanceId
    s = exhaust(s, id)

    s = beginTurn(s)
    const ch = s.pendingChoices.find((c) => c.kind === 'keyword')
    expect(ch).toBeDefined()
    expect(ch!.legalIds).toEqual(['Assault 2', 'Deflect 2', 'Ganking'])

    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: ['Assault 2'] }, 'player')
    expect(flat(s).find((u) => u.instanceId === id)!.counters['kw:Assault']).toBe(2)
  })

  it('the AI auto-picks Assault with no prompt', () => {
    let s = startedGame({ firstPlayer: 'ai' })
    s = placeUnitAt(s, 'ai', jayce, 0)
    const id = s.battlefields[0].units[0].instanceId
    s = exhaust(s, id)

    s = beginTurn(s)
    expect(s.pendingChoices.some((c) => c.kind === 'keyword')).toBe(false)
    expect(flat(s).find((u) => u.instanceId === id)!.counters['kw:Assault']).toBe(2)
  })

  it('does not fire for a Stunned unit (it never readies)', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', jayce, 0)
    const id = s.battlefields[0].units[0].instanceId
    s = exhaust(s, id, { counters: { stunned: 1 } })

    s = beginTurn(s)
    expect(s.pendingChoices.some((c) => c.kind === 'keyword')).toBe(false)
  })
})
