import { Card } from '../../types/card'
// Cyclic import, used only inside a function body (resolved by call time).
import { combatRoleOf, lethalMight } from '../keywords'
// Cyclic import, used only inside a function body (resolved by call time).
import { scriptFor } from './scripts'
import { canAfford, Cost, payCost } from '../runes'
import {
  EngineEvent,
  GameState,
  PendingChoice,
  PlayerSide,
  ResolvedTarget,
  UnitInPlay,
  UnitLocation,
} from '../../types/game'
import {
  allGear,
  allUnits,
  appendLog,
  controllerOf,
  findGear,
  findTokenCardByName,
  findUnit,
  getPlayer,
  mapAllGear,
  mapAllUnits,
  newChoiceId,
  newInstanceId,
  otherSide,
  removeGear,
  removeUnit,
  updateBattlefield,
  updatePlayer,
} from '../state'
import { GearInPlay } from '../../types/game'
import { checkVictory } from '../scoring'

/** Callback the caller injects so deep mutations can raise triggered abilities. */
export type Emit = (s: GameState, e: EngineEvent) => GameState

export interface EffectCtx {
  state: GameState
  controller: PlayerSide
  /** The ability's own permanent — a unit for triggers, a unit or gear for activated abilities. */
  source?: UnitInPlay | GearInPlay
  targets: ResolvedTarget[]
  /** Ids the controller picked for a `choose` prompt (unit instanceIds or card ids). */
  picks?: string[]
  /** The caster paid this spell's optional "additional cost" (Ruthless Strike). */
  paidAdditional?: boolean
  /** The event that fired this trigger, for abilities that need its subject. */
  event?: EngineEvent
  /** True when this permanent/spell was played from its Facedown Zone (811). */
  fromFacedown?: boolean
  /** For a battlefield's own trigger: which battlefield "here" refers to. */
  battlefieldIndex?: number
  emit: Emit
}

export type Effect = (ctx: EffectCtx) => GameState

// ── target helpers ────────────────────────────────────────────────────────

export function targetUnit(ctx: EffectCtx, i = 0): UnitInPlay | undefined {
  const t = ctx.targets[i]
  return t?.instanceId ? findUnit(ctx.state, t.instanceId) : undefined
}

export function targetUnitIn(state: GameState, targets: ResolvedTarget[], i = 0) {
  const t = targets[i]
  return t?.instanceId ? findUnit(state, t.instanceId) : undefined
}

// ── card movement primitives ─────────────────────────────────────────────

export function draw(state: GameState, side: PlayerSide, n: number): GameState {
  let removedToken = false
  const next = updatePlayer(state, side, (ps) => {
    // Safety net: a token must never be drawn (it should never be in a deck).
    const deck = ps.mainDeck.filter((c) => {
      if (c.supertype === 'token' || c.type === 'token') {
        removedToken = true
        return false
      }
      return true
    })
    const drawn = deck.slice(0, n)
    return { ...ps, hand: [...ps.hand, ...drawn], mainDeck: deck.slice(n) }
  })
  const logged = removedToken
    ? appendLog(next, `(a token was removed from ${side}'s deck)`)
    : next
  return appendLog(logged, `${side} draws ${n}.`)
}

export function discard(
  state: GameState,
  side: PlayerSide,
  n: number,
  emit?: Emit,
): GameState {
  let next = state
  for (let i = 0; i < n; i++) {
    const ps = next.player.side === side ? next.player : next.ai
    if (ps.hand.length === 0) break
    const card = ps.hand[ps.hand.length - 1]
    next = updatePlayer(next, side, (p) => ({
      ...p,
      hand: p.hand.slice(0, -1),
      trash: [...p.trash, card],
    }))
    next = appendLog(next, `${side} discards ${card.name}.`)
    if (emit) next = emit(next, { type: 'CARD_DISCARDED', card, owner: side })
  }
  return next
}

export function recycleFromTrash(state: GameState, side: PlayerSide, n: number): GameState {
  return updatePlayer(state, side, (ps) => {
    const kept = ps.trash.slice(0, Math.max(0, ps.trash.length - n))
    const recycled = ps.trash.slice(Math.max(0, ps.trash.length - n))
    return { ...ps, trash: kept, mainDeck: [...ps.mainDeck, ...recycled] }
  })
}

/** Look at the top `n`, keep `keep` (best by energy) in hand, recycle the rest. */
export function digTopN(
  state: GameState,
  side: PlayerSide,
  n: number,
  keep: number,
): GameState {
  return updatePlayer(state, side, (ps) => {
    const top = ps.mainDeck.slice(0, n)
    const rest = ps.mainDeck.slice(n)
    const ranked = [...top].sort((a, b) => b.energy - a.energy)
    const kept = ranked.slice(0, keep)
    const recycled = ranked.slice(keep)
    return {
      ...ps,
      hand: [...ps.hand, ...kept],
      mainDeck: [...rest, ...recycled],
    }
  })
}

/**
 * Interactive dig (Stacked Deck): the human sees the top `n` face-up and picks
 * `keep` to put into hand; the rest recycle to the bottom. The AI auto-keeps the
 * highest-energy card(s).
 */
