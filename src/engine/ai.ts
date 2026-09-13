import { Card } from '../types/card'
import { Battlefield, GameAction, GameState, PlayerSide } from '../types/game'
import { canMove, canPlay, dispatch } from './actions'
import { autoAssignmentList } from './combat'
import { autoPickChoice } from './events'
import { scriptFor } from './abilities/scripts'
import { showdownMight } from './keywords'
import { legalStackTargets, legalUnitTargets, TargetSpec } from './abilities/targets'
import { allUnits, controllerOf, getPlayer, otherSide, ownUnits, unitsAt } from './state'

// ── Evaluation ────────────────────────────────────────────────────────────

/** Effective Might of `side`'s units at a battlefield, in a given combat role. */
function effMightAt(state: GameState, bf: Battlefield, side: PlayerSide, role: 'attacker' | 'defender'): number {
  return unitsAt(bf, side).reduce((n, u) => n + showdownMight(state, u, role), 0)
}

/**
 * How good `state` is for `side`. Higher is better. Tuned so that *developing a
 * board* and *spending resources* are positive — the old version rewarded a fat
 * hand and bare unit count, so the greedy AI would just pass every turn.
 */
export function boardScore(state: GameState, side: PlayerSide): number {
  const opp = otherSide(side)
  const me = getPlayer(state, side)
  const them = getPlayer(state, opp)

  let score = (me.points - them.points) * 100

  // ── Battlefields ──────────────────────────────────────────────────────
  for (const bf of state.battlefields) {
    const ctrl = controllerOf(bf)
    const myAtk = effMightAt(state, bf, side, 'attacker')
    const theirDef = effMightAt(state, bf, opp, 'defender')
    if (ctrl === side) {
      score += 12
      // Pressure the opponent is putting on a bf we hold is a threat.
      score -= Math.min(theirDef, effMightAt(state, bf, opp, 'attacker')) * 0.8
    } else if (ctrl === opp) {
      score -= 12
      // Might we've parked here (or could send) — close to flipping it.
      score += myAtk * 1.2
    } else if (ctrl === 'contested') {
      score += (myAtk - theirDef) * 2.5
    } else {
      // Open — a unit sitting here can just walk in and conquer.
      score += myAtk * 0.6
    }
  }

  // ── Board development — units are worth their effective Might; the ones
  //    already at a battlefield count for more (they threaten points). ──
  for (const u of allUnits(state)) {
    const m = showdownMight(state, u, 'attacker')
    const placed = u.location.kind === 'battlefield' ? 1.6 : 1
    score += (u.owner === side ? 1 : -1) * (2.5 + m * 0.7) * placed
  }

  // ── Standing advantages ──────────────────────────────────────────────
  score += (me.gear.length - them.gear.length) * 2.5
  score += allUnits(state).filter((u) => u.owner === side && u.empowered).length * 2
  score += (me.xp - them.xp) * 0.6
  if (me.championPlayed) score += 3
  if (them.championPlayed) score -= 3

  // ── Resources ─────────────────────────────────────────────────────────
  // A card in hand is worth roughly what it costs. A flat per-card value was
  // half of the "plays cards for no reason" bug: pitching a 3-cost blank freed
  // 3 energy but only ever cost 0.4, so the trade always looked good. Pricing
  // the card above the energy it releases is what stops it.
  score += me.hand.slice(0, 8).reduce((n, c) => n + 0.4 + 0.18 * (c.energy + c.power), 0)
  score += me.runes.channeled.length * 0.3
  // Energy resets to `channeled.length` each upkeep, so leftovers are wasted.
  // Keep this well under the 0.3 ramp bonus above: at 0.7 a channel scored
  // 0.3 - 0.7 = -0.4, so the AI refused to ramp and sat on ~1 energy all game.
  score -= Math.max(0, me.runes.energy - 1) * 0.12
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

  // Whether this target is a good thing or a bad thing to receive. Kinds that
  // name a side settle it; otherwise the script's own `intent` does. An open
  // kind like `unitAtBattlefield` used to just take the biggest Might on the
  // board — which for a bounce or a damage spell was frequently the AI's own
  // best unit. (`settle` now catches the consequence, but picking a sane target
  // in the first place means the good version of the play is on the menu at all.)
  const good =
    spec.kind === 'friendlyUnit' ? true : spec.kind === 'enemyUnit' ? false : spec.intent !== 'harm'

  const mightOf = (u: (typeof legal)[number]) => u.card.might + (u.counters.mightTurn ?? 0)
  const sorted = [...legal].sort((a, b) => {
    // Prefer our own units for a buff, theirs for anything harmful.
    const aMine = a.owner === side ? 1 : 0
    const bMine = b.owner === side ? 1 : 0
    if (aMine !== bMine) return good ? bMine - aMine : aMine - bMine
    return mightOf(b) - mightOf(a) // then the biggest one either way
  })
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
  const ps = getPlayer(state, side)
  // The Chosen Champion is playable from the Champion Zone, not the hand.
  const zone = !ps.championPlayed && ps.championZone ? [ps.championZone] : []
  return [...ps.hand, ...zone].filter((c) => canPlay(state, side, c).ok)
}

