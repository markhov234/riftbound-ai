import { describe, expect, it } from 'vitest'
import { GameState, PlayerSide } from '../../types/game'
import { dispatch } from '../actions'
import { defy, grunt, makeCard, placeUnitAt, startedGame, voidSeeker, withHand } from './fixtures'

function bumpEnergy(s: GameState, side: PlayerSide, energy: number): GameState {
  return side === 'player'
    ? { ...s, player: { ...s.player, runes: { ...s.player.runes, energy } } }
    : { ...s, ai: { ...s.ai, runes: { ...s.ai.runes, energy } } }
}

/** Both players pass with priority — resolves the top of the stack. */
function resolveTop(s: GameState): GameState {
  const holder = s.priority
  const other = holder === 'player' ? 'ai' : 'player'
  s = dispatch(s, { type: 'PASS_PRIORITY' }, holder)
  s = dispatch(s, { type: 'PASS_PRIORITY' }, other)
  return s
}

describe('the stack', () => {
  it('a cast spell waits on the stack and passes priority', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [voidSeeker])
    s = placeUnitAt(s, 'ai', grunt, 0)

    s = dispatch(s, { type: 'PLAY_SPELL', card: voidSeeker, targetInstanceIds: [aiUnitId(s)] }, 'player')
    expect(s.stack).toHaveLength(1)
    expect(s.priority).toBe('player') // the caster keeps priority; opponent responds only after a pass
    // Enemy unit is untouched until the spell resolves.
    expect(aiUnits(s)).toHaveLength(1)
  })

  it('resolves and applies the effect once both players pass', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [voidSeeker])
    s = placeUnitAt(s, 'ai', grunt, 0)

    s = dispatch(s, { type: 'PLAY_SPELL', card: voidSeeker, targetInstanceIds: [aiUnitId(s)] }, 'player')
    s = resolveTop(s)

    expect(s.stack).toHaveLength(0)
    expect(aiUnits(s)).toHaveLength(0) // 4 damage killed the 2-might grunt
    expect(s.ai.trash.map((c) => c.name)).toContain('Grunt')
    expect(s.player.trash.map((c) => c.name)).toContain('Void Seeker')
    expect(s.priority).toBe('player') // active player regains priority
  })

  it('an unscripted "Predict N. Draw M." spell prompts, then draws after the pick', () => {
    const oracle = makeCard({
      name: 'Oracle Vision',
      type: 'spell',
      domains: ['fury'],
      energy: 1,
      text: '[Predict 2]. Draw 1.',
    })
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [oracle])
    const handAfterCast = 0 // oracle is the only card, spent on cast
    s = dispatch(s, { type: 'PLAY_SPELL', card: oracle }, 'player')
    s = resolveTop(s)

    // The predict choice is queued; nothing drawn yet.
    expect(s.pendingChoices).toHaveLength(1)
    expect(s.pendingChoices[0].kind).toBe('deckTop')
    expect(s.player.hand.length).toBe(handAfterCast)

    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: [] }, 'player') // keep both on top
    expect(s.pendingChoices).toHaveLength(0)
    expect(s.player.hand.length).toBe(handAfterCast + 1) // then drew
  })

  it('an unscripted "discard a card, then draw" spell prompts for the discard', () => {
    const rummage = makeCard({
      name: 'Rummage',
      type: 'spell',
      domains: ['fury'],
      energy: 1,
      text: 'Discard a card, then draw a card.',
    })
    const filler = makeCard({ name: 'Filler', type: 'unit', domains: ['fury'], energy: 1, might: 1 })
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [rummage, filler])
    s = dispatch(s, { type: 'PLAY_SPELL', card: rummage }, 'player')
    s = resolveTop(s)

    expect(s.pendingChoices[0].kind).toBe('handCard')
    s = dispatch(s, { type: 'RESOLVE_CHOICE', pickedIds: [filler.id] }, 'player')
    expect(s.player.trash.some((c) => c.id === filler.id)).toBe(true)
    expect(s.player.hand.length).toBe(1) // discarded filler, drew 1
  })

  it('Defy counters a spell on the stack so its effect never runs', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = withHand(s, 'player', [voidSeeker])
    s = withHand(s, 'ai', [defy])
    s = bumpEnergy(s, 'ai', 5)
    s = placeUnitAt(s, 'ai', grunt, 0)

    s = dispatch(s, { type: 'PLAY_SPELL', card: voidSeeker, targetInstanceIds: [aiUnitId(s)] }, 'player')
    const voidSeekerId = s.stack[0].id
    // The caster holds priority — the AI can only respond once the player passes.
    s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')
    s = dispatch(s, { type: 'PLAY_SPELL', card: defy, targetStackId: voidSeekerId }, 'ai')
    expect(s.stack).toHaveLength(2)

    s = resolveTop(s) // Defy resolves, countering Void Seeker
    expect(s.stack).toHaveLength(0)
    expect(aiUnits(s)).toHaveLength(1) // grunt survived — Void Seeker was countered
    expect(s.player.trash.map((c) => c.name)).toContain('Void Seeker')
  })
})

function aiUnits(s: GameState) {
  return s.battlefields.flatMap((bf) => bf.units.filter((u) => u.owner === 'ai'))
}
function aiUnitId(s: GameState): string {
  return aiUnits(s)[0].instanceId
}
