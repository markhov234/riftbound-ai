import { Card, Domain } from '../types/card'
import { FacedownCard, GameState, PlayerSide } from '../types/game'
import { canAfford, Cost, payCost } from './runes'
import { appendLog, controllerOf, getPlayer, updateBattlefield, updatePlayer } from './state'

/**
 * What hiding costs: `[A]` — one Power of any domain (811.1.b).
 *
 * Modelled as a **rune pip**, exactly like the `:rb_rune_*:` pips printed on
 * every other card, because it is the same thing: you produce Power by spending
 * a rune you already have on the board (163.2.b). Charging it against the
 * separate `runes.power` pool instead made Hidden the one cost in the game you
 * could not pay with a rune — you had to click Recycle first.
 */
export const HIDE_COST: Cost = { energy: 0, power: 0, runes: ['colorless' as Domain] }

/**
 * The `[Hidden]` keyword (rule 811) and the Facedown Zone (107.3).
 *
 * 811.1.b is the whole card in one sentence: "While this card is in your hand
 * or in your Champion Zone on your turn during an Open State, you may pay [A]
 * to hide this facedown at a battlefield you control that doesn't already have
 * a facedown card hidden there for as long as you control that battlefield.
 * Beginning on the next turn, this gains [Reaction] and you may play this,
 * ignoring its base cost."
 *
 * Two properties fall out of that and drive everything here:
 *  • Hiding is **not** playing (811.1.c.1) — it opens no chain and triggers no
 *    "when you play a card" ability. Playing it back *does* (811.1.c.3).
 *  • The card is only free-and-Reaction *from a later turn* — hide and play in
 *    the same turn is illegal, which is what `turnHidden` records.
 */

export interface PlayCheck {
  ok: boolean
  reason?: string
}

export function hasHidden(card: Card): boolean {
  return card.keywords.some((k) => k.toLowerCase() === 'hidden')
}

/** The facedown card `side` could play from battlefield `index`, if any. */
export function facedownAt(state: GameState, index: number): FacedownCard | null {
  return state.battlefields[index]?.facedown ?? null
}

/**
 * Everything about hiding that does *not* depend on which battlefield: the
 * keyword, the timing window, where the card is, and the Power.
 *
 * Split out from `canHide` so the UI can tell a player *why* hiding is off.
 * When the per-battlefield checks run first, "you don't control that
 * battlefield" masks every other reason, and the option just silently vanishes.
 *
 * The cost goes through `canAfford` like every other card cost — see HIDE_COST.
 */
export function canHideAnywhere(state: GameState, side: PlayerSide, card: Card): PlayCheck {
  if (state.winner) return { ok: false, reason: 'game over' }
  if (!hasHidden(card)) return { ok: false, reason: 'this card does not have [Hidden]' }

  // "on your turn during an Open State" — your main phase, nothing on the chain.
  if (state.activePlayer !== side || state.phase !== 'action') {
    return { ok: false, reason: 'only on your own turn' }
  }
  if (state.priority !== side) return { ok: false, reason: 'not your priority' }
  if (state.stack.length > 0 || state.pendingShowdown) {
    return { ok: false, reason: 'not while something is resolving' }
  }

  const ps = getPlayer(state, side)
  const inHand = ps.hand.some((c) => c.id === card.id)
  const inChampionZone = ps.championZone?.id === card.id
  if (!inHand && !inChampionZone) {
    return { ok: false, reason: 'card is not in your hand or Champion Zone' }
  }
  if (!canAfford(state, side, HIDE_COST)) {
    return { ok: false, reason: 'needs 1 Power — no free rune to spend' }
  }

  return { ok: true }
}

