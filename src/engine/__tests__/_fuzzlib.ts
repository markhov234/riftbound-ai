import { expect } from 'vitest'
import { AIDifficulty, GameAction, GameState, PlayerSide } from '../../types/game'
import { Card, Deck } from '../../types/card'
import { canMove, canPlay, dispatch } from '../actions'
import { runAITurn } from '../ai'
import { autoAssignmentList } from '../combat'
import { initGame } from '../setup'
import { otherSide, unitsAt } from '../state'

/** Shared machinery for the full-game invariant fuzzers. */

const BAD_LOG = /not implemented|undefined|NaN|Cannot read|Can't (play|cast|move)/i

export function checkInvariants(s: GameState, tag: string): void {
  for (const side of ['player', 'ai'] as PlayerSide[]) {
    const p = s[side]
    expect(p.runes.energy, `${tag}: ${side} energy >= 0`).toBeGreaterThanOrEqual(0)
    expect(p.runes.power, `${tag}: ${side} power >= 0`).toBeGreaterThanOrEqual(0)
    expect(p.points, `${tag}: ${side} points >= 0`).toBeGreaterThanOrEqual(0)
    expect(p.points, `${tag}: ${side} points <= 8`).toBeLessThanOrEqual(8)
  }
  expect(s.battlefields.length, `${tag}: 2 battlefields`).toBe(2)
  expect(s.stack.length, `${tag}: stack bounded`).toBeLessThan(20)
  expect(s.pendingChoices.length, `${tag}: choices bounded`).toBeLessThan(12)

  const seen = new Set<string>()
  for (const u of [...s.player.base, ...s.ai.base, ...s.battlefields.flatMap((b) => b.units)]) {
    expect(u.damage, `${tag}: ${u.card.name} damage >= 0`).toBeGreaterThanOrEqual(0)
    expect(seen.has(u.instanceId), `${tag}: ${u.card.name} not in two zones`).toBe(false)
    seen.add(u.instanceId)
  }

  for (const side of ['player', 'ai'] as PlayerSide[]) {
    for (const c of [...s[side].mainDeck, ...s[side].hand]) {
      expect(
        c.supertype !== 'token' && c.type !== 'token',
        `${tag}: no token in ${side} deck/hand (${c.name})`,
      ).toBe(true)
    }
  }

  const tail = s.log.slice(-3).join(' | ')
  expect(BAD_LOG.test(tail), `${tag}: clean log tail — "${tail}"`).toBe(false)
}

/** Minimal always-legal player: resolve choices, drop units, shove one forward, else end. */
export function playerBot(s: GameState, rng: () => number): GameAction {
  if (s.pendingChoices[0]?.controller === 'player') {
    const ch = s.pendingChoices[0]
    return { type: 'RESOLVE_CHOICE', pickedIds: ch.legalIds.slice(0, Math.max(ch.min, 0)) }
  }
  const pd = s.pendingDamage
  if (pd && pd.assigningSide === 'player') {
    const recv = pd.stage === 'def' ? otherSide(pd.declarer) : pd.declarer
    const targets = unitsAt(s.battlefields[pd.index], recv).filter((u) =>
      pd.targetIds.includes(u.instanceId),
    )
    return { type: 'ASSIGN_DAMAGE', assignments: autoAssignmentList(pd.pool, targets, s) }
  }
  // In a response window (stack / showdown / damage) just pass — the bot never
  // holds reactions.
  const cleanTurn =
    s.activePlayer === 'player' &&
    s.phase === 'action' &&
    s.stack.length === 0 &&
    !s.pendingShowdown &&
    !s.pendingDamage
  if (!cleanTurn) return { type: 'PASS_PRIORITY' }

  const units = s.player.hand.filter((c) => c.type === 'unit' && canPlay(s, 'player', c).ok)
  if (units.length > 0 && rng() < 0.85) {
    return { type: 'PLAY_UNIT', card: units[Math.floor(rng() * units.length)], to: { kind: 'base' } }
  }
  // Sometimes declare a showdown at a battlefield we're contesting.
  const contested = s.battlefields.filter(
    (bf) =>
      unitsAt(bf, 'player').length > 0 &&
      unitsAt(bf, otherSide('player')).length > 0,
  )
  if (contested.length > 0 && rng() < 0.6) {
    return { type: 'DECLARE_SHOWDOWN', index: contested[Math.floor(rng() * contested.length)].index }
  }
  for (const u of s.player.base) {
    const to = { kind: 'battlefield' as const, index: Math.floor(rng() * 2) }
    if (rng() < 0.5 && canMove(s, 'player', u.instanceId, to).ok) {
      return { type: 'MOVE_UNIT', instanceId: u.instanceId, to }
    }
  }
  return { type: 'END_TURN' }
}

export function playGame(opts: {
  playerDeck: Deck
  aiDeck: Deck
  pool: Card[]
  seed: number
  rng: () => number
  difficulty: AIDifficulty
  label: string
  maxSteps?: number
}): GameState {
  const { playerDeck, aiDeck, pool, seed, rng, difficulty, label } = opts
  let s = initGame(playerDeck, aiDeck, pool, {
    firstPlayer: seed % 2 === 0 ? 'player' : 'ai',
    difficulty,
    rng,
  })
  s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
  s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')

  let steps = 0
  let stalled = 0
  const cap = opts.maxSteps ?? 700
  while (!s.winner && steps++ < cap) {
    const tag = `${label} step ${steps} turn ${s.turn}`
    const before = s
    const aiChoice = s.pendingChoices[0]?.controller === 'ai'
    const playerChoice = s.pendingChoices[0]?.controller === 'player'
    const playerDamage = s.pendingDamage?.assigningSide === 'player'
    if (!playerChoice && !playerDamage && (aiChoice || s.priority === 'ai')) {
      s = runAITurn(s)
    } else {
      s = dispatch(s, playerBot(s, rng), 'player')
      if (s === before) s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')
    }
    stalled = s === before ? stalled + 1 : 0
    expect(stalled, `${tag}: game is not stuck (no state change for ${stalled} steps)`).toBeLessThan(4)
    checkInvariants(s, tag)
    expect(s.turn, `${tag}: turn count bounded`).toBeLessThan(400)
  }
  expect(steps, `${label}: made progress`).toBeGreaterThan(1)
  return s
}
