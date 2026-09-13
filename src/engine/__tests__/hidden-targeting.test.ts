import { beforeAll, describe, expect, it } from 'vitest'
import { canPlay, dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { makeCard, placeAtBase, placeUnitAt, startedGame } from './fixtures'
import { GameState } from '../../types/game'

/**
 * Rule 811.1.d — the choices a card makes when played **from Hidden** are
 * restricted to the battlefield it was hidden at.
 *
 *   d.2  a hidden spell, or the play effect of a hidden permanent, chooses its
 *        targets from among options *at that battlefield* — unless the ability
 *        explicitly restricts targeting in a way that makes that impossible
 *        (Tideturner: "a unit you control **at another location**").
 *   d    a **spell** with no valid target under that restriction cannot be
 *        played from Hidden at all. (A permanent still can; its play effect
 *        simply finds nothing.)
 *   811.2 only the *choices* are restricted. Effects that do not choose — "all
 *        friendly units", a global buff — still reach the whole board.
 *
 * Playing the same card from hand is unrestricted (811.3), which is the control
 * every test here needs: the restriction must come from *how* it was played.
 */

const snipe = makeCard({
  name: 'Hidden Snipe',
  type: 'spell',
  energy: 3,
  text: '[Hidden] [Action] Deal 3 to a unit.',
  keywords: ['Hidden', 'Action'],
})

const grunt = makeCard({ name: 'Grunt', type: 'unit', energy: 2, might: 2 })
const faraway = makeCard({ name: 'Faraway', type: 'unit', energy: 2, might: 2 })

beforeAll(() => _clearCompileCache())

/** `snipe` hidden at battlefield 0, with an enemy at bf 0 and another at bf 1. */
function board(): GameState {
  let s = startedGame({ firstPlayer: 'player', seed: 5 })
  s = placeUnitAt(s, 'player', grunt, 0) // we hold bf 0
  s = placeUnitAt(s, 'ai', grunt, 0) // an enemy at the hidden battlefield
  s = placeUnitAt(s, 'ai', faraway, 1) // and one somewhere else
  return {
    ...s,
    turn: 4,
    player: { ...s.player, runes: { ...s.player.runes, energy: 6 } },
    battlefields: s.battlefields.map((bf, i) =>
      i === 0 ? { ...bf, facedown: { owner: 'player' as const, card: snipe, turnHidden: 2 } } : bf,
    ),
  }
}

const enemyAt = (s: GameState, i: number) =>
  s.battlefields[i].units.find((u) => u.owner === 'ai')!

describe('811.1.d.2 — targets come from the hidden battlefield', () => {
  it('allows a target at the battlefield it was hidden at', () => {
    const s = board()
    const after = dispatch(
      s,
      {
        type: 'PLAY_SPELL',
        card: snipe,
        targetInstanceIds: [enemyAt(s, 0).instanceId],
        fromFacedown: 0,
      },
      'player',
    )
    expect(after.stack.length, 'the spell reached the chain').toBeGreaterThan(0)
    expect(after.log.join(' ')).not.toMatch(/invalid targets/)
  })

  it('refuses a target at a different battlefield', () => {
    const s = board()
    const after = dispatch(
      s,
      {
        type: 'PLAY_SPELL',
        card: snipe,
        targetInstanceIds: [enemyAt(s, 1).instanceId],
        fromFacedown: 0,
      },
      'player',
    )
    expect(after.stack.length, 'the spell must not reach the chain').toBe(0)
    expect(after.log.join(' ')).toMatch(/invalid targets/)
    expect(after.battlefields[0].facedown, 'and the card stays hidden').toBeTruthy()
  })

  it('does not restrict the same card played from hand (811.3)', () => {
    // The control. Without this the tests above could pass because the target
    // was illegal for some unrelated reason.
    let s = board()
    s = {
      ...s,
      player: { ...s.player, hand: [snipe] },
      battlefields: s.battlefields.map((bf, i) => (i === 0 ? { ...bf, facedown: null } : bf)),
    }
    const after = dispatch(
      s,
      { type: 'PLAY_SPELL', card: snipe, targetInstanceIds: [enemyAt(s, 1).instanceId] },
      'player',
    )
    expect(after.stack.length, 'from hand it may target anywhere').toBeGreaterThan(0)
  })

  it('does not restrict a unit at the base when nothing was played from Hidden', () => {
    let s = board()
    s = placeAtBase(s, 'ai', grunt)
    s = {
      ...s,
      player: { ...s.player, hand: [snipe] },
      battlefields: s.battlefields.map((bf, i) => (i === 0 ? { ...bf, facedown: null } : bf)),
    }
    const target = s.ai.base[s.ai.base.length - 1].instanceId
    const after = dispatch(
      s,
      { type: 'PLAY_SPELL', card: snipe, targetInstanceIds: [target] },
      'player',
    )
    expect(after.stack.length).toBeGreaterThan(0)
  })
})

describe('811.1.d — a spell with no legal target cannot be played from Hidden', () => {
  it('reports the card as unplayable, not merely mis-targeted', () => {
    let s = board()
    // Clear bf 0 of everything the snipe could hit; the enemy at bf 1 remains,
    // so the spell is unplayable *only* because of the Hidden restriction.
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) => (i === 0 ? { ...bf, units: [] } : bf)),
    }
    // The legality answer is what the UI and the AI both read, so that is what
    // 811.1.d has to change — refusing the dispatch is not enough.
    expect(canPlay(s, 'player', snipe, undefined, 0).ok).toBe(false)
    // …and with a unit back at that battlefield it is playable again, so the
    // refusal is the restriction and not something unrelated about the card.
    const withTarget = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, units: board().battlefields[0].units } : bf,
      ),
    }
    expect(canPlay(withTarget, 'player', snipe, undefined, 0).ok).toBe(true)
  })
})

