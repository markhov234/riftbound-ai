import { Card } from '../types/card'

// Riftbound Standard ban list (mobalytics.gg / riftbound.gg, as of 2026-07-24).
// Banned cards may not be included in a constructed deck.
const BANNED_NAMES: string[] = [
  // cards
  'Called Shot',
  'Draven - Vanquisher',
  'Fight or Flight',
  'Scrapheap',
  'Stealthy Pursuer',
  // battlefields
  "Aspirant's Climb",
  'Obelisk of Power',
  "Reaver's Row",
  "The Arena's Greatest",
  'The Dreaming Tree',
]

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const BANNED = new Set(BANNED_NAMES.map(norm))

export function isBanned(card: Pick<Card, 'name' | 'cleanName'>): boolean {
  return BANNED.has(norm(card.name)) || BANNED.has(norm(card.cleanName))
}
