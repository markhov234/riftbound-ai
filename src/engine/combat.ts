import { DamageAssignment, GameState, PlayerSide, UnitInPlay } from '../types/game'
import { killUnit } from './abilities/effects'
import { emit } from './events'
import { damageOrderRank, keywordValue, lethalMight, showdownMight } from './keywords'
import { scoreConquer } from './scoring'
import { appendLog, controllerOf, mapAllUnits, otherSide, unitsAt } from './state'

interface SideOutcome {
  destroyed: string[] // instanceIds
  excess: number
}

/**
 * Auto-assign `pool` damage across `targets`. Tank units must take lethal damage
 * first, Backline last; within each band, cheapest-to-kill first so the most
 * units die.
 */
export function autoAssign(pool: number, targets: UnitInPlay[], state: GameState): SideOutcome {
  const order = [...targets].sort(
    (a, b) =>
      damageOrderRank(a) - damageOrderRank(b) ||
      effHp(a, state) - effHp(b, state) ||
      b.card.might - a.card.might,
  )
  const destroyed: string[] = []
  let remaining = pool
  for (const d of order) {
    const need = effHp(d, state)
    if (remaining >= need) {
      remaining -= need
      destroyed.push(d.instanceId)
    } else if (damageOrderRank(d) === 0) {
      // A Tank must be dealt with before anyone behind it — stop assigning.
      break
    }
  }
  return { destroyed, excess: remaining }
}

/** Health needed to kill this unit — full Might + Shield, regardless of Stun. */
export function effHp(unit: UnitInPlay, _state: GameState): number {
  const shield = keywordValue(unit, 'Shield') + (unit.counters.shield ?? 0)
  return Math.max(1, lethalMight(unit) + shield - unit.damage)
}

/** True when a human should get to choose how `pool` damage lands on `targets`. */
function manualChoice(state: GameState, assigner: PlayerSide, pool: number, targets: UnitInPlay[]): boolean {
  if (assigner !== 'player' || pool <= 0 || targets.length < 2) return false
  const total = targets.reduce((s, u) => s + effHp(u, state), 0)
  return pool < total // if everything dies anyway there's nothing to choose
}

/**
 * Validate a human damage assignment against `pendingDamage`. Returns the
 * destroyed unit ids + leftover pool, or null if the assignment is illegal.
 */
export function validateAssignment(
  state: GameState,
  assignments: DamageAssignment[],
): { destroyed: string[]; excess: number } | null {
  const pd = state.pendingDamage
  if (!pd) return null
  const targets = pd.targetIds
    .map((id) => unitsAt(state.battlefields[pd.index], pd.stage === 'def' ? otherSide(pd.declarer) : pd.declarer).find((u) => u.instanceId === id))
    .filter((u): u is UnitInPlay => !!u)
  const byId = new Map<string, number>()
  for (const a of assignments) byId.set(a.targetInstanceId, (byId.get(a.targetInstanceId) ?? 0) + a.amount)

  let sum = 0
  for (const [id, amount] of byId) {
    if (amount < 0) return null
    if (!pd.targetIds.includes(id)) return null
    sum += amount
  }
  if (sum > pd.pool) return null

  // Tank / Backline order: a rank-R unit can only be assigned once every unit of
  // a lower rank is at ≥ its lethal HP.
  for (const t of targets) {
    if ((byId.get(t.instanceId) ?? 0) <= 0) continue
    const rank = damageOrderRank(t)
    const blocked = targets.some(
      (o) => damageOrderRank(o) < rank && (byId.get(o.instanceId) ?? 0) < effHp(o, state),
    )
    if (blocked) return null
  }

  // Must not hold damage back while lethal targets remain.
  const maxKillable = targets.reduce((s, u) => s + effHp(u, state), 0)
  if (sum < Math.min(pd.pool, maxKillable)) return null

  const destroyed = targets.filter((t) => (byId.get(t.instanceId) ?? 0) >= effHp(t, state)).map((t) => t.instanceId)
  const excess = Math.max(0, pd.pool - destroyed.reduce((s, id) => s + effHp(targets.find((t) => t.instanceId === id)!, state), 0))
  return { destroyed, excess }
}

