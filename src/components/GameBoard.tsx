import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Card } from '../types/card'
import {
  DamageAssignment,
  GameAction,
  GameState,
  GearInPlay,
  PendingChoice,
  UnitInPlay,
} from '../types/game'
import {
  autoAssignmentList,
  basePrintingId,
  canAfford,
  canPlaceUnitAt,
  canPlay,
  controllerOf,
  damageOrderRank,
  dispatch,
  effHp,
  flowCost,
  keywordValue,
  legalGearTargets,
  legalStackTargets,
  legalUnitTargets,
  legendAbilities,
  mightBonus,
  runAITurn,
  scriptFor,
  spellTiming,
  unitPlayOptions,
  unitsAt,
} from '../engine'
import { TargetSpec } from '../engine'
import { CardArt, CenterPreview, PinnedCard, DOMAIN_HEX } from './CardArt'
import GlossaryText from './GlossaryText'
import { Btn, Chip, LogLine, Modal } from './ui'

interface Props {
  initialState: GameState
  onExit: () => void
}

interface Targeting {
  card: Card
  isGear: boolean
  specs: TargetSpec[]
  pickedUnits: string[]
  pickedStack?: string
  /** The caster armed the spell's optional additional cost. */
  paidAdditional?: boolean
  /** Targeting a Flow-cast from the trash. */
  flow?: boolean
  /** Set when we're targeting for an activated ability (e.g. Equip), not a cast. */
  activate?: { instanceId: string; abilityIndex: number }
}

