import { DamageAssignment, GameState, PlayerSide, UnitInPlay } from '../types/game'
import { killUnit } from './abilities/effects'
import { emit } from './events'
import { clearOrphanedFacedown } from './hidden'
import { CombatRole, damageOrderRank, lethalMight, showdownMight } from './keywords'
import { scoreConquer } from './scoring'
import { appendLog, controllerOf, mapAllUnits, otherSide, unitsAt } from './state'

interface SideOutcome {
  destroyed: string[] // instanceIds
  excess: number
}

/**
 * Auto-assign `pool` damage across `targets`, per rule 460.2.c:
 *  - c.3 a unit must be assigned *lethal* damage in full before any damage goes
 *    to a different unit;
 *  - c.4 no unit may be assigned more than the minimum lethal amount while any
 *    other unit is still unassigned — so leftovers become excess only once
 *    everything is dead;
 *  - c.5 Tank must be lethal first and Backline last (`damageOrderRank`).
 * Within a band we kill the cheapest first, so the pool destroys the most units.
 * The whole pool is always assigned: what can't kill anything is dumped on the
 * first legal survivor rather than silently vanishing.
 */
export function autoAssign(
  pool: number,
  targets: UnitInPlay[],
  state: GameState,
  role: CombatRole,
): SideOutcome {
  const list = autoAssignmentList(pool, targets, state, role)
  const byId = new Map(list.map((a) => [a.targetInstanceId, a.amount]))
  const destroyed = targets
    .filter((t) => (byId.get(t.instanceId) ?? 0) >= effHp(t, state, role))
    .map((t) => t.instanceId)
  const spentKilling = destroyed.reduce(
    (n, id) => n + effHp(targets.find((t) => t.instanceId === id)!, state, role),
    0,
  )
  // Rule 460.2.c.4 only permits over-assignment once no unit is left to take
  // damage — so excess exists only when the whole side is dead. A sub-lethal
  // dump on a survivor was still assigned damage, not excess.
  const wipe = destroyed.length === targets.length
  return { destroyed, excess: wipe ? Math.max(0, pool - spentKilling) : 0 }
}

/**
 * Damage still needed to kill this unit — its Might in `role` (Empowered boost,
 * battlefield aura, and the role's Assault/Shield all included), minus damage
 * already marked on it. `role` matters: an attacker keeps its Assault Might
 * while the defenders' damage is assigned to it.
 */
export function effHp(unit: UnitInPlay, state?: GameState, role: CombatRole | null = null): number {
  return Math.max(1, lethalMight(unit, state, role) - unit.damage)
}

/** True when a human should get to choose how `pool` damage lands on `targets`. */
function manualChoice(
  state: GameState,
  assigner: PlayerSide,
  pool: number,
  targets: UnitInPlay[],
  role: CombatRole,
): boolean {
  if (assigner !== 'player' || pool <= 0 || targets.length < 2) return false
  const total = targets.reduce((s, u) => s + effHp(u, state, role), 0)
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
  // Stage 'def' assigns onto the defending units, stage 'atk' onto the attackers.
  const role: CombatRole = pd.stage === 'def' ? 'defender' : 'attacker'
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
      (o) => damageOrderRank(o) < rank && (byId.get(o.instanceId) ?? 0) < effHp(o, state, role),
    )
    if (blocked) return null
  }

  // Must not hold damage back while lethal targets remain.
  const maxKillable = targets.reduce((s, u) => s + effHp(u, state, role), 0)
  if (sum < Math.min(pd.pool, maxKillable)) return null

  const destroyed = targets.filter((t) => (byId.get(t.instanceId) ?? 0) >= effHp(t, state, role)).map((t) => t.instanceId)

  // 460.2.c.4 — a unit may only be given more than the minimum lethal amount
  // once no other unit is left to take damage, i.e. the side is already wiped.
  const wipe = destroyed.length === targets.length
  if (!wipe) {
    for (const t of targets) {
      if ((byId.get(t.instanceId) ?? 0) > effHp(t, state, role)) return null
    }
  }

  const excess = wipe
    ? Math.max(0, pd.pool - targets.reduce((s, u) => s + effHp(u, state, role), 0))
    : 0
  return { destroyed, excess }
}

/**
 * The single damage-assignment algorithm, as an explicit `DamageAssignment[]`.
 * `autoAssign` summarises this rather than repeating the logic, so the preview,
 * the AI and the resolver can never disagree about who dies.
 */
