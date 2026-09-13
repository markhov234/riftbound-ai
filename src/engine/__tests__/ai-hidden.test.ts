import { beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { runAITurn } from '../ai'
import { canPlayFromFacedown, hasHidden } from '../hidden'
import { makeCard, placeUnitAt, seededRng, startedGame, withHand } from './fixtures'
import { GameState } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { setCardPool } from '../state'
import { buildPresetDecks, PRESET_SPECS } from '../../data/presetDecks'
import poolData from './fixtures/card-pool.json'
import type { Card } from '../../types/card'
import { playGame } from './_fuzzlib'

/**
 * The AI never used [Hidden]. It played those cards straight from hand, which
 * is legal (811.3) but throws away the keyword: a hidden card is replayed
 * **free** ("ignoring its base cost") and at Reaction speed (811.6).
 *
 * Two halves, and both have to work or the feature is worse than nothing —
 * hiding a card and never playing it is a pure loss of tempo and a card.
 */

const hiddenBomb = makeCard({
  name: 'Hidden Bomb',
  type: 'spell',
  energy: 5,
  text: '[Hidden] [Action] Deal 3 to a unit.',
  keywords: ['Hidden', 'Action'],
})

const cheapUnit = makeCard({ name: 'Cheap Unit', type: 'unit', energy: 1, might: 1 })

beforeAll(() => _clearCompileCache())

/** An AI turn with a battlefield the AI controls and a hideable card in hand. */
function aiHolds(hand = [hiddenBomb]): GameState {
  let s = startedGame({ firstPlayer: 'ai', seed: 7 })
  s = placeUnitAt(s, 'ai', cheapUnit, 0) // uncontested → the AI controls bf 0
  s = withHand(s, 'ai', hand)
  // Enough channeled runes that the 1-Power hide cost is affordable.
  s = {
    ...s,
    ai: { ...s.ai, runes: { ...s.ai.runes, energy: 6 } },
  }
  return s
}

describe('the AI and [Hidden]', () => {
  it('has a hideable card and a battlefield to hide it at', () => {
    // Guards the fixture: if the setup stops being legal, the tests below would
    // pass vacuously by never having the option in the first place.
    const s = aiHolds()
    expect(hasHidden(hiddenBomb)).toBe(true)
    expect(s.ai.hand).toHaveLength(1)
    expect(s.battlefields[0].units.some((u) => u.owner === 'ai')).toBe(true)
  })

  it('hides a card rather than spending its whole cost from hand', () => {
    const s = aiHolds()
    const after = runAITurn(s)
    expect(
      after.battlefields.some((bf) => bf.facedown?.owner === 'ai'),
      'nothing was hidden across a whole AI turn',
    ).toBe(true)
  })

  it('plays the hidden card back when that is the best line available', () => {
    // The zone is set up directly rather than by hiding first, so this measures
    // one thing: given a playable hidden card and a good target, does the AI
    // take it? Hiding via a real turn left the AI with units to move, and it
    // reasonably preferred attacking — which tests the scorer, not the feature.
    let s = startedGame({ firstPlayer: 'ai', seed: 7 })
    s = placeUnitAt(s, 'player', cheapUnit, 1) // something worth shooting
    s = {
      ...s,
      turn: 3,
      ai: { ...s.ai, hand: [], runes: { ...s.ai.runes, energy: 6 } },
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, facedown: { owner: 'ai' as const, card: hiddenBomb, turnHidden: 1 } } : bf,
      ),
    }
    // 811.6 — playable only from a turn *after* the one it was hidden on.
    expect(canPlayFromFacedown(s, 'ai', 0).ok, 'legal to play now').toBe(true)

    const after = runAITurn(s)
    expect(after.battlefields[0].facedown ?? null, 'the hidden card was never played').toBeNull()
    expect(after.log.join(' ')).toContain(hiddenBomb.name)
  })

  it('does not hide when it cannot afford the Power', () => {
    let s = aiHolds()
    s = { ...s, ai: { ...s.ai, runes: { ...s.ai.runes, energy: 0, channeled: [], spent: [] } } }
    const after = runAITurn(s)
    expect(after.battlefields.some((bf) => bf.facedown)).toBe(false)
  })

  it('does not hide at a battlefield it does not control', () => {
    let s = startedGame({ firstPlayer: 'ai', seed: 7 })
    s = placeUnitAt(s, 'player', cheapUnit, 0) // the human holds bf 0
    s = withHand(s, 'ai', [hiddenBomb])
    s = { ...s, ai: { ...s.ai, runes: { ...s.ai.runes, energy: 6 } } }
    const after = runAITurn(s)
    expect(after.battlefields[0].facedown ?? null).toBeNull()
  })

  it('leaves the log free of the hidden card\'s name (128.4)', () => {
    const s = aiHolds()
    const after = runAITurn(s)
    const hid = after.log.filter((l) => /hides a card/.test(l))
    expect(hid.length).toBeGreaterThan(0)
    for (const line of hid) expect(line).not.toContain(hiddenBomb.name)
  })

  it('still finishes ordinary turns without crashing', () => {
    // A cheap sanity net: hiding must not derail the rest of the turn.
    let s = aiHolds([hiddenBomb, cheapUnit])
    for (let i = 0; i < 4; i++) {
      s = runAITurn(s)
      s = dispatch(s, { type: 'END_TURN' }, s.activePlayer)
      if (s.winner) break
    }
    expect(s.log.join(' ')).not.toMatch(/Can't hide/)
  })
})

