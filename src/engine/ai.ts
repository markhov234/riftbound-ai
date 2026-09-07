import { Card } from '../types/card'
import { GameAction, GameState, PlayerSide } from '../types/game'
import { canMove, canPlay, dispatch, withinIdentity } from './actions'
import { autoAssignmentList } from './combat'
import { autoPickChoice } from './events'
import { scriptFor } from './abilities/scripts'
import { legalStackTargets, legalUnitTargets, TargetSpec } from './abilities/targets'
import { controllerOf, getPlayer, mightAt, otherSide, ownUnits, unitsAt } from './state'

// ── Evaluation ────────────────────────────────────────────────────────────

export function boardScore(state: GameState, side: PlayerSide): number {
  const opp = otherSide(side)
  const me = getPlayer(state, side)
  const them = getPlayer(state, opp)

  let score = (me.points - them.points) * 100

  for (const bf of state.battlefields) {
    const ctrl = controllerOf(bf)
    if (ctrl === side) score += 6 + mightAt(bf, side)
    else if (ctrl === opp) score -= 6 + mightAt(bf, opp)
    else if (ctrl === 'contested') score += mightAt(bf, side) - mightAt(bf, opp)
  }

  score += me.hand.length * 1.5
  score += ownUnits(state, side).length
  return score
}

// ── Target selection (shared with UI-less trigger resolution) ─────────────

function pickUnitForSpec(
  state: GameState,
  side: PlayerSide,
  spec: TargetSpec,
): string | undefined {
  const legal = legalUnitTargets(state, side, spec)
  if (legal.length === 0) return undefined
  const wantsFriendlyBuff = spec.kind === 'friendlyUnit'
  const sorted = [...legal].sort((a, b) =>
    wantsFriendlyBuff
      ? b.card.might + (b.counters.mightTurn ?? 0) - (a.card.might + (a.counters.mightTurn ?? 0))
      : b.card.might - a.card.might,
  )
  return sorted[0].instanceId
}

export function pickTargets(
  state: GameState,
  side: PlayerSide,
  specs: TargetSpec[] | undefined,
): { targetInstanceIds: string[]; targetStackId?: string } {
  const targetInstanceIds: string[] = []
  let targetStackId: string | undefined
  for (const spec of specs ?? []) {
    if (spec.kind === 'stackSpell') {
      targetStackId = legalStackTargets(state, spec)[0]?.id
      continue
    }
    if (spec.kind === 'player' || spec.kind === 'self') continue
    const count = spec.count ?? 1
    for (let i = 0; i < count; i++) {
      const id = pickUnitForSpec(state, side, spec)
      if (id && !targetInstanceIds.includes(id)) targetInstanceIds.push(id)
    }
  }
  return { targetInstanceIds, targetStackId }
}

// ── Candidate actions for a normal turn ──────────────────────────────────

function affordableHand(state: GameState, side: PlayerSide): Card[] {
  return getPlayer(state, side).hand.filter((c) => canPlay(state, side, c).ok)
}

function cardActions(state: GameState, side: PlayerSide, card: Card): GameAction[] {
  if (card.type === 'unit') {
    // Units enter at base; they reach battlefields by moving on a later turn.
    const out: GameAction[] = [{ type: 'PLAY_UNIT', card, to: { kind: 'base' } }]
    if (/play me to an open battlefield/i.test(card.text)) {
      for (let i = 0; i < state.battlefields.length; i++) {
        if (state.battlefields[i].units.length === 0) {
          out.push({ type: 'PLAY_UNIT', card, to: { kind: 'battlefield', index: i } })
        }
      }
    }
    return out
  }
  const specs = scriptFor(card)?.play?.targets
  const { targetInstanceIds, targetStackId } = pickTargets(state, side, specs)
  // Don't propose a targeted spell/gear the AI can't actually target.
  const needTargets = (specs ?? [])
    .filter((s) => s.kind !== 'player' && s.kind !== 'self' && !s.optional)
    .reduce((n, s) => n + (s.kind === 'stackSpell' ? 0 : s.count ?? 1), 0)
  const needStack = (specs ?? []).some((s) => s.kind === 'stackSpell' && !s.optional)
  if (targetInstanceIds.length < needTargets || (needStack && !targetStackId)) return []
  if (card.type === 'spell') {
    return [{ type: 'PLAY_SPELL', card, targetInstanceIds, targetStackId }]
  }
  return [{ type: 'PLAY_GEAR', card, targetInstanceIds }]
}

