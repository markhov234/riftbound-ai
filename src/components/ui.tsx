import { ReactNode, useEffect } from 'react'
import clsx from 'clsx'
import { useLocale } from '../i18n'
import { isTurnMarker, logLineKo, logWeight } from '../i18n/logText'

/* Style-only primitives. No app logic.
 *
 * These set the tone for everything else on the board, so they are kept
 * deliberately plain: one radius, one easing, borders only where they carry
 * meaning. A primitive that decorates itself gets multiplied by every screen. */

export function Panel({
  children,
  className,
  elevated,
  outlined = true,
  onClick,
}: {
  children: ReactNode
  className?: string
  elevated?: boolean
  /** Draw the hairline. Off for panels that already sit on a darker ground. */
  outlined?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={clsx(
        elevated ? 'bg-panel2' : 'bg-panel',
        outlined && 'border border-line',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Btn({
  children,
  onClick,
  variant = 'ghost',
  disabled,
  className,
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost'
  disabled?: boolean
  className?: string
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(
        // Display serif in normal case. Uppercase + wide tracking on every
        // control was a big part of why the UI read as generated chrome.
        'display-face text-sm px-4 py-2 transition-all duration-200 ease-calm',
        'disabled:opacity-35 disabled:cursor-not-allowed',
        variant === 'primary'
          ? // The fill already separates it from the board; an outline and a
            // drop shadow on top of that is three separations doing one job.
            'bg-accent hover:bg-accentBright'
          : // Ghost: no border at rest. It resolves into a button under the
            // pointer, which keeps a toolbar of them from reading as a fence.
            'text-txtDim border border-transparent hover:border-line hover:bg-panel hover:text-txt',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Chip({
  label,
  value,
  tone = 'txt',
  className,
}: {
  label: string
  value: ReactNode
  tone?: 'txt' | 'accent' | 'danger'
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 border border-line px-2 py-0.5 leading-none',
        className,
      )}
    >
      <span className="hud-label">{label}</span>
      <span
        className={clsx(
          'text-sm font-bold',
          tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-txt',
        )}
      >
        {value}
      </span>
    </span>
  )
}

export function SegmentBar({
  value,
  max,
  className,
}: {
  value: number
  max: number
  className?: string
}) {
  const cells = Math.max(max, value, 0)
  return (
    <div className={clsx('flex items-center gap-2', className)}>
      <div className="flex gap-[3px]">
        {Array.from({ length: cells }).map((_, i) => (
          <span
            key={i}
            className={clsx(
              'w-[9px] h-[15px]',
              i < value ? 'bg-accent' : 'border border-line',
            )}
          />
        ))}
      </div>
      <span className="text-tiny text-txtDim tabular-nums">
        {value}/{max}
      </span>
    </div>
  )
}

export function Rule({ label, className }: { label?: string; className?: string }) {
  if (!label) return <div className={clsx('border-t border-line', className)} />
  return (
    <div className={clsx('relative flex items-center justify-center my-1', className)}>
      <div className="absolute inset-x-0 top-1/2 border-t border-line" />
      <span className="relative bg-bg px-3 hud-label text-accent/80">{label}</span>
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title?: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 animate-[rb-fade_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'bg-panel border border-line max-h-[85vh] overflow-y-auto animate-[rb-pop_0.2s_ease-out]',
          wide ? 'w-[720px] max-w-full' : 'max-w-2xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2">
          <span className="hud-label text-txt">{title}</span>
          <button onClick={onClose} className="text-txtDim hover:text-accent text-sm">
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

const ACTOR_RE = /^(You|AI|Player|player|ai|Game|System|Battlefield|Showdown)\b/

/** Render one `state.log` line with actor / verb coloring, terminal-style. */
export function LogLine({ text }: { text: string }) {
  const { locale } = useLocale()

  if (isTurnMarker(text)) {
    const who = text.replace(/^—s*|s*—$/g, '')
    return (
      <div className="flex items-center gap-2 pt-2 pb-1 first:pt-0">
        <span className="h-px flex-1 bg-line2" />
        <span className="hud-label text-txtFaint shrink-0">{who}</span>
        <span className="h-px flex-1 bg-line2" />
      </div>
    )
  }

  const weight = logWeight(text)
  // Colour the actor off the *English* line — that is where the actor word is
  // in a known position — then render the Korean translation if there is one.
  const m = text.match(ACTOR_RE)
  const actorClass = /you|player/i.test(m?.[0] ?? '')
    ? 'text-accent'
    : /ai/i.test(m?.[0] ?? '')
      ? 'text-danger/90'
      : 'text-txtDim'

  if (locale === 'ko') {
    const ko = logLineKo(text)
    if (ko) {
      // The translations put the actor first ("내가 …", "AI가 …", "AI의 …"),
      // so the same colour coding still works.
      const km = ko.match(/^(내가|나의|AI가|AI의)/)
      return (
        <p className={clsx('text-tiny leading-snug break-words', weight === 'minor' && 'opacity-55')}>
          {km && <span className={clsx('font-bold', actorClass)}>{km[0]}</span>}
          <span className={weight === 'major' ? 'text-txt' : 'text-txtDim'}>
            {km ? ko.slice(km[0].length) : ko}
          </span>
        </p>
      )
    }
  }

  let actor = ''
  let rest = text
  if (m) {
    actor = m[0]
    rest = text.slice(m[0].length)
  }
  return (
    <p className={clsx('text-tiny leading-snug break-words', weight === 'minor' && 'opacity-55')}>
      {actor && <span className={clsx('font-bold uppercase', actorClass)}>{actor}</span>}
      <span className={weight === 'major' ? 'text-txt' : 'text-txtDim'}>{rest}</span>
    </p>
  )
}
