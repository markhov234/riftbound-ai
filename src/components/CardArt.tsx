import { useState } from 'react'
import clsx from 'clsx'
import { Card, Domain } from '../types/card'
import { UnitInPlay } from '../types/game'
import { mightBonus } from '../engine'
import GlossaryText from './GlossaryText'

/** `⚡E ✦P  M⚔ (+N)` — the stat line shared by the detail popup and centre preview.
 *  `⚡` is the Energy cost; each `✦` is a Power pip paid by recycling a rune of
 *  that domain (it floats, so it costs no extra Energy). */
function StatLine({ card, unit }: { card: Card; unit?: UnitInPlay }) {
  const bonus = unit ? mightBonus(unit) : 0
  return (
    <span className="text-xs text-txtDim tabular-nums">
      ⚡{card.energy}
      {card.power > 0 ? `  ✦${card.power}` : ''}
      {card.might > 0 || unit ? `  ${card.might}⚔` : ''}
      {bonus !== 0 && (
        <span className={clsx('ml-1 font-bold', bonus > 0 ? 'text-accent' : 'text-danger')}>
          {bonus > 0 ? '+' : ''}
          {bonus}
        </span>
      )}
    </span>
  )
}

const ASPECT = 'aspect-[5/7]'

/** Small pills describing a unit's / gear's live status (Empowered, Stunned, …). */
function StatusRow({ statuses }: { statuses?: string[] }) {
  if (!statuses || statuses.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 px-3 pb-2">
      {statuses.map((s) => (
        <span
          key={s}
          className={clsx(
            'text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border',
            s === 'Empowered'
              ? 'border-accent text-accent'
              : /^-/.test(s)
                ? 'border-danger text-danger'
                : 'border-line text-txtDim',
          )}
        >
          {s}
        </span>
      ))}
    </div>
  )
}

export const DOMAIN_HEX: Record<Domain, string> = {
  fury: '#c0392b',
  calm: '#16a085',
  order: '#2980b9',
  chaos: '#8e44ad',
  body: '#27ae60',
  mind: '#f39c12',
  colorless: '#8a8f98',
}

function TextFallback({ card, size }: { card: Card; size: Size }) {
  const small = size === 'sm'
  return (
    <div className="w-full h-full bg-panel2 border border-line flex flex-col p-1 overflow-hidden">
      <div className="flex justify-between text-[10px] text-txtDim shrink-0 tabular-nums">
        <span>
          ⚡{card.energy}
          {card.power > 0 ? ` ✦${card.power}` : ''}
        </span>
        {card.might > 0 && <span className="text-accent">{card.might}⚔</span>}
      </div>
      <div className="flex-1 flex items-center justify-center text-line2 text-2xl">◇</div>
      <div
        className={clsx(
          'font-bold text-txt leading-tight uppercase tracking-wide',
          small ? 'text-[8px] line-clamp-2' : 'text-[10px] line-clamp-2',
        )}
      >
        {card.name}
      </div>
      {!small && (
        <div className="hud-label mt-0.5">
          {card.supertype ? `${card.supertype} ` : ''}
          {card.type}
        </div>
      )}
    </div>
  )
}

type Size = 'sm' | 'md'

/** The mockup's mana-square + type-tag overlay drawn over a card tile's image.
 *  The square is the Energy cost; a `✦N` tag flags the Power pips (recycle a
 *  rune of that domain to pay each — it floats, so no extra Energy). */
function TileBadge({ card }: { card: Card }) {
  return (
    <>
      <span className="absolute top-0 left-0 bg-accent text-black text-[10px] font-bold min-w-4 h-4 px-0.5 flex items-center justify-center leading-none">
        {card.energy}
      </span>
      {card.power > 0 && (
        <span className="absolute top-4 left-0 bg-black/75 text-accent text-[8px] font-bold px-0.5 leading-none">
          ✦{card.power}
        </span>
      )}
      <span className="absolute top-0.5 right-0.5 hud-label text-[8px] text-txtDim bg-black/60 px-0.5">
        {card.type === 'battlefield' ? 'BF' : card.type.slice(0, 5)}
      </span>
    </>
  )
}

