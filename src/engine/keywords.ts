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

/**
 * The printed X for a keyword, read out of the card's rules text. The card data's
 * `keywords` array only carries bare names (`["Shield","Tank"]`) — the magnitude
 * lives in the text as `[Shield 2]`. Only called for keywords the card actually
 * has, so a *granted* `[Assault 4]` elsewhere in the text can't leak in.
 */
function printedKeywordValue(card: { text: string }, name: string): number {
  const m = card.text.match(new RegExp(`\\[${name}\\s+(\\d+)\\]`, 'i'))
  return m ? parseInt(m[1], 10) : 0
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
      // Explicit "Shield 2" in the array wins; otherwise take the printed X, else 1.
      total += m[2] ? parseInt(m[2], 10) : printedKeywordValue(unit.card, target) || 1
    }
  }
  // Granted magnitudes: `kw:` this turn, `gkw:` from attached Equipment.
  total += unit.counters[`kw:${name}`] ?? 0
  total += unit.counters[`gkw:${name}`] ?? 0
  return total
}

/** One line of a Might calculation: where the number came from. */
export interface MightTerm {
  /** i18n key under `might.*` naming the source. */
  key: string
  /** Interpolation for that key (e.g. the keyword's X). */
  vars?: Record<string, string | number>
  n: number
}

/**
 * Every term that makes up a unit's Might in `role`, in the order a player reads
 * them. `roleMight` is literally the sum of these, so the explanation the UI
 * shows and the number the engine fights with cannot disagree — the same
 * discipline that keeps `showdownMight` and `lethalMight` in step.
 */
export function mightBreakdown(
  state: GameState | undefined,
  unit: UnitInPlay,
  role: CombatRole | null,
): MightTerm[] {
  const sc = scriptFor(unit.card)
  const out: MightTerm[] = [{ key: 'might.printed', n: Math.max(0, unit.card.might) }]

  const perm = unit.counters.mightPerm ?? 0
  if (perm) out.push({ key: 'might.permanent', n: perm })
  const turn = unit.counters.mightTurn ?? 0
  if (turn) out.push({ key: 'might.thisTurn', n: turn })

  if (unit.empowered && (sc?.empoweredMight ?? 0) !== 0) {
    out.push({ key: 'might.empowered', n: sc!.empoweredMight! })
  }

  if (role === 'attacker') {
    const assault = keywordValue(unit, 'Assault')
    if (assault) out.push({ key: 'might.assault', vars: { n: assault }, n: assault })
    if (unit.empowered && (sc?.empoweredAssault ?? 0) !== 0) {
      out.push({ key: 'might.assaultEmpowered', n: sc!.empoweredAssault! })
    }
    if (/\[assault\] equal to the number of gear/i.test(unit.card.text)) {
      const gear = state?.[unit.owner]?.gear?.length ?? 0
      if (gear) out.push({ key: 'might.assaultPerGear', vars: { n: gear }, n: gear })
    }
  }
  if (role === 'defender') {
    const shield = keywordValue(unit, 'Shield') + (unit.counters.shield ?? 0)
    if (shield) out.push({ key: 'might.shield', vars: { n: shield }, n: shield })
  }

  if (state) {
    const aura = battlefieldAura(state, unit, role ?? undefined).might
    if (aura) {
      const name =
        unit.location.kind === 'battlefield'
          ? state.battlefields[unit.location.index]?.name
          : undefined
      out.push({ key: 'might.battlefield', vars: { name: name ?? '' }, n: aura })
    }
  }
  return out
}

/**
 * A unit's Might in a given combat role. `role: null` means "no combat role",
 * which is how a unit sits outside a showdown.
 *
 * There is exactly one Might number per role: Might is *both* a unit's attack
 * power and its health, so Assault/Shield raise how hard the unit hits and how
 * much damage it takes to kill, together. `showdownMight` and `lethalMight` are
 * two readings of this same value, and must never diverge.
 */
function roleMight(
  state: GameState | undefined,
  unit: UnitInPlay,
  role: CombatRole | null,
): number {
  return mightBreakdown(state, unit, role).reduce((n, t) => n + t.n, 0)
}

/**
 * The Might a unit *contributes* to its side's damage pool in a showdown.
 * A stunned unit contributes 0 — but see `lethalMight`: it still takes its full
 * Might in damage to kill.
 */
export function showdownMight(
  state: GameState,
  unit: UnitInPlay,
  role: CombatRole = 'attacker',
): number {
  // Stunned is a *status* (423.1.a), never a keyword — and `card.keywords` is
  // scraped from bracket tokens in the rules text, so a card that *inflicts*
  // `[Stun]` (Vex - Apathetic) would otherwise read as permanently stunned
  // itself and contribute 0 Might in every combat.
  if ((unit.counters.stunned ?? 0) > 0) return 0
  return Math.max(0, roleMight(state, unit, role))
}

/**
 * The combat designation a unit currently holds (459.2.b). Units gain it when a
 * showdown opens at their battlefield and keep it until combat ends (461.7.a),
 * so a Reaction spell cast mid-showdown sees an attacker's Assault Might. Null
 * whenever no showdown is live at that battlefield.
 */
export function combatRoleOf(state: GameState, unit: UnitInPlay): CombatRole | null {
  const live = state.pendingShowdown ?? state.pendingDamage
  if (!live) return null
  if (unit.location.kind !== 'battlefield' || unit.location.index !== live.index) return null
  return unit.owner === live.declarer ? 'attacker' : 'defender'
}

/**
 * The damage needed to kill this unit: lethal damage is damage ≥ its Might, and
 * Might IS health in Riftbound — so this is simply its Might *in the role it is
 * currently in*, no separate health stat.
 *
 * That makes the role argument load-bearing. `[Assault 3]` reads "while I am an
 * attacker, I have +3 Might", with no carve-out for damage, so an attacking
 * 2-Might unit with Assault 3 both hits for 5 and needs 5 damage to die. Shield
 * is the mirror image while defending. Pass `null`/omit outside a showdown,
 * where the unit has neither role.
 *
 * Unlike `showdownMight` this ignores Stun — a stunned unit deals nothing but
 * still needs its full Might in damage to die.
 */
export function lethalMight(
  unit: UnitInPlay,
  state?: GameState,
  role: CombatRole | null = null,
): number {
  return Math.max(1, roleMight(state, unit, role))
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

/**
 * Mighty — rule 708/710: a unit on the board is Mighty while its **current**
 * Might is 5 or greater, so a defender's Shield or an attacker's Assault counts
 * (432.1: "Since Shield applies, its current Might is 6"). Pass the role it is
 * in; outside combat it has none.
 */
export function isMighty(
  unit: UnitInPlay,
  state?: GameState,
  role: CombatRole | null = null,
): boolean {
  return roleMight(state, unit, role) >= 5
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