export function digChoice(
  state: GameState,
  side: PlayerSide,
  n: number,
  keep = 1,
): GameState {
  const top = getPlayer(state, side).mainDeck.slice(0, n)
  if (top.length === 0) return appendLog(state, `${side} has no cards to look at.`)
  if (side === 'ai' || top.length <= keep) return digTopN(state, side, n, keep)

  const apply = (s: GameState, kept: string[]): GameState =>
    updatePlayer(s, side, (ps) => {
      const seen = ps.mainDeck.slice(0, n)
      const rest = ps.mainDeck.slice(n)
      const chosen = seen.filter((c) => kept.includes(c.id)).slice(0, keep)
      const chosenIds = new Set(chosen.map((c) => c.id))
      // Fallback: if the player somehow picked nothing, keep the first.
      const finalKeep = chosen.length ? chosen : seen.slice(0, keep)
      const finalIds = chosen.length ? chosenIds : new Set(finalKeep.map((c) => c.id))
      const recycled = seen.filter((c) => !finalIds.has(c.id))
      return {
        ...ps,
        hand: [...ps.hand, ...finalKeep],
        mainDeck: [...rest, ...recycled],
      }
    })

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label: `Look at the top ${n} — put ${keep} into your hand (the rest recycle)`,
    kind: 'deckTop',
    min: keep,
    max: keep,
    legalIds: top.map((c) => c.id),
    resolve: (picked) => (s) => appendLog(apply(s, picked), `${side} takes a card to hand (Stacked Deck).`),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/**
 * Interactive move (Twilight Step, Fight or Flight, …). A spell-move can send the
 * unit to any base or battlefield — the human picks; the AI sends its own unit
 * to a battlefield (aggressive) or an enemy unit home (retreat).
 */
export function moveChoice(
  state: GameState,
  side: PlayerSide,
  unitId: string,
  emit?: Emit,
  then: (s: GameState) => GameState = (s) => s,
): GameState {
  const unit = findUnit(state, unitId)
  if (!unit) return then(state)

  const dests: { token: string; label: string; to: UnitLocation }[] = [
    {
      token: 'base',
      label: `To ${unit.owner === side ? 'your' : "the enemy's"} base`,
      to: { kind: 'base' },
    },
  ]
  state.battlefields.forEach((bf, i) => {
    if (unit.location.kind === 'battlefield' && unit.location.index === i) return
    dests.push({ token: `bf:${i}`, label: `To ${bf.name}`, to: { kind: 'battlefield', index: i } })
  })

  const apply = (token: string) => (s: GameState): GameState => {
    const d = dests.find((x) => x.token === token) ?? dests[0]
    return then(moveUnitEffect(s, unitId, d.to, { by: side }, emit))
  }

  if (side === 'ai' || dests.length === 1) {
    const pick =
      unit.owner === side
        ? dests.find((d) => d.token.startsWith('bf:')) ?? dests[0]
        : dests[0] // send an enemy unit home
    return apply(pick.token)(state)
  }

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    kind: 'location',
    label: `Move ${unit.card.name} — choose a destination`,
    min: 1,
    max: 1,
    legalIds: dests.map((d) => d.token),
    optionLabels: dests.map((d) => d.label),
    resolve: (picked) => (s) => apply(picked[0] ?? 'base')(s),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/** "⚡2, ✦1" — a cost written out for a prompt. */
export function describeCost(cost: Cost): string {
  const bits: string[] = []
  if (cost.energy > 0) bits.push(`⚡${cost.energy}`)
  const pips = cost.runes?.length ?? 0
  if (pips > 0) bits.push(`${pips} rune${pips > 1 ? 's' : ''}`)
  if (cost.power > 0) bits.push(`✦${cost.power}`)
  return bits.join(' + ') || 'nothing'
}

/**
 * "You may pay <cost> to <effect>" on a trigger. The human gets a skippable
 * yes/no prompt (the whole point — the ability is optional and costs resources);
 * the AI pays whenever it can afford to. Unaffordable → the ability just passes.
 */
export function optionalPayChoice(
  state: GameState,
  side: PlayerSide,
  cost: Cost,
  label: string,
  then: (s: GameState) => GameState,
): GameState {
  if (!canAfford(state, side, cost)) {
    return appendLog(state, `${side} can't pay ${describeCost(cost)} — skipped.`)
  }
  if (side === 'ai') return then(payCost(state, side, cost))

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    kind: 'confirm',
    label,
    min: 0, // "you may" — skippable
    max: 1,
    legalIds: ['pay'],
    optionLabels: [`Pay ${describeCost(cost)}`],
    resolve: (picked) => (s) =>
      picked.length ? then(payCost(s, side, cost)) : appendLog(s, `${side} declines.`),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/**
 * A bare "you may …" — a yes/no with no cost attached. The AI always says yes,
 * which is right for every card that currently uses this (each is pure upside).
 */
export function confirmChoice(
  state: GameState,
  side: PlayerSide,
  label: string,
  then: (s: GameState) => GameState,
): GameState {
  if (side === 'ai') return then(state)
  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    kind: 'confirm',
    label,
    min: 0, // "you may" — skippable
    max: 1,
    legalIds: ['yes'],
    optionLabels: ['Yes'],
    resolve: (picked) => (s) => (picked.length ? then(s) : appendLog(s, `${side} declines.`)),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/**
 * "Choose a unit" from an explicit id list.
 *
 * Battlefield triggers get their `targets` auto-picked by the event system, so
 * a card that genuinely asks the player to choose has to raise its own prompt.
 */
export function pickUnitChoice(
  state: GameState,
  side: PlayerSide,
  legalIds: string[],
  label: string,
  then: (s: GameState, instanceId: string) => GameState,
): GameState {
  if (legalIds.length === 0) return state
  // One option is not a decision, and the AI never gets a prompt.
  if (legalIds.length === 1 || side === 'ai') return then(state, legalIds[0])

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    kind: 'unit',
    label,
    min: 1,
    max: 1,
    legalIds,
    resolve: (picked) => (s) => (picked[0] ? then(s, picked[0]) : s),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/** Swap two units' Might for the turn (Switcheroo) via `mightTurn` deltas. */
export function swapMight(state: GameState, aId: string, bId: string): GameState {
  const a = findUnit(state, aId)
  const b = findUnit(state, bId)
  if (!a || !b || a.instanceId === b.instanceId) return state
  const mightOf = (u: UnitInPlay) => u.card.might + (u.counters.mightPerm ?? 0) + (u.counters.mightTurn ?? 0)
  const ma = mightOf(a)
  const mb = mightOf(b)
  const next = mapAllUnits(state, (u) => {
    if (u.instanceId === aId) {
      return { ...u, counters: { ...u.counters, mightTurn: (u.counters.mightTurn ?? 0) + (mb - ma) } }
    }
    if (u.instanceId === bId) {
      return { ...u, counters: { ...u.counters, mightTurn: (u.counters.mightTurn ?? 0) + (ma - mb) } }
    }
    return u
  })
  return appendLog(next, `${a.card.name} and ${b.card.name} swap Might this turn (${ma} ↔ ${mb}).`)
}

/** Swap two units' locations (Tideturner). Not a Move — no move triggers. */
export function swapLocations(state: GameState, aId: string, bId: string): GameState {
  const a = findUnit(state, aId)
  const b = findUnit(state, bId)
  if (!a || !b || a.instanceId === b.instanceId) return state
  const locA = a.location
  const locB = b.location
  let next = removeUnit(state, aId)
  next = removeUnit(next, bId)
  next = placeUnitInto(next, { ...a, location: locB })
  next = placeUnitInto(next, { ...b, location: locA })
  return appendLog(next, `${a.card.name} and ${b.card.name} swap places.`)
}

/** Put an already-detached unit object back at its `location`. */
function placeUnitInto(state: GameState, unit: UnitInPlay): GameState {
  if (unit.location.kind === 'base') {
    return updatePlayer(state, unit.owner, (ps) => ({ ...ps, base: [...ps.base, unit] }))
  }
  return updateBattlefield(state, unit.location.index, (bf) => ({ ...bf, units: [...bf.units, unit] }))
}

/** Banish a permanent from the board — removed from the game, not trashed. */
export function banishPermanent(state: GameState, instanceId: string, emit?: Emit): GameState {
  const unit = findUnit(state, instanceId)
  if (unit) {
    let next = detachGearFromUnit(state, instanceId)
    next = removeUnit(next, instanceId)
    if (!isToken(unit)) {
      next = updatePlayer(next, unit.owner, (ps) => ({ ...ps, banished: [...ps.banished, unit.card] }))
    }
    next = appendLog(next, `${unit.card.name} is banished.`)
    return emit ? emit(next, { type: 'CARD_BANISHED', card: unit.card, owner: unit.owner }) : next
  }
  const g = findGear(state, instanceId)
  if (!g) return state
  let next = detachGear(state, instanceId)
  next = removeGear(next, instanceId)
  next = updatePlayer(next, g.owner, (ps) => ({ ...ps, banished: [...ps.banished, g.card] }))
  next = appendLog(next, `${g.card.name} is banished.`)
  return emit ? emit(next, { type: 'CARD_BANISHED', card: g.card, owner: g.owner }) : next
}

/** Burn X — mill the top `n` of a player's Main Deck to their trash. */
export function burn(state: GameState, side: PlayerSide, n: number): GameState {
  const ps = side === 'player' ? state.player : state.ai
  const count = Math.min(n, ps.mainDeck.length)
  if (count === 0) return appendLog(state, `${side} has nothing to burn.`)
  const burned = ps.mainDeck.slice(0, count)
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    mainDeck: p.mainDeck.slice(count),
    trash: [...p.trash, ...burned],
  }))
  return appendLog(next, `${side} burns ${count} card(s).`)
}

/**
 * Predict X — look at the top `x` of the Main Deck; the cards in `picks` are
 * recycled to the bottom, the rest stay on top in their current order.
 * `picks === undefined` → auto heuristic (recycle the lowest-energy card);
 * `picks === []` → an explicit "keep everything".
 */
export function predict(
  state: GameState,
  side: PlayerSide,
  x: number,
  picks?: string[],
): GameState {
  const ps = getPlayer(state, side)
  const top = ps.mainDeck.slice(0, x)
  if (top.length === 0) return appendLog(state, `${side} has no cards to predict.`)
  const rest = ps.mainDeck.slice(top.length)

  let recycleIds: Set<string>
  if (picks !== undefined) {
    recycleIds = new Set(picks.filter((id) => top.some((c) => c.id === id)))
  } else {
    const worst = [...top].sort((a, b) => a.energy - b.energy)[0]
    recycleIds = new Set(worst ? [worst.id] : [])
  }
  const keep = top.filter((c) => !recycleIds.has(c.id))
  const recycled = top.filter((c) => recycleIds.has(c.id))
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    mainDeck: [...keep, ...rest, ...recycled],
  }))
  return appendLog(
    next,
    `${side} predicts ${top.length}${recycled.length ? `, recycles ${recycled.length}` : ''}.`,
  )
}

