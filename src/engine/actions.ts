import { Card, Domain } from '../types/card'
import {
  DamageAssignment,
  GameAction,
  GameState,
  GearInPlay,
  MAX_MULLIGAN,
  PlayerSide,
  UnitInPlay,
  UnitLocation,
} from '../types/game'
import { resumeShowdownFromAssignment, validateAssignment } from './combat'
import { legendAbilities, scriptFor } from './abilities/scripts'
import { resolveTargets, TargetSpec } from './abilities/targets'
import { discard, recycleFromTrash } from './abilities/effects'
import { SpellTiming } from './abilities/types'
import { canActWhenSick, deflectSurcharge, hasGanking } from './keywords'
import { actedThisPriority, beginTurn, endTurn } from './phases'
import { emit } from './events'
import {
  makeAbilityItem,
  makeSpellItem,
  passPriority,
  pushToStack,
} from './stack'
import { channelRune, canAfford, Cost, costOf, payCost, recycleRune } from './runes'
import { scoreConquer } from './scoring'
import {
  appendLog,
  controllerOf,
  findGear,
  findUnit,
  getPlayer,
  newInstanceId,
  otherSide,
  samePrinting,
  unitsAt,
  updateBattlefield,
  updatePlayer,
} from './state'

// ── Legality ──────────────────────────────────────────────────────────────

export function withinIdentity(card: Card, identity: string[]): boolean {
  return card.domains.every((d) => d === 'colorless' || identity.includes(d))
}

/** "You may pay X" options offered when a unit is played. */
export interface UnitPlayOption {
  id: 'accelerate' | 'additional'
  label: string
  extraEnergy: number
  extraDiscard: number
  /** `:rb_rune_<domain>:` pips in the additional cost — each exhausts a channeled
   *  rune (matching the domain when possible; 'colorless' = any). */
  extraRunes: Domain[]
}

/** Pull `:rb_energy_N:` + `:rb_rune_<d>:` pips out of a cost fragment. */
function parsePips(fragment: string): { energy: number; runes: Domain[] } {
  const e = fragment.match(/:rb_energy_(\d+):/)
  const runes = (fragment.match(/:rb_rune_([a-z]+):/g) ?? []).map((tok) => {
    const d = tok.replace(/^:rb_rune_|:$/g, '')
    return (d === 'rainbow' ? 'colorless' : d) as Domain
  })
  return { energy: e ? parseInt(e[1], 10) : 0, runes }
}

function pipLabel(energy: number, runes: Domain[], discard = 0): string {
  const bits: string[] = []
  if (energy) bits.push(`+${energy}⚡`)
  for (const r of runes) bits.push(r === 'colorless' ? '✦' : r.slice(0, 3).toUpperCase())
  if (discard) bits.push(`discard ${discard}`)
  return bits.join(', ')
}

export function unitPlayOptions(card: Card): UnitPlayOption[] {
  const out: UnitPlayOption[] = []
  if (card.keywords.some((k) => k.toLowerCase() === 'accelerate')) {
    // The reminder text spells out the real cost, e.g.
    //   [Accelerate] (You may pay :rb_energy_1::rb_rune_fury: as an additional
    //    cost to have me enter ready.)
    const reminder = card.text.match(/\[accelerate\][^(]*\(([^)]*)\)/i)?.[1] ?? ''
    const { energy, runes } = parsePips(reminder)
    // Older data with no reminder: fall back to the historical +1 energy.
    const e = reminder ? energy : 1
    out.push({
      id: 'accelerate',
      label: `Accelerate (${pipLabel(e, runes) || '+0⚡'}): enter ready`,
      extraEnergy: e,
      extraDiscard: 0,
      extraRunes: runes,
    })
  }
  // An optional "additional cost to play" — either phrasing order:
  //   "You may pay X / discard N as an additional cost to play me."
  //   "As an additional cost to play this, you may pay X / discard N."
  const t = card.text.toLowerCase()
  const cost = String.raw`((?::rb_energy_\d+:|:rb_rune_[a-z]+:)+)|discard\s+(\d+|a card)`
  const addl =
    t.match(new RegExp(`you may (?:pay )?(?:${cost}) as an additional cost to play`)) ??
    t.match(new RegExp(`as an additional cost to play (?:this|me),?\\s*you may (?:pay )?(?:${cost})`))
  if (addl) {
    const { energy, runes } = addl[1] ? parsePips(addl[1]) : { energy: 0, runes: [] as Domain[] }
    const d = addl[2] ? (/\d/.test(addl[2]) ? parseInt(addl[2], 10) : 1) : 0
    out.push({
      id: 'additional',
      label: `Pay additional (${pipLabel(energy, runes, d)})`,
      extraEnergy: energy,
      extraDiscard: d,
      extraRunes: runes,
    })
  }
  return out
}

