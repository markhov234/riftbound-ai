import { Deck } from '../types/card'

const STORAGE_KEY = 'riftbound_decks_v1'

export function loadDecks(): Deck[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveDeck(deck: Deck): void {
  if (deck.preset) return // preset decks are code-defined, never persisted
  const decks = loadDecks()
  const idx = decks.findIndex((d) => d.id === deck.id)
  if (idx >= 0) {
    decks[idx] = deck
  } else {
    decks.push(deck)
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks))
}

export function deleteDeck(id: string): void {
  const decks = loadDecks().filter((d) => d.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(decks))
}

export function newDeck(name: string): Deck {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    legendId: null,
    chosenChampionId: null,
    battlefieldIds: [],
    runes: [],
    cards: [],
    tokens: [],
    createdAt: now,
    updatedAt: now,
  }
}
