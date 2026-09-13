import { describe, expect, it } from 'vitest'
import {
  autoAbilities,
  compileEffect,
  compileScript,
  compileTargets,
  _clearCompileCache,
} from '../abilities/compile'
import { dispatch } from '../actions'
import { mightBonus, showdownMight } from '../keywords'
import { EffectCtx } from '../abilities/effects'
import { GameState, PlayerSide, UnitInPlay } from '../../types/game'
import { grunt, makeCard, placeAtBase, placeUnitAt, startedGame, withHand } from './fixtures'

_clearCompileCache()

/** Run a compiled effect against `state`, with an explicit target list. */
function run(
  text: string,
  state: GameState,
  targetIds: string[] = [],
  controller: PlayerSide = 'player',
  source?: UnitInPlay,
  extra: Partial<EffectCtx> = {},
): GameState {
  const eff = compileEffect(text)
  if (!eff) throw new Error(`compileEffect returned null for: ${text}`)
  const ctx: EffectCtx = {
    state,
    controller,
    source,
    targets: targetIds.map((id) => ({ kind: 'unit' as const, instanceId: id })),
    emit: (s) => s,
    ...extra,
  }
  return eff(ctx)
}

const at = (s: GameState, side: PlayerSide) =>
  s.battlefields.flatMap((bf) => bf.units.filter((u) => u.owner === side))

describe('compileEffect — templated clauses', () => {
  it('"Deal 3 to a unit at a battlefield. Draw 1." damages + draws', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0) // might 2
    const id = at(s, 'ai')[0].instanceId
    const handBefore = s.player.hand.length
    s = run('Deal 3 to a unit at a battlefield. Draw 1.', s, [id])
    expect(at(s, 'ai')).toHaveLength(0) // 3 >= 2 → dead
    expect(s.player.hand.length).toBe(handBefore + 1)
  })

  it('"…If you paid the additional cost, deal 5 to it instead." branches on ctx.paidAdditional', () => {
    const text =
      'Deal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead.'
    const bruiser = makeCard({ name: 'Bruiser', type: 'unit', domains: ['fury'], energy: 4, might: 6 })

    let unpaid = placeUnitAt(startedGame({ firstPlayer: 'player' }), 'ai', bruiser, 0)
    const idA = at(unpaid, 'ai')[0].instanceId
    unpaid = run(text, unpaid, [idA])
    expect(at(unpaid, 'ai')[0].damage).toBe(3) // base branch only — not 3+5

    let paid = placeUnitAt(startedGame({ firstPlayer: 'player' }), 'ai', bruiser, 0)
    const idB = at(paid, 'ai')[0].instanceId
    paid = run(text, paid, [idB], 'player', undefined, { paidAdditional: true })
    expect(at(paid, 'ai')[0].damage).toBe(5) // boosted branch replaces the base
  })

  it('"Give a unit +2 :rb_might: this turn." vs permanent', () => {
    let s = placeAtBase(startedGame(), 'player', grunt)
    const id = s.player.base[0].instanceId
    s = run('Give a unit +2 :rb_might: this turn.', s, [id])
    expect(s.player.base[0].counters.mightTurn).toBe(2)

    let s2 = placeAtBase(startedGame(), 'player', grunt)
    const id2 = s2.player.base[0].instanceId
    s2 = run('Give a unit +2 :rb_might:.', s2, [id2])
    expect(s2.player.base[0].counters.mightPerm).toBe(2)
  })

  it('"[Burn 3]." mills three to the trash', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const deck0 = s.player.mainDeck.length
    s = run('[Burn 3].', s)
    expect(s.player.mainDeck.length).toBe(deck0 - 3)
    expect(s.player.trash.length).toBe(3)
  })

  it('"Play a 3 :rb_might: Mech unit token." makes a token at base', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = run('Play a 3 :rb_might: Mech unit token.', s)
    const t = s.player.base[s.player.base.length - 1]
    expect(t.card.supertype).toBe('token')
    expect(t.card.might).toBe(3)
  })

  it('"Move a unit with 3 Might or less." lets the player pick the destination', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeAtBase(s, 'player', grunt) // might 2 — passes the ≤3 filter
    const id = s.player.base[0].instanceId

    s = run('Move a unit with 3 :rb_might: or less.', s, [id])
    // A destination pick is queued, not an immediate move-to-base.
    expect(s.pendingChoices).toHaveLength(1)
    expect(s.pendingChoices[0].kind).toBe('location')
    expect(s.pendingChoices[0].legalIds).toContain('bf:0')
    expect(s.player.base.some((u) => u.instanceId === id)).toBe(true) // still home

    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: ['bf:0'] }, 'player')
    expect(s.battlefields[0].units.some((u) => u.instanceId === id)).toBe(true)
    expect(s.player.base.some((u) => u.instanceId === id)).toBe(false)
  })

  it('"Move a friendly unit and ready it." relocates + readies', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    s = {
      ...s,
      battlefields: s.battlefields.map((bf) => ({
        ...bf,
        units: bf.units.map((u) => ({ ...u, exhausted: true })),
      })),
    }
    const id = at(s, 'player')[0].instanceId
    s = run('Move a friendly unit and ready it.', s, [id])
    expect(s.player.base.some((u) => u.instanceId === id && !u.exhausted)).toBe(true)
  })

  it('compileTargets reads the target phrase', () => {
    expect(compileTargets('Deal 4 to a unit at a battlefield.')).toMatchObject([
      { kind: 'unitAtBattlefield' },
    ])
    expect(compileTargets('Give a friendly unit +1 :rb_might: this turn.')[0].kind).toBe(
      'friendlyUnit',
    )
    expect(compileTargets('Draw 2.')).toEqual([])
  })

  it('each target slot carries what picking it does, for the prompt + ring colour', () => {
    // A two-target spell: buff an ally, then debuff an enemy.
    const specs = compileTargets(
      'Give a friendly unit +2 :rb_might: this turn. Give an enemy unit -2 :rb_might: this turn.',
    )
    expect(specs).toHaveLength(2)
    expect(specs[0]).toMatchObject({
      kind: 'friendlyUnit',
      intent: 'buff',
      label: 'to give +2 Might this turn',
    })
    expect(specs[1]).toMatchObject({
      kind: 'enemyUnit',
      intent: 'harm',
      label: 'to give −2 Might this turn',
    })

    expect(compileTargets('Deal 3 to an enemy unit.')[0]).toMatchObject({
      intent: 'harm',
      label: 'to deal 3 damage',
    })
    expect(compileTargets('Kill a unit.')[0]).toMatchObject({ intent: 'harm', label: 'to destroy it' })
  })
})

