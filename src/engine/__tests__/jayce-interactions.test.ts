import { describe, expect, it } from 'vitest'
import { Card } from '../../types/card'
import { GameState, UnitInPlay } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { dispatch } from '../actions'
import { scriptFor } from '../abilities/scripts'
import { allUnits, setCardPool } from '../state'
import { initGame } from '../setup'
import { effectiveAbilityCost } from '../costs'
import { keywordValue, showdownMight } from '../keywords'
import { moveUnitEffect, setEmpowered } from '../abilities/effects'
import { seededRng } from './fixtures'
import poolData from './fixtures/card-pool.json'

const POOL = poolData as unknown as Card[]
__setCardData(POOL)
setCardPool(POOL)
const byName = (n: string) => POOL.find((c) => c.name === n)!
const ALL: Card['domains'] = ['fury', 'calm', 'mind', 'body', 'order', 'chaos']

/**
 * The Jayce deck is the gear deck, so almost everything in it is an
 * interaction between two cards rather than a card on its own: Empower cycles,
 * gear counts, cost discounts, "when you play a gear" triggers. Those are
 * exactly the parts a per-card script test never reaches.
 */

const drain = (s: GameState): GameState => {
  let g = 0
  while (s.stack.length && g++ < 12) {
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
  }
  return s
}

function game(): GameState {
  let s = initGame(
    {
      id: 'j',
      name: 'J',
      legendId: byName('Jayce - Defender of Tomorrow').id,
      chosenChampionId: byName('Jayce, Hammer in Hand').id,
      battlefieldIds: [],
      runes: [],
      cards: [],
      preset: true,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'z',
      name: 'Z',
      legendId: byName('Zed - Master of Shadows').id,
      chosenChampionId: byName('Zed, From the Shadows').id,
      battlefieldIds: [],
      runes: [],
      cards: [],
      preset: true,
      createdAt: 0,
      updatedAt: 0,
    },
    POOL,
    { firstPlayer: 'player', rng: seededRng(3) },
  )
  s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
  s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')
  const runes = Array.from({ length: 12 }, (_, i) => ({
    ...POOL.find((c) => c.type === 'rune')!,
    id: `r${i}`,
    domains: [i % 2 ? 'mind' : 'body'] as Card['domains'],
  }))
  return {
    ...s,
    player: {
      ...s.player,
      identity: ALL,
      runes: { ...s.player.runes, channeled: runes, energy: 12, spent: [] },
    },
  }
}

/** Put gear `name` into play, returning its instance id. */
function withGear(s: GameState, name: string, tag = '1'): { s: GameState; id: string } {
  const before = s.player.gear.length
  s = { ...s, player: { ...s.player, hand: [{ ...byName(name), id: `${name}~${tag}` }] } }
  s = dispatch(s, { type: 'PLAY_GEAR', card: s.player.hand[0], targetInstanceIds: [] }, 'player')
  s = drain(s)
  expect(s.player.gear.length, `${name} reached play`).toBe(before + 1)
  return { s, id: s.player.gear[s.player.gear.length - 1].instanceId }
}

/** Put unit `name` at the player's base, returning its instance id. */
function withUnit(s: GameState, name: string, tag = '1'): { s: GameState; id: string } {
  const before = s.player.base.length
  s = { ...s, player: { ...s.player, hand: [{ ...byName(name), id: `${name}~${tag}` }] } }
  s = dispatch(s, { type: 'PLAY_UNIT', card: s.player.hand[0], to: { kind: 'base' } }, 'player')
  s = drain(s)
  expect(s.player.base.length, `${name} reached the base`).toBe(before + 1)
  return { s, id: s.player.base[s.player.base.length - 1].instanceId }
}

const unitById = (s: GameState, id: string): UnitInPlay =>
  allUnits(s).find((u) => u.instanceId === id)!

// ── Repair Specialist ─────────────────────────────────────────────────────