export interface PlayCheck {
  ok: boolean
  reason?: string
}

export function spellTiming(card: Card): SpellTiming {
  const script = scriptFor(card)
  if (script?.play?.timing) return script.play.timing
  const kw = card.keywords.map((k) => k.toLowerCase())
  if (kw.includes('reaction')) return 'reaction'
  if (kw.includes('action') || kw.includes('hidden')) return 'action'
  return 'sorcery'
}

function timingAllows(state: GameState, side: PlayerSide, timing: SpellTiming): boolean {
  if (state.priority !== side) return false
  if (timing === 'reaction') return true
  if (timing === 'action') {
    return (
      (side === state.activePlayer && state.phase === 'action') || state.pendingShowdown !== null
    )
  }
  // sorcery
  return (
    side === state.activePlayer &&
    state.phase === 'action' &&
    state.stack.length === 0 &&
    state.pendingShowdown === null
  )
}

function baseCastCheck(state: GameState, side: PlayerSide, card: Card): PlayCheck {
  if (state.winner) return { ok: false, reason: 'game over' }
  if (!getPlayer(state, side).hand.includes(card)) {
    return { ok: false, reason: 'card not in hand' }
  }
  if (!withinIdentity(card, getPlayer(state, side).identity)) {
    return { ok: false, reason: 'outside your domain identity' }
  }
  if (!canAfford(state, side, costOf(card))) {
    return { ok: false, reason: 'not enough energy/power' }
  }
  return { ok: true }
}

/** Can `side` play `card` from hand right now? Units use sorcery timing. */
export function canPlay(state: GameState, side: PlayerSide, card: Card): PlayCheck {
  if (card.type === 'legend' || card.type === 'rune' || card.type === 'battlefield') {
    return { ok: false, reason: `cannot play a ${card.type} from hand` }
  }
  const base = baseCastCheck(state, side, card)
  if (!base.ok) return base

  const timing = card.type === 'unit' ? 'sorcery' : spellTiming(card)
  if (!timingAllows(state, side, timing)) {
    return { ok: false, reason: `can't play a ${timing}-timed card now` }
  }
  return { ok: true }
}

export function canMove(
  state: GameState,
  side: PlayerSide,
  instanceId: string,
  to?: UnitLocation,
): PlayCheck {
  if (state.priority !== side || state.stack.length > 0) {
    return { ok: false, reason: 'not your priority' }
  }
  if (side !== state.activePlayer) return { ok: false, reason: 'not your turn' }
  if (state.pendingShowdown) return { ok: false, reason: 'a showdown is being resolved' }
  const unit = findUnit(state, instanceId)
  if (!unit || unit.owner !== side) return { ok: false, reason: 'not your unit' }
  if (unit.exhausted) return { ok: false, reason: 'unit is exhausted' }
  if (unit.sick && !canActWhenSick(state, unit)) {
    return { ok: false, reason: 'unit has summoning sickness' }
  }
  // Battlefield → battlefield needs Ganking; base ↔ battlefield is always fine.
  if (to && to.kind === 'battlefield' && unit.location.kind === 'battlefield' && !hasGanking(unit, state)) {
    return { ok: false, reason: 'needs Ganking to move between battlefields' }
  }
  return { ok: true }
}

/** Units enter at your Base; a battlefield only if you already hold units there,
 *  or the card explicitly lets you (e.g. "play me to an open battlefield"). */