/**
 * Interactive Predict: the human is shown the top `x` face-up and picks which to
 * recycle to the bottom; the AI runs the heuristic. `then` runs afterward (e.g.
 * "…then draw 2").
 */
export function predictChoice(
  state: GameState,
  side: PlayerSide,
  x: number,
  then: (s: GameState) => GameState = (s) => s,
): GameState {
  const top = getPlayer(state, side).mainDeck.slice(0, x)
  if (side === 'ai' || top.length === 0) return then(predict(state, side, x))

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label: `Predict ${x} — choose cards to recycle to the bottom (the rest stay on top)`,
    kind: 'deckTop',
    min: 0,
    max: top.length,
    legalIds: top.map((c) => c.id),
    resolve: (picked) => (s) => then(predict(s, side, x, picked)),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/**
 * Interactive discard: the human picks `n` cards from hand to discard; the AI
 * discards its cheapest. `then` runs afterward (e.g. "…then draw 1").
 */
export function discardChoice(
  state: GameState,
  side: PlayerSide,
  n: number,
  then: (s: GameState) => GameState = (s) => s,
): GameState {
  const hand = getPlayer(state, side).hand
  const count = Math.min(n, hand.length)
  if (count === 0) return then(state)
  if (side === 'ai') return then(discard(state, side, count))

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label: `Discard ${count} card${count > 1 ? 's' : ''}`,
    kind: 'handCard',
    min: count,
    max: count,
    legalIds: hand.map((c) => c.id),
    resolve: (picked) => (s) => then(discardCards(s, side, picked)),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/** Recycle specific hand cards to the bottom of the Main Deck. */
export function recycleFromHand(
  state: GameState,
  side: PlayerSide,
  cardIds: string[],
): GameState {
  if (cardIds.length === 0) return state
  const ids = new Set(cardIds)
  let moved: Card[] = []
  const next = updatePlayer(state, side, (p) => {
    moved = p.hand.filter((c) => ids.has(c.id))
    return {
      ...p,
      hand: p.hand.filter((c) => !ids.has(c.id)),
      mainDeck: [...p.mainDeck, ...moved],
    }
  })
  return appendLog(next, `${side} recycles ${moved.length} card(s) from hand.`)
}

export function returnSpellFromTrash(state: GameState, side: PlayerSide): GameState {
  const ps = side === 'player' ? state.player : state.ai
  const idx = ps.trash.map((c) => c.type).lastIndexOf('spell')
  if (idx < 0) return appendLog(state, `${side} has no spell in the trash to return.`)
  return returnCardFromTrash(state, side, ps.trash[idx].id)
}

export function returnCardFromTrash(
  state: GameState,
  side: PlayerSide,
  cardId: string,
): GameState {
  const ps = side === 'player' ? state.player : state.ai
  const idx = ps.trash.findIndex((c) => c.id === cardId)
  if (idx < 0) return state
  const card = ps.trash[idx]
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    trash: p.trash.filter((_, i) => i !== idx),
    hand: [...p.hand, card],
  }))
  return appendLog(next, `${side} returns ${card.name} from the trash to hand.`)
}

/**
 * Return up to `n` units from *either* player's trash to their owners' hands
 * (Shadows of the Past). Interactive for a human; the AI grabs its own biggest.
 */
