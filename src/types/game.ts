import { Card, Domain } from './card'

export type PlayerSide = 'player' | 'ai'

export type AIDifficulty = 'easy' | 'medium' | 'hard'

/** Score required to win a 1v1 game. */
export const VICTORY_SCORE = 8
/** Battlefields in play in a 1v1 game — each player presents one from their deck. */
export const BATTLEFIELD_COUNT = 2
/** Battlefield cards a constructed deck must contain (you present one per game). */
export const DECK_BATTLEFIELDS = 3
export const OPENING_HAND = 4
export const MAX_MULLIGAN = 2
export const RUNES_PER_TURN = 2
/** Hand size a player must discard down to at the end of their turn. */
export const MAX_HAND_SIZE = 7

// A turn runs: awaken (ready + score holds + channel runes + draw) → action
// (players alternate priority, two passes end it) → end (cleanup).
export type Phase = 'mulligan' | 'awaken' | 'action' | 'end'

// ── Units on the board ─────────────────────────────────────────────────────

export type UnitLocation =
  | { kind: 'base' }
  | { kind: 'battlefield'; index: number }

export interface UnitInPlay {
  instanceId: string
  card: Card
  owner: PlayerSide
  location: UnitLocation
  exhausted: boolean
  damage: number
  /**
   * Numeric bag for transient state:
   *  - `mightTurn`      : +/- might until end of turn
   *  - `mightPerm`      : +/- might that persists across turns (permanent buffs)
   *  - `buffed`         : 1 if the unit carries a buff counter ([Buff] game action; non-stacking)
   *  - `kw:<Keyword>`    : a keyword granted this turn (value = magnitude, e.g. Assault 3)
   *  - `shield`          : one-shot damage prevention charges
   *  - `stunned`         : turns to stay exhausted through Awaken
   *  - `combatWins`      : combats won this turn (for "first time each turn")
   */
  counters: Record<string, number>
  /** Entered play this turn — can't move / fight yet (summoning sickness). */
  sick: boolean
  /** Has the Empowered status (from an Empower ability). */
  empowered?: boolean
}

// ── Gear (persistent permanents at a player's base) ───────────────────────

export interface GearInPlay {
  instanceId: string
  card: Card
  owner: PlayerSide
  exhausted: boolean
  /** Has the Empowered status (from an Empower ability). */
  empowered?: boolean
  /** Equipment: the unit instanceId this is attached to. */
  attachedTo?: string
  /** Transient numeric state (kw:*, mightTurn, one-shot flags). */
  counters: Record<string, number>
}

// ── Battlefields (shared) ──────────────────────────────────────────────────

export type BattlefieldControl = PlayerSide | 'contested' | 'open'

export interface Battlefield {
  index: number
  card: Card | null
  name: string
  /** Which player brought this battlefield to the game. */
  contributor: PlayerSide
  /** Units physically at this battlefield, both players'. */
  units: UnitInPlay[]
  /** Sides that have already scored a point here this turn (1/turn cap). */
  scoredThisTurn: PlayerSide[]
}

// ── Runes / energy ────────────────────────────────────────────────────────

export interface RunePool {
  /** Energy available to spend this turn (from channeled runes). */
  energy: number
  /** "Power" available to spend this turn (from recycled runes). */
  power: number
  /** Runes still face-down in the rune deck. */
  deck: Card[]
  /** Runes channeled this turn (exhausted, produce energy). */
  channeled: Card[]
  /** Runes recycled this turn (spent for power). */
  recycled: Card[]
  /** Channeled runes exhausted this turn to pay a rune-symbol (`:rb_rune_*:`) cost. */
  spent: Card[]
}

// ── Player state ──────────────────────────────────────────────────────────

export interface PlayerState {
  side: PlayerSide
  points: number
  legend: Card
  chosenChampion: Card
  /** The legend's domain identity — every deck card must fit within this. */
  identity: Domain[]

  hand: Card[]
  mainDeck: Card[]
  trash: Card[]
  /** Cards removed from the game (Flow, banish effects). */
  banished: Card[]
  /** Experience points — feeds Level / Hunt keywords. */
  xp: number

  runes: RunePool
  /** Energy added at the start of this player's next Awaken (Annie legend, etc.). */
  bankedEnergy: number

  /** Units at the player's base (not committed to a battlefield). */
  base: UnitInPlay[]
  /** Gear permanents this player controls (Equipment tracks `attachedTo`). */
  gear: GearInPlay[]
  /** The token cards this player's deck can create — an unlimited reference pile. */
  tokenPile: Card[]

  mulliganDone: boolean
  /** True once this player's chosen champion has been played from hand. */
  championPlayed: boolean
  /** The legend carries the Empowered status (Zed – Master of Shadows). */
  legendEmpowered?: boolean
  /** The legend is exhausted (used an "exhaust me" ability this turn). */
  legendExhausted?: boolean
}

// ── The stack ─────────────────────────────────────────────────────────────

export interface ResolvedTarget {
  kind: 'unit' | 'gear' | 'stackItem' | 'player'
  instanceId?: string // unit / gear
  stackItemId?: string // stack item
  side?: PlayerSide // player
}

export interface StackItem {
  id: string
  kind: 'spell' | 'ability' | 'gear'
  controller: PlayerSide
  card?: Card
  /** How to find the effect on resolution (card cleanName, or `${cleanName}#activated${i}`). */
  scriptKey: string
  sourceInstanceId?: string
  targets: ResolvedTarget[]
  /** Human-readable description for the stack panel. */
  label: string
  /** Flow-cast spells are removed from the game (not trashed) on resolution. */
  banishOnResolve?: boolean
  /** The caster paid the spell's optional "additional cost". */
  paidAdditional?: boolean
}

