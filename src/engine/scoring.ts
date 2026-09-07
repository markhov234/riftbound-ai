import { GameState, PlayerSide, VICTORY_SCORE } from '../types/game'
import { allUnits, appendLog, controllerOf, getPlayer, updatePlayer, updateBattlefield } from './state'

export function controlledCount(state: GameState, side: PlayerSide): number {
  return state.battlefields.filter((bf) => controllerOf(bf) === side).length
}

function drawOne(state: GameState, side: PlayerSide): GameState {
  return updatePlayer(state, side, (ps) => {
    if (ps.mainDeck.length === 0) return ps
    const [drawn, ...rest] = ps.mainDeck
    return { ...ps, hand: [...ps.hand, drawn], mainDeck: rest }
  })
}

/**
 * Award points, enforcing the final-point rule: your last point (the one that
 * would take you to VICTORY_SCORE) may only come from holding a battlefield or
 * from controlling every battlefield this turn. Any other final point is
 * refused — you stay at VICTORY_SCORE - 1 and draw a card instead.
 */
function award(
  state: GameState,
  side: PlayerSide,
  amount: number,
  kind: 'hold' | 'conquer',
): GameState {
  let points = getPlayer(state, side).points
  let next = state

  // Otterpus (replacement): a player's 1st/2nd-turn conquer/hold point becomes a
  // draw instead. Symmetric — any Otterpus in play affects whoever is scoring.
  const otterpusOut = allUnits(state).some((u) => u.card.name === 'Otterpus')

  for (let i = 0; i < amount; i++) {
    // You win the instant you reach the Victory Score — further points from the
    // same hold/conquer don't accrue.
    if (points >= VICTORY_SCORE) break
    if (otterpusOut && state.round <= 2 && (kind === 'conquer' || kind === 'hold')) {
      next = drawOne(next, side)
      next = appendLog(next, `Otterpus: ${side} draws instead of scoring an early point.`)
      continue
    }
    const wouldWin = points + 1 >= VICTORY_SCORE
    const sweeping = controlledCount(state, side) === state.battlefields.length
    if (wouldWin && kind === 'conquer' && !sweeping) {
      // Point refused; the caller (scoreConquer) still grants the conquer draw.
      next = appendLog(
        next,
        `${side} reached the Victory Score by conquering, but not by a hold or a sweep — no point.`,
      )
      continue
    }
    points += 1
  }

  return updatePlayer(next, side, (ps) => ({ ...ps, points }))
}

export function scoreHolds(state: GameState, side: PlayerSide): GameState {
  const holds = state.battlefields.filter(
    (bf) => controllerOf(bf) === side && !bf.scoredThisTurn.includes(side),
  )
  if (holds.length === 0) return state
  let next = appendLog(state, `${side} holds ${holds.length} battlefield(s): +${holds.length} point(s).`)
  for (const bf of holds) {
    next = updateBattlefield(next, bf.index, (b) => ({
      ...b,
      scoredThisTurn: [...b.scoredThisTurn, side],
    }))
  }
  next = award(next, side, holds.length, 'hold')
  return checkVictory(next)
}

/**
 * Take control of a battlefield by conquering it: +1 point (capped at once per
 * battlefield per turn), and draw a card if it doesn't win the game.
 */
export function scoreConquer(state: GameState, side: PlayerSide, index: number): GameState {
  const bf = state.battlefields[index]
  if (!bf) return state
  let next = state

  if (!bf.scoredThisTurn.includes(side)) {
    next = appendLog(next, `${side} conquers battlefield ${index + 1}: +1 point.`)
    next = updateBattlefield(next, index, (b) => ({
      ...b,
      scoredThisTurn: [...b.scoredThisTurn, side],
    }))
    next = award(next, side, 1, 'conquer')
  } else {
    next = appendLog(next, `${side} conquers battlefield ${index + 1} (already scored here this turn).`)
  }

  next = checkVictory(next)
  if (!next.winner) next = drawOne(next, side) // "conquer that doesn't win → draw a card"
  return next
}

export function checkVictory(state: GameState): GameState {
  if (state.winner) return state
  if (state.player.points >= VICTORY_SCORE) {
    return appendLog({ ...state, winner: 'player' }, 'Player wins the game!')
  }
  if (state.ai.points >= VICTORY_SCORE) {
    return appendLog({ ...state, winner: 'ai' }, 'AI wins the game!')
  }
  return state
}