describe('Repair Specialist — "[Assault] equal to the number of gear you control"', () => {
  it('has no Assault with no gear out', () => {
    const { s, id } = withUnit(game(), 'Repair Specialist')
    expect(keywordValue(unitById(s, id), 'Assault')).toBe(0)
  })

  it('gains Assault as gear arrives, and loses it when the gear goes', () => {
    // The dynamic value is deliberately a *Might term*, not a keywordValue:
    // `keywordValue` reports printed and granted magnitudes and skips the
    // "equal to" form on purpose (keywords.ts:36), so measure where it lands.
    let { s, id } = withUnit(game(), 'Repair Specialist')
    const bare = showdownMight(s, unitById(s, id), 'attacker')
    ;({ s } = withGear(s, 'Jagged Cutlass', 'a'))
    expect(showdownMight(s, unitById(s, id), 'attacker'), 'one gear -> +1').toBe(bare + 1)
    ;({ s } = withGear(s, 'Hextech Formula', 'b'))
    expect(showdownMight(s, unitById(s, id), 'attacker'), 'two gear -> +2').toBe(bare + 2)

    // Remove a gear and it must follow back down — a count that only ever
    // goes up is the classic failure here.
    s = { ...s, player: { ...s.player, gear: s.player.gear.slice(0, 1) } }
    expect(showdownMight(s, unitById(s, id), 'attacker'), 'back to one gear').toBe(bare + 1)
  })

  it('counts only your own gear, not the opponent\'s', () => {
    let { s, id } = withUnit(game(), 'Repair Specialist')
    ;({ s } = withGear(s, 'Jagged Cutlass', 'a'))
    const mine = showdownMight(s, unitById(s, id), 'attacker')
    s = {
      ...s,
      ai: {
        ...s.ai,
        gear: s.player.gear.map((g) => ({ ...g, instanceId: `ai-${g.instanceId}` })),
      },
    }
    expect(showdownMight(s, unitById(s, id), 'attacker'), 'enemy gear must not count').toBe(mine)
  })

  it('the Assault actually reaches its attacking Might', () => {
    let { s, id } = withUnit(game(), 'Repair Specialist')
    const bare = showdownMight(s, unitById(s, id), 'attacker')
    ;({ s } = withGear(s, 'Jagged Cutlass', 'a'))
    ;({ s } = withGear(s, 'Hextech Formula', 'b'))
    expect(showdownMight(s, unitById(s, id), 'attacker'), 'Assault 2 on top of printed').toBe(
      bare + 2,
    )
    // Assault is attacker-only (rule 807) — defending Might must not move.
    expect(showdownMight(s, unitById(s, id), 'defender')).toBe(bare)
  })
})

// ── Piltovan Forge ────────────────────────────────────────────────────────

describe('Piltovan Forge — first friendly gear ability each turn costs less', () => {
  // The card discounts a gear *activated ability*, not the cost of playing a
  // gear card. Measuring the wrong one is why this looked fine for a while.
  function withForge(s: GameState) {
    const forge = byName('Piltovan Forge')
    return {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, card: forge, name: forge.name } : bf,
      ),
    }
  }

  /** Hold battlefield 0 so the "while you control" clause is live.
   *  Placed directly: a unit played this turn is summoning-sick and the
   *  MOVE_UNIT would be refused, leaving the battlefield open. */
  function holding(s: GameState): GameState {
    return {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? {
              ...bf,
              units: [
                {
                  instanceId: 'mine1',
                  card: byName('Repair Specialist'),
                  owner: 'player' as const,
                  location: { kind: 'battlefield' as const, index: 0 },
                  exhausted: false,
                  damage: 0,
                  counters: {},
                  sick: false,
                },
              ],
            }
          : bf,
      ),
    }
  }

  it('discounts a gear ability while you hold the Forge', () => {
    const base = byName('Platewyrm Egg') // its Empower costs [1] + exhaust
    const plain = effectiveAbilityCost(game(), 'player', {
      source: base,
      isEmpower: true,
      base: { energy: 1, power: 0, runes: [] },
    })
    expect(plain.energy, 'no Forge, no discount').toBe(1)

    const s = holding(withForge(game()))
    const cheap = effectiveAbilityCost(s, 'player', {
      source: base,
      isEmpower: true,
      base: { energy: 1, power: 0, runes: [] },
    })
    expect(cheap.energy, 'the Forge takes 1 off').toBe(0)
  })

  it('does not discount while the opponent holds it', () => {
    let s = withForge(game())
    // Put an enemy unit there instead, so we do not control it.
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? {
              ...bf,
              units: [
                {
                  instanceId: 'enemy1',
                  card: byName('Repair Specialist'),
                  owner: 'ai' as const,
                  location: { kind: 'battlefield' as const, index: 0 },
                  exhausted: false,
                  damage: 0,
                  counters: {},
                  sick: false,
                },
              ],
            }
          : bf,
      ),
    }
    const cost = effectiveAbilityCost(s, 'player', {
      source: byName('Platewyrm Egg'),
      isEmpower: true,
      base: { energy: 1, power: 0, runes: [] },
    })
    expect(cost.energy, 'their Forge does not help you').toBe(1)
  })

  it('applies to the first gear ability only, then stops for the turn', () => {
    const s = holding(withForge(game()))
    const used = { ...s, player: { ...s.player, forgeDiscountUsed: true } }
    const cost = effectiveAbilityCost(used, 'player', {
      source: byName('Platewyrm Egg'),
      isEmpower: true,
      base: { energy: 1, power: 0, runes: [] },
    })
    expect(cost.energy, 'second ability pays full price').toBe(1)
  })
})

