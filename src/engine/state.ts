import { Card } from '../types/card'
import {
  Battlefield,
  BattlefieldControl,
  GameState,
  GearInPlay,
  PlayerSide,
  PlayerState,
  UnitInPlay,
} from '../types/game'

let _instanceCounter = 0
export function newInstanceId(): string {
  return `u${++_instanceCounter}`
}

let _copyCounter = 0
/** A fresh unique id for one physical copy of a printing (`<printingId>~<n>`). */
export function newCopyId(printingId: string): string {
  return `${printingId}~${++_copyCounter}`
}

/** The printing id of a card, ignoring the per-copy `~<n>` suffix. */
export function basePrintingId(card: { id: string }): string {
  const i = card.id.indexOf('~')
  return i < 0 ? card.id : card.id.slice(0, i)
}

/** Two cards are the same printing (same card, possibly different copies). */
export function samePrinting(a: { id: string }, b: { id: string }): boolean {
  return basePrintingId(a) === basePrintingId(b)
}

let _choiceCounter = 0
export function newChoiceId(): string {
  return `ch${++_choiceCounter}`
}

// Full card pool, set once at game start so effects can look up token cards.
let _cardPool: Card[] = []
export function setCardPool(pool: Card[]): void {
  _cardPool = pool
}
export function findPoolCardByName(name: string): Card | undefined {
  const n = name.toLowerCase()
  return (
    _cardPool.find((c) => c.name.toLowerCase() === n) ??
    _cardPool.find((c) => c.cleanName.toLowerCase() === n) ??
    _cardPool.find((c) => c.name.toLowerCase().startsWith(n))
  )
}

/** Like `findPoolCardByName`, but only ever returns an actual Token-supertype card. */
export function findTokenCardByName(name: string): Card | undefined {
  const n = name.toLowerCase()
  const toks = _cardPool.filter((c) => c.supertype === 'token')
  return (
    toks.find((c) => c.name.toLowerCase() === n) ??
    toks.find((c) => c.cleanName.toLowerCase() === n) ??
    toks.find((c) => c.name.toLowerCase().startsWith(n)) ??
    toks.find((c) => c.name.toLowerCase().includes(n))
  )
}

/** Test-only: reset the instance id counter for deterministic snapshots. */
export function _resetInstanceCounter(): void {
  _instanceCounter = 0
}

export function otherSide(side: PlayerSide): PlayerSide {
  return side === 'player' ? 'ai' : 'player'
}

export function getPlayer(state: GameState, side: PlayerSide): PlayerState {
  return side === 'player' ? state.player : state.ai
}

export function setPlayer(state: GameState, side: PlayerSide, ps: PlayerState): GameState {
  return side === 'player' ? { ...state, player: ps } : { ...state, ai: ps }
}

export function updatePlayer(
  state: GameState,
  side: PlayerSide,
  fn: (ps: PlayerState) => PlayerState,
): GameState {
  return setPlayer(state, side, fn(getPlayer(state, side)))
}

export function appendLog(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, msg] }
}

// ── Battlefield helpers ────────────────────────────────────────────────────

export function updateBattlefield(
  state: GameState,
  index: number,
  fn: (bf: Battlefield) => Battlefield,
): GameState {
  return {
    ...state,
    battlefields: state.battlefields.map((bf) => (bf.index === index ? fn(bf) : bf)),
  }
}

export function unitsAt(bf: Battlefield, side: PlayerSide): UnitInPlay[] {
  return bf.units.filter((u) => u.owner === side)
}

export function controllerOf(bf: Battlefield): BattlefieldControl {
  const p = unitsAt(bf, 'player').length > 0
  const a = unitsAt(bf, 'ai').length > 0
  if (p && a) return 'contested'
  if (p) return 'player'
  if (a) return 'ai'
  return 'open'
}

export function mightAt(bf: Battlefield, side: PlayerSide): number {
  return unitsAt(bf, side).reduce((sum, u) => sum + Math.max(0, u.card.might), 0)
}

// ── Unit helpers ──────────────────────────────────────────────────────────

/** Map over every unit everywhere (bases + all battlefields). */
export function mapAllUnits(
  state: GameState,
  fn: (u: UnitInPlay) => UnitInPlay,
): GameState {
  const mapPs = (ps: PlayerState): PlayerState => ({ ...ps, base: ps.base.map(fn) })
  return {
    ...state,
    player: mapPs(state.player),
    ai: mapPs(state.ai),
    battlefields: state.battlefields.map((bf) => ({ ...bf, units: bf.units.map(fn) })),
  }
}

export function findUnit(state: GameState, instanceId: string): UnitInPlay | undefined {
  return allUnits(state).find((u) => u.instanceId === instanceId)
}

export function allUnits(state: GameState): UnitInPlay[] {
  return [
    ...state.player.base,
    ...state.ai.base,
    ...state.battlefields.flatMap((bf) => bf.units),
  ]
}

export function ownUnits(state: GameState, side: PlayerSide): UnitInPlay[] {
  return allUnits(state).filter((u) => u.owner === side)
}

// ── Gear helpers ──────────────────────────────────────────────────────────

export function allGear(state: GameState): GearInPlay[] {
  return [...state.player.gear, ...state.ai.gear]
}

export function findGear(state: GameState, instanceId: string): GearInPlay | undefined {
  return allGear(state).find((g) => g.instanceId === instanceId)
}

/** Map over every gear on both sides. */
export function mapAllGear(
  state: GameState,
  fn: (g: GearInPlay) => GearInPlay,
): GameState {
  return {
    ...state,
    player: { ...state.player, gear: state.player.gear.map(fn) },
    ai: { ...state.ai, gear: state.ai.gear.map(fn) },
  }
}

export function removeGear(state: GameState, instanceId: string): GameState {
  return {
    ...state,
    player: { ...state.player, gear: state.player.gear.filter((g) => g.instanceId !== instanceId) },
    ai: { ...state.ai, gear: state.ai.gear.filter((g) => g.instanceId !== instanceId) },
  }
}

/** Remove a unit from wherever it currently is. */
export function removeUnit(state: GameState, instanceId: string): GameState {
  const mapPs = (ps: PlayerState): PlayerState => ({
    ...ps,
    base: ps.base.filter((u) => u.instanceId !== instanceId),
  })
  return {
    ...state,
    player: mapPs(state.player),
    ai: mapPs(state.ai),
    battlefields: state.battlefields.map((bf) => ({
      ...bf,
      units: bf.units.filter((u) => u.instanceId !== instanceId),
    })),
  }
}
