import { Card } from '../../types/card'
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
export function recall(state: GameState, instanceId: string): GameState {
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
    exhausted: false,
    sick: false,
    damage: 0,
    counters: {},
  }
  next = updatePlayer(next, unit.owner, (ps) => ({ ...ps, base: [...ps.base, recalled] }))
  return appendLog(next, `${unit.card.name} is recalled to ${unit.owner}'s base.`)
}

// ── damage / death ───────────────────────────────────────────────────────

export function killUnit(state: GameState, instanceId: string, emit?: Emit, inCombat = false): GameState {
  const unit = allUnits(state).find((u) => u.instanceId === instanceId)
  if (!unit) return state

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
  if (effHpAfter(unit, total) <= 0) {
    return killUnit(next, instanceId, emit)
  }
  return mapAllUnits(next, (u) => (u.instanceId === instanceId ? { ...u, damage: total } : u))
}

function effHpAfter(unit: UnitInPlay, totalDamage: number): number {
  return (
    Math.max(
      1,
      unit.card.might + (unit.counters.mightTurn ?? 0) + (unit.counters.mightPerm ?? 0),
    ) - totalDamage
  )
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
  opts: { ready?: boolean } = {},
  emit?: Emit,
): GameState {
  const unit = findUnit(state, instanceId)
  if (!unit) return state
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

export function setEmpowered(state: GameState, instanceId: string): GameState {
  return mapAllUnits(state, (u) =>
    u.instanceId === instanceId ? { ...u, empowered: true } : u,
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
  return { might, keywords }
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
  return appendLog(next, `${gear.card.name} equips ${unit.card.name}.`)
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