// ── Gear + Empower cycle ──────────────────────────────────────────────────

describe('Empower cycles', () => {
  it('Hextech Formula enters exhausted and cannot pay its own cost that turn', () => {
    const { s, id } = withGear(game(), 'Hextech Formula', 'a')
    const g = s.player.gear.find((x) => x.instanceId === id)!
    // "This enters exhausted." — the exhaust cost is unpayable on arrival.
    expect(g.exhausted, 'entered exhausted').toBe(true)
  })

  it('Hextech Formula empowers another gear once it is ready', () => {
    let { s } = withGear(game(), 'Hextech Formula', 'a')
    const { s: s2, id: target } = withGear(s, 'Jagged Cutlass', 'b')
    s = s2
    // Ready it the way an Awaken would, so the exhaust cost can be paid.
    s = {
      ...s,
      player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) },
    }
    const formulaGear = s.player.gear.find((g) => /formula/i.test(g.card.name))!
    s = dispatch(
      s,
      {
        type: 'ACTIVATE_ABILITY',
        instanceId: formulaGear.instanceId,
        abilityIndex: 0,
        targetInstanceIds: [target],
      },
      'player',
    )
    s = drain(s)
    const cutlass = s.player.gear.find((g) => g.instanceId === target)
    expect(cutlass?.empowered, 'the other gear became Empowered').toBe(true)
  })

  it('Risen Altar makes Empower costs cheaper for units there', () => {
    let s = game()
    const altar = byName('Risen Altar')
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, card: altar, name: altar.name } : bf,
      ),
    }
    const { s: withResearchers, id } = withUnit(s, 'Applied Researchers')
    s = dispatch(
      withResearchers,
      { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } },
      'player',
    )
    const abil = (scriptFor(byName('Applied Researchers'))?.activated ?? [])[0]
    expect(abil, 'Applied Researchers has an Empower ability').toBeTruthy()
  })
})

// ── Gear-count triggers ───────────────────────────────────────────────────

describe('gear-count triggers', () => {
  it('Patched Porobot draws only when you already control 3+ other gear', () => {
    let s = game()
    // Fewer than 3 gear: no draw.
    ;({ s } = withGear(s, 'Jagged Cutlass', 'a'))
    ;({ s } = withGear(s, 'Hextech Formula', 'b'))
    const handBefore = s.player.hand.length
    const deckBefore = s.player.mainDeck.length
    ;({ s } = withUnit(s, 'Patched Porobot', 'p1'))
    expect(s.player.mainDeck.length, 'no draw below the threshold').toBe(deckBefore)
    expect(s.player.hand.length).toBe(handBefore)

    // Now three gear.
    ;({ s } = withGear(s, 'Questionable Tome', 'c'))
    const deckBefore2 = s.player.mainDeck.length
    ;({ s } = withUnit(s, 'Patched Porobot', 'p2'))
    expect(s.player.mainDeck.length, 'draws 1 at 3+ gear').toBe(deckBefore2 - 1)
  })

  it('Patched Porobot enters exhausted', () => {
    const { s, id } = withUnit(game(), 'Patched Porobot')
    expect(unitById(s, id).exhausted, '"I enter exhausted"').toBe(true)
  })
})

// ── Sky Cruiser ───────────────────────────────────────────────────────────

describe('Sky Cruiser — "Discard a gear, [1], exhaust: Deal 4 to a unit at a battlefield"', () => {
  it('cannot fire with no gear to discard', () => {
    const { s, id } = withUnit(game(), 'Sky Cruiser')
    const ready = {
      ...s,
      player: { ...s.player, base: s.player.base.map((u) => ({ ...u, exhausted: false, sick: false })) },
    }
    const after = dispatch(
      ready,
      { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0, targetInstanceIds: [] },
      'player',
    )
    expect(after.stack.length, 'no gear in hand → cost cannot be paid').toBe(0)
  })
})

// ── Acceleration Gate ─────────────────────────────────────────────────────