export function canPlaceUnitAt(
  state: GameState,
  side: PlayerSide,
  card: Card,
  to: UnitLocation,
): PlayCheck {
  if (to.kind === 'base') return { ok: true }
  const bf = state.battlefields[to.index]
  if (!bf) return { ok: false, reason: 'no such battlefield' }
  const haveUnitsThere = bf.units.some((u) => u.owner === side)
  if (haveUnitsThere) return { ok: true }
  const openBfClause = /play me to an open battlefield/i.test(card.text)
  if (openBfClause && bf.units.length === 0) return { ok: true }
  return { ok: false, reason: 'units enter at your base' }
}

// ── Play a unit (resolves immediately, not via the stack) ──────────────────

function removeFirst<T>(arr: T[], item: T): T[] {
  const i = arr.indexOf(item)
  if (i < 0) return arr
  return [...arr.slice(0, i), ...arr.slice(i + 1)]
}

function locLabel(to: UnitLocation): string {
  return to.kind === 'base' ? ' to base' : ` to battlefield ${to.index + 1}`
}

function playUnit(
  state: GameState,
  side: PlayerSide,
  card: Card,
  to: UnitLocation,
  paidAccelerate: boolean,
  paidAdditional = false,
): GameState {
  const check = canPlay(state, side, card)
  if (!check.ok) return appendLog(state, `Can't play ${card.name}: ${check.reason}.`)

  // Only units (incl. champions) go on the board. A spell must resolve and be
  // trashed via the stack; gear enters its own zone via `castCard`.
  if (card.type !== 'unit') {
    return appendLog(state, `Can't play ${card.name}: only units can enter the board.`)
  }

  const placement = canPlaceUnitAt(state, side, card, to)
  if (!placement.ok) return appendLog(state, `Can't play ${card.name} there: ${placement.reason}.`)

  const opts = unitPlayOptions(card)
  const accelOpt = paidAccelerate ? opts.find((o) => o.id === 'accelerate') : undefined
  const accelerate = !!accelOpt
  // "I enter ready if you have a card with my name in your trash."
  const enterReady =
    accelerate ||
    (/enter ready if you have a card with my name in your trash/i.test(card.text) &&
      getPlayer(state, side).trash.some((c) => c.name === card.name))
  const addlOpt = paidAdditional ? opts.find((o) => o.id === 'additional') : undefined
  const extra = (accelOpt?.extraEnergy ?? 0) + (addlOpt?.extraEnergy ?? 0)
  const extraRunes = [...(accelOpt?.extraRunes ?? []), ...(addlOpt?.extraRunes ?? [])]
  const needDiscard = addlOpt?.extraDiscard ?? 0
  if (needDiscard > getPlayer(state, side).hand.filter((c) => c !== card).length) {
    return appendLog(state, `Can't play ${card.name}: nothing to discard for the additional cost.`)
  }
  const base = costOf(card)
  const unitCost: Cost = {
    energy: card.energy + extra,
    power: base.power,
    runes: [...(base.runes ?? []), ...extraRunes],
  }
  if (!canAfford(state, side, unitCost)) {
    return appendLog(state, `Can't play ${card.name}: not enough energy/runes for the extra cost.`)
  }

  let next = payCost(state, side, unitCost)

  const unit: UnitInPlay = {
    instanceId: newInstanceId(),
    card,
    owner: side,
    location: to,
    // Units enter Exhausted (can't act until your next Awaken) unless Accelerated
    // or a card-specific "enter ready" clause applies.
    exhausted: !enterReady,
    damage: 0,
    counters: addlOpt ? { paidExtra: 1 } : {},
    sick: !enterReady,
  }
  next = updatePlayer(next, side, (ps) => ({
    ...ps,
    hand: removeFirst(ps.hand, card),
    championPlayed: ps.championPlayed || samePrinting(card, ps.chosenChampion),
  }))
  if (needDiscard > 0) {
    next = discard(next, side, needDiscard, (s, e) => emit(s, e))
  }

  if (to.kind === 'base') {
    next = updatePlayer(next, side, (ps) => ({ ...ps, base: [...ps.base, unit] }))
  } else {
    const before = controllerOf(next.battlefields[to.index])
    next = updateBattlefield(next, to.index, (bf) => ({ ...bf, units: [...bf.units, unit] }))
    const after = controllerOf(next.battlefields[to.index])
    if (after === side && before === 'open') {
      next = scoreConquer(next, side, to.index)
      next = emit(next, { type: 'CONQUERED', side, index: to.index, excess: 0 })
    }
  }
  next = appendLog(next, `${side} plays ${card.name}${locLabel(to)}.`)

  next = registerCardPlayed(next, side, card)
  next = emit(next, { type: 'UNIT_ENTERED', instanceId: unit.instanceId, controller: side })
  return actedThisPriority(next)
}

