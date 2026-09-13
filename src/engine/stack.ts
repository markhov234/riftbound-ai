import { Card } from '../types/card'
import {
  GameState,
  PlayerSide,
  ResolvedTarget,
  StackItem,
} from '../types/game'
import { EffectCtx } from './abilities/effects'
import { legendAbilities, scriptFor } from './abilities/scripts'
import { resolveShowdown } from './combat'
import { emit } from './events'
import { endTurn } from './phases'
import { appendLog, findGear, findUnit, otherSide, updatePlayer } from './state'
import {
  attachGear,
  buff,
  dealDamage,
  discardChoice,
  draw,
  enterGear,
  giveMight,
  giveMightPermanent,
  heal,
  predictChoice,
  recall,
  stun,
} from './abilities/effects'

let _stackCounter = 0
export function newStackId(): string {
  return `s${++_stackCounter}`
}

// ── Building stack items ──────────────────────────────────────────────────

export function makeSpellItem(
  controller: PlayerSide,
  card: Card,
  targets: ResolvedTarget[],
  banishOnResolve = false,
): StackItem {
  return {
    id: newStackId(),
    kind: card.type === 'gear' ? 'gear' : 'spell',
    controller,
    card,
    scriptKey: 'play',
    targets,
    label: `${controller}'s ${card.name}`,
    banishOnResolve,
  }
}

export function makeAbilityItem(
  controller: PlayerSide,
  sourceInstanceId: string,
  sourceName: string,
  abilityIndex: number,
  targets: ResolvedTarget[],
): StackItem {
  return {
    id: newStackId(),
    kind: 'ability',
    controller,
    scriptKey: `activated:${abilityIndex}`,
    sourceInstanceId,
    targets,
    label: `${controller}'s ${sourceName} ability`,
  }
}

export function pushToStack(state: GameState, item: StackItem): GameState {
  // The caster keeps priority after casting — they may keep acting (add to the
  // stack) and only when they pass does the opponent get a chance to respond.
  const next: GameState = {
    ...appendLog(state, `${item.label} goes on the stack.`),
    stack: [...state.stack, item],
    passesInARow: 0,
    priority: item.controller,
  }
  return next
}

// ── Resolution ───────────────────────────────────────────────────────────

/**
 * Best-effort resolution for spells that have no script yet — parses common
 * glossary actions straight out of the card's rules text.
 */
function fallbackSpellEffect(state: GameState, item: StackItem): GameState {
  if (!item.card) return state
  const text = item.card.text.toLowerCase()
  let s = state
  const emitFn = (ns: GameState, ne: Parameters<typeof emit>[1]) => emit(ns, ne)
  const targetId = item.targets.find((t) => t.kind === 'unit')?.instanceId

  const dmg = text.match(/deal(?:s)? (\d+)/)
  if (dmg && targetId) s = dealDamage(s, targetId, parseInt(dmg[1], 10), emitFn)

  const plusMight = text.match(/\+(\d+)\s*(?:\[m\]|might)/)
  const minusMight = text.match(/[-−](\d+)\s*(?:\[m\]|might)/)
  if (targetId && plusMight) {
    const n = parseInt(plusMight[1], 10)
    s = /this turn/.test(text) ? giveMight(s, targetId, n) : giveMightPermanent(s, targetId, n)
  }
  if (targetId && minusMight) s = giveMight(s, targetId, -parseInt(minusMight[1], 10))

  if (targetId && /\bbuff\b/.test(text)) s = buff(s, targetId)
  if (targetId && /\bstun(?:s|ned)?\b/.test(text)) s = stun(s, targetId)
  if (targetId && /\bheals?\b/.test(text)) s = heal(s, targetId)
  if (targetId && /\brecalls?\b/.test(text)) s = recall(s, targetId)

  // "…then draw N" (or "draw a card") — folded into the predict / discard
  // continuation when present.
  const drawM = text.match(/draw (\d+|a card|one card)/)
  const drawN = drawM ? (/\d/.test(drawM[1]) ? parseInt(drawM[1], 10) : 1) : 0
  const drawThen = (st: GameState) => (drawN > 0 ? draw(st, item.controller, drawN) : st)

  const pred = text.match(/\bpredict\s*(\d+)?/)
  const wantsDiscard =
    /\bdiscard (?:a card|\d+|one)\b/.test(text) && !/additional cost/.test(text)

  let drawHandled = false
  if (pred) {
    s = predictChoice(s, item.controller, pred[1] ? parseInt(pred[1], 10) : 2, drawThen)
    drawHandled = drawN > 0
  } else if (wantsDiscard) {
    const dm = text.match(/\bdiscard (\d+)/)
    s = discardChoice(s, item.controller, dm ? parseInt(dm[1], 10) : 1, drawThen)
    drawHandled = drawN > 0
  }

  if (drawM && !drawHandled) s = draw(s, item.controller, drawN)
  return s
}