/** Auto damage assignment as an explicit `DamageAssignment[]` (for the AI). */
export function autoAssignmentList(
  pool: number,
  targets: UnitInPlay[],
  state: GameState,
): DamageAssignment[] {
  const order = [...targets].sort(
    (a, b) => damageOrderRank(a) - damageOrderRank(b) || effHp(a, state) - effHp(b, state) || b.card.might - a.card.might,
  )
  const out: DamageAssignment[] = []
  let remaining = pool
  for (const d of order) {
    const need = effHp(d, state)
    if (remaining >= need) {
      out.push({ targetInstanceId: d.instanceId, amount: need })
      remaining -= need
    } else if (damageOrderRank(d) === 0) {
      if (remaining > 0) out.push({ targetInstanceId: d.instanceId, amount: remaining })
      remaining = 0
      break
    }
  }
  return out
}

/**
 * Resolve a showdown at battlefield `index`, declared by `declarer`.
 * Both sides deal their total Might; when the human assigns their damage across
 * multiple targets, `pendingDamage` pauses combat for the DamageModal.
 */
export function resolveShowdown(
  state: GameState,
  index: number,
  declarer: PlayerSide,
  opts: { forceAuto?: boolean } = {},
): GameState {
  const bf = state.battlefields[index]
  if (!bf) return state
  const defender = otherSide(declarer)

  const attackers = unitsAt(bf, declarer)
  const defenders = unitsAt(bf, defender)
  if (attackers.length === 0 || defenders.length === 0) {
    return appendLog(state, `No showdown at battlefield ${index + 1} — not contested.`)
  }

  const atkMight = attackers.reduce((s, u) => s + showdownMight(state, u, 'attacker'), 0)
  const defMight = defenders.reduce((s, u) => s + showdownMight(state, u, 'defender'), 0)

  const next = appendLog(
    state,
    `Showdown at battlefield ${index + 1}: ${declarer} (${atkMight} might) vs ${defender} (${defMight} might).`,
  )

  // Stage 'def' — the declarer's damage lands on the defender's units.
  if (!opts.forceAuto && manualChoice(next, declarer, atkMight, defenders)) {
    return {
      ...next,
      pendingDamage: {
        index, declarer, stage: 'def', assigningSide: declarer,
        pool: atkMight, otherPool: defMight,
        targetIds: defenders.map((u) => u.instanceId),
        defDestroyed: [], defExcess: 0,
      },
    }
  }
  const def = autoAssign(atkMight, defenders, next)

  // Stage 'atk' — the defender's damage lands on the attacker's units.
  if (!opts.forceAuto && manualChoice(next, defender, defMight, attackers)) {
    return {
      ...next,
      pendingDamage: {
        index, declarer, stage: 'atk', assigningSide: defender,
        pool: defMight, otherPool: atkMight,
        targetIds: attackers.map((u) => u.instanceId),
        defDestroyed: def.destroyed, defExcess: def.excess,
      },
    }
  }
  const atk = autoAssign(defMight, attackers, next)
  return finishShowdown(next, index, declarer, def.destroyed, atk.destroyed, def.excess)
}

/**
 * Resume a showdown after the human confirmed a `pendingDamage` assignment.
 * `stageDestroyed` is what the confirmed assignment killed.
 */
export function resumeShowdownFromAssignment(
  state: GameState,
  stageDestroyed: string[],
  stageExcess: number,
): GameState {
  const pd = state.pendingDamage
  if (!pd) return state
  const cleared: GameState = { ...state, pendingDamage: null }

  if (pd.stage === 'atk') {
    // Human was the defender; the 'def' stage already auto/ran.
    return finishShowdown(cleared, pd.index, pd.declarer, pd.defDestroyed, stageDestroyed, pd.defExcess)
  }
  // pd.stage === 'def' — human was the declarer; now the defender (AI) auto-assigns.
  const attackers = unitsAt(cleared.battlefields[pd.index], pd.declarer)
  const atk = autoAssign(pd.otherPool, attackers, cleared)
  return finishShowdown(cleared, pd.index, pd.declarer, stageDestroyed, atk.destroyed, stageExcess)
}

