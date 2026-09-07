import { Fragment, ReactNode } from 'react'
import { lookupKeyword, lookupPlain, lookupSymbol } from '../data/glossary'

const PLAIN_RE = 'excess damage|showdowns?|conquer(?:s|ed|ing)?|tokens?|holds?|recall(?:s|ed|ing)?|banish(?:es|ed|ing)?'
const TOKEN_RE = new RegExp(`(\\[[^\\]]+\\]|:rb_[a-z0-9_]+:|\\b(?:${PLAIN_RE})\\b)`, 'gi')

/** "conquered" → "conquer", "showdowns" → "showdown". */
function plainEntry(word: string) {
  const w = word.toLowerCase()
  return lookupPlain(w) ?? lookupPlain(w.replace(/(es|ed|ing|s)$/, ''))
}

function Tip({ label, tip, className }: { label: ReactNode; tip: string; className?: string }) {
  return (
    <span className={`relative group inline-block ${className ?? ''}`}>
      <span className="underline decoration-dotted decoration-line2 cursor-help">{label}</span>
      <span
        className="pointer-events-none absolute left-0 bottom-full mb-1 z-[70] hidden group-hover:block
                   w-64 bg-panel border border-line px-2 py-1.5
                   text-[11px] leading-snug text-txt whitespace-normal"
      >
        {tip}
      </span>
    </span>
  )
}

/** Render card text, turning [Keywords] and :rb_*: symbols into hover-explained tokens. */
export default function GlossaryText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  if (!text) return null
  const parts = text.split(TOKEN_RE).filter((p) => p !== '')

  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (part.startsWith('[') && part.endsWith(']')) {
          const entry = lookupKeyword(part)
          if (entry) {
            return (
              <Tip
                key={i}
                label={<span className="font-semibold text-accent">{part.slice(1, -1)}</span>}
                tip={`${entry.term} — ${entry.text}`}
              />
            )
          }
          return <Fragment key={i}>{part}</Fragment>
        }
        if (part.startsWith(':rb_')) {
          const sym = lookupSymbol(part)
          if (sym) {
            return (
              <Tip
                key={i}
                label={<span className="text-[#4aa3c7] font-medium">{sym.glyph}</span>}
                tip={sym.text}
              />
            )
          }
          return <Fragment key={i}>{part}</Fragment>
        }
        const plain = plainEntry(part)
        if (plain) {
          return (
            <Tip
              key={i}
              label={<span className="text-txt">{part}</span>}
              tip={`${plain.term} — ${plain.text}`}
            />
          )
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </span>
  )
}