function registerCardPlayed(state: GameState, side: PlayerSide, card: Card): GameState {
  const nth =
    side === state.activePlayer ? state.cardsPlayedThisTurn + 1 : state.cardsPlayedThisTurn
  const next =
    side === state.activePlayer ? { ...state, cardsPlayedThisTurn: nth } : state
  return emit(next, { type: 'CARD_PLAYED', card, controller: side, nth })
}

// ── Cast a spell / gear (goes on the stack) ────────────────────────────────

function castCard(
  state: GameState,
  side: PlayerSide,
  card: Card,
  targetInstanceIds: string[],
  targetStackId?: string,
  paidAdditional = false,
): GameState {
  const check = canPlay(state, side, card)
  if (!check.ok) return appendLog(state, `Can't play ${card.name}: ${check.reason}.`)

  const specs: TargetSpec[] | undefined = scriptFor(card)?.play?.targets
  const targets = resolveTargets(
    state,
    side,
    specs,
    { instanceIds: targetInstanceIds, stackId: targetStackId },
  )
  if (targets === null) return appendLog(state, `Can't play ${card.name}: invalid targets.`)

  // Optional "additional cost to play" (Ruthless Strike, …).
  const addl = paidAdditional ? unitPlayOptions(card).find((o) => o.id === 'additional') : undefined
  if (addl && addl.extraDiscard > getPlayer(state, side).hand.filter((c) => c !== card).length) {
    return appendLog(state, `Can't play ${card.name}: nothing to discard for the additional cost.`)
  }

  const surcharge = deflectCost(state, side, targets)
  const base = costOf(card)
  const cost: Cost = {
    energy: base.energy + (addl?.extraEnergy ?? 0),
    power: surcharge,
    runes: [...(base.runes ?? []), ...(addl?.extraRunes ?? [])],
  }
  if (!canAfford(state, side, cost)) {
    return appendLog(state, `Can't play ${card.name}: not enough energy/power/runes.`)
  }

  let next = payCost(state, side, cost)
  if (surcharge > 0) next = appendLog(next, `${side} pays +${surcharge} Power (Deflect).`)
  next = updatePlayer(next, side, (ps) => ({ ...ps, hand: removeFirst(ps.hand, card) }))
  if (addl && addl.extraDiscard > 0) {
    next = discard(next, side, addl.extraDiscard, (s, e) => emit(s, e))
    next = appendLog(next, `${side} pays the additional cost for ${card.name}.`)
  }
  next = appendLog(next, `${side} plays ${card.name}.`)
  next = registerCardPlayed(next, side, card)
  next = pushToStack(next, {
    ...makeSpellItem(side, card, targets),
    paidAdditional: !!addl,
  })
  return next
}

/** Extra Power `side` must pay to choose the given targets (Deflect X on enemy units). */
function deflectCost(
  state: GameState,
  side: PlayerSide,
  targets: { kind: string; instanceId?: string }[],
): number {
  let total = 0
  for (const t of targets) {
    if (t.kind !== 'unit' || !t.instanceId) continue
    const u = findUnit(state, t.instanceId)
    if (u) total += deflectSurcharge(u, side)
  }
  return total
}

/**
 * The Flow cost of a card, or null if it can't be Flow-cast.
 * Printed: `[Flow] :rb_energy_N::rb_rune_*:…`. Granted (Kennen): the card's own cost.
 */
export function flowCost(card: Card, grantedIds: string[] = []): Cost | null {
  const m = card.text.match(/\[Flow\]\s*(?::rb_energy_(\d+):)?((?::rb_rune_[a-z]+:)*)/i)
  if (m) {
    const runes = (m[2].match(/:rb_rune_([a-z]+):/g) ?? []).map((t) => {
      const d = t.replace(/^:rb_rune_|:$/g, '')
      return (d === 'rainbow' ? 'colorless' : d) as NonNullable<Cost['runes']>[number]
    })
    return { energy: m[1] ? parseInt(m[1], 10) : 0, power: 0, runes }
  }
  if (grantedIds.includes(card.id)) return costOf(card)
  return null
}

