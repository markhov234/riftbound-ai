import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { Card, Deck } from '../types/card'
import { CardArt } from './CardArt'
import GlossaryText from './GlossaryText'

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

  const [picked, setPicked] = useState<string>(battlefields[0]?.id ?? '')

  return (
    <div className="min-h-screen bg-bg text-txt flex flex-col items-center justify-center p-6">
      <h2 className="text-lg font-bold uppercase tracking-[0.15em] mb-1">Choose your Battlefield</h2>
      <p className="hud-label normal-case tracking-normal mb-8">
        You present one of your three. The AI presents one of its own — two battlefields in play.
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
            <div className="font-bold text-xs uppercase tracking-wide">{bf.name}</div>
            <p className="text-[11px] text-txtDim mt-1 leading-snug">
              {bf.text ? <GlossaryText text={bf.text} /> : 'No special effect.'}
            </p>
          </button>
        ))}
        {battlefields.length === 0 && (
          <p className="text-txtDim text-sm">This deck has no battlefields — a default will be used.</p>
        )}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="px-4 py-1.5 border border-line text-txt text-[11px] font-bold uppercase tracking-[0.1em] hover:border-accent hover:text-accent"
        >
          ← Back
        </button>
        <button
          onClick={() => onConfirm(picked)}
          className="px-5 py-1.5 bg-accent hover:bg-[#ff7038] text-black text-[11px] font-bold uppercase tracking-[0.12em]"
        >
          Start Game ▶
        </button>
      </div>
    </div>
  )
}