describe('811.1.d.2 — the play effect of a hidden permanent', () => {
  const ambusher = makeCard({
    name: 'Ambusher',
    type: 'unit',
    energy: 4,
    might: 3,
    text: '[Hidden] When you play me, deal 2 to a unit.',
    keywords: ['Hidden'],
  })

  it('chooses only from the battlefield it entered at', () => {
    let s = startedGame({ firstPlayer: 'player', seed: 5 })
    s = placeUnitAt(s, 'player', grunt, 0)
    s = placeUnitAt(s, 'ai', grunt, 0)
    s = placeUnitAt(s, 'ai', faraway, 1)
    s = {
      ...s,
      turn: 4,
      player: { ...s.player, runes: { ...s.player.runes, energy: 6 } },
      battlefields: s.battlefields.map((bf, i) =>
        i === 0
          ? { ...bf, facedown: { owner: 'player' as const, card: ambusher, turnHidden: 2 } }
          : bf,
      ),
    }
    const farHpBefore = enemyAt(s, 1).damage

    const after = dispatch(
      s,
      {
        type: 'PLAY_UNIT',
        card: ambusher,
        to: { kind: 'battlefield', index: 0 },
        fromFacedown: 0,
      },
      'player',
    )

    // The play trigger goes on the chain; let it resolve before looking.
    let settled = after
    for (let i = 0; i < 6 && settled.stack.length > 0; i++) {
      settled = dispatch(settled, { type: 'PASS_PRIORITY' }, settled.priority)
    }

    const far = settled.battlefields[1].units.find((u) => u.owner === 'ai')
    const near = settled.battlefields[0].units.find(
      (u) => u.owner === 'ai' && u.card.name === grunt.name,
    )
    // Both halves, or this passes whenever the effect simply did nothing.
    expect(near === undefined || near.damage > 0, 'the near unit took the hit').toBe(true)
    expect(far, 'the distant unit survived').toBeTruthy()
    expect(far!.damage, 'the distant unit was not the one hit').toBe(farHpBefore)
  })
})