/**
 * Flow — play a spell from your trash for its Flow cost, then banish it.
 * Timing is the spell's normal timing.
 */
export function castFlow(
  state: GameState,
  side: PlayerSide,
  card: Card,
  targetInstanceIds: string[] = [],
  targetStackId?: string,
): GameState {
  const cost = flowCost(card, state.flowGranted)
  if (cost === null) return appendLog(state, `${card.name} has no Flow.`)
  const ps = getPlayer(state, side)
  if (!ps.trash.some((c) => c.id === card.id)) {
    return appendLog(state, `${card.name} is not in your trash.`)
  }
  if (!timingAllows(state, side, spellTiming(card))) {
    return appendLog(state, `Can't Flow-cast ${card.name} now.`)
  }
  if (!canAfford(state, side, cost)) {
    return appendLog(state, `Not enough resources for Flow.`)
  }
  const specs = scriptFor(card)?.play?.targets
  const targets = resolveTargets(state, side, specs, {
    instanceIds: targetInstanceIds,
    stackId: targetStackId,
  })
  if (targets === null) return appendLog(state, `Invalid targets for ${card.name}.`)

  let next = payCost(state, side, cost)
  next = updatePlayer(next, side, (p) => ({
    ...p,
    trash: p.trash.filter((c) => c.id !== card.id),
  }))
  next = { ...next, flowGranted: next.flowGranted.filter((id) => id !== card.id) }
  next = appendLog(next, `${side} plays ${card.name} from the trash (Flow).`)
  next = registerCardPlayed(next, side, card)
  next = pushToStack(next, makeSpellItem(side, card, targets, true))
  return next
}

// ── Activated abilities ───────────────────────────────────────────────────

function activateAbility(
  state: GameState,
  side: PlayerSide,
  instanceId: string,
  abilityIndex: number,
  targetInstanceIds: string[],
): GameState {
  if (state.priority !== side) return appendLog(state, `Can't activate now.`)

  const isLegend = instanceId === 'legend:player' || instanceId === 'legend:ai'
  const unit = isLegend ? undefined : findUnit(state, instanceId)
  const gear = isLegend || unit ? undefined : findGear(state, instanceId)
  const source = unit ?? gear
  const sourceCard = isLegend ? getPlayer(state, side).legend : source?.card
  if (!isLegend && !source) return appendLog(state, `No such source.`)
  if (source && source.owner !== side) return appendLog(state, `Not yours.`)
  if (!sourceCard) return appendLog(state, `No such source.`)

  const ability = isLegend
    ? legendAbilities(sourceCard)[abilityIndex]
    : scriptFor(sourceCard)?.activated?.[abilityIndex]
  if (!ability) return appendLog(state, `${sourceCard.name} has no such ability.`)

  // Guarded abilities (e.g. Empower — "use only if not already Empowered") are
  // hard-blocked here so no cost is wasted.
  if (ability.when && !ability.when(state, source, side)) {
    return appendLog(state, `${sourceCard.name}: ${ability.label} can't be used now.`)
  }

  const { cost } = ability
  const legendEmp = getPlayer(state, side).legendEmpowered ?? false
  if (cost.exhaustSelf && (isLegend ? getPlayer(state, side).legendExhausted : source!.exhausted)) {
    return appendLog(state, `${sourceCard.name} is exhausted.`)
  }
  if (cost.disempowerSelf && !(isLegend ? legendEmp : source?.empowered)) {
    return appendLog(state, `${sourceCard.name} is not Empowered.`)
  }
  const payCost_: Cost = { energy: cost.energy ?? 0, power: 0, runes: cost.runes }
  if ((cost.energy || cost.runes?.length) && !canAfford(state, side, payCost_)) {
    return appendLog(state, `Not enough resources.`)
  }
  if (cost.recycleFromTrash && getPlayer(state, side).trash.length < cost.recycleFromTrash) {
    return appendLog(state, `Not enough cards in the trash.`)
  }
  if (cost.discard && getPlayer(state, side).hand.length < cost.discard) {
    return appendLog(state, `Not enough cards to discard.`)
  }

  let next = state
  if (cost.energy || cost.runes?.length) next = payCost(next, side, payCost_)
  if (cost.recycleFromTrash) next = recycleFromTrash(next, side, cost.recycleFromTrash)
  if (cost.discard) next = discard(next, side, cost.discard, (s, e) => emit(s, e))
  if (cost.exhaustSelf) {
    next = isLegend
      ? updatePlayer(next, side, (ps) => ({ ...ps, legendExhausted: true }))
      : unit
        ? updateUnit(next, instanceId, (u) => ({ ...u, exhausted: true }))
        : updateGear(next, instanceId, (g) => ({ ...g, exhausted: true }))
  }
  if (cost.disempowerSelf) {
    next = isLegend
      ? updatePlayer(next, side, (ps) => ({ ...ps, legendEmpowered: false }))
      : unit
        ? updateUnit(next, instanceId, (u) => ({ ...u, empowered: false }))
        : updateGear(next, instanceId, (g) => ({ ...g, empowered: false }))
  }

  const targets = resolveTargets(next, side, ability.targets, { instanceIds: targetInstanceIds }, source)
  if (targets === null) return appendLog(state, `Invalid targets for ${sourceCard.name}.`)

  const surcharge = deflectCost(next, side, targets)
  if (surcharge > 0) {
    if (!canAfford(next, side, { energy: 0, power: surcharge })) {
      return appendLog(state, `Not enough Power for Deflect (+${surcharge}).`)
    }
    next = payCost(next, side, { energy: 0, power: surcharge })
    next = appendLog(next, `${side} pays +${surcharge} Power (Deflect).`)
  }

  next = pushToStack(
    next,
    makeAbilityItem(side, instanceId, sourceCard.name, abilityIndex, targets),
  )
  return next
}