export default function GameBoard({ initialState, onExit }: Props) {
  const [state, setState] = useState<GameState>(initialState)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const [selectedGear, setSelectedGear] = useState<string | null>(null)
  const [targeting, setTargeting] = useState<Targeting | null>(null)
  const [acceleratePaid, setAcceleratePaid] = useState(false)
  const [choicePicks, setChoicePicks] = useState<string[]>([])
  const [hovered, setHovered] = useState<Card | null>(null)
  const [altHeld, setAltHeld] = useState(false)
  const [pinned, setPinned] = useState<Card | null>(null)
  const [pilesSide, setPilesSide] = useState<'player' | 'ai' | null>(null)
  const [logExpanded, setLogExpanded] = useState(false)
  const [mulliganPicks, setMulliganPicks] = useState<number[]>([])
  const [aiThinking, setAiThinking] = useState(false)
  const [aiRecap, setAiRecap] = useState<string[]>([])
  const aiScheduled = useRef(false)
  const aiMark = useRef<number | null>(null)

  const player = state.player
  const ai = state.ai
  const pendingChoice = state.pendingChoices[0] ?? null
  const myChoice = pendingChoice?.controller === 'player' ? pendingChoice : null
  const cleanTurn =
    state.activePlayer === 'player' &&
    state.phase === 'action' &&
    state.stack.length === 0 &&
    !state.pendingShowdown &&
    !pendingChoice
  const myPriority =
    state.priority === 'player' && state.phase === 'action' && !pendingChoice
  const responding = myPriority && (state.stack.length > 0 || !!state.pendingShowdown)
  const assigningDamage = state.pendingDamage?.assigningSide === 'player'

  // My legend's activatable powers (keep original index for ACTIVATE_ABILITY),
  // hiding guarded ones (e.g. Empower once Empowered, or an "exhaust me" power
  // once the legend is exhausted).
  const myLegendAbils = legendAbilities(player.legend)
    .map((ab, i) => ({ ab, i }))
    .filter(
      ({ ab }) =>
        (!ab.when || ab.when(state, undefined, 'player')) &&
        !(ab.cost.exhaustSelf && player.legendExhausted),
    )
  const myChampionInHand = player.hand.find(
    (c) => basePrintingId(c) === basePrintingId(player.chosenChampion),
  )
  const myChampionCastable =
    myPriority &&
    !!myChampionInHand &&
    !player.championPlayed &&
    canPlay(state, 'player', myChampionInHand).ok
  const topTrash = player.trash[player.trash.length - 1] ?? null

  const turnChip = aiThinking
    ? 'AI is thinking…'
    : assigningDamage
      ? 'Assign combat damage'
      : cleanTurn
        ? 'Your main phase'
        : responding
          ? 'Respond only'
          : state.priority === 'ai' || state.activePlayer === 'ai'
            ? "AI's turn"
            : 'Waiting…'

  // Drive the AI when it has priority OR a choice to resolve.
  useEffect(() => {
    const needsAI =
      !state.winner &&
      (state.pendingChoices[0]?.controller === 'ai' ||
        (state.phase === 'mulligan' && !state.ai.mulliganDone && state.player.mulliganDone) ||
        (state.phase !== 'mulligan' && state.priority === 'ai' && !state.pendingChoices[0]))
    if (!needsAI || aiScheduled.current) return
    aiScheduled.current = true
    if (aiMark.current == null) aiMark.current = state.log.length // remember what to diff
    setAiRecap([])
    setAiThinking(true)
    const t = setTimeout(() => {
      setState((s) => runAITurn(s))
      setAiThinking(false)
      aiScheduled.current = false
    }, 550)
    return () => {
      clearTimeout(t)
      aiScheduled.current = false
      setAiThinking(false)
    }
  }, [state])

  // After the AI acts, surface a plain-language recap of what it did — only the
  // lines from the AI's own turn (stop once the player's turn begins), minus
  // pure bookkeeping.
  useEffect(() => {
    if (aiThinking || aiScheduled.current || aiMark.current == null) return
    const from = aiMark.current
    aiMark.current = null
    const since = state.log.slice(from)
    const end = since.findIndex((l) => /—\s*player's turn\s*—/i.test(l))
    const lines = (end >= 0 ? since.slice(0, end) : since).filter(
      (l) =>
        !/channels? (a |an extra )?rune|draws? for the turn|—\s*ai's turn\s*—|\bpasses\.\s*$|keeps their hand|goes on the stack|resolves\.\s*$|ability triggers\.\s*$|on the play\b|banked energy/i.test(
          l,
        ),
    )
    if (lines.length > 0) setAiRecap(lines.slice(-8))
  }, [aiThinking, state.log])

  const act = useCallback((next: GameState) => {
    setState(next)
    setSelectedCard(null)
    setSelectedUnit(null)
    setSelectedGear(null)
    setTargeting(null)
    setAcceleratePaid(false)
    setChoicePicks([])
    setPinned(null)
    setAiRecap([])
  }, [])

  // Esc clears any selection / targeting / the pinned inspector.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setSelectedCard(null)
      setSelectedUnit(null)
      setSelectedGear(null)
      setTargeting(null)
      setAcceleratePaid(false)
      setPinned(null)
      setPilesSide(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Alt (held) + hover a card → pin it for inspection; it persists after release.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAltHeld(false)
    }
    const blur = () => setAltHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
  useEffect(() => {
    if (altHeld && hovered) setPinned(hovered)
  }, [altHeld, hovered])
  const send = useCallback((a: GameAction) => act(dispatch(state, a, 'player')), [state, act])

  const legalTargetIds = useMemo(() => {
    if (!targeting) return new Set<string>()
    const ids = new Set<string>()
    for (const spec of targeting.specs) {
      if (spec.kind === 'stackSpell' || spec.kind === 'player' || spec.kind === 'self') continue
      if (spec.kind === 'gear' || spec.kind === 'friendlyGear' || spec.kind === 'otherGear') {
        for (const g of legalGearTargets(state, 'player', spec)) ids.add(g.instanceId)
      } else {
        for (const u of legalUnitTargets(state, 'player', spec)) ids.add(u.instanceId)
      }
    }
    return ids
  }, [targeting, state])

  const legalStackIds = useMemo(() => {
    if (!targeting) return new Set<string>()
    const ids = new Set<string>()
    for (const spec of targeting.specs) {
      if (spec.kind !== 'stackSpell') continue
      for (const it of legalStackTargets(state, spec)) ids.add(it.id)
    }
    return ids
  }, [targeting, state])

  const choiceUnitIds = useMemo(
    () => (myChoice?.kind === 'unit' ? new Set(myChoice.legalIds) : new Set<string>()),
    [myChoice],
  )

  const selectedUnitObj = useMemo(
    () =>
      selectedUnit
        ? [player.base, ...state.battlefields.map((b) => b.units)]
            .flat()
            .find((u) => u.instanceId === selectedUnit)
        : undefined,
    [selectedUnit, player.base, state.battlefields],
  )

  const selectedGearObj = useMemo(
    () => (selectedGear ? player.gear.find((g) => g.instanceId === selectedGear) : undefined),
    [selectedGear, player.gear],
  )

  const equippedIds = useMemo(
    () =>
      new Set(
        [...player.gear, ...ai.gear].filter((g) => g.attachedTo).map((g) => g.attachedTo as string),
      ),
    [player.gear, ai.gear],
  )

  const focusCard: Card | null =
    targeting?.card ??
    selectedCard ??
    selectedUnitObj?.card ??
    selectedGearObj?.card ??
    hovered ??
    null

  const focusStatuses = useMemo(
    () =>
      selectedUnitObj
        ? unitStatuses(selectedUnitObj)
        : selectedGearObj
          ? gearStatuses(selectedGearObj)
          : [],
    [selectedUnitObj, selectedGearObj],
  )

  // ── Mulligan ────────────────────────────────────────────────────────────
  if (state.phase === 'mulligan' && !player.mulliganDone) {
    const toggle = (i: number) =>
      setMulliganPicks((p) =>
        p.includes(i) ? p.filter((x) => x !== i) : p.length < 2 ? [...p, i] : p,
      )
    return (
      <div className="min-h-screen bg-board text-white flex flex-col items-center justify-center p-6">
        <h2 className="text-2xl font-bold mb-2">Opening Hand</h2>
        <p className="text-gray-400 text-sm mb-6">
          Select up to 2 cards to shuffle back, or keep your hand.
        </p>
        <div className="flex flex-wrap gap-3 justify-center max-w-3xl mb-8">
          {player.hand.map((c, i) => (
            <button
              key={`${c.id}-${i}`}
              onClick={() => toggle(i)}
              className={clsx(
                'w-32 rounded-lg transition-all',
                mulliganPicks.includes(i) && 'ring-2 ring-red-400 -translate-y-1',
              )}
            >
              <CardArt card={c} />
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() =>
              act(dispatch(state, { type: 'MULLIGAN', cardIndices: mulliganPicks }, 'player'))
            }
            disabled={mulliganPicks.length === 0}
            className="px-5 py-2 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 font-semibold"
          >
            Mulligan {mulliganPicks.length > 0 ? `(${mulliganPicks.length})` : ''}
          </button>
          <button
            onClick={() => act(dispatch(state, { type: 'KEEP_HAND' }, 'player'))}
            className="px-5 py-2 rounded bg-blue-700 hover:bg-blue-600 font-semibold"
          >
            Keep Hand
          </button>
        </div>
      </div>
    )
  }

  // ── Targeting helpers ───────────────────────────────────────────────────
  function requiredUnitPicks(t: Targeting): number {
    return t.specs
      .filter(
        (s) => s.kind !== 'stackSpell' && s.kind !== 'player' && s.kind !== 'self' && !s.optional,
      )
      .reduce((n, s) => n + (s.count ?? 1), 0)
  }
  function needsStackPick(t: Targeting): boolean {
    return t.specs.some((s) => s.kind === 'stackSpell' && !s.optional)
  }
  function submitTargeting(t: Targeting) {
    if (t.activate) {
      send({
        type: 'ACTIVATE_ABILITY',
        instanceId: t.activate.instanceId,
        abilityIndex: t.activate.abilityIndex,
        targetInstanceIds: t.pickedUnits,
      })
      return
    }
    if (t.flow) {
      send({
        type: 'CAST_FLOW',
        card: t.card,
        targetInstanceIds: t.pickedUnits,
        targetStackId: t.pickedStack,
      })
      return
    }
    send(
      t.card.type === 'gear'
        ? { type: 'PLAY_GEAR', card: t.card, targetInstanceIds: t.pickedUnits }
        : {
            type: 'PLAY_SPELL',
            card: t.card,
            targetInstanceIds: t.pickedUnits,
            targetStackId: t.pickedStack,
            paidAdditional: t.paidAdditional,
          },
    )
  }
  function tryAutoSubmit(t: Targeting) {
    if (t.pickedUnits.length >= requiredUnitPicks(t) && (!needsStackPick(t) || !!t.pickedStack)) {
      submitTargeting(t)
    } else setTargeting(t)
  }
  function beginPlay(card: Card) {
    if (!myPriority) return
    setSelectedUnit(null)
    setSelectedGear(null)
    setTargeting(null)
    setAcceleratePaid(false)
    // Units and spells alike: first click just selects (shows the preview).
    // Units are then placed by clicking Base/Battlefield; spells/gear cast via
    // the "Cast" button in the action bar.
    setSelectedCard(selectedCard === card ? null : card)
  }
  function pickTargetUnit(instanceId: string) {
    if (!targeting || !legalTargetIds.has(instanceId)) return
    const picked = targeting.pickedUnits.includes(instanceId)
      ? targeting.pickedUnits.filter((x) => x !== instanceId)
      : [...targeting.pickedUnits, instanceId]
    tryAutoSubmit({ ...targeting, pickedUnits: picked })
  }
  function pickTargetStack(stackId: string) {
    if (!targeting || !legalStackIds.has(stackId)) return
    tryAutoSubmit({ ...targeting, pickedStack: stackId })
  }

  // ── Choice helpers ─────────────────────────────────────────────────────
  function toggleChoicePick(id: string) {
    if (!myChoice) return
    setChoicePicks((p) => {
      const next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id]
      const capped = next.slice(-myChoice.max)
      if (capped.length >= myChoice.min && capped.length === myChoice.max) {
        send({ type: 'RESOLVE_CHOICE', pickedIds: capped })
        return []
      }
      return capped
    })
  }
  function submitChoice() {
    if (!myChoice) return
    send({ type: 'RESOLVE_CHOICE', pickedIds: choicePicks })
  }

  // ── Board interaction ──────────────────────────────────────────────────
  const playOpts = selectedCard && myPriority ? unitPlayOptions(selectedCard) : []
  const accelerateOpt = playOpts.find((o) => o.id === 'accelerate')
  const additionalOpt = playOpts.find((o) => o.id === 'additional')
  const activeOpt = accelerateOpt ?? additionalOpt
  const freeRunes = player.runes.channeled.length - player.runes.spent.length
  const canAffordExtra =
    !!activeOpt &&
    freeRunes >= activeOpt.extraRunes.length &&
    player.runes.energy >=
      (selectedCard?.energy ?? 0) + activeOpt.extraEnergy + activeOpt.extraRunes.length

  // A selected spell/gear is armed but not cast until the Cast button.
  const castArmed =
    !!selectedCard && selectedCard.type !== 'unit' && myPriority && !targeting

  function castSelected() {
    if (!selectedCard) return
    const specs = scriptFor(selectedCard)?.play?.targets ?? []
    const t: Targeting = {
      card: selectedCard,
      isGear: selectedCard.type === 'gear',
      specs,
      pickedUnits: [],
      paidAdditional: !!additionalOpt && acceleratePaid,
    }
    if (specs.length === 0) submitTargeting(t)
    else setTargeting(t)
  }

  const canDropCardAt = (index: number | 'base') =>
    !!selectedCard &&
    selectedCard.type === 'unit' &&
    myPriority &&
    (index === 'base' ||
      canPlaceUnitAt(state, 'player', selectedCard, { kind: 'battlefield', index }).ok)

  function playSelectedUnit(to: { kind: 'base' } | { kind: 'battlefield'; index: number }) {
    if (!selectedCard) return
    send({
      type: 'PLAY_UNIT',
      card: selectedCard,
      to,
      paidAccelerate: !!accelerateOpt && acceleratePaid,
      paidAdditional: !!additionalOpt && acceleratePaid,
    })
  }
  function onBattlefieldClick(index: number) {
    if (myChoice?.kind === 'unit') return
    if (selectedCard && canDropCardAt(index)) playSelectedUnit({ kind: 'battlefield', index })
    else if (selectedUnit)
      send({ type: 'MOVE_UNIT', instanceId: selectedUnit, to: { kind: 'battlefield', index } })
  }
  function onBaseClick() {
    // Only units go to a base — a selected spell/gear is cast from the action bar.
    if (selectedCard && canDropCardAt('base')) playSelectedUnit({ kind: 'base' })
    else if (selectedUnit)
      send({ type: 'MOVE_UNIT', instanceId: selectedUnit, to: { kind: 'base' } })
  }
  function onUnitClick(u: UnitInPlay) {
    if (myChoice?.kind === 'unit') {
      if (choiceUnitIds.has(u.instanceId)) toggleChoicePick(u.instanceId)
      return
    }
    if (targeting) {
      pickTargetUnit(u.instanceId)
      return
    }
    if (!myPriority || u.owner !== 'player') return
    setSelectedCard(null)
    setSelectedGear(null)
    setSelectedUnit(selectedUnit === u.instanceId ? null : u.instanceId)
  }
  function onGearClick(g: { instanceId: string }) {
    if (targeting) {
      pickTargetUnit(g.instanceId) // gear targets reuse the unit-pick path
      return
    }
    if (!myPriority) return
    setSelectedCard(null)
    setSelectedUnit(null)
    setSelectedGear(selectedGear === g.instanceId ? null : g.instanceId)
  }

  // Activated abilities on the selected unit OR gear, keeping the original index
  // and dropping any whose guard fails now (Empower once it's Empowered, etc.).
  const abilitySource = selectedUnitObj ?? selectedGearObj
  const selectedAbilities = (
    abilitySource ? (scriptFor(abilitySource.card)?.activated ?? []) : []
  )
    .map((ab, i) => ({ ab, i }))
    .filter(({ ab }) => !ab.when || ab.when(state, abilitySource, 'player'))
  const highlightIds = targeting ? legalTargetIds : choiceUnitIds

  const iContestSomewhere = state.battlefields.some(
    (bf) => controllerOf(bf) === 'contested' && unitsAt(bf, 'player').length > 0,
  )
  const hint = myChoice
    ? myChoice.label
    : targeting
      ? `Choose a target for ${targeting.card.name}`
      : selectedCard
        ? selectedCard.type === 'unit'
          ? `Playing ${selectedCard.name} — click your Base to place it`
          : `${selectedCard.name} selected — press Cast to play it`
        : selectedUnit
          ? 'Moving a unit — click your Base, or a Battlefield to contest it'
          : responding
            ? state.pendingShowdown
              ? 'Showdown declared — play a Reaction or Pass'
              : 'Respond to the stack, or Pass'
            : cleanTurn && iContestSomewhere
              ? 'You have units at a contested battlefield — Declare Showdown to fight (else it resolves at end of turn)'
              : pinned
                ? 'Card pinned — hover its keywords · Esc to close'
                : 'Tip: hold Alt and hover a card to inspect its keywords'

  return (
    <div className="board-root h-screen bg-board text-white flex flex-col select-none text-sm overflow-hidden">
      {/* Big preview for whatever is in focus — selected/targeting wins, else hover. */}
      {!pinned && <CenterPreview card={focusCard} unit={selectedUnitObj} statuses={focusStatuses} />}

      {/* Recap of what the AI just did */}
      {aiRecap.length > 0 && !aiThinking && (
        <div className="fixed top-[70px] left-1/2 -translate-x-1/2 z-40 w-[440px] max-w-[62vw] bg-panel border border-danger/70 shadow-2xl">
          <div className="flex items-center justify-between px-3 py-1 border-b border-danger/50 bg-danger/10">
            <span className="hud-label text-danger">◀ AI just did</span>
            <button
              onClick={() => setAiRecap([])}
              className="text-txtDim hover:text-accent text-sm leading-none"
            >
              ✕
            </button>
          </div>
          <ul className="px-3 py-1.5 space-y-0.5 max-h-40 overflow-y-auto">
            {aiRecap.map((l, i) => (
              <li key={i} className="text-[12px] text-txt leading-snug">
                • {l.replace(/^ai\s+/i, '')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pinned && (
        <PinnedCard
          card={pinned}
          unit={pinned === selectedUnitObj?.card ? selectedUnitObj : undefined}
          statuses={
            pinned === selectedUnitObj?.card || pinned === selectedGearObj?.card
              ? focusStatuses
              : undefined
          }
          onClose={() => setPinned(null)}
        />
      )}

      {assigningDamage && (
        <DamageModal state={state} onAssign={(a) => send({ type: 'ASSIGN_DAMAGE', assignments: a })} />
      )}

      {pilesSide && (
        <PilesModal
          side={pilesSide}
          trash={state[pilesSide].trash}
          banished={state[pilesSide].banished}
          onHover={setHovered}
          onClose={() => setPilesSide(null)}
        />
      )}

      {state.winner && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
          <div className="bg-panel border border-accent p-10 text-center">
            <h2 className="text-2xl font-bold mb-2 uppercase tracking-[0.2em] text-accent">
              {state.winner === 'player' ? 'Victory' : 'Defeat'}
            </h2>
            <p className="hud-label normal-case tracking-normal mb-6">
              Final score {player.points}–{ai.points}
            </p>
            <button
              onClick={onExit}
              className="px-6 py-2 border border-line text-txt text-[11px] font-bold uppercase tracking-[0.12em] hover:border-accent hover:text-accent"
            >
              Main Menu
            </button>
          </div>
        </div>
      )}

      {/* Pick modal — card zones, or a plain keyword list */}
      {myChoice && myChoice.kind !== 'unit' && (
        <ChoiceModal
          choice={myChoice}
          textOptions={myChoice.kind === 'keyword' ? myChoice.legalIds : undefined}
          zoneCards={(myChoice.kind === 'trashCard'
            ? player.trash
            : myChoice.kind === 'deckTop'
              ? player.mainDeck
              : player.hand
          ).filter((c) => myChoice.legalIds.includes(c.id))}
          picks={choicePicks}
          onToggle={toggleChoicePick}
          onSubmit={submitChoice}
        />
      )}

      {/* HUD row */}
      <div className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-line shrink-0">
        <button onClick={onExit} className="hud-label hover:text-accent">
          ← EXIT
        </button>
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.12em] text-txt truncate">
            {player.legend.name}
          </div>
          <div className="hud-label normal-case tracking-normal">
            DECK: {player.legend.name.split(/[ ,–-]/)[0].toUpperCase()} // {player.mainDeck.length + player.hand.length} CARDS
          </div>
        </div>
        <span
          className={clsx(
            'hud-label',
            aiThinking ? 'text-txtDim' : state.activePlayer === 'player' ? 'text-accent' : 'text-txtDim',
          )}
        >
          {aiThinking ? 'AI…' : turnChip} · R{state.round}
        </span>
        <div className="flex-1" />
        <Chip label="Score" value={`${player.points} / 8`} tone="accent" />
        <Chip label="Energy" value={`${player.runes.energy} / ${player.runes.channeled.length}`} />
      </div>

      {/* Middle: score rail | centre */}
      <div className="flex flex-1 min-h-0">
        {/* Left score rail — 8 point pips per player, filling bottom-up */}
        <ScoreStrip aiPoints={ai.points} myPoints={player.points} />

        {/* Centre: battlefields + cast lane + base */}
        <div className="flex-1 min-w-0 flex flex-col">
          {/* AI mini-playmat — legend/champion, hand/deck counts, what it has played */}
          <div className="px-4 py-1.5 border-b border-line bg-panel min-h-[56px] flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <div
                className={clsx('w-[var(--rune-w)] border', ai.legendEmpowered ? 'border-accent' : 'border-line')}
                onMouseEnter={() => setHovered(ai.legend)}
                onMouseLeave={() => setHovered((h) => (h === ai.legend ? null : h))}
                title={`AI Legend — ${ai.legend.name}`}
              >
                <CardArt card={ai.legend} size="sm" badge={false} />
              </div>
              <div
                className={clsx('w-[var(--rune-w)] border border-line', ai.championPlayed && 'opacity-40')}
                onMouseEnter={() => setHovered(ai.chosenChampion)}
                onMouseLeave={() => setHovered((h) => (h === ai.chosenChampion ? null : h))}
                title={`AI Champion — ${ai.chosenChampion.name}${ai.championPlayed ? ' (in play)' : ''}`}
              >
                <CardArt card={ai.chosenChampion} size="sm" preview={false} badge={false} />
              </div>
            </div>
            <div className="flex flex-col gap-0.5 shrink-0 tabular-nums text-[10px] text-txtDim">
              <span className="hud-label text-danger/80">AI</span>
              <button
                onClick={() => setPilesSide('ai')}
                className="hover:text-accent text-left"
                title="View AI trash & banished"
              >
                ✋ {ai.hand.length} · 📚 {ai.mainDeck.length} · 🗑 {ai.trash.length}
                {ai.banished.length > 0 && ` · ⚰ ${ai.banished.length}`}
              </button>
            </div>
            <div className="w-px self-stretch bg-line mx-1 shrink-0" />
            <span className="hud-label shrink-0">Plays</span>
            <div className="flex gap-1.5 flex-wrap flex-1 min-w-0">
              {ai.base.map((u) => (
                <BoardUnit key={u.instanceId} unit={u} side="ai" onHover={setHovered} />
              ))}
              {ai.base.length === 0 && <span className="text-txtFaint text-xs">— nothing at base —</span>}
            </div>
          </div>

          <div className="flex-1 flex items-stretch justify-center gap-[clamp(0.75rem,2.2vw,3rem)] px-[clamp(1rem,3vw,4rem)] min-h-0 py-2">
            {state.battlefields.map((bf) => {
              const control = controllerOf(bf)
              const dropCard = canDropCardAt(bf.index)
              const dropMove = !!selectedUnit && myPriority
              const droppable = (dropCard || dropMove) && !myChoice
              return (
                <div
                  key={bf.index}
                  className={clsx(
                    'flex-1 max-w-[46rem] h-full border flex flex-col overflow-hidden bg-panel',
                    droppable
                      ? 'border-accent cursor-pointer'
                      : control === 'contested'
                        ? 'border-accentDim'
                        : 'border-line',
                  )}
                  onClick={() => droppable && onBattlefieldClick(bf.index)}
                >
                  {/* Enemy zone — on top, units press down toward the battlefield */}
                  <div className="flex-1 min-h-[60px] flex flex-col justify-end bg-black/25">
                    <span className="hud-label text-danger/80 px-1.5 pt-1">Enemy</span>
                    <UnitZone
                      units={unitsAt(bf, 'ai')}
                      side="ai"
                      onUnitClick={onUnitClick}
                      highlightIds={highlightIds}
                      equippedIds={equippedIds}
                      onHover={setHovered}
                    />
                  </div>

                  {/* Battlefield visuals — the card the enemy attacks across */}
                  <div className="relative shrink-0 border-y border-line">
                    {bf.card?.imageUrl && (
                      <img
                        src={bf.card.imageUrl}
                        alt={bf.name}
                        className="w-full h-[var(--bf-art-h)] object-cover object-center opacity-70"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-black/70" />
                    <div className="absolute inset-x-0 top-0 px-3 py-1 flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wide drop-shadow">{bf.name}</span>
                      <span
                        className={clsx(
                          'hud-label px-1.5 py-0.5 shrink-0 border bg-black/50',
                          control === 'player' && 'border-accent text-accent',
                          control === 'ai' && 'border-danger text-danger',
                          control === 'contested' && 'border-accent text-accent',
                          control === 'open' && 'border-line text-txtDim',
                        )}
                      >
                        {control === 'player'
                          ? 'You hold'
                          : control === 'ai'
                            ? 'AI holds'
                            : control === 'contested'
                              ? 'Contested'
                              : 'Open'}
                      </span>
                    </div>
                    {bf.card?.text && (
                      <div className="absolute inset-x-0 bottom-0 px-3 py-1 text-[10px] text-txt leading-snug bg-black/70">
                        <GlossaryText text={bf.card.text} />
                        <span className="ml-1 hud-label text-txtFaint">
                          · by {bf.contributor === 'player' ? 'you' : 'AI'}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* My zone — below, units press up toward the battlefield */}
                  <div
                    className={clsx(
                      'flex-1 min-h-[60px] flex flex-col justify-start bg-black/25',
                      droppable && 'ring-1 ring-inset ring-accent bg-accent/5',
                    )}
                  >
                    <div className="flex items-center justify-between px-1.5 pt-1">
                      <span className="hud-label text-accent/80">You</span>
                      {control === 'contested' &&
                        unitsAt(bf, 'player').length > 0 &&
                        cleanTurn && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              send({ type: 'DECLARE_SHOWDOWN', index: bf.index })
                            }}
                            className="hud-label border border-accent text-accent px-1.5 py-0.5 hover:bg-accent hover:text-black"
                          >
                            ⚔ Declare Showdown
                          </button>
                        )}
                    </div>
                    <UnitZone
                      units={unitsAt(bf, 'player')}
                      side="player"
                      selectedUnit={selectedUnit}
                      onUnitClick={onUnitClick}
                      highlightIds={highlightIds}
                      equippedIds={equippedIds}
                      onHover={setHovered}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Cast lane — stack items pending + the last thing to resolve */}
          <CastLane
            stack={state.stack}
            pendingShowdown={state.pendingShowdown}
            lastResolved={state.lastResolved}
            legalStackIds={legalStackIds}
            pickedStack={targeting?.pickedStack}
            onPick={pickTargetStack}
            onHover={setHovered}
          />

          <TrashFlow
            state={state}
            enabled={myPriority && !targeting}
            onHover={setHovered}
            onFlow={(card) => {
              const specs = scriptFor(card)?.play?.targets ?? []
              if (specs.length === 0) {
                send({ type: 'CAST_FLOW', card })
              } else {
                setTargeting({ card, isGear: false, specs, pickedUnits: [], flow: true })
              }
            }}
          />

        </div>

      </div>

      {/* Activity log (top-right) */}
      <LogPanel
        log={state.log}
        expanded={logExpanded}
        onToggle={() => setLogExpanded((v) => !v)}
      />

      {/* Player playmat — legend/champion · base · gear (light chrome) */}
      <div className="flex items-stretch gap-2 px-3 pt-1.5 pb-1 bg-black/20 border-t border-line/50 shrink-0">
        {/* Legend */}
        <div
          className="w-[var(--legend-w)] shrink-0"
          onMouseEnter={() => setHovered(player.legend)}
          onMouseLeave={() => setHovered((h) => (h === player.legend ? null : h))}
        >
          <div className="hud-label mb-0.5 truncate">
            Legend{player.legendEmpowered && <span className="text-accent"> ⚡</span>}
          </div>
          <div className={clsx('border', player.legendEmpowered ? 'border-accent' : 'border-line/60')}>
            <CardArt card={player.legend} size="sm" preview={false} badge={false} />
          </div>
          {myPriority && myLegendAbils.length > 0 && (
            <div className="mt-1 flex flex-col gap-1">
              {myLegendAbils.map(({ ab, i }) => (
                <button
                  key={i}
                  onClick={() => {
                    if (ab.targets && ab.targets.length > 0) {
                      setTargeting({
                        card: player.legend,
                        isGear: false,
                        specs: ab.targets,
                        pickedUnits: [],
                        activate: { instanceId: 'legend:player', abilityIndex: i },
                      })
                    } else {
                      send({ type: 'ACTIVATE_ABILITY', instanceId: 'legend:player', abilityIndex: i })
                    }
                  }}
                  title={ab.label}
                  className="text-[9px] px-1 py-0.5 border border-line/60 text-txtDim hover:border-accent hover:text-accent truncate text-left"
                >
                  ⚡ {ab.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Champion */}
        <button
          type="button"
          disabled={!myChampionCastable}
          onClick={() => myChampionInHand && beginPlay(myChampionInHand)}
          onMouseEnter={() => setHovered(player.chosenChampion)}
          onMouseLeave={() => setHovered((h) => (h === player.chosenChampion ? null : h))}
          className={clsx(
            'w-[var(--legend-w)] shrink-0 self-start text-left border transition-colors',
            player.championPlayed
              ? 'opacity-40 border-line/60'
              : myChampionCastable
                ? 'border-accent cursor-pointer'
                : 'border-line/60 opacity-70',
          )}
        >
          <div className="hud-label mb-0.5 px-0.5 truncate">
            Champion{player.championPlayed ? ' · IN PLAY' : myChampionCastable ? ' · PLAY' : ''}
          </div>
          <CardArt card={player.chosenChampion} size="sm" preview={false} badge={false} />
        </button>

        {/* Your Base — the big central zone / drop target */}
        <div
          className={clsx(
            'flex-1 min-w-0 border px-3 py-1.5 flex flex-col',
            canDropCardAt('base') || (selectedUnit && myPriority)
              ? 'border-accent bg-accent/10 cursor-pointer'
              : 'border-line/40 bg-black/10',
          )}
          onClick={() => (canDropCardAt('base') || (selectedUnit && myPriority)) && onBaseClick()}
        >
          <span className="hud-label">Your Base</span>
          <div className="flex gap-1.5 flex-wrap content-start mt-1 flex-1">
            {player.base.map((u) => (
              <BoardUnit
                key={u.instanceId}
                unit={u}
                side="player"
                selected={selectedUnit === u.instanceId}
                targetable={highlightIds.has(u.instanceId)}
                equipped={[...player.gear, ...ai.gear].some((g) => g.attachedTo === u.instanceId)}
                onClick={() => onUnitClick(u)}
                onHover={setHovered}
              />
            ))}
            {player.base.length === 0 && <span className="text-txtFaint text-xs">— empty —</span>}
          </div>
        </div>

        {/* Gear */}
        <div className="w-[140px] shrink-0 border border-line/40 bg-black/10 px-2 py-1.5">
          <span className="hud-label">Gear</span>
          <div className="flex gap-1.5 flex-wrap mt-1">
            {player.gear.map((g) => (
              <button
                key={g.instanceId}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onGearClick(g)
                }}
                onMouseEnter={() => setHovered(g.card)}
                onMouseLeave={() => setHovered((h) => (h === g.card ? null : h))}
                title={g.card.name}
                className={clsx(
                  'relative w-[var(--pile-w)] overflow-hidden border transition-colors',
                  selectedGear === g.instanceId
                    ? 'border-accent'
                    : highlightIds.has(g.instanceId)
                      ? 'border-[#3a6ea5]'
                      : 'border-line/60',
                  g.exhausted && 'opacity-55 rotate-6',
                )}
              >
                <CardArt card={g.card} size="sm" preview={false} badge={false} />
                {g.empowered && (
                  <span className="absolute top-0 left-0 bg-black/80 text-[9px] px-0.5 text-accent">⚡</span>
                )}
                {g.attachedTo && (
                  <span className="absolute bottom-0 right-0 bg-black/80 text-[9px] px-0.5">⚔</span>
                )}
              </button>
            ))}
            {player.gear.length === 0 && <span className="text-txtFaint text-xs">— empty —</span>}
          </div>
        </div>
      </div>

      {/* Hand band — runes (left) · hand (centre, fans/overlaps) · deck & trash (right) */}
      <div className="flex items-end gap-3 px-4 py-2 bg-black/20 border-t border-line/50 shrink-0 min-h-[clamp(120px,17vh,200px)]">
        <RuneRail pool={player.runes} />

        {/* Hand — centred; cards overlap once the hand gets wide */}
        <div className="flex-1 min-w-0 flex items-end justify-center">
          {player.hand.length === 0 && <span className="hud-label self-center">No cards in hand</span>}
          {player.hand.map((card, i) => {
            const check = canPlay(state, 'player', card)
            const playable = myPriority && check.ok
            const freeRuneCount =
              player.runes.channeled.length - player.runes.spent.length
            const costHint =
              card.power > 0
                ? ` — costs ⚡${card.energy} + ${card.power} rune${card.power > 1 ? 's' : ''}; you have ⚡${player.runes.energy}, ${freeRuneCount} free rune${freeRuneCount === 1 ? '' : 's'}`
                : ` — costs ⚡${card.energy}; you have ⚡${player.runes.energy}`
            const why = !myPriority
              ? state.priority === 'ai' || state.activePlayer === 'ai'
                ? "AI's turn"
                : 'Not your priority'
              : check.ok
                ? card.name
                : (check.reason ?? 'Not playable now') +
                  (/energy|power/i.test(check.reason ?? '') ? costHint : '')
            const n = player.hand.length
            // Cards are bigger now — start overlapping a little sooner.
            const shift = n <= 5 ? 8 : Math.max(-64, 8 - (n - 5) * 13)
            return (
              <button
                key={`${card.id}-${i}`}
                type="button"
                style={{ marginLeft: i === 0 ? 0 : shift }}
                onClick={() => (playable ? beginPlay(card) : undefined)}
                onMouseEnter={() => setHovered(card)}
                onMouseLeave={() => setHovered((h) => (h === card ? null : h))}
                title={why}
                className={clsx(
                  'w-[var(--card-w)] shrink-0 border bg-panel2 transition-transform duration-150 origin-bottom hover:scale-110 hover:-translate-y-2 hover:z-30 relative',
                  selectedCard === card
                    ? 'border-accent -translate-y-2 scale-105 z-20'
                    : targeting?.card === card
                      ? 'border-[#3a6ea5] -translate-y-2 scale-105 z-20'
                      : 'border-line/70',
                  !playable && 'opacity-45 cursor-not-allowed',
                )}
              >
                <CardArt card={card} size="sm" preview={false} />
              </button>
            )
          })}
        </div>

        {/* Main deck + trash */}
        <div className="flex items-end gap-1.5 shrink-0">
          <div className="w-[var(--pile-w)]">
            <div className="relative aspect-[5/7] border border-line/60 overflow-hidden">
              <CardBack />
              <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-bold text-txt tabular-nums bg-black/70">
                📚 {player.mainDeck.length}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPilesSide('player')}
            onMouseEnter={() => topTrash && setHovered(topTrash)}
            onMouseLeave={() => setHovered((h) => (h === topTrash ? null : h))}
            title="View trash & banished"
            className="w-[var(--pile-w)] text-left group"
          >
            <div className="relative aspect-[5/7] border border-line/60 overflow-hidden group-hover:border-accent">
              {topTrash ? (
                <CardArt card={topTrash} size="sm" preview={false} badge={false} />
              ) : (
                <CardBack dim />
              )}
              <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-bold text-txt tabular-nums bg-black/70">
                🗑 {player.trash.length}
                {player.banished.length > 0 && ` ⚰${player.banished.length}`}
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-panel border-t border-line shrink-0">
        <span
          className={clsx(
            'hud-label px-2 py-0.5 border shrink-0',
            assigningDamage
              ? 'border-accent text-accent'
              : cleanTurn
                ? 'border-line text-txt'
                : responding
                  ? 'border-accentDim text-accentDim'
                  : 'border-line text-txtDim',
          )}
        >
          {turnChip}
        </span>
        <span className="flex-1 text-txtDim text-xs truncate">{hint}</span>

        {castArmed && (
          <Btn variant="primary" onClick={castSelected}>
            Cast {selectedCard!.name}
          </Btn>
        )}

        {activeOpt && (
          <button
            onClick={() => setAcceleratePaid((v) => !v)}
            disabled={!canAffordExtra}
            className={clsx(
              'px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide border',
              acceleratePaid ? 'bg-accent border-accent text-black' : 'border-line text-txtDim',
              !canAffordExtra && 'opacity-40',
            )}
          >
            {acceleratePaid ? '✓ ' : ''}
            {activeOpt.label}
          </button>
        )}

        {myChoice && myChoice.min === 0 && (
          <Btn onClick={() => send({ type: 'RESOLVE_CHOICE', pickedIds: [] })}>Skip</Btn>
        )}

        {targeting && (
          <>
            {targeting.specs.some((s) => s.optional) && (
              <Btn onClick={() => submitTargeting(targeting)}>Done</Btn>
            )}
            <Btn onClick={() => setTargeting(null)}>Cancel</Btn>
          </>
        )}

        {selectedAbilities.map(({ ab, i }) => (
          <button
            key={i}
            onClick={() => {
              const instanceId = selectedGear ?? selectedUnit
              if (!instanceId) return
              // Equip / targeted gear abilities enter the targeting flow.
              if (ab.targets && ab.targets.length > 0) {
                setTargeting({
                  card: abilitySource!.card,
                  isGear: !!selectedGear,
                  specs: ab.targets,
                  pickedUnits: [],
                  activate: { instanceId, abilityIndex: i },
                })
                return
              }
              send({
                type: 'ACTIVATE_ABILITY',
                instanceId,
                abilityIndex: i,
                targetInstanceIds: [],
              })
            }}
            title={ab.label}
            className="px-3 py-1.5 border border-accentDim text-accent text-[11px] font-bold uppercase tracking-wide hover:bg-accent hover:text-black max-w-[220px] truncate"
          >
            {ab.label}
          </button>
        ))}

        <Btn
          onClick={() => send({ type: 'CHANNEL_RUNE' })}
          disabled={!cleanTurn || player.runes.deck.length === 0}
        >
          Channel
        </Btn>
        <Btn
          onClick={() => send({ type: 'RECYCLE_RUNE' })}
          disabled={!cleanTurn || player.runes.deck.length === 0}
        >
          Recycle
        </Btn>

        {responding ? (
          <Btn variant="primary" onClick={() => send({ type: 'PASS_PRIORITY' })}>
            Pass
          </Btn>
        ) : (
          <Btn variant="primary" onClick={() => send({ type: 'END_TURN' })} disabled={!cleanTurn}>
            End_Turn →
          </Btn>
        )}
      </div>
    </div>
  )
}

// ── Card back ────────────────────────────────────────────────────────────

/** A face-down Riftbound card — dark panel with the domain-diamond motif. */
function CardBack({ dim }: { dim?: boolean }) {
  return (
    <div
      className={clsx(
        'w-full h-full flex items-center justify-center bg-panel2 select-none',
        dim && 'opacity-40',
      )}
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg,transparent 0 6px,rgba(232,98,44,0.06) 6px 7px)',
      }}
    >
      <span className="text-accent/70 text-lg leading-none rotate-45">◈</span>
    </div>
  )
}

// ── Score rail ───────────────────────────────────────────────────────────

function Pip({ filled, tone }: { filled: boolean; tone: 'ai' | 'me' }) {
  const color = tone === 'ai' ? '#e0403a' : '#e8622c'
  return (
    <span
      className="w-[var(--pip)] h-[var(--pip)] rounded-full border transition-all duration-300"
      style={
        filled
          ? { background: color, borderColor: color, boxShadow: `0 0 7px ${color}aa` }
          : { borderColor: '#3a3a3a', background: 'rgba(0,0,0,0.35)' }
      }
    />
  )
}

/** Left rail — one shared axis: AI fills 8 pips upward from the centre line,
 *  you fill 8 pips downward. Victory is 8. */
function ScoreStrip({ aiPoints, myPoints }: { aiPoints: number; myPoints: number }) {
  return (
    <div className="basis-[8%] min-w-[68px] max-w-[132px] shrink-0 border-r border-line/60 bg-black/20 flex flex-col items-center justify-center gap-1.5 py-3 overflow-hidden">
      <span className="text-lg font-bold tabular-nums leading-none text-danger">{aiPoints}</span>
      <span className="hud-label text-danger/70">AI</span>
      {/* AI: row 0 = topmost (= point 8), row 7 = touching the centre (= point 1) */}
      <div className="flex flex-col gap-[5px] mt-0.5">
        {Array.from({ length: 8 }).map((_, row) => (
          <Pip key={row} filled={aiPoints >= 8 - row} tone="ai" />
        ))}
      </div>
      <div className="w-9 h-[3px] my-1 rounded-full bg-accent shadow-[0_0_10px_rgba(232,98,44,0.7)]" />
      {/* You: row 0 = touching the centre (= point 1), row 7 = bottom (= point 8) */}
      <div className="flex flex-col gap-[5px] mb-0.5">
        {Array.from({ length: 8 }).map((_, row) => (
          <Pip key={row} filled={myPoints >= row + 1} tone="me" />
        ))}
      </div>
      <span className="hud-label text-accent/70">You</span>
      <span className="text-lg font-bold tabular-nums leading-none text-accent">{myPoints}</span>
    </div>
  )
}

// ── Status helpers ───────────────────────────────────────────────────────

function unitStatuses(u: UnitInPlay): string[] {
  const out: string[] = []
  if (u.empowered) out.push('Empowered')
  if ((u.counters.stunned ?? 0) > 0) out.push('Stunned')
  if ((u.counters.buffed ?? 0) > 0) out.push('Buffed')
  const shield = keywordValue(u, 'Shield') + (u.counters.shield ?? 0)
  if (shield > 0) out.push(`Shield ${shield}`)
  const assault = keywordValue(u, 'Assault')
  if (assault > 0) out.push(`Assault ${assault}`)
  const mb = mightBonus(u)
  if (mb !== 0) out.push(`${mb > 0 ? '+' : ''}${mb} Might`)
  if (u.sick) out.push('Summoning sick')
  if (u.exhausted) out.push('Exhausted')
  return out
}

function gearStatuses(g: GearInPlay): string[] {
  const out: string[] = []
  if (g.empowered) out.push('Empowered')
  out.push(g.exhausted ? 'Exhausted' : 'Ready')
  if (g.attachedTo) out.push('Attached')
  return out
}

// ── Manual showdown damage assignment ────────────────────────────────────

function DamageModal({
  state,
  onAssign,
}: {
  state: GameState
  onAssign: (a: DamageAssignment[]) => void
}) {
  const pd = state.pendingDamage!
  const receiving = pd.stage === 'def' ? (pd.declarer === 'player' ? 'ai' : 'player') : pd.declarer
  const units = state.battlefields[pd.index].units.filter(
    (u) => u.owner === receiving && pd.targetIds.includes(u.instanceId),
  )
  const ranked = [...units].sort((a, b) => damageOrderRank(a) - damageOrderRank(b))
  const [picks, setPicks] = useState<Record<string, number>>({})

  const hp = (u: UnitInPlay) => effHp(u, state)
  const total = Object.values(picks).reduce((n, v) => n + v, 0)
  const remaining = pd.pool - total
  const maxKillable = units.reduce((n, u) => n + hp(u), 0)
  const rankLabel = (u: UnitInPlay) =>
    damageOrderRank(u) === 0 ? 'TANK' : damageOrderRank(u) === 2 ? 'BACKLINE' : ''
  const lockedFor = (u: UnitInPlay) => {
    const r = damageOrderRank(u)
    return units.some((o) => damageOrderRank(o) < r && (picks[o.instanceId] ?? 0) < hp(o))
  }
  const step = (u: UnitInPlay, d: number) =>
    setPicks((p) => {
      const cur = p[u.instanceId] ?? 0
      const cap = hp(u) + 3
      let next = Math.max(0, Math.min(cap, cur + d))
      if (d > 0) next = Math.min(next, cur + Math.max(0, remaining))
      return { ...p, [u.instanceId]: next }
    })
  const auto = () => {
    const m: Record<string, number> = {}
    for (const a of autoAssignmentList(pd.pool, units, state)) m[a.targetInstanceId] = a.amount
    setPicks(m)
  }
  const assignments = Object.entries(picks)
    .filter(([, v]) => v > 0)
    .map(([targetInstanceId, amount]) => ({ targetInstanceId, amount }))
  const canConfirm = total <= pd.pool && total >= Math.min(pd.pool, maxKillable)

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-panel border border-accent p-5 w-[420px] max-w-[92vw]">
        <h3 className="hud-label text-accent mb-1">Assign {pd.pool} combat damage</h3>
        <p className="text-[11px] text-txtDim mb-3">
          Tank units must take lethal damage before the units behind them. Remaining:{' '}
          <span className={clsx('font-bold', remaining === 0 ? 'text-accent' : 'text-txt')}>
            {remaining}
          </span>
        </p>
        <div className="space-y-1.5 mb-4">
          {ranked.map((u) => {
            const cur = picks[u.instanceId] ?? 0
            const locked = lockedFor(u)
            const lethal = cur >= hp(u)
            return (
              <div
                key={u.instanceId}
                className={clsx(
                  'flex items-center gap-2 px-2 py-1.5 border',
                  locked ? 'border-line opacity-50' : 'border-line',
                  lethal && 'bg-danger/10',
                )}
              >
                <span className="flex-1 text-xs truncate">
                  {u.card.name}
                  {rankLabel(u) && (
                    <span className="ml-1 hud-label text-accent">{rankLabel(u)}</span>
                  )}
                  <span className="ml-1 text-[10px] text-txtFaint">
                    {hp(u)} hp{u.damage > 0 ? ` · ${u.damage} dmg` : ''}
                  </span>
                </span>
                <button
                  onClick={() => step(u, -1)}
                  disabled={locked || cur === 0}
                  className="w-6 h-6 border border-line hover:border-accent disabled:opacity-30 text-xs font-bold"
                >
                  −
                </button>
                <span className={clsx('w-6 text-center text-sm font-bold', lethal && 'text-accent')}>
                  {cur}
                </span>
                <button
                  onClick={() => step(u, 1)}
                  disabled={locked || remaining <= 0}
                  className="w-6 h-6 border border-line hover:border-accent disabled:opacity-30 text-xs font-bold"
                >
                  +
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={auto}>Auto</Btn>
          <Btn variant="primary" onClick={() => onAssign(assignments)} disabled={!canConfirm}>
            Confirm
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

/** Spells in your trash you can [Flow]-cast (printed Flow, or granted by Kennen). */
function TrashFlow({
  state,
  enabled,
  onFlow,
  onHover,
}: {
  state: GameState
  enabled: boolean
  onFlow: (card: Card) => void
  onHover: (c: Card | null) => void
}) {
  const seen = new Set<string>()
  const cards = state.player.trash.filter((c) => {
    if (c.type !== 'spell' || seen.has(c.id)) return false
    seen.add(c.id)
    return flowCost(c, state.flowGranted) !== null
  })
  if (cards.length === 0) return null

  return (
    <div className="px-4 py-1.5 border-t border-line bg-panel min-h-[70px] flex items-center gap-2 shrink-0">
      <span className="hud-label mr-1 shrink-0">Flow</span>
      <div className="flex items-end gap-2 flex-1 min-w-0 overflow-x-auto">
        {cards.map((card) => {
          const cost = flowCost(card, state.flowGranted)!
          const timingOk =
            state.priority === 'player' &&
            (spellTiming(card) !== 'sorcery' ||
              (state.activePlayer === 'player' && state.phase === 'action' && state.stack.length === 0))
          const affordable = canAfford(state, 'player', cost)
          const ok = enabled && timingOk && affordable
          return (
            <div key={card.id} className="w-[var(--unit-w)] shrink-0">
              <button
                type="button"
                onClick={() => ok && onFlow(card)}
                onMouseEnter={() => onHover(card)}
                onMouseLeave={() => onHover(null)}
                className={clsx(
                  'w-full overflow-hidden border transition-all',
                  ok ? 'border-accent hover:-translate-y-0.5' : 'border-line opacity-50',
                )}
                title={
                  ok
                    ? `Flow-cast ${card.name}`
                    : !affordable
                      ? 'not enough resources'
                      : 'not a legal time to Flow-cast'
                }
              >
                <CardArt card={card} size="sm" preview={false} badge={false} />
              </button>
              <div className="text-[8px] text-center text-accent leading-tight mt-0.5 tabular-nums">
                {cost.energy}⚡{(cost.runes?.length ?? 0) > 0 ? ` +${cost.runes!.length}✦` : ''}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CastLane({
  stack,
  pendingShowdown,
  lastResolved,
  legalStackIds,
  pickedStack,
  onPick,
  onHover,
}: {
  stack: GameState['stack']
  pendingShowdown: GameState['pendingShowdown']
  lastResolved: GameState['lastResolved']
  legalStackIds: Set<string>
  pickedStack?: string
  onPick: (id: string) => void
  onHover: (c: Card | null) => void
}) {
  const empty = stack.length === 0 && !pendingShowdown && !lastResolved
  const nameOf = (it: GameState['stack'][number]) =>
    it.card?.name ?? it.label.replace(/^(player|ai)'s\s+/i, '')
  return (
    <div className="px-4 py-1 border-t border-line bg-panel min-h-[30px] flex items-center gap-2 shrink-0 overflow-x-auto text-[11px]">
      <span className="hud-label shrink-0">Cast lane</span>
      {empty && <span className="text-txtFaint">— nothing in play —</span>}

      {pendingShowdown && (
        <span className="hud-label text-accent shrink-0">
          ⚔ Showdown @ bf {pendingShowdown.index + 1}
        </span>
      )}

      {stack.map((it) => {
        const targetable = legalStackIds.has(it.id)
        return (
          <button
            key={it.id}
            onClick={() => targetable && onPick(it.id)}
            disabled={!targetable}
            onMouseEnter={() => it.card && onHover(it.card)}
            onMouseLeave={() => onHover(null)}
            title={it.label}
            className={clsx(
              'shrink-0 px-2 py-0.5 border uppercase tracking-wide',
              targetable
                ? 'border-accent text-accent cursor-pointer hover:bg-accent hover:text-black'
                : 'border-line text-txt',
              pickedStack === it.id && 'bg-accent text-black',
            )}
          >
            ▸ {nameOf(it)}
          </button>
        )
      })}

      {lastResolved && (
        <span
          className="shrink-0 text-txtFaint uppercase tracking-wide"
          onMouseEnter={() => lastResolved.card && onHover(lastResolved.card)}
          onMouseLeave={() => onHover(null)}
        >
          last: {lastResolved.card?.name ?? lastResolved.label}
          <span className={clsx('ml-1', lastResolved.outcome === 'countered' ? 'text-danger' : 'text-txtDim')}>
            ({lastResolved.outcome})
          </span>
        </span>
      )}
    </div>
  )
}

function LogPanel({
  log,
  expanded,
  onToggle,
}: {
  log: string[]
  expanded: boolean
  onToggle: () => void
}) {
  const shown = [...log].slice(expanded ? -200 : -14)
  return (
    <div
      className={clsx(
        'fixed top-14 right-2 z-30 bg-panel border border-line',
        expanded ? 'w-[clamp(320px,26vw,440px)]' : 'w-[var(--side-w)]',
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 hud-label hover:text-accent border-b border-line"
      >
        <span className="text-accent/80">Activity Log</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </button>
      <div
        className={clsx(
          'overflow-y-auto px-3 py-1.5 space-y-0.5',
          expanded ? 'max-h-[60vh]' : 'max-h-44',
        )}
      >
        {shown
          .map((msg, i) => ({ msg, i }))
          .reverse()
          .map(({ msg, i }) => (
            <LogLine key={i} text={msg} index={i} />
          ))}
      </div>
    </div>
  )
}

/** One channeled rune, shown as its own card. Spent runes tilt a little. */
function RuneChip({
  card,
  state,
}: {
  card: Card
  state: 'ready' | 'spent' | 'recycled'
}) {
  const domain = card.domains[0] ?? 'colorless'
  return (
    <div
      title={`${domain} rune${
        state === 'spent' ? ' — spent this turn' : state === 'recycled' ? ' — recycled for Power' : ' — ready'
      }`}
      className={clsx(
        'relative w-[var(--rune-w)] aspect-[5/7] shrink-0 border overflow-hidden bg-panel2 transition-transform',
        state === 'spent' && 'rotate-6 opacity-55',
        state === 'recycled' && '-rotate-6 opacity-80',
      )}
      style={{ borderColor: DOMAIN_HEX[domain] }}
    >
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={domain} className="w-full h-full object-cover" />
      ) : (
        <span
          className="absolute inset-0 flex items-center justify-center text-[9px] font-bold"
          style={{ color: DOMAIN_HEX[domain] }}
        >
          {domain.slice(0, 3).toUpperCase()}
        </span>
      )}
      {state === 'recycled' && (
        <span className="absolute inset-0 flex items-center justify-center text-txt text-sm bg-black/40">
          ✦
        </span>
      )}
    </div>
  )
}

/** Left rail of the hand band — rune deck, every channeled rune (spent ones
 *  tilted), and the spendable energy pool. */
function RuneRail({ pool }: { pool: GameState['player']['runes'] }) {
  // A rune recycled for a Power pip this turn (`pool.spent`) shows tilted+✦.
  const pipLeft: Record<string, number> = {}
  for (const c of pool.spent) {
    const d = c.domains[0] ?? 'colorless'
    pipLeft[d] = (pipLeft[d] ?? 0) + 1
  }
  // Of the rest, the first `pool.energy` are still ready (each ready rune = 1
  // spendable energy); the ones past that have had their energy spent → tilted.
  let readyBudget = Math.max(0, pool.energy)
  const chips: { card: Card; state: 'ready' | 'spent' | 'recycled' }[] = pool.channeled.map(
    (card) => {
      const d = card.domains[0] ?? 'colorless'
      if ((pipLeft[d] ?? 0) > 0) {
        pipLeft[d] -= 1
        return { card, state: 'recycled' as const }
      }
      if (readyBudget > 0) {
        readyBudget -= 1
        return { card, state: 'ready' as const }
      }
      return { card, state: 'spent' as const }
    },
  )
  chips.push(...pool.recycled.map((card) => ({ card, state: 'recycled' as const })))
  const readyCount = chips.filter((c) => c.state === 'ready').length
  return (
    <div className="flex items-end gap-2 shrink-0">
      {/* Rune deck */}
      <div className="w-[var(--rune-w)] shrink-0">
        <div className="relative aspect-[5/7] border border-line/60 overflow-hidden">
          <CardBack />
          <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[9px] font-bold text-txt tabular-nums bg-black/70">
            🜲{pool.deck.length}
          </span>
        </div>
      </div>
      {/* Every channeled / recycled rune — wraps, never clipped */}
      <div className="flex flex-wrap content-end gap-1 max-w-[calc(var(--rune-w)*4.6)]">
        {chips.map((c, i) => (
          <RuneChip key={i} card={c.card} state={c.state} />
        ))}
        {chips.length === 0 && (
          <span className="text-txtFaint text-[10px] self-end pb-1">no runes</span>
        )}
      </div>
      {/* Spendable energy */}
      <div className="flex flex-col self-center leading-tight tabular-nums">
        <span className="hud-label">Energy</span>
        <span className="text-accent text-lg font-bold">⚡ {pool.energy}</span>
        {pool.power > 0 && <span className="text-[10px] text-txtDim">✦ {pool.power} power</span>}
        <span className="text-[10px] text-txtFaint">{readyCount} ready</span>
      </div>
    </div>
  )
}

/** Inspect a player's trash + banished piles. */
function PilesModal({
  side,
  trash,
  banished,
  onHover,
  onClose,
}: {
  side: 'player' | 'ai'
  trash: Card[]
  banished: Card[]
  onHover: (c: Card | null) => void
  onClose: () => void
}) {
  const Grid = ({ label, cards }: { label: string; cards: Card[] }) => (
    <div className="mb-3">
      <div className="hud-label mb-1">
        {label} · {cards.length}
      </div>
      {cards.length === 0 ? (
        <p className="text-txtFaint text-xs">— empty —</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {cards.map((c, i) => (
            <div
              key={`${c.id}-${i}`}
              className="w-20 border border-line"
              onMouseEnter={() => onHover(c)}
              onMouseLeave={() => onHover(null)}
            >
              <CardArt card={c} size="sm" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
  return (
    <Modal title={`${side === 'player' ? 'Your' : "AI's"} piles`} onClose={onClose} wide>
      <Grid label="Trash" cards={trash} />
      <Grid label="Banished (removed from game)" cards={banished} />
    </Modal>
  )
}

function ChoiceModal({
  choice,
  zoneCards,
  textOptions,
  picks,
  onToggle,
  onSubmit,
}: {
  choice: PendingChoice
  zoneCards: Card[]
  textOptions?: string[]
  picks: string[]
  onToggle: (id: string) => void
  onSubmit: () => void
}) {
  return (
    <Modal title={choice.label} onClose={onSubmit}>
      <p className="hud-label normal-case tracking-normal mb-4">
        Pick {choice.min === choice.max ? choice.max : `${choice.min}–${choice.max}`}.
      </p>
      {textOptions ? (
        <div className="flex flex-col gap-2">
          {textOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => onToggle(opt)}
              className={clsx(
                'px-4 py-2 border text-xs font-bold uppercase tracking-wide transition-colors',
                picks.includes(opt)
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-line text-txt hover:border-accent',
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-3 justify-center">
          {zoneCards.map((c) => (
            <button
              key={c.id}
              onClick={() => onToggle(c.id)}
              className={clsx(
                'w-28 border transition-all',
                picks.includes(c.id) ? 'border-accent -translate-y-1' : 'border-line',
              )}
            >
              <CardArt card={c} preview={false} />
            </button>
          ))}
          {zoneCards.length === 0 && <p className="text-txtFaint text-sm">Nothing to choose.</p>}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        {choice.min === 0 && <Btn onClick={onSubmit}>Skip</Btn>}
        <Btn variant="primary" onClick={onSubmit} disabled={picks.length < choice.min}>
          Confirm
        </Btn>
      </div>
    </Modal>
  )
}

function UnitZone({
  units,
  side,
  selectedUnit,
  onUnitClick,
  highlightIds,
  equippedIds,
  onHover,
}: {
  units: UnitInPlay[]
  side: 'player' | 'ai'
  selectedUnit?: string | null
  onUnitClick?: (u: UnitInPlay) => void
  highlightIds?: Set<string>
  equippedIds?: Set<string>
  onHover?: (c: Card | null) => void
}) {
  return (
    <div className="px-2 py-1.5 flex gap-1.5 flex-wrap min-h-[calc(var(--unit-w-big)*1.35)] content-start">
      {units.map((u) => (
        <BoardUnit
          key={u.instanceId}
          unit={u}
          side={side}
          big
          selected={selectedUnit === u.instanceId}
          targetable={highlightIds?.has(u.instanceId)}
          equipped={equippedIds?.has(u.instanceId)}
          onClick={() => onUnitClick?.(u)}
          onHover={onHover}
        />
      ))}
    </div>
  )
}

function BoardUnit({
  unit,
  side,
  big,
  selected,
  targetable,
  equipped,
  onClick,
  onHover,
}: {
  unit: UnitInPlay
  side: 'player' | 'ai'
  big?: boolean
  selected?: boolean
  targetable?: boolean
  equipped?: boolean
  onClick?: () => void
  onHover?: (c: Card | null) => void
}) {
  const base = unit.card.might
  const bonus = mightBonus(unit)
  const shield = unit.counters.shield ?? 0
  const stunned = (unit.counters.stunned ?? 0) > 0
  const buffed = (unit.counters.buffed ?? 0) > 0
  const empowered = !!unit.empowered
  // Keywords granted this turn / by equipment (kw:* and gkw:*) → short chips.
  const grantChips = Object.entries(unit.counters)
    .filter(([k, v]) => (k.startsWith('kw:') || k.startsWith('gkw:')) && v > 0)
    .map(([k, v]) => `${k.replace(/^g?kw:/, '').slice(0, 1)}${v}`)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      onMouseEnter={() => onHover?.(unit.card)}
      onMouseLeave={() => onHover?.(null)}
      className={clsx(
        'relative overflow-hidden border transition-all',
        big ? 'w-[var(--unit-w-big)]' : 'w-[var(--unit-w)]',
        selected
          ? 'border-accent -translate-y-0.5'
          : targetable
            ? 'border-[#3a6ea5]'
            : empowered
              ? 'border-accent'
              : side === 'player'
                ? 'border-line2'
                : 'border-line',
        // Exhausted units lie on their side, like a tapped card.
        unit.exhausted && (big ? 'rotate-90 mx-4 opacity-70' : 'rotate-90 mx-3 opacity-70'),
      )}
      title={
        unit.card.name +
        (empowered ? ' — Empowered' : '') +
        (unit.exhausted ? ' — exhausted' : '')
      }
    >
      <CardArt card={unit.card} size="sm" preview={false} badge={false} />
      <span className="absolute top-0 left-0 bg-accent text-black text-[9px] font-bold min-w-4 h-4 px-0.5 flex items-center justify-center leading-none">
        {unit.card.energy}
      </span>
      {empowered && (
        <span className="absolute top-0 left-1/2 -translate-x-1/2 bg-accent text-black text-[9px] font-bold px-1">
          ⚡
        </span>
      )}
      {grantChips.length > 0 && (
        <span className="absolute bottom-2 inset-x-0 flex justify-center gap-0.5">
          {grantChips.map((c, i) => (
            <span key={i} className="bg-[#3a6ea5] text-white text-[8px] font-bold px-0.5 leading-tight">
              {c}
            </span>
          ))}
        </span>
      )}
      <span
        className={clsx(
          'absolute top-0 right-0 bg-black/85 text-[9px] font-bold px-1 tabular-nums',
          stunned && 'text-txtFaint line-through',
        )}
      >
        {base}⚔
      </span>
      {bonus !== 0 && (
        <span
          className={clsx(
            'absolute bottom-2 left-0 text-[9px] font-bold px-1 bg-black/85 tabular-nums',
            bonus > 0 ? 'text-accent' : 'text-danger',
          )}
        >
          {bonus > 0 ? '+' : ''}
          {bonus}
        </span>
      )}
      <span className="absolute bottom-0 inset-x-0 bg-black/85 text-[8px] leading-tight truncate px-0.5 uppercase">
        {unit.card.name.split(/[ ,–-]/)[0]}
      </span>
      {buffed && (
        <span className="absolute top-3 left-0 text-accent text-[10px]" title="buff counter">
          ◆
        </span>
      )}
      {equipped && (
        <span className="absolute top-3 right-0 text-accent text-[10px]" title="equipped">
          ⚔
        </span>
      )}
      {shield > 0 && <span className="absolute bottom-3 right-0 text-[#4aa3c7] text-[10px]">⛨</span>}
      {stunned && (
        <span className="absolute bottom-3 left-0 text-accent text-[10px]" title="stunned">
          ✦
        </span>
      )}
      {unit.sick && !stunned && (
        <span className="absolute bottom-3 left-0 text-txtDim text-[10px]">💤</span>
      )}
    </button>
  )
}
