import { GameState, PlayerSide, RUNES_PER_TURN } from '../types/game'
import { killUnit } from './abilities/effects'
import { forceContestedShowdowns } from './combat'
import { emit } from './events'
import { clearOrphanedFacedown } from './hidden'
import { hasTemporary } from './keywords'
import { refreshRunes } from './runes'
import { controlledCount, scoreHolds } from './scoring'
import { appendLog, mapAllGear, mapAllUnits, otherSide, ownUnits, updatePlayer } from './state'

/** Which counter keys survive an end-of-turn cleanup. */
function cleanCounters(counters: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(counters)) {
    if (k === 'mightTurn' || k.startsWith('kw:') || k === 'combatWinsThisTurn') continue
    if (k === 'stunned') {
      if (v > 1) out[k] = v - 1
      continue
    }
    out[k] = v
  }
  return out
}

/** Strip end-of-turn state from one side's units and gear. */
function endOfTurnCleanup(state: GameState, side: GameState['activePlayer']): GameState {
  let next = mapAllUnits(state, (u) =>
    u.owner === side ? { ...u, counters: cleanCounters(u.counters) } : u,
  )
  next = mapAllGear(next, (g) =>
    g.owner === side ? { ...g, counters: cleanCounters(g.counters) } : g,
  )
  return next
}

/** Run the active player's start-of-turn sequence, ending in the action phase. */
export function beginTurn(state: GameState): GameState {
  const side = state.activePlayer
  let next: GameState = {
    ...state,
    phase: 'awaken',
    passesInARow: 0,
    stack: [],
    pendingShowdown: null,
    pendingDamage: null,
    cardsPlayedThisTurn: 0,
    flowGranted: [],
    lastResolved: null,
    // Reset the per-battlefield 1-point-per-turn cap for the new turn.
    battlefields: state.battlefields.map((bf) => ({ ...bf, scoredThisTurn: [] })),
  }

  // 1. Ready this player's units — unless Stunned this turn.
  const readiedIds = ownUnits(next, side)
    .filter((u) => u.exhausted && (u.counters.stunned ?? 0) === 0)
    .map((u) => u.instanceId)
  next = mapAllUnits(next, (u) => {
    if (u.owner !== side) return u
    if ((u.counters.stunned ?? 0) > 0) return u
    return { ...u, exhausted: false, sick: false }
  })
  // 1a. Ready this player's gear and legend.
  next = mapAllGear(next, (g) => (g.owner === side ? { ...g, exhausted: false } : g))
  next = updatePlayer(next, side, (ps) => ({ ...ps, legendExhausted: false, freeGearThisTurn: false, forgeDiscountUsed: false, nextCardDiscount: undefined }))
  // 1b. "When I become ready" triggers (Jayce, Hammer in Hand).
  for (const id of readiedIds) {
    next = emit(next, { type: 'UNIT_READIED', instanceId: id, controller: side })
    if (next.winner) return next
  }

  // 1c. Start-of-Beginning-Phase battlefield abilities, which the rules place
  //     explicitly *before* scoring ("This happens before scoring.").
  next = emit(next, { type: 'TURN_BEGAN', side, turn: next.turn })
  if (next.winner) return next

  // 1d. Temporary — kill this player's Temporary units before scoring.
  for (const u of ownUnits(next, side).filter(hasTemporary)) {
    next = appendLog(next, `Temporary — ${u.card.name} is removed.`)
    next = killUnit(next, u.instanceId, (s, e) => emit(s, e))
    if (next.winner) return next
  }

  // 2. Score points for every battlefield this player holds.
  const held = controlledCount(next, side)
  next = scoreHolds(next, side)
  if (next.winner) return next
  if (held > 0) next = emit(next, { type: 'HELD', side, count: held })
  if (next.winner) return next

  // 3. Channel runes (second player gets +1 on their first turn only).
  const goingSecond = side !== firstPlayerOf(next)
  const bonus = goingSecond && !next.firstChannelBonusUsed ? 1 : 0
  next = refreshRunes(next, side, RUNES_PER_TURN + bonus)
  if (bonus > 0) {
    next = appendLog(next, `${side} channels an extra rune for going second.`)
    next = { ...next, firstChannelBonusUsed: true }
  }

  // 3b. Banked energy (Annie legend, etc.).
  next = updatePlayer(next, side, (ps) => {
    if (ps.bankedEnergy <= 0) return ps
    return {
      ...ps,
      runes: { ...ps.runes, energy: ps.runes.energy + ps.bankedEnergy },
      bankedEnergy: 0,
    }
  })

  // 4. Draw a card — you lose if you can't (deck-out). The player on the play
  //    skips their very first draw (turn 0) to offset the first-turn advantage.
  if (next.turn === 0) {
    next = appendLog(next, `${side} is on the play — no draw on the first turn.`)
  } else if (next[side].mainDeck.length === 0) {
    const winner = otherSide(side)
    return appendLog(
      { ...next, winner },
      `${side} cannot draw — ${winner} wins (deck-out).`,
    )
  } else {
    next = updatePlayer(next, side, (ps) => {
      const [drawn, ...rest] = ps.mainDeck
      return { ...ps, hand: [...ps.hand, drawn], mainDeck: rest }
    })
    next = appendLog(next, `${side} draws for the turn.`)
  }

  return { ...next, phase: 'action', priority: side }
}

export function endTurn(state: GameState): GameState {
  if (state.winner) return state
  const ending = state.activePlayer

  // Any battlefield the ending player still contests without declaring a
  // showdown is forced to fight now (auto-assigned) — moving in commits you.
  const s = forceContestedShowdowns(state, ending)
  if (s.winner) return s

  // Riftbound has NO maximum hand size (RiftJudge ruling) — no end-of-turn discard.
  return finishEndTurn(s, ending)
}

/** The tail of `endTurn` after showdowns. */
function finishEndTurn(state: GameState, ending: PlayerSide): GameState {
  // 107.3.d — a hidden card whose owner lost the battlefield goes away at the
  // next cleanup.
  let s = clearOrphanedFacedown(endOfTurnCleanup(state, ending))
  s = emit(s, { type: 'TURN_ENDED', side: ending })
  if (s.winner) return s

  const nextSide = otherSide(ending)
  const turn = s.turn + 1
  const advanced: GameState = {
    ...s,
    phase: 'end',
    activePlayer: nextSide,
    priority: nextSide,
    turn,
    round: Math.floor(turn / 2) + 1,
  }
  return beginTurn(appendLog(advanced, `— ${nextSide}'s turn —`))
}

/** Any non-pass action resets the consecutive-pass counter. */
export function actedThisPriority(state: GameState): GameState {
  return state.passesInARow === 0 ? state : { ...state, passesInARow: 0 }
}

// The first player is whoever was active on turn 0. `turn` counts up from 0,
// alternating, so even turns belong to the first player.
export function firstPlayerOf(state: GameState): GameState['activePlayer'] {
  const activeIsFirst = state.turn % 2 === 0
  return activeIsFirst ? state.activePlayer : otherSide(state.activePlayer)
}