function updateUnit(
  state: GameState,
  instanceId: string,
  fn: (u: UnitInPlay) => UnitInPlay,
): GameState {
  const map = (u: UnitInPlay) => (u.instanceId === instanceId ? fn(u) : u)
  return {
    ...state,
    player: { ...state.player, base: state.player.base.map(map) },
    ai: { ...state.ai, base: state.ai.base.map(map) },
    battlefields: state.battlefields.map((bf) => ({ ...bf, units: bf.units.map(map) })),
  }
}

function updateGear(
  state: GameState,
  instanceId: string,
  fn: (g: GearInPlay) => GearInPlay,
): GameState {
  const map = (g: GearInPlay) => (g.instanceId === instanceId ? fn(g) : g)
  return {
    ...state,
    player: { ...state.player, gear: state.player.gear.map(map) },
    ai: { ...state.ai, gear: state.ai.gear.map(map) },
  }
}

// ── Move ──────────────────────────────────────────────────────────────────

function moveUnit(
  state: GameState,
  side: PlayerSide,
  instanceId: string,
  to: UnitLocation,
): GameState {
  const check = canMove(state, side, instanceId, to)
  if (!check.ok) return appendLog(state, `Can't move: ${check.reason}.`)
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  const from = unit.location

  let next = removeUnitEverywhere(state, instanceId)
  // Moving exhausts the unit (unless it's the free retreat home — still exhaust for simplicity).
  const moved: UnitInPlay = { ...unit, location: to, exhausted: true }

  if (to.kind === 'base') {
    next = updatePlayer(next, side, (ps) => ({ ...ps, base: [...ps.base, moved] }))
    next = appendLog(next, `${side} moves ${unit.card.name} to base.`)
    next = emit(next, { type: 'UNIT_MOVED', instanceId, controller: side, from, to })
    return actedThisPriority(next)
  }

  next = updateBattlefield(next, to.index, (bf) => ({ ...bf, units: [...bf.units, moved] }))
  const enemies = unitsAt(next.battlefields[to.index], otherSide(side))

  if (enemies.length > 0) {
    // Moving in with an opponent present contests the battlefield but does NOT
    // fight yet — the mover keeps priority and may move more units in, then
    // DECLARE_SHOWDOWN when ready (or the fight is forced at end of turn).
    next = appendLog(
      next,
      `${side} moves ${unit.card.name} to battlefield ${to.index + 1} — contested. Declare a showdown to fight.`,
    )
    next = emit(next, { type: 'UNIT_MOVED', instanceId, controller: side, from, to })
    if (next.winner) return next
    return actedThisPriority(next)
  }

  // Uncontested move-in — take the battlefield if it was open.
  const before = controllerOf(state.battlefields[to.index])
  const after = controllerOf(next.battlefields[to.index])
  if (after === side && before !== side) {
    next = scoreConquer(next, side, to.index)
    if (next.winner) return next
    next = emit(next, { type: 'CONQUERED', side, index: to.index, excess: 0 })
  }
  next = appendLog(next, `${side} moves ${unit.card.name} to battlefield ${to.index + 1}.`)
  next = emit(next, { type: 'UNIT_MOVED', instanceId, controller: side, from, to })
  return actedThisPriority(next)
}

