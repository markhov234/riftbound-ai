import { Domain } from '../types/card'
import { GameState, PlayerSide } from '../types/game'
import { appendLog, getPlayer, updatePlayer } from './state'

// Rune economy — close to paper Riftbound, with one documented simplification:
//  - Each turn you channel RUNES_PER_TURN runes. Channeled runes stay on the
//    board and ready each Awaken, so Energy ramps — until you recycle one,
//    which sends it back to the Rune Deck.
//  - Each channeled rune contributes 1 Energy to your pool at Awaken
//    (`energy = channeled.length`). Energy pays numeric costs.
//  - A `:rb_rune_<domain>:` symbol in a cost is the Power pip. It is paid by
//    *recycling* one channeled rune of that domain (`'colorless'` = any). Thanks
//    to rune floating the rune's Energy is already in the pool, so the pip costs
//    NO extra Energy — it just needs a free matching rune, which is then marked
//    spent for the turn (readies next Awaken instead of leaving the game).
//  - `RECYCLE_RUNE` converts ONE channeled rune into 1 Power (163.2.b), costing
//    the Energy that rune was producing; the rune returns to the deck and is
//    re-channeled at a later Awaken. Power pays Deflect surcharges and `[A]`
//    costs such as Hidden's.

export interface Cost {
  energy: number
  power: number
  /** One entry per required Power pip; 'colorless' = any domain. */
  runes?: Domain[]
}

const domOf = (c: { domains: string[] }): string => c.domains[0] ?? 'colorless'

/** Un-spent channeled runes still available for a Power pip. */
function freeRunes(state: GameState, side: PlayerSide): number {
  const { runes } = getPlayer(state, side)
  return runes.channeled.length - runes.spent.length
}

export function costOf(card: { energy: number; power: number }): Cost {
  // A printed card's cost pips carry a count but not per-pip domains in our data,
  // so treat them as any-domain (payable by recycling any channeled rune).
  return { energy: card.energy, power: 0, runes: Array<Domain>(card.power).fill('colorless') }
}

export function canAfford(state: GameState, side: PlayerSide, cost: Cost): boolean {
  const { runes } = getPlayer(state, side)
  const pips = cost.runes?.length ?? 0
  // Power pips float — the recycled rune's Energy is already in the pool, so a
  // pip costs no extra Energy, only a free channeled rune. Explicit `cost.power`
  // (Deflect surcharges) still spills onto Energy when not covered by recycled Power.
  const powerFromEnergy = Math.max(0, cost.power - runes.power)
  return freeRunes(state, side) >= pips && runes.energy >= cost.energy + powerFromEnergy
}

export function payCost(state: GameState, side: PlayerSide, cost: Cost): GameState {
  return updatePlayer(state, side, (ps) => {
    const r = ps.runes
    // The un-spent channeled runes, as a mutable working set (rune Cards share a
    // reference per printing, so remove already-spent ones by id + count).
    const unspent = [...r.channeled]
    for (const sc of r.spent) {
      const i = unspent.findIndex((c) => c.id === sc.id)
      if (i >= 0) unspent.splice(i, 1)
    }
    const newlySpent: (typeof r.channeled)[number][] = []
    // Match domain pips to their domain first, then 'colorless' to anything.
    const pips = [...(cost.runes ?? [])].sort(
      (a, b) => (a === 'colorless' ? 1 : 0) - (b === 'colorless' ? 1 : 0),
    )
    for (const dom of pips) {
      let i = dom !== 'colorless' ? unspent.findIndex((c) => domOf(c) === dom) : 0
      if (i < 0) i = 0
      const [pick] = unspent.splice(i, 1)
      if (pick) newlySpent.push(pick)
    }
    const fromPower = Math.min(r.power, cost.power)
    const spill = cost.power - fromPower
    return {
      ...ps,
      runes: {
        ...r,
        spent: [...r.spent, ...newlySpent],
        power: r.power - fromPower,
        // Power pips are free of Energy (they float); only explicit Power spills.
        energy: r.energy - cost.energy - spill,
      },
    }
  })
}

