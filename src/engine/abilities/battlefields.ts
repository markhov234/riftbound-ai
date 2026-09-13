import { Card } from '../../types/card'
import { GameState, UnitInPlay } from '../../types/game'
import { compileEffect, compileTargets } from './compile'
import {
  burn,
  confirmChoice,
  dealDamage,
  draw,
  Effect,
  giveMight,
  grantKeywordThisTurn,
  killUnit,
  optionalPayChoice,
  pickUnitChoice,
  predictChoice,
  readyGearById,
  revealTopChooseToHand,
} from './effects'
import { channelRuneExhausted, recycleRune } from '../runes'
import { hasTemporary, isMighty } from '../keywords'
import { appendLog, controllerOf, getPlayer, updatePlayer } from '../state'
import { TargetSpec } from './targets'

/**
 * Battlefield card abilities. Battlefields are ability sources too — a
 * "When you conquer/hold here, …" clause fires for whoever conquers / holds it,
 * and some battlefields grant a static aura to every unit standing on them.
 *
 * Cost auras do NOT live here. Mystic Vortex (play costs) is in `effectiveCost`
 * and Piltovan Forge / Risen Altar (ability costs) are in `effectiveAbilityCost`
 * — see costs.ts. Clauses that need events the engine lacks (Threshold of the
 * Gray, "when combat starts here") are still unhandled.
 */

export interface BattlefieldTrigger {
  on: 'CONQUERED' | 'HELD' | 'DEFENDED' | 'CARD_PLAYED' | 'TURN_BEGAN'
  targets?: TargetSpec[]
  effect: Effect
}

