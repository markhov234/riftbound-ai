import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { resolveShowdown } from '../combat'
import { createToken, gainXP, killUnit } from '../abilities/effects'
import { emit } from '../events'
import { showdownMight, keywordValue, isMighty, hasTemporary } from '../keywords'
import { beginTurn } from '../phases'
import { setCardPool } from '../state'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

const withText = (kw: string[], extra: Partial<Parameters<typeof makeCard>[0]> = {}) =>
  makeCard({ name: `KW ${kw.join(',')}`, type: 'unit', domains: ['fury'], energy: 2, might: 3, keywords: kw, ...extra })

function inPlay(card: ReturnType<typeof makeCard>) {
  return {
    instanceId: 'k1',
    card,
    owner: 'player' as PlayerSide,
    location: { kind: 'base' as const },
    exhausted: false,
    damage: 0,
    counters: {} as Record<string, number>,
    sick: false,
  }
}

describe('showdownMight keyword rules', () => {
  it('Shield X adds Might only while defending', () => {
    const u = inPlay(withText(['Shield 2']))
    expect(showdownMight({} as GameState, u, 'defender')).toBe(3 + 2)
    expect(showdownMight({} as GameState, u, 'attacker')).toBe(3)
  })

  it('Assault X adds Might only while attacking', () => {
    const u = inPlay(withText(['Assault 3']))
    expect(showdownMight({} as GameState, u, 'attacker')).toBe(3 + 3)
    expect(showdownMight({} as GameState, u, 'defender')).toBe(3)
  })

  it('a Stunned unit contributes 0 Might', () => {
    const u = inPlay(withText(['Stun']))
    expect(showdownMight({} as GameState, u, 'attacker')).toBe(0)
    const u2 = inPlay(withText([]))
    u2.counters.stunned = 1
    expect(showdownMight({} as GameState, u2, 'defender')).toBe(0)
  })

  it('keywordValue sums instances', () => {
    expect(keywordValue(inPlay(withText(['Assault 2', 'Assault 1'])), 'Assault')).toBe(3)
    expect(keywordValue(inPlay(withText(['Deflect'])), 'Deflect')).toBe(1)
  })

  it('isMighty is true at effective Might 5+', () => {
    expect(isMighty(inPlay(withText([], { might: 5 })))).toBe(true)
    const u = inPlay(withText([], { might: 3 }))
    u.counters.mightTurn = 2
    expect(isMighty(u)).toBe(true)
  })
})

describe('Tank / Backline damage order', () => {
  it('a Tank defender dies before a plain one when damage is limited', () => {
    const tank = makeCard({ name: 'Wall', type: 'unit', domains: ['fury'], energy: 2, might: 2, keywords: ['Tank'] })
    const plain = makeCard({ name: 'Softy', type: 'unit', domains: ['fury'], energy: 2, might: 2 })
    let s = startedGame({ firstPlayer: 'player' })
    // AI is the attacker so its damage auto-assigns (the human's would prompt).
    s = placeUnitAt(s, 'ai', makeCard({ name: 'Atk', type: 'unit', domains: ['fury'], energy: 2, might: 2 }), 0)
    s = placeUnitAt(s, 'player', tank, 0)
    s = placeUnitAt(s, 'player', plain, 0)

    const after = resolveShowdown(s, 0, 'ai')
    const defUnits = after.battlefields[0].units.filter((u) => u.owner === 'player')
    // 2 damage → the Tank must eat it → Softy survives.
    expect(defUnits.map((u) => u.card.name)).toEqual(['Softy'])
  })
})

describe('Stun vs lethal damage', () => {
  it('a stunned defender deals 0 but still needs full Might to be killed', () => {
    const weakAtk = makeCard({ name: 'Poker', type: 'unit', domains: ['fury'], energy: 1, might: 1 })
    const defr = makeCard({ name: 'Blockhead', type: 'unit', domains: ['fury'], energy: 2, might: 2 })
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', weakAtk, 0)
    s = placeUnitAt(s, 'ai', defr, 0)
    // Stun the defender.
    s = {
      ...s,
      battlefields: s.battlefields.map((bf) => ({
        ...bf,
        units: bf.units.map((u) =>
          u.card.name === 'Blockhead' ? { ...u, counters: { ...u.counters, stunned: 1 } } : u,
        ),
      })),
    }

    const after = resolveShowdown(s, 0, 'player')
    // 1 attacker damage < 2 lethal Might → the stunned defender survives, attacker unharmed.
    const aiUnits = after.battlefields[0].units.filter((u) => u.owner === 'ai')
    expect(aiUnits.map((u) => u.card.name)).toEqual(['Blockhead'])
  })
})

describe('Temporary', () => {
  it('is killed at the start of its controller\'s turn, before scoring', () => {
    const temp = makeCard({
      name: 'Ghost',
      type: 'unit',
      domains: ['fury'],
      energy: 0,
      might: 1,
      text: '[Temporary] (Kill this at the start of your Beginning Phase.)',
    })
    expect(hasTemporary(inPlay(temp))).toBe(true)

    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', temp, 0) // player controls bf 0
    // simulate returning to the player's turn
    s = beginTurn({ ...s, activePlayer: 'player', turn: 2 })
    expect(s.battlefields[0].units.some((u) => u.card.name === 'Ghost')).toBe(false)
    // no hold point scored from the now-dead Temporary
    expect(s.player.points).toBe(0)
  })
})

describe('tokens', () => {
  it('createToken places a token and killing it adds nothing to trash', () => {
    let s = startedGame({ firstPlayer: 'player' })
    const tok = makeCard({ name: 'Recruit', type: 'unit', supertype: 'token', domains: ['fury'], energy: 0, might: 1 })
    setCardPool([tok])
    s = createToken(s, 'player', 'Recruit', { kind: 'base' })
    expect(s.player.base.map((u) => u.card.name)).toContain('Recruit')

    const trashBefore = s.player.trash.length
    s = killUnit(s, s.player.base[0].instanceId)
    expect(s.player.base).toHaveLength(0)
    expect(s.player.trash.length).toBe(trashBefore)
  })
})

describe('XP / Hunt', () => {
  it('gainXP raises the counter', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = gainXP(s, 'player', 2)
    expect(s.player.xp).toBe(2)
  })

  it('conquering with a Hunt unit grants XP', () => {
    const hunter = makeCard({ name: 'Tracker', type: 'unit', domains: ['fury'], energy: 2, might: 2, keywords: ['Hunt 1'] })
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', hunter, 0) // player now controls bf 0 (open before)
    s = emit(s, { type: 'CONQUERED', side: 'player', index: 0, excess: 0 })
    expect(s.player.xp).toBe(1)
  })
})