export function resolveTop(state: GameState): GameState {
  if (state.stack.length === 0) return state
  const item = state.stack[state.stack.length - 1]
  let s: GameState = {
    ...state,
    stack: state.stack.slice(0, -1),
    lastResolved: { label: item.label, card: item.card ?? null, outcome: 'resolved' },
  }
  s = appendLog(s, `${item.label} resolves.`)

  if ((item.kind === 'spell' || item.kind === 'gear') && item.card) {
    const script = scriptFor(item.card)
    const gated = script?.play?.when && !script.play.when(s, undefined, item.controller)
    if (gated) {
      s = appendLog(s, `${item.card.name} has no effect.`)
    } else {
      // [Repeat] — run the instructions once, then `item.repeat` more times
      // (same targets; the paper game lets choices differ, we reuse them).
      const runs = 1 + (item.repeat ?? 0)
      for (let r = 0; r < runs; r++) {
        if (r > 0) s = appendLog(s, `${item.card.name} repeats.`)
        const ctx: EffectCtx = {
          state: s,
          controller: item.controller,
          targets: item.targets,
          paidAdditional: item.paidAdditional,
          fromFacedown: item.fromFacedown,
          emit: (ns, ne) => emit(ns, ne),
        }
        s = script?.play?.effect ? script.play.effect(ctx) : fallbackSpellEffect(s, item)
      }
    }
    if (item.kind === 'gear') {
      // Gear stays in play as a permanent — it does NOT go to the trash.
      s = enterGear(s, item.controller, item.card)
      // [Quick-Draw], and a facedown gear whose own text says to attach it
      // (Edge of Night) — attach the freshly-entered gear to the chosen unit.
      const selfAttaches =
        item.fromFacedown && /attach (?:it|this) to a unit you control/i.test(item.card.text)
      if (selfAttaches || /\[quick-draw\]/i.test(item.card.text)) {
        const owned = s[item.controller].gear
        const fresh = owned[owned.length - 1]
        const unitId = item.targets.find((t) => t.kind === 'unit')?.instanceId
        if (fresh && unitId) s = attachGear(s, fresh.instanceId, unitId)
      }
    } else {
      // Spell → controller's trash, or banished if Flow-cast.
      s = updatePlayer(s, item.controller, (ps) =>
        item.banishOnResolve
          ? { ...ps, banished: [...ps.banished, item.card as Card] }
          : { ...ps, trash: [...ps.trash, item.card as Card] },
      )
      if (item.banishOnResolve && item.card) {
        s = emit(s, { type: 'CARD_BANISHED', card: item.card, owner: item.controller })
      }
    }
  } else if (item.kind === 'ability') {
    const idx = parseInt(item.scriptKey.split(':')[1] ?? '0', 10)
    const isLegend = item.sourceInstanceId === 'legend:player' || item.sourceInstanceId === 'legend:ai'
    const src =
      !isLegend && item.sourceInstanceId
        ? findUnit(s, item.sourceInstanceId) ?? findGear(s, item.sourceInstanceId)
        : undefined
    const ability = isLegend
      ? legendAbilities(s[item.controller].legend)[idx]
      : src
        ? scriptFor(src.card)?.activated?.[idx]
        : undefined
    if (ability && (src || isLegend)) {
      const label = isLegend ? s[item.controller].legend.name : src!.card.name
      const gated = ability.when && !ability.when(s, src, item.controller)
      if (gated) {
        s = appendLog(s, `${label}'s ability has no effect.`)
      } else {
        s = ability.effect({
          state: s,
          controller: item.controller,
          source: src,
          targets: item.targets,
          emit: (ns, ne) => emit(ns, ne),
        })
      }
    }
  }
  return s
}

// ── Priority passing ─────────────────────────────────────────────────────

/**
 * A priority pass. When both players pass in succession:
 *  - stack non-empty  → resolve the top item, priority back to the active player
 *  - showdown pending → resolve combat
 *  - otherwise        → end the turn
 */
export function passPriority(state: GameState): GameState {
  if (state.winner) return state
  const passes = state.passesInARow + 1

  const bothPassed = passes >= 2

  if (state.stack.length > 0) {
    if (!bothPassed) {
      return {
        ...appendLog(state, `${state.priority} passes.`),
        passesInARow: passes,
        priority: otherSide(state.priority),
      }
    }
    const s = resolveTop({ ...state, passesInARow: 0 })
    if (s.winner) return s
    // Whoever's turn it is regains priority to keep acting / respond.
    return { ...s, priority: s.activePlayer, passesInARow: 0 }
  }

  if (state.pendingShowdown) {
    if (!bothPassed) {
      return {
        ...appendLog(state, `${state.priority} passes.`),
        passesInARow: passes,
        priority: otherSide(state.priority),
      }
    }
    return resolvePendingShowdown({ ...state, passesInARow: 0 })
  }

  // Empty stack, no showdown: a mutual pass ends the turn.
  if (!bothPassed) {
    return {
      ...appendLog(state, `${state.priority} passes.`),
      passesInARow: passes,
      priority: otherSide(state.priority),
    }
  }
  return endTurn({ ...state, passesInARow: 0 })
}

export function resolvePendingShowdown(state: GameState): GameState {
  if (!state.pendingShowdown) return state
  const { index, declarer } = state.pendingShowdown
  const s = resolveShowdown({ ...state, pendingShowdown: null }, index, declarer)
  if (s.winner) return s
  // Combat paused for the human to assign damage — hand them priority.
  if (s.pendingDamage) {
    return { ...s, priority: s.pendingDamage.assigningSide, passesInARow: 0 }
  }
  return { ...s, priority: s.activePlayer, passesInARow: 0 }
}