export function returnUnitsFromTrash(
  state: GameState,
  side: PlayerSide,
  n: number,
): GameState {
  const legal = [
    ...state.player.trash.filter((c) => c.type === 'unit'),
    ...state.ai.trash.filter((c) => c.type === 'unit'),
  ]
  if (legal.length === 0) return appendLog(state, `No units in any trash to return.`)

  const doReturn = (s: GameState, ids: string[]): GameState => {
    let next = s
    for (const id of ids.slice(0, n)) {
      const owner: PlayerSide = next.player.trash.some((c) => c.id === id) ? 'player' : 'ai'
      next = returnCardFromTrash(next, owner, id)
    }
    return next
  }

  if (side === 'ai') {
    const own = state.ai.trash
      .filter((c) => c.type === 'unit')
      .sort((a, b) => b.might - a.might)
      .slice(0, n)
      .map((c) => c.id)
    return own.length ? doReturn(state, own) : appendLog(state, `AI returns no units.`)
  }

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label: `Return up to ${n} unit(s) from trashes to their owners' hands`,
    kind: 'trashCard',
    min: 0,
    max: n,
    legalIds: legal.map((c) => c.id),
    resolve: (picked) => (s) => doReturn(s, picked),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/**
 * Banish one card from a trash (yours, or any trash) → the owner's `banished`
 * pile, raising `CARD_BANISHED`. A no-op (returns `state` unchanged) when there
 * is nothing to banish, so callers can gate an "If you do, …" continuation.
 */
export function banishFromTrash(
  state: GameState,
  side: PlayerSide,
  opts: { fromAnyTrash?: boolean; unitsOnly?: boolean; emit?: Emit } = {},
): GameState {
  const sides: PlayerSide[] = opts.fromAnyTrash ? [side, otherSide(side)] : [side]
  for (const owner of sides) {
    const trash = (owner === 'player' ? state.player : state.ai).trash
    const idx = trash.findIndex((c) => !opts.unitsOnly || c.type === 'unit')
    if (idx < 0) continue
    const card = trash[idx]
    let next = updatePlayer(state, owner, (p) => ({
      ...p,
      trash: p.trash.filter((_, i) => i !== idx),
      banished: [...p.banished, card],
    }))
    next = appendLog(next, `${side} banishes ${card.name} from ${owner === side ? 'their' : "the opponent's"} trash.`)
    if (opts.emit) next = opts.emit(next, { type: 'CARD_BANISHED', card, owner })
    return next
  }
  return state
}

/**
 * Ravenbloom Conservatory — reveal the top Main Deck card; if it's a spell the
 * controller may take it to hand (AI auto-takes), otherwise it is recycled.
 */
export function revealTopChooseToHand(state: GameState, side: PlayerSide): GameState {
  const ps = side === 'player' ? state.player : state.ai
  const top = ps.mainDeck[0]
  if (!top) return appendLog(state, `${side}'s Main Deck is empty.`)

  const recycle = (s: GameState): GameState =>
    updatePlayer(s, side, (p) => ({ ...p, mainDeck: [...p.mainDeck.slice(1), p.mainDeck[0]] }))
  const take = (s: GameState): GameState =>
    appendLog(
      updatePlayer(s, side, (p) => ({ ...p, mainDeck: p.mainDeck.slice(1), hand: [...p.hand, top] })),
      `${side} takes ${top.name} to hand (Ravenbloom).`,
    )

  const revealed = appendLog(state, `${side} reveals ${top.name} (${top.type}).`)
  if (top.type !== 'spell') return appendLog(recycle(revealed), `${side} recycles it.`)
  if (side === 'ai') return take(revealed)

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label: `Ravenbloom — take ${top.name} to hand? (skip = recycle)`,
    kind: 'deckTop',
    min: 0,
    max: 1,
    legalIds: [top.id],
    resolve: (picked) => (s) => (picked.length ? take(s) : appendLog(recycle(s), `${side} recycles it.`)),
  }
  return { ...revealed, pendingChoices: [...revealed.pendingChoices, choice] }
}

/** Discard specific hand cards by id (falls back to the last card if none given). */
export function discardCards(
  state: GameState,
  side: PlayerSide,
  cardIds: string[],
  emit?: Emit,
): GameState {
  let next = state
  const ids = cardIds.length > 0 ? cardIds : undefined
  const count = ids ? ids.length : 1
  for (let i = 0; i < count; i++) {
    const ps = next.player.side === side ? next.player : next.ai
    const card = ids
      ? ps.hand.find((c) => c.id === ids[i])
      : ps.hand[ps.hand.length - 1]
    if (!card) continue
    next = updatePlayer(next, side, (p) => ({
      ...p,
      hand: removeOne(p.hand, card),
      trash: [...p.trash, card],
    }))
    next = appendLog(next, `${side} discards ${card.name}.`)
    if (emit) next = emit(next, { type: 'CARD_DISCARDED', card, owner: side })
  }
  return next
}

function removeOne<T>(arr: T[], item: T): T[] {
  const i = arr.indexOf(item)
  return i < 0 ? arr : [...arr.slice(0, i), ...arr.slice(i + 1)]
}

function isToken(unit: UnitInPlay): boolean {
  return unit.card.supertype === 'token'
}

export function bounceUnit(state: GameState, instanceId: string): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  let next = detachGearFromUnit(state, instanceId)
  next = removeUnit(next, instanceId)
  if (isToken(unit)) {
    return appendLog(next, `${unit.card.name} (token) ceases to exist.`)
  }
  next = updatePlayer(next, unit.owner, (ps) => ({ ...ps, hand: [...ps.hand, unit.card] }))
  return appendLog(next, `${unit.card.name} is returned to ${unit.owner}'s hand.`)
}

/** Recall a unit to its owner's base; a zone change wipes damage + transient state. */
/**
 * Send a unit to its owner's base without it being a Move (449–451).
 *
 * Rule 453.1: "Unless otherwise stated by the source of the Recall, Damage,
 * Exhausted Status, Buffed Status, and applied Layer alterations will all
 * remain unaffected by a Recall." So a bare recall preserves everything — the
 * `heal` / `exhaust` options exist for the cards that *do* state it (Guardian
 * Angel, Zhonya's Hourglass), and nothing else may clear damage or counters.
 */
export function recall(
  state: GameState,
  instanceId: string,
  opts: { heal?: boolean; exhaust?: boolean } = {},
): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  if (isToken(unit)) {
    return appendLog(removeUnit(state, instanceId), `${unit.card.name} (token) ceases to exist.`)
  }
  let next = detachGearFromUnit(state, instanceId)
  next = removeUnit(next, instanceId)
  const recalled: UnitInPlay = {
    ...unit,
    location: { kind: 'base' },
    exhausted: opts.exhaust ?? unit.exhausted,
    sick: false,
    damage: opts.heal ? 0 : unit.damage,
  }
  next = updatePlayer(next, unit.owner, (ps) => ({ ...ps, base: [...ps.base, recalled] }))
  return appendLog(next, `${unit.card.name} is recalled to ${unit.owner}'s base.`)
}

