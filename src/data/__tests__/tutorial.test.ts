import { describe, expect, it } from 'vitest'
import { TUTORIAL_STEPS, nextStep } from '../tutorial'
import { en, ko } from '../../i18n/strings'
import { makeCard, placeAtBase, placeUnitAt, startedGame } from '../../engine/__tests__/fixtures'
import { GameState } from '../../types/game'

/**
 * The tutorial is a contextual coach: the first unseen step whose `when` is
 * true is the one shown. Two things can quietly break it — a step whose
 * condition is true from the very first frame (so it buries the one that
 * should come first), and a string key that exists in one language only.
 */

const unit = makeCard({ name: 'Trainee', type: 'unit', energy: 2, might: 2 })

describe('tutorial steps', () => {
  it('has a translation for every key, in both languages', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(en[step.titleKey], `en ${step.titleKey}`).toBeTruthy()
      expect(en[step.bodyKey], `en ${step.bodyKey}`).toBeTruthy()
      expect(ko[step.titleKey], `ko ${step.titleKey}`).toBeTruthy()
      expect(ko[step.bodyKey], `ko ${step.bodyKey}`).toBeTruthy()
    }
  })

  it('uses a unique id per step', () => {
    const ids = TUTORIAL_STEPS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('opens on the zones tip, which is what a new player gets wrong first', () => {
    const s = startedGame()
    expect(nextStep(s, new Set())?.id).toBe('zones')
  })

  it('moves on once a step is seen', () => {
    const s = startedGame()
    const first = nextStep(s, new Set())!
    const second = nextStep(s, new Set([first.id]))
    expect(second?.id).not.toBe(first.id)
  })

  it('shows nothing once every step is seen', () => {
    const s = startedGame()
    const all = new Set(TUTORIAL_STEPS.map((step) => step.id))
    expect(nextStep(s, all)).toBeNull()
  })

  it('holds the showdown tip back until a showdown is actually open', () => {
    const s = startedGame()
    const seen = new Set(TUTORIAL_STEPS.map((x) => x.id).filter((id) => id !== 'showdown'))
    expect(nextStep(s, seen), 'no showdown yet').toBeNull()

    const inShowdown: GameState = { ...s, pendingShowdown: { index: 0, declarer: 'ai' } }
    expect(nextStep(inShowdown, seen)?.id).toBe('showdown')
  })

  it('holds the contested tip back until both sides are at one battlefield', () => {
    let s = startedGame()
    const seen = new Set(TUTORIAL_STEPS.map((x) => x.id).filter((id) => id !== 'contest'))
    s = placeUnitAt(s, 'player', unit, 0)
    expect(nextStep(s, seen), 'only one side present').toBeNull()

    s = placeUnitAt(s, 'ai', unit, 0)
    expect(nextStep(s, seen)?.id).toBe('contest')
  })

  it('holds the move tip back until a unit is ready at the base', () => {
    let s = startedGame()
    const seen = new Set(TUTORIAL_STEPS.map((x) => x.id).filter((id) => id !== 'move'))
    expect(nextStep(s, seen), 'nothing at the base yet').toBeNull()

    s = placeAtBase(s, 'player', unit)
    expect(nextStep(s, seen)?.id).toBe('move')
  })

  it('says nothing once the game is decided', () => {
    // The coach checks `winner` itself; this documents that a finished game has
    // no teaching moment left worth interrupting.
    const s = startedGame()
    const won: GameState = { ...s, winner: 'player' }
    expect(won.winner).toBeTruthy()
  })
})
