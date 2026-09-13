import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { PlayerSide } from '../types/game'
import { Btn } from './ui'
import { useT } from '../i18n'

const PIPS = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

/**
 * Pre-game die roll: both sides roll a d6 (re-roll ties); the winner chooses to
 * play first or second. The AI, if it wins, always chooses to play first.
 */
export default function DiceRoll({
  onDecide,
  onBack,
}: {
  onDecide: (firstPlayer: PlayerSide) => void
  onBack: () => void
}) {
  const t = useT()
  const [player, setPlayer] = useState(0)
  const [ai, setAi] = useState(0)
  const [rolling, setRolling] = useState(true)

  useEffect(() => {
    const spin = setInterval(() => {
      setPlayer(1 + Math.floor(Math.random() * 6))
      setAi(1 + Math.floor(Math.random() * 6))
    }, 70)
    const stop = setTimeout(() => {
      clearInterval(spin)
      let p: number, a: number
      do {
        p = 1 + Math.floor(Math.random() * 6)
        a = 1 + Math.floor(Math.random() * 6)
      } while (p === a)
      setPlayer(p)
      setAi(a)
      setRolling(false)
    }, 900)
    return () => {
      clearInterval(spin)
      clearTimeout(stop)
    }
  }, [])

  const playerWon = player > ai

  return (
    <div className="min-h-screen bg-bg text-txt flex flex-col items-center justify-center p-6">
      <h2 className="display-face text-3xl text-accent mb-1">{t('dice.title')}</h2>
      <p className="hud-label normal-case tracking-normal mb-8">
        {t('dice.subtitle')}
      </p>

      <div className="flex items-center gap-12 mb-8">
        {(['common.you', 'common.ai'] as const).map((who, i) => {
          const v = i === 0 ? player : ai
          const won = !rolling && (i === 0 ? playerWon : !playerWon)
          return (
            <div key={who} className="flex flex-col items-center gap-2">
              <span
                className={clsx('hud-label', i === 0 ? 'text-accent' : 'text-txtDim')}
              >
                {t(who)}
              </span>
              <div
                className={clsx(
                  'w-24 h-24 flex items-center justify-center text-6xl bg-panel border transition-colors',
                  rolling ? 'border-line animate-pulse' : won ? 'border-accent text-accent' : 'border-line',
                )}
              >
                {PIPS[v] || '·'}
              </div>
            </div>
          )
        })}
      </div>

      {rolling ? (
        <p className="hud-label h-24">{t('dice.rolling')}</p>
      ) : playerWon ? (
        <div className="flex flex-col items-center gap-3 h-24">
          <p className="text-accent text-sm">{t('dice.youWon')}</p>
          <div className="flex gap-3">
            <Btn variant="primary" onClick={() => onDecide('player')}>
              {t('dice.playFirst')}
            </Btn>
            <Btn onClick={() => onDecide('ai')}>{t('dice.playSecond')}</Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 h-24">
          <p className="text-txtDim text-sm">
            {t('dice.aiWon')}
          </p>
          <Btn variant="primary" onClick={() => onDecide('ai')}>
            {t('dice.start')}
          </Btn>
        </div>
      )}

      <button onClick={onBack} className="mt-6 hud-label hover:text-accent">
        {t('common.back')}
      </button>
    </div>
  )
}