function removeUnitEverywhere(state: GameState, instanceId: string): GameState {
  return {
    ...state,
    player: { ...state.player, base: state.player.base.filter((u) => u.instanceId !== instanceId) },
    ai: { ...state.ai, base: state.ai.base.filter((u) => u.instanceId !== instanceId) },
    battlefields: state.battlefields.map((bf) => ({
      ...bf,
      units: bf.units.filter((u) => u.instanceId !== instanceId),
    })),
  }
}

// ── Showdown (opens a priority window, resolves after both pass) ───────────

function declareShowdown(state: GameState, side: PlayerSide, index: number): GameState {
  if (state.priority !== side || side !== state.activePlayer || state.phase !== 'action') {
    return appendLog(state, `Can't declare a showdown now.`)
  }
  if (state.stack.length > 0 || state.pendingShowdown) {
    return appendLog(state, `Resolve the stack first.`)
  }
  const bf = state.battlefields[index]
  if (!bf) return state
  if (unitsAt(bf, side).length === 0 || unitsAt(bf, otherSide(side)).length === 0) {
    return appendLog(state, `Battlefield ${index + 1} is not contested.`)
  }
  let next = appendLog(state, `${side} declares a showdown at battlefield ${index + 1}.`)
  next = emit(next, { type: 'DEFENDED', side: otherSide(side), index })
  if (next.winner) return next
  return {
    ...next,
    pendingShowdown: { index, declarer: side },
    priority: otherSide(side),
    passesInARow: 0,
  }
}

// ── Manual combat damage assignment ──────────────────────────────────────

function assignDamage(
  state: GameState,
  side: PlayerSide,
  assignments: DamageAssignment[],
): GameState {
  const pd = state.pendingDamage
  if (!pd) return appendLog(state, `No damage to assign.`)
  if (pd.assigningSide !== side) return state

  const result = validateAssignment(state, assignments)
  if (!result) return appendLog(state, `That damage assignment isn't legal.`)

  const next = resumeShowdownFromAssignment(state, result.destroyed, result.excess)
  if (next.winner) return next
  // A second manual stage can't arise (only one human), but stay safe.
  if (next.pendingDamage) {
    return { ...next, priority: next.pendingDamage.assigningSide, passesInARow: 0 }
  }
  return { ...next, priority: next.activePlayer, passesInARow: 0 }
}

// ── Mulligan / game start ─────────────────────────────────────────────────

function doMulligan(state: GameState, side: PlayerSide, indices: number[]): GameState {
  const uniq = [...new Set(indices)].filter((i) => i >= 0).slice(0, MAX_MULLIGAN)
  let next = updatePlayer(state, side, (ps) => {
    if (ps.mulliganDone) return ps
    const toBottom = uniq.map((i) => ps.hand[i]).filter(Boolean)
    const kept = ps.hand.filter((_, i) => !uniq.includes(i))
    const deck = [...ps.mainDeck, ...toBottom]
    const drawn = deck.slice(0, toBottom.length)
    return {
      ...ps,
      hand: [...kept, ...drawn],
      mainDeck: deck.slice(toBottom.length),
      mulliganDone: true,
    }
  })
  next = appendLog(
    next,
    uniq.length > 0 ? `${side} mulligans ${uniq.length} card(s).` : `${side} keeps their hand.`,
  )
  return maybeStart(next)
}