// ── damage / death ───────────────────────────────────────────────────────

/**
 * Attached gear that replaces this unit's death (Guardian Angel). Returns the
 * replacing state, or `null` if nothing intervenes.
 */
/**
 * Ask every gear its controller has whether it replaces this death.
 *
 * Deliberately *not* limited to gear attached to the dying unit: Zhonya's
 * Hourglass is a standalone gear that saves any friendly unit. Each script
 * decides for itself whether it applies (Equipment checks `attachedTo`) and
 * returns null to decline.
 */
function deathReplacement(state: GameState, unit: UnitInPlay): GameState | null {
  for (const g of allGear(state)) {
    if (g.owner !== unit.owner) continue
    const replace = scriptFor(g.card)?.replaceDeath
    if (!replace) continue
    const out = replace(state, unit, g)
    if (out) return out
  }
  return null
}

export function killUnit(state: GameState, instanceId: string, emit?: Emit, inCombat = false): GameState {
  const unit = allUnits(state).find((u) => u.instanceId === instanceId)
  if (!unit) return state

  // A replacement means the unit never dies — no trash, no `UNIT_DIED`, so
  // Deathknell correctly doesn't fire.
  const replaced = deathReplacement(state, unit)
  if (replaced) return replaced

  let next = detachGearFromUnit(state, instanceId)
  next = removeUnit(next, instanceId)
  if (isToken(unit)) {
    next = appendLog(next, `${unit.card.name} (token) ceases to exist.`)
  } else {
    next = updatePlayer(next, unit.owner, (ps) => ({ ...ps, trash: [...ps.trash, unit.card] }))
    next = appendLog(next, `${unit.card.name} is destroyed.`)
  }
  if (emit) {
    next = emit(next, {
      type: 'UNIT_DIED',
      card: unit.card,
      owner: unit.owner,
      instanceId,
      inCombat,
    })
  }
  return next
}

export function dealDamage(
  state: GameState,
  instanceId: string,
  amount: number,
  emit?: Emit,
): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  const total = unit.damage + amount
  const next = appendLog(state, `${unit.card.name} takes ${amount} damage.`)
  // Might is health (143.2.a). Use the unit's *current* Might, which includes
  // Assault/Shield when a showdown is live — a burn spell cast at an attacker
  // mid-combat has to get through its Assault Might too.
  if (lethalMight(unit, state, combatRoleOf(state, unit)) - total <= 0) {
    return killUnit(next, instanceId, emit)
  }
  return mapAllUnits(next, (u) => (u.instanceId === instanceId ? { ...u, damage: total } : u))
}

// ── buffs / debuffs / keywords / readiness ───────────────────────────────

export function giveMight(state: GameState, instanceId: string, n: number): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  const next = mapAllUnits(state, (u) =>
    u.instanceId === instanceId
      ? { ...u, counters: { ...u.counters, mightTurn: (u.counters.mightTurn ?? 0) + n } }
      : u,
  )
  return appendLog(
    next,
    `${unit.card.name} gets ${n >= 0 ? '+' : ''}${n} might this turn.`,
  )
}

/** Permanent flat Might modifier — survives end-of-turn cleanup. */
export function giveMightPermanent(state: GameState, instanceId: string, n: number): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  const next = mapAllUnits(state, (u) =>
    u.instanceId === instanceId
      ? { ...u, counters: { ...u.counters, mightPerm: (u.counters.mightPerm ?? 0) + n } }
      : u,
  )
  return appendLog(next, `${unit.card.name} gets ${n >= 0 ? '+' : ''}${n} might permanently.`)
}

/** The `[Buff]` game action — one buff counter (+1 Might), non-stacking. */
export function buff(state: GameState, instanceId: string): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  if ((unit.counters.buffed ?? 0) > 0) {
    return appendLog(state, `${unit.card.name} already has a buff counter.`)
  }
  const next = mapAllUnits(state, (u) =>
    u.instanceId === instanceId
      ? {
          ...u,
          counters: {
            ...u.counters,
            buffed: 1,
            mightPerm: (u.counters.mightPerm ?? 0) + 1,
          },
        }
      : u,
  )
  return appendLog(next, `${unit.card.name} is buffed (+1 Might).`)
}

/** The `[Stun]` game action — 0 Might in combat until end-of-turn cleanup. */
export function stun(state: GameState, instanceId: string): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  if ((unit.counters.stunned ?? 0) > 0) {
    return appendLog(state, `${unit.card.name} is already stunned.`)
  }
  const next = mapAllUnits(state, (u) =>
    u.instanceId === instanceId
      ? { ...u, counters: { ...u.counters, stunned: 1 } }
      : u,
  )
  return appendLog(next, `${unit.card.name} is stunned.`)
}

/** Remove damage from a unit (all of it, or `n` if given). */
export function heal(state: GameState, instanceId: string, n?: number): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit || unit.damage === 0) return state
  const removed = n === undefined ? unit.damage : Math.min(n, unit.damage)
  const next = mapAllUnits(state, (u) =>
    u.instanceId === instanceId ? { ...u, damage: Math.max(0, u.damage - removed) } : u,
  )
  return appendLog(next, `${unit.card.name} heals ${removed}.`)
}

export function grantKeywordThisTurn(
  state: GameState,
  instanceId: string,
  keyword: string,
  magnitude = 1,
): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  const key = `kw:${keyword}`
  const next = mapAllUnits(state, (u) =>
    u.instanceId === instanceId
      ? { ...u, counters: { ...u.counters, [key]: magnitude } }
      : u,
  )
  return appendLog(next, `${unit.card.name} gains ${keyword} this turn.`)
}

export function readyUnit(state: GameState, instanceId: string): GameState {
  return mapAllUnits(state, (u) =>
    u.instanceId === instanceId ? { ...u, exhausted: false, sick: false } : u,
  )
}

export function moveUnitEffect(
  state: GameState,
  instanceId: string,
  to: UnitLocation,
  opts: { ready?: boolean; /** Who is doing the moving, for move-protection. */ by?: PlayerSide } = {},
  emit?: Emit,
): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
  // Jagged Cutlass — "I can't be moved by enemy spells and abilities."
  // Only an *enemy* effect is blocked; the owner can still move it freely.
  if (opts.by && opts.by !== unit.owner && hasMoveProtection(state, unit)) {
    return appendLog(state, `${unit.card.name} can't be moved by enemy spells and abilities.`)
  }
  const from = unit.location
  let next = removeUnit(state, instanceId)
  const moved: UnitInPlay = {
    ...unit,
    location: to,
    exhausted: opts.ready ? false : unit.exhausted,
    sick: opts.ready ? false : unit.sick,
  }
  if (to.kind === 'base') {
    next = updatePlayer(next, unit.owner, (ps) => ({ ...ps, base: [...ps.base, moved] }))
  } else {
    const before = controllerOf(next.battlefields[to.index])
    next = updateBattlefield(next, to.index, (bf) => ({ ...bf, units: [...bf.units, moved] }))
    const after = controllerOf(next.battlefields[to.index])
    if (after === unit.owner && before === 'open' && emit) {
      next = emit(next, { type: 'CONQUERED', side: unit.owner, index: to.index, excess: 0 })
    }
  }
  next = appendLog(
    next,
    `${unit.card.name} moves to ${to.kind === 'base' ? 'base' : `battlefield ${to.index + 1}`}.`,
  )
  if (emit) {
    next = emit(next, { type: 'UNIT_MOVED', instanceId, controller: unit.owner, from, to })
  }
  return next
}

