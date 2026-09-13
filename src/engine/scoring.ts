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
 * Award points for a Score (rule 466).
 *
 * 466.1 — "The player Gains up to one Point, depending on their current score."
 * Scoring does *not* draw a card in general. The only draw in the scoring rules
 * is 466.1.b.2: at one point short of the Victory Score, a Conquer without a
 * sweep gains no point and "that player draws a card" instead. That draw is
 * issued here, so the consolation can never drift away from the refusal that
 * earns it — `scoreConquer` used to draw on *every* conquer, which handed both
 * sides a free card almost every turn all game.
 */
function award(
  state: GameState,
  side: PlayerSide,
  amount: number,
  kind: 'hold' | 'conquer',
): GameState {
  let points = getPlayer(state, side).points
  let next = state

  // Otterpus — "If a player would score 1 point from conquering or holding
  // during their first or second turn, they draw 1 instead."
  //
  // Deliberately symmetric: the card says "a player", so an Otterpus belonging
  // to either side replaces either side's early point. `state.round` is the
  // right clock for "their first or second turn": `turn` counts both players'
  // turns from 0 and `round = floor(turn / 2) + 1`, so rounds 1-2 are exactly
  // each player's first two turns, whoever went first.
  const otterpusOut = allUnits(state).some((u) => u.card.name === 'Otterpus')
  const earlyTurns = state.round <= 2

  for (let i = 0; i < amount; i++) {
    // You win the instant you reach the Victory Score — further points from the
    // same hold/conquer don't accrue.
    if (points >= VICTORY_SCORE) break
    if (otterpusOut && earlyTurns) {
      next = drawOne(next, side)
      next = appendLog(next, `Otterpus: ${side} draws instead of scoring an early point.`)
      continue
    }
    const wouldWin = points + 1 >= VICTORY_SCORE
    const sweeping = controlledCount(state, side) === state.battlefields.length
    if (wouldWin && kind === 'conquer' && !sweeping) {
      // 466.1.b.2 — no point, but this is the one case that draws a card.
      next = drawOne(next, side)
      next = appendLog(
        next,
        `${side} reached the Victory Score by conquering, but not by a hold or a sweep — no point; draws 1 instead.`,
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
 * Take control of a battlefield by conquering it: +1 point, capped at once per
 * battlefield per turn (465). No draw — see `award` for the single case where
 * a Conquer draws instead of scoring (466.1.b.2).
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

  return checkVictory(next)
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
