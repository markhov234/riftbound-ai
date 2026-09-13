import { Card } from '../types/card'

/**
 * Official card errata, applied to the card pool at load time.
 *
 * The card API ships the text as *printed*, so a card whose wording was
 * corrected afterwards arrives here stale. That matters twice over: the ability
 * compiler reads `card.text` to decide what a card does, and the UI shows the
 * same string to the player. A stale line means the app plays the card wrongly
 * *and* explains the wrong thing — and rule 002 (the Golden Rule) says the card
 * text is what's true, so the corrected text has to be the one we hold.
 *
 * Source: Riftbound: Origins Card Errata —
 * https://playriftbound.com/en-us/news/rules-and-releases/riftbound-origins-card-errata/
 */
interface Erratum {
  /** Card name, matched case-insensitively. */
  name: string
  /** The printed sentence to replace. Must match exactly, or the erratum is skipped. */
  from: string
  to: string
  /** Where the correction comes from, for the changelog. */
  source: string
}

const ERRATA: Erratum[] = [
  {
    name: "Zhonya's Hourglass",
    from: 'The next time a friendly unit would die, kill this instead. Recall that unit exhausted.',
    to: "If a friendly unit would die, kill this instead. Heal that unit, exhaust it, and recall it. (Send it to base. This isn't a move.)",
    source: 'Origins card errata',
  },
]

/**
 * Rewrite errata'd card text. Returns the same array when nothing matched, and
 * silently skips an erratum whose `from` no longer appears — that means the API
 * has caught up (or reworded), and forcing our copy over it would be worse than
 * leaving it alone.
 */
export function applyErrata(cards: Card[]): Card[] {
  const byName = new Map<string, Erratum[]>()
  for (const e of ERRATA) {
    const key = e.name.toLowerCase()
    byName.set(key, [...(byName.get(key) ?? []), e])
  }
  return cards.map((card) => {
    const list = byName.get(card.name.toLowerCase())
    if (!list) return card
    let text = card.text
    for (const e of list) if (text.includes(e.from)) text = text.replace(e.from, e.to)
    return text === card.text ? card : { ...card, text }
  })
}

/** Exposed for the test that keeps this list honest against the shipped pool. */
export const __ERRATA = ERRATA