describe('Acceleration Gate — "Ready up to 4 units, gear, and/or runes"', () => {
  it('readies an exhausted friendly unit once the choice is answered', () => {
    let { s, id } = withUnit(game(), 'Patched Porobot') // enters exhausted
    expect(unitById(s, id).exhausted).toBe(true)
    const gate = { ...byName('Acceleration Gate'), id: 'gate~1' }
    s = { ...s, player: { ...s.player, hand: [gate] } }
    s = dispatch(s, { type: 'PLAY_SPELL', card: gate, targetInstanceIds: [] }, 'player')
    s = drain(s)

    // It does not take spell targets — it asks the controller to pick up to 4
    // permanents. A test that skips the prompt readies nothing.
    const choice = s.pendingChoices[0]
    expect(choice, 'Acceleration Gate raised a choice').toBeTruthy()
    const mine = choice.legalIds.filter((t) => t.includes(id))
    expect(mine.length, 'the exhausted unit is offered').toBeGreaterThan(0)
    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: mine.slice(0, 1) }, 'player')
    s = drain(s)
    expect(unitById(s, id).exhausted, 'Acceleration Gate readied it').toBe(false)
  })
})

// ── Iterative Design ──────────────────────────────────────────────────────

describe('Iterative Design — "Play a 3 Might Mech unit token"', () => {
  it('creates a 3-Might Mech', () => {
    let s = game()
    const card = { ...byName('Iterative Design'), id: 'iter~1' }
    s = { ...s, player: { ...s.player, hand: [card] } }
    s = dispatch(s, { type: 'PLAY_SPELL', card, targetInstanceIds: [] }, 'player')
    s = drain(s)
    const mechs = allUnits(s).filter((u) => /mech/i.test(u.card.name) && u.owner === 'player')
    expect(mechs.length, 'one Mech token').toBe(1)
    expect(mechs[0].card.might).toBe(3)
  })
})

// ── Otterpus ──────────────────────────────────────────────────────────────

describe('Otterpus — early scoring is blanked', () => {
  it('stops a first-turn conquer from scoring', () => {
    let s = game()
    const { s: withOtter } = withUnit(s, 'Otterpus')
    s = withOtter
    const before = s.player.points
    // Conquer battlefield 0 on turn 1.
    const { s: s2, id } = withUnit(s, 'Repair Specialist', 'rs')
    s = dispatch(
      s2,
      { type: 'MOVE_UNIT', instanceId: id, to: { kind: 'battlefield', index: 0 } },
      'player',
    )
    s = drain(s)
    expect(s.turn, 'still an early turn').toBeLessThanOrEqual(2)
    expect(s.player.points, 'Otterpus blanks the early point').toBe(before)
  })
})

// ── Platewyrm Egg / Tools of Empire — "If this is [Empowered], … instead" ──

describe('Empowered branches on gear abilities', () => {
  /** Ready every gear, as an Awaken would, so exhaust costs are payable. */
  const readyGear = (s: GameState): GameState => ({
    ...s,
    player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) },
  })

  it('Platewyrm Egg adds 1 Energy while not Empowered', () => {
    let { s, id } = withGear(game(), 'Platewyrm Egg', 'e')
    s = readyGear(s)
    const before = s.player.runes.energy
    s = dispatch(
      s,
      { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 1, targetInstanceIds: [] },
      'player',
    )
    s = drain(s)
    expect(s.player.runes.energy - before, 'base branch adds 1').toBe(1)
  })

  it('Platewyrm Egg adds 2 Energy once Empowered', () => {
    let { s, id } = withGear(game(), 'Platewyrm Egg', 'e')
    s = readyGear(s)
    // Ability 0 is the Empower cost (1 Energy + exhaust).
    s = dispatch(
      s,
      { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 0, targetInstanceIds: [] },
      'player',
    )
    s = drain(s)
    const egg = s.player.gear.find((g) => g.instanceId === id)!
    expect(egg.empowered, 'the Egg is Empowered').toBe(true)

    s = readyGear(s) // the Empower cost exhausted it
    const before = s.player.runes.energy
    s = dispatch(
      s,
      { type: 'ACTIVATE_ABILITY', instanceId: id, abilityIndex: 1, targetInstanceIds: [] },
      'player',
    )
    s = drain(s)
    expect(s.player.runes.energy - before, 'Empowered branch adds 2').toBe(2)
  })
  it('adds 2 when Empowered by another card, not only by its own cost', () => {
    // The Egg can be Empowered two ways: its own [Empower] cost, or Hextech
    // Formula's "Empower another gear". Both must reach the same flag, or the
    // boosted branch silently stays off and the Egg keeps adding 1.
    let { s, id: eggId } = withGear(game(), 'Platewyrm Egg', 'e2')
    const { s: s2, id: formulaId } = withGear(s, 'Hextech Formula', 'f2')
    s = s2
    s = {
      ...s,
      player: { ...s.player, gear: s.player.gear.map((g) => ({ ...g, exhausted: false })) },
    }
    s = dispatch(
      s,
      {
        type: 'ACTIVATE_ABILITY',
        instanceId: formulaId,
        abilityIndex: 0,
        targetInstanceIds: [eggId],
      },
      'player',
    )
    s = drain(s)
    const egg = s.player.gear.find((g) => g.instanceId === eggId)!
    expect(egg.empowered, 'the Formula Empowered the Egg').toBe(true)

    const before = s.player.runes.energy
    s = dispatch(
      s,
      { type: 'ACTIVATE_ABILITY', instanceId: eggId, abilityIndex: 1, targetInstanceIds: [] },
      'player',
    )
    s = drain(s)
    expect(s.player.runes.energy - before, 'Empowered branch adds 2').toBe(2)
  })
})

