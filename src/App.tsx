import { useEffect, useMemo, useState } from 'react'
import { Card, Deck } from './types/card'
import { AIDifficulty, GameState, PlayerSide } from './types/game'
import { fetchAllCards, type LoadProgress } from './data/cardStore'
import { loadDecks } from './data/deckStore'
import { buildPresetDecks } from './data/presetDecks'
import { initGame } from './engine'
import DeckBuilder from './components/DeckBuilder'
import GameBoard from './components/GameBoard'
import BattlefieldPicker from './components/BattlefieldPicker'
import DiceRoll from './components/DiceRoll'
import GlossaryModal from './components/GlossaryModal'
import { SegmentBar } from './components/ui'
import { LOCALES, useLocale } from './i18n'

type View = 'menu' | 'deck-builder' | 'battlefield-select' | 'dice' | 'game'

/** EN / 한국어 switch. Sits on the menu and on the in-game exit row. */
export function LanguageToggle({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useLocale()
  return (
    <div className={`flex ${className}`}>
      {LOCALES.map((l) => (
        <button
          key={l.id}
          onClick={() => setLocale(l.id)}
          aria-pressed={locale === l.id}
          className={`px-2 py-1 text-micro font-bold border transition-colors ${
            locale === l.id
              ? 'border-line2 bg-panel2 text-txt'
              : 'border-transparent text-txtFaint hover:text-txt'
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

export default function App() {
  const t = useLocale().t
  const [view, setView] = useState<View>('menu')
  const [allCards, setAllCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [progress, setProgress] = useState<LoadProgress | null>(null)
  const [selectedDeckId, setSelectedDeckId] = useState('')
  const [aiDifficulty, setAiDifficulty] = useState<AIDifficulty>('medium')
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [userDecks, setUserDecks] = useState<Deck[]>([])
  const [pendingMatch, setPendingMatch] = useState<
    { player: Deck; ai: Deck; battlefieldId?: string } | null
  >(null)
  const [showGlossary, setShowGlossary] = useState(false)

  useEffect(() => {
    fetchAllCards(setProgress)
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

  // Page 1 has to come back before we know the page count, and that alone can
  // take 30s. Without something moving, those first seconds look like a hang —
  // which is how this screen got reported in the first place.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!loading) return
    const id = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [loading])

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
        <div className="w-[260px]">
          <p className="text-txt display-face text-base animate-pulse">
            {t('load.cards')}
          </p>
          <p className="hud-label mt-1">
            {t('load.source')}
            {elapsed > 2 && <span className="text-txtFaint tabular-nums"> · {elapsed}s</span>}
          </p>
          {/* The pool is 15 slow pages; without a count this screen is
              indistinguishable from a hang, which is how it got reported. */}
          {progress && (
            <>
              <SegmentBar value={progress.done} max={progress.total} className="mt-3" />
              <p className="hud-label mt-1 normal-case">
                {t('load.progress', { done: progress.done, total: progress.total })}
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="max-w-sm border border-danger p-6">
          <p className="text-danger display-face text-base mb-2">{t('load.failed')}</p>
          <p className="text-txtDim text-xs mb-4 break-words">{loadError}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 border border-line bg-panel text-txt display-face text-sm transition-all duration-200 ease-calm hover:border-accent hover:text-accent"
          >
            {t('common.retry')}
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
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <div className="hud-label mb-2 text-txtFaint">Riot Games · Runeterra</div>
            <h1 className="display-face text-5xl text-txt tracking-[0.02em]">Riftbound</h1>
            <p className="mt-2 text-xs text-txtDim">{t('menu.cardsLoaded', { n: allCards.length })}</p>
          </div>
          <LanguageToggle className="gap-1 shrink-0 mt-1" />
        </div>

        <div className="bg-panel border border-line p-8 mb-4">
          <h2 className="hud-label text-txt mb-6">{t('menu.playVsAi')}</h2>

          <div className="mb-3">
            <label className="hud-label block mb-1">{t('menu.yourDeck')}</label>
            <select
              value={selectedDeckId}
              onChange={(e) => setSelectedDeckId(e.target.value)}
              className="w-full px-3 py-2 bg-bg border border-line text-txt text-sm"
            >
              {allDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.preset ? '★ ' : ''}
                  {d.name}{' '}
                  {t('menu.deckCards', { n: d.cards.reduce((s, e) => s + e.quantity, 0) })}
                </option>
              ))}
            </select>
            <p className="mt-1 text-tiny text-txtDim">{t('menu.aiPlaysPreset')}</p>
            {/* A transcribed tournament list may carry a sideboard. It is shown
                here rather than in the deck builder because that only manages
                your own saved decks — presets never appear in it. Display only:
                sideboarding happens between games of a match and is illegal in
                game one, so a single game vs the AI can never use it. */}
            {(() => {
              const sb = allDecks.find((d) => d.id === selectedDeckId)?.sideboard
              if (!sb?.length) return null
              const n = sb.reduce((s, e) => s + e.quantity, 0)
              return (
                <details className="mt-2 border border-line bg-bg/60 px-2 py-1">
                  <summary className="hud-label text-txtDim cursor-pointer hover:text-txt transition-colors">
                    {t('deck.sideboard', { n })}{' '}
                    <span className="text-txtFaint normal-case tracking-normal">
                      {t('deck.sideboardNote')}
                    </span>
                  </summary>
                  <ul className="mt-1 space-y-0.5">
                    {sb.map((e) => {
                      const c = allCards.find((x) => x.id === e.cardId)
                      return c ? (
                        <li key={e.cardId} className="flex gap-2 text-tiny text-txtDim">
                          <span className="tabular-nums text-txtFaint">×{e.quantity}</span>
                          <span className="truncate">{c.name}</span>
                        </li>
                      ) : null
                    })}
                  </ul>
                </details>
              )
            })()}
          </div>

          <div className="mb-6">
            <label className="hud-label block mb-2">{t('menu.difficulty')}</label>
            <div className="flex gap-2">
              {(['easy', 'medium', 'hard'] as AIDifficulty[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setAiDifficulty(d)}
                  className={`flex-1 py-2 display-face text-sm transition-all ${
                    aiDifficulty === d
                      ? 'bg-panel2 border border-line2 text-accent'
                      : 'border border-transparent text-txtDim hover:border-line hover:bg-panel hover:text-txt'
                  }`}
                >
                  {t(`menu.${d}` as 'menu.easy')}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={startGame}
            className="w-full py-3 bg-accent border border-accentDim shadow-panel hover:shadow-glow display-face text-lg tracking-[0.03em] transition-all"
          >
            {t('common.startGame')}
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setView('deck-builder')}
            className="flex-1 py-3 border border-transparent text-txtDim display-face text-sm transition-all duration-200 ease-calm hover:border-line hover:bg-panel hover:text-txt"
          >
            {t('menu.deckBuilder')}
          </button>
          <button
            onClick={() => setShowGlossary(true)}
            className="py-3 px-4 border border-transparent text-txtDim display-face text-sm transition-all duration-200 ease-calm hover:border-line hover:bg-panel hover:text-txt"
          >
            {t('menu.glossary')}
          </button>
        </div>

        <p className="mt-6 text-tiny text-txtFaint">{t('menu.footer')}</p>
      </div>
      {showGlossary && <GlossaryModal onClose={() => setShowGlossary(false)} />}
    </div>
  )
}
