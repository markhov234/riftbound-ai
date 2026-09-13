import { describe, expect, it } from 'vitest'
import { GameState } from '../../types/game'
import { _clearCompileCache } from '../abilities/compile'
import { scriptFor } from '../abilities/scripts'
import { keywordValue, lethalMight, showdownMight } from '../keywords'
import { forecastShowdown } from '../combat'
import { grantKeywordThisTurn } from '../abilities/effects'
import { makeCard, placeUnitAt, startedGame } from './fixtures'

_clearCompileCache()

// Shadow Fiend as printed: Might 2, and Assault 3 only while Empowered.
const shadowFiend = makeCard({
  name: 'Shadow Fiend',
  type: 'unit',
  domains: ['fury'],
  energy: 3,
  might: 2,
  keywords: ['Empower', 'Empowered'],
  text: '[Empower] :rb_energy_2::rb_rune_fury: (:rb_energy_2::rb_rune_fury:: Empower me. Use only if not Empowered.)[Empowered][>] I have [Assault 3]. (+3 :rb_might: while I\'m an attacker.)',
})

function withFiend(mut: (u: GameState['player']['base'][number]) => typeof u = (u) => u) {
  let s = startedGame({ firstPlayer: 'player' })
  s = placeUnitAt(s, 'player', shadowFiend, 0)
  s = {
    ...s,
    battlefields: s.battlefields.map((bf, i) =>
      i === 0 ? { ...bf, units: bf.units.map(mut) } : bf,
    ),
  }
  return { s, unit: s.battlefields[0].units[0] }
}

describe('Shadow Fiend: Assault is attack-only and must not double-count', () => {
  it('compiles Assault 3 as an Empowered-only attacker bonus', () => {
    const sc = scriptFor(shadowFiend)
    expect(sc?.empoweredAssault).toBe(3)
    // It must NOT also land in the static keyword list, or it would be added twice.
    expect(sc?.keywords ?? []).not.toContain('Assault 3')
  })

  it('is a plain 2/2 while not Empowered', () => {
    const { s, unit } = withFiend()
    expect(showdownMight(s, unit, 'attacker')).toBe(2)
    expect(showdownMight(s, unit, 'defender')).toBe(2)
    expect(lethalMight(unit, s)).toBe(2)
  })

  it('Empowered: 5 attacking and 5 to kill, 2 defending and 2 to kill', () => {
    const { s, unit } = withFiend((u) => ({ ...u, empowered: true }))
    expect(keywordValue(unit, 'Assault')).toBe(0) // nothing granted — it's innate
    expect(showdownMight(s, unit, 'attacker')).toBe(5)
    expect(showdownMight(s, unit, 'defender')).toBe(2)
    // The crux: Might is attack *and* health, and Assault says "+X Might" with
    // no carve-out — so while attacking it also takes 5 damage to kill.
    expect(lethalMight(unit, s, 'attacker')).toBe(5)
    expect(lethalMight(unit, s, 'defender')).toBe(2)
    // Outside a showdown it has no role, so Assault does not apply.
    expect(lethalMight(unit, s)).toBe(2)
  })

  it('a separately granted Assault stacks on top (glossary: instances add)', () => {
    const { s, unit } = withFiend((u) => ({ ...u, empowered: true }))
    const granted = grantKeywordThisTurn(s, unit.instanceId, 'Assault', 3)
    const u2 = granted.battlefields[0].units[0]
    expect(keywordValue(u2, 'Assault')).toBe(3)
    // 2 base + 3 granted + 3 Empowered = 8 attacking — legitimate stacking,
    // not a double-count of the same source.
    expect(showdownMight(granted, u2, 'attacker')).toBe(8)
    expect(lethalMight(u2, granted, 'attacker')).toBe(8) // …and 8 to kill it
    expect(showdownMight(granted, u2, 'defender')).toBe(2)
    expect(lethalMight(u2, granted, 'defender')).toBe(2)
  })
})

describe('the forecast counts Assault as health too', () => {
  // The reported bug: an 8-Might Shadow Fiend was predicted to die to a 6-Might
  // defender, because the old lethal calculation dropped Assault entirely.
  const vsWall = (wallMight: number, extraAssault: number) => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', shadowFiend, 0)
    s = placeUnitAt(
      s,
      'ai',
      makeCard({ name: 'Wall', type: 'unit', domains: ['fury'], energy: 3, might: wallMight }),
      0,
    )
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? { ...bf, units: bf.units.map((u) => (u.owner === 'player' ? { ...u, empowered: true } : u)) }
          : bf,
      ),
    }
    const fiend = s.battlefields[0].units.find((u) => u.owner === 'player')!
    if (extraAssault) s = grantKeywordThisTurn(s, fiend.instanceId, 'Assault', extraAssault)
    return forecastShowdown(s, 0, 'player')!
  }

  it('an 8-Might attacker survives a 6-Might defender', () => {
    const f = vsWall(6, 3)
    expect(f.attackerMight).toBe(8) // 2 + 3 granted + 3 Empowered
    expect(f.attackerHealth).toBe(8) // …and 8 damage to kill, not 2
    expect(f.defenderMight).toBe(6)
    expect(f.defenderHealth).toBe(6)
    expect(f.attackerLosses).toBe(0) // 6 < 8 — it lives
    expect(f.defenderLosses).toBe(1) // 8 ≥ 6 — the wall dies
    expect(f.outcome).toBe('conquer')
  })

  it('a 5-Might attacker still loses to a 6-Might defender', () => {
    const f = vsWall(6, 0)
    expect(f.attackerMight).toBe(5)
    expect(f.attackerHealth).toBe(5)
    expect(f.attackerLosses).toBe(1) // 6 ≥ 5
    expect(f.defenderLosses).toBe(0) // 5 < 6
    expect(f.outcome).toBe('lose')
  })
})
