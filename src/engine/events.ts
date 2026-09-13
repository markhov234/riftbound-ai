import { Card } from '../types/card'
import {
  EngineEvent,
  GameState,
  PendingChoice,
  PlayerSide,
  ResolvedTarget,
  UnitInPlay,
} from '../types/game'
import { EffectCtx, gainXP } from './abilities/effects'
import { battlefieldScript, BattlefieldTrigger } from './abilities/battlefields'
import { scriptFor } from './abilities/scripts'
import { legalStackTargets, legalUnitTargets } from './abilities/targets'
import { TriggeredAbility, TriggerChoice } from './abilities/types'
import { keywordValue } from './keywords'
import { allUnits, appendLog, controllerOf, newChoiceId } from './state'

/** Heuristic auto-pick for the AI (or a forced pick with no real decision). */
export function autoPickChoice(
  state: GameState,
  controller: PlayerSide,
  choice: { kind: TriggerChoice['kind'] | 'location' | 'confirm' | 'permanent'; max: number },
  legal: string[],
): string[] {
  const ps = controller === 'player' ? state.player : state.ai
  if (choice.kind === 'handCard') {
    // Discard the cheapest / least useful card.
    const ranked = [...legal].sort((a, b) => {
      const ca = ps.hand.find((c) => c.id === a)
      const cb = ps.hand.find((c) => c.id === b)
      return (ca?.energy ?? 0) - (cb?.energy ?? 0)
    })
    return ranked.slice(0, choice.max)
  }
  if (choice.kind === 'trashCard') {
    // Retrieve the highest-energy (usually most impactful) card.
    const ranked = [...legal].sort((a, b) => {
      const ca = ps.trash.find((c) => c.id === a)
      const cb = ps.trash.find((c) => c.id === b)
      return (cb?.energy ?? 0) - (ca?.energy ?? 0)
    })
    return ranked.slice(0, choice.max)
  }
  if (choice.kind === 'deckTop') {
    // Recycle the single lowest-energy card among the revealed top cards.
    const ranked = [...legal].sort((a, b) => {
      const ca = ps.mainDeck.find((c) => c.id === a)
      const cb = ps.mainDeck.find((c) => c.id === b)
      return (ca?.energy ?? 0) - (cb?.energy ?? 0)
    })
    return ranked.slice(0, Math.min(1, choice.max))
  }
  if (choice.kind === 'keyword') {
    // Prefer a tempo keyword (Assault) over the situational ones.
    const pick = legal.find((k) => /^assault/i.test(k)) ?? legal[0]
    return pick ? [pick] : []
  }
  return legal.slice(0, choice.max)
}

interface AbilitySource {
  card: Card
  unit?: UnitInPlay
  controller: PlayerSide
}

function abilitySources(state: GameState): AbilitySource[] {
  const out: AbilitySource[] = []
  for (const u of allUnits(state)) out.push({ card: u.card, unit: u, controller: u.owner })
  out.push({ card: state.player.legend, controller: 'player' })
  out.push({ card: state.ai.legend, controller: 'ai' })
  // Active player's abilities resolve first.
  return out.sort((a, b) => {
    const av = a.controller === state.activePlayer ? 0 : 1
    const bv = b.controller === state.activePlayer ? 0 : 1
    return av - bv
  })
}

function eventSubjectId(e: EngineEvent, src?: UnitInPlay): boolean {
  if (!src) return false
  switch (e.type) {
    case 'UNIT_ENTERED':
    case 'UNIT_MOVED':
    case 'UNIT_DIED':
    case 'UNIT_READIED':
      return e.instanceId === src.instanceId
    case 'COMBAT_WON':
      return e.winnerInstanceIds.includes(src.instanceId)
    case 'CONQUERED':
      // "When I conquer" — this unit is at the battlefield its controller took.
      return (
        src.owner === e.side &&
        src.location.kind === 'battlefield' &&
        src.location.index === e.index
      )
    case 'HELD':
      return src.owner === e.side && src.location.kind === 'battlefield'
    default:
      return false
  }
}

function eventController(e: EngineEvent): PlayerSide | null {
  switch (e.type) {
    case 'CARD_PLAYED':
    case 'UNIT_ENTERED':
    case 'UNIT_MOVED':
    case 'UNIT_READIED':
      return e.controller
    case 'CONQUERED':
    case 'HELD':
    case 'COMBAT_WON':
    case 'TURN_ENDED':
    case 'DEFENDED':
      return e.side
    case 'CARD_BANISHED':
    case 'UNIT_DIED':
    case 'CARD_DISCARDED':
      return e.owner
    default:
      return null
  }
}

function autoTargetsForTrigger(
  state: GameState,
  chooser: PlayerSide,
  trigger: TriggeredAbility,
  source?: UnitInPlay,
): ResolvedTarget[] {
  if (!trigger.targets || trigger.targets.length === 0) return []
  const out: ResolvedTarget[] = []
  for (const spec of trigger.targets) {
    if (spec.kind === 'stackSpell') {
      const [item] = legalStackTargets(state, spec)
      if (item) out.push({ kind: 'stackItem', stackItemId: item.id })
      continue
    }
    if (spec.kind === 'player') {
      out.push({ kind: 'player', side: chooser })
      continue
    }
    const legal = legalUnitTargets(state, chooser, spec, source)
    const pick =
      spec.kind === 'friendlyUnit' || spec.kind === 'self'
        ? legal[0]
        : [...legal].sort((a, b) => b.card.might - a.card.might)[0]
    if (pick) out.push({ kind: 'unit', instanceId: pick.instanceId })
  }
  return out
}