/** The tail of a showdown once both damage assignments are known. */
function finishShowdown(
  state: GameState,
  index: number,
  declarer: PlayerSide,
  defDestroyed: string[],
  atkDestroyed: string[],
  defExcess: number,
): GameState {
  const defender = otherSide(declarer)
  const before = controllerOf(state.battlefields[index])
  let next = state

  const emitFn = (s: GameState, e: Parameters<typeof emit>[1]) => emit(s, e)
  for (const id of [...defDestroyed, ...atkDestroyed]) {
    next = killUnit(next, id, emitFn, true)
    if (next.winner) return next
  }

  if (defExcess > 0) {
    next = appendLog(next, `${declarer} assigned ${defExcess} excess damage.`)
  }

  const survivorsDeclarer = unitsAt(next.battlefields[index], declarer)
  const survivorsDefender = unitsAt(next.battlefields[index], defender)
  const winner: PlayerSide | null =
    survivorsDeclarer.length > 0 && survivorsDefender.length === 0
      ? declarer
      : survivorsDefender.length > 0 && survivorsDeclarer.length === 0
        ? defender
        : null

  const after = controllerOf(next.battlefields[index])
  next = appendLog(
    next,
    `Battlefield ${index + 1} is now ${
      after === 'open' ? 'open' : after === 'contested' ? 'still contested' : `controlled by ${after}`
    }.`,
  )

  if (winner) {
    // Bump per-turn combat-win counters (for "first time each turn" triggers),
    // then raise the event so those triggers can react.
    const winnerUnits = winner === declarer ? survivorsDeclarer : survivorsDefender
    const winnerIds = winnerUnits.map((u) => u.instanceId)
    next = mapAllUnits(next, (u) =>
      winnerIds.includes(u.instanceId)
        ? {
            ...u,
            counters: {
              ...u.counters,
              combatWinsThisTurn: (u.counters.combatWinsThisTurn ?? 0) + 1,
            },
          }
        : u,
    )
    next = emit(next, {
      type: 'COMBAT_WON',
      side: winner,
      index,
      winnerInstanceIds: winnerIds,
    })
    if (next.winner) return next
  }

  const inconclusive =
    unitsAt(next.battlefields[index], declarer).length > 0 &&
    unitsAt(next.battlefields[index], defender).length > 0

  if (inconclusive) {
    // Both sides survive → the attackers fall back to their base, exhausted.
    next = appendLog(next, `The showdown is inconclusive — ${declarer}'s units fall back to base.`)
    const retreating = unitsAt(next.battlefields[index], declarer).map((u) => ({
      ...u,
      location: { kind: 'base' as const },
      exhausted: true,
      damage: 0,
    }))
    const declarerState = declarer === 'player' ? next.player : next.ai
    next = {
      ...next,
      battlefields: next.battlefields.map((bf) =>
        bf.index === index
          ? { ...bf, units: bf.units.filter((u) => u.owner !== declarer) }
          : bf,
      ),
      [declarer]: { ...declarerState, base: [...declarerState.base, ...retreating] },
    } as GameState
  } else {
    // Exhaust the declarer's surviving units at the battlefield.
    next = mapAllUnits(next, (u) =>
      u.owner === declarer && u.location.kind === 'battlefield' && u.location.index === index
        ? { ...u, exhausted: true }
        : u,
    )
  }

  if (after === declarer && before !== declarer) {
    next = scoreConquer(next, declarer, index)
    if (next.winner) return next
    next = emit(next, { type: 'CONQUERED', side: declarer, index, excess: defExcess })
  }

  // Surviving units heal — combat damage doesn't persist.
  next = mapAllUnits(next, (u) => (u.damage > 0 ? { ...u, damage: 0 } : u))
  return next
}

/** Battlefields where `side` has units and the opponent also has units. */
export function contestedBattlefields(state: GameState, side: PlayerSide): number[] {
  return state.battlefields
    .filter((bf) => unitsAt(bf, side).length > 0 && controllerOf(bf) === 'contested')
    .map((bf) => bf.index)
}

/**
 * End-of-turn safety net: any battlefield `side` still contests without having
 * declared a showdown resolves now, auto-assigned (no prompt, no priority window
 * — the turn is over). Moving in commits you to the fight this turn, per paper.
 */
export function forceContestedShowdowns(state: GameState, side: PlayerSide): GameState {
  let next = state
  for (const index of contestedBattlefields(next, side)) {
    if (next.winner) return next
    next = appendLog(next, `${side} did not declare — battlefield ${index + 1} resolves.`)
    next = resolveShowdown(next, index, side, { forceAuto: true })
  }
  return next
}
