import { EngineEvent, GameState, GearInPlay, PlayerSide, UnitInPlay } from '../../types/game'
import { Effect } from './effects'
import { TargetSpec } from './targets'

export type SpellTiming = 'sorcery' | 'action' | 'reaction'

/** Gate on the whole ability — e.g. `Legion` / `Level N` / `Empowered`. */
export type AbilityGuard = (
  state: GameState,
  source: UnitInPlay | GearInPlay | undefined,
  controller: PlayerSide,
) => boolean

export interface PlayScript {
  timing?: SpellTiming // default derived from card.keywords
  targets?: TargetSpec[]
  /** If present and false, the spell resolves with no effect (still trashed/banished). */
  when?: AbilityGuard
  effect: Effect
}

/** A pick the controller makes before the trigger's effect runs. */
export interface TriggerChoice {
  kind: 'unit' | 'handCard' | 'trashCard' | 'deckTop' | 'keyword'
  min: number
  max: number
  label: string
  /** Legal ids for the pick given the current state + the trigger's source. */
  legal: (state: GameState, source: UnitInPlay | undefined, controller: string) => string[]
}

export interface TriggeredAbility {
  /** Event type to listen for. */
  on: EngineEvent['type']
  /** Only fire when the event's subject is this card's own unit. */
  self?: boolean
  /** Only fire when the event was caused by this card's controller. */
  byController?: boolean
  /** Extra gate; `source` is the ability's own unit/legend/gear (if any). */
  condition?: (event: EngineEvent, state: GameState, source?: UnitInPlay) => boolean
  /** If present and false, the trigger does not fire. */
  when?: AbilityGuard
  targets?: TargetSpec[]
  optional?: boolean
  /**
   * An interactive pick. The controller (if human) is prompted; the AI auto-picks.
   * `effect` then receives the picked ids in `ctx.picks`.
   */
  choose?: TriggerChoice
  effect: Effect
}

export interface ActivatedAbility {
  label: string
  cost: {
    energy?: number
    /** One entry per `:rb_rune_*:` symbol in the cost; 'colorless' = rainbow. */
    runes?: import('../../types/card').Domain[]
    exhaustSelf?: boolean
    recycleFromTrash?: number
    discard?: number
    /** "Disempower this" — remove the Empowered status as part of the cost. */
    disempowerSelf?: boolean
  }
  targets?: TargetSpec[]
  when?: AbilityGuard
  effect: Effect
}

export interface CardScript {
  play?: PlayScript
  triggers?: TriggeredAbility[]
  activated?: ActivatedAbility[]
  /** Static keyword grants beyond the ones parsed from card text. */
  keywords?: string[]
  /** `[Empowered][>] I have +N [M]` — extra Might while the unit has the Empowered status. */
  empoweredMight?: number
  /** `[Empowered][>] I have [Assault N]` — extra attacker Might while Empowered. */
  empoweredAssault?: number
  /**
   * What this gear grants the unit it is attached to, when the card's own text
   * doesn't spell it out (some riftcodex entries omit the granted box).
   * Merged with whatever `gearGrants` parses from the text.
   */
  gearGrant?: {
    might?: number
    keywords?: { name: string; x: number }[]
    /** Jagged Cutlass: "I can't be moved by enemy spells and abilities." */
    noEnemyMove?: boolean
  }
  /**
   * A death *replacement* on a gear: when the unit it is attached to would die,
   * this runs instead. Return the new state to replace the death, or `null` to
   * let it happen normally.
   *
   * Because the death is replaced rather than resolved, the unit never hits the
   * trash and `UNIT_DIED` is never emitted — so Deathknell correctly does not
   * trigger (glossary: "If the death is replaced … the trigger is removed").
   */
  replaceDeath?: (
    state: GameState,
    unit: UnitInPlay,
    gear: GearInPlay,
  ) => GameState | null
}
