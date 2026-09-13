import { Card, Domain } from '../types/card'
import { GameState, PlayerSide } from '../types/game'
import { allUnits, controllerOf, getPlayer } from './state'
import { Cost, costOf } from './runes'

// ── Cost modifiers ───────────────────────────────────────────────────────
//
// `effectiveCost` folds every active cost modifier into the price a player
// actually pays to play a card *right now*. Sources, in order:
//   • Empowered unit auras   — "[Empowered][>] Your spells cost X less, to a
//                               minimum of Y" (Applied Researchers)
//   • Battlefield rules      — "During showdowns here, cards with [Reaction]
//                               cost :rb_rune_rainbow: more" (Mystic Vortex)
//   • One-shot grants        — Jayce, Man of Progress: the next gear you play
//                               ignores its Energy cost (`freeGearThisTurn`)
//
// It only ever touches the *base* cost — Deflect surcharges, Accelerate and
// [Repeat] extras are added by the caller after this runs.

const pipCount = (frag: string): number => (frag.match(/:rb_rune_[a-z]+:/g) ?? []).length
const energyIn = (frag: string): number => {
  const m = frag.match(/:rb_energy_(\d+):/)
  return m ? parseInt(m[1], 10) : 0
}

/**
 * What an *activated ability* costs right now. Separate from `effectiveCost`
 * because the discounts that apply to abilities are different ones:
 *
 *   • Piltovan Forge — "While you control this battlefield, the first friendly
 *     gear activated ability played each turn costs [1] less."
 *   • Risen Altar — "[Empower] costs of your units here cost [1] or a rune less."
 *
 * Both were listed in `battlefields.ts` as static-aura cost modifiers that were
 * "not handled yet", which meant the Jayce deck's own battlefields did nothing.
 */
export function effectiveAbilityCost(
  state: GameState,
  side: PlayerSide,
  opts: {
    /** The card the ability is printed on. */
    source: Card
    /** True for an Empower ability (Risen Altar only discounts those). */
    isEmpower: boolean
    /** Where the source unit stands, for "your units here". */
    battlefieldIndex?: number
    base: Cost
  },
): Cost {
  let energy = opts.base.energy
  const runes: Domain[] = [...(opts.base.runes ?? [])]
  const drop = (dEnergy: number, dPips: number) => {
    // Take the Energy if there is any, otherwise a rune pip — "[1] or a rune
    // less" is one discount, not both.
    if (dEnergy > 0 && energy > 0) energy = Math.max(0, energy - dEnergy)
    else for (let i = 0; i < dPips && runes.length > 0; i++) runes.pop()
  }

  // Use the engine's own notion of control so this can never drift from what
  // the board shows.
  const controls = (index: number) =>
    !!state.battlefields[index] && controllerOf(state.battlefields[index]) === side

  // Piltovan Forge — the *first* gear ability each turn, anywhere on the board,
  // as long as you hold the Forge.
  if (opts.source.type === 'gear' && !getPlayer(state, side).forgeDiscountUsed) {
    for (let i = 0; i < state.battlefields.length; i++) {
      const text = state.battlefields[i]?.card?.text ?? ''
      if (!/first friendly gear activated ability/i.test(text)) continue
      if (!controls(i)) continue
      const m = text.match(/costs?\s+((?::rb_energy_\d+:|:rb_rune_[a-z]+:)+)\s+less/i)
      if (m) drop(energyIn(m[1]), pipCount(m[1]))
      break
    }
  }

  // Risen Altar — Empower costs, but only for units standing on it.
  if (opts.isEmpower && opts.battlefieldIndex !== undefined) {
    const text = state.battlefields[opts.battlefieldIndex]?.card?.text ?? ''
    const m = text.match(
      /\[empower\] costs of your units here cost\s+((?::rb_energy_\d+:|:rb_rune_[a-z]+:)+(?:\s*or\s*(?::rb_energy_\d+:|:rb_rune_[a-z]+:)+)?)\s+less/i,
    )
    if (m) drop(energyIn(m[1]), Math.max(1, pipCount(m[1])))
  }

  return { energy, power: opts.base.power, runes }
}

export function effectiveCost(
  state: GameState,
  side: PlayerSide,
  card: Card,
  base: Cost = costOf(card),
): Cost {
  let energy = base.energy
  const runes: Domain[] = [...(base.runes ?? [])]
  const power = base.power

  const reduce = (dEnergy: number, dPips: number, floor: number) => {
    energy = Math.max(floor, energy - dEnergy)
    for (let i = 0; i < dPips && runes.length > 0; i++) runes.pop()
  }

  // ── Empowered unit auras — "Your spells cost X less" ──────────────────
  if (card.type === 'spell') {
    for (const u of allUnits(state)) {
      if (u.owner !== side || !u.empowered) continue
      const m = u.card.text.match(
        /your spells cost\s+((?::rb_energy_\d+:|:rb_rune_[a-z]+:)+)\s+less(?:,\s*to a minimum of\s*:rb_energy_(\d+):)?/i,
      )
      if (m) reduce(energyIn(m[1]), pipCount(m[1]), m[2] ? parseInt(m[2], 10) : 0)
    }
  }

  // ── Battlefield: [Reaction] cards cost more during a showdown here ─────
  if (state.pendingShowdown && /\[reaction\]/i.test(card.text)) {
    const bf = state.battlefields[state.pendingShowdown.index]
    const m = bf?.card?.text.match(
      /during showdowns here,\s*cards with \[reaction\] cost\s+((?::rb_rune_[a-z]+:)+)\s+more/i,
    )
    if (m) for (let i = 0; i < pipCount(m[1]); i++) runes.push('colorless')
  }

  // ── One-shot: Astral Heron — "your next card costs 2 energy + 2 runes less" ──
  // Applied here so every affordability check (engine and UI) sees the same
  // number; `registerCardPlayed` is what actually spends it.
  const disc = getPlayer(state, side).nextCardDiscount
  if (disc) reduce(disc.energy, disc.runes, 0)

  // ── One-shot: Jayce, Man of Progress — next gear ignores its Energy cost ──
  if (card.type === 'gear' && getPlayer(state, side).freeGearThisTurn) {
    energy = 0
  }

  return { energy: Math.max(0, energy), power, runes }
}