describe('autoAbilities — keyword-driven', () => {
  it('Akali-style [Empower] → one activated ability, cost = energy + a domain rune', () => {
    const akali = makeCard({
      name: 'Test Akali',
      type: 'unit',
      supertype: 'champion',
      domains: ['fury'],
      energy: 3,
      might: 3,
      text: '[Empower] :rb_energy_2::rb_rune_fury:When I move, you may deal 1 to a unit. [Empowered][>] I have +1 :rb_might:.',
    })
    const { activated } = autoAbilities(akali)
    expect(activated).toHaveLength(1)
    expect(activated[0].cost.energy).toBe(2)
    expect(activated[0].cost.runes).toEqual(['fury']) // a Fury rune must be exhausted
  })

  it('[Empowered][>] I have +N [M] → empoweredMight, counted in showdown AND the +N badge', () => {
    const u = makeCard({
      name: 'Emp Test',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 2,
      text: '[Empower] :rb_energy_2: [Empowered][>] I have +2 :rb_might:.',
    })
    let s = placeAtBase(startedGame(), 'player', u)
    const before = showdownMight(s, s.player.base[0])
    expect(mightBonus(s.player.base[0])).toBe(0)
    s = { ...s, player: { ...s.player, base: s.player.base.map((x) => ({ ...x, empowered: true })) } }
    expect(showdownMight(s, s.player.base[0])).toBe(before + 2)
    expect(mightBonus(s.player.base[0])).toBe(2) // shows as "+2" on the card
  })

  it('Empower can only be used once — a second activation on an Empowered unit is refused', () => {
    const u = makeCard({
      name: 'Once Empower',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 2,
      text: '[Empower] :rb_energy_1: [Empowered][>] I have +1 :rb_might:.',
    })
    let s = placeUnitAt(startedGame({ firstPlayer: 'player' }), 'player', u, 0)
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
    const id = at(s, 'player')[0].instanceId

    // First Empower: pushes to stack, resolves, unit is Empowered, 1 energy spent.
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0 }, 'player')
    s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')
    s = dispatch(s, { type: 'PASS_PRIORITY' }, 'ai')
    const eAfterFirst = s.player.runes.energy
    expect(at(s, 'player')[0].empowered).toBe(true)

    // Second Empower attempt: blocked, no stack item, no extra energy spent.
    const before = s
    s = dispatch(s, { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0 }, 'player')
    expect(s.stack).toHaveLength(0)
    expect(s.player.runes.energy).toBe(eAfterFirst)
    expect(s.log.some((l) => /can't be used/i.test(l))).toBe(true)
    expect(before.player.runes.energy).toBe(s.player.runes.energy)
  })

  it('an [Empowered][>] <cost>: <effect> ability is refused until the source is Empowered', () => {
    const g = makeCard({
      name: 'Gate Gear',
      type: 'gear',
      domains: ['mind'],
      energy: 2,
      text: ':rb_exhaust:: Ready a gear. [Empowered][>] :rb_energy_1:, :rb_exhaust:: Ready 2 gear.',
    })
    const { activated } = autoAbilities(g)
    expect(activated.length).toBe(2)

    const gated = activated.find((a) => /2 gear/i.test(a.label))!
    const plain = activated.find((a) => !/2 gear/i.test(a.label))!
    expect(plain.when).toBeUndefined()
    expect(gated.when).toBeTypeOf('function')
    const src = (empowered: boolean) => ({ empowered, instanceId: 'g1' }) as unknown as UnitInPlay
    expect(gated.when!({} as GameState, src(false), 'player')).toBe(false)
    expect(gated.when!({} as GameState, src(true), 'player')).toBe(true)
  })
})