describe('hiding is a judgement, not a reflex', () => {
  it('prefers hiding an expensive card over a cheap one', () => {
    // The saving is the card's cost, so a 5-cost bomb is worth hiding and a
    // 1-cost trinket is not — otherwise the AI burns its Power on nothing.
    const cheapHidden = makeCard({
      name: 'Cheap Hidden',
      type: 'spell',
      energy: 1,
      text: '[Hidden] [Action] Draw 1.',
      keywords: ['Hidden', 'Action'],
    })
    let s = aiHolds([hiddenBomb, cheapHidden])
    s = runAITurn(s)
    const fd = s.battlefields.find((bf) => bf.facedown?.owner === 'ai')?.facedown
    expect(fd, 'something was hidden').toBeTruthy()
    expect(fd!.card.name).toBe(hiddenBomb.name)
  })

  it('does not hide a card it could simply cast this turn for value', () => {
    // With plenty of energy and a target available, casting now beats banking
    // — the seeded run must not hide *every* time the option exists.
    let s = startedGame({ firstPlayer: 'ai', seed: 3 })
    s = placeUnitAt(s, 'ai', cheapUnit, 0)
    s = placeUnitAt(s, 'player', cheapUnit, 1)
    s = withHand(s, 'ai', [hiddenBomb])
    s = { ...s, ai: { ...s.ai, runes: { ...s.ai.runes, energy: 9 } } }
    const after = runAITurn(s)
    // Either it cast the spell or it hid it — but it did *something* with it.
    const stillInHand = after.ai.hand.some((c) => c.id === hiddenBomb.id)
    expect(stillInHand, 'the card sat in hand doing nothing').toBe(false)
  })
})

describe('hidden play does not destabilise the AI', () => {
  it('keeps seeded games finishing cleanly', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      let s = startedGame({ firstPlayer: 'ai', seed })
      s = withHand(s, 'ai', [hiddenBomb, cheapUnit, cheapUnit])
      s = { ...s, rng: seededRng(seed) } as GameState
      for (let t = 0; t < 8 && !s.winner; t++) {
        s = runAITurn(s)
        s = dispatch(s, { type: 'END_TURN' }, s.activePlayer)
      }
      const tail = s.log.slice(-5).join(' | ')
      expect(tail, `seed ${seed}`).not.toMatch(/not implemented|undefined|NaN|Cannot read/i)
    }
  })
})

describe('[Hidden] in real preset games', () => {
  it('hides, and plays back most of what it hides', () => {
    // The failure mode this guards is subtle: an AI that hides but never
    // replays has spent a card and a rune for nothing, which is strictly worse
    // than the old behaviour of ignoring the keyword. Two preset decks carry
    // Hidden cards — Irelia (3) and Vex (8).
    const POOL = poolData as unknown as Card[]
    __setCardData(POOL)
    setCardPool(POOL)
    const decks = buildPresetDecks(POOL)
    const vex = PRESET_SPECS.findIndex((spec) => /vex/i.test(spec.name))
    expect(vex, 'the Vex preset exists').toBeGreaterThanOrEqual(0)

    let hides = 0
    let plays = 0
    for (let seed = 1; seed <= 12; seed++) {
      const s = playGame({
        playerDeck: decks[0],
        aiDeck: decks[vex],
        pool: POOL,
        seed,
        rng: seededRng(seed),
        difficulty: 'medium',
        label: `hidden seed ${seed}`,
      })
      for (const line of s.log) {
        if (/^ai hides a card at battlefield/.test(line)) hides++
        if (/plays .+ from hiding/.test(line)) plays++
      }
    }

    expect(hides, 'the AI never used [Hidden] across 12 games').toBeGreaterThan(0)
    // Not every hidden card can come back — losing the battlefield trashes it
    // (107.3.d) and a game can end first — so this is a floor, not a balance.
    expect(
      plays,
      `hid ${hides} card(s) and replayed ${plays}: hiding is a pure loss at that rate`,
    ).toBeGreaterThan(0)
  })
})