function candidateActions(
  state: GameState,
  side: PlayerSide,
  includeMoves: boolean,
): GameAction[] {
  const out: GameAction[] = []

  for (const card of affordableHand(state, side)) {
    out.push(...cardActions(state, side, card))
  }

  for (const bf of state.battlefields) {
    if (unitsAt(bf, side).length > 0 && controllerOf(bf) === 'contested') {
      out.push({ type: 'DECLARE_SHOWDOWN', index: bf.index })
    }
  }

  for (const u of ownUnits(state, side)) {
    const abilities = scriptFor(u.card)?.activated ?? []
    abilities.forEach((ab, i) => {
      const { targetInstanceIds } = pickTargets(state, side, ab.targets)
      out.push({ type: 'ACTIVATE_ABILITY', instanceId: u.instanceId, abilityIndex: i, targetInstanceIds })
    })
  }

  const p = getPlayer(state, side)
  if (p.runes.deck.length > 0) {
    const affordableWith = (energy: number, power: number, c: Card) =>
      energy >= c.energy && energy + power >= c.energy + c.power
    const blocked = p.hand.some(
      (c) =>
        (c.type === 'unit' || c.type === 'spell' || c.type === 'gear') &&
        withinIdentity(c, p.identity) &&
        !affordableWith(p.runes.energy, p.runes.power, c) &&
        affordableWith(p.runes.energy + 1, p.runes.power, c),
    )
    if (blocked) out.push({ type: 'CHANNEL_RUNE' })
  }

  // Moving units off the base to battlefields is how you take/attack them —
  // always a candidate now that units enter at base.
  void includeMoves
  for (const u of ownUnits(state, side)) {
    for (let i = 0; i < state.battlefields.length; i++) {
      if (u.location.kind === 'battlefield' && u.location.index === i) continue
      const to = { kind: 'battlefield' as const, index: i }
      if (canMove(state, side, u.instanceId, to).ok) {
        out.push({ type: 'MOVE_UNIT', instanceId: u.instanceId, to })
      }
    }
    // A stranded battlefield unit can also come home.
    if (u.location.kind === 'battlefield' && canMove(state, side, u.instanceId, { kind: 'base' }).ok) {
      out.push({ type: 'MOVE_UNIT', instanceId: u.instanceId, to: { kind: 'base' } })
    }
  }

  return out
}

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ── Response windows (stack non-empty, or a pending showdown) ─────────────

function respondOrPass(state: GameState, side: PlayerSide): GameAction {
  // Only ever respond with a reaction that clearly helps a showdown we'd lose.
  if (state.pendingShowdown) {
    const { index } = state.pendingShowdown
    const mine = mightAt(state.battlefields[index], side)
    const theirs = mightAt(state.battlefields[index], otherSide(side))
    if (mine <= theirs) {
      for (const card of affordableHand(state, side)) {
        if (card.type !== 'spell') continue
        const specs = scriptFor(card)?.play?.targets
        const action = buildSpellAction(state, side, card, specs)
        // Only respond with a spell that actually reaches the stack — a failed
        // cast still mutates state (it logs), so compare stack depth, not identity.
        const cast = dispatch(state, action, side)
        if (cast.stack.length > state.stack.length) return action
      }
    }
  }
  return { type: 'PASS_PRIORITY' }
}

function buildSpellAction(
  state: GameState,
  side: PlayerSide,
  card: Card,
  specs: TargetSpec[] | undefined,
): GameAction {
  const { targetInstanceIds, targetStackId } = pickTargets(state, side, specs)
  return { type: 'PLAY_SPELL', card, targetInstanceIds, targetStackId }
}

// ── Per-difficulty single-step policy ─────────────────────────────────────

function pickEasy(state: GameState, side: PlayerSide): GameAction {
  const cards = affordableHand(state, side)
  if (cards.length > 0 && Math.random() < 0.85) {
    const playable = cards.flatMap((c) => cardActions(state, side, c))
    if (playable.length > 0) return randomOf(playable)
  }
  const contested = state.battlefields.filter(
    (bf) => unitsAt(bf, side).length > 0 && controllerOf(bf) === 'contested',
  )
  if (contested.length > 0 && Math.random() < 0.5) {
    return { type: 'DECLARE_SHOWDOWN', index: randomOf(contested).index }
  }
  return { type: 'END_TURN' }
}

