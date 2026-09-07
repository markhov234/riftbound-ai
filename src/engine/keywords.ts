import { GameState, PlayerSide, UnitInPlay } from '../types/game'
import { battlefieldAura } from './abilities/battlefields'
import { scriptFor } from './abilities/scripts'

export type CombatRole = 'attacker' | 'defender'

function keywordsOf(unit: UnitInPlay): string[] {
  const fromCard = unit.card.keywords
  const fromScript = scriptFor(unit.card)?.keywords ?? []
  // `kw:` = granted this turn, `gkw:` = granted by attached Equipment (persistent).
  const granted = Object.keys(unit.counters)
    .filter((k) => k.startsWith('kw:') || k.startsWith('gkw:'))
    .map((k) => k.replace(/^g?kw:/, ''))
  return [...fromCard, ...fromScript, ...granted]
}

export function unitHasKeyword(unit: UnitInPlay, keyword: string): boolean {
  const kw = keyword.toLowerCase()
  return keywordsOf(unit).some((k) => k.toLowerCase().replace(/\s+\d+$/, '') === kw)
}

/** The X in `[Name X]` — summed across every instance (card keyword + granted counter). */
export function keywordValue(unit: UnitInPlay, name: string): number {
  const target = name.toLowerCase()
  // A bare `[Assault]` whose value is "equal to the number of gear" is dynamic —
  // it contributes via `showdownMight`, not a flat 1 here.
  const dynamicAssault =
    target === 'assault' && /\[assault\] equal to/i.test(unit.card.text)
  let total = 0
  for (const k of [...unit.card.keywords, ...(scriptFor(unit.card)?.keywords ?? [])]) {
    const m = k.toLowerCase().match(/^([a-z-]+)(?:\s+(\d+))?$/)
    if (m && m[1] === target) {
      if (dynamicAssault && !m[2]) continue
      total += m[2] ? parseInt(m[2], 10) : 1
    }
  }
  // Granted magnitudes: `kw:` this turn, `gkw:` from attached Equipment.
  total += unit.counters[`kw:${name}`] ?? 0
  total += unit.counters[`gkw:${name}`] ?? 0
  return total
}

/**
 * A unit's effective Might in a showdown: printed Might ± any "this turn"
 * modifier, plus role-dependent keyword bonuses. A stunned unit contributes 0.
 */
export function showdownMight(
  state: GameState,
  unit: UnitInPlay,
  role: CombatRole = 'attacker',
): number {
  if (unitHasKeyword(unit, 'Stun') || (unit.counters.stunned ?? 0) > 0) return 0

  let might = baseWithMods(unit)
  if (role === 'attacker') might += keywordValue(unit, 'Assault')
  if (role === 'defender') {
    // Shield X keyword, plus a persistent +might from protective gear approximations.
    might += keywordValue(unit, 'Shield') + (unit.counters.shield ?? 0)
  }
  // `[Empowered][>] I have +N [M]` / `[Assault N]` while the unit is Empowered.
  if (unit.empowered) {
    const sc = scriptFor(unit.card)
    might += sc?.empoweredMight ?? 0
    if (role === 'attacker') might += sc?.empoweredAssault ?? 0
  }
  // "I have [Assault] equal to the number of gear you control." (Repair Specialist)
  if (role === 'attacker' && /\[assault\] equal to the number of gear/i.test(unit.card.text)) {
    might += state?.[unit.owner]?.gear?.length ?? 0
  }
  // Battlefield aura — "Units here have +N Might" (Trifarian War Camp, Kinkou Temple).
  if (state) might += battlefieldAura(state, unit).might
  return Math.max(0, might)
}

/** Printed Might plus permanent + this-turn modifiers (no role bonuses, no Stun). */
function baseWithMods(unit: UnitInPlay): number {
  return (
    Math.max(0, unit.card.might) +
    (unit.counters.mightPerm ?? 0) +
    (unit.counters.mightTurn ?? 0)
  )
}

/**
 * The damage needed to kill this unit. Unlike `showdownMight` this ignores Stun —
 * a stunned unit "still must be dealt damage equal to its full Might to be killed".
 */
export function lethalMight(unit: UnitInPlay): number {
  return Math.max(1, baseWithMods(unit))
}

/**
 * The `+N` the UI shows on the left of a unit — permanent + this-turn Might
 * mods, plus the flat `[Empowered][>] I have +N [M]` bonus while Empowered.
 */
export function mightBonus(unit: UnitInPlay): number {
  let n = (unit.counters.mightPerm ?? 0) + (unit.counters.mightTurn ?? 0)
  if (unit.empowered) n += scriptFor(unit.card)?.empoweredMight ?? 0
  return n
}

/** Buffed — carries a buff counter (the `[Buff]` game action). */
export function isBuffed(unit: UnitInPlay): boolean {
  return (unit.counters.buffed ?? 0) > 0
}

/** Mighty — effective Might 5 or greater. */
export function isMighty(unit: UnitInPlay): number | boolean {
  return baseWithMods(unit) >= 5
}

/** Kept as a hook — no keyword currently lets a unit act the turn it enters
 *  (Accelerate is handled at play time; Ganking only affects movement). */
export function canActWhenSick(_state: GameState, _unit: UnitInPlay): boolean {
  return false
}

export function hasGanking(unit: UnitInPlay, state?: GameState): boolean {
  if (unitHasKeyword(unit, 'Ganking')) return true
  // A battlefield may grant Ganking to every unit on it (Windswept Hillock).
  return !!state && battlefieldAura(state, unit).grantsGanking
}

/** Deflect X — an opponent pays X more Power to choose this unit (default 1). */
export function deflectSurcharge(unit: UnitInPlay, chooser: PlayerSide): number {
  if (unit.owner === chooser) return 0
  return unitHasKeyword(unit, 'Deflect') ? Math.max(1, keywordValue(unit, 'Deflect')) : 0
}

// ── Damage-assignment order (Tank first, Backline last) ──────────────────

export function damageOrderRank(unit: UnitInPlay): number {
  if (unitHasKeyword(unit, 'Tank')) return 0
  if (unitHasKeyword(unit, 'Backline')) return 2
  return 1
}

export function hasTemporary(unit: UnitInPlay): boolean {
  return unitHasKeyword(unit, 'Temporary') || /\[Temporary\]/i.test(unit.card.text)
}
