import { Card } from '../types/card'
import { isBanned } from './bannedCards'

/** A card that may go in the Main Deck: not a token/legend/rune/battlefield, not banned. */
export function isDeckCard(card: Card): boolean {
  if (card.supertype === 'token') return false
  if (card.type === 'legend' || card.type === 'rune' || card.type === 'battlefield') return false
  if (isBanned(card)) return false
  return true
}

export function isToken(card: Pick<Card, 'supertype'>): boolean {
  return card.supertype === 'token'
}
