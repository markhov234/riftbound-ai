import { useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Card, Domain } from '../types/card'
import { UnitInPlay } from '../types/game'
import { mightBonus } from '../engine'
import { CardRulesText } from './GlossaryText'
import { useLocale, useT, type StringKey } from '../i18n'

/** Card types and domains are closed sets, so their labels live in the string table. */
const typeKey = (type: Card['type']): StringKey => `card.type.${type}` as StringKey
export const domainKey = (d: Domain | 'colorless'): StringKey => `domain.${d}` as StringKey

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
            'text-micro font-bold uppercase tracking-wide px-1.5 py-0.5 border',
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

/** Kept in step with the `fury`/`calm`/… tokens in tailwind.config.js. */
export const DOMAIN_HEX: Record<Domain, string> = {
  fury: '#ff5a4d',
  calm: '#2fd4c4',
  order: '#5b9dff',
  chaos: '#b06bff',
  body: '#3ecf8e',
  mind: '#ffb800',
  colorless: '#6B7A8C',
}

function TextFallback({ card, size }: { card: Card; size: Size }) {
  const t = useT()
  const small = size === 'sm'
  return (
    <div className="w-full h-full bg-panel2 border border-line flex flex-col p-1 overflow-hidden">
      <div className="flex justify-between text-micro text-txtDim shrink-0 tabular-nums">
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
          small ? 'text-micro line-clamp-2' : 'text-micro line-clamp-2',
        )}
      >
        {card.name}
      </div>
      {!small && (
        <div className="hud-label mt-0.5">
          {card.supertype ? `${card.supertype} ` : ''}
          {t(typeKey(card.type))}
        </div>
      )}
    </div>
  )
}

type Size = 'sm' | 'md'

/** Cost + type overlay drawn over a card tile's image.
 *  The square is the Energy cost; a `✦N` tag flags the Power pips (recycle a
 *  rune of that domain to pay each — it floats, so no extra Energy), in the
 *  amber that Power carries everywhere else. */
function TileBadge({ card }: { card: Card }) {
  const { locale, t } = useLocale()
  // No cost chip. The printed card already carries its Energy in the gem at the
  // top-left and its Power pips beside it, at a size that reads perfectly well
  // on a tile — re-stating them in an overlay covered that corner of the art
  // with a number the player could already see. The type tag stays, because the
  // printed type banner sits mid-card and is genuinely too small to scan there.
  return (
    <span className="absolute top-0.5 right-0.5 hud-label text-micro text-txtDim bg-black/55 px-1 rounded">
      {/* Korean type names are already short; English ones get clipped to fit. */}
      {locale === 'en'
        ? card.type === 'battlefield'
          ? 'BF'
          : card.type.slice(0, 5)
        : t(typeKey(card.type))}
    </span>
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
          // Images drag natively. On a card tile that hijacks the board's own
          // drag gesture (dragstart → pointercancel) and the card simply will
          // not move. Firefox needs the attribute; the CSS counterpart for
          // Chromium/WebKit lives in index.css.
          draggable={false}
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <TextFallback card={card} size={size} />
      )}
      {badge && showImg && <TileBadge card={card} />}

      {hover &&
        preview &&
        // Rendered into <body>, not here.
        //
        // `position: fixed` is only fixed to the viewport while no ancestor has
        // a transform — one turns the ancestor into the containing block and
        // traps the element (and its z-index) inside that stacking context. The
        // hand cards carry an inline transform for the fan, so the preview was
        // being pinned inside a card tile and the battlefield panel painted
        // straight over it. A portal steps outside every stacking context.
        createPortal(
          <div
            className={clsx(
              'fixed z-[60] top-1/2 -translate-y-1/2 pointer-events-none',
              side === 'right' ? 'right-4' : 'left-4',
            )}
          >
              <CardDetail card={card} />
          </div>,
          document.body,
        )}
    </div>
  )
}

/** A large, always-visible preview pinned to the centre of the screen. */
/** One row of a Might sum, already merged across the two combat roles. */
export interface MightRow {
  key: string
  vars?: Record<string, string | number>
  n: number
  /** The term applies to both roles, so it needs no tag. */
  both: boolean
  role: 'attacker' | 'defender'
}

export interface MightExplain {
  rows: MightRow[]
  attack: number
  defend: number
  lethal: number
  stunned: boolean
}

