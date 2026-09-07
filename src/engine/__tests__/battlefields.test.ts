import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { battlefieldAura, battlefieldScript } from '../abilities/battlefields'
import { canMove } from '../actions'
import { emit } from '../events'
import { showdownMight } from '../keywords'
import { beginTurn } from '../phases'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

const bf = (name: string, text: string) =>
  makeCard({ name, type: 'battlefield', domains: ['colorless'], text })

/** Swap battlefield 0's card for `card` and drop a friendly unit on it. */
function onBf0(s: GameState, card: ReturnType<typeof makeCard>, unitCard = grunt()): GameState {
  s = placeUnitAt(s, 'player', unitCard, 0)
  return {
    ...s,
    battlefields: s.battlefields.map((b) =>
      b.index === 0 ? { ...b, card, name: card.name } : b,
    ),
  }
}
const grunt = () => makeCard({ name: 'Grunt', type: 'unit', domains: ['fury'], energy: 2, might: 2 })

describe('battlefield static auras', () => {
  it('"Units here have +1 Might" lifts a unit\'s showdown Might', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = onBf0(s, bf('War Camp', 'Units here have +1 :rb_might:.'))
    const u = s.battlefields[0].units[0]
    expect(battlefieldAura(s, u).might).toBe(1)
    expect(showdownMight(s, u, 'attacker')).toBe(2 + 1)
  })

  it('"Units here with [Tank] have +1 Might" only helps Tank units', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const camp = bf('Kinkou', 'Units here with [Tank] have +1 :rb_might:.')
    const tank = makeCard({ name: 'Wall', type: 'unit', domains: ['fury'], energy: 2, might: 3, keywords: ['Tank'] })
    s = onBf0(s, camp, tank)
    expect(battlefieldAura(s, s.battlefields[0].units[0]).might).toBe(1)

    let s2 = onBf0(startedGame({ firstPlayer: 'player' }), camp) // plain grunt
    expect(battlefieldAura(s2, s2.battlefields[0].units[0]).might).toBe(0)
  })

  it('"Units here have [Ganking]" lets a battlefield unit move to the other battlefield', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = onBf0(s, bf('Hillock', 'Units here have [Ganking].'))
    const u = s.battlefields[0].units[0]
    expect(canMove(s, 'player', u.instanceId, { kind: 'battlefield', index: 1 }).ok).toBe(true)
    // without the aura the same move is blocked
    const bare = { ...s, battlefields: s.battlefields.map((b, i) => (i === 0 ? { ...b, card: null } : b)) }
    expect(canMove(bare, 'player', u.instanceId, { kind: 'battlefield', index: 1 }).ok).toBe(false)
  })
})

describe('battlefield triggered abilities', () => {
  const hold = (name: string, text: string, holder: PlayerSide = 'player') => {
    let s = onBf0(startedGame({ firstPlayer: holder }), bf(name, text))
    s = { ...s, activePlayer: holder }
    return beginTurn(s)
  }

  it('"When you hold here, draw 1" draws at Awaken', () => {
    const s = startedGame({ firstPlayer: 'player' })
    const before = onBf0(s, bf('Grove', 'When you hold here, draw 1.'))
    const h0 = before.player.hand.length
    const after = beginTurn({ ...before, activePlayer: 'player', turn: 2 })
    expect(after.player.hand.length).toBe(h0 + 2) // battlefield draw + the turn draw
    expect(after.log.some((l) => /Grove:.*triggers/.test(l))).toBe(true)
  })

  it('"When you hold here, [Burn 3]" mills three', () => {
    const after = hold('Shadow Temple', 'When you hold here, [Burn 3].')
    expect(after.player.trash.length).toBeGreaterThanOrEqual(3)
  })

  it('"When you conquer here, discard 1, then draw 1" queues the discard', () => {
    let s = onBf0(startedGame({ firstPlayer: 'player' }), bf('Zaun', 'When you conquer here, discard 1, then draw 1.'))
    s = emit(s, { type: 'CONQUERED', side: 'player', index: 0, excess: 0 })
    expect(s.pendingChoices[0]?.kind).toBe('handCard')
  })

  it('does not fire for the other player / other battlefield', () => {
    let s = onBf0(startedGame({ firstPlayer: 'player' }), bf('Grove', 'When you hold here, draw 1.'))
    const h0 = s.ai.hand.length
    // player holds bf0, AI conquers bf1 — Grove must not draw for the AI
    s = emit(s, { type: 'CONQUERED', side: 'ai', index: 1, excess: 0 })
    expect(s.ai.hand.length).toBe(h0)
  })

  it('a battlefield with no compilable clause yields no triggers', () => {
    expect(battlefieldScript(bf('Forge', 'While you control this battlefield, gear costs 1 less.')).triggers).toHaveLength(0)
  })
})
