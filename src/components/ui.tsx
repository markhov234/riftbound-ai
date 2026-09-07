import { ReactNode, useEffect } from 'react'
import clsx from 'clsx'

/* Style-only primitives for the terminal / HUD reskin. No app logic. */

export function Panel({
  children,
  className,
  elevated,
  onClick,
}: {
  children: ReactNode
  className?: string
  elevated?: boolean
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={clsx('border border-line', elevated ? 'bg-panel2' : 'bg-panel', className)}
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
        'uppercase tracking-[0.1em] text-[11px] font-bold px-3 py-1.5 transition-colors disabled:opacity-35 disabled:cursor-not-allowed',
        variant === 'primary'
          ? 'bg-accent text-black hover:bg-[#ff7038]'
          : 'border border-line text-txt hover:border-accent hover:text-accent',
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
          'text-[13px] font-bold',
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
      <span className="text-[11px] text-txtDim tabular-nums">
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
      className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          'bg-panel border border-line max-h-[85vh] overflow-y-auto',
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
export function LogLine({ text, index }: { text: string; index: number }) {
  const m = text.match(ACTOR_RE)
  let actor = ''
  let rest = text
  if (m) {
    actor = m[0]
    rest = text.slice(m[0].length)
  }
  const actorClass = /you|player/i.test(actor)
    ? 'text-accent'
    : /ai/i.test(actor)
      ? 'text-txt'
      : 'text-txtDim'
  return (
    <p className="text-[11px] leading-snug flex gap-2">
      <span className="text-accentDim tabular-nums shrink-0">
        {String(9 + Math.floor(index / 6)).padStart(2, '0')}:
        {String((index * 7) % 60).padStart(2, '0')}
      </span>
      <span className="min-w-0">
        {actor && <span className={clsx('font-bold uppercase', actorClass)}>{actor}</span>}
        <span className="text-txtDim">{rest}</span>
      </span>
    </p>
  )
}
