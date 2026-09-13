import { GameState } from '../types/game'
import type { StringKey } from '../i18n/strings'

/**
 * The tutorial is a **contextual coach**, not a scripted walkthrough.
 *
 * A step appears the first time its `when` is true in a real game, explains the
 * thing that has just become relevant, and never appears again. That teaches in
 * the moment the player needs it, and — unlike a wall of text at the start —
 * costs nothing to anyone who already knows the rules.
 *
 * Order matters: the first unseen step whose `when` passes is the one shown, so
 * put the fundamentals first. Only one tip is on screen at a time.
 *
 * The content is chosen from what actually confused a first-time player of this
 * build: which zone is which, what a rune is for, that moving in does not fight
 * on its own, and how the game is won.
 */
export interface TutorialStep {
  id: string
  titleKey: StringKey
  bodyKey: StringKey
  /** Shown only when this is true and the step has not been seen. */
  when: (state: GameState) => boolean
}

const myUnitsAtBattlefields = (s: GameState) =>
  s.battlefields.flatMap((bf) => bf.units).filter((u) => u.owner === 'player')

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    // First thing on screen, and the thing a new player got wrong first.
    id: 'zones',
    titleKey: 'tut.zones.title',
    bodyKey: 'tut.zones.body',
    when: (s) => s.phase === 'action' && s.activePlayer === 'player' && s.turn <= 1,
  },
  {
    id: 'runes',
    titleKey: 'tut.runes.title',
    bodyKey: 'tut.runes.body',
    when: (s) => s.player.runes.channeled.length > 0 && s.activePlayer === 'player',
  },
  {
    id: 'playCard',
    titleKey: 'tut.playCard.title',
    bodyKey: 'tut.playCard.body',
    when: (s) =>
      s.activePlayer === 'player' &&
      s.phase === 'action' &&
      s.player.hand.some((c) => c.type === 'unit'),
  },
  {
    // Only once a unit is actually sitting at the base waiting to be used.
    id: 'move',
    titleKey: 'tut.move.title',
    bodyKey: 'tut.move.body',
    when: (s) => s.activePlayer === 'player' && s.player.base.some((u) => !u.exhausted && !u.sick),
  },
  {
    id: 'contest',
    titleKey: 'tut.contest.title',
    bodyKey: 'tut.contest.body',
    when: (s) =>
      s.battlefields.some(
        (bf) =>
          bf.units.some((u) => u.owner === 'player') && bf.units.some((u) => u.owner === 'ai'),
      ),
  },
  {
    id: 'scoring',
    titleKey: 'tut.scoring.title',
    bodyKey: 'tut.scoring.body',
    when: (s) => myUnitsAtBattlefields(s).length > 0,
  },
  {
    id: 'showdown',
    titleKey: 'tut.showdown.title',
    bodyKey: 'tut.showdown.body',
    when: (s) => !!s.pendingShowdown,
  },
  {
    id: 'respond',
    titleKey: 'tut.respond.title',
    bodyKey: 'tut.respond.body',
    when: (s) => s.stack.length > 0 && s.priority === 'player',
  },
  {
    id: 'hidden',
    titleKey: 'tut.hidden.title',
    bodyKey: 'tut.hidden.body',
    when: (s) => s.battlefields.some((bf) => !!bf.facedown),
  },
  {
    id: 'keywords',
    titleKey: 'tut.keywords.title',
    bodyKey: 'tut.keywords.body',
    when: (s) =>
      s.player.hand.some((c) => c.keywords.length > 0) && s.activePlayer === 'player',
  },
]

const SEEN_KEY = 'rb-tutorial-seen'
const ENABLED_KEY = 'rb-tutorial'

/** Steps already shown. Reading storage can throw in a locked-down browser. */
export function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function markSeen(ids: Set<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...ids]))
  } catch {
    /* private mode — the tutorial just repeats next session */
  }
}

/** On by default: someone who has never played is the one who needs it. */
export function readTutorialEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeTutorialEnabled(on: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off')
  } catch {
    /* nothing to do */
  }
}

/** Forget every step, so the tutorial runs again from the top. */
export function resetTutorial(): void {
  try {
    localStorage.removeItem(SEEN_KEY)
  } catch {
    /* nothing to do */
  }
}

/** The step to show now, or null. */
export function nextStep(state: GameState, seen: Set<string>): TutorialStep | null {
  return TUTORIAL_STEPS.find((step) => !seen.has(step.id) && step.when(state)) ?? null
}