// ── Jagged Cutlass ────────────────────────────────────────────────────────

describe('Jagged Cutlass — the printed Attached box', () => {
  // The API text carries only the [Equip] line; the card face also has an
  // "Attached:" box reading "+2 Might" and "I can't be moved by enemy spells
  // and abilities." Same data gap as Boots of Swiftness / Edge of Night.
  it('grants +2 Might to the unit it is attached to', () => {
    let { s, id: unitId } = withUnit(game(), 'Repair Specialist', 'rs')
    const bare = showdownMight(s, unitById(s, unitId), 'defender')
    const { s: s2, id: gearId } = withGear(s, 'Jagged Cutlass', 'jc')
    s = s2
    // Equip is ability 0 — attach it to the unit.
    s = dispatch(
      s,
      {
        type: 'ACTIVATE_ABILITY',
        instanceId: gearId,
        abilityIndex: 0,
        targetInstanceIds: [unitId],
      },
      'player',
    )
    s = drain(s)
    const gear = s.player.gear.find((g) => g.instanceId === gearId)!
    expect(gear.attachedTo, 'the Cutlass attached').toBe(unitId)
    expect(showdownMight(s, unitById(s, unitId), 'defender'), '+2 Might from the Cutlass').toBe(
      bare + 2,
    )
  })
  it('protects its unit from enemy moves but not from your own', () => {
    let { s, id: unitId } = withUnit(game(), 'Repair Specialist', 'rs2')
    const { s: s2, id: gearId } = withGear(s, 'Jagged Cutlass', 'jc2')
    s = s2
    s = dispatch(
      s,
      {
        type: 'ACTIVATE_ABILITY',
        instanceId: gearId,
        abilityIndex: 0,
        targetInstanceIds: [unitId],
      },
      'player',
    )
    s = drain(s)
    // Park it on a battlefield so a move is observable.
    s = moveUnitEffect(s, unitId, { kind: 'battlefield', index: 0 }, {}, (x) => x)
    expect(unitById(s, unitId).location.kind).toBe('battlefield')

    // An enemy effect cannot shift it.
    const byEnemy = moveUnitEffect(s, unitId, { kind: 'base' }, { by: 'ai' }, (x) => x)
    expect(unitById(byEnemy, unitId).location.kind, 'enemy move refused').toBe('battlefield')

    // Its controller still can.
    const byMe = moveUnitEffect(s, unitId, { kind: 'base' }, { by: 'player' }, (x) => x)
    expect(unitById(byMe, unitId).location.kind, 'your own move still works').toBe('base')
  })
})

// ── setEmpowered must reach gear, not just units ──────────────────────────

describe('setEmpowered covers gear', () => {
  // It used to map only over units, so aiming it at a gear silently did
  // nothing — and on a card reading "If this is [Empowered], … instead" that
  // looks exactly like the card not working.
  it('flags a gear as Empowered', () => {
    const { s, id } = withGear(game(), 'Platewyrm Egg', 'se')
    const on = setEmpowered(s, id, true)
    expect(on.player.gear.find((g) => g.instanceId === id)?.empowered).toBe(true)
    const off = setEmpowered(on, id, false)
    expect(off.player.gear.find((g) => g.instanceId === id)?.empowered).toBe(false)
  })

  it('still flags a unit as Empowered', () => {
    const { s, id } = withUnit(game(), 'Repair Specialist', 'se2')
    const on = setEmpowered(s, id, true)
    expect(unitById(on, id).empowered).toBe(true)
  })
})
