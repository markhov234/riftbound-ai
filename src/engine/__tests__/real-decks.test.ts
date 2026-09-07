import { describe, expect, it } from 'vitest'
import { Card, Deck } from '../../types/card'
import { AIDifficulty, GameState } from '../../types/game'
import { __setCardData } from '../../data/cardStore'
import { buildPresetDecks, PRESET_SPECS } from '../../data/presetDecks'
import { dispatch } from '../actions'
import { makeSpellItem } from '../stack'
import { legalStackTargets, legalUnitTargets, TargetSpec } from '../abilities/targets'
import poolData from './fixtures/card-pool.json'
import { scriptFor } from '../abilities/scripts'
import { setCardPool } from '../state'
import { initGame } from '../setup'
import { seededRng } from './fixtures'
import { checkInvariants, playGame } from './_fuzzlib'

/**
 * The real four preset decks, built from a trimmed snapshot of the live card
 * pool (scripts/gen-card-pool-fixture.mts). Two passes:
 *   1. every distinct main-deck card is cast / played with heuristic targets and
 *      must resolve without crashing, changing state, and never logging an
 *      "unimplemented" line;
 *   2. full AI-vs-bot games for each deck pairing hold every engine invariant.
 */

const POOL = poolData as unknown as Card[]

__setCardData(POOL)
setCardPool(POOL)
const DECKS: Deck[] = buildPresetDecks(POOL)
const byId = new Map(POOL.map((c) => [c.id, c]))

function deckCards(d: Deck): Card[] {
  const seen = new Set<string>()
  const out: Card[] = []
  for (const e of d.cards) {
    const c = byId.get(e.cardId)
    if (c && !seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}

/** A board with two friendly units (base + bf0) and two enemies (bf0), ample runes. */
function primed(playerDeck: Deck, aiDeck: Deck): GameState {
  let s = initGame(playerDeck, aiDeck, POOL, { firstPlayer: 'player', rng: seededRng(7) })
  s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
  s = dispatch(s, { type: 'KEEP_HAND' }, 'ai')
  const bodies = POOL.filter((c) => c.type === 'unit' && c.supertype !== 'token' && c.might >= 3)
  let n = 0
  const mk = (
    card: Card,
    owner: 'player' | 'ai',
    loc: GameState['battlefields'][0]['units'][0]['location'],
  ) => ({
    instanceId: `p${++n}`,
    card,
    owner,
    location: loc,
    exhausted: false,
    damage: 0,
    counters: {} as Record<string, number>,
    sick: false,
  })
  s = {
    ...s,
    player: {
      ...s.player,
      identity: ['fury', 'calm', 'mind', 'body', 'order', 'chaos'],
      runes: { ...s.player.runes, energy: 20, power: 20 },
      base: [mk(bodies[0], 'player', { kind: 'base' })],
    },
    battlefields: s.battlefields.map((bf) =>
      bf.index === 0
        ? {
            ...bf,
            units: [
              mk(bodies[1], 'player', { kind: 'battlefield', index: 0 }),
              mk(bodies[2], 'ai', { kind: 'battlefield', index: 0 }),
              mk(bodies[3], 'ai', { kind: 'battlefield', index: 0 }),
            ],
          }
        : bf,
    ),
  }
  return s
}

/** Fill each target slot with a same-polarity legal id (repeats allowed). */
function chooseTargets(s: GameState, specs?: TargetSpec[]): { ids: string[]; stackId?: string } {
  const ids: string[] = []
  let stackId: string | undefined
  for (const spec of specs ?? []) {
    if (spec.kind === 'player' || spec.kind === 'self') continue
    if (spec.kind === 'stackSpell') {
      stackId = legalStackTargets(s, spec)[0]?.id
      continue
    }
    const legal = legalUnitTargets(s, 'player', spec)
    if (legal.length === 0) continue
    for (let i = 0; i < (spec.count ?? 1); i++) ids.push((legal[i] ?? legal[0]).instanceId)
  }
  return { ids, stackId }
}

describe('preset decks — every card is playable without breaking the engine', () => {
  for (const [di, deck] of DECKS.entries()) {
    describe(PRESET_SPECS[di].name, () => {
      for (const card of deckCards(deck)) {
        if (card.type === 'legend' || card.type === 'rune' || card.type === 'battlefield') continue
        it(`plays ${card.name}`, () => {
          let s = primed(deck, DECKS[(di + 1) % DECKS.length])
          s = { ...s, player: { ...s.player, hand: [card] } }

          const specs = scriptFor(card)?.play?.targets
          // Counter spells need something to counter — seed a cheap dummy spell.
          if ((specs ?? []).some((sp) => sp.kind === 'stackSpell')) {
            const victim = POOL.find((c) => c.type === 'spell' && c.energy <= 2 && c.power === 0)!
            s = { ...s, stack: [makeSpellItem('ai', victim, [])] }
          }
          const logBefore = s.log.length

          const { ids, stackId: targetStackId } = chooseTargets(s, specs)

          const action =
            card.type === 'unit'
              ? ({ type: 'PLAY_UNIT', card, to: { kind: 'base' } } as const)
              : card.type === 'gear'
                ? ({ type: 'PLAY_GEAR', card, targetInstanceIds: ids } as const)
                : ({ type: 'PLAY_SPELL', card, targetInstanceIds: ids, targetStackId } as const)

          let after = dispatch(s, action, 'player')
          // Drain the stack + any player choice.
          let guard = 0
          while (
            (after.stack.length > 0 || after.pendingChoices[0]?.controller === 'player') &&
            guard++ < 10
          ) {
            if (after.pendingChoices[0]?.controller === 'player') {
              const ch = after.pendingChoices[0]
              after = dispatch(
                after,
                { type: 'RESOLVE_CHOICE', pickedIds: ch.legalIds.slice(0, Math.max(ch.min, 0)) },
                'player',
              )
            } else {
              after = dispatch(after, { type: 'PASS_PRIORITY' }, after.priority)
              after = dispatch(after, { type: 'PASS_PRIORITY' }, after.priority)
            }
          }

          expect(
            after.log.some((l) => /not implemented|Cannot read|undefined/i.test(l)),
            `${card.name}: no crash/unimplemented line`,
          ).toBe(false)
          expect(after.log.length, `${card.name}: produced some state change`).toBeGreaterThan(logBefore)
          expect(after.winner).toBeNull()
          checkInvariants(after, `play ${card.name}`)
        })
      }
    })
  }
})

describe('preset decks — full-game invariant fuzz (real cards)', () => {
  const pairs: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]
  for (const difficulty of ['medium', 'hard'] as AIDifficulty[]) {
    for (const [a, b] of pairs) {
      it(`[${difficulty}] ${PRESET_SPECS[a].name} vs ${PRESET_SPECS[b].name}`, () => {
        for (let i = 0; i < 3; i++) {
          const seed = i * 13 + 5
          playGame({
            playerDeck: DECKS[a],
            aiDeck: DECKS[b],
            pool: POOL,
            seed,
            rng: seededRng(seed),
            difficulty,
            label: `${PRESET_SPECS[a].name} vs ${PRESET_SPECS[b].name} seed ${seed} [${difficulty}]`,
          })
        }
      })
    }
  }
})