export function autoAssignmentList(
  pool: number,
  targets: UnitInPlay[],
  state: GameState,
  role: CombatRole,
): DamageAssignment[] {
  const order = [...targets].sort(
    (a, b) =>
      damageOrderRank(a) - damageOrderRank(b) ||
      effHp(a, state, role) - effHp(b, state, role) ||
      b.card.might - a.card.might,
  )
  const out: DamageAssignment[] = []
  let remaining = pool
  let stalledOn: UnitInPlay | null = null
  for (const d of order) {
    const need = effHp(d, state, role)
    if (remaining >= need) {
      out.push({ targetInstanceId: d.instanceId, amount: need })
      remaining -= need
      continue
    }
    // Not enough left to kill this one. Everyone behind it is a *later* legal
    // target than it is (Tank before normal before Backline, and inside a band
    // the list is cheapest-first), so nothing further can be killed either.
    stalledOn = d
    break
  }
  // The whole pool must be assigned (460.2.c). Anything left goes onto the first
  // unit we couldn't kill; if they all died, it piles onto the last kill as
  // excess, which is the only case 460.2.c.4 allows over-assignment.
  if (remaining > 0) {
    const dump = stalledOn?.instanceId ?? out[out.length - 1]?.targetInstanceId
    if (dump) {
      const existing = out.find((a) => a.targetInstanceId === dump)
      if (existing) existing.amount += remaining
      else out.push({ targetInstanceId: dump, amount: remaining })
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
  if (!opts.forceAuto && manualChoice(next, declarer, atkMight, defenders, 'defender')) {
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
  const def = autoAssign(atkMight, defenders, next, 'defender')

  // Stage 'atk' — the defender's damage lands on the attacker's units.
  if (!opts.forceAuto && manualChoice(next, defender, defMight, attackers, 'attacker')) {
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
  const atk = autoAssign(defMight, attackers, next, 'attacker')
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
  const atk = autoAssign(pd.otherPool, attackers, cleared, 'attacker')
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

  // Snapshot both sides *before* anyone dies so the UI can explain the fight.
  const preAttackers = unitsAt(state.battlefields[index], declarer)
  const preDefenders = unitsAt(state.battlefields[index], defender)
  const roster = (units: UnitInPlay[], role: 'attacker' | 'defender', dead: string[]) =>
    units.map((u) => ({
      name: u.card.name,
      card: u.card,
      might: showdownMight(state, u, role),
      died: dead.includes(u.instanceId),
    }))

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
  const bfName = next.battlefields[index]?.name ?? `battlefield ${index + 1}`
  // Showdown damage is simultaneous, so the side with more Might can still lose
  // all its units. Spell it out.
  const takes = after === winner && before !== winner
  const summary = winner
    ? `${winner} destroyed all of ${otherSide(winner)}'s units — ${winner} ${
        takes ? 'takes' : 'holds'
      } ${bfName}.`
    : after === 'open'
      ? `both sides were wiped out — ${bfName} is now open (no one scores).`
      : `neither side was cleared — ${declarer}'s units fall back to base.`
  next = appendLog(next, `Showdown result: ${summary}`)

  // Full report for the post-combat panel.
  next = {
    ...next,
    lastShowdown: {
      seq: (state.lastShowdown?.seq ?? 0) + 1,
      index,
      battlefieldName: bfName,
      declarer,
      attackerMight: preAttackers.reduce((n, u) => n + showdownMight(state, u, 'attacker'), 0),
      defenderMight: preDefenders.reduce((n, u) => n + showdownMight(state, u, 'defender'), 0),
      attackers: roster(preAttackers, 'attacker', atkDestroyed),
      defenders: roster(preDefenders, 'defender', defDestroyed),
      winner,
      outcome: winner ? (takes ? 'conquered' : 'held') : after === 'open' ? 'wipeout' : 'inconclusive',
      summary,
    },
  }

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
    // 461.1.a.2 recalls the attackers, and 453.1 says a Recall leaves the
    // unit's state alone — so keep its exhausted status rather than forcing it
    // (a unit readied mid-combat stays ready). Damage is already gone: the
    // combat cleanup heals everything first (461.1.a.1).
    const retreating = unitsAt(next.battlefields[index], declarer).map((u) => ({
      ...u,
      location: { kind: 'base' as const },
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
  // 461.5.c — control was just established, so any hidden card belonging to
  // someone who no longer controls this battlefield is removed.
  return clearOrphanedFacedown(next)
}

export interface ShowdownForecast {
  attackerMight: number
  defenderMight: number
  /**
   * Total damage needed to wipe each side. Usually equal to that side's Might —
   * Might is health — but it diverges when units already carry damage or are
   * stunned (a stunned unit contributes 0 Might yet still soaks its full Might),
   * so the preview shows both rather than implying they always match.
   */
  attackerHealth: number
  defenderHealth: number
  attackerCount: number
  defenderCount: number
  /** Units each side would lose if it resolved right now (auto-assignment). */
  attackerLosses: number
  defenderLosses: number
  outcome: 'conquer' | 'lose' | 'wipeout' | 'stalemate'
}

/**
 * A pre-fight projection for the "should I declare?" decision: both sides'
 * effective Might and how the damage would land. Uses auto-assignment, so a
 * manual split can differ — it's a preview, not a promise.
 */
export function forecastShowdown(
  state: GameState,
  index: number,
  declarer: PlayerSide,
): ShowdownForecast | null {
  const bf = state.battlefields[index]
  if (!bf) return null
  const attackers = unitsAt(bf, declarer)
  const defenders = unitsAt(bf, otherSide(declarer))
  if (attackers.length === 0 || defenders.length === 0) return null

  const attackerMight = attackers.reduce((n, u) => n + showdownMight(state, u, 'attacker'), 0)
  const defenderMight = defenders.reduce((n, u) => n + showdownMight(state, u, 'defender'), 0)
  const defLost = autoAssign(attackerMight, defenders, state, 'defender').destroyed.length
  const atkLost = autoAssign(defenderMight, attackers, state, 'attacker').destroyed.length
  const atkLeft = attackers.length - atkLost
  const defLeft = defenders.length - defLost

  return {
    attackerMight,
    defenderMight,
    attackerHealth: attackers.reduce((n, u) => n + effHp(u, state, 'attacker'), 0),
    defenderHealth: defenders.reduce((n, u) => n + effHp(u, state, 'defender'), 0),
    attackerCount: attackers.length,
    defenderCount: defenders.length,
    attackerLosses: atkLost,
    defenderLosses: defLost,
    outcome:
      atkLeft > 0 && defLeft === 0
        ? 'conquer'
        : defLeft > 0 && atkLeft === 0
          ? 'lose'
          : atkLeft === 0 && defLeft === 0
            ? 'wipeout'
            : 'stalemate',
  }
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