// ── Engine events (drive triggered abilities) ─────────────────────────────

export type EngineEvent =
  | { type: 'CARD_PLAYED'; card: Card; controller: PlayerSide; nth: number }
  | { type: 'UNIT_ENTERED'; instanceId: string; controller: PlayerSide }
  | {
      type: 'UNIT_MOVED'
      instanceId: string
      controller: PlayerSide
      from: UnitLocation
      to: UnitLocation
    }
  | { type: 'UNIT_DIED'; card: Card; owner: PlayerSide; instanceId: string; inCombat: boolean }
  | { type: 'UNIT_READIED'; instanceId: string; controller: PlayerSide }
  | { type: 'CARD_BANISHED'; card: Card; owner: PlayerSide }
  | { type: 'DEFENDED'; side: PlayerSide; index: number }
  | { type: 'CONQUERED'; side: PlayerSide; index: number; excess: number }
  | { type: 'HELD'; side: PlayerSide; count: number }
  | { type: 'COMBAT_WON'; side: PlayerSide; index: number; winnerInstanceIds: string[] }
  | { type: 'CARD_DISCARDED'; card: Card; owner: PlayerSide }
  | { type: 'TURN_ENDED'; side: PlayerSide }

// ── Pending player choices (interactive trigger targets / picks) ──────────

export interface PendingChoice {
  id: string
  controller: PlayerSide
  label: string
  kind: 'unit' | 'handCard' | 'trashCard' | 'deckTop' | 'keyword'
  min: number // 0 = "you may" (skippable), 1+ = mandatory
  max: number
  /** Unit instanceIds, or card ids in the named zone, that may be picked. */
  legalIds: string[]
  /** Re-enter the ability with the player's picks and return the new state. */
  resolve: (pickedIds: string[]) => (s: GameState) => GameState
}

// ── Full game state ───────────────────────────────────────────────────────

export interface GameState {
  round: number
  turn: number // total turns taken across both players
  activePlayer: PlayerSide
  phase: Phase
  /** Whose priority it is during the action phase / a priority window. */
  priority: PlayerSide
  /** Consecutive priority passes; two in a row resolves the stack top or ends the turn. */
  passesInARow: number
  /** LIFO stack of spells / abilities awaiting resolution. */
  stack: StackItem[]
  /** Cards the active player has played so far this turn (for "second card" triggers). */
  cardsPlayedThisTurn: number
  battlefields: Battlefield[]
  player: PlayerState
  ai: PlayerState
  /** A declared-but-unresolved showdown; combat resolves once its priority window closes. */
  pendingShowdown: { index: number; declarer: PlayerSide } | null
  /** A showdown paused for the human to assign combat damage across the receiving units. */
  pendingDamage: {
    index: number
    declarer: PlayerSide
    /** 'def' = the declarer's damage lands on the defender's units; 'atk' = vice versa. */
    stage: 'def' | 'atk'
    assigningSide: PlayerSide
    /** Damage to distribute this stage. */
    pool: number
    /** The other side's Might (auto-assigned once this stage confirms). */
    otherPool: number
    /** Unit instanceIds that may receive damage. */
    targetIds: string[]
    /** Destroyed ids from the already-resolved 'def' stage (only set when stage === 'atk'). */
    defDestroyed: string[]
    defExcess: number
  } | null
  /** FIFO queue of choices a player must make before play continues. */
  pendingChoices: PendingChoice[]
  /** Card ids (in a trash) granted [Flow] this turn (Kennen); cleared each Awaken. */
  flowGranted: string[]
  /** The most recent spell/ability to leave the stack — shown in the cast lane, cleared each Awaken. */
  lastResolved: { label: string; card: Card | null; outcome: 'resolved' | 'countered' } | null
  log: string[]
  winner: PlayerSide | null
  difficulty: AIDifficulty
  /** Set once, when the very first turn's channel bonus has been applied. */
  firstChannelBonusUsed: boolean
}

// ── Actions ───────────────────────────────────────────────────────────────

export type DamageAssignment = { targetInstanceId: string; amount: number }

export type GameAction =
  | { type: 'MULLIGAN'; cardIndices: number[] } // cards to send to bottom + redraw
  | { type: 'KEEP_HAND' }
  | { type: 'CHANNEL_RUNE' }
  | { type: 'RECYCLE_RUNE' }
  | {
      type: 'PLAY_UNIT'
      card: Card
      to: UnitLocation
      paidAccelerate?: boolean
      paidAdditional?: boolean
    }
  | {
      type: 'PLAY_SPELL'
      card: Card
      targetInstanceIds?: string[]
      targetStackId?: string
      paidAdditional?: boolean
    }
  | { type: 'PLAY_GEAR'; card: Card; targetInstanceIds?: string[] }
  | { type: 'CAST_FLOW'; card: Card; targetInstanceIds?: string[]; targetStackId?: string }
  | {
      type: 'ACTIVATE_ABILITY'
      instanceId: string
      abilityIndex: number
      targetInstanceIds?: string[]
    }
  | { type: 'MOVE_UNIT'; instanceId: string; to: UnitLocation }
  | { type: 'DECLARE_SHOWDOWN'; index: number }
  | { type: 'ASSIGN_DAMAGE'; assignments: DamageAssignment[] }
  | { type: 'RESOLVE_CHOICE'; pickedIds: string[] }
  | { type: 'PASS' }
  | { type: 'PASS_PRIORITY' }
  | { type: 'END_TURN' }
