import { Fragment, ReactNode } from 'react'
import { GlossaryEntry, lookupKeyword, lookupPlain, lookupSymbol } from '../data/glossary'
import { koFor, symbolTextKo } from '../data/glossary.ko'
import { useLocale } from '../i18n'
import { cardTextKo } from '../i18n/cardText'

/** The card API returns HTML-escaped text; these reach the UI verbatim otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
}

const PLAIN_RE = 'excess damage|showdowns?|conquer(?:s|ed|ing)?|tokens?|holds?|recall(?:s|ed|ing)?|banish(?:es|ed|ing)?'
const TOKEN_RE = new RegExp(`(\\[[^\\]]+\\]|:rb_[a-z0-9_]+:|\\b(?:${PLAIN_RE})\\b)`, 'gi')

/** "conquered" → "conquer", "showdowns" → "showdown". */
function plainEntry(word: string) {
  const w = word.toLowerCase()
  return lookupPlain(w) ?? lookupPlain(w.replace(/(es|ed|ing|s)$/, ''))
}

/**
 * The tooltip body for an entry. In Korean it leads with the Korean gloss and
 * keeps the English term in parentheses, because the card art on screen is
 * printed in English — the reader needs to be able to map one to the other.
 */
function entryTip(entry: GlossaryEntry, ko: boolean): string {
  const k = ko ? koFor(entry) : undefined
  return k ? `${k.term} (${entry.term}) — ${k.text}` : `${entry.term} — ${entry.text}`
}

function Tip({ label, tip, className }: { label: ReactNode; tip: string; className?: string }) {
  return (
    <span className={`relative group inline-block ${className ?? ''}`}>
      <span className="underline decoration-dotted decoration-line2 cursor-help">{label}</span>
      <span
        className="pointer-events-none absolute left-0 bottom-full mb-1 z-[70] hidden group-hover:block
                   w-64 bg-panel border border-line px-2 py-1.5
                   text-tiny leading-snug text-txt whitespace-normal"
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
  const { locale } = useLocale()
  const ko = locale === 'ko'
  if (!text) return null
  const parts = decodeEntities(text).split(TOKEN_RE).filter((p) => p !== '')

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
                tip={entryTip(entry, ko)}
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
                label={<span className="text-hextech font-medium">{sym.glyph}</span>}
                tip={(ko && symbolTextKo(sym.text)) || sym.text}
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
              tip={entryTip(plain, ko)}
            />
          )
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </span>
  )
}

/**
 * A card's rules text. In English this is just `GlossaryText`. In Korean it
 * shows the translated line first and keeps the English original beneath it,
 * dimmed — the card art on screen is English, the translator only covers part
 * of the card pool (see `i18n/cardText.ts`), and a rules dispute should always
 * be settleable against the printed wording.
 */
export function CardRulesText({
  text,
  className,
  showOriginal = false,
}: {
  text: string
  className?: string
  /** Also print the English underneath. Only the big card preview does. */
  showOriginal?: boolean
}) {
  const { locale } = useLocale()
  if (!text) return null
  if (locale !== 'ko') return <GlossaryText text={text} className={className} />

  const ko = cardTextKo(decodeEntities(text))
  if (!ko) return <GlossaryText text={text} className={className} />

  // Korean only by default. The English used to be printed underneath every
  // card on the board, which doubled the text a Korean reader has to skip past
  // — and it was redundant, because `cardTextKo` already leaves any sentence it
  // could not translate in English inline. The original stays one hover away in
  // the `title`, and the full card preview still shows it in full.
  return (
    <span className={className} title={showOriginal ? undefined : text}>
      <GlossaryText text={ko} />
      {showOriginal && (
        <span className="block mt-1 text-[0.9em] text-txtFaint leading-snug">
          <GlossaryText text={text} />
        </span>
      )}
    </span>
  )
}
