import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Card, Deck } from '../types/card'
import { CardArt } from './CardArt'
import { CardRulesText } from './GlossaryText'
import { useT } from '../i18n'

interface Props {
  deck: Deck
  allCards: Card[]
  onConfirm: (battlefieldId: string) => void
  onBack: () => void
}

export default function BattlefieldPicker({ deck, allCards, onConfirm, onBack }: Props) {
  const battlefields = useMemo(() => {
    const byId = new Map(allCards.map((c) => [c.id, c]))
    return deck.battlefieldIds.map((id) => byId.get(id)).filter((c): c is Card => !!c)
  }, [deck, allCards])

  const t = useT()
  const [picked, setPicked] = useState<string>(battlefields[0]?.id ?? '')

  return (
    <div className="min-h-screen bg-bg text-txt flex flex-col items-center justify-center p-6">
      <h2 className="display-face text-3xl text-accent mb-1">{t('bf.title')}</h2>
      <p className="hud-label normal-case tracking-normal mb-8">
        {t('bf.subtitle')}
      </p>

      <div className="flex flex-wrap gap-4 justify-center max-w-5xl mb-10">
        {battlefields.map((bf) => (
          <button
            key={bf.id}
            onClick={() => setPicked(bf.id)}
            className={clsx(
              'w-80 border p-3 text-left transition-colors bg-panel',
              picked === bf.id ? 'border-accent' : 'border-line hover:border-line2',
            )}
          >
            <div className="w-full mb-2 overflow-hidden border border-line">
              <CardArt card={bf} preview={false} badge={false} />
            </div>
            <div className="display-face text-sm text-txt">{bf.name}</div>
            <p className="text-tiny text-txtDim mt-1 leading-snug">
              {bf.text ? <CardRulesText text={bf.text} /> : t('bf.noEffect')}
            </p>
          </button>
        ))}
        {battlefields.length === 0 && (
          <p className="text-txtDim text-sm">{t('bf.noneInDeck')}</p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-2 border border-transparent text-txtDim display-face text-sm transition-all duration-200 ease-calm hover:border-line hover:bg-panel hover:text-txt"
        >
          {t('common.back')}
        </button>
        <button
          onClick={() => onConfirm(picked)}
          className="px-5 py-2 bg-accent hover:bg-accentBright text-black display-face text-sm transition-all duration-200 ease-calm"
        >
          {t('common.startGame')}
        </button>
      </div>
    </div>
  )
}
