import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { bounceUnit, createToken, killUnit } from '../abilities/effects'
import { emit } from '../events'
import { setCardPool } from '../state'
import { POOL, startedGame } from './fixtures'

setCardPool(POOL) // no Token printings in the synthetic pool → everything synthesises

const emitFn = (s: GameState, e: Parameters<typeof emit>[1]) => emit(s, e)
const flat = (s: GameState) => [
  ...s.player.base,
  ...s.ai.base,
  ...s.battlefields.flatMap((b) => b.units),
]

describe('token roster', () => {
  const cases: [string, number, string[]][] = [
    ['Shadow Clone', 0, []],
    ['Recruit', 1, []],
    ['Sprite', 1, []],
    ['Mech', 3, []],
    ['Bird', 1, ['Deflect']],
    ['Sand Soldier', 2, []],
    ['Reflection', 0, []],
    ['Tentacle', 2, []],
  ]

  for (const [name, might, keywords] of cases) {
    it(`createToken('${name}') with no spec → a well-formed token unit`, () => {
      const s = createToken(startedGame(), 'player', name, { kind: 'base' })
      const tok = s.player.base[s.player.base.length - 1]
      expect(tok.card.supertype).toBe('token')
      expect(tok.card.type).toBe('unit')
      expect(tok.card.might).toBe(might)
      for (const kw of keywords) expect(tok.card.keywords).toContain(kw)
    })
  }

  it("Shadow Clone carries its 'banish for Assault 4' text", () => {
    const s = createToken(startedGame(), 'player', 'Shadow Clone', { kind: 'base' })
    expect(s.player.base[s.player.base.length - 1].card.text).toMatch(/banish a unit from your trash/i)
  })

  it('a caller spec still overrides the roster default', () => {
    const s = createToken(startedGame(), 'player', 'Mech', { kind: 'base' }, { might: 9, ready: true })
    const tok = s.player.base[s.player.base.length - 1]
    expect(tok.card.might).toBe(9)
    expect(tok.sick).toBe(false)
  })

  it('Gold is a gear token — it enters play as gear, not a unit', () => {
    const s = createToken(startedGame(), 'player', 'Gold', { kind: 'base' })
    const g = s.player.gear[s.player.gear.length - 1]
    expect(g?.card.name).toBe('Gold')
    expect(g?.card.supertype).toBe('token')
    expect(flat(s).some((u) => u.card.name === 'Gold')).toBe(false)
  })

  it("createToken uses the player's own token pile card when it has one", () => {
    let s = startedGame()
    const pileCard = { ...POOL[0], id: 'pile-recruit', name: 'Recruit', supertype: 'token' as const, type: 'unit' as const, might: 1 }
    s = { ...s, player: { ...s.player, tokenPile: [pileCard] } }
    s = createToken(s, 'player', 'Recruit', { kind: 'base' })
    expect(s.player.base[s.player.base.length - 1].card.id).toBe('pile-recruit')
  })
})

describe('tokens cease to exist off the board', () => {
  function withToken(side: PlayerSide = 'player'): { s: GameState; id: string } {
    const s = createToken(startedGame(), side, 'Recruit', { kind: 'base' })
    const base = side === 'player' ? s.player.base : s.ai.base
    return { s, id: base[base.length - 1].instanceId }
  }

  it('killUnit removes it entirely — never to the trash', () => {
    const { s, id } = withToken()
    const after = killUnit(s, id, emitFn)
    expect(flat(after).some((u) => u.instanceId === id)).toBe(false)
    expect(after.player.trash.some((c) => c.name === 'Recruit')).toBe(false)
  })

  it('bounceUnit removes it entirely — never to the hand', () => {
    const { s, id } = withToken()
    const after = bounceUnit(s, id)
    expect(flat(after).some((u) => u.instanceId === id)).toBe(false)
    expect(after.player.hand.some((c) => c.name === 'Recruit')).toBe(false)
  })
})
