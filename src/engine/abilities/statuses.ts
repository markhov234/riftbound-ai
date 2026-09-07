import { GameState, PlayerSide } from '../../types/game'
import { getPlayer } from '../state'

/**
 * Legion — active when you have played another Main Deck card this turn.
 * `cardsPlayedThisTurn` counts the active player's plays; the card carrying the
 * Legion ability is itself one of those, so "another" means the count is ≥ 2.
 */
export function legionActive(state: GameState, side: PlayerSide): boolean {
  return side === state.activePlayer && state.cardsPlayedThisTurn >= 2
}

/** Level N — active while the controller has N or more XP. */
export function levelAbilityActive(controllerXp: number, n: number): boolean {
  return controllerXp >= n
}

/** Level N — as an ability guard: the controller has N or more XP. */
export function levelActive(state: GameState, side: PlayerSide, n: number): boolean {
  return getPlayer(state, side).xp >= n
}

/** Empowered — the ability's own permanent/legend/gear carries the status. */
export function isEmpowered(source: { empowered?: boolean } | undefined): boolean {
  return !!source?.empowered
}
