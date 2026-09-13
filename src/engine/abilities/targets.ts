import { Card } from '../../types/card'
import { GameState, GearInPlay, PlayerSide, ResolvedTarget, UnitInPlay } from '../../types/game'
import { allUnits, findUnit } from '../state'

export type TargetKind =
  | 'unit'
  | 'friendlyUnit'
  | 'enemyUnit'
  | 'unitAtBattlefield'
  | 'gear'
  | 'friendlyGear'
  | 'otherGear'
  | 'stackSpell'
  | 'player'
  | 'self'

const GEAR_KINDS = new Set(['gear', 'friendlyGear', 'otherGear'])

/** Gear a `chooser` may pick for `spec` (`otherGear` excludes `source`). */
export function legalGearTargets(
  state: GameState,
  chooser: PlayerSide,
  spec: TargetSpec,
  source?: { instanceId: string },
) {
  let gear = [...state.player.gear, ...state.ai.gear]
  if (spec.kind === 'friendlyGear' || spec.kind === 'otherGear') {
    gear = gear.filter((g) => g.owner === chooser)
  }
  if (spec.kind === 'otherGear' && source) {
    gear = gear.filter((g) => g.instanceId !== source.instanceId)
  }
  if (spec.gearFilter) gear = gear.filter((g) => spec.gearFilter!(g, state))
  return gear
}

export interface TargetSpec {
  kind: TargetKind
  count?: number // default 1
  optional?: boolean
  filter?: (u: UnitInPlay, state: GameState) => boolean
  /** `filter` is unit-shaped, so gear kinds narrow with this instead. */
  gearFilter?: (g: GearInPlay, state: GameState) => boolean
  spellFilter?: (card: Card, state: GameState) => boolean
  /** What picking this target *does* — "to give +2 Might", "to deal 3 damage".
   *  Shown in the targeting prompt so a multi-target spell is unambiguous. */
  label?: string
  /** Colours the highlight: a good thing for the target, or a bad one. */
  intent?: 'buff' | 'harm'
  /**
   * 811.1.d.2's carve-out. A card played from Hidden normally chooses its
   * targets from among options at the battlefield it was hidden at — "unless
   * the ability explicitly restricts targeting in a way that makes this
   * impossible". Tideturner is the rulebook's own example: "a unit you control
   * **at another location**" can never be satisfied at its own battlefield, so
   * it targets freely. Set this on specs whose wording rules that battlefield
   * out; it cannot be inferred, because the exclusion lives in the effect.
   */
  anyLocation?: boolean
}

/** "a friendly unit", "an enemy unit", … — the noun the UI prompts with. */
export function targetKindLabel(kind: TargetKind): string {
  switch (kind) {
    case 'friendlyUnit':
      return 'a friendly unit'
    case 'enemyUnit':
      return 'an enemy unit'
    case 'unitAtBattlefield':
      return 'a unit at a battlefield'
    case 'gear':
      return 'a gear'
    case 'friendlyGear':
    case 'otherGear':
      return 'a friendly gear'
    case 'stackSpell':
      return 'a spell on the stack'
    default:
      return 'a unit'
  }
}

/** All units that `chooser` could legally pick for this spec (before Deflect cost). */
export function legalUnitTargets(
  state: GameState,
  chooser: PlayerSide,
  spec: TargetSpec,
  source?: { instanceId: string },
  /** 811.1.d.2 — played from Hidden, so choices come from this battlefield. */
  atBattlefield?: number,
): UnitInPlay[] {
  let units = allUnits(state)
  switch (spec.kind) {
    case 'friendlyUnit':
      units = units.filter((u) => u.owner === chooser)
      break
    case 'enemyUnit':
      units = units.filter((u) => u.owner !== chooser)
      break
    case 'unitAtBattlefield':
      units = units.filter((u) => u.location.kind === 'battlefield')
      break
    case 'self': {
      const self = source && allUnits(state).find((u) => u.instanceId === source.instanceId)
      return self ? [self] : []
    }
    case 'unit':
    default:
      break
  }
  if (spec.filter) units = units.filter((u) => spec.filter!(u, state))
  // 811.1.d.2 — a card played from Hidden chooses only from that battlefield.
  if (atBattlefield !== undefined && !spec.anyLocation) {
    units = units.filter(
      (u) => u.location.kind === 'battlefield' && u.location.index === atBattlefield,
    )
  }
  return units
}

