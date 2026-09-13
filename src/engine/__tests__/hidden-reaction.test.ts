import { beforeAll, describe, expect, it } from 'vitest'
import { dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { canPlayFromFacedown } from '../hidden'
import { runAITurn } from '../ai'
import { makeCard, placeUnitAt, startedGame } from './fixtures'
import { GameState, PlayerSide } from '../../types/game'

/**
 * The scenario that matters for [Hidden], and the one the keyword exists for:
 * you hide on your turn, the opponent attacks on theirs, and you flip the card
 * in response — **before combat resolves**.
 *
 * 811.6 gives a matured hidden card the Reaction keyword, so it is playable in
 * an opponent's Showdown Open State. `turn` counts player-turns (phases.ts), so
 * a card hidden on turn 2 is already mature on turn 3 — the opponent's very
 * next turn, not "your next turn".
 *
 * Timing is the whole point: if the showdown resolves first and you lose the
 * battlefield, the hidden card is revealed and trashed (107.3.d) without ever
 * being played.
 */

const ambush = makeCard({
  name: 'Ambusher',
  type: 'unit',
  energy: 5,
  might: 4,
  text: 'When you play me from face down, give a unit +2 :rb_might: this turn.',
})

const grunt = makeCard({ name: 'Grunt', type: 'unit', energy: 2, might: 2 })

beforeAll(() => _clearCompileCache())

/** `side` holds battlefield 0 with a unit, and has `ambush` hidden there. */
function hiddenAt(side: PlayerSide, turn: number): GameState {
  let s = startedGame({ firstPlayer: side, seed: 11 })
  s = placeUnitAt(s, side, grunt, 0)
  return {
    ...s,
    turn,
    battlefields: s.battlefields.map((bf, i) =>
      i === 0 ? { ...bf, facedown: { owner: side, card: ambush, turnHidden: turn - 1 } } : bf,
    ),
  }
}

describe('a matured hidden card on the opponent\'s turn', () => {
  it('is mature on the opponent\'s very next turn, not only on your own', () => {
    // Hidden on turn 2; it is now turn 3, which is the opponent's.
    const s = hiddenAt('player', 3)
    const theirTurn: GameState = { ...s, activePlayer: 'ai', priority: 'player' }
    expect(canPlayFromFacedown(theirTurn, 'player', 0).ok).toBe(true)
  })

  it('is still blocked on the turn it was hidden', () => {
    const s = hiddenAt('player', 3)
    const sameTurn: GameState = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, facedown: { owner: 'player', card: ambush, turnHidden: 3 } } : bf,
      ),
    }
    expect(canPlayFromFacedown(sameTurn, 'player', 0).ok).toBe(false)
  })

  it('needs priority — you cannot flip it while the opponent holds it', () => {
    const s = hiddenAt('player', 3)
    const notMine: GameState = { ...s, activePlayer: 'ai', priority: 'ai' }
    expect(canPlayFromFacedown(notMine, 'player', 0).ok).toBe(false)
  })

  it('can actually be played during the opponent\'s open showdown', () => {
    // The opponent moves in and declares; the defender holds priority in the
    // reaction window (459.2.e-f) and flips the hidden unit then.
    let s = hiddenAt('player', 3)
    s = placeUnitAt(s, 'ai', grunt, 0) // contest it
    s = { ...s, activePlayer: 'ai', priority: 'ai', phase: 'action' }
    s = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'ai')

    expect(s.pendingShowdown, 'a showdown is open').toBeTruthy()
    expect(s.priority, 'the defender may react').toBe('player')
    expect(canPlayFromFacedown(s, 'player', 0).ok).toBe(true)

    const after = dispatch(
      s,
      { type: 'PLAY_UNIT', card: ambush, to: { kind: 'battlefield', index: 0 }, fromFacedown: 0 },
      'player',
    )
    expect(after.battlefields[0].facedown ?? null, 'flipped out of the zone').toBeNull()
    expect(
      after.battlefields[0].units.some((u) => u.owner === 'player' && u.card.name === ambush.name),
      'the unit entered the battlefield it was hidden at (811.1.d.1)',
    ).toBe(true)
    expect(after.log.join(' ')).toContain('from hiding')
  })
})

describe('the AI flips its hidden card in response', () => {
  it('plays from hiding during the human\'s showdown rather than losing it', () => {
    // The AI holds bf 0 and has a hidden unit there. The human contests and
    // declares. If the AI just passes, it loses the fight and the card with it
    // — flipping a 4-Might blocker for free is plainly better.
    let s = hiddenAt('ai', 3)
    s = placeUnitAt(s, 'player', grunt, 0)
    s = { ...s, activePlayer: 'player', priority: 'player', phase: 'action' }
    s = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'player')
    expect(s.priority, 'the AI may react').toBe('ai')

    const after = runAITurn(s)
    expect(
      after.log.join(' '),
      'the AI passed and let its hidden card die with the battlefield',
    ).toContain('from hiding')
  })
})
