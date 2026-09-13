import { describe, expect, it } from 'vitest'
import { boardScore, getAIActions, nextAIAction, pickTargets } from '../ai'
import { dispatch } from '../index'
import {
  bruiser,
  grunt,
  makeCard,
  placeAtBase,
  placeUnitAt,
  startedGame,
  titan,
  withHand,
} from './fixtures'
import type { GameState } from '../../types/game'

/**
 * "The medium AI is a little bit dumb, using card for no reasons."
 *
 * It was, and for three separate reasons — each of which is pinned below:
 *   1. the search scored a spell the instant it hit the stack, before it did
 *      anything, so a card that accomplished nothing looked free;
 *   2. unspent energy was penalised 0.7 a point, so dumping a 3-cost card
 *      "gained" 2.1 against a flat 0.4 for the card — it was paid to pitch;
 *   3. an open target kind took the biggest Might on the board, which for a
 *      harmful effect was regularly the AI's own best unit.
 */

/** Give the AI priority in its own action phase with a full pocket. */
function aiTurn(state: GameState): GameState {
  return {
    ...state,
    activePlayer: 'ai',
    priority: 'ai',
    phase: 'action',
    ai: { ...state.ai, runes: { ...state.ai.runes, energy: 6, power: 3 } },
  }
}

/** A spell with no script and no rules text — resolving it changes nothing. */
const blankSpell = makeCard({
  name: 'Does Nothing At All',
  type: 'spell',
  domains: ['fury'],
  energy: 3,
  text: '',
})

describe('the AI does not spend cards for nothing', () => {
  it('declines a spell that would accomplish nothing', () => {
    let s = aiTurn(startedGame({ difficulty: 'medium' }))
    s = withHand(s, 'ai', [blankSpell])
    // Something to do instead, so "end turn" is not the only alternative.
    s = placeAtBase(s, 'ai', grunt)

    // The whole turn, not just the first decision — the AI used to get round to
    // the blank after doing something more appealing first, so asserting on one
    // action passed against the broken build.
    const cast = getAIActions(s).filter(
      (a) => a.type === 'PLAY_SPELL' && a.card.name === blankSpell.name,
    )
    expect(cast, 'cast a spell that does nothing').toHaveLength(0)
  })

  it('still plays a card that does something', () => {
    // Same shape as the blank, but it actually develops the board.
    let s = aiTurn(startedGame({ difficulty: 'medium' }))
    s = withHand(s, 'ai', [bruiser])

    const action = nextAIAction(s)
    expect(action.type).toBe('PLAY_UNIT')
  })

  it('is not paid to dump energy', () => {
    // The core of bug 2: pitching a card must never be worth more than the
    // energy it frees. Compare holding the blank against having cast it.
    const base = aiTurn(startedGame({ difficulty: 'medium' }))
    const holding = withHand(base, 'ai', [blankSpell])
    const spent: GameState = {
      ...holding,
      ai: {
        ...holding.ai,
        hand: [],
        runes: { ...holding.ai.runes, energy: holding.ai.runes.energy - blankSpell.energy },
      },
    }
    expect(boardScore(spent, 'ai')).toBeLessThan(boardScore(holding, 'ai'))
  })

  it('values an expensive card in hand above a cheap one', () => {
    // A flat per-card hand value is what made pitching big cards look cheap.
    const base = aiTurn(startedGame())
    const cheap = withHand(base, 'ai', [grunt])
    const pricey = withHand(base, 'ai', [titan])
    expect(boardScore(pricey, 'ai')).toBeGreaterThan(boardScore(cheap, 'ai'))
  })
})

describe('channeling is a Limited Action (430.3)', () => {
  // Reported from a real game: the AI's first turn logged a dozen "channels a
  // rune (+1 energy)" lines. Rule 430.3.a — "Players may only channel runes
  // when Game Effects direct them to do so" — so there is no at-will channel
  // for either side. The Channel Phase (315.3.b.1) is the only routine source.
  it('gives the turn player exactly 2 runes a turn', () => {
    const s = startedGame({ firstPlayer: 'player' })
    // Turn 1 for the player going first.
    expect(s.player.runes.channeled).toHaveLength(2)
  })

  it('gives the player going second one extra on their first turn only (480.7)', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = dispatch(s, { type: 'END_TURN' }, 'player')
    expect(s.ai.runes.channeled, 'going second channels 3 on turn one').toHaveLength(3)
    // …and back to 2 a turn afterwards.
    const before = s.ai.runes.channeled.length
    s = dispatch(s, { type: 'END_TURN' }, 'ai')
    s = dispatch(s, { type: 'END_TURN' }, 'player')
    expect(s.ai.runes.channeled.length - before).toBe(2)
  })

  it('never lets a whole turn of AI actions inflate the rune count', () => {
    // The regression itself: one AI turn used to drain the entire Rune Deck.
    let s = startedGame({ difficulty: 'medium', firstPlayer: 'ai' })
    const before = s.ai.runes.channeled.length
    for (const action of getAIActions(s)) {
      expect(action.type as string, 'AI proposed an at-will channel').not.toBe('CHANNEL_RUNE')
      s = dispatch(s, action, 'ai')
    }
    expect(s.ai.runes.channeled.length).toBe(before)
  })
})

describe('the AI targets the right side', () => {
  // Exercised through `pickTargets` rather than a whole AI turn: with `settle`
  // in place the AI now refuses the bad cast outright, so a turn-level test
  // passes whether the targeting is right or wrong — it never gets that far.
  // The point here is that the *good* version of the play is on the menu.
  function boardWithBothSides() {
    let s = aiTurn(startedGame({ difficulty: 'medium' }))
    // Ours is strictly the biggest thing on the board, so "pick the largest
    // Might" lands on it unambiguously.
    s = placeUnitAt(s, 'ai', bruiser, 0) // ours, Might 4
    s = placeUnitAt(s, 'player', grunt, 0) // theirs, Might 2
    return s
  }

  it('aims a harmful effect at the opponent', () => {
    const s = boardWithBothSides()
    const mine = s.battlefields[0].units.filter((u) => u.owner === 'ai').map((u) => u.instanceId)
    const { targetInstanceIds } = pickTargets(s, 'ai', [
      { kind: 'unitAtBattlefield', intent: 'harm' },
    ])
    expect(targetInstanceIds).toHaveLength(1)
    expect(mine, 'aimed a harmful effect at its own unit').not.toContain(targetInstanceIds[0])
  })

  it('aims a buff at itself', () => {
    const s = boardWithBothSides()
    const mine = s.battlefields[0].units.filter((u) => u.owner === 'ai').map((u) => u.instanceId)
    const { targetInstanceIds } = pickTargets(s, 'ai', [
      { kind: 'unitAtBattlefield', intent: 'buff' },
    ])
    expect(mine, 'buffed the opponent').toContain(targetInstanceIds[0])
  })
})