describe('autoAbilities — Legion / Level gates (from card text)', () => {
  const ctxFor = (state: GameState): EffectCtx => ({
    state,
    controller: 'player',
    source: state.player.base[0],
    targets: [],
    emit: (s) => s,
  })

  it('[Legion][>] trigger only fires once another card was played this turn', () => {
    _clearCompileCache()
    const card = makeCard({
      name: 'Compiled Legionnaire',
      type: 'unit',
      domains: ['fury'],
      energy: 1,
      might: 2,
      text: '[Legion][>] When I enter, draw 1.',
    })
    const s = placeAtBase(startedGame({ firstPlayer: 'player' }), 'player', card)
    const trig = compileScript(card).triggers!.find((t) => t.on === 'UNIT_ENTERED')!
    const hand0 = s.player.hand.length

    // No other card played this turn → Legion inactive → no draw.
    let out = trig.effect(ctxFor({ ...s, activePlayer: 'player', cardsPlayedThisTurn: 0 }))
    expect(out.player.hand.length).toBe(hand0)

    // Another Main Deck card already played (count ≥ 2) → Legion active → draw 1.
    out = trig.effect(ctxFor({ ...s, activePlayer: 'player', cardsPlayedThisTurn: 2 }))
    expect(out.player.hand.length).toBe(hand0 + 1)
  })

  it('[Level N][>] trigger only fires while the controller has N+ XP', () => {
    _clearCompileCache()
    const card = makeCard({
      name: 'Compiled Veteran',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 2,
      text: '[Level 3][>] When I conquer, score 1 point.',
    })
    const s = placeAtBase(startedGame({ firstPlayer: 'player' }), 'player', card)
    const trig = compileScript(card).triggers!.find((t) => t.on === 'CONQUERED')!

    let out = trig.effect(ctxFor({ ...s, player: { ...s.player, xp: 0 } }))
    expect(out.player.points).toBe(0)

    out = trig.effect(ctxFor({ ...s, player: { ...s.player, xp: 3 } }))
    expect(out.player.points).toBe(1)
  })

  it('[Level N][>] <cost>: <effect> activated ability carries a Level guard', () => {
    _clearCompileCache()
    const card = makeCard({
      name: 'Compiled Adept',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 2,
      text: ':rb_exhaust:: Draw 1. [Level 4][>] :rb_energy_1:, :rb_exhaust:: Draw 2.',
    })
    const { activated } = autoAbilities(card)
    const gated = activated.find((a) => /draw 2/i.test(a.label))!
    expect(gated.when).toBeTypeOf('function')
    expect(gated.when!({ player: { xp: 0 } } as unknown as GameState, undefined, 'player')).toBe(false)
    expect(gated.when!({ player: { xp: 4 } } as unknown as GameState, undefined, 'player')).toBe(true)
  })
})