const MAX_DEPTH = 24

/** Raise an engine event and resolve every triggered ability that matches. */
export function emit(state: GameState, event: EngineEvent, depth = 0): GameState {
  if (depth > MAX_DEPTH) return state
  let s = state

  for (const source of abilitySources(s)) {
    const script = scriptFor(source.card)
    if (!script?.triggers) continue

    for (const trigger of script.triggers) {
      if (trigger.on !== event.type) continue

      // Re-find the unit — it may have moved or died since the queue started.
      const src = source.unit
        ? allUnits(s).find((u) => u.instanceId === source.unit!.instanceId)
        : undefined
      if (source.unit && !src) continue

      if (trigger.self && !eventSubjectId(event, src)) continue
      if (trigger.byController && eventController(event) !== source.controller) continue
      if (trigger.condition && !trigger.condition(event, s, src)) continue
      if (trigger.when && !trigger.when(s, src, source.controller)) continue

      s = appendLog(s, `${source.card.name}: ability triggers.`)
      const controller = source.controller
      const runEffect = (state: GameState, picks?: string[]): GameState => {
        const liveSrc = src
          ? allUnits(state).find((u) => u.instanceId === src.instanceId) ?? src
          : undefined
        const ctx: EffectCtx = {
          state,
          controller,
          source: liveSrc,
          event,
          targets: autoTargetsForTrigger(state, controller, trigger, liveSrc),
          picks,
          emit: (ns, ne) => emit(ns, ne, depth + 1),
        }
        return trigger.effect(ctx)
      }

      if (trigger.choose) {
        const legal = trigger.choose.legal(s, src, controller)
        const realDecision =
          legal.length > trigger.choose.min &&
          !(legal.length <= trigger.choose.max && trigger.choose.min === trigger.choose.max)
        if (realDecision && controller === 'player') {
          const choice: PendingChoice = {
            id: newChoiceId(),
            controller,
            label: `${source.card.name}: ${trigger.choose.label}`,
            kind: trigger.choose.kind,
            min: trigger.choose.min,
            max: trigger.choose.max,
            legalIds: legal,
            resolve: (picks) => (st) => runEffect(st, picks),
          }
          s = { ...s, pendingChoices: [...s.pendingChoices, choice] }
          continue
        }
        s = runEffect(s, autoPickChoice(s, controller, trigger.choose, legal))
        if (s.winner) return s
        continue
      }

      s = runEffect(s)
      if (s.winner) return s
    }
  }

  // Start-of-Beginning-Phase battlefield abilities (Frozen Fortress, Dusk Rose
  // Lab). Every battlefield sees it; the clause decides whose phase it cares about.
  if (event.type === 'TURN_BEGAN') {
    for (const bf of s.battlefields) {
      if (!bf.card) continue
      for (const trig of battlefieldScript(bf.card).triggers) {
        if (trig.on !== 'TURN_BEGAN') continue
        s = runBattlefieldTrigger(s, event.side, trig, depth, event, bf.index)
        if (s.winner) return s
      }
    }
  }

  // A battlefield may also watch cards being played (Abandoned Hall). Every
  // battlefield sees it — the clause says "a player", not "you".
  if (event.type === 'CARD_PLAYED') {
    for (const bf of s.battlefields) {
      if (!bf.card) continue
      for (const trig of battlefieldScript(bf.card).triggers) {
        if (trig.on !== 'CARD_PLAYED') continue
        s = runBattlefieldTrigger(s, event.controller, trig, depth, event, bf.index)
        if (s.winner) return s
      }
    }
  }

  // Battlefield-scoped events (conquer / hold / defend "here").
  if (event.type === 'CONQUERED' || event.type === 'HELD' || event.type === 'DEFENDED') {
    const side = event.side
    const indices =
      event.type === 'HELD'
        ? s.battlefields.filter((bf) => controllerOf(bf) === side).map((bf) => bf.index)
        : [event.index]

    // Built-in keyword: Hunt X — gain X XP when you conquer or hold with a Hunt unit.
    if (event.type !== 'DEFENDED') {
      let hunt = 0
      for (const i of indices) {
        for (const u of s.battlefields[i].units.filter((u) => u.owner === side)) {
          hunt += keywordValue(u, 'Hunt')
        }
      }
      if (hunt > 0) s = gainXP(s, side, hunt)
    }

    // Battlefield "When you conquer / hold / defend here, …" abilities.
    for (const i of indices) {
      const card = s.battlefields[i].card
      if (!card) continue
      for (const trig of battlefieldScript(card).triggers) {
        if (trig.on !== event.type) continue
        s = appendLog(s, `${s.battlefields[i].name}: ${side}'s ability triggers.`)
        s = runBattlefieldTrigger(s, side, trig, depth, event, i)
        if (s.winner) return s
      }
    }
  }

  return s
}

function runBattlefieldTrigger(
  state: GameState,
  controller: PlayerSide,
  trig: BattlefieldTrigger,
  depth: number,
  event?: EngineEvent,
  battlefieldIndex?: number,
): GameState {
  const ctx: EffectCtx = {
    state,
    controller,
    source: undefined,
    event,
    battlefieldIndex,
    targets: autoTargetsForTrigger(
      state,
      controller,
      { on: trig.on, targets: trig.targets, effect: trig.effect },
      undefined,
    ),
    emit: (ns, ne) => emit(ns, ne, depth + 1),
  }
  return trig.effect(ctx)
}
