import { useEffect, useMemo, useState } from 'react'
import { Card, Deck } from './types/card'
import { AIDifficulty, GameState, PlayerSide } from './types/game'
import { fetchAllCards } from './data/cardStore'
import { loadDecks } from './data/deckStore'
import { buildPresetDecks } from './data/presetDecks'
import { initGame } from './engine'
import DeckBuilder from './components/DeckBuilder'
import GameBoard from './components/GameBoard'
import BattlefieldPicker from './components/BattlefieldPicker'
import DiceRoll from './components/DiceRoll'
import GlossaryModal from './components/GlossaryModal'

type View = 'menu' | 'deck-builder' | 'battlefield-select' | 'dice' | 'game'

export default function App() {
  const [view, setView] = useState<View>('menu')
  const [allCards, setAllCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [userDecks, setUserDecks] = useState<Deck[]>([])
  const [pendingMatch, setPendingMatch] = useState<
    { player: Deck; ai: Deck; battlefieldId?: string } | null
  >(null)
  const [showGlossary, setShowGlossary] = useState(false)

  useEffect(() => {
    fetchAllCards()
      .then((cards) => {
        setAllCards(cards)
        setUserDecks(loadDecks())
        setLoading(false)
      })
      .catch((err) => {
        setLoadError(String(err))
        setLoading(false)
      })
  }, [])

  const presetDecks = useMemo(
    () => (allCards.length > 0 ? buildPresetDecks(allCards) : []),
    [allCards],
  )

  const allDecks = useMemo<Deck[]>(
    () => [...presetDecks, ...userDecks],
    [presetDecks, userDecks],
  )

  useEffect(() => {
    if (!selectedDeckId && allDecks.length > 0) setSelectedDeckId(allDecks[0].id)
  }, [allDecks, selectedDeckId])

  const refreshDecks = () => setUserDecks(loadDecks())

  function startGame() {
    if (allCards.length === 0) return
    const playerDeck = allDecks.find((d) => d.id === selectedDeckId) ?? presetDecks[0]
    const aiDeck =
      presetDecks.find((d) => d.id !== playerDeck.id) ?? presetDecks[0] ?? playerDeck
    if (!playerDeck || !aiDeck) return

    setPendingMatch({ player: playerDeck, ai: aiDeck })
    setView('battlefield-select')
  }

  function beginMatch(playerBattlefieldId: string) {
    if (!pendingMatch) return
    setPendingMatch({ ...pendingMatch, battlefieldId: playerBattlefieldId })
    setView('dice')
  }

  function startWithFirstPlayer(firstPlayer: PlayerSide) {
    if (!pendingMatch) return
    setGameState(
      initGame(pendingMatch.player, pendingMatch.ai, allCards, {
        difficulty: aiDifficulty,
        playerBattlefieldId: pendingMatch.battlefieldId,
        firstPlayer,
      }),
    )
    setPendingMatch(null)
    setView('game')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div>
          <p className="text-accent text-sm animate-pulse uppercase tracking-[0.15em]">
            Loading card data…
          </p>
          <p className="hud-label mt-1">Fetching from riftcodex.com</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="max-w-sm border border-danger p-6">
          <p className="text-danger text-sm mb-2 uppercase tracking-[0.15em]">Failed to load cards</p>
          <p className="text-txtDim text-xs mb-4 break-words">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 border border-line text-txt text-[11px] font-bold uppercase tracking-[0.1em] hover:border-accent hover:text-accent"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (view === 'deck-builder') {
    return (
      <DeckBuilder
        allCards={allCards}
        onBack={() => {
          refreshDecks()
          setView('menu')
        }}
      />
    )
  }

  if (view === 'battlefield-select' && pendingMatch) {
    return (
      <BattlefieldPicker
        deck={pendingMatch.player}
        allCards={allCards}
        onConfirm={beginMatch}
        onBack={() => {
          setPendingMatch(null)
          setView('menu')
        }}
      />
    )
  }

  if (view === 'dice' && pendingMatch) {
    return (
      <DiceRoll
        onDecide={startWithFirstPlayer}
        onBack={() => setView('battlefield-select')}
      />
    )
  }

  if (view === 'game' && gameState) {
    return <GameBoard initialState={gameState} onExit={() => setView('menu')} />
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="mb-8">
          <div className="hud-label mb-1">// riftbound-ai</div>
          <h1 className="text-3xl font-bold text-txt tracking-[0.15em] uppercase">Riftbound</h1>
          <p className="hud-label mt-2">{allCards.length} cards loaded</p>
        </div>

        <div className="bg-panel border border-line p-6 mb-3">
          <h2 className="hud-label text-txt mb-4">Play vs AI</h2>

          <div className="mb-3">
            <label className="hud-label block mb-1">Your Deck</label>
            <select
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-line text-txt text-sm"
            >
              {allDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.preset ? '★ ' : ''}
                  {d.name} ({d.cards.reduce((s, e) => s + e.quantity, 0)} cards)
                </option>
              ))}
            </select>
            <p className="hud-label mt-1 normal-case tracking-normal">
              The AI plays a different preset deck.
            </p>
          </div>

          <div className="mb-4">
            <label className="hud-label block mb-1">AI Difficulty</label>
            <div className="flex gap-2">
              {(['easy', 'medium', 'hard'] as AIDifficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setAiDifficulty(d)}
                  className={`flex-1 py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors ${
                    aiDifficulty === d
                      ? 'bg-accent text-black'
                      : 'border border-line text-txtDim hover:border-accent hover:text-accent'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startGame}
            className="w-full py-3 bg-accent hover:bg-[#ff7038] text-black font-bold text-sm uppercase tracking-[0.15em] transition-colors"
          >
            Start Game ▶
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setView('deck-builder')}
            className="flex-1 py-3 border border-line text-txt text-[11px] font-bold uppercase tracking-[0.1em] hover:border-accent hover:text-accent transition-colors"
          >
            🗂 Deck Builder
          </button>
          <button
            onClick={() => setShowGlossary(true)}
            className="py-3 px-4 border border-line text-txt text-[11px] font-bold uppercase tracking-[0.1em] hover:border-accent hover:text-accent transition-colors"
          >
            📖 Glossary
          </button>
        </div>

        <p className="hud-label mt-6 normal-case tracking-normal">
          Card data from riftcodex.com · For personal use only
        </p>
      </div>
      {showGlossary && <GlossaryModal onClose={() => setShowGlossary(false)} />}
    </div>
  )
}
