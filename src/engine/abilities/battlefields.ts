import { Card } from '../../types/card'
import { GameState, UnitInPlay } from '../../types/game'
import { compileEffect, compileTargets } from './compile'
import { Effect, predictChoice, revealTopChooseToHand } from './effects'
import { TargetSpec } from './targets'

/**
 * Battlefield card abilities. Battlefields are ability sources too — a
 * "When you conquer/hold here, …" clause fires for whoever conquers / holds it,
 * and some battlefields grant a static aura to every unit standing on them.
 *
 * Static-aura cost modifiers (Piltovan Forge, Risen Altar, Mystic Vortex) and
 * clauses that need events the engine lacks (Ravenbloom "when you defend here",
 * Threshold of the Gray "when combat starts here") are not handled yet.
 */

export interface BattlefieldTrigger {
  on: 'CONQUERED' | 'HELD' | 'DEFENDED'
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

/** The aura the unit's current battlefield grants it (0 / none off a battlefield). */
export function battlefieldAura(state: GameState, unit: UnitInPlay): BattlefieldAura {
  if (unit.location.kind !== 'battlefield') return NONE
  const card = state.battlefields[unit.location.index]?.card
  if (!card?.text) return NONE
  const t = card.text.toLowerCase()

  let might = 0
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