function cardActions(state: GameState, side: PlayerSide, card: Card): GameAction[] {
  if (card.type === 'unit') {
    // Units enter at base; they reach battlefields by moving on a later turn.
    const out: GameAction[] = [{ type: 'PLAY_UNIT', card, to: { kind: 'base' } }]
    // Accelerate — enter ready, so the unit can move/attack the same turn. Worth
    // trying whenever it's affordable; the eval decides if the tempo is worth it.
    if (card.keywords.some((k) => k.toLowerCase() === 'accelerate')) {
      const accel = dispatch(state, { type: 'PLAY_UNIT', card, to: { kind: 'base' }, paidAccelerate: true }, side)
      if (accel !== state && accel.ai.base.length + accel.player.base.length > state.ai.base.length + state.player.base.length) {
        out.push({ type: 'PLAY_UNIT', card, to: { kind: 'base' }, paidAccelerate: true })
      }
    }
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

function candidateActions(state: GameState, side: PlayerSide): GameAction[] {
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


  // Moving units off the base to battlefields is how you take/attack them.
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

/**
 * Resolve whatever an action just put on the stack, so a spell is scored by
 * what it *does* rather than by the fact that it was cast.
 *
 * Without this the main-phase search saw only "card left the hand, energy was
 * spent" — so it cast blanks happily, and cast actively harmful spells too
 * (bouncing its own best unit scored -16 once it resolved, but 0 at cast time).
 * `respondOrPass` had always done this; `pickGreedy` had not.
 */
function settle(state: GameState): GameState {
  let s = state
  for (let guard = 0; guard < 8 && s.stack.length > 0; guard++) {
    const before = s
    s = dispatch(s, { type: 'PASS_PRIORITY' }, s.priority)
    if (s === before) break // someone owes a choice — as resolved as it gets
  }
  return s
}

// ── Response windows (stack non-empty, or a pending showdown) ─────────────

function respondOrPass(state: GameState, side: PlayerSide): GameAction {
  // Only look for an instant-speed play when something is actually on the stack
  // or a showdown is open — otherwise (bare priority on the opponent's turn)
  // just pass and let them act.
  if (state.stack.length === 0 && !state.pendingShowdown) return { type: 'PASS_PRIORITY' }

  const base = boardScore(state, side)
  let best: GameAction | null = null
  let bestScore = base + 1 // require a clear gain, not noise

  for (const card of affordableHand(state, side)) {
    if (card.type !== 'spell') continue
    const specs = scriptFor(card)?.play?.targets
    const action = buildSpellAction(state, side, card, specs)
    const cast = dispatch(state, action, side)
    // A failed cast still logs (mutates state) — require the spell to reach the stack.
    if (cast.stack.length <= state.stack.length) continue
    // Value it by where a resolution would leave us.
    const s = boardScore(settle(cast), side)
    if (s > bestScore) {
      bestScore = s
      best = action
    }
  }

  for (const u of ownUnits(state, side)) {
    const abilities = scriptFor(u.card)?.activated ?? []
    abilities.forEach((ab, i) => {
      const { targetInstanceIds } = pickTargets(state, side, ab.targets)
      const action: GameAction = {
        type: 'ACTIVATE_ABILITY',
        instanceId: u.instanceId,
        abilityIndex: i,
        targetInstanceIds,
      }
      const after = dispatch(state, action, side)
      if (after === state) return
      const s = boardScore(after, side)
      if (s > bestScore) {
        bestScore = s
        best = action
      }
    })
  }

  return best ?? { type: 'PASS_PRIORITY' }
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

/** Best score reachable in ONE more move from `state`, over just the moves that
 *  can spike it (conquers, showdowns, plays) — the cheap leaf for 2-ply. */
function bestReplyScore(state: GameState, side: PlayerSide): number {
  let best = boardScore(state, side)
  for (const action of candidateActions(state, side)) {
    if (action.type === 'ACTIVATE_ABILITY') continue
    const after = dispatch(state, action, side)
    if (after === state) continue
    // Settle here too — otherwise the depth-2 leaf reintroduces exactly the bug
    // `settle` exists to fix, one ply deeper, and hard plays more blanks than medium.
    const s = boardScore(settle(after), side)
    if (s > best) best = s
  }
  return best
}

/**
 * Greedy policy: take the action that most improves `boardScore` (with a small
 * nudge toward channelling so ramp isn't ignored). At `depth` 2 the setup moves
 * (play a unit / move it) are scored by what they let the AI reach *next* — so it
 * will "play a unit so it can conquer" instead of only acting on immediate payoff.
 */
function pickGreedy(
  state: GameState,
  side: PlayerSide,
  depth: 1 | 2 = 1,
  margin = 0.01,
): GameAction {
  const base = boardScore(state, side)
  const candidates = candidateActions(state, side)

  let best: GameAction = { type: 'END_TURN' }
  // `margin` is how much better than doing nothing an action has to be. At the
  // old flat 0.01 any rounding-level gain was enough to commit a card, which is
  // most of what "using cards for no reason" looks like from the other side of
  // the table. Depth-2 can see a payoff a ply later, so it needs less slack.
  let bestScore = base + margin

  const lookahead = (a: GameAction) =>
    depth === 2 &&
    (a.type === 'PLAY_UNIT' || a.type === 'MOVE_UNIT' || a.type === 'PLAY_GEAR' || a.type === 'PLAY_SPELL')

  for (const action of candidates) {
    const raw = dispatch(state, action, side)
    if (raw === state) continue
    // Score the position the action actually leads to, stack resolved.
    const after = settle(raw)
    const immediate = boardScore(after, side)
    // Skip the 2-ply probe when the move already wins big (a conquer) or clearly loses.
    const leaf =
      lookahead(action) && after.priority === side && immediate > base - 20 && immediate < base + 60
        ? bestReplyScore(after, side)
        : immediate
    const s = leaf
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
    return {
      type: 'ASSIGN_DAMAGE',
      assignments: autoAssignmentList(
        pd.pool,
        targets,
        state,
        pd.stage === 'def' ? 'defender' : 'attacker',
      ),
    }
  }
  if (state.phase === 'mulligan' && !state.ai.mulliganDone) {
    return { type: 'KEEP_HAND' }
  }
  // In a response window (opponent's turn, or resolving a stack / showdown).
  if (state.stack.length > 0 || state.activePlayer !== side || state.pendingShowdown) {
    return respondOrPass(state, side)
  }
  // Moving in no longer auto-fights — declare any showdown we're built to win
  // before spending the turn on anything else. Compare *effective* Might
  // (attacker Assault vs defender Shield), not raw printed Might.
  for (const bf of state.battlefields) {
    if (
      unitsAt(bf, side).length > 0 &&
      controllerOf(bf) === 'contested' &&
      effMightAt(state, bf, side, 'attacker') > effMightAt(state, bf, otherSide(side), 'defender')
    ) {
      return { type: 'DECLARE_SHOWDOWN', index: bf.index }
    }
  }
  switch (state.difficulty) {
    case 'easy':
      return pickEasy(state, side)
    case 'hard':
      return pickGreedy(state, side, 2, 0.3)
    case 'medium':
    default:
      return pickGreedy(state, side, 1, 0.35)
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
/**
 * One AI decision. `done` is true once the AI has nothing left to do — it has
 * lost priority, the game is over, or it made no progress.
 *
 * Split out of `runAITurn` so the UI can play a turn back **one action at a
 * time** with a delay between steps, instead of applying the whole turn in a
 * single state update. Watching a unit appear, then a spell go on the stack,
 * then a showdown resolve is far easier to follow than being handed the end
 * state and a recap.
 */
export function stepAITurn(state: GameState): { state: GameState; done: boolean } {
  // The mulligan step isn't priority-gated.
  if (state.phase === 'mulligan' && !state.ai.mulliganDone) {
    return { state: dispatch(state, { type: 'KEEP_HAND' }, 'ai'), done: false }
  }
  if (state.winner) return { state, done: true }

  if (state.pendingChoices[0]?.controller === 'ai') {
    const ch = state.pendingChoices[0]
    const next = dispatch(
      state,
      { type: 'RESOLVE_CHOICE', pickedIds: autoPickChoice(state, 'ai', ch, ch.legalIds) },
      'ai',
    )
    return { state: next, done: next === state }
  }
  if (state.phase === 'mulligan' || state.priority !== 'ai') return { state, done: true }

  const next = dispatch(state, nextAIAction(state), 'ai')
  if (next !== state) return { state: next, done: false }

  // The chosen action was rejected — pass rather than spin.
  const forced = dispatch(state, { type: 'PASS_PRIORITY' }, 'ai')
  return { state: forced, done: forced === state }
}

/** Run the AI to completion. Equivalent to stepping until `done`. */
export function runAITurn(state: GameState): GameState {
  let s = state
  let guard = 0
  while (guard++ < 120) {
    const { state: next, done } = stepAITurn(s)
    s = next
    if (done) break
  }
  return s
}
