import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Card } from '../types/card'
import {
  DamageAssignment,
  FacedownCard,
  GameAction,
  GameState,
  GearInPlay,
  PendingChoice,
  PlayerSide,
  ShowdownCombatant,
  ShowdownReport,
  StackItem,
  UnitInPlay,
} from '../types/game'
import {
  autoAssignmentList,
  allUnits,
  canAfford,
  canMove,
  canRecycleRune,
  canPlaceUnitAt,
  canPlay,
  effectiveCost,
  controllerOf,
  damageOrderRank,
  deflectSurcharge,
  dispatch,
  effHp,
  flowCost,
  forecastShowdown,
  keywordValue,
  legalGearTargets,
  legalStackTargets,
  legalUnitTargets,
  legendAbilities,
  ownUnits,
  combatRoleOf,
  lethalMight,
  mightBonus,
  mightBreakdown,
  showdownMight,
  runAITurn,
  stepAITurn,
  scriptFor,
  spellTiming,
  unitPlayOptions,
  totalPlayCost,
  unitsAt,
} from '../engine'
import type { MightTerm, ShowdownForecast, TargetSpec } from '../engine'
import { canHide, canPlayFromFacedown, hasHidden, hideBlockedReason } from '../engine/hidden'
import { CardArt, CenterPreview, PinnedCard, DOMAIN_HEX, domainKey } from './CardArt'
import { CardRulesText } from './GlossaryText'
import { Btn, Chip, LogLine, Modal } from './ui'
import {
  parseUnitZoneId,
  parseZoneId,
  unitZoneId,
  useDragDrop,
  zoneId,
  type DragPayload,
} from './useDragDrop'
import { useLocale, useT, type StringKey, type TFn } from '../i18n'
import { abilityLabelKo, choiceLabelKo, targetLabelKo } from '../i18n/abilityText'
import { TutorialCoach } from './TutorialCoach'
import { logLineKo, showdownSummaryKo } from '../i18n/logText'

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
  /** The caster armed the spell's [Repeat] cost. */
  paidRepeat?: boolean
  /** Targeting a Flow-cast from the trash. */
  flow?: boolean
  /** Set when we're targeting for an activated ability (e.g. Equip), not a cast. */
  activate?: { instanceId: string; abilityIndex: number }
  /** Battlefield index this card is being played from facedown (811). */
  fromFacedown?: number
}

/**
 * The gear→unit connector. Drawn in a fixed, click-through overlay only while
 * a linked pair is hovered, so the measured rectangles can never go stale — no
 * scroll or resize listeners needed, and nothing to keep in sync with layout.
 */
function GearLinks({ unitId }: { unitId: string | null }) {
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([])

  // Endpoints are found by data attribute rather than a ref registry. Inline
  // ref callbacks are detached (`null`) in the mutation phase and re-attached in
  // the layout phase *in tree order* — and this overlay sits earlier in the tree
  // than the units, so a registry would still be empty when this effect ran.
  // Querying the committed DOM sidesteps the ordering entirely, and keying the
  // attachment into `data-gear-for` keeps the dep list to just `unitId`, so the
  // effect can't re-fire on every render.
  useLayoutEffect(() => {
    if (!unitId) {
      setLines([])
      return
    }
    const esc = (window.CSS?.escape ?? ((s: string) => s))(unitId)
    const unitEl = document.querySelector<HTMLElement>(`[data-unit-id="${esc}"]`)
    if (!unitEl) {
      setLines([])
      return
    }
    const u = unitEl.getBoundingClientRect()
    const out = [...document.querySelectorAll<HTMLElement>(`[data-gear-for="${esc}"]`)].map(
      (el) => {
        const r = el.getBoundingClientRect()
        return {
          x1: r.left + r.width / 2,
          y1: r.top + r.height / 2,
          x2: u.left + u.width / 2,
          y2: u.top + u.height / 2,
        }
      },
    )
    setLines(out)
  }, [unitId])

  if (lines.length === 0) return null

  /**
   * A quadratic curve bowed perpendicular to the run, plus a tapered head.
   *
   * A straight dashed line between two tiles reads as a *constraint* — a
   * ruler laid across the board. A curve reads as a connection drawn by hand,
   * which is what an attachment is. The control point is pushed sideways from
   * the midpoint by a fraction of the distance, so short links bow gently and
   * long ones sweep, and the bow always goes the same way round.
   */
  const curveFor = (l: { x1: number; y1: number; x2: number; y2: number }) => {
    const dx = l.x2 - l.x1
    const dy = l.y2 - l.y1
    const dist = Math.hypot(dx, dy) || 1
    // Perpendicular unit vector, scaled — capped so a long link never balloons.
    const bow = Math.min(70, dist * 0.24)
    const cx = (l.x1 + l.x2) / 2 + (-dy / dist) * bow
    const cy = (l.y1 + l.y2) / 2 + (dx / dist) * bow
    return `M ${l.x1} ${l.y1} Q ${cx} ${cy} ${l.x2} ${l.y2}`
  }

  return (
    <svg className="fixed inset-0 z-[45] pointer-events-none w-full h-full">
      <defs>
        <marker
          id="rb-gear-arrow"
          viewBox="0 0 12 12"
          refX="10"
          refY="6"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          {/* Swept back rather than a flat triangle, so it reads as a point of
              travel instead of a signpost. */}
          <path d="M 0 0 Q 5 6 0 12 L 12 6 Z" fill="#8AFBFF" />
        </marker>
        <filter id="rb-gear-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {lines.map((l, i) => {
        const d = curveFor(l)
        return (
          <g key={i} className="animate-[rb-fade_0.15s_ease-out]">
            {/* A wide, soft pass under the bright one so the link still reads
                against busy card art. */}
            <path d={d} fill="none" stroke="#4A90C2" strokeWidth={7} strokeOpacity={0.2} strokeLinecap="round" filter="url(#rb-gear-glow)" />
            <path
              d={d}
              fill="none"
              stroke="#8AFBFF"
              strokeWidth={2.5}
              strokeLinecap="round"
              markerEnd="url(#rb-gear-arrow)"
            />
            {/* A dot where the link leaves the gear, so both ends are anchored. */}
            <circle cx={l.x1} cy={l.y1} r={3.5} fill="#8AFBFF" />
          </g>
        )
      })}
    </svg>
  )
}

/** Name of a unit anywhere on the board, for the gear tooltip. */
function unitName(state: GameState, instanceId: string): string {
  const all = [
    ...state.player.base,
    ...state.ai.base,
    ...state.battlefields.flatMap((b) => b.units),
  ]
  return all.find((u) => u.instanceId === instanceId)?.card.name ?? '?'
}

/**
 * One self-dismissing line of commentary. Actor-coloured off the English log
 * line (that's where the actor sits in a known position), then rendered in the
 * player's language.
 */
function ActionToast({ text, dim }: { text: string; dim?: boolean }) {
  const { locale } = useLocale()
  const isAi = /^ai\b/i.test(text.trim())
  const body = (locale === 'ko' && logLineKo(text)) || text
  return (
    <div
      className={clsx(
        // No border, no shadow. A stack of outlined, shadowed boxes over the
        // board is a wall; the fill alone is enough to lift one line of text,
        // and the ◀ / ▸ marker already says whose action it was.
        'flex items-center gap-2 px-3.5 py-2 max-w-[min(520px,92vw)] bg-panel2/95',
        'animate-[rb-slide-down_0.22s_cubic-bezier(0.22,0.61,0.36,1)] transition-opacity duration-200',
        dim && 'opacity-45',
      )}
    >
      <span className={clsx('shrink-0 text-tiny', isAi ? 'text-danger' : 'text-accent')}>
        {isAi ? '◀' : '▸'}
      </span>
      <span className="text-xs text-txt leading-snug truncate">{body}</span>
    </div>
  )
}

/** Bookkeeping the player doesn't need announced — runes, draws, turn markers. */
const TOAST_NOISE =
  /channels? (a |an extra )?rune|draws? for the turn|—\s*\w+'s turn\s*—|keeps their hand|is on the play\b|banked energy|^Game start\./i
// Two. The Activity Log on the right already holds the full history, so the
// toasts only need to answer "what just happened", not the last four things.
const MAX_TOASTS = 2
const TOAST_MS = 4200

/** How fast to play back the AI's turn, in ms between actions. */
const AI_SPEEDS: { ms: number; key: StringKey }[] = [
  { ms: 900, key: 'speed.slow' },
  { ms: 550, key: 'speed.normal' },
  { ms: 250, key: 'speed.fast' },
  { ms: 0, key: 'speed.instant' },
]

/** `targetKindLabel`'s engine strings, as translatable keys. */
function targetKindKey(kind: TargetSpec['kind']): StringKey {
  switch (kind) {
    case 'friendlyUnit':
      return 'target.friendlyUnit'
    case 'enemyUnit':
      return 'target.enemyUnit'
    case 'unitAtBattlefield':
      return 'target.unitAtBattlefield'
    case 'gear':
      return 'target.gear'
    case 'friendlyGear':
    case 'otherGear':
      return 'target.friendlyGear'
    case 'stackSpell':
      return 'target.stackSpell'
    default:
      return 'target.unit'
  }
}

/**
 * Korean for a compiler-generated label, falling back to the English.
 *
 * `ab.label` / `spec.label` / `choice.label` are built by the text→script
 * compiler, so they are English wherever a card is. Everything else on the
 * board translates, which left the *buttons* — the things you actually click —
 * as the last English on screen.
 */
function useLabelKo(): (s: string | undefined, kind?: 'ability' | 'target' | 'choice') => string {
  const { locale } = useLocale()
  return (raw, kind = 'ability') => {
    if (!raw) return ''
    if (locale !== 'ko') return raw
    const fn = kind === 'target' ? targetLabelKo : kind === 'choice' ? choiceLabelKo : abilityLabelKo
    return fn(raw) ?? raw
  }
}