// ── points / runes ───────────────────────────────────────────────────────

export function scorePoints(state: GameState, side: PlayerSide, n: number): GameState {
  const next = updatePlayer(appendLog(state, `${side} scores ${n} point(s).`), side, (ps) => ({
    ...ps,
    points: ps.points + n,
  }))
  return checkVictory(next)
}

export function bankEnergy(state: GameState, side: PlayerSide, n: number): GameState {
  return updatePlayer(state, side, (ps) => ({ ...ps, bankedEnergy: ps.bankedEnergy + n }))
}

/** Add — put `n` Power into a player's Rune Pool for the turn. */
export function addPower(state: GameState, side: PlayerSide, n: number): GameState {
  const next = updatePlayer(state, side, (ps) => ({
    ...ps,
    runes: { ...ps.runes, power: ps.runes.power + n },
  }))
  return appendLog(next, `${side} adds ${n} Power.`)
}

/** Add — put `n` energy into a player's Rune Pool for the turn. */
export function addEnergy(state: GameState, side: PlayerSide, n: number): GameState {
  const next = updatePlayer(state, side, (ps) => ({
    ...ps,
    runes: { ...ps.runes, energy: ps.runes.energy + n },
  }))
  return appendLog(next, `${side} adds ${n} energy.`)
}

export function gainXP(state: GameState, side: PlayerSide, n: number): GameState {
  const next = updatePlayer(state, side, (ps) => ({ ...ps, xp: ps.xp + n }))
  return appendLog(next, `${side} gains ${n} XP.`)
}

/**
 * Set (or clear) Empowered on a unit **or a gear**.
 *
 * This used to call `mapAllUnits` only, so pointing it at a gear silently did
 * nothing — and in a gear deck ("If this is [Empowered], … instead") a missed
 * flag reads as the card just not working. Instance ids are unique across both
 * collections, so handling each is unambiguous.
 */
export function setEmpowered(state: GameState, instanceId: string, on = true): GameState {
  const withUnits = mapAllUnits(state, (u) =>
    u.instanceId === instanceId ? { ...u, empowered: on } : u,
  )
  return mapAllGear(withUnits, (g) =>
    g.instanceId === instanceId ? { ...g, empowered: on } : g,
  )
}

export interface TokenSpec {
  might?: number
  keywords?: string[]
  text?: string
  /** Enters ready (not summoning-sick) — e.g. "play a ready … token". */
  ready?: boolean
  /** A gear token (Gold) rather than a unit token. */
  gear?: boolean
  emit?: Emit
}

/**
 * Canonical stats for every token the four preset decks (and their battlefield
 * cards) can name, so a bare `createToken(name)` is still well-formed when the
 * card pool has no printing. Caller-supplied `spec` always wins.
 */
const TOKEN_STATS: Record<string, TokenSpec> = {
  'shadow clone': {
    might: 0,
    text: 'When I attack, you may banish a unit from your trash. If you do, give me [Assault 4] this turn.',
  },
  recruit: { might: 1 },
  sprite: { might: 1 },
  mech: { might: 3 },
  bird: { might: 1, keywords: ['Deflect'] },
  'sand soldier': { might: 2 },
  reflection: { might: 0 },
  tentacle: { might: 2 },
  gold: { might: 0, gear: true },
}

function tokenDefaults(name: string): TokenSpec {
  return TOKEN_STATS[name.trim().toLowerCase()] ?? {}
}