function keepHand(state: GameState, side: PlayerSide): GameState {
  const next = appendLog(
    updatePlayer(state, side, (ps) => ({ ...ps, mulliganDone: true })),
    `${side} keeps their hand.`,
  )
  return maybeStart(next)
}

function maybeStart(state: GameState): GameState {
  if (state.phase !== 'mulligan') return state
  if (!state.player.mulliganDone || !state.ai.mulliganDone) return state
  return beginTurn({ ...state, phase: 'awaken' })
}

// ── Interactive choices ──────────────────────────────────────────────────

function resolveChoice(state: GameState, side: PlayerSide, pickedIds: string[]): GameState {
  const choice = state.pendingChoices[0]
  if (!choice || choice.controller !== side) return state

  const picks = [...new Set(pickedIds)].filter((id) => choice.legalIds.includes(id))
  if (picks.length < choice.min && choice.legalIds.length >= choice.min) {
    return appendLog(state, `Pick at least ${choice.min} for "${choice.label}".`)
  }
  const limited = picks.slice(0, choice.max)

  let next: GameState = { ...state, pendingChoices: state.pendingChoices.slice(1) }
  next = choice.resolve(limited)(next)
  return next
}

// ── Dispatch ──────────────────────────────────────────────────────────────

/** Apply an action taken by `actor` (defaults to whoever has priority). */
export function dispatch(
  state: GameState,
  action: GameAction,
  actor?: PlayerSide,
): GameState {
  if (state.winner) return state
  const side = actor ?? state.priority

  // A pending choice for `side` blocks their other actions.
  const pending = state.pendingChoices[0]
  if (pending && pending.controller === side && action.type !== 'RESOLVE_CHOICE') {
    return state
  }

  // A pending damage assignment for `side` blocks their other actions.
  if (
    state.pendingDamage &&
    state.pendingDamage.assigningSide === side &&
    action.type !== 'ASSIGN_DAMAGE'
  ) {
    return state
  }

  switch (action.type) {
    case 'RESOLVE_CHOICE':
      return resolveChoice(state, side, action.pickedIds)
    case 'MULLIGAN':
      return doMulligan(state, side, action.cardIndices)
    case 'KEEP_HAND':
      return keepHand(state, side)
    case 'CHANNEL_RUNE':
      return state.priority === side && state.stack.length === 0
        ? actedThisPriority(channelRune(state, side))
        : state
    case 'RECYCLE_RUNE':
      return state.priority === side && state.stack.length === 0
        ? actedThisPriority(recycleRune(state, side))
        : state
    case 'PLAY_UNIT':
      return playUnit(
        state,
        side,
        action.card,
        action.to,
        action.paidAccelerate ?? false,
        action.paidAdditional ?? false,
      )
    case 'PLAY_SPELL':
      return castCard(
        state,
        side,
        action.card,
        action.targetInstanceIds ?? [],
        action.targetStackId,
        action.paidAdditional ?? false,
      )
    case 'PLAY_GEAR':
      return castCard(state, side, action.card, action.targetInstanceIds ?? [])
    case 'CAST_FLOW':
      return castFlow(
        state,
        side,
        action.card,
        action.targetInstanceIds ?? [],
        action.targetStackId,
      )
    case 'ACTIVATE_ABILITY':
      return activateAbility(
        state,
        side,
        action.instanceId,
        action.abilityIndex,
        action.targetInstanceIds ?? [],
      )
    case 'MOVE_UNIT':
      return moveUnit(state, side, action.instanceId, action.to)
    case 'DECLARE_SHOWDOWN':
      return declareShowdown(state, side, action.index)
    case 'ASSIGN_DAMAGE':
      return assignDamage(state, side, action.assignments)
    case 'PASS':
    case 'PASS_PRIORITY':
      return passPriority(state)
    case 'END_TURN':
      return side === state.activePlayer &&
        state.stack.length === 0 &&
        !state.pendingShowdown
        ? endTurn(state)
        : passPriority(state)
    default:
      return state
  }
}