export default function GameBoard({ initialState, onExit }: Props) {
  const labelKo = useLabelKo()
  const t = useT()
  const [state, setState] = useState<GameState>(initialState)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)
  const [selectedGear, setSelectedGear] = useState<string | null>(null)
  const [targeting, setTargeting] = useState<Targeting | null>(null)
  const [acceleratePaid, setAcceleratePaid] = useState(false)
  const [choicePicks, setChoicePicks] = useState<string[]>([])
  const [hovered, setHovered] = useState<Card | null>(null)
  /** The board unit under the pointer — drives the Might breakdown. */
  const [hoveredUnit, setHoveredUnit] = useState<UnitInPlay | null>(null)
  /** Units that changed while it was not my move, highlighted briefly. */
  const [changedIds, setChangedIds] = useState<Set<string>>(() => new Set())
  /** "What can I do?" — an on-demand list of every legal move. */
  const [showMoves, setShowMoves] = useState(false)
  const [altHeld, setAltHeld] = useState(false)
  const [pinned, setPinned] = useState<Card | null>(null)
  const [pilesSide, setPilesSide] = useState<'player' | 'ai' | null>(null)
  const [logExpanded, setLogExpanded] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768,
  )
  const [mulliganPicks, setMulliganPicks] = useState<number[]>([])
  const [aiThinking, setAiThinking] = useState(false)
  /** Which edge the big card preview docks to — flipped away from the pointer. */
  const [previewSide, setPreviewSide] = useState<'left' | 'right'>('right')
  /** ms between AI actions; 0 = resolve the whole turn at once. Persisted. */
  const [aiSpeed, setAiSpeed] = useState<number>(() => {
    try {
      // Note: `Number(null)` is 0, which is a *valid* speed (instant) — so an
      // absent key has to be checked for explicitly or the default flips.
      const raw = localStorage.getItem('rb-ai-speed')
      if (raw === null) return 550
      const v = Number(raw)
      return AI_SPEEDS.some((s) => s.ms === v) ? v : 550
    } catch {
      return 550
    }
  })
  const changeAiSpeed = (ms: number) => {
    setAiSpeed(ms)
    try {
      localStorage.setItem('rb-ai-speed', String(ms))
    } catch {
      /* ignore */
    }
  }
  /** Self-dismissing "what just happened" toasts, newest last. */
  /**
   * Cards that have just arrived in hand, so they can be dealt in rather than
   * appearing. Keyed by card id and cleared on a timer — the class has to come
   * off again or the animation replays on every unrelated re-render.
   */
  const [drawnIds, setDrawnIds] = useState<Set<string>>(new Set())
  const handSeen = useRef<Set<string> | null>(null)

  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const toastId = useRef(0)
  /** How much of `state.log` has already been turned into toasts. */
  const logSeen = useRef(0)
  /** `lastShowdown.seq` the player has already read (so a report shows once). */
  const [seenShowdown, setSeenShowdown] = useState(0)
  const aiScheduled = useRef(false)
  const aiMark = useRef<number | null>(null)
  /** Live mirror of the current report's seq, so `act` can read it without stale closure. */
  const showdownSeqRef = useRef(0)
  showdownSeqRef.current = state.lastShowdown?.seq ?? 0

  /**
   * A signature of every unit on the board. Changing any of these is something
   * a player would want to notice: where it is, how hurt it is, what it is
   * worth in a fight, and whether it is ready.
   */
  const unitSignature = (s2: GameState) => {
    const m = new Map<string, string>()
    for (const u of [...s2.player.base, ...s2.ai.base, ...s2.battlefields.flatMap((b) => b.units)]) {
      m.set(
        u.instanceId,
        [
          u.location.kind === 'base' ? 'base' : `bf${u.location.index}`,
          u.damage,
          u.exhausted ? 'x' : 'r',
          u.empowered ? 'e' : '-',
          showdownMight(s2, u, 'attacker'),
          showdownMight(s2, u, 'defender'),
        ].join('/'),
      )
    }
    return m
  }
  const prevUnits = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const now = unitSignature(state)
    const prev = prevUnits.current
    prevUnits.current = now
    // Only narrate the opponent's doing — highlighting your own clicks back at
    // you is noise, and you already know what you just did.
    if (state.activePlayer === 'player' && !aiThinking) return
    const moved = new Set<string>()
    for (const [id, sig] of now) if (prev.has(id) && prev.get(id) !== sig) moved.add(id)
    for (const id of now.keys()) if (!prev.has(id)) moved.add(id) // newly arrived
    if (moved.size === 0) return
    setChangedIds(moved)
    const timer = setTimeout(() => setChangedIds(new Set()), 3400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

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
  // A rune is recyclable while it is on the board and not already consumed by a
  // rune pip — being exhausted for Energy does not stop it (163.2).
  const canRecycle = canRecycleRune(state, 'player')

  /**
   * Is there anything at all the player could do with this priority window?
   *
   * Rule 337.1.c.3 gives priority back to "the controller of the newest item on
   * the chain" — so after you cast, it returns to *you* before the opponent
   * sees it. That is correct, and it matters when you want to stack a second
   * spell on your own. But when you hold nothing playable, no facedown card and
   * no usable ability, the game is asking a question with one possible answer,
   * which is pure friction on every single cast.
   */
  const hasResponse =
    player.hand.some((c) => canPlay(state, 'player', c).ok) ||
    state.battlefields.some(
      (bf) => bf.facedown?.owner === 'player' && canPlayFromFacedown(state, 'player', bf.index).ok,
    ) ||
    [...ownUnits(state, 'player'), ...player.gear].some((src) =>
      (scriptFor(src.card)?.activated ?? []).some(
        (ab) => !ab.when || ab.when(state, src, 'player'),
      ),
    ) ||
    (legendAbilities(player.legend) ?? []).length > 0
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
  // The Chosen Champion is played from the Champion Zone (not the hand).
  const myChampion = player.championZone
  const myChampionCastable =
    myPriority &&
    !!myChampion &&
    !player.championPlayed &&
    canPlay(state, 'player', myChampion).ok
  const topTrash = player.trash[player.trash.length - 1] ?? null
  // Cost pips read the same in every language, so they stay literal in tooltips.
  const championCostText = `⚡${player.chosenChampion.energy}${
    player.chosenChampion.power ? ` + ✦${player.chosenChampion.power}` : ''
  }`

  const turnChip = t(
    aiThinking
      ? 'turn.aiThinking'
      : assigningDamage
        ? 'turn.assignDamage'
        : cleanTurn
          ? 'turn.yourMain'
          : responding
            ? 'turn.respondOnly'
            : state.priority === 'ai' || state.activePlayer === 'ai'
              ? 'turn.aiTurn'
              : 'turn.waiting',
  )

  // Drive the AI **one action at a time**, so its turn is something you watch
  // rather than a single jump to the end state. The effect re-runs on every
  // state change, so stepping once per run keeps going until the AI loses
  // priority — and terminates naturally when a step is a no-op (React bails on
  // an unchanged state, so nothing reschedules).
  const needsAI =
    !state.winner &&
    (state.pendingChoices[0]?.controller === 'ai' ||
      (state.phase === 'mulligan' && !state.ai.mulliganDone && state.player.mulliganDone) ||
      (state.phase !== 'mulligan' && state.priority === 'ai' && !state.pendingChoices[0]))

  useEffect(() => {
    setAiThinking(needsAI)
    if (!needsAI || aiScheduled.current) return
    aiScheduled.current = true
    if (aiMark.current == null) aiMark.current = state.log.length // remember what to diff

    const run = () => {
      aiScheduled.current = false
      // Instant mode keeps the old whole-turn behaviour in one update.
      setState((s) => (aiSpeed === 0 ? runAITurn(s) : stepAITurn(s).state))
    }
    if (aiSpeed === 0) {
      const t = setTimeout(run, 300)
      return () => {
        clearTimeout(t)
        aiScheduled.current = false
      }
    }
    const t = setTimeout(run, aiSpeed)
    return () => {
      clearTimeout(t)
      aiScheduled.current = false
    }
  }, [state, needsAI, aiSpeed])

  // Stream new log lines as small, self-dismissing toasts. This replaces the
  // end-of-turn recap modal: you see the AI act *while* it acts — including
  // whether it responded to a spell you just cast — without dismissing anything,
  // and without having to read the Pass button to infer what happened.
  useEffect(() => {
    const first = logSeen.current === 0
    const from = logSeen.current
    logSeen.current = state.log.length
    // On mount the whole existing log is "new" — don't replay it as a burst.
    if (first || state.log.length <= from) return

    const fresh = state.log.slice(from).filter((l) => !TOAST_NOISE.test(l))
    if (fresh.length === 0) return

    const added = fresh.slice(-MAX_TOASTS).map((text) => ({ id: ++toastId.current, text }))
    setToasts((prev) => [...prev, ...added].slice(-MAX_TOASTS))
    const newest = added[added.length - 1].id
    const timer = setTimeout(
      () => setToasts((prev) => prev.filter((x) => x.id > newest)),
      TOAST_MS,
    )
    return () => clearTimeout(timer)
  }, [state.log])

  useEffect(() => {
    const ids = new Set(state.player.hand.map((c) => c.id))
    const previous = handSeen.current
    handSeen.current = ids
    // First render: the opening hand is already there, so deal nothing.
    if (!previous) return
    const fresh = [...ids].filter((id) => !previous.has(id))
    if (fresh.length === 0) return
    setDrawnIds(new Set(fresh))
    const timer = setTimeout(() => setDrawnIds(new Set()), 650)
    return () => clearTimeout(timer)
  }, [state.player.hand])

  /**
   * Pass automatically when the player holds priority with no legal response.
   *
   * Rule 337.1.c.3 hands priority back to the caster, so every spell you cast
   * used to stop and ask "respond or pass?" even with an empty hand and nothing
   * to activate. The window is still offered whenever there is a real choice —
   * this only skips the ones with a single possible answer.
   *
   * Deliberately not applied to a pending showdown: declining to act there is a
   * real decision with consequences, not a formality.
   */
  useEffect(() => {
    if (!myPriority || state.winner) return
    if (state.stack.length === 0 || state.pendingShowdown) return
    if (pendingChoice || targeting || assigningDamage) return
    if (hasResponse) return
    const timer = setTimeout(() => {
      setState((s) => (s.priority === 'player' ? dispatch(s, { type: 'PASS_PRIORITY' }, 'player') : s))
    }, 260)
    return () => clearTimeout(timer)
  }, [
    myPriority,
    hasResponse,
    state.stack.length,
    state.pendingShowdown,
    state.winner,
    pendingChoice,
    targeting,
    assigningDamage,
  ])

  const act = useCallback((next: GameState) => {
    // Acting on the board dismisses the standing briefing — unless the action
    // itself produced a new showdown report, which the player should still see.
    const wasSeq = showdownSeqRef.current
    const nowSeq = next.lastShowdown?.seq ?? 0
    if (nowSeq === wasSeq) setSeenShowdown(wasSeq)

    setState(next)
    setSelectedCard(null)
    setSelectedUnit(null)
    setSelectedGear(null)
    setTargeting(null)
    setAcceleratePaid(false)
    setChoicePicks([])
    setPinned(null)
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
      setSeenShowdown(showdownSeqRef.current)
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

  // Drag and drop. The hook call has to sit above the mulligan early return
  // below — a hook after a conditional return is called on some renders and
  // not others, which React rejects outright ("rendered more hooks than during
  // the previous render", a blank screen). The actual drop logic needs board
  // state that is not in scope yet, so it goes through a ref assigned further
  // down, where `canDrop` and `playUnitCard` exist.
  const dropHandlerRef = useRef<(p: DragPayload, zoneId: string) => void>(() => {})
  const dnd = useDragDrop((p, zoneId) => dropHandlerRef.current(p, zoneId))

  /** The one target slot being filled right now — each spec eats `count` picks.
   *  Narrowing to it means only the units legal for *this* slot light up. */
  const currentTarget = useMemo(() => {
    if (!targeting) return null
    const slots = targeting.specs.filter(
      (s) => s.kind !== 'player' && s.kind !== 'self' && s.kind !== 'stackSpell',
    )
    const total = slots.reduce((n, s) => n + (s.count ?? 1), 0)
    let consumed = 0
    for (const spec of slots) {
      const c = spec.count ?? 1
      if (targeting.pickedUnits.length < consumed + c) {
        return { spec, nth: targeting.pickedUnits.length + 1, total, consumed }
      }
      consumed += c
    }
    return null
  }, [targeting])

  const legalTargetIds = useMemo(() => {
    const spec = currentTarget?.spec
    if (!spec || !targeting) return new Set<string>()
    const ids = new Set<string>()
    if (spec.kind === 'gear' || spec.kind === 'friendlyGear' || spec.kind === 'otherGear') {
      for (const g of legalGearTargets(state, 'player', spec)) ids.add(g.instanceId)
    } else {
      // 811.1.d.2 — a card played from Hidden chooses only from the
      // battlefield it was hidden at, so highlight only those. Offering a unit
      // the engine will refuse is worse than not offering it.
      for (const u of legalUnitTargets(state, 'player', spec, undefined, targeting.fromFacedown))
        ids.add(u.instanceId)
    }
    // Keep already-picked ids clickable so a mis-pick can be undone.
    for (const id of targeting.pickedUnits) ids.add(id)
    return ids
  }, [currentTarget, targeting, state])

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

  /** Which gear is attached to which unit, so a unit can show what it carries. */
  const gearByUnit = useMemo(() => {
    const m = new Map<string, GearInPlay[]>()
    for (const g of [...player.gear, ...ai.gear]) {
      if (!g.attachedTo) continue
      const list = m.get(g.attachedTo)
      if (list) list.push(g)
      else m.set(g.attachedTo, [g])
    }
    return m
  }, [player.gear, ai.gear])

  /**
   * The equipped unit currently under the pointer — set by hovering *either*
   * the unit or a gear attached to it, so the pair highlights together and the
   * connector line knows what to draw.
   */
  const [linkedUnit, setLinkedUnit] = useState<string | null>(null)


  const focusCard: Card | null =
    targeting?.card ??
    selectedCard ??
    selectedUnitObj?.card ??
    selectedGearObj?.card ??
    hovered ??
    null

  /**
   * Why a unit's Might is what it is.
   *
   * The attacker and defender sums share most of their terms, so they are
   * merged into one list and each row is tagged with the role(s) it applies to.
   * Every term comes from `mightBreakdown`, which `roleMight` sums — so this
   * panel cannot drift from the number the engine actually fights with.
   */
  const focusMight = useMemo(() => {
    const u = selectedUnitObj ?? hoveredUnit
    if (!u) return null
    const atk = mightBreakdown(state, u, 'attacker')
    const def = mightBreakdown(state, u, 'defender')
    const id = (term: MightTerm) => term.key + JSON.stringify(term.vars ?? {}) + term.n
    const defIds = new Set(def.map(id))
    const atkIds = new Set(atk.map(id))
    const rows = [
      ...atk.map((tm) => ({ ...tm, both: defIds.has(id(tm)), role: 'attacker' as const })),
      ...def.filter((tm) => !atkIds.has(id(tm))).map((tm) => ({ ...tm, both: false, role: 'defender' as const })),
    ]
    return {
      rows,
      attack: showdownMight(state, u, 'attacker'),
      defend: showdownMight(state, u, 'defender'),
      // Damage to kill it right now — the number that surprised people most.
      lethal: lethalMight(u, state, combatRoleOf(state, u)),
      stunned: (u.counters.stunned ?? 0) > 0,
    }
  }, [state, selectedUnitObj, hoveredUnit])

  const focusStatuses = useMemo(
    () =>
      selectedUnitObj
        ? unitStatuses(selectedUnitObj, t)
        : selectedGearObj
          ? gearStatuses(selectedGearObj, t)
          : [],
    [selectedUnitObj, selectedGearObj, t],
  )

  // ── Mulligan ────────────────────────────────────────────────────────────
  if (state.phase === 'mulligan' && !player.mulliganDone) {
    const toggle = (i: number) =>
      setMulliganPicks((p) =>
        p.includes(i) ? p.filter((x) => x !== i) : p.length < 2 ? [...p, i] : p,
      )
    return (
      <div className="board-root min-h-screen bg-board text-white flex flex-col items-center justify-center p-6">
        <h2 className="display-face text-3xl text-accent mb-1">{t('mull.title')}</h2>
        <p className="hud-label normal-case tracking-normal mb-6">
          {t('mull.subtitle')}
        </p>
        <div className="flex flex-wrap gap-3 justify-center max-w-3xl mb-8">
          {player.hand.map((c, i) => (
            <button
              key={`${c.id}-${i}`}
              onClick={() => toggle(i)}
              className={clsx(
                'w-32 border transition-transform',
                mulliganPicks.includes(i)
                  ? 'border-danger -translate-y-2'
                  : 'border-line hover:border-accent',
              )}
            >
              <CardArt card={c} />
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <Btn
            onClick={() =>
              act(dispatch(state, { type: 'MULLIGAN', cardIndices: mulliganPicks }, 'player'))
            }
            disabled={mulliganPicks.length === 0}
          >
            {t('mull.mulligan')} {mulliganPicks.length > 0 ? `(${mulliganPicks.length})` : ''}
          </Btn>
          <Btn variant="primary" onClick={() => act(dispatch(state, { type: 'KEEP_HAND' }, 'player'))}>
            {t('mull.keep')}
          </Btn>
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
        ? {
            type: 'PLAY_GEAR',
            card: t.card,
            targetInstanceIds: t.pickedUnits,
            fromFacedown: t.fromFacedown,
          }
        : {
            type: 'PLAY_SPELL',
            card: t.card,
            targetInstanceIds: t.pickedUnits,
            targetStackId: t.pickedStack,
            paidAdditional: t.paidAdditional,
            paidRepeat: t.paidRepeat,
            fromFacedown: t.fromFacedown,
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
    const picks = targeting.pickedUnits
    // Picks before `consumed` belong to target slots that are already filled.
    const from = currentTarget?.consumed ?? 0
    const inThisSlot = picks.slice(from)
    const picked = inThisSlot.includes(instanceId)
      ? // The same unit twice inside one "choose N" instruction isn't legal, so
        // a second click there un-picks it.
        picks.filter((x, i) => !(i >= from && x === instanceId))
      : // A *different* instruction may name the same unit again (Defiant Dance
        // can buff and debuff the same unit) — the engine resolves picks slot by
        // slot and never dedupes, so append instead of toggling the earlier one off.
        [...picks, instanceId]
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
  const repeatOpt = playOpts.find((o) => o.id === 'repeat')
  const activeOpt = accelerateOpt ?? additionalOpt ?? repeatOpt
  // Ask the engine what the play would cost rather than re-deriving it here —
  // the old version used the *printed* energy and ignored the card's own rune
  // pips, so the toggle enabled plays that were then refused.
  const canAffordExtra =
    !!activeOpt &&
    !!selectedCard &&
    canAfford(state, 'player', totalPlayCost(state, 'player', selectedCard, [activeOpt])) &&
    player.hand.filter((c) => c !== selectedCard).length >= activeOpt.extraDiscard

  // A selected spell/gear is armed but not cast until the Cast button.
  const castArmed =
    !!selectedCard && selectedCard.type !== 'unit' && myPriority && !targeting

  /**
   * Battlefields whose facedown card I could play right now. A facedown card has
   * Reaction (811.6), so this is live in a response window on the opponent's
   * turn too — which is exactly when you want to spring it, and exactly when a
   * 36px card back tucked in a panel corner is easiest to miss.
   */
  const playableFacedown = state.battlefields
    .filter((bf) => {
      const fd = bf.facedown
      if (fd?.owner !== 'player' || !canPlayFromFacedown(state, 'player', bf.index).ok) return false
      // 811.1.d — a spell with no legal target at that battlefield cannot be
      // played from Hidden. `canPlay` owns that rule; asking it here keeps the
      // button from offering a play the engine would refuse.
      const to =
        fd.card.type === 'unit' ? ({ kind: 'battlefield', index: bf.index } as const) : undefined
      return canPlay(state, 'player', fd.card, to, bf.index).ok
    })
    .map((bf) => bf.index)

  /**
   * Battlefields the selected card could be hidden at right now (811.1.b).
   * Deliberately *not* a `useMemo`: this sits below an early return, so a hook
   * here is a Rules-of-Hooks violation that crashes the board the moment the
   * branch above it is taken. There are only ever two battlefields to filter.
   */
  const hideableAt =
    selectedCard && !targeting
      ? state.battlefields
          .filter((bf) => canHide(state, 'player', selectedCard, bf.index).ok)
          .map((bf) => bf.index)
      : []

  /**
   * Play the card hidden at `index` — free, Reaction-timed (811.6). A hidden
   * permanent must enter at its own battlefield (811.1.d.1), including gear,
   * which is the one case gear does not go to base.
   */
  function playFacedown(index: number) {
    const fd = state.battlefields[index]?.facedown
    if (!fd || !canPlayFromFacedown(state, 'player', index).ok) return
    const card = fd.card
    if (card.type === 'unit') {
      send({ type: 'PLAY_UNIT', card, to: { kind: 'battlefield', index }, fromFacedown: index })
      return
    }
    const specs = scriptFor(card)?.play?.targets ?? []
    const t: Targeting = {
      card,
      isGear: card.type === 'gear',
      specs,
      pickedUnits: [],
      fromFacedown: index,
    }
    if (specs.length === 0) submitTargeting(t)
    else setTargeting(t)
  }

  function castSelected() {
    if (!selectedCard) return
    const specs = scriptFor(selectedCard)?.play?.targets ?? []
    const t: Targeting = {
      card: selectedCard,
      isGear: selectedCard.type === 'gear',
      specs,
      pickedUnits: [],
      paidAdditional: !!additionalOpt && acceleratePaid,
      paidRepeat: !!repeatOpt && acceleratePaid,
    }
    if (specs.length === 0) submitTargeting(t)
    else setTargeting(t)
  }

  /** Can `card` be put down at `index`? Zone legality, independent of selection. */
  const canDropCard = (card: Card | null, index: number | 'base') =>
    !!card &&
    card.type === 'unit' &&
    myPriority &&
    canPlay(state, 'player', card).ok &&
    (index === 'base' ||
      canPlaceUnitAt(state, 'player', card, { kind: 'battlefield', index }).ok)

  const canDropCardAt = (index: number | 'base') => canDropCard(selectedCard, index)

  function playUnitCard(
    card: Card,
    to: { kind: 'base' } | { kind: 'battlefield'; index: number },
  ) {
    send({
      type: 'PLAY_UNIT',
      card,
      to,
      paidAccelerate: !!accelerateOpt && acceleratePaid,
      paidAdditional: !!additionalOpt && acceleratePaid,
    })
  }

  function playSelectedUnit(to: { kind: 'base' } | { kind: 'battlefield'; index: number }) {
    if (!selectedCard) return
    playUnitCard(selectedCard, to)
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
  // ── Drag and drop ───────────────────────────────────────────────────────
  // Zone ids are "base" and "bf0" / "bf1"; `dropTargetFor` decides which of
  // them a given drag may actually land on, and the same predicate both lights
  // the zone up and gates the drop, so they can never disagree.
  /** The first unit-shaped target spec of a spell/gear, if it has one. */
  const unitSpecOf = (card: Card): TargetSpec | undefined =>
    (scriptFor(card)?.play?.targets ?? []).find(
      (s) => s.kind !== 'player' && s.kind !== 'self' && s.kind !== 'stackSpell',
    )

  /** Can `card` be cast by dropping it on the unit `instanceId`? */
  const canDropCardOnUnit = (card: Card, instanceId: string): boolean => {
    if (card.type === 'unit' || !myPriority) return false
    if (!canPlay(state, 'player', card).ok) return false
    const spec = unitSpecOf(card)
    if (!spec) return false
    return legalUnitTargets(state, 'player', spec).some((u) => u.instanceId === instanceId)
  }

  const canDrop = (payload: DragPayload, zone: string): boolean => {
    if (myChoice || targeting) return false
    // Dropping a spell or gear onto a unit casts it at that unit — the natural
    // gesture for equipping, and the reason "drag doesn't work" was a fair
    // report when only unit cards could be picked up at all.
    const unitId = parseUnitZoneId(zone)
    if (unitId) return payload.kind === 'card' && canDropCardOnUnit(payload.card, unitId)

    const to = parseZoneId(zone)
    if (!to) return false
    if (payload.kind === 'card') {
      return canDropCard(payload.card, to.kind === 'base' ? 'base' : to.index)
    }
    return myPriority && canMove(state, 'player', payload.instanceId, to).ok
  }

  /** Cast `card` with `instanceId` pre-picked; multi-target cards open the picker. */
  function castCardAtUnit(card: Card, instanceId: string) {
    const specs = scriptFor(card)?.play?.targets ?? []
    tryAutoSubmit({
      card,
      isGear: card.type === 'gear',
      specs,
      pickedUnits: [instanceId],
      paidAdditional: !!additionalOpt && acceleratePaid,
      paidRepeat: !!repeatOpt && acceleratePaid,
    })
  }

  dropHandlerRef.current = (payload, zone) => {
    if (!canDrop(payload, zone)) return
    const onUnit = parseUnitZoneId(zone)
    if (onUnit && payload.kind === 'card') {
      castCardAtUnit(payload.card, onUnit)
      setSelectedCard(null)
      setSelectedUnit(null)
      return
    }
    const to = parseZoneId(zone)!
    if (payload.kind === 'card') playUnitCard(payload.card, to)
    else send({ type: 'MOVE_UNIT', instanceId: payload.instanceId, to })
    // The gesture is the whole interaction — don't leave a selection behind it.
    setSelectedCard(null)
    setSelectedUnit(null)
  }

  const BASE_ZONE = zoneId({ kind: 'base' })
  const DROP_ZONES = [
    BASE_ZONE,
    ...state.battlefields.map((bf) => zoneId({ kind: 'battlefield', index: bf.index })),
  ]

  /** Is this zone a legal destination for the drag in flight? */
  const dragTargets = (zoneId: string) => !!dnd.drag && canDrop(dnd.drag.payload, zoneId)

  /** Worth starting a drag at all? A gesture with nowhere legal to land just
   *  lifts the card and puts it back, which reads as the feature being broken
   *  rather than the move being illegal. */
  const anyDropZone = (payload: DragPayload) =>
    DROP_ZONES.some((z) => canDrop(payload, z)) ||
    (payload.kind === 'card' &&
      allUnits(state).some((u) => canDropCardOnUnit(payload.card, u.instanceId)))

  const cardDragProps = (card: Card) =>
    dnd.handleProps({ kind: 'card', card }, anyDropZone({ kind: 'card', card }))

  const unitDragProps = (u: UnitInPlay) => {
    const payload: DragPayload = { kind: 'unit', instanceId: u.instanceId, card: u.card }
    return dnd.handleProps(payload, anyDropZone(payload))
  }
  /** Drop-zone props + highlight state for one unit tile. */
  const unitDropProps = (u: UnitInPlay) => {
    const zone = unitZoneId(u.instanceId)
    const ok = !!dnd.drag && canDrop(dnd.drag.payload, zone)
    return {
      dropZone: dnd.zoneProps(zone, ok),
      dropOk: ok,
      dropHot: ok && dnd.drag?.over === zone,
    }
  }

  /** The hand card currently in flight, so the original can be dimmed. */
  const draggingCard = dnd.drag?.payload.kind === 'card' ? dnd.drag.payload.card : null
  const draggingUnitId = dnd.drag?.payload.kind === 'unit' ? dnd.drag.payload.instanceId : null

  function onUnitClick(u: UnitInPlay) {
    if (dnd.consumeClick()) return
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

  const myContestedBfs = state.battlefields
    .filter((bf) => controllerOf(bf) === 'contested' && unitsAt(bf, 'player').length > 0)
    .map((bf) => bf.index)
  const iContestSomewhere = myContestedBfs.length > 0

  // A prominent banner whenever the game is waiting on the player for something
  // other than "take your turn" — so a bare Pass / prompt never feels cryptic.
  // What the current target slot is for — "Choose an enemy unit to deal 3 damage".
  const targetPrompt = currentTarget
    ? t('notice.choose', { what: t(targetKindKey(currentTarget.spec.kind)) }) +
      (currentTarget.spec.label ? ` ${labelKo(currentTarget.spec.label, 'target')}` : '')
    : null
  // Hand-written card scripts don't tag intent, so fall back to the spec kind:
  // picking your own unit is (almost always) good for it, an enemy's is not.
  const targetTone: 'buff' | 'harm' | 'neutral' =
    currentTarget?.spec.intent ??
    (currentTarget?.spec.kind === 'friendlyUnit'
      ? 'buff'
      : currentTarget?.spec.kind === 'enemyUnit'
        ? 'harm'
        : 'neutral')

  // Deflect makes chosen enemy units cost extra Power — surface it while picking
  // so a cast can't dead-end on "not enough" after you've committed targets.
  // (Plain computation, not a hook: this sits after the mulligan early return.)
  const deflectDue = targeting
    ? targeting.pickedUnits.reduce((n, id) => {
        const u = [...player.base, ...ai.base, ...state.battlefields.flatMap((b) => b.units)].find(
          (x) => x.instanceId === id,
        )
        return n + (u ? deflectSurcharge(u, 'player') : 0)
      }, 0)
    : 0

  const topStack = state.stack[state.stack.length - 1]
  const notice: {
    tone: 'respond' | 'act' | 'wait'
    title: string
    body: string
    /** The stack item this prompt is about, so the popup can explain it. */
    stack?: StackItem
  } | null = targeting
    ? {
        tone: 'act',
        title: currentTarget
          ? t('notice.targetOf', {
              name: targeting.card.name,
              n: currentTarget.nth,
              total: currentTarget.total,
            })
          : t('notice.confirmTargets', { name: targeting.card.name }),
        body:
          (targetPrompt
            ? `${targetPrompt}. ${t(
                targetTone === 'buff'
                  ? 'notice.greenRing'
                  : targetTone === 'harm'
                    ? 'notice.redRing'
                    : 'notice.anyRing',
              )}`
            : t('notice.pickStack')) +
          (deflectDue > 0
            ? t('notice.deflect', {
                n: deflectDue,
                energy: player.runes.energy,
                power: player.runes.power,
              })
            : ''),
      }
    : assigningDamage
      ? {
          tone: 'act',
          title: t('notice.assignTitle'),
          body: t('notice.assignBody'),
        }
      : myChoice
        ? myChoice.kind === 'unit'
          ? {
              tone: 'act',
              title: t('notice.chooseUnitTitle'),
              body: t('notice.chooseUnitBody', { label: labelKo(myChoice.label, 'choice') }),
            }
          : // Every other choice kind (a card in hand, the trash, a keyword, a
            // confirm) used to raise no banner at all — its prompt lived only in
            // the modal, so a player looking at the board saw a frozen game.
            { tone: 'act', title: t('notice.chooseTitle'), body: labelKo(myChoice.label, 'choice') }
        : responding && state.pendingShowdown
          ? {
              tone: 'respond',
              title: t('notice.showdownOpen', { n: state.pendingShowdown.index + 1 }),
              body: t('notice.showdownBody'),
            }
          : responding && topStack
            ? {
                tone: 'respond',
                title: t('notice.onStack', {
                  who: t(topStack.controller === 'ai' ? 'notice.onStackTheirs' : 'notice.onStackYours'),
                  name: topStack.card?.name ?? 'ability',
                }),
                body: t('notice.onStackBody'),
                stack: topStack,
              }
            : cleanTurn && iContestSomewhere
              ? {
                  tone: 'act',
                  title: t('notice.undeclaredTitle'),
                  body: t('notice.undeclaredBody'),
                }
              : null

  /**
   * True while the game cannot advance until the player does something. Drives
   * both the top banner and the board-edge glow — one flag, so the two can
   * never disagree about whether you're being waited on.
   */
  const awaitingMe = !!notice || !!myChoice || assigningDamage

  /**
   * These states already put a real modal on screen (`ChoiceModal`,
   * `DamageModal` — both z-50 with their own backdrop), so the popup would only
   * sit behind it as a dark smudge. A unit choice is the exception: you answer
   * it by clicking the board, so it has no modal and does need the popup.
   */
  const ownModalOpen = (!!myChoice && myChoice.kind !== 'unit') || assigningDamage

  // ── The centre-stage briefing: "here is what just happened" ─────────────
  // A fresh showdown report and/or a recap of the AI's turn. Hidden while the
  // game is actively waiting on the player for a pick or damage assignment.
  const freshShowdown =
    state.lastShowdown && state.lastShowdown.seq !== seenShowdown ? state.lastShowdown : null
  // The briefing is now *only* the post-combat readout — the AI's ordinary
  // actions stream past as toasts instead of piling into a modal.
  const showBriefing =
    !aiThinking && !myChoice && !assigningDamage && !pinned && !!freshShowdown
  const dismissBriefing = () => {
    setSeenShowdown(state.lastShowdown?.seq ?? 0)
  }

  /**
   * The one-line answer to "what am I supposed to do now?".
   *
   * Deliberately phrased around the *goal* (score points) rather than the
   * mechanic — the board already shows the mechanics, and never said what any
   * of them were for. Only used as the idle fallback: an active prompt (a
   * choice, targeting, a selected card) always outranks it.
   */
  const nextAction = ((): string => {
    if (state.phase === 'mulligan') return t('next.mulligan')
    if (assigningDamage) return t('next.assign')
    // `responding` has to outrank the AI-turn check: holding priority over the
    // AI's spell means it *is* your move, even though it is the AI's turn.
    if (responding) return t(state.pendingShowdown ? 'hint.showdownReact' : 'hint.respondStack')
    if (aiThinking || state.activePlayer !== 'player') return t('next.aiTurn')
    if (!cleanTurn) return t('next.notYou')
    if (iContestSomewhere) {
      return t('next.declare', { name: state.battlefields[myContestedBfs[0]].name })
    }
    // A battlefield I don't already hold and could legally move a unit to right
    // now — asking `canMove` rather than guessing keeps the advice honest when
    // every unit is exhausted.
    const takeable = state.battlefields.find(
      (bf) =>
        controllerOf(bf) !== 'player' &&
        player.base.some(
          (u) =>
            canMove(state, 'player', u.instanceId, { kind: 'battlefield', index: bf.index }).ok,
        ),
    )
    if (takeable) return t('next.take', { name: takeable.name })
    if (state.battlefields.every((bf) => controllerOf(bf) === 'player')) return t('next.hold')
    return player.hand.some((c) => canPlay(state, 'player', c).ok)
      ? t('next.playCard')
      : t('next.endTurn')
  })()

  /**
   * Every legal move, enumerated.
   *
   * The board already knows all of this — each entry reuses the same check the
   * click path uses — but it is scattered across hand cards, unit tiles, panel
   * corners and the action bar. An action you cannot find is indistinguishable
   * from one the game will not let you make, which is how a whole keyword
   * (Hidden) ended up feeling broken.
   */
  const availableMoves: { key: string; label: string }[] = (() => {
    if (!myPriority && !myChoice && !assigningDamage) return []
    const out: { key: string; label: string }[] = []
    if (myChoice) out.push({ key: 'choice', label: labelKo(myChoice.label, 'choice') })
    if (assigningDamage) out.push({ key: 'damage', label: t('moves.assign') })

    for (const c of player.hand) {
      if (canPlay(state, 'player', c).ok) {
        out.push({ key: `play${c.id}`, label: t('moves.play', { name: c.name }) })
      }
      if (hasHidden(c) && state.battlefields.some((bf) => canHide(state, 'player', c, bf.index).ok)) {
        out.push({ key: `hide${c.id}`, label: t('moves.hide', { name: c.name }) })
      }
    }
    for (const i of playableFacedown) {
      out.push({ key: `fd${i}`, label: t('moves.playHidden', { name: state.battlefields[i].name }) })
    }
    for (const u of [...player.base, ...state.battlefields.flatMap((bf) => bf.units)]) {
      if (u.owner !== 'player') continue
      const dests = state.battlefields
        .filter((bf) => canMove(state, 'player', u.instanceId, { kind: 'battlefield', index: bf.index }).ok)
        .map((bf) => bf.name)
      if (dests.length) {
        out.push({
          key: `mv${u.instanceId}`,
          label: t('moves.move', { name: u.card.name, where: dests.join(', ') }),
        })
      }
    }
    for (const idx of myContestedBfs) {
      out.push({ key: `sd${idx}`, label: t('moves.declare', { name: state.battlefields[idx].name }) })
    }
    if (responding) out.push({ key: 'pass', label: t('moves.pass') })
    if (cleanTurn) {
      out.push({ key: 'recycle', label: t('moves.recycle') })
      out.push({ key: 'end', label: t('moves.end') })
    }
    return out
  })()

  const hint = myChoice
    ? labelKo(myChoice.label, 'choice')
    : targeting
      ? (targetPrompt ?? t('board.chooseTargetFor', { name: targeting.card.name }))
      : selectedCard
        ? selectedCard.type === 'unit'
          ? t('hint.playUnit', { name: selectedCard.name })
          : t('hint.castSpell', { name: selectedCard.name })
        : selectedUnit
          ? t('hint.movingUnit')
          : pinned
            ? t('hint.pinned')
            : nextAction

  return (
    <div
      className={clsx(
        'board-root bg-board text-white flex flex-col select-none text-sm',
        'h-screen overflow-hidden',
        'max-md:h-auto max-md:min-h-screen max-md:overflow-y-auto max-md:overflow-x-hidden',
        // The whole board breathes while the game is waiting on you, so
        // "something needs me" is readable in peripheral vision even when your
        // eye is on a card at the far side of the screen.
        awaitingMe && 'relative rb-awaiting',
      )}
      onMouseMove={(e) => {
        // Dock the preview opposite the pointer. `setState` with an unchanged
        // value bails out, so this does not re-render on every mouse move.
        const s = e.clientX > window.innerWidth / 2 ? 'left' : 'right'
        setPreviewSide((prev) => (prev === s ? prev : s))
      }}
    >
      {/* Big preview for whatever is in focus — selected/targeting wins, else hover. */}
      {!pinned && (
        <CenterPreview
          card={focusCard}
          unit={selectedUnitObj ?? hoveredUnit ?? undefined}
          statuses={focusStatuses}
          might={focusMight}
          side={previewSide}
        />
      )}

      {/* "AI is thinking" — centred so it's unmistakable whose move it is. */}
      <GearLinks unitId={linkedUnit} />

      {/* A quiet running commentary: every meaningful thing that happens shows
          up here for a few seconds and then leaves on its own. Nothing to
          dismiss, and it makes an AI response to your spell visible at the
          moment it happens rather than something to infer from the Pass button. */}
      <div className="fixed inset-x-0 top-14 z-40 flex flex-col items-center gap-1 pointer-events-none px-4 max-md:top-auto max-md:bottom-20">
        {aiThinking && (
          <div className="flex items-center gap-2.5 px-3.5 py-1.5 bg-panel/95 border border-danger/50 shadow-raised animate-[rb-fade_0.15s_ease-out] pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-danger animate-pulse shrink-0" />
            <span className="hud-label text-danger shrink-0">{t('turn.aiActing')}</span>
            {aiSpeed > 0 && (
              <button
                onClick={() => setState((s) => runAITurn(s))}
                className="shrink-0 px-2 py-0.5 text-micro border border-line text-txtDim hover:border-accent hover:text-accent"
              >
                {t('board.skipAiTurn')}
              </button>
            )}
          </div>
        )}
        {toasts.map((toast, i) => (
          <ActionToast
            key={toast.id}
            text={toast.text}
            // Older toasts fade back so the newest reads first.
            dim={i < toasts.length - 1}
          />
        ))}
      </div>

      {/* Centre-stage briefing — what just happened, front and centre. */}
      {showBriefing && (
        <BriefingPanel
          showdown={freshShowdown}
          mySide="player"
          onDismiss={dismissBriefing}
          onHover={setHovered}
        />
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
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 animate-[rb-fade_0.2s_ease-out]">
          <div
            className={clsx(
              'bg-panel border-2 p-10 text-center animate-[rb-pop_0.35s_ease-out]',
              state.winner === 'player' ? 'border-gold shadow-raised' : 'border-danger',
            )}
          >
            <h2
              className={clsx(
                'display-face text-4xl mb-2',
                state.winner === 'player' ? 'text-gold' : 'text-danger',
              )}
            >
              {t(state.winner === 'player' ? 'over.victory' : 'over.defeat')}
            </h2>
            <p className="hud-label normal-case tracking-normal mb-6">
              {t('over.finalScore', { you: player.points, ai: ai.points })}
            </p>
            <button
              onClick={onExit}
              className="px-6 py-2 border border-line text-txt display-face text-sm transition-all duration-200 ease-calm hover:border-accent hover:text-accent"
            >
              {t('over.mainMenu')}
            </button>
          </div>
        </div>
      )}

      {/* Pick modal — card zones, or a plain keyword list */}
      {myChoice && myChoice.kind !== 'unit' && (
        <ChoiceModal
          choice={myChoice}
          textOptions={
            myChoice.kind === 'keyword'
              ? myChoice.legalIds
              : myChoice.kind === 'location' ||
                  myChoice.kind === 'confirm' ||
                  myChoice.kind === 'permanent'
                ? (myChoice.optionLabels ?? myChoice.legalIds)
                : undefined
          }
          optionValues={
            myChoice.kind === 'location' ||
            myChoice.kind === 'confirm' ||
            myChoice.kind === 'permanent'
              ? myChoice.legalIds
              : undefined
          }
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
      <div className="flex items-center gap-4 px-4 py-2 bg-panel border-b border-line shrink-0 max-md:gap-2 max-md:px-2 max-md:flex-wrap">
        <button onClick={onExit} className="hud-label hover:text-accent">
          {t('board.exit')}
        </button>
        <div className="min-w-0">
          <div className="display-face text-sm text-txt truncate">{player.legend.name}</div>
          <div className="text-tiny text-txtDim">
            {t('board.deckLine', {
              name: player.legend.name.split(/[ ,–-]/)[0],
              n: player.mainDeck.length + player.hand.length,
            })}
          </div>
        </div>
        <span
          className={clsx(
            'hud-label',
            aiThinking ? 'text-txtDim' : state.activePlayer === 'player' ? 'text-accent' : 'text-txtDim',
          )}
        >
          {aiThinking ? 'AI…' : turnChip} · {t('board.round', { n: state.round })}
        </span>
        <div className="flex-1" />
        {/* How fast the AI's turn plays back. */}
        <div className="flex items-center gap-1 shrink-0" title={t('speed.label')}>
          <span className="hud-label">{t('speed.label')}</span>
          {AI_SPEEDS.map((s) => (
            <button
              key={s.ms}
              onClick={() => changeAiSpeed(s.ms)}
              aria-pressed={aiSpeed === s.ms}
              className={clsx(
                'px-1.5 py-0.5 text-micro font-bold border transition-colors',
                aiSpeed === s.ms
                  ? 'border-accent text-accent'
                  : 'border-line text-txtFaint hover:text-txt',
              )}
            >
              {t(s.key)}
            </button>
          ))}
        </div>
        {/* No score chip here — the objective bar below owns the score, and
            showing it twice made neither one feel authoritative. */}
        <Chip
          label={t('board.energy')}
          value={`${player.runes.energy} / ${player.runes.channeled.length}`}
        />
      </div>

      {/* What you're playing for — win condition, both scores, who holds what. */}
      <ObjectiveBar state={state} target={8} />

      {/* The card in flight, following the pointer.

          z-[80] puts it above every layer in the stack documented below — a
          dragged card that slid *under* the board would be worse than no drag
          at all. `pointer-events-none` is load-bearing, not decoration: hit
          testing is `document.elementFromPoint`, so a ghost that accepted
          input would sit between the cursor and every drop zone and the card
          could never be dropped anywhere. */}
      {dnd.drag && (
        <div
          className="fixed z-[80] pointer-events-none w-[var(--card-w)] -translate-x-1/2 -translate-y-1/2 opacity-90 drop-shadow-[0_8px_20px_rgba(0,0,0,0.6)]"
          style={{ left: dnd.drag.x, top: dnd.drag.y }}
        >
          <div
            className={clsx(
              'border-2 bg-panel2 rotate-3',
              dnd.drag.over ? 'border-accentBright' : 'border-accent/70',
            )}
          >
            <CardArt card={dnd.drag.payload.card} size="sm" preview={false} />
          </div>
        </div>
      )}

      {/* ACTION-REQUIRED popup — centre of the screen, because a prompt in a
          bar at the edge reads as decoration and gets skipped.

          Two things make this safe to put over the board:
          • The wrapper and the card body are `pointer-events-none`, so clicks
            fall straight through to the units underneath. Only the buttons take
            input. Targeting still works with the popup sitting on top of it.
          • z-[46] parks it above the board (z-10..30), the gear-link overlay
            (z-45) and the post-combat briefing (z-40) — the required action
            outranks a recap — but *below* the real modals at z-50, the card
            previews at z-60/65 and the glossary tooltip at z-70. Anything that
            raises this above 50 will start covering the choice modal it is
            asking you to answer. */}
      {notice && !ownModalOpen && (
        <div className="fixed inset-0 z-[46] flex items-center justify-center pointer-events-none">
          <div
            key={notice.title}
            className={clsx(
              // Opaque, with a wide soft shadow instead of a full-screen scrim:
              // a scrim would dim the very units it is asking you to click.
              'pointer-events-none w-[min(560px,90vw)] border-2 bg-panel',
              'shadow-[0_18px_60px_-4px_rgba(0,0,0,0.95)]',
              'px-5 py-4 flex flex-col gap-3 animate-[rb-pop_0.22s_ease-out]',
              notice.tone === 'respond' ? 'border-gold' : 'border-accent',
            )}
          >
            <span
              className={clsx(
                'flex items-center gap-1.5 hud-label',
                notice.tone === 'respond' ? 'text-gold' : 'text-accent',
              )}
            >
              <span
                className="w-2 h-2 rounded-full bg-current animate-[rb-dot_1.2s_ease-in-out_infinite]"
                aria-hidden
              />
              {t('notice.waiting')}
            </span>
            <div className="min-w-0">
              <div className="display-face text-base text-txt leading-tight">{notice.title}</div>
              <div className="text-xs text-txtDim leading-snug mt-1">{notice.body}</div>
            </div>
            {/* What the thing on the stack actually does. Naming the card and
                asking "respond or pass?" is only a fair question if you can see
                what you would be responding to — the popup is pointer-events:
                none, so hovering the board behind it was not an option. */}
            {notice.stack && <StackEffect item={notice.stack} state={state} />}
            <div className="flex justify-end gap-2 pointer-events-auto">
            {targeting && (
              <div className="flex gap-2 shrink-0">
                {targeting.specs.some((s) => s.optional) && (
                  <Btn onClick={() => submitTargeting(targeting)}>{t('common.done')}</Btn>
                )}
                <Btn onClick={() => setTargeting(null)}>{t('common.cancel')}</Btn>
              </div>
            )}
            {!targeting &&
              playableFacedown.map((i) => (
                <Btn key={`fd${i}`} onClick={() => playFacedown(i)} title={t('hidden.playTip')}>
                  {t('hidden.playFrom', { name: state.battlefields[i].name })}
                </Btn>
              ))}
            {!targeting && responding && (
              <Btn variant="primary" onClick={() => send({ type: 'PASS_PRIORITY' })}>
                {t('board.pass')}
              </Btn>
            )}
            {!targeting && cleanTurn && iContestSomewhere && !responding && (
              <div className="flex gap-2 shrink-0">
                {myContestedBfs.map((idx) => {
                  const f = forecastShowdown(state, idx, 'player')
                  return (
                    <Btn
                      key={idx}
                      variant="primary"
                      onClick={() => send({ type: 'DECLARE_SHOWDOWN', index: idx })}
                    >
                      {t('notice.declareAt', { n: idx + 1 })}
                      {f ? ` · ${f.attackerMight} vs ${f.defenderMight}` : ''}
                    </Btn>
                  )
                })}
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Middle: battlefields + cast lane + base. The old left score rail
          lived here; it repeated the objective bar's numbers and cost 72px of
          width on a layout that was already too spread out. */}
      {/* The play area: board, playmat and hand.

          This exists so the hand can float. The hand is positioned against
          *this* box rather than the whole screen, so it overlays the board
          and reclaims that height, while the MOVES panel and the action bar
          below stay in normal flow and are never covered by it. */}
      <div className="relative flex flex-1 min-h-0 flex-col">
        <div className="flex flex-1 min-h-0 max-md:flex-col">
          <div className="flex-1 min-w-0 flex flex-col">
            {/* AI mini-playmat — legend/champion, hand/deck counts, what it has played */}
            <div className="px-4 py-1.5 border-b border-line bg-panel min-h-[56px] flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <div
                  className={clsx('w-[var(--rune-w)] border', ai.legendEmpowered ? 'border-gold' : 'border-gold/30')}
                  onMouseEnter={() => setHovered(ai.legend)}
                  onMouseLeave={() => setHovered((h) => (h === ai.legend ? null : h))}
                  title={t('board.aiLegend', { name: ai.legend.name })}
                >
                  <CardArt card={ai.legend} size="sm" badge={false} />
                </div>
                <div
                  className={clsx('w-[var(--rune-w)] border border-line', ai.championPlayed && 'opacity-40')}
                  onMouseEnter={() => setHovered(ai.chosenChampion)}
                  onMouseLeave={() => setHovered((h) => (h === ai.chosenChampion ? null : h))}
                  title={
                    t('board.aiChampion', { name: ai.chosenChampion.name }) +
                    (ai.championPlayed ? t('board.inPlaySuffix') : '')
                  }
                >
                  <CardArt card={ai.chosenChampion} size="sm" preview={false} badge={false} />
                </div>
              </div>
              <div className="flex flex-col gap-0.5 shrink-0 tabular-nums text-micro text-txtDim">
                <span className="hud-label text-danger/80">AI</span>
                <button
                  onClick={() => setPilesSide('ai')}
                  className="hover:text-accent text-left"
                  title={t('board.viewAiPiles')}
                >
                  ✋ {ai.hand.length} · 📚 {ai.mainDeck.length} · 🗑 {ai.trash.length}
                  {ai.banished.length > 0 && ` · ⚰ ${ai.banished.length}`}
                </button>
                {/* What the AI can spend. Channeled runes and the Rune Pool are
                    public information (165), and without them on screen there
                    is no way to judge whether an attack will be answered — you
                    cannot plan around a reaction you cannot see coming. */}
                <span className="flex items-center gap-1" title={t('board.aiRunesTip')}>
                  <span className="text-accent">⚡{ai.runes.energy}</span>
                  <span className="text-txtFaint">/</span>
                  <span>🜲{ai.runes.channeled.length}</span>
                  {ai.runes.power > 0 && <span className="text-gold">◈{ai.runes.power}</span>}
                </span>
              </div>
              <div className="w-px self-stretch bg-line mx-1 shrink-0" />
              <span className="hud-label shrink-0">{t('board.plays')}</span>
              <div className="flex gap-1.5 flex-wrap flex-1 min-w-0">
                {ai.base.map((u) => (
                  <BoardUnit
                    key={u.instanceId}
                    unit={u}
                    side="ai"
                    attachedGear={gearByUnit.get(u.instanceId)}
                    linked={linkedUnit === u.instanceId}
                    onLink={setLinkedUnit}
                    onHover={setHovered}
                    onHoverUnit={setHoveredUnit}
                    changed={changedIds.has(u.instanceId)}
                  />
                ))}
                {ai.base.length === 0 && (
                  <span className="text-txtFaint text-micro">{t('board.idle')}</span>
                )}
              </div>
            </div>

            <div className="flex-1 flex items-stretch justify-center gap-[clamp(0.75rem,2.2vw,3rem)] px-[clamp(1rem,3vw,4rem)] min-h-[clamp(150px,24vh,340px)] max-h-[clamp(170px,36vh,380px)] py-2 max-md:flex-col max-md:max-h-none max-md:px-3 max-md:gap-3">
              {state.battlefields.map((bf) => {
                const control = controllerOf(bf)
                const dropCard = canDropCardAt(bf.index)
                const dropMove = !!selectedUnit && myPriority
                const droppable = (dropCard || dropMove) && !myChoice
                const zone = zoneId({ kind: 'battlefield', index: bf.index })
                const dragOk = dragTargets(zone)
                const dragHot = dragOk && dnd.drag?.over === zone
                return (
                  <div
                    key={bf.index}
                    {...dnd.zoneProps(zone, dragOk)}
                    className={clsx(
                      'relative flex-1 max-w-[46rem] h-full border-2 overflow-hidden bg-panel',
                    'max-md:h-auto max-md:min-h-[132px] max-md:max-w-none',
                      // Who holds this is the single most important fact about a
                      // battlefield, so it owns the frame — not a small pill in a
                      // corner competing with the artwork.
                      dragHot
                        ? 'border-accentBright ring-2 ring-accentBright/70 scale-[1.015]'
                        : dragOk
                          ? 'border-accent border-dashed'
                          : droppable
                            ? 'border-accent cursor-pointer'
                            : control === 'player'
                              ? 'border-accent/70'
                              : control === 'ai'
                                ? 'border-danger/70'
                                : control === 'contested'
                                  ? 'border-gold rb-contested'
                                  : 'border-line',
                      // A drag in flight that this zone cannot take steps back so
                      // the legal ones read at a glance.
                      dnd.drag && !dragOk && 'opacity-55',
                    )}
                    onClick={() => {
                      if (dnd.consumeClick()) return
                      if (droppable) onBattlefieldClick(bf.index)
                    }}
                  >
                    {/* Battlefield art fills the whole panel so units have room to breathe */}
                    {bf.card?.imageUrl && (
                      <img
                        src={bf.card.imageUrl}
                        alt={bf.name}
                        className="absolute inset-0 w-full h-full object-cover object-[50%_28%] scale-[1.5] opacity-[0.72] saturate-[0.9]"
                      />
                    )}
                    {/* The art is scenery; the holder, the units and the effect are
                        the game. The scrim darkens the two bands where text sits and
                        lets the middle of the picture breathe. */}
                    <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.80)_0%,rgba(0,0,0,0.16)_34%,rgba(0,0,0,0.30)_58%,rgba(0,0,0,0.93)_84%)]" />
                    {droppable && <div className="absolute inset-0 ring-2 ring-inset ring-accent bg-accent/5" />}

                    {/* Pre-fight maths, both directions (roles change the numbers) */}
                    <CombatPreview
                      ifIAttack={forecastShowdown(state, bf.index, 'player')}
                      ifTheyAttack={forecastShowdown(state, bf.index, 'ai')}
                    />

                    {/* Name + control badge */}
                    <div className="absolute inset-x-0 top-0 z-20 px-3 py-1.5 flex items-center justify-between gap-2 bg-black/75 border-b border-line/60">
                      <span className="flex items-baseline gap-2 min-w-0">
                        <span className="hud-label text-txtFaint shrink-0">
                          {t('board.battlefieldN', { n: bf.index + 1 })}
                        </span>
                        <span className="display-face text-sm text-txt truncate">{bf.name}</span>
                      </span>
                      <span
                        key={control}
                        className={clsx(
                          'hud-label px-2 py-1 shrink-0 border flex items-center gap-1.5 animate-[rb-flash_0.6s_ease-out]',
                          control === 'player' && 'border-accent text-accent bg-accent/15',
                          control === 'ai' && 'border-danger text-danger bg-danger/15',
                          control === 'contested' && 'border-gold text-gold bg-gold/15',
                          control === 'open' && 'border-line text-txtDim',
                        )}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                        {t(
                          control === 'player'
                            ? 'board.youHold'
                            : control === 'ai'
                              ? 'board.aiHolds'
                              : control === 'contested'
                                ? 'board.contested'
                                : 'board.open',
                        )}
                      </span>
                    </div>

                    {/* Enemy units — float in the top half, pressing down */}
                    <div className="absolute inset-x-0 top-9 z-10">
                      <span className="hud-label text-danger/80 px-2">{t('board.enemy')}</span>
                      <UnitZone
                        units={unitsAt(bf, 'ai')}
                        side="ai"
                        dropPropsFor={unitDropProps}
                        onUnitClick={onUnitClick}
                        highlightIds={highlightIds}
                        targetTone={targetTone}
                        gearByUnit={gearByUnit}
                        linkedUnit={linkedUnit}
                        onLink={setLinkedUnit}
                            onHover={setHovered}
                        onHoverUnit={setHoveredUnit}
                        changedIds={changedIds}
                      />
                    </div>

                    {/* Your units — float in the bottom half, above the rules text.
                        The Declare-Showdown control lives in the notice banner, not
                        here, so it's never buried in a short panel. */}
                    <div className="absolute inset-x-0 bottom-11 z-10">
                      <span className="hud-label text-accent/80 px-2">{t('board.you')}</span>
                      <UnitZone
                        units={unitsAt(bf, 'player')}
                        side="player"
                        selectedUnit={selectedUnit}
                        onUnitClick={onUnitClick}
                        highlightIds={highlightIds}
                        targetTone={targetTone}
                        gearByUnit={gearByUnit}
                        linkedUnit={linkedUnit}
                        onLink={setLinkedUnit}
                        onHover={setHovered}
                        onHoverUnit={setHoveredUnit}
                        changedIds={changedIds}
                        dragHandleFor={unitDragProps}
                        draggingUnitId={draggingUnitId}
                        dropPropsFor={unitDropProps}
                      />
                    </div>

                    {/* Facedown Zone (107.3). Only its owner sees the face; the
                        opponent's shows as an anonymous card back. */}
                    {bf.facedown && (
                      <FacedownSlot
                        fd={bf.facedown}
                        playable={canPlayFromFacedown(state, 'player', bf.index).ok}
                        onPlay={() => playFacedown(bf.index)}
                        onHover={setHovered}
                      />
                    )}

                    {/* Battlefield rules text — pinned to the bottom edge */}
                    {bf.card?.text && (
                      <div className="absolute inset-x-0 bottom-0 z-20 px-3 py-1.5 text-tiny text-txt leading-snug bg-black/85 border-t border-line/60">
                        <CardRulesText text={bf.card.text} />
                        <span className="ml-1 hud-label text-txtFaint">
                          {t(bf.contributor === 'player' ? 'board.byYou' : 'board.byAi')}
                        </span>
                      </div>
                    )}
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

          {/* Right rail: the activity log, and nothing else. The Rune Pool
              sat here for a while because the hand band was floating and the
              pool floated over the legend and champion with it. The band is
              back in normal flow, so the runes are back beside the hand they
              are spent on. */}
          <div className="flex flex-col min-h-0 shrink-0 overflow-hidden">
            <LogPanel
              log={state.log}
              expanded={logExpanded}
              onToggle={() => setLogExpanded((v) => !v)}
            />
          </div>
        </div>

        {/* Player playmat — legend · champion · base · gear.
            It grows into the space the floating hand used to leave empty: the
            base is where your units live and was the most cramped zone on the
            board. Units fill from the top, so they stay above the hand. */}
        <div className="flex items-start gap-2 px-3 py-1 bg-black/20 border-t border-line/50 shrink-0 grow-[0.28] max-h-[24vh] min-h-0 max-md:flex-wrap max-md:max-h-none max-md:gap-1.5">
          {/* Legend */}
          <div
            className="w-[var(--face-w)] shrink-0"
            onMouseEnter={() => setHovered(player.legend)}
            onMouseLeave={() => setHovered((h) => (h === player.legend ? null : h))}
          >
            <div className="hud-label mb-0.5 truncate text-micro">
              {t('board.legend')}
              {player.legendEmpowered && <span className="text-accent"> ⚡</span>}
            </div>
            <div
              className={clsx(
                'border-2',
                player.legendEmpowered ? 'border-gold shadow-glow' : 'border-gold/40',
              )}
            >
              <CardArt card={player.legend} size="sm" preview={false} badge={false} />
            </div>
            {myPriority &&
              myLegendAbils.map(({ ab, i }) => (
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
                  title={labelKo(ab.label)}
                  className="mt-0.5 w-full text-micro px-1 py-0.5 border border-accentDim text-accent hover:bg-accent hover:text-black truncate text-left"
                >
                  ⚡ {labelKo(ab.label)}
                </button>
              ))}
          </div>

          {/* Chosen Champion — lives in the Champion Zone; one click plays it to
              base any time on your turn once you can afford it. */}
          <button
            type="button"
            disabled={!myChampionCastable}
            onClick={() => {
              if (myChampion) send({ type: 'PLAY_UNIT', card: myChampion, to: { kind: 'base' } })
            }}
            onMouseEnter={() => setHovered(player.chosenChampion)}
            onMouseLeave={() => setHovered((h) => (h === player.chosenChampion ? null : h))}
            title={
              player.championPlayed
                ? t('board.champAlready', { name: player.chosenChampion.name })
                : myChampionCastable
                  ? t('board.champPlayTip', {
                      name: player.chosenChampion.name,
                      cost: championCostText,
                    })
                  : t('board.champCostTip', {
                      name: player.chosenChampion.name,
                      cost: championCostText,
                      have: player.runes.energy,
                    })
            }
            className={clsx(
              'w-[var(--face-w)] shrink-0 text-left border transition-colors',
              player.championPlayed
                ? 'opacity-40 border-line/60'
                : myChampionCastable
                  ? 'border-accent cursor-pointer animate-pulse'
                  : 'border-line/60 opacity-70',
            )}
          >
            <div className="hud-label mb-0.5 px-0.5 truncate text-micro">
              {player.championPlayed
                ? t('board.champIn')
                : myChampionCastable
                  ? t('board.champPlay')
                  : t('board.champCost', { n: player.chosenChampion.energy })}
            </div>
            <CardArt card={player.chosenChampion} size="sm" preview={false} badge={false} />
          </button>

          {/* Your Base — the drop target; grows with its contents, not the layout. */}
          <div
            {...dnd.zoneProps(BASE_ZONE, dragTargets(BASE_ZONE))}
            className={clsx(
              'flex-[3_1_0%] min-w-0 self-stretch border border-l-[3px] border-l-accent/70 px-2 py-1 transition-transform max-md:basis-full max-md:min-h-[84px]',
              dragTargets(BASE_ZONE) && dnd.drag?.over === BASE_ZONE
                ? 'border-accentBright ring-2 ring-accentBright/70 bg-accent/20'
                : dragTargets(BASE_ZONE)
                  ? 'border-accent border-dashed bg-accent/10'
                  : canDropCardAt('base') || (selectedUnit && myPriority)
                    ? 'border-accent bg-accent/10 cursor-pointer'
                    : 'border-line/40 bg-accent/[0.04]',
              dnd.drag && !dragTargets(BASE_ZONE) && 'opacity-55',
            )}
            onClick={() => {
              if (dnd.consumeClick()) return
              if (canDropCardAt('base') || (selectedUnit && myPriority)) onBaseClick()
            }}
          >
            <span className="hud-label text-accent/80">{t('board.yourBase')}</span>
            <div className="flex gap-1.5 flex-wrap content-start mt-0.5 min-h-[var(--unit-w)]">
              {player.base.map((u) => (
                <BoardUnit
                  key={u.instanceId}
                  unit={u}
                  side="player"
                  selected={selectedUnit === u.instanceId}
                  targetable={highlightIds.has(u.instanceId)}
                  targetTone={targetTone}
                  attachedGear={gearByUnit.get(u.instanceId)}
                  linked={linkedUnit === u.instanceId}
                  onLink={setLinkedUnit}
                  onClick={() => onUnitClick(u)}
                  onHover={setHovered}
                  onHoverUnit={setHoveredUnit}
                  changed={changedIds.has(u.instanceId)}
                  dragHandle={unitDragProps(u)}
                  dragging={draggingUnitId === u.instanceId}
                  {...unitDropProps(u)}
                />
              ))}
              {player.base.length === 0 && (
                <span className="text-txtFaint text-micro self-center">
                  {t(
                    canDropCardAt('base') || (selectedUnit && myPriority)
                      ? 'board.dropHere'
                      : 'board.noUnits',
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Gear */}
          <div className="flex-[1_1_0%] min-w-0 self-stretch border border-line/40 bg-black/10 px-2 py-1 max-md:basis-full">
            <span className="hud-label text-micro">{t('board.gear')}</span>
            <div className="flex gap-1.5 flex-wrap mt-0.5 min-h-[var(--unit-w)]">
              {player.gear.map((g) => (
                <button
                  key={g.instanceId}
                  data-gear-for={g.attachedTo ?? undefined}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onGearClick(g)
                  }}
                  onMouseEnter={() => {
                    setHovered(g.card)
                    if (g.attachedTo) setLinkedUnit(g.attachedTo)
                  }}
                  onMouseLeave={() => {
                    setHovered((h) => (h === g.card ? null : h))
                    if (g.attachedTo) setLinkedUnit(null)
                  }}
                  title={
                    g.attachedTo
                      ? `${g.card.name} → ${unitName(state, g.attachedTo)}`
                      : g.card.name
                  }
                  className={clsx(
                    'relative w-[var(--pile-w)] overflow-hidden border transition-all',
                    selectedGear === g.instanceId
                      ? 'border-accent'
                      : highlightIds.has(g.instanceId)
                        ? 'border-hextech'
                        : g.attachedTo && linkedUnit === g.attachedTo
                          ? 'border-hextech ring-2 ring-hextech/70 -translate-y-0.5'
                          : 'border-line/60',
                    g.exhausted && 'opacity-55 rotate-6',
                  )}
                >
                  <CardArt card={g.card} size="sm" preview={false} badge={false} />
                  {g.empowered && (
                    <span className="absolute top-0 left-0 bg-black/80 text-micro px-0.5 text-accent">⚡</span>
                  )}
                  {g.attachedTo && (
                    <span
                      className="absolute bottom-0 right-0 bg-hextech text-black text-micro font-bold px-0.5 leading-none"
                      title={t('badge.equipped')}
                    >
                      ⚔
                    </span>
                  )}
                </button>
              ))}
              {player.gear.length === 0 && (
                <span className="text-txtFaint text-micro self-center">{t('board.none')}</span>
              )}
            </div>
          </div>
        </div>

        {/* Hand band — runes (left) · hand (centre, fans/overlaps) · deck & trash (right) */}
        <div
          className={clsx(
            'relative z-20 shrink-0 flex items-end gap-3 px-4 pt-2 pb-2',
            'max-md:flex-wrap max-md:gap-2 max-md:px-2 max-md:pt-3 max-md:pb-4',
            'bg-black/20 border-t border-line/40',
            // Hit-testing for a drop is `document.elementFromPoint`, and this
            // band floats over the base. While a card is in flight every part
            // of the band has to be invisible to that test, or the pointer
            // finds a hand card's artwork instead of the drop zone underneath
            // and the drop is silently refused. A parent's `pointer-events:
            // none` does *not* survive a child setting `auto`, so the whole
            // subtree is switched, not just the wrapper.
            // The band no longer floats, so it covers nothing and needs no
            // pointer-events games — except while dragging, when it must not
            // intercept a drop aimed at a zone behind it.
            dnd.drag && '[&_*]:pointer-events-none',
          )}
        >
          {/* Runes, bottom left — the resource you spend on the cards in the
              same band, mirroring the deck and trash piles on the right. */}
          <RuneRail
            pool={player.runes}
            onRecycle={
              cleanTurn && canRecycle ? (runeId) => send({ type: 'RECYCLE_RUNE', runeId }) : undefined
            }
          />

          {/* Hand — centred, fanned. `overflow-visible` matters: the arc and the
              hover lift both leave this box, and a clipped fan looks broken. */}
          <div className="flex-1 min-w-0 flex items-end justify-center overflow-visible pb-1">
            {player.hand.length === 0 && (
              <span className="hud-label self-center">{t('board.noCardsInHand')}</span>
            )}
            {player.hand.map((card, i) => {
              const check = canPlay(state, 'player', card)
              const playable = myPriority && check.ok
              const freeRuneCount =
                player.runes.channeled.length - player.runes.spent.length
              const eff = effectiveCost(state, 'player', card)
              const pips = eff.runes?.length ?? 0
              const discounted = eff.energy !== card.energy || pips !== card.power
              const mod = discounted ? t('hint.modified') : ''
              const costHint =
                pips > 0
                  ? t('hint.costsRunes', {
                      energy: `${eff.energy}${mod}`,
                      pips,
                      have: player.runes.energy,
                      free: freeRuneCount,
                    })
                  : t('hint.costs', {
                      energy: `${eff.energy}${mod}`,
                      have: player.runes.energy,
                    })
              const why = !myPriority
                ? t(
                    state.priority === 'ai' || state.activePlayer === 'ai'
                      ? 'turn.aiTurn'
                      : 'hint.notYourPriority',
                  )
                : check.ok
                  ? card.name
                  : (check.reason ?? t('board.notPlayable')) +
                    (/energy|power/i.test(check.reason ?? '') ? costHint : '')
              const n = player.hand.length
              // ── The fan ──────────────────────────────────────────────────
              // A hand is held, not filed. Each card is rotated a little about a
              // pivot well below the board and lifted along an arc, so the row
              // reads as one object in a hand rather than a shelf of tiles.
              //
              // `spread` shrinks as the hand grows: a 3-card hand can afford
              // 7° between cards, a 9-card hand cannot without the ends pointing
              // sideways. The lift is a parabola through the same span, which is
              // what keeps the tops of the cards on a smooth curve.
              const mid = (n - 1) / 2
              const offset = i - mid // -mid … +mid
              const spread = n <= 1 ? 0 : Math.min(5.5, 27 / n)
              const angle = offset * spread
              const lift = mid === 0 ? 0 : Math.pow(offset / mid, 2) * Math.min(20, n * 2.8)
              // Overlap tightens with the fan so the arc stays a hand's width.
              // Cards now start overlapping immediately and bite deeper, which is
              // what makes a hand look held rather than laid out.
              const shift = n <= 2 ? -12 : Math.max(-96, -12 - (n - 2) * 13)
              return (
                <button
                  key={card.id}
                  type="button"
                  {...cardDragProps(card)}
                  style={{
                    marginLeft: i === 0 ? 0 : shift,
                    transform: `rotate(${angle}deg) translateY(${lift}px)`,
                    // Rotating about a point below the cards is what makes this an
                    // arc instead of a row of individually tilted tiles.
                    transformOrigin: '50% 220%',
                    // Later cards sit in front, so the fan overlaps consistently
                    // in one direction and the hovered card still wins (z-30).
                    zIndex: i,
                  }}
                  onClick={() => {
                    if (dnd.consumeClick()) return
                    if (playable) beginPlay(card)
                  }}
                  onMouseEnter={() => setHovered(card)}
                  onMouseLeave={() => setHovered((h) => (h === card ? null : h))}
                  title={why}
                  className={clsx(
                    // `group` plus a hit box that never moves. The lift used to
                    // change `bottom`, which moves the element itself — near the
                    // bottom edge the card slid out from under the pointer,
                    // un-hovered, dropped, re-hovered, and visibly vibrated. The
                    // inner wrapper below does the lift with a transform instead,
                    // which changes nothing about layout.
                    'group w-[var(--card-w)] shrink-0 relative hover:z-30',
                    selectedCard === card || targeting?.card === card ? 'z-20' : '',
                    !playable && 'opacity-45 cursor-not-allowed',
                    // The card being dragged is represented by the ghost instead.
                    draggingCard === card && 'opacity-25',
                    // The grab cursor has to agree with what `handleProps` armed,
                    // or the board advertises a drag it will refuse to start.
                    anyDropZone({ kind: 'card', card }) && 'cursor-grab active:cursor-grabbing',
                  )}
                >
                  <div
                    className={clsx(
                      'border-2 bg-panel2 overflow-hidden',
                      'transition-[transform,border-color,box-shadow] duration-300 ease-calm',
                      'group-hover:-translate-y-7 group-hover:shadow-[0_14px_34px_-8px_rgba(0,0,0,0.8)]',
                      selectedCard === card
                        ? 'border-accent -translate-y-7 shadow-glow'
                        : targeting?.card === card
                          ? 'border-hextech -translate-y-7'
                          : 'border-line2/60',
                      // A freshly drawn card sails in from the deck.
                      drawnIds.has(card.id)
                        ? 'animate-[rb-draw_0.55s_cubic-bezier(0.22,0.61,0.36,1)]'
                        : 'animate-[rb-rise_0.25s_ease-out]',
                    )}
                  >
                    <CardArt card={card} size="sm" preview={false} />
                  </div>
                </button>
              )
            })}
          </div>

          {/* Main deck + trash */}
          <div className="flex items-end gap-1.5 shrink-0">
            <div className="w-[var(--pile-w)]">
              <div className="relative aspect-[5/7] border border-line/60 overflow-hidden">
                <CardBack />
                <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-micro font-bold text-txt tabular-nums bg-black/70">
                  📚 {player.mainDeck.length}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPilesSide('player')}
              onMouseEnter={() => topTrash && setHovered(topTrash)}
              onMouseLeave={() => setHovered((h) => (h === topTrash ? null : h))}
              title={t('board.viewPiles')}
              className="w-[var(--pile-w)] text-left group"
            >
              <div className="relative aspect-[5/7] border border-line/60 overflow-hidden group-hover:border-accent">
                {topTrash ? (
                  <CardArt card={topTrash} size="sm" preview={false} badge={false} />
                ) : (
                  <CardBack dim />
                )}
                <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-micro font-bold text-txt tabular-nums bg-black/70">
                  🗑 {player.trash.length}
                  {player.banished.length > 0 && ` ⚰${player.banished.length}`}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>

      {showMoves && (
        <div className="px-4 py-2 border-t border-line bg-panel2 shrink-0 max-h-[26vh] overflow-y-auto">
          <div className="hud-label text-accent mb-1">{t('moves.title')}</div>
          {availableMoves.length === 0 ? (
            <p className="text-tiny text-txtDim">{t('moves.none')}</p>
          ) : (
            <ul className="space-y-0.5">
              {availableMoves.map((m) => (
                <li key={m.key} className="text-tiny text-txtDim flex gap-2">
                  <span className="text-accent shrink-0">·</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Action bar */}
      <TutorialCoach state={state} />

      <div className="flex items-center gap-3 px-4 py-2 bg-panel border-t border-line shrink-0 max-md:gap-2 max-md:px-2 max-md:[&_button]:whitespace-nowrap max-md:[&_span]:whitespace-nowrap">
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
        {/* This is the "what now" line. It used to be dim grey and read as a
            footnote; it is the most useful text on the board for a new player,
            so it gets full-contrast text and a marker. */}
        <span className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-accent shrink-0" aria-hidden>
            ▸
          </span>
          <span className="text-txt text-xs truncate">{hint}</span>
        </span>

        {castArmed && (
          <Btn variant="primary" onClick={castSelected}>
            {t('board.cast', { name: selectedCard!.name })}
          </Btn>
        )}

        <button
          onClick={() => setShowMoves((v) => !v)}
          title={t('moves.tip')}
          className={clsx(
            'px-2 py-1 text-tiny uppercase tracking-wide border shrink-0',
            showMoves ? 'border-accent text-accent' : 'border-line text-txtDim hover:text-txt',
          )}
        >
          {t('moves.button', { n: availableMoves.length })}
        </button>

        {/* The same action for when no prompt is up — your own main phase.
            `notice` gates the popup above, so this avoids showing it twice. */}
        {!targeting &&
          !notice &&
          playableFacedown.map((i) => (
            <Btn key={`fdbar${i}`} onClick={() => playFacedown(i)} title={t('hidden.playTip')}>
              {t('hidden.playFrom', { name: state.battlefields[i].name })}
            </Btn>
          ))}

        {/* [Hidden] — one button per battlefield you could hide this card at.
            Hiding is not playing, so it never goes through the cast flow.

            When it *isn't* available the control still renders, disabled, with
            the blocking reason: it used to vanish entirely, which reads as "this
            card doesn't have Hidden" rather than "not yet". */}
        {selectedCard && !targeting && hasHidden(selectedCard) && (
          hideableAt.length > 0 ? (
            hideableAt.map((i) => (
              <Btn
                key={`hide${i}`}
                onClick={() => {
                  send({ type: 'HIDE_CARD', card: selectedCard, index: i })
                  setSelectedCard(null)
                }}
                title={t('hidden.hideTip')}
              >
                {t('hidden.hideAt', { name: state.battlefields[i].name })}
              </Btn>
            ))
          ) : (
            <span
              title={t('hidden.hideTip')}
              className="px-3 py-1.5 text-tiny uppercase tracking-wide border border-line text-txtFaint cursor-help"
            >
              {t('hidden.cantHide', {
                why: hideBlockedReason(state, 'player', selectedCard) ?? '',
              })}
            </span>
          )
        )}

        {activeOpt && (
          <button
            onClick={() => setAcceleratePaid((v) => !v)}
            disabled={!canAffordExtra}
            className={clsx(
              'px-3 py-1.5 text-tiny font-bold uppercase tracking-wide border',
              acceleratePaid ? 'bg-accent border-accent text-black' : 'border-line text-txtDim',
              !canAffordExtra && 'opacity-40',
            )}
          >
            {acceleratePaid ? '✓ ' : ''}
            {labelKo(activeOpt.label, 'choice')}
          </button>
        )}

        {myChoice && myChoice.min === 0 && (
          <Btn onClick={() => send({ type: 'RESOLVE_CHOICE', pickedIds: [] })}>{t('common.skip')}</Btn>
        )}

        {/* Targeting Done/Cancel live in the banner above — not duplicated here. */}

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
            title={labelKo(ab.label)}
            className="px-3 py-1.5 border border-accentDim text-accent text-tiny font-bold uppercase tracking-wide hover:bg-accent hover:text-black max-w-[220px] truncate"
          >
            {labelKo(ab.label)}
          </button>
        ))}

        {/* No Channel button: rule 430.3.a — "Players may only channel runes
            when Game Effects direct them to do so." The 2 runes a turn (3 going
            second, 480.7) arrive automatically in the Channel Phase. Recycle
            stays because it is the rune's own printed ability (163.2.b). */}
        <Btn
          onClick={() => send({ type: 'RECYCLE_RUNE' })}
          disabled={!cleanTurn || !canRecycle}
          title={t('rune.recycleTip')}
        >
          {t('board.recycle')}
        </Btn>

        {responding ? (
          // The primary Pass lives in the banner above; keep a quiet one here too.
          <Btn onClick={() => send({ type: 'PASS_PRIORITY' })}>{t('board.pass')}</Btn>
        ) : (
          <Btn variant="primary" onClick={() => send({ type: 'END_TURN' })} disabled={!cleanTurn}>
            {t('board.endTurn')}
          </Btn>
        )}
      </div>
    </div>
  )
}

// ── Pre-fight combat preview ─────────────────────────────────────────────

/**
 * Sits in the middle of a contested battlefield. Shows BOTH directions, because
 * Assault only counts while attacking and Shield only while defending — the same
 * two units can win one way and lose the other. Whichever side moved in is the
 * one that ends up declaring (or gets force-resolved at end of turn).
 */
function CombatPreview({
  ifIAttack,
  ifTheyAttack,
}: {
  ifIAttack: ShowdownForecast | null
  ifTheyAttack: ShowdownForecast | null
}) {
  const t = useT()
  if (!ifIAttack && !ifTheyAttack) return null

  const Row = ({
    icon,
    label,
    you,
    them,
    youLost,
    youTotal,
    yourHp,
    theirHp,
    verdict,
    good,
    title,
  }: {
    icon: string
    label: string
    you: number
    them: number
    youLost: number
    youTotal: number
    yourHp: number
    theirHp: number
    verdict: string
    good: 'good' | 'bad' | 'even'
    title: string
  }) => (
    <div className="flex items-center gap-2 leading-none" title={title}>
      <span className="hud-label text-txtFaint w-[86px] shrink-0 text-right">
        {icon} {label}
      </span>
      {/* Might is health, so the ♥ line normally repeats the ⚔ number and is
          just noise. Show it only when they diverge — a side carrying damage,
          or a stunned unit that soaks its full Might while contributing none. */}
      <span className="flex flex-col items-center leading-none">
        <span className="text-accent text-base font-bold tnum">{you}⚔</span>
        {yourHp !== you && <span className="text-micro text-accent/60 tnum">{yourHp}♥</span>}
      </span>
      <span className="hud-label text-txtFaint">vs</span>
      <span className="flex flex-col items-center leading-none">
        <span className="text-danger text-base font-bold tnum">{them}⚔</span>
        {theirHp !== them && <span className="text-micro text-danger/60 tnum">{theirHp}♥</span>}
      </span>
      <span
        className={clsx(
          'hud-label px-1 border ml-1',
          good === 'good'
            ? 'border-accent text-accent'
            : good === 'bad'
              ? 'border-danger text-danger'
              : 'border-line2 text-txtDim',
        )}
      >
        {verdict}
      </span>
      <span className="text-micro text-txtFaint tabular-nums w-[54px]">
        {youLost > 0
          ? t('preview.youLost', { lost: youLost, total: youTotal })
          : t('preview.youKeep', { total: youTotal })}
      </span>
    </div>
  )

  return (
    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-[15] flex justify-center pointer-events-none px-2">
      <div className="bg-black/85 border border-line2 px-3 py-1.5 flex flex-col gap-1 shadow-lg pointer-events-auto">
        {ifIAttack && (
          <Row
            icon="⚔"
            label={t('preview.youAttack')}
            you={ifIAttack.attackerMight}
            them={ifIAttack.defenderMight}
            yourHp={ifIAttack.attackerHealth}
            theirHp={ifIAttack.defenderHealth}
            youLost={ifIAttack.attackerLosses}
            youTotal={ifIAttack.attackerCount}
            title={t('preview.attackTip')}
            verdict={t(
              ifIAttack.outcome === 'conquer'
                ? 'preview.youTakeIt'
                : ifIAttack.outcome === 'lose'
                  ? 'preview.youLose'
                  : ifIAttack.outcome === 'wipeout'
                    ? 'preview.bothWiped'
                    : 'preview.youFallBack',
            )}
            good={
              ifIAttack.outcome === 'conquer'
                ? 'good'
                : ifIAttack.outcome === 'lose'
                  ? 'bad'
                  : 'even'
            }
          />
        )}
        {ifTheyAttack && (
          <Row
            icon="⛨"
            label={t('preview.theyAttack')}
            you={ifTheyAttack.defenderMight}
            them={ifTheyAttack.attackerMight}
            yourHp={ifTheyAttack.defenderHealth}
            theirHp={ifTheyAttack.attackerHealth}
            youLost={ifTheyAttack.defenderLosses}
            youTotal={ifTheyAttack.defenderCount}
            title={t('preview.defendTip')}
            verdict={t(
              ifTheyAttack.outcome === 'conquer'
                ? 'preview.theyTakeIt'
                : ifTheyAttack.outcome === 'lose'
                  ? 'preview.youHold'
                  : ifTheyAttack.outcome === 'wipeout'
                    ? 'preview.bothWiped'
                    : 'preview.theyFallBack',
            )}
            good={
              ifTheyAttack.outcome === 'lose' || ifTheyAttack.outcome === 'stalemate'
                ? 'good'
                : ifTheyAttack.outcome === 'conquer'
                  ? 'bad'
                  : 'even'
            }
          />
        )}
      </div>
    </div>
  )
}

// ── Centre-stage briefing ────────────────────────────────────────────────

/** One side of the combat readout — total Might over the units that fought. */
function ShowdownSide({
  label,
  tone,
  might,
  units,
  onHover,
}: {
  label: string
  tone: 'me' | 'them'
  might: number
  units: ShowdownCombatant[]
  onHover: (c: Card | null) => void
}) {
  const t = useT()
  const color = tone === 'me' ? 'text-accent' : 'text-danger'
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center gap-1.5">
      <span className={clsx('hud-label', color)}>{label}</span>
      <span className={clsx('text-3xl font-bold tabular-nums leading-none', color)}>
        {might}
        <span className="text-base ml-0.5">⚔</span>
      </span>
      <div className="flex flex-wrap justify-center gap-1.5 mt-1 min-h-[calc(var(--unit-w)*1.4)]">
        {units.length === 0 && (
          <span className="text-txtFaint text-micro self-center">{t('brief.noUnits')}</span>
        )}
        {units.map((u, i) => (
          <div
            key={i}
            className={clsx('relative w-[var(--unit-w)]', u.died && 'opacity-45')}
            onMouseEnter={() => onHover(u.card)}
            onMouseLeave={() => onHover(null)}
            title={t('brief.unitTip', {
              name: u.name,
              n: u.might,
              state: t(u.died ? 'brief.destroyed' : 'brief.survived'),
            })}
          >
            <div className={clsx('border', u.died ? 'border-danger' : 'border-accent')}>
              <CardArt card={u.card} size="sm" preview={false} badge={false} />
            </div>
            <span className="absolute top-0 right-0 bg-black/90 text-micro font-bold px-1 tabular-nums">
              {u.might}⚔
            </span>
            {u.died && (
              <span className="absolute inset-0 flex items-center justify-center text-danger text-2xl font-bold drop-shadow">
                ✕
              </span>
            )}
            <span className="absolute bottom-0 inset-x-0 bg-black/85 text-micro leading-tight truncate px-0.5 uppercase text-center">
              {u.name.split(/[ ,–-]/)[0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The centre-of-screen post-combat readout. Ordinary AI actions stream past
 * and/or a full combat readout for the last showdown. Non-blocking — the scrim
 * lets clicks through, and any board action dismisses it.
 */
function BriefingPanel({
  showdown,
  mySide,
  onDismiss,
  onHover,
}: {
  showdown: ShowdownReport | null
  mySide: PlayerSide
  onDismiss: () => void
  onHover: (c: Card | null) => void
}) {
  const { locale, t } = useLocale()
  const ko = locale === 'ko'
  // Whose units are which — the report is keyed by declarer/defender.
  const iDeclared = showdown?.declarer === mySide
  const outcomeTone =
    showdown?.outcome === 'wipeout'
      ? 'border-line2 text-txt'
      : showdown?.winner === mySide
        ? 'border-accent text-accent'
        : 'border-danger text-danger'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/45" />
      <div className="relative pointer-events-auto w-[min(680px,92vw)] max-h-[80vh] overflow-y-auto bg-panel border border-line2 shadow-2xl animate-[rb-pop_0.22s_ease-out]">
        <div className="flex items-center justify-between px-4 py-2 border-b border-line bg-black/40">
          <span className="hud-label text-accent">
            {t(showdown ? 'brief.showdownResult' : 'brief.aiDid')}
          </span>
          <button onClick={onDismiss} className="text-txtDim hover:text-accent text-sm leading-none">
            ✕
          </button>
        </div>

        {showdown && (
          <div className="px-4 pt-3 pb-2">
            <div className="text-center hud-label normal-case tracking-normal mb-3">
              {t(iDeclared ? 'brief.atYouAttacked' : 'brief.atAiAttacked', {
                bf: showdown.battlefieldName,
              })}
            </div>
            <div className="flex items-start gap-4">
              <ShowdownSide
                label={t(iDeclared ? 'brief.youAttacking' : 'brief.youDefending')}
                tone="me"
                might={iDeclared ? showdown.attackerMight : showdown.defenderMight}
                units={iDeclared ? showdown.attackers : showdown.defenders}
                onHover={onHover}
              />
              <div className="self-center text-txtFaint text-lg font-bold px-1">VS</div>
              <ShowdownSide
                label={t(iDeclared ? 'brief.aiDefending' : 'brief.aiAttacking')}
                tone="them"
                might={iDeclared ? showdown.defenderMight : showdown.attackerMight}
                units={iDeclared ? showdown.defenders : showdown.attackers}
                onHover={onHover}
              />
            </div>
            <div className={clsx('mt-3 px-3 py-2 border text-xs text-center', outcomeTone)}>
              {(ko && showdownSummaryKo(showdown.summary)) || showdown.summary}
            </div>
            <p className="mt-2 text-micro text-txtFaint text-center leading-snug">
              {t('brief.simultaneous')}
            </p>
          </div>
        )}

        <div className="px-4 py-2 border-t border-line flex justify-end">
          <Btn variant="primary" onClick={onDismiss}>
            {t('common.continue')}
          </Btn>
        </div>
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

/**
 * A card in a battlefield's Facedown Zone.
 *
 * Only its owner may look at the face (128.4), so the opponent's shows as a
 * plain back with no name and no hover preview — leaking it through a tooltip
 * would hand away the whole point of the keyword.
 */
function FacedownSlot({
  fd,
  playable,
  onPlay,
  onHover,
}: {
  fd: FacedownCard
  playable: boolean
  onPlay: () => void
  onHover: (c: Card | null) => void
}) {
  const t = useT()
  const mine = fd.owner === 'player'
  const title = mine ? (playable ? t('hidden.yours') : t('hidden.waiting')) : t('hidden.theirs')
  return (
    <button
      type="button"
      disabled={!playable}
      onClick={onPlay}
      onMouseEnter={() => mine && onHover(fd.card)}
      onMouseLeave={() => mine && onHover(null)}
      title={title}
      className={clsx(
        'absolute right-2 top-8 z-20 w-9 h-12 border-2 flex items-center justify-center text-lg',
        'bg-panel2/95 transition-colors',
        mine
          ? playable
            ? 'border-accent text-accent animate-[rb-dot_1.6s_ease-in-out_infinite] cursor-pointer'
            : 'border-accentDim text-accentDim'
          : 'border-danger/60 text-danger/60 cursor-default',
      )}
    >
      🂠
    </button>
  )
}

/**
 * The goal, always on screen.
 *
 * Everything else on the board reports *state* — what you hold, what's in hand,
 * what just happened — and nothing said what any of it was for. This is the one
 * strip that names the win condition and shows, in a single row, which
 * battlefields are actually moving you toward it.
 */
/**
 * What the thing on the stack will do, in the prompt that asks you to respond
 * to it.
 *
 * The popup used to say only "Opponent Discipline is on the stack" and offer a
 * Pass button. The card was unreachable — the popup is `pointer-events: none`
 * so you cannot hover it, and the AI's card is not in a zone you can inspect.
 * You were being asked to react to something you were not allowed to read.
 */
function StackEffect({ item, state }: { item: StackItem; state: GameState }) {
  const t = useT()
  const card = item.card

  // Resolve targets to names, so "targets a unit" becomes "→ Stalwart Poro".
  const targetNames = item.targets
    .map((tg) => {
      if (tg.kind === 'unit' && tg.instanceId) {
        const u = allUnits(state).find((x) => x.instanceId === tg.instanceId)
        return u ? `${u.card.name}${u.owner === 'player' ? ' (yours)' : ''}` : null
      }
      if (tg.kind === 'gear' && tg.instanceId) {
        const g = [...state.player.gear, ...state.ai.gear].find(
          (x) => x.instanceId === tg.instanceId,
        )
        return g ? g.card.name : null
      }
      if (tg.kind === 'player') return tg.side === 'player' ? t('common.you') : 'AI'
      if (tg.kind === 'stackItem') {
        const it = state.stack.find((x) => x.id === tg.stackItemId)
        return it?.card?.name ?? t('stack.thatSpell')
      }
      return null
    })
    .filter((n): n is string => !!n)

  return (
    <div className="flex gap-3 border border-line/70 bg-black/40 p-2 min-w-0">
      {card && (
        <div className="w-[68px] shrink-0 border border-line/60">
          <CardArt card={card} size="sm" preview={false} badge={false} />
        </div>
      )}
      <div className="min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="display-face text-sm text-txt">{card?.name ?? item.label}</span>
          <span className="hud-label text-txtFaint">
            {t(item.controller === 'ai' ? 'stack.byAi' : 'stack.byYou')}
          </span>
        </div>
        {card?.text ? (
          <div className="text-tiny text-txt leading-snug">
            <CardRulesText text={card.text} />
          </div>
        ) : (
          <div className="text-tiny text-txtDim leading-snug">{item.label}</div>
        )}
        {targetNames.length > 0 && (
          <div className="text-tiny text-gold leading-snug">
            → {targetNames.join(', ')}
          </div>
        )}
      </div>
    </div>
  )
}

function ObjectiveBar({ state, target }: { state: GameState; target: number }) {
  const t = useT()
  const me = state.player.points
  const them = state.ai.points
  const toGo = Math.max(0, target - me)

  /** A race-to-{target} track. Reading two numbers tells you the score; reading
   *  two tracks tells you the *game* — who is close, and by how much. */
  const Track = ({ n, tone }: { n: number; tone: 'you' | 'ai' }) => (
    <span className="flex gap-[2px]">
      {Array.from({ length: target }).map((_, i) => (
        <span
          key={i}
          className={clsx(
            'w-[5px] h-3',
            i < n
              ? tone === 'you'
                ? 'bg-accent'
                : 'bg-danger'
              : 'border border-line/70',
          )}
        />
      ))}
    </span>
  )

  return (
    <div className="flex items-center gap-4 px-4 py-1.5 bg-black/30 border-b border-line/60 shrink-0">
      {/* The scoreboard. This used to be two 18px numbers wedged between the
          label and the battlefield chips, and got read as decoration — "the
          score is too small or hidden". It is the only number that decides the
          game, so it gets the size and the isolation to match. */}
      <div className="flex items-center gap-3 shrink-0 border border-line/70 bg-black/40 px-3 py-1">
        <div className="flex flex-col items-end leading-none gap-1">
          <span className="hud-label text-accent/80">{t('common.you')}</span>
          <Track n={me} tone="you" />
        </div>
        <span className="display-face text-3xl tnum leading-none text-accent">{me}</span>
        <span className="text-txtFaint text-lg leading-none">–</span>
        <span className="display-face text-3xl tnum leading-none text-danger">{them}</span>
        <div className="flex flex-col items-start leading-none gap-1">
          <span className="hud-label text-danger/80">AI</span>
          <Track n={them} tone="ai" />
        </div>
      </div>
      <div className="flex flex-col leading-tight shrink-0">
        <span className="hud-label text-accent">{t('obj.label')}</span>
        <span className="text-tiny text-txtDim">{t('obj.winAt', { n: target })}</span>
        {toGo > 0 && (
          <span className="text-micro text-txtFaint tnum">{t('obj.toGo', { n: toGo })}</span>
        )}
      </div>
      <span className="h-8 w-px bg-line shrink-0" />
      <div className="flex items-center gap-2 min-w-0 overflow-x-auto">
        {state.battlefields.map((bf) => {
          const who = controllerOf(bf)
          const label = t(`obj.held.${who}` as 'obj.held.open')
          const tone =
            who === 'player'
              ? 'border-accent text-accent'
              : who === 'ai'
                ? 'border-danger text-danger'
                : who === 'contested'
                  ? 'border-gold text-gold animate-pulse'
                  : 'border-line text-txtFaint'
          return (
            <span
              key={bf.index}
              title={t(who === 'player' ? 'obj.holdTip' : 'obj.takeTip', {
                name: bf.name,
                who: label,
              })}
              className={clsx(
                'flex items-center gap-1.5 border px-1.5 py-0.5 shrink-0 cursor-default',
                tone,
              )}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
              <span className="text-micro text-txt truncate max-w-[130px]">{bf.name}</span>
              <span className="hud-label">{label}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── Status helpers ───────────────────────────────────────────────────────

function unitStatuses(u: UnitInPlay, t: TFn): string[] {
  const out: string[] = []
  if (u.empowered) out.push(t('status.empowered'))
  if ((u.counters.stunned ?? 0) > 0) out.push(t('status.stunned'))
  if ((u.counters.buffed ?? 0) > 0) out.push(t('status.buffed'))
  const shield = keywordValue(u, 'Shield') + (u.counters.shield ?? 0)
  if (shield > 0) out.push(t('status.shield', { n: shield }))
  const assault = keywordValue(u, 'Assault')
  if (assault > 0) out.push(t('status.assault', { n: assault }))
  const mb = mightBonus(u)
  if (mb !== 0) out.push(t('status.might', { n: `${mb > 0 ? '+' : ''}${mb}` }))
  if (u.sick) out.push(t('status.sick'))
  if (u.exhausted) out.push(t('status.exhausted'))
  return out
}

function gearStatuses(g: GearInPlay, t: TFn): string[] {
  const out: string[] = []
  if (g.empowered) out.push(t('status.empowered'))
  out.push(t(g.exhausted ? 'status.exhausted' : 'status.ready'))
  if (g.attachedTo) out.push(t('status.attached'))
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
  const t = useT()
  const pd = state.pendingDamage!
  const receiving = pd.stage === 'def' ? (pd.declarer === 'player' ? 'ai' : 'player') : pd.declarer
  const units = state.battlefields[pd.index].units.filter(
    (u) => u.owner === receiving && pd.targetIds.includes(u.instanceId),
  )
  const ranked = [...units].sort((a, b) => damageOrderRank(a) - damageOrderRank(b))
  const [picks, setPicks] = useState<Record<string, number>>({})

  // The units being assigned onto keep their combat role, so an attacker still
  // has its Assault Might as health while the defenders' damage lands on it.
  const role = pd.stage === 'def' ? ('defender' as const) : ('attacker' as const)
  const hp = (u: UnitInPlay) => effHp(u, state, role)
  const total = Object.values(picks).reduce((n, v) => n + v, 0)
  const remaining = pd.pool - total
  const maxKillable = units.reduce((n, u) => n + hp(u), 0)
  const rankLabel = (u: UnitInPlay) =>
    damageOrderRank(u) === 0 ? t('dmg.tank') : damageOrderRank(u) === 2 ? t('dmg.backline') : ''
  const lockedFor = (u: UnitInPlay) => {
    const r = damageOrderRank(u)
    return units.some((o) => damageOrderRank(o) < r && (picks[o.instanceId] ?? 0) < hp(o))
  }
  const step = (u: UnitInPlay, d: number) =>
    setPicks((p) => {
      const cur = p[u.instanceId] ?? 0
      // 460.2.c.4 — you may only pour damage past lethal into a unit once every
      // other unit here is already dead. Until then the stepper stops at lethal.
      const othersDead = units.every((o) => o.instanceId === u.instanceId || (p[o.instanceId] ?? 0) >= hp(o))
      const cap = hp(u) + (othersDead ? pd.pool : 0)
      let next = Math.max(0, Math.min(cap, cur + d))
      if (d > 0) next = Math.min(next, cur + Math.max(0, remaining))
      return { ...p, [u.instanceId]: next }
    })
  const auto = () => {
    const m: Record<string, number> = {}
    for (const a of autoAssignmentList(pd.pool, units, state, role)) m[a.targetInstanceId] = a.amount
    setPicks(m)
  }
  const assignments = Object.entries(picks)
    .filter(([, v]) => v > 0)
    .map(([targetInstanceId, amount]) => ({ targetInstanceId, amount }))
  const canConfirm = total <= pd.pool && total >= Math.min(pd.pool, maxKillable)

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center animate-[rb-fade_0.15s_ease-out]">
      <div className="bg-panel border border-accent p-5 w-[420px] max-w-[92vw] animate-[rb-pop_0.2s_ease-out]">
        <h3 className="hud-label text-accent mb-1">{t('dmg.title', { n: pd.pool })}</h3>
        <p className="text-tiny text-txtDim mb-3">
          {t('dmg.note')}
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
                  <span className="ml-1 text-micro text-txtFaint">
                    {t('dmg.hp', { n: hp(u) })}
                    {u.damage > 0 ? t('dmg.dealt', { n: u.damage }) : ''}
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
          <Btn onClick={auto}>{t('common.auto')}</Btn>
          <Btn variant="primary" onClick={() => onAssign(assignments)} disabled={!canConfirm}>
            {t('common.confirm')}
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
  const t = useT()
  const seen = new Set<string>()
  const cards = state.player.trash.filter((c) => {
    if (c.type !== 'spell' || seen.has(c.id)) return false
    seen.add(c.id)
    return flowCost(c, state.flowGranted) !== null
  })
  if (cards.length === 0) return null

  return (
    <div className="px-4 py-1.5 border-t border-line bg-panel min-h-[70px] flex items-center gap-2 shrink-0">
      <span className="hud-label mr-1 shrink-0">{t('board.flow')}</span>
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
                    ? t('flow.cast', { name: card.name })
                    : t(!affordable ? 'flow.notEnough' : 'flow.badTiming')
                }
              >
                <CardArt card={card} size="sm" preview={false} badge={false} />
              </button>
              <div className="text-micro text-center text-accent leading-tight mt-0.5 tabular-nums">
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
  const t = useT()
  // The lane is the only way to click a chain item — to counter a spell, or to
  // name one as a target — so it has to exist whenever a chain does. It does
  // *not* have to hold a band across the board the rest of the time.
  //
  // `lastResolved` alone is not reason enough to stay open: it is cleared only
  // at the start of a turn (phases.ts), so one resolution would pin the lane
  // open for the remainder of that turn with nothing left to click. The log
  // rail already records what resolved, in more detail and permanently.
  if (stack.length === 0 && !pendingShowdown) return null
  const nameOf = (it: GameState['stack'][number]) =>
    it.card?.name ?? it.label.replace(/^(player|ai)'s\s+/i, '')
  return (
    <div className="px-4 py-1 border-t border-line bg-panel min-h-[30px] flex items-center gap-2 shrink-0 overflow-x-auto text-tiny">
      <span className="hud-label shrink-0">{t('board.castLane')}</span>

      {pendingShowdown && (
        <span className="hud-label text-accent shrink-0">
          {t('board.showdownAt', { n: pendingShowdown.index + 1 })}
        </span>
      )}

      {stack.map((it) => {
        const targetable = legalStackIds.has(it.id)
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => targetable && onPick(it.id)}
            // Not `disabled` — a disabled button fires no mouse events, so the
            // hover preview never appeared for anything that wasn't a legal
            // target (i.e. almost everything on the lane).
            onMouseEnter={() => it.card && onHover(it.card)}
            onMouseLeave={() => onHover(null)}
            title={it.label}
            className={clsx(
              'shrink-0 flex items-center gap-1.5 pl-1 pr-2 py-0.5 border animate-[rb-slide-left_0.2s_ease-out]',
              targetable
                ? 'border-accent text-accent cursor-pointer hover:bg-accent hover:text-black'
                : 'border-line text-txt cursor-default',
              pickedStack === it.id && 'bg-accent text-black',
            )}
          >
            {it.card && (
              <span className="w-4 shrink-0 overflow-hidden border border-black/40">
                <CardArt card={it.card} size="sm" preview={false} badge={false} />
              </span>
            )}
            {nameOf(it)}
          </button>
        )
      })}

      {lastResolved && (
        <span
          className="shrink-0 text-txtFaint uppercase tracking-wide"
          onMouseEnter={() => lastResolved.card && onHover(lastResolved.card)}
          onMouseLeave={() => onHover(null)}
        >
          {t('board.last')}: {lastResolved.card?.name ?? lastResolved.label}
          <span className={clsx('ml-1', lastResolved.outcome === 'countered' ? 'text-danger' : 'text-txtDim')}>
            ({t(lastResolved.outcome === 'countered' ? 'board.countered' : 'board.resolved')})
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
  const t = useT()
  // Collapsed → a slim rail with just the toggle; expanded → the full column.
  if (!expanded) {
    return (
      <button
        onClick={onToggle}
        title={t('board.showLog')}
        className="w-7 shrink-0 border-l border-line bg-panel hover:bg-panel2 hud-label text-accent/70 flex items-center justify-center max-md:w-full max-md:border-l-0 max-md:border-t max-md:py-2"
      >
        <span className="[writing-mode:vertical-rl] rotate-180 tracking-[0.2em] max-md:[writing-mode:horizontal-tb] max-md:rotate-0 max-md:tracking-normal">
          {t('board.activityLog')} ▸
        </span>
      </button>
    )
  }
  const shown = [...log].slice(-250)
  return (
    // Capped rather than full-height: a log that runs the whole board reads as
    // the main column. The list inside scrolls, so nothing is lost.
    //
    // The cap is a share of the RAIL (60%), not of the viewport. A vh cap is a
    // guess about the window: at 1440x720 the old max-h-[52vh] was 374px inside
    // a 209px rail, and the overflow painted over the action bar.
    <div className="w-[clamp(220px,20vw,320px)] shrink-0 border-l border-line bg-panel flex flex-col min-h-0 flex-1 max-h-[60%] max-md:w-full max-md:border-l-0 max-md:border-t max-md:max-h-[34vh] max-md:flex-none">
      <button
        onClick={onToggle}
        className="shrink-0 w-full flex items-center justify-between px-3 py-1.5 hud-label hover:text-accent border-b border-line"
      >
        <span className="text-accent/80">{t('board.activityLog')}</span>
        <span>◂</span>
      </button>
      <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-1">
        {shown
          .map((msg, i) => ({ msg, i }))
          .reverse()
          .map(({ msg, i }) => (
            <LogLine key={i} text={msg} />
          ))}
      </div>
    </div>
  )
}

/** One channeled rune, shown as its own card. Spent runes tilt a little. */
function RuneChip({
  card,
  state,
  onRecycle,
}: {
  card: Card
  state: 'ready' | 'spent' | 'recycled'
  /** Present when this rune can still be recycled for 1 Power (163.2.b). */
  onRecycle?: () => void
}) {
  const t = useT()
  const domain = card.domains[0] ?? 'colorless'
  return (
    <div
      role={onRecycle ? 'button' : undefined}
      tabIndex={onRecycle ? 0 : undefined}
      onClick={onRecycle}
      onKeyDown={(e) => {
        if (onRecycle && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onRecycle()
        }
      }}
      title={
        t('board.runeTip', { domain: t(domainKey(domain)) }) +
        t(
          state === 'spent'
            ? 'board.runeSpent'
            : state === 'recycled'
              ? 'board.runeRecycled'
              : 'board.runeReady',
        ) +
        (onRecycle ? ` — ${t('rune.recycleTip')}` : '')
      }
      className={clsx(
        'relative w-[var(--rune-w)] aspect-[5/7] shrink-0 border overflow-hidden bg-panel2 transition-transform group',
        state === 'spent' && 'rotate-6 opacity-55',
        state === 'recycled' && '-rotate-6 opacity-80',
        onRecycle && 'cursor-pointer hover:-translate-y-1 hover:ring-2 hover:ring-gold',
      )}
      style={{ borderColor: DOMAIN_HEX[domain] }}
    >
      {/* The second of the rune's two printed abilities, one click away. An
          exhausted rune still qualifies: you keep the Energy already floating
          in your pool and gain the Power on top (163.2). */}
      {onRecycle && (
        <span className="absolute inset-x-0 bottom-0 z-10 text-center text-micro font-bold bg-black/80 text-gold opacity-0 group-hover:opacity-100 transition-opacity">
          ♻ +1◈
        </span>
      )}
      {card.imageUrl ? (
        <img src={card.imageUrl} alt={domain} className="w-full h-full object-cover" />
      ) : (
        <span
          className="absolute inset-0 flex items-center justify-center text-micro font-bold"
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
function RuneRail({
  pool,
  onRecycle,
}: {
  pool: GameState['player']['runes']
  /** Supplied only while recycling is legal (your turn, empty stack). */
  onRecycle?: (runeId: string) => void
}) {
  const t = useT()
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
  // How far along each rune sits from the one before, as a fraction of a rune's
  // width. Capped at 0.85 so a small pool still reads as separate cards, and
  // shrunk past that so the whole strip never exceeds five rune-widths however
  // many are channeled — the same trick the hand fan uses.
  const step = Math.min(0.85, 4 / Math.max(1, chips.length - 1))
  return (
    // Laid out for the bottom-left of the hand band: the deck tile, then a
    // column holding the pool counters above the channeled runes. `items-end`
    // so it sits on the same baseline as the hand and the trash pile.
    //
    // The chip area is capped and scrolls. Ten channeled runes is an ordinary
    // late-game board and an uncapped wrap grew the band tall enough to eat the
    // playmat above it.
    <div className="flex items-end gap-2 shrink-0 max-w-[clamp(150px,20vw,300px)] max-md:order-3 max-md:basis-full max-md:max-w-none">
      {/* Rune deck */}
      <div className="w-[var(--rune-w)] shrink-0">
        <div className="relative aspect-[5/7] border border-line/60 overflow-hidden">
          <CardBack />
          <span className="absolute inset-x-0 bottom-0 py-0.5 text-center text-micro font-bold text-txt tabular-nums bg-black/70">
            🜲{pool.deck.length}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1 min-w-0">
      {/* The Rune Pool (165) — the floating Energy and Power you can actually
          spend. Power used to appear only when non-zero, which hid the whole
          second resource: you cannot plan to recycle for Power if you have
          never seen a Power counter. Both slots are always on screen now. */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="hud-label shrink-0">{t('board.runePool')}</span>
        {/* Ready / channeled. Overlapping runes are quick to read at a glance
            but slow to count, so the count is printed. */}
        <span className="text-micro text-txtDim tabular-nums shrink-0">
          {pool.energy}/{pool.channeled.length}
        </span>
        <div
          className="flex items-baseline gap-1 px-1.5 py-0.5 border border-accent/60 bg-accent/10 tabular-nums"
          title={t('rune.energyTip')}
        >
          <span className="text-accent text-base font-bold leading-none">⚡{pool.energy}</span>
        </div>
        <div
          className={clsx(
            'flex items-baseline gap-1 px-1.5 py-0.5 border tabular-nums transition-colors',
            pool.power > 0 ? 'border-gold/70 bg-gold/10' : 'border-line/60 bg-black/20',
          )}
          title={t('rune.powerTip')}
        >
          <span
            className={clsx(
              'text-base font-bold leading-none',
              pool.power > 0 ? 'text-gold' : 'text-txtFaint',
            )}
          >
            ◈{pool.power}
          </span>
        </div>
      </div>
      {/* Every channeled / recycled rune, overlapping like a held fan.
          A wrapping grid needed a scrollbar past about eight runes, and a rune
          you have to scroll to find is a rune you forget you have. Overlapping
          keeps the whole pool on one line at any count: the step shrinks as the
          pool grows so the strip is always five rune-widths wide. Hovering
          brings one to the front, and each stays individually clickable. */}
      <div className="flex items-end min-w-0" style={{ height: 'calc(var(--rune-w) * 1.4)' }}>
        {chips.map((c, i) => (
          <div
            key={i}
            className="shrink-0 transition-transform duration-200 ease-calm hover:-translate-y-1.5 hover:z-20 focus-within:z-20"
            style={{
              marginLeft: i === 0 ? 0 : `calc(var(--rune-w) * -${(1 - step).toFixed(3)})`,
              zIndex: i,
            }}
          >
            <RuneChip
              card={c.card}
              state={c.state}
              onRecycle={
                onRecycle && c.state !== 'recycled' ? () => onRecycle(c.card.id) : undefined
              }
            />
          </div>
        ))}
        {chips.length === 0 && (
          <span className="text-txtFaint text-micro self-end pb-1">{t('board.noRunes')}</span>
        )}
      </div>
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
  const t = useT()
  const Grid = ({ label, cards }: { label: string; cards: Card[] }) => (
    <div className="mb-3">
      <div className="hud-label mb-1">
        {label} · {cards.length}
      </div>
      {cards.length === 0 ? (
        <p className="text-txtFaint text-xs">{t('piles.empty')}</p>
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
    <Modal title={t(side === 'player' ? 'piles.yours' : 'piles.ais')} onClose={onClose} wide>
      <Grid label={t('piles.trash')} cards={trash} />
      <Grid label={t('piles.banished')} cards={banished} />
    </Modal>
  )
}

function ChoiceModal({
  choice,
  zoneCards,
  textOptions,
  optionValues,
  picks,
  onToggle,
  onSubmit,
}: {
  choice: PendingChoice
  zoneCards: Card[]
  textOptions?: string[]
  /** What `onToggle` receives per option (defaults to the label itself). */
  optionValues?: string[]
  picks: string[]
  onToggle: (id: string) => void
  onSubmit: () => void
}) {
  const t = useT()
  const labelKo = useLabelKo()
  return (
    <Modal title={labelKo(choice.label, 'choice')} onClose={onSubmit}>
      <p className="hud-label normal-case tracking-normal mb-4">
        {choice.kind === 'confirm'
          ? t('choice.optional')
          : choice.min === choice.max
            ? t('choice.pickN', { n: choice.max })
            : t('choice.pickRange', { min: choice.min, max: choice.max })}
      </p>
      {textOptions ? (
        <div className="flex flex-col gap-2">
          {textOptions.map((opt, i) => {
            const val = optionValues?.[i] ?? opt
            return (
              <button
                key={val}
                onClick={() => onToggle(val)}
                className={clsx(
                  'px-4 py-2 border text-xs font-bold uppercase tracking-wide transition-colors',
                  picks.includes(val)
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-line text-txt hover:border-accent',
                )}
              >
                {opt}
              </button>
            )
          })}
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
          {zoneCards.length === 0 && (
            <p className="text-txtFaint text-sm">{t('choice.nothing')}</p>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        {choice.min === 0 && (
          <Btn onClick={onSubmit}>
            {t(choice.kind === 'confirm' ? 'common.decline' : 'common.skip')}
          </Btn>
        )}
        <Btn variant="primary" onClick={onSubmit} disabled={picks.length < choice.min}>
          {t('common.confirm')}
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
  targetTone,
  gearByUnit,
  linkedUnit,
  onLink,
  onHover,
  onHoverUnit,
  changedIds,
  dragHandleFor,
  draggingUnitId,
  dropPropsFor,
}: {
  units: UnitInPlay[]
  side: 'player' | 'ai'
  selectedUnit?: string | null
  onUnitClick?: (u: UnitInPlay) => void
  highlightIds?: Set<string>
  targetTone?: 'buff' | 'harm' | 'neutral'
  gearByUnit?: Map<string, GearInPlay[]>
  linkedUnit?: string | null
  onLink?: (unitId: string | null) => void
  onHover?: (c: Card | null) => void
  onHoverUnit?: (u: UnitInPlay | null) => void
  changedIds?: Set<string>
  /** Drag props for one unit, or nothing if this side cannot be dragged. */
  dragHandleFor?: (u: UnitInPlay) => Record<string, unknown> | undefined
  draggingUnitId?: string | null
  /** Makes each unit a drop target for a dragged spell or gear. */
  dropPropsFor?: (u: UnitInPlay) => {
    dropZone: Record<string, unknown>
    dropOk: boolean
    dropHot: boolean
  }
}) {
  if (units.length === 0) return null
  return (
    <div
      className={clsx(
        'px-2 py-1 flex gap-1.5 flex-wrap',
        side === 'ai' ? 'content-start' : 'content-end',
      )}
    >
      {units.map((u) => (
        <BoardUnit
          key={u.instanceId}
          unit={u}
          side={side}
          big
          selected={selectedUnit === u.instanceId}
          targetable={highlightIds?.has(u.instanceId)}
          targetTone={targetTone}
          attachedGear={gearByUnit?.get(u.instanceId)}
          linked={linkedUnit === u.instanceId}
          onLink={onLink}
          onClick={() => onUnitClick?.(u)}
          onHover={onHover}
          onHoverUnit={onHoverUnit}
          changed={changedIds?.has(u.instanceId)}
          dragHandle={dragHandleFor?.(u)}
          dragging={draggingUnitId === u.instanceId}
          {...dropPropsFor?.(u)}
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
  targetTone = 'neutral',
  attachedGear,
  linked,
  onLink,
  onClick,
  onHover,
  onHoverUnit,
  changed,
  dragHandle,
  dragging,
  dropZone,
  dropOk,
  dropHot,
}: {
  unit: UnitInPlay
  side: 'player' | 'ai'
  big?: boolean
  selected?: boolean
  targetable?: boolean
  /** Colours the "legal target" ring by what picking it does. */
  targetTone?: 'buff' | 'harm' | 'neutral'
  /** Gear attached to this unit — shown as thumbnails on the tile. */
  attachedGear?: GearInPlay[]
  /** True while this unit or one of its gear is hovered. */
  linked?: boolean
  onLink?: (unitId: string | null) => void
  onClick?: () => void
  onHover?: (c: Card | null) => void
  /** Reports the whole unit, so the preview can explain its Might. */
  onHoverUnit?: (u: UnitInPlay | null) => void
  /** Something about this unit moved while it was not your turn. */
  changed?: boolean
  /** Spread from `useDragDrop` so the unit can be dragged to a new location. */
  dragHandle?: Record<string, unknown>
  /** True while this unit is the one in flight — the ghost stands in for it. */
  dragging?: boolean
  /** Spread from `useDragDrop` so a spell or gear can be dropped on this unit. */
  dropZone?: Record<string, unknown>
  /** A drag in flight could legally land here. */
  dropOk?: boolean
  /** …and the pointer is over it right now. */
  dropHot?: boolean
}) {
  const t = useT()
  const equipped = (attachedGear?.length ?? 0) > 0
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
      data-unit-id={unit.instanceId}
      {...dropZone}
      {...dragHandle}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
      onMouseEnter={() => {
        onHover?.(unit.card)
        onHoverUnit?.(unit)
        if (equipped) onLink?.(unit.instanceId)
      }}
      onMouseLeave={() => {
        onHover?.(null)
        onHoverUnit?.(null)
        if (equipped) onLink?.(null)
      }}
      className={clsx(
        'relative border transition-all animate-[rb-pop_0.28s_ease-out]',
        changed && 'rb-changed',
        dragging && 'opacity-25',
        dragHandle && 'cursor-grab active:cursor-grabbing',
        dropHot && 'ring-2 ring-accentBright scale-110 z-30',
        dropOk && !dropHot && 'ring-2 ring-accent/70',
        // Gear thumbnails hang off the tile edge, so no clipping while linked.
        equipped ? 'overflow-visible' : 'overflow-hidden',
        big ? 'w-[var(--unit-w-big)]' : 'w-[var(--unit-w)]',
        selected
          ? 'border-accent -translate-y-0.5'
          : targetable
            ? clsx(
                'ring-2 ring-offset-0 animate-pulse',
                targetTone === 'buff'
                  ? 'border-accent ring-accent/60'
                  : targetTone === 'harm'
                    ? 'border-danger ring-danger/60'
                    : 'border-hextech ring-hextech/60',
              )
            : linked
              ? 'border-hextech ring-2 ring-hextech/70'
              : empowered
              ? 'border-accent'
              : side === 'player'
                ? 'border-line2'
                : 'border-line',
        // Exhausted units lie on their side, like a tapped card.
        unit.exhausted &&
          (big
            ? 'rotate-90 mx-[calc(var(--unit-w-big)*0.22)] opacity-70'
            : 'rotate-90 mx-[calc(var(--unit-w)*0.22)] opacity-70'),
      )}
      title={
        unit.card.name +
        (empowered ? t('board.unitEmpowered') : '') +
        (unit.exhausted ? t('board.unitExhausted') : '')
      }
    >
      <CardArt card={unit.card} size="sm" preview={false} badge={false} />

      {/* Top edge — energy cost (left) and effective Might (right). Nothing else
          lives up here, so the two never collide. */}
      <span className="absolute top-0 left-0 bg-accent text-black text-micro font-bold min-w-4 h-4 px-0.5 flex items-center justify-center leading-none">
        {unit.card.energy}
      </span>
      <span
        className={clsx(
          'absolute top-0 right-0 bg-black/90 text-tiny font-bold px-1 tabular-nums leading-none flex items-baseline gap-0.5',
          stunned
            ? 'text-txtFaint line-through'
            : bonus > 0
              ? 'text-accent'
              : bonus < 0
                ? 'text-danger'
                : 'text-white',
        )}
        title={
          bonus !== 0
            ? t('board.mightBase', { base, bonus: `${bonus > 0 ? '+' : ''}${bonus}` })
            : t('board.mightPlain', { n: base })
        }
      >
        {Math.max(0, base + bonus)}⚔
        {bonus !== 0 && (
          <sup className="text-micro font-bold opacity-90">
            {bonus > 0 ? '+' : ''}
            {bonus}
          </sup>
        )}
      </span>

      {/* One status row just above the name bar — every marker in a single strip. */}
      {(empowered || buffed || shield > 0 || stunned || unit.sick || grantChips.length > 0) && (
        <span className="absolute bottom-[11px] inset-x-0 flex flex-wrap justify-center gap-0.5 px-0.5 leading-none">
          {empowered && <span className="bg-accent text-black text-micro font-bold px-0.5" title={t('status.empowered')}>⚡</span>}
          {buffed && <span className="bg-black/80 text-accent text-micro px-0.5" title={t('badge.buffCounter')}>◆</span>}
          {shield > 0 && <span className="bg-black/80 text-hextech text-micro px-0.5" title={t('badge.shield')}>⛨</span>}
          {stunned && <span className="bg-black/80 text-accent text-micro px-0.5" title={t('badge.stunned')}>✦</span>}
          {unit.sick && !stunned && <span className="bg-black/80 text-txtDim text-micro px-0.5" title={t('badge.sick')}>💤</span>}
          {grantChips.map((c, i) => (
            <span key={i} className="bg-hextech text-white text-micro font-bold px-0.5" title={t('badge.granted')}>
              {c}
            </span>
          ))}
        </span>
      )}

      <span className="absolute bottom-0 inset-x-0 bg-black/85 text-micro leading-tight truncate px-0.5 uppercase">
        {unit.card.name.split(/[ ,–-]/)[0]}
      </span>

      {/* Attached gear, as its own art — you can see *what* a unit carries, not
          just that it carries something. Hangs off the left edge so it never
          covers the might badge or the name bar. */}
      {attachedGear && attachedGear.length > 0 && (
        <span className="absolute top-4 -left-1.5 flex flex-col gap-0.5 z-20">
          {attachedGear.map((g) => (
            <span
              key={g.instanceId}
              title={`${g.card.name} → ${unit.card.name}`}
              className={clsx(
                'block w-[calc(var(--unit-w)*0.42)] border shadow-md transition-all',
                linked ? 'border-hextech scale-110' : 'border-accent/80',
                g.exhausted && 'opacity-60',
              )}
            >
              <CardArt card={g.card} size="sm" preview={false} badge={false} />
            </span>
          ))}
        </span>
      )}
    </button>
  )
}