/** The token names any of `cards`' rules text can create (for a deck's token pile). */
export function tokenNamesFor(cards: Card[]): string[] {
  const names = new Set<string>()
  for (const c of cards) {
    for (const m of c.text.matchAll(
      /(?:\d+\s*(?::rb_might:|\[m\]|might)\s+)?([A-Z][\w' ]*?)\s+(?:unit |gear )?token/g,
    )) {
      const n = m[1].replace(/\s+/g, ' ').trim()
      if (n && n.length <= 24 && !/^(a|an|the|ready|non)$/i.test(n)) names.add(n)
    }
  }
  return [...names]
}

/** Resolve a token's Card — a real printing if the pool has one, else synthesised.
 *  The result is renamed to the plain token name (pool printings carry collector
 *  suffixes / "// Buff" backs) so pile lookup + UI stay consistent. */
export function tokenCardFor(name: string, spec: TokenSpec = {}): Card {
  const found = findTokenCardByName(name)
  return found ? { ...found, name, cleanName: name } : synthToken(name, spec)
}

/** Synthesise a Token-supertype Card when the pool has no matching printing. */
function synthToken(name: string, spec: TokenSpec): Card {
  const merged: TokenSpec = { ...tokenDefaults(name), ...spec }
  return {
    id: `token-${name}-${newInstanceId()}`,
    riftboundId: `token-${name}`,
    name,
    cleanName: name,
    type: merged.gear ? 'gear' : 'unit',
    supertype: 'token',
    rarity: 'common',
    domains: ['colorless'],
    energy: 0,
    power: 0,
    might: merged.gear ? 0 : merged.might ?? 1,
    text: merged.text ?? '',
    flavour: '',
    keywords: merged.keywords ?? [],
    symbols: [],
    tags: [],
    set: 'TOKEN',
    setName: 'Token',
    collectorNumber: '0',
    imageUrl: '',
    artist: '',
  }
}

/**
 * Create a token unit at `to`. Tokens are never in a deck — they only exist
 * because an effect (Viktor, a Deathknell, Iterative Design…) made this call.
 * Uses a real Token printing from the pool when one matches the name, otherwise
 * synthesises one from `spec`.
 */
export function createToken(
  state: GameState,
  side: PlayerSide,
  tokenName: string,
  to: UnitLocation,
  spec: TokenSpec = {},
): GameState {
  // Prefer the player's own token pile (an unlimited reference set), then a pool
  // printing, then a synthesised card.
  const norm = (s: string) => s.trim().toLowerCase()
  const fromPile = (side === 'player' ? state.player : state.ai).tokenPile.find(
    (c) => norm(c.name) === norm(tokenName),
  )
  const card = fromPile ?? findTokenCardByName(tokenName) ?? synthToken(tokenName, spec)
  const emit = spec.emit

  // A gear token (Gold) becomes a gear permanent, not a unit row.
  if (card.type === 'gear') {
    const next = enterGear(state, side, card)
    return appendLog(next, `${side} creates a ${card.name} gear token.`)
  }

  const unit: UnitInPlay = {
    instanceId: newInstanceId(),
    card,
    owner: side,
    location: to,
    exhausted: false,
    damage: 0,
    counters: {},
    sick: !spec.ready,
  }
  let next: GameState =
    to.kind === 'base'
      ? updatePlayer(state, side, (ps) => ({ ...ps, base: [...ps.base, unit] }))
      : updateBattlefield(state, to.index, (bf) => ({ ...bf, units: [...bf.units, unit] }))
  next = appendLog(
    next,
    `${side} creates a ${card.name} token${to.kind === 'base' ? ' at base' : ` at battlefield ${to.index + 1}`}.`,
  )
  if (emit) {
    next = emit(next, { type: 'UNIT_ENTERED', instanceId: unit.instanceId, controller: side })
  }
  return next
}

// ── gear (persistent permanents) ─────────────────────────────────────────

/** Equipment grant parsed from a gear's rules text ("+N Might", "[Assault N]"). */
export function gearGrants(card: Card): { might: number; keywords: { name: string; x: number }[] } {
  const t = card.text
  const might = [...t.matchAll(/\+(\d+)\s*(?::rb_might:|\[m\]|might)/gi)].reduce(
    (n, m) => n + parseInt(m[1], 10),
    0,
  )
  const keywords = [...t.matchAll(/\[(Assault|Shield|Deflect|Ganking|Tank|Tough)\s*(\d+)?\]/gi)].map(
    (m) => ({ name: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), x: m[2] ? parseInt(m[2], 10) : 1 }),
  )
  // Some cards' API text omits the granted box entirely (Guardian Angel), so a
  // script can supply what the text doesn't say.
  const extra = scriptFor(card)?.gearGrant
  return {
    might: might + (extra?.might ?? 0),
    keywords: [...keywords, ...(extra?.keywords ?? [])],
  }
}

/**
 * Does any gear attached to `unit` stop enemy effects moving it?
 * Jagged Cutlass: "I can't be moved by enemy spells and abilities."
 */
export function hasMoveProtection(state: GameState, unit: UnitInPlay): boolean {
  return [...state.player.gear, ...state.ai.gear].some(
    (g) => g.attachedTo === unit.instanceId && scriptFor(g.card)?.gearGrant?.noEnemyMove,
  )
}

/** Gear the given side controls. */
export function gearCount(state: GameState, side: PlayerSide): number {
  return getPlayer(state, side).gear.length
}

/** A gear card resolves into play (permanent), NOT to the trash. */
export function enterGear(state: GameState, side: PlayerSide, card: Card): GameState {
  const gear: GearInPlay = {
    instanceId: newInstanceId(),
    card,
    owner: side,
    exhausted: /this enters exhausted/i.test(card.text) || /i enter exhausted/i.test(card.text),
    counters: {},
  }
  const next = updatePlayer(state, side, (ps) => ({ ...ps, gear: [...ps.gear, gear] }))
  return appendLog(next, `${side}'s ${card.name} enters play${gear.exhausted ? ' exhausted' : ''}.`)
}

function applyGearGrant(state: GameState, unitId: string, card: Card, sign: 1 | -1): GameState {
  const g = gearGrants(card)
  return mapAllUnits(state, (u) => {
    if (u.instanceId !== unitId) return u
    const counters = { ...u.counters }
    if (g.might) counters.mightPerm = (counters.mightPerm ?? 0) + sign * g.might
    for (const k of g.keywords) {
      const key = `gkw:${k.name}`
      counters[key] = Math.max(0, (counters[key] ?? 0) + sign * k.x)
    }
    return { ...u, counters }
  })
}

/** Equipment: attach `gearId` to `unitId`, applying its grant. */
export function attachGear(state: GameState, gearId: string, unitId?: string): GameState {
  const gear = findGear(state, gearId)
  const unit = unitId ? findUnit(state, unitId) : undefined
  if (!gear || !unit) return state
  let next = mapAllGear(state, (g) =>
    g.instanceId === gearId ? { ...g, attachedTo: unitId } : g,
  )
  next = applyGearGrant(next, unit.instanceId, gear.card, 1)
  // Name the grant. "X equips Y" left the player to guess whether anything
  // happened — the commonest "this buff isn't working" report.
  const g = gearGrants(gear.card)
  const parts = [
    ...(g.might ? [`+${g.might} might`] : []),
    ...g.keywords.map((k) => (k.x > 1 ? `${k.name} ${k.x}` : k.name)),
  ]
  return appendLog(
    next,
    `${gear.card.name} equips ${unit.card.name}${parts.length ? ` (${parts.join(', ')})` : ''}.`,
  )
}

/** Detach a gear (Equipment) — remove its grant, keep the gear in play unattached. */
export function detachGear(state: GameState, gearId: string): GameState {
  const gear = findGear(state, gearId)
  if (!gear?.attachedTo) return state
  const next = applyGearGrant(state, gear.attachedTo, gear.card, -1)
  return mapAllGear(next, (g) =>
    g.instanceId === gearId ? { ...g, attachedTo: undefined } : g,
  )
}

/** Detach every Equipment attached to `unitId` (called when the unit leaves play). */
export function detachGearFromUnit(state: GameState, unitId: string): GameState {
  let next = state
  for (const g of allGear(state)) {
    if (g.attachedTo === unitId) next = detachGear(next, g.instanceId)
  }
  return next
}

/** Ready up to `n` exhausted gear that `side` controls. */
export function readyGear(state: GameState, side: PlayerSide, n: number): GameState {
  let left = n
  const next = updatePlayer(state, side, (ps) => ({
    ...ps,
    gear: ps.gear.map((g) => {
      if (left > 0 && g.exhausted) {
        left -= 1
        return { ...g, exhausted: false }
      }
      return g
    }),
  }))
  return appendLog(next, `${side} readies ${n - left} gear.`)
}

/** Ready one specific gear — used when the controller picked which. */
export function readyGearById(state: GameState, gearId: string): GameState {
  const g = findGear(state, gearId)
  if (!g) return state
  if (!g.exhausted) return appendLog(state, `${g.card.name} is already ready.`)
  const next = mapAllGear(state, (x) => (x.instanceId === gearId ? { ...x, exhausted: false } : x))
  return appendLog(next, `${g.card.name} is readied.`)
}

/**
 * Un-spend one channeled rune, so it can pay another `:rb_rune_*:` pip this
 * turn. In this engine a pip costs a *free channeled rune* (not extra energy),
 * so readying a rune simply removes it from `spent`.
 */
export function readyRuneAt(state: GameState, side: PlayerSide, index: number): GameState {
  const ps = getPlayer(state, side)
  const rune = ps.runes.spent[index]
  if (!rune) return state
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    runes: { ...p.runes, spent: p.runes.spent.filter((_, i) => i !== index) },
  }))
  return appendLog(next, `${side} readies a ${rune.domains[0] ?? 'colorless'} rune.`)
}

