import { useEffect, useState } from 'react'
import { GameState } from '../types/game'
import { useT } from '../i18n'
import { markSeen, nextStep, readSeen, readTutorialEnabled, writeTutorialEnabled } from '../data/tutorial'

/**
 * The tutorial surface: one short strip above the action bar, explaining the
 * thing that has just become relevant.
 *
 * Deliberately **not** a modal, not a spotlight overlay, and not a floating
 * card. A first-time player needs to read the tip *while* looking at the board
 * it describes, so dimming the board defeats it — and a floating panel covered
 * the hand, which is exactly what the first tips tell you to go and use. In the
 * normal flow it takes its own space, covers nothing, and can be ignored by the
 * player who already knows the rules.
 *
 * State lives in `localStorage` (`data/tutorial.ts`), so progress survives a
 * reload and the tips do not repeat next game.
 */
export function TutorialCoach({ state }: { state: GameState }) {
  const t = useT()
  const [enabled, setEnabled] = useState(readTutorialEnabled)
  const [seen, setSeen] = useState<Set<string>>(readSeen)

  // The menu checkbox can flip this between games.
  useEffect(() => {
    setEnabled(readTutorialEnabled())
    setSeen(readSeen())
  }, [])

  const step = enabled && !state.winner ? nextStep(state, seen) : null
  if (!step) return null

  const dismiss = () => {
    const next = new Set(seen).add(step.id)
    setSeen(next)
    markSeen(next)
  }

  const turnOff = () => {
    writeTutorialEnabled(false)
    setEnabled(false)
  }

  return (
    <div
      role="note"
      className="shrink-0 flex items-start gap-3 px-4 py-2 border-t-2 border-accent/70 bg-panel2 max-md:flex-wrap max-md:gap-2"
    >
      <span className="hud-label text-accent shrink-0 mt-0.5">{t('tut.badge')}</span>
      <div className="min-w-0 flex-1">
        <span className="display-face text-sm text-txt">{t(step.titleKey)}</span>
        <p className="text-tiny text-txtDim leading-relaxed">{t(step.bodyKey)}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0 max-md:w-full max-md:justify-end">
        <button
          onClick={turnOff}
          className="text-micro text-txtFaint hover:text-txt transition-colors underline underline-offset-2 whitespace-nowrap"
        >
          {t('tut.skipAll')}
        </button>
        <button
          onClick={dismiss}
          className="px-3 py-1 border border-accentDim text-accent text-tiny hover:bg-accent hover:text-black transition-colors whitespace-nowrap"
        >
          {t('tut.gotIt')}
        </button>
      </div>
    </div>
  )
}
