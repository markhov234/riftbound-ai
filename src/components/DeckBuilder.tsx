import { useState, useEffect } from 'react'
import { Card, CardType, Domain, Deck, DeckEntry } from '../types/card'
import { searchCards } from '../data/cardStore'
import { loadDecks, saveDeck, deleteDeck, newDeck } from '../data/deckStore'
import clsx from 'clsx'
import { CardArt } from './CardArt'
import { isBanned } from '../data/bannedCards'
import { isToken } from '../data/deckLegality'

const DOMAIN_COLORS: Record<Domain, string> = {
  fury:      'bg-fury text-white',
  calm:      'bg-calm text-white',
  order:     'bg-order text-white',
  chaos:     'bg-chaos text-white',
  body:      'bg-body text-white',
  mind:      'bg-mind text-white',
  colorless: 'bg-gray-500 text-white',
}

const TYPE_ICONS: Record<CardType, string> = {
  unit:        '⚔️',
  spell:       '✨',
  gear:        '🛠️',
  battlefield: '🏔️',
  rune:        '🔮',
  token:       '🪙',
  legend:      '👑',
}

const FILTER_TYPES: CardType[] = ['unit', 'spell', 'gear', 'battlefield', 'legend']
const FILTER_DOMAINS: Domain[] = ['fury', 'calm', 'mind', 'body', 'order', 'chaos']

interface CardRowProps {
  card: Card
  count: number
  onAdd: () => void
  onRemove: () => void
}

function CardRow({ card, count, onAdd, onRemove }: CardRowProps) {
  const banned = isBanned(card)
  const token = isToken(card)
  const blocked = banned // tokens are allowed — they go to the separate Token Pile
  const cap = token ? 9 : 3
  return (
    <div
      className={clsx(
        'flex items-center gap-2 p-2 border transition-colors',
        banned ? 'border-danger/40 bg-danger/5' : 'border-line bg-panel hover:border-line2',
      )}
    >
      {/* Art thumbnail */}
      <div className={clsx('w-8 shrink-0 border border-line', blocked && 'grayscale opacity-60')}>
        <CardArt card={card} size="sm" badge={false} />
      </div>
      {/* Cost badge */}
      <span className="w-5 h-5 bg-accent text-black text-xs font-bold flex items-center justify-center shrink-0">
        {card.energy}
      </span>
      {/* Type icon */}
      <span className="text-sm">{TYPE_ICONS[card.type]}</span>
      {/* Name */}
      <span className="flex-1 text-xs text-txt truncate uppercase tracking-wide">
        {card.name}
        {banned && (
          <span className="ml-2 hud-label text-danger border border-danger px-1 align-middle">
            BANNED
          </span>
        )}
        {!banned && token && (
          <span className="ml-2 hud-label text-accent border border-accentDim px-1 align-middle">
            TOKEN PILE
          </span>
        )}
      </span>
      {/* Domains */}
      <div className="flex gap-1 shrink-0">
        {card.domains.map((d) => (
          <span key={d} className={clsx('text-[10px] px-1', DOMAIN_COLORS[d])}>
            {d.slice(0, 3).toUpperCase()}
          </span>
        ))}
      </div>
      {/* Might */}
      {card.might > 0 && <span className="text-xs text-txtDim shrink-0 tabular-nums">{card.might}⚔</span>}
      {/* Add/remove */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onRemove}
          disabled={count === 0}
          className="w-6 h-6 border border-line hover:border-accent disabled:opacity-25 text-txt text-sm font-bold"
        >−</button>
        <span className="w-4 text-center text-sm text-txt tabular-nums">{count || ''}</span>
        <button
          onClick={onAdd}
          disabled={count >= cap || blocked}
          title={
            banned
              ? 'Banned — cannot be added to a deck'
              : token
                ? 'Token — goes to the Token Pile, not the 40-card deck'
                : undefined
          }
          className="w-6 h-6 border border-line hover:border-accent disabled:opacity-25 text-txt text-sm font-bold"
        >+</button>
      </div>
    </div>
  )
}