/** One readyable thing, as an opaque token plus a label for the picker. */
interface Readyable {
  token: string
  label: string
  apply: (s: GameState) => GameState
}

function readyables(state: GameState, side: PlayerSide): Readyable[] {
  const ps = getPlayer(state, side)
  const out: Readyable[] = []
  for (const u of allUnits(state)) {
    if (u.owner !== side || !u.exhausted) continue
    out.push({
      token: `u:${u.instanceId}`,
      label: u.card.name,
      apply: (s) => readyUnit(s, u.instanceId),
    })
  }
  for (const g of ps.gear) {
    if (!g.exhausted) continue
    out.push({
      token: `g:${g.instanceId}`,
      label: `${g.card.name} (gear)`,
      apply: (s) => readyGearById(s, g.instanceId),
    })
  }
  ps.runes.spent.forEach((rune, i) => {
    out.push({
      token: `r:${i}`,
      label: `${rune.domains[0] ?? 'colorless'} rune`,
      // Indices shift as runes leave `spent`, so resolve by identity at apply time.
      apply: (s) => {
        const cur = getPlayer(s, side).runes.spent.findIndex((c) => c.id === rune.id)
        return cur >= 0 ? readyRuneAt(s, side, cur) : s
      },
    })
  })
  return out
}

/**
 * "Ready up to N units, gear, and/or runes." (Acceleration Gate.)
 *
 * The three kinds can't be expressed as one `TargetSpec` — those are single-kind
 * — so this is a `PendingChoice` over a mixed list instead. The AI takes the
 * first N (units before gear before runes, which is the useful order).
 */
export function readyPermanentsChoice(
  state: GameState,
  side: PlayerSide,
  max: number,
): GameState {
  const options = readyables(state, side)
  if (options.length === 0) return appendLog(state, `${side} has nothing to ready.`)

  const applyPicks = (s: GameState, picked: string[]): GameState => {
    let next = s
    // Re-derive from the *current* state so a stale token is simply skipped.
    const live = readyables(next, side)
    for (const token of picked.slice(0, max)) {
      const opt = live.find((o) => o.token === token)
      if (opt) next = opt.apply(next)
    }
    return next
  }

  if (side === 'ai') return applyPicks(state, options.slice(0, max).map((o) => o.token))

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label: `Ready up to ${max} — units, gear and/or runes`,
    kind: 'permanent',
    min: 0,
    max,
    legalIds: options.map((o) => o.token),
    optionLabels: options.map((o) => o.label),
    resolve: (picked) => (s) => applyPicks(s, picked),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/**
 * "You may kill a gear" — an optional pick across every gear on the board.
 *
 * Trigger targets are auto-picked by the event system (`autoTargetsForTrigger`)
 * and `TriggerChoice` has no gear kind, so a card that lets the *player* choose
 * a gear has to raise its own `permanent` choice like this one.
 */
export function killGearChoice(state: GameState, side: PlayerSide, label: string): GameState {
  const options = allGear(state)
  if (options.length === 0) return appendLog(state, 'There is no gear to destroy.')

  const apply = (s: GameState, picked: string[]): GameState =>
    picked[0] ? killGear(s, picked[0]) : s

  if (side === 'ai') {
    // Prefer an enemy gear; never blow up your own if there is a choice.
    const enemy = options.filter((g) => g.owner !== side)
    const pick = (enemy.length > 0 ? enemy : [])[0]
    return pick ? killGear(state, pick.instanceId) : state
  }

  const choice: PendingChoice = {
    id: newChoiceId(),
    controller: side,
    label,
    kind: 'permanent',
    min: 0, // "you may"
    max: 1,
    legalIds: options.map((g) => g.instanceId),
    optionLabels: options.map((g) => `${g.card.name}${g.owner === side ? ' (yours)' : ' (enemy)'}`),
    resolve: (picked) => (s) => apply(s, picked),
  }
  return { ...state, pendingChoices: [...state.pendingChoices, choice] }
}

/** Give a gear the Empowered status. */
export function empowerGear(state: GameState, gearId: string): GameState {
  const g = findGear(state, gearId)
  if (!g) return state
  const next = mapAllGear(state, (x) => (x.instanceId === gearId ? { ...x, empowered: true } : x))
  return appendLog(next, `${g.card.name} is Empowered.`)
}

/** Destroy a gear — detach it first, then send the card to its owner's trash. */
export function killGear(state: GameState, gearId: string): GameState {
  const g = findGear(state, gearId)
  if (!g) return state
  let next = detachGear(state, gearId)
  next = removeGear(next, gearId)
  next = updatePlayer(next, g.owner, (ps) => ({ ...ps, trash: [...ps.trash, g.card] }))
  return appendLog(next, `${g.card.name} is destroyed.`)
}

// ── stack ────────────────────────────────────────────────────────────────

export function counterStackItem(state: GameState, stackItemId: string): GameState {
  const item = state.stack.find((s) => s.id === stackItemId)
  if (!item) return appendLog(state, 'The countered spell is no longer on the stack.')
  let next: GameState = {
    ...state,
    stack: state.stack.filter((s) => s.id !== stackItemId),
    lastResolved: { label: item.label, card: item.card ?? null, outcome: 'countered' },
  }
  if (item.card) {
    next = updatePlayer(next, item.controller, (ps) => ({
      ...ps,
      trash: [...ps.trash, item.card as Card],
    }))
  }
  return appendLog(next, `${item.label} is countered.`)
}

// ── misc helpers used by scripts ─────────────────────────────────────────

export { otherSide }

export function soleControllerAt(state: GameState, unit: UnitInPlay): boolean {
  if (unit.location.kind !== 'battlefield') return false
  const bf = state.battlefields[unit.location.index]
  const mine = bf.units.filter((u) => u.owner === unit.owner)
  return mine.length === 1
}