/** Channel one rune from the rune deck: +1 energy now, +1 every future turn. */
export function channelRune(state: GameState, side: PlayerSide): GameState {
  const ps = getPlayer(state, side)
  if (ps.runes.deck.length === 0) {
    return appendLog(state, `${side} has no runes left to channel.`)
  }
  const [rune, ...rest] = ps.runes.deck
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    runes: {
      ...p.runes,
      deck: rest,
      channeled: [...p.runes.channeled, rune],
      energy: p.runes.energy + 1,
    },
  }))
  return appendLog(next, `${side} channels a rune (+1 energy).`)
}

/**
 * Channel a rune **exhausted** (Startipped Peak). It joins the channeled pile
 * and is immediately counted as spent, so it produces no energy now but is
 * available from your next Awaken — which is exactly what "exhausted" buys you.
 */
export function channelRuneExhausted(state: GameState, side: PlayerSide): GameState {
  const ps = getPlayer(state, side)
  if (ps.runes.deck.length === 0) {
    return appendLog(state, `${side} has no runes left to channel.`)
  }
  const [rune, ...rest] = ps.runes.deck
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    runes: {
      ...p.runes,
      deck: rest,
      channeled: [...p.runes.channeled, rune],
      spent: [...p.runes.spent, rune],
    },
  }))
  return appendLog(next, `${side} channels a rune exhausted (no energy this turn).`)
}

/**
 * Recycle a rune you have on the board for 1 Power (163.2.b — "Recycle this:
 * [Reaction] — Add [C]").
 *
 * These are **two separate abilities on the same rune**, not a choice between
 * them (163.2): `[E]` exhausts it to add 1 Energy, and `Recycle this` sends it
 * to the Rune Deck to add 1 Power. Nothing requires the rune to be ready to be
 * recycled, so a rune you already exhausted for Energy can still be recycled —
 * you keep the Energy floating in your Rune Pool (165) and gain the Power.
 *
 * This previously charged `energy - 1`, which modelled it as an either/or and
 * made the two abilities mutually exclusive. The real price is the rune itself:
 * it leaves the board, so it stops producing Energy from the next Awaken until
 * the Channel Phase brings it back — at 2 a turn.
 */
export function recycleRune(state: GameState, side: PlayerSide, runeId?: string): GameState {
  const ps = getPlayer(state, side)
  // A rune already consumed to pay a `:rb_rune_*:` pip is spent for the turn.
  const free = ps.runes.channeled.filter((r) => !ps.runes.spent.includes(r))
  // `runeId` lets the board recycle the rune you actually clicked; without it
  // any free rune will do (the AI and older callers).
  const rune = runeId ? free.find((r) => r.id === runeId) : free[0]
  if (!rune) return appendLog(state, `${side} has no rune to recycle.`)
  const next = updatePlayer(state, side, (p) => ({
    ...p,
    runes: {
      ...p.runes,
      channeled: p.runes.channeled.filter((r) => r !== rune),
      recycled: [...p.runes.recycled, rune],
      power: p.runes.power + 1,
    },
  }))
  return appendLog(next, `${side} recycles a rune (+1 power).`)
}

/** Is there a rune on the board that `side` could still recycle (163.2.b)? */
export function canRecycleRune(state: GameState, side: PlayerSide): boolean {
  const ps = getPlayer(state, side)
  return ps.runes.channeled.some((r) => !ps.runes.spent.includes(r))
}

/**
 * Start-of-turn rune step: recycled runes go back to the deck, the pool resets,
 * previously-channeled runes all ready (spent list cleared), and `count` new
 * runes are channeled.
 */
export function refreshRunes(state: GameState, side: PlayerSide, count: number): GameState {
  let next = updatePlayer(state, side, (ps) => ({
    ...ps,
    runes: {
      ...ps.runes,
      deck: [...ps.runes.deck, ...ps.runes.recycled],
      recycled: [],
      spent: [],
      energy: ps.runes.channeled.length,
      power: 0,
    },
  }))
  for (let i = 0; i < count; i++) next = channelRune(next, side)
  return next
}