function pickGreedy(state: GameState, side: PlayerSide, includeMoves: boolean): GameAction {
  const base = boardScore(state, side)
  const candidates = candidateActions(state, side, includeMoves)

  let best: GameAction = { type: 'END_TURN' }
  let bestScore = base

  for (const action of candidates) {
    const after = dispatch(state, action, side)
    if (after === state) continue
    const s = boardScore(after, side) - (action.type === 'CHANNEL_RUNE' ? 0.1 : 0)
    if (s > bestScore) {
      bestScore = s
      best = action
    }
  }
  return best
}

// ── Public API ────────────────────────────────────────────────────────────

export function nextAIAction(state: GameState): GameAction {
  const side: PlayerSide = 'ai'
  const choice = state.pendingChoices[0]
  if (choice && choice.controller === side) {
    return { type: 'RESOLVE_CHOICE', pickedIds: autoPickChoice(state, side, choice, choice.legalIds) }
  }
  // Defensive: the AI never triggers a manual prompt, but if it's ever asked to
  // assign combat damage, do it Tank-first via the shared ordering.
  const pd = state.pendingDamage
  if (pd && pd.assigningSide === side) {
    const receiving = pd.stage === 'def' ? otherSide(pd.declarer) : pd.declarer
    const targets = unitsAt(state.battlefields[pd.index], receiving).filter((u) =>
      pd.targetIds.includes(u.instanceId),
    )
    return { type: 'ASSIGN_DAMAGE', assignments: autoAssignmentList(pd.pool, targets, state) }
  }
  if (state.phase === 'mulligan' && !state.ai.mulliganDone) {
    return { type: 'KEEP_HAND' }
  }
  // In a response window (opponent's turn, or resolving a stack / showdown).
  if (state.stack.length > 0 || state.activePlayer !== side || state.pendingShowdown) {
    return respondOrPass(state, side)
  }
  // Moving in no longer auto-fights — declare any showdown we're built to win
  // before spending the turn on anything else.
  for (const bf of state.battlefields) {
    if (
      unitsAt(bf, side).length > 0 &&
      controllerOf(bf) === 'contested' &&
      mightAt(bf, side) > mightAt(bf, otherSide(side))
    ) {
      return { type: 'DECLARE_SHOWDOWN', index: bf.index }
    }
  }
  switch (state.difficulty) {
    case 'easy':
      return pickEasy(state, side)
    case 'hard':
      return pickGreedy(state, side, true)
    case 'medium':
    default:
      return pickGreedy(state, side, false)
  }
}

/** All actions the AI would take from `state` while it holds priority. */
export function getAIActions(state: GameState): GameAction[] {
  const actions: GameAction[] = []
  let s = state
  let guard = 0
  while (!s.winner && s.priority === 'ai' && guard++ < 80) {
    const action = nextAIAction(s)
    actions.push(action)
    const before = s
    s = dispatch(s, action, 'ai')
    if (action.type === 'KEEP_HAND') break
    if (s === before) break
  }
  return actions
}

/** Advance the game while the AI has something to do (priority or a pending choice). */
export function runAITurn(state: GameState): GameState {
  let s = state

  // The mulligan step isn't priority-gated.
  if (s.phase === 'mulligan' && !s.ai.mulliganDone) {
    s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')
  }

  let guard = 0
  while (!s.winner && guard++ < 120) {
    if (s.pendingChoices[0]?.controller === 'ai') {
      const ch = s.pendingChoices[0]
      const before = s
      s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: autoPickChoice(s, 'ai', ch, ch.legalIds) }, 'ai')
      if (s === before) break
      continue
    }
    if (s.phase === 'mulligan') break
    if (s.priority !== 'ai') break

    const action = nextAIAction(s)
    const before = s
    s = dispatch(s, action, 'ai')
    if (s === before) {
      const forced = dispatch(s, { type: 'PASS_PRIORITY' }, 'ai')
      if (forced === s) break
      s = forced
    }
  }
  return s
}