export interface BattlefieldScript {
  triggers: BattlefieldTrigger[]
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

// Bespoke scripts for battlefields the generic clause compiler can't express.
const BESPOKE: Record<string, BattlefieldScript> = {
  // "When you conquer here, look at the top two cards of your Main Deck. You may
  //  recycle one or both of them. Put those you don't back in any order."
  [norm('The Candlelit Sanctum')]: {
    triggers: [{ on: 'CONQUERED', effect: (ctx) => predictChoice(ctx.state, ctx.controller, 2) }],
  },
  // "When you defend here, reveal the top card of your Main Deck. If it's a spell,
  //  put it in your hand. Otherwise, recycle it."
  [norm('Ravenbloom Conservatory')]: {
    triggers: [{ on: 'DEFENDED', effect: (ctx) => revealTopChooseToHand(ctx.state, ctx.controller) }],
  },
  // "When you hold here, you may channel 1 rune exhausted."
  // Channelling normally readies the rune and adds energy; "exhausted" means it
  // enters spent, so this is a rune added to the pool with no energy.
  [norm('Startipped Peak')]: {
    triggers: [
      {
        on: 'HELD',
        effect: (ctx) =>
          confirmChoice(ctx.state, ctx.controller, 'Startipped Peak — channel 1 rune exhausted?', (s) =>
            channelRuneExhausted(s, ctx.controller),
          ),
      },
    ],
  },
  // "When a player plays a spell, they may give a unit they control here
  //  +1 :rb_might: this turn." Note "a player" — it fires for whoever played
  //  the spell, not only the battlefield's controller.
  [norm('Abandoned Hall')]: {
    triggers: [
      {
        on: 'CARD_PLAYED',
        effect: (ctx) => {
          const e = ctx.event
          if (!e || e.type !== 'CARD_PLAYED' || e.card.type !== 'spell') return ctx.state
          const here = ctx.state.battlefields[ctx.battlefieldIndex ?? -1]
          const mine = here?.units.filter((u) => u.owner === e.controller) ?? []
          if (mine.length === 0) return ctx.state
          return confirmChoice(
            ctx.state,
            e.controller,
            `Abandoned Hall — give a unit here +1 Might?`,
            (s) => giveMight(s, mine[0].instanceId, 1),
          )
        },
      },
    ],
  },
  // ── Conquer clauses the generic compiler can't express ────────────────
  // "When you conquer here, recycle one of your runes."
  [norm('Sigil of the Storm')]: {
    triggers: [{ on: 'CONQUERED', effect: (ctx) => recycleRune(ctx.state, ctx.controller) }],
  },
  // "When you conquer here, put the top 2 cards of your Main Deck into your trash."
  [norm('Minefield')]: {
    triggers: [{ on: 'CONQUERED', effect: (ctx) => burn(ctx.state, ctx.controller, 2) }],
  },
  // "When you conquer here, you may pay :rb_energy_1: to ready your legend."
  [norm('Hall of Legends')]: {
    triggers: [
      {
        on: 'CONQUERED',
        effect: (ctx) =>
          getPlayer(ctx.state, ctx.controller).legendExhausted
            ? optionalPayChoice(
                ctx.state,
                ctx.controller,
                { energy: 1, power: 0, runes: [] },
                'Hall of Legends — ready your legend?',
                (s2) =>
                  appendLog(
                    updatePlayer(s2, ctx.controller, (ps) => ({ ...ps, legendExhausted: false })),
                    'Hall of Legends readies the legend.',
                  ),
              )
            : ctx.state,
      },
    ],
  },
  // "When you conquer here with one or more [Mighty] units, you may pay
  //  :rb_energy_1: to draw 1."
  [norm('Sunken Temple')]: {
    triggers: [
      {
        on: 'CONQUERED',
        effect: (ctx) => {
          const here = ctx.state.battlefields[ctx.battlefieldIndex ?? -1]
          const mighty = (here?.units ?? []).some(
            (u) => u.owner === ctx.controller && isMighty(u, ctx.state, 'attacker'),
          )
          if (!mighty) return ctx.state
          return optionalPayChoice(
            ctx.state,
            ctx.controller,
            { energy: 1, power: 0, runes: [] },
            'Sunken Temple — draw 1?',
            (s2) => draw(s2, ctx.controller, 1),
          )
        },
      },
    ],
  },
  // "When you conquer here, you may ready a friendly gear. If it's an
  //  Equipment, you may detach it." (The detach half is not offered — see
  //  docs/battlefields.md.)
  [norm('Veiled Temple')]: {
    triggers: [
      {
        on: 'CONQUERED',
        effect: (ctx) => {
          const g = getPlayer(ctx.state, ctx.controller).gear.find((x) => x.exhausted)
          if (!g) return ctx.state
          return confirmChoice(ctx.state, ctx.controller, `Veiled Temple — ready ${g.card.name}?`, (s2) =>
            readyGearById(s2, g.instanceId),
          )
        },
      },
    ],
  },

  // ── Hold clauses ──────────────────────────────────────────────────────
  // "When you hold here, if you have 7+ units here, you win the game."
  [norm('The Grand Plaza')]: {
    triggers: [
      {
        on: 'HELD',
        effect: (ctx) => {
          const here = ctx.state.battlefields[ctx.battlefieldIndex ?? -1]
          const mine = (here?.units ?? []).filter((u) => u.owner === ctx.controller)
          if (mine.length < 7) return ctx.state
          return appendLog(
            { ...ctx.state, winner: ctx.controller },
            `The Grand Plaza — ${ctx.controller} wins the game!`,
          )
        },
      },
    ],
  },
  // "When you hold here, each player channels 1 rune exhausted."
  [norm('The Papertree')]: {
    triggers: [
      {
        on: 'HELD',
        effect: (ctx) =>
          channelRuneExhausted(channelRuneExhausted(ctx.state, 'player'), 'ai'),
      },
    ],
  },
  // "When you hold here, you may return your Chosen Champion from your trash to
  //  your Champion Zone if it is empty."
  [norm('Hallowed Tomb')]: {
    triggers: [
      {
        on: 'HELD',
        effect: (ctx) => {
          const ps = getPlayer(ctx.state, ctx.controller)
          if (ps.championZone) return ctx.state
          const i = ps.trash.findIndex((c) => c.id === ps.chosenChampion.id)
          if (i < 0) return ctx.state
          return confirmChoice(
            ctx.state,
            ctx.controller,
            `Hallowed Tomb — return ${ps.chosenChampion.name} to your Champion Zone?`,
            (s2) =>
              appendLog(
                updatePlayer(s2, ctx.controller, (p2) => {
                  const j = p2.trash.findIndex((c) => c.id === p2.chosenChampion.id)
                  if (j < 0) return p2
                  return {
                    ...p2,
                    trash: [...p2.trash.slice(0, j), ...p2.trash.slice(j + 1)],
                    championZone: p2.chosenChampion,
                    championPlayed: false,
                  }
                }),
                `Hallowed Tomb returns ${ps.chosenChampion.name} to the Champion Zone.`,
              ),
          )
        },
      },
    ],
  },

  // ── Start of a Beginning Phase (before scoring) ───────────────────────
  // "At the start of each player's Beginning Phase, deal 1 to each unit here."
  [norm('Frozen Fortress')]: {
    triggers: [
      {
        on: 'TURN_BEGAN',
        effect: (ctx) => {
          const here = ctx.state.battlefields[ctx.battlefieldIndex ?? -1]
          let s2 = ctx.state
          // Snapshot the ids first: `dealDamage` can kill, which reshapes the list.
          for (const id of (here?.units ?? []).map((u) => u.instanceId)) {
            s2 = dealDamage(s2, id, 1, ctx.emit)
            if (s2.winner) return s2
          }
          return s2
        },
      },
    ],
  },
  // "At the start of your Beginning Phase, you may kill a unit you control here
  //  to draw 1."
  [norm('Dusk Rose Lab')]: {
    triggers: [
      {
        on: 'TURN_BEGAN',
        effect: (ctx) => {
          const here = ctx.state.battlefields[ctx.battlefieldIndex ?? -1]
          // "your Beginning Phase" — only the battlefield's controller.
          if (!here || controllerOf(here) !== ctx.controller) return ctx.state
          const mine = here.units.filter((u) => u.owner === ctx.controller)
          if (mine.length === 0) return ctx.state
          const victim = mine[0]
          return confirmChoice(
            ctx.state,
            ctx.controller,
            `Dusk Rose Lab — kill ${victim.card.name} to draw 1?`,
            (s2) => draw(killUnit(s2, victim.instanceId, ctx.emit), ctx.controller, 1),
          )
        },
      },
    ],
  },

  // "When you defend here, choose a unit. It gains [Shield 2] this combat."
  // Granted for the turn rather than "this combat" — the engine has no
  // combat-scoped duration, and a showdown never spans a turn boundary.
  [norm('Fortified Position')]: {
    triggers: [
      {
        on: 'DEFENDED',
        // Battlefield-trigger `targets` are auto-picked, which silently chose
        // for the player. "Choose a unit" is a real decision — the whole point
        // of the card — so this raises its own prompt instead.
        effect: (ctx) => {
          const here = ctx.state.battlefields[ctx.battlefieldIndex ?? -1]
          const mine = (here?.units ?? []).filter((u) => u.owner === ctx.controller)
          if (mine.length === 0) return ctx.state
          return pickUnitChoice(
            ctx.state,
            ctx.controller,
            mine.map((u) => u.instanceId),
            'Fortified Position — which unit gains [Shield 2]?',
            (s2, id) => grantKeywordThisTurn(s2, id, 'Shield', 2),
          )
        },
      },
    ],
  },
}

const _cache = new Map<string, BattlefieldScript>()

export function battlefieldScript(card: Card): BattlefieldScript {
  const key = norm(card.name)
  const hit = _cache.get(key)
  if (hit) return hit

  const bespoke = BESPOKE[key]
  if (bespoke) {
    _cache.set(key, bespoke)
    return bespoke
  }

  const triggers: BattlefieldTrigger[] = []
  const text = card.text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
  for (const [re, on] of [
    [/when you conquer here,\s*([^.]*(?:\.[^.]*)*?)(?:\s*\(|$)/i, 'CONQUERED' as const],
    [/when you hold here,\s*([^.]*(?:\.[^.]*)*?)(?:\s*\(|$)/i, 'HELD' as const],
    [/when you defend here,\s*([^.]*(?:\.[^.]*)*?)(?:\s*\(|$)/i, 'DEFENDED' as const],
  ] as const) {
    const m = text.match(re)
    if (!m) continue
    const clause = m[1].trim()
    const effect = compileEffect(clause)
    if (effect) triggers.push({ on, targets: compileTargets(clause), effect })
  }

  const script: BattlefieldScript = { triggers }
  _cache.set(key, script)
  return script
}

// ── Static auras — read at combat / move time ────────────────────────────

export interface BattlefieldAura {
  might: number
  grantsGanking: boolean
}

const NONE: BattlefieldAura = { might: 0, grantsGanking: false }

/**
 * The aura the unit's current battlefield grants it (0 / none off a battlefield).
 *
 * `role` is optional because most auras are unconditional, but two are not:
 * Black Flame Altar's Shield and Forbidding Waste's penalty only apply while
 * the unit is defending. Callers outside combat pass nothing and get neither.
 */
export function battlefieldAura(
  state: GameState,
  unit: UnitInPlay,
  role?: 'attacker' | 'defender',
): BattlefieldAura {
  if (unit.location.kind !== 'battlefield') return NONE
  const bf = state.battlefields[unit.location.index]
  const card = bf?.card
  if (!card?.text) return NONE
  const t = card.text.toLowerCase()

  let might = 0

  if (role === 'defender') {
    // "Units here with [Temporary] have [Shield]." (+1 while defending.)
    if (/units here with \[temporary\] have \[shield\]/.test(t) && hasTemporary(unit)) might += 1
    // "While a unit here is defending alone, it has -2 [M]."
    const alone = t.match(/while a unit here is defending alone, it has\s*-(\d+)/)
    if (alone) {
      const friends = bf.units.filter((u) => u.owner === unit.owner)
      if (friends.length === 1) might -= parseInt(alone[1], 10)
    }
  }
  // "Units here have +N Might."  /  "Units here with [Tank] have +N Might."
  const plus = t.match(/units here (?:with \[(\w+)\] )?have \+(\d+)\s*(?::rb_might:|\[m\]|might)/)
  if (plus) {
    const gated = plus[1]
    const n = parseInt(plus[2], 10)
    if (!gated || (unit.card.keywords ?? []).some((k) => k.toLowerCase().startsWith(gated))) {
      might += n
    }
  }
  const grantsGanking = /units here have \[ganking\]/.test(t)
  return { might, grantsGanking }
}