/** Stack items (spells) that could be chosen for a `stackSpell` spec. */
export function legalStackTargets(state: GameState, spec: TargetSpec) {
  return state.stack.filter(
    (s) => s.kind === 'spell' && s.card && (!spec.spellFilter || spec.spellFilter(s.card, state)),
  )
}

export function specCount(spec: TargetSpec): number {
  return spec.count ?? 1
}

/**
 * Turn UI-selected instance ids / stack id into ResolvedTargets, validating
 * them against the specs. Returns null if the selection is illegal.
 */
export function resolveTargets(
  state: GameState,
  chooser: PlayerSide,
  specs: TargetSpec[] | undefined,
  picked: { instanceIds?: string[]; stackId?: string },
  source?: { instanceId: string },
  /** 811.1.d.2 — played from Hidden, so choices come from this battlefield. */
  atBattlefield?: number,
): ResolvedTarget[] | null {
  if (!specs || specs.length === 0) return []

  const resolved: ResolvedTarget[] = []
  const ids = [...(picked.instanceIds ?? [])]

  for (const spec of specs) {
    if (spec.kind === 'stackSpell') {
      if (!picked.stackId) {
        if (spec.optional) continue
        return null
      }
      const ok = legalStackTargets(state, spec).some((s) => s.id === picked.stackId)
      if (!ok) return null
      resolved.push({ kind: 'stackItem', stackItemId: picked.stackId })
      continue
    }
    if (spec.kind === 'player') {
      resolved.push({ kind: 'player', side: chooser })
      continue
    }

    const need = specCount(spec)
    const isGear = GEAR_KINDS.has(spec.kind)
    const legal: { instanceId: string }[] = isGear
      ? legalGearTargets(state, chooser, spec, source)
      : legalUnitTargets(state, chooser, spec, source, atBattlefield)
    for (let i = 0; i < need; i++) {
      const id = ids.shift()
      if (!id) {
        if (spec.optional) break
        return null
      }
      if (!legal.some((u) => u.instanceId === id)) return null
      resolved.push({ kind: isGear ? 'gear' : 'unit', instanceId: id })
    }
  }
  return resolved
}

/**
 * 811.1.d — "A card cannot be played from Hidden if it is a spell with no valid
 * targets under these restrictions."
 *
 * Only spells: a permanent played from Hidden still enters, and its play effect
 * simply finds nothing to choose. Optional specs never block a play.
 */
export function hasLegalTargetsFrom(
  state: GameState,
  chooser: PlayerSide,
  specs: TargetSpec[] | undefined,
  atBattlefield: number,
): boolean {
  for (const spec of specs ?? []) {
    if (spec.optional) continue
    if (spec.kind === 'player' || spec.kind === 'self' || spec.kind === 'stackSpell') continue
    const legal = GEAR_KINDS.has(spec.kind)
      ? legalGearTargets(state, chooser, spec)
      : legalUnitTargets(state, chooser, spec, undefined, atBattlefield)
    if (legal.length < specCount(spec)) return false
  }
  return true
}

/** Does this spec set need player input, or can it be auto/empty-resolved? */
export function needsChoice(specs: TargetSpec[] | undefined): boolean {
  if (!specs) return false
  return specs.some((s) => s.kind !== 'player' && s.kind !== 'self')
}

export function unitFromTarget(state: GameState, t: ResolvedTarget): UnitInPlay | undefined {
  return t.instanceId ? findUnit(state, t.instanceId) : undefined
}
