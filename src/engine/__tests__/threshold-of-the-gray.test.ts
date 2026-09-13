import { beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { forceContestedShowdowns } from '../combat'
import { makeCard, placeUnitAt, seededRng, startedGame } from './fixtures'
import { __setCardData } from '../../data/cardStore'
import { setCardPool } from '../state'
import { buildPresetDecks, PRESET_SPECS } from '../../data/presetDecks'
import poolData from './fixtures/card-pool.json'
import type { Card } from '../../types/card'
import { playGame } from './_fuzzlib'

/**
 * Threshold of the Gray — "When combat starts here, the attacker and defender
 * each [Add] 1 Energy." The one battlefield in the five preset decks (Zed's)
 * whose ability did nothing: the engine raised no event for combat opening.
 *
 * **Timing matters and the rules are explicit.** Core Rules 459 — Step 1, the
 * Combat Showdown Step — establishes attacker and defender (459.2.b), then
 * 459.2.d adds any triggered abilities to the Combat Chain, and only then does
 * 459.2.e–f open the reaction window. Damage is Step 2 (460). So this fires
 * *before* the reaction window, and the Energy is spendable in that very
 * showdown — which is the whole point of the card. Paying it out after combat
 * resolved would make it nearly useless.
 */

const grunt2 = makeCard({ name: 'Two Might', type: 'unit', energy: 2, might: 2 })

beforeAll(() => _clearCompileCache())

/** A game with Threshold of the Gray as battlefield 0 and a unit on each side. */
function contested() {
  let s = startedGame()
  s = {
    ...s,
    battlefields: s.battlefields.map((bf, i) =>
      i === 0
        ? {
            ...bf,
            name: 'Threshold of the Gray',
            card: makeCard({
              name: 'Threshold of the Gray',
              type: 'battlefield',
              domains: ['colorless'],
              text: 'When combat starts here, the attacker and defender each [Add] :rb_energy_1:.',
            }),
          }
        : bf,
    ),
  }
  s = placeUnitAt(s, 'player', grunt2, 0)
  s = placeUnitAt(s, 'ai', grunt2, 0)
  return s
}

describe('Threshold of the Gray', () => {
  it('gives both players 1 energy when a showdown is declared', () => {
    const s = contested()
    const before = { me: s.player.runes.energy, them: s.ai.runes.energy }

    const after = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'player')

    expect(after.player.runes.energy - before.me, 'attacker').toBe(1)
    expect(after.ai.runes.energy - before.them, 'defender').toBe(1)
  })

  it('pays out before the reaction window, so the energy is spendable (459.2.d–f)', () => {
    const s = contested()
    const after = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'player')

    // The showdown is still pending — damage has not been dealt (460) — and the
    // energy is already in hand. That ordering is the card's entire purpose.
    expect(after.pendingShowdown, 'showdown still open').toBeTruthy()
    expect(after.player.runes.energy).toBeGreaterThan(s.player.runes.energy)
  })

  it('also fires when the turn ends and the showdown is forced', () => {
    // Moving in commits you to the fight; if you never declare, the end-of-turn
    // net resolves it. That is still combat opening, so the ability still fires.
    const s = contested()
    const before = { me: s.player.runes.energy, them: s.ai.runes.energy }

    const after = forceContestedShowdowns(s, 'player')

    expect(after.player.runes.energy - before.me).toBe(1)
    expect(after.ai.runes.energy - before.them).toBe(1)
  })

  it('does not fire for a showdown at a different battlefield', () => {
    let s = contested()
    s = placeUnitAt(s, 'player', grunt2, 1)
    s = placeUnitAt(s, 'ai', grunt2, 1)
    const before = s.player.runes.energy

    const after = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 1 }, 'player')

    expect(after.player.runes.energy).toBe(before)
  })

  it('fires once per combat, not once per unit present', () => {
    let s = contested()
    s = placeUnitAt(s, 'player', grunt2, 0)
    s = placeUnitAt(s, 'ai', grunt2, 0)
    const before = s.player.runes.energy

    const after = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'player')

    expect(after.player.runes.energy - before).toBe(1)
  })
})

describe('Threshold of the Gray, end to end', () => {
  it('actually fires in real games of the deck that brings it', () => {
    // The unit tests above drive the two code paths directly. This one answers
    // the question that started the work — "this battlefield does nothing in my
    // games" — by playing the Zed preset, which is the deck that brings it.
    const POOL = poolData as unknown as Card[]
    __setCardData(POOL)
    setCardPool(POOL)
    const decks = buildPresetDecks(POOL)
    const zed = PRESET_SPECS.findIndex((spec) => /zed/i.test(spec.name))
    expect(zed, 'the Zed preset exists').toBeGreaterThanOrEqual(0)

    let games = 0
    let fired = 0
    for (let seed = 1; seed <= 16; seed++) {
      const s = playGame({
        playerDeck: decks[zed],
        aiDeck: decks[1],
        pool: POOL,
        seed,
        rng: seededRng(seed),
        difficulty: 'medium',
        label: `threshold seed ${seed}`,
      })
      if (!s.battlefields.some((bf) => bf.name === 'Threshold of the Gray')) continue
      games++
      fired += s.log.filter((l) => /Threshold of the Gray: combat begins/.test(l)).length
    }

    expect(games, 'the battlefield reached the table').toBeGreaterThan(0)
    expect(fired, `fired 0 times across ${games} games — the ability is inert again`)
      .toBeGreaterThan(0)
  })
})