interface Props {
  allCards: Card[]
  onBack: () => void
}

export default function DeckBuilder({ allCards, onBack }: Props) {
  const [decks, setDecks] = useState<Deck[]>([])
  const [activeDeck, setActiveDeck] = useState<Deck | null>(null)

  // Search / filter state
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<CardType | ''>('')
  const [domainFilter, setDomainFilter] = useState<Domain | ''>('')

  // Load persisted decks on mount
  useEffect(() => {
    const loaded = loadDecks()
    setDecks(loaded)
    if (loaded.length > 0) setActiveDeck(loaded[0])
  }, [])

  const filteredCards = searchCards(
    allCards,
    query,
    {
      type:   typeFilter   || undefined,
      domain: domainFilter || undefined,
    }
  ).slice(0, 200) // cap for performance

  // Deck helpers
  const getCount = (card: Card): number => {
    if (!activeDeck) return 0
    const list = isToken(card) ? activeDeck.tokens ?? [] : activeDeck.cards
    return list.find((e) => e.cardId === card.id)?.quantity ?? 0
  }

  const totalCards = activeDeck?.cards.reduce((s, e) => s + e.quantity, 0) ?? 0
  const totalTokens = activeDeck?.tokens?.reduce((s, e) => s + e.quantity, 0) ?? 0

  const updateDeck = (updated: Deck) => {
    setActiveDeck(updated)
    saveDeck(updated)
    setDecks((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
  }

  const addCard = (card: Card) => {
    if (!activeDeck || isBanned(card)) return
    const key = isToken(card) ? 'tokens' : 'cards'
    const cap = isToken(card) ? 9 : 3
    const list: DeckEntry[] = (activeDeck[key] as DeckEntry[] | undefined) ?? []
    const existing = list.find((e) => e.cardId === card.id)
    const entries: DeckEntry[] = existing
      ? list.map((e) =>
          e.cardId === card.id ? { ...e, quantity: Math.min(e.quantity + 1, cap) } : e,
        )
      : [...list, { cardId: card.id, quantity: 1 }]
    updateDeck({ ...activeDeck, [key]: entries, updatedAt: Date.now() })
  }

  const removeCard = (card: Card) => {
    if (!activeDeck) return
    const key = isToken(card) ? 'tokens' : 'cards'
    const list: DeckEntry[] = (activeDeck[key] as DeckEntry[] | undefined) ?? []
    const entries = list
      .map((e) => (e.cardId === card.id ? { ...e, quantity: e.quantity - 1 } : e))
      .filter((e) => e.quantity > 0)
    updateDeck({ ...activeDeck, [key]: entries, updatedAt: Date.now() })
  }

  const createDeck = () => {
    const name = prompt('Deck name?')
    if (!name) return
    const d = newDeck(name)
    saveDeck(d)
    setDecks((prev) => [...prev, d])
    setActiveDeck(d)
  }

  const removeDeck = (id: string) => {
    if (!confirm('Delete this deck?')) return
    deleteDeck(id)
    const remaining = decks.filter((d) => d.id !== id)
    setDecks(remaining)
    setActiveDeck(remaining[0] ?? null)
  }

  return (
    <div className="min-h-screen bg-bg text-txt flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-4 px-6 py-3 bg-panel border-b border-line">
        <button onClick={onBack} className="hud-label hover:text-accent">← Back</button>
        <h1 className="text-sm font-bold uppercase tracking-[0.15em]">Deck Builder</h1>
        <div className="flex-1" />
        {/* Deck tabs */}
        <div className="flex items-center gap-2 overflow-x-auto">
          {decks.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveDeck(d)}
              className={clsx(
                'px-3 py-1 text-[11px] uppercase tracking-wide whitespace-nowrap border',
                activeDeck?.id === d.id ? 'bg-accent text-black border-accent' : 'border-line text-txtDim hover:border-accent'
              )}
            >
              {d.name}
            </button>
          ))}
          <button onClick={createDeck} className="px-3 py-1 border border-line text-[11px] uppercase tracking-wide text-txt hover:border-accent hover:text-accent">
            + New
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: card browser */}
        <div className="flex-1 flex flex-col overflow-hidden border-r border-line">
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2 bg-panel border-b border-line flex-wrap">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cards…"
              className="flex-1 min-w-[140px] px-3 py-1.5 bg-bg border border-line text-sm text-txt placeholder-txtFaint"
            />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as CardType | '')}
              className="px-2 py-1.5 bg-bg border border-line text-sm text-txt"
            >
              <option value="">All types</option>
              {FILTER_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_ICONS[t]} {t}</option>
              ))}
            </select>
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value as Domain | '')}
              className="px-2 py-1.5 bg-bg border border-line text-sm text-txt"
            >
              <option value="">All domains</option>
              {FILTER_DOMAINS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <span className="hud-label">{filteredCards.length} cards</span>
          </div>

          {/* Card list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredCards.map((card) => (
              <CardRow
                key={card.id}
                card={card}
                count={getCount(card)}
                onAdd={() => addCard(card)}
                onRemove={() => removeCard(card)}
              />
            ))}
            {filteredCards.length === 0 && (
              <p className="text-center text-txtFaint mt-8">No cards found.</p>
            )}
          </div>
        </div>

        {/* Right: deck list */}
        <div className="w-72 flex flex-col bg-panel overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-line">
            <h2 className="font-bold text-xs uppercase tracking-wide truncate">
              {activeDeck ? activeDeck.name : 'No deck selected'}
            </h2>
            {activeDeck && (
              <div className="flex items-center gap-2">
                <span className={clsx('text-xs tabular-nums', totalCards >= 40 ? 'text-accent' : 'text-txtDim')}>
                  {totalCards}/40
                </span>
                <button
                  onClick={() => activeDeck && removeDeck(activeDeck.id)}
                  className="hud-label text-danger hover:text-danger"
                >del</button>
              </div>
            )}
          </div>

          {!activeDeck && (
            <p className="text-center text-txtFaint text-sm mt-8">Create a deck to start.</p>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {activeDeck?.cards.map((entry) => {
              const card = allCards.find((c) => c.id === entry.cardId)
              if (!card) return null
              return (
                <div key={entry.cardId} className="flex items-center gap-2 text-xs">
                  <span className="w-5 h-5 bg-accent text-black text-xs font-bold flex items-center justify-center shrink-0">
                    {card.energy}
                  </span>
                  <span className="flex-1 truncate text-txt uppercase tracking-wide">{card.name}</span>
                  <span className="text-txtDim tabular-nums">×{entry.quantity}</span>
                  <button
                    onClick={() => removeCard(card)}
                    className="text-danger hover:text-danger text-xs leading-none"
                  >✕</button>
                </div>
              )
            })}

            {(activeDeck?.tokens?.length ?? 0) > 0 && (
              <div className="pt-2 mt-2 border-t border-line">
                <div className="hud-label text-accent mb-1">
                  Token Pile · {totalTokens} <span className="text-txtFaint">(not part of the 40)</span>
                </div>
                {activeDeck!.tokens!.map((entry) => {
                  const card = allCards.find((c) => c.id === entry.cardId)
                  if (!card) return null
                  return (
                    <div key={entry.cardId} className="flex items-center gap-2 text-xs">
                      <span className="text-sm">🪙</span>
                      <span className="flex-1 truncate text-txtDim uppercase tracking-wide">{card.name}</span>
                      <span className="text-txtDim tabular-nums">×{entry.quantity}</span>
                      <button
                        onClick={() => removeCard(card)}
                        className="text-danger hover:text-danger text-xs leading-none"
                      >✕</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {activeDeck && totalCards < 40 && (
            <div className="px-4 py-2 border-t border-line">
              <p className="hud-label text-accent normal-case tracking-normal">Need {40 - totalCards} more cards</p>
            </div>
          )}
          {activeDeck && totalCards >= 40 && (
            <div className="px-4 py-2 border-t border-line">
              <p className="hud-label text-accent normal-case tracking-normal">✓ Deck is ready to play</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