describe('"when I attack, you may pay X to …" triggers', () => {
  const poro = () =>
    makeCard({
      name: 'Sinister Poro',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 1,
      text: 'When I attack, you may pay :rb_energy_1: to move an enemy unit here to its base.',
    })

  it('prompts the player to pay instead of firing for free', () => {
    _clearCompileCache()
    const trig = compileScript(poro()).triggers!.find((t) => t.on === 'UNIT_MOVED')!
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0) // something to push back
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 3 } } }
    const enemyId = at(s, 'ai')[0].instanceId

    const ctx: EffectCtx = {
      state: s,
      controller: 'player',
      targets: [{ kind: 'unit', instanceId: enemyId }],
      emit: (x) => x,
    }
    const out = trig.effect(ctx)

    // Nothing happened yet — a skippable "pay?" prompt is queued.
    expect(out.pendingChoices).toHaveLength(1)
    expect(out.pendingChoices[0].kind).toBe('confirm')
    expect(out.pendingChoices[0].min).toBe(0) // "you may"
    expect(out.pendingChoices[0].optionLabels?.[0]).toContain('⚡1')
    expect(out.player.runes.energy).toBe(3) // not charged yet
    expect(at(out, 'ai')).toHaveLength(1) // enemy still at the battlefield

    // Paying charges the energy and sends the enemy unit home.
    const paid = dispatch(out, { type: 'RESOLVE_CHOICE', pickedIds: ['pay'] }, 'player')
    expect(paid.player.runes.energy).toBe(2)
    expect(at(paid, 'ai')).toHaveLength(0)
    expect(paid.ai.base.some((u) => u.instanceId === enemyId)).toBe(true)
  })

  it('declining costs nothing and does nothing', () => {
    _clearCompileCache()
    const trig = compileScript(poro()).triggers!.find((t) => t.on === 'UNIT_MOVED')!
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 3 } } }
    const out = trig.effect({
      state: s,
      controller: 'player',
      targets: [{ kind: 'unit', instanceId: at(s, 'ai')[0].instanceId }],
      emit: (x) => x,
    })
    const declined = dispatch(out, { type: 'RESOLVE_CHOICE', pickedIds: [] }, 'player')
    expect(declined.player.runes.energy).toBe(3)
    expect(at(declined, 'ai')).toHaveLength(1)
  })

  it('is skipped outright when the controller cannot pay', () => {
    _clearCompileCache()
    const trig = compileScript(poro()).triggers!.find((t) => t.on === 'UNIT_MOVED')!
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 0 } } }
    const out = trig.effect({
      state: s,
      controller: 'player',
      targets: [{ kind: 'unit', instanceId: at(s, 'ai')[0].instanceId }],
      emit: (x) => x,
    })
    expect(out.pendingChoices).toHaveLength(0)
    expect(at(out, 'ai')).toHaveLength(1)
  })
})

describe('optional additional cost', () => {
  it('Gust-Monk-style: paying it charges +1⚡ and fires the "if you paid" clause', () => {
    const monk = makeCard({
      name: 'Test Monk',
      type: 'unit',
      domains: ['fury'],
      energy: 2,
      might: 2,
      text: 'You may pay :rb_energy_1: as an additional cost to play me. When you play me, if you paid the additional cost, draw 1.',
    })
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [monk])
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
    const e0 = s.player.runes.energy
    const h0 = s.player.hand.length

    const paid = dispatch(
      s,
      { type: 'PLAY_UNIT', card: monk, to: { kind: 'base' }, paidAdditional: true },
      'player',
    )
    expect(paid.player.runes.energy).toBe(e0 - monk.energy - 1)
    expect(paid.player.base[0].counters.paidExtra).toBe(1)
    expect(paid.player.hand.length).toBe(h0 - 1 + 1) // -monk +draw

    const notPaid = dispatch(
      s,
      { type: 'PLAY_UNIT', card: monk, to: { kind: 'base' } },
      'player',
    )
    expect(notPaid.player.runes.energy).toBe(e0 - monk.energy)
    expect(notPaid.player.base[0].counters.paidExtra ?? 0).toBe(0)
    expect(notPaid.player.hand.length).toBe(h0 - 1) // just -monk, no draw
  })
})