/**
 * The arithmetic behind a unit's Might.
 *
 * Every report of "this number is wrong" in testing was really "I cannot see
 * where this number came from" — printed Might, buffs, Assault, Shield, an
 * Empowered bonus and a battlefield aura all land in one figure with nothing
 * to distinguish them. Showing the sum turns a mystery into arithmetic, and
 * makes a genuinely missing modifier visible at a glance.
 */
function MightMath({ might }: { might: MightExplain }) {
  const t = useT()
  return (
    <div className="px-3 py-2 border-t border-line text-tiny">
      <div className="hud-label text-txtFaint mb-1">{t('might.title')}</div>
      {might.rows.map((r, i) => (
        <div key={i} className="flex items-baseline gap-2 leading-tight">
          <span
            className={clsx(
              'w-7 text-right tnum shrink-0',
              r.n < 0 ? 'text-danger' : i === 0 ? 'text-txt' : 'text-accent',
            )}
          >
            {i === 0 ? r.n : `${r.n > 0 ? '+' : ''}${r.n}`}
          </span>
          <span className="text-txtDim truncate">
            {t(r.key as 'might.printed', r.vars)}
            {!r.both && (
              <span className="text-txtFaint">
                {' · '}
                {t(r.role === 'attacker' ? 'might.whenAttacking' : 'might.whenDefending')}
              </span>
            )}
          </span>
        </div>
      ))}
      <div className="mt-1.5 pt-1.5 border-t border-line/60 flex items-center gap-3 tnum">
        <span className="text-accent font-bold">{might.attack}⚔</span>
        <span className="text-hextech font-bold">{might.defend}⛨</span>
        <span className="text-txtDim">{t('might.toKill', { n: might.lethal })}</span>
      </div>
      {might.stunned && (
        <div className="mt-1 text-micro text-danger leading-snug">{t('might.stunnedNote')}</div>
      )}
    </div>
  )
}

export function CenterPreview({
  card,
  unit,
  statuses,
  might,
  side = 'right',
}: {
  card: Card | null
  unit?: UnitInPlay
  statuses?: string[]
  might?: MightExplain | null
  /** Which edge to dock to. The caller flips this away from the pointer so the
   *  preview never sits on top of what you are about to click — the gear box
   *  lives under the right-hand dock, which made gear untargetable in practice. */
  side?: 'left' | 'right'
}) {
  if (!card) return null
  return (
    <div
      className={clsx(
        'fixed top-64 z-20 w-[var(--side-w,16rem)] pointer-events-none transition-[left,right] duration-150',
        side === 'right' ? 'right-2' : 'left-2',
      )}
    >
      <div className="w-full overflow-hidden border border-line bg-panel shadow-xl">
        {card.imageUrl ? (
          <img src={card.imageUrl} alt={card.name} className="w-full block" />
        ) : (
          <div className={clsx('w-full', ASPECT)}>
            <TextFallback card={card} size="md" />
          </div>
        )}
        <div className="px-3 py-1.5 border-t border-line flex items-center justify-between">
          <span className="display-face text-sm text-txt truncate">{card.name}</span>
          <StatLine card={card} unit={unit} />
        </div>
        <StatusRow statuses={statuses} />
        {might && <MightMath might={might} />}
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
  const t = useT()
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
        <div className="display-face leading-tight text-base text-txt">{card.name}</div>
        <div className="hud-label mt-0.5">
          {card.supertype ? `${card.supertype} ` : ''}
          {t(typeKey(card.type))}
          {card.domains.length > 0 && ` · ${card.domains.map((d) => t(domainKey(d))).join('/')}`}
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
            <CardRulesText showOriginal text={card.text} />
          </p>
        )}
        {card.flavour && (
          <p className="text-tiny text-txtFaint italic mt-2 leading-snug">{card.flavour}</p>
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
  const t = useT()
  return (
    <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[65] pointer-events-auto">
      <div className="relative">
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 w-6 h-6 bg-panel2 border border-line
                     text-txt text-xs hover:border-accent hover:text-accent"
          title={t('common.close')}
        >
          ✕
        </button>
        <CardDetail card={card} unit={unit} statuses={statuses} />
        <div className="mt-1 text-center hud-label">{t('card.pinnedHint')}</div>
      </div>
    </div>
  )
}