export function CardArt({
  card,
  size = 'md',
  className,
  preview = true,
  badge = true,
}: {
  card: Card
  size?: Size
  className?: string
  preview?: boolean
  badge?: boolean
}) {
  const [errored, setErrored] = useState(false)
  const [hover, setHover] = useState(false)
  const [side, setSide] = useState<'left' | 'right'>('right')

  const showImg = card.imageUrl && !errored
  // Battlefield card art is landscape (~7:5); everything else is portrait 5:7.
  const frame = card.type === 'battlefield' ? 'aspect-[7/5]' : ASPECT

  return (
    <div
      className={clsx('relative', frame, className)}
      onMouseEnter={() => preview && setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseMove={(e) => setSide(e.clientX > window.innerWidth / 2 ? 'left' : 'right')}
    >
      {showImg ? (
        <img
          src={card.imageUrl}
          alt={card.name}
          loading="lazy"
          decoding="async"
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <TextFallback card={card} size={size} />
      )}
      {badge && showImg && <TileBadge card={card} />}

      {hover && preview && (
        <div
          className={clsx(
            'fixed z-[60] top-1/2 -translate-y-1/2 pointer-events-none',
            side === 'right' ? 'right-4' : 'left-4',
          )}
        >
          <CardDetail card={card} />
        </div>
      )}
    </div>
  )
}

/** A large, always-visible preview pinned to the centre of the screen. */
export function CenterPreview({
  card,
  unit,
  statuses,
}: {
  card: Card | null
  unit?: UnitInPlay
  statuses?: string[]
}) {
  if (!card) return null
  return (
    <div className="fixed right-2 top-64 z-20 w-[var(--side-w,16rem)] pointer-events-none">
      <div className="w-full overflow-hidden border border-line bg-panel shadow-xl">
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} className="w-full block" />
        ) : (
          <div className={clsx('w-full', ASPECT)}>
            <TextFallback card={card} size="md" />
          </div>
        )}
        <div className="px-3 py-1.5 border-t border-line flex items-center justify-between">
          <span className="text-[11px] font-bold text-txt uppercase tracking-wide truncate">
            {card.name}
          </span>
          <StatLine card={card} unit={unit} />
        </div>
        <StatusRow statuses={statuses} />
      </div>
    </div>
  )
}

export function CardDetail({
  card,
  unit,
  statuses,
}: {
  card: Card
  unit?: UnitInPlay
  statuses?: string[]
}) {
  const bf = card.type === 'battlefield'
  return (
    <div className="w-[440px] max-w-[90vw] bg-panel border border-line p-3 flex gap-3">
      <div className={clsx('shrink-0 border border-line', bf ? 'w-52 aspect-[7/5]' : `w-40 ${ASPECT}`)}>
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover" />
        ) : (
          <TextFallback card={card} size="md" />
        )}
      </div>
      <div className="min-w-0 text-txt">
        <div className="font-bold leading-tight uppercase tracking-wide text-sm">{card.name}</div>
        <div className="hud-label mt-0.5">
          {card.supertype ? `${card.supertype} ` : ''}
          {card.type}
          {card.domains.length > 0 && ` · ${card.domains.join('/')}`}
        </div>
        <div className="mt-1">
          <StatLine card={card} unit={unit} />
        </div>
        {statuses && statuses.length > 0 && (
          <div className="-mx-3 mt-1">
            <StatusRow statuses={statuses} />
          </div>
        )}
        {card.text && (
          <p className="text-xs text-txt mt-2 whitespace-pre-wrap leading-snug">
            <GlossaryText text={card.text} />
          </p>
        )}
        {card.flavour && (
          <p className="text-[11px] text-txtFaint italic mt-2 leading-snug">{card.flavour}</p>
        )}
      </div>
    </div>
  )
}

/**
 * An Alt-pinned card that stays on screen and accepts pointer events, so you can
 * hover its keywords / symbols / game-terms for glossary explanations.
 */
export function PinnedCard({
  card,
  unit,
  statuses,
  onClose,
}: {
  card: Card
  unit?: UnitInPlay
  statuses?: string[]
  onClose: () => void
}) {
  return (
    <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[65] pointer-events-auto">
      <div className="relative">
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 w-6 h-6 bg-panel2 border border-line
                     text-txt text-xs hover:border-accent hover:text-accent"
          title="Close (Esc)"
        >
          ✕
        </button>
        <CardDetail card={card} unit={unit} statuses={statuses} />
        <div className="mt-1 text-center hud-label">hover a keyword for its rule · Esc to close</div>
      </div>
    </div>
  )
}