/** Can `side` hide `card` at battlefield `index` right now? */
export function canHide(
  state: GameState,
  side: PlayerSide,
  card: Card,
  index: number,
): PlayCheck {
  const general = canHideAnywhere(state, side, card)
  if (!general.ok) return general

  const bf = state.battlefields[index]
  if (!bf) return { ok: false, reason: 'no such battlefield' }
  // 107.3.c — only the battlefield's controller may use its Facedown Zone.
  if (controllerOf(bf) !== side) return { ok: false, reason: "you don't control that battlefield" }
  // 107.3.b — the zone holds exactly one card.
  if (bf.facedown) return { ok: false, reason: 'a card is already hidden there' }

  return { ok: true }
}

/**
 * Why `side` can't hide `card` anywhere right now, or null if they can.
 * Prefers the general reason (fixable) over the per-battlefield one.
 */
export function hideBlockedReason(
  state: GameState,
  side: PlayerSide,
  card: Card,
): string | null {
  const general = canHideAnywhere(state, side, card)
  if (!general.ok) return general.reason ?? 'not right now'
  if (state.battlefields.some((bf) => canHide(state, side, card, bf.index).ok)) return null
  const occupied = state.battlefields.some(
    (bf) => controllerOf(bf) === side && !!bf.facedown,
  )
  return occupied
    ? 'every battlefield you control already hides a card'
    : 'you must control a battlefield to hide a card there'
}

/** Perform the Hide discretionary action. No chain, no `CARD_PLAYED` event. */
export function hideCard(
  state: GameState,
  side: PlayerSide,
  card: Card,
  index: number,
): GameState {
  const check = canHide(state, side, card, index)
  if (!check.ok) return appendLog(state, `Can't hide ${card.name}: ${check.reason}.`)

  let next = payCost(state, side, HIDE_COST)
  next = updatePlayer(next, side, (ps) => {
    const i = ps.hand.findIndex((c) => c.id === card.id)
    return {
      ...ps,
      hand: i >= 0 ? [...ps.hand.slice(0, i), ...ps.hand.slice(i + 1)] : ps.hand,
      championZone: ps.championZone?.id === card.id ? null : ps.championZone,
    }
  })
  next = updateBattlefield(next, index, (bf) => ({
    ...bf,
    facedown: { owner: side, card, turnHidden: next.turn },
  }))
  // The card's identity stays private (128.4) — the log must not name it.
  return appendLog(next, `${side} hides a card at battlefield ${index + 1}.`)
}

/**
 * Can `side` play the card currently facedown at `index`?
 * Free and Reaction-timed, but only from a turn *after* it was hidden.
 */
export function canPlayFromFacedown(state: GameState, side: PlayerSide, index: number): PlayCheck {
  if (state.winner) return { ok: false, reason: 'game over' }
  const fd = facedownAt(state, index)
  if (!fd) return { ok: false, reason: 'nothing is hidden there' }
  if (fd.owner !== side) return { ok: false, reason: 'not your hidden card' }
  if (fd.turnHidden >= state.turn) {
    return { ok: false, reason: 'hidden this turn — playable from your next turn' }
  }
  if (state.priority !== side) return { ok: false, reason: 'not your priority' }
  return { ok: true }
}

/** Take the card out of the Facedown Zone (called as it is played). */
export function takeFacedown(state: GameState, index: number): GameState {
  return updateBattlefield(state, index, (bf) => ({ ...bf, facedown: null }))
}

/**
 * 107.3.d / 461.5.c — a facedown card whose owner no longer controls the
 * battlefield is removed during the next cleanup. Rule 421.4 says a facedown
 * card changing zones is revealed, so this one names the card in the log.
 */
export function clearOrphanedFacedown(state: GameState): GameState {
  let next = state
  for (const bf of state.battlefields) {
    const fd = bf.facedown
    if (!fd) continue
    if (controllerOf(bf) === fd.owner) continue
    next = updateBattlefield(next, bf.index, (b) => ({ ...b, facedown: null }))
    next = updatePlayer(next, fd.owner, (ps) => ({ ...ps, trash: [...ps.trash, fd.card] }))
    next = appendLog(
      next,
      `${fd.owner} lost ${bf.name} — the hidden ${fd.card.name} is revealed and trashed.`,
    )
  }
  return next
}
