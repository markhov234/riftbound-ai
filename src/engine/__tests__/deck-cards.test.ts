import { describe, expect, it } from 'vitest'
import { Domain } from '../../types/card'
import { GameState } from '../../types/game'
import { dispatch } from '../actions'
import { scriptFor } from '../abilities/scripts'
import { legalStackTargets, legalUnitTargets, TargetSpec } from '../abilities/targets'
import { makeCard, placeAtBase, placeUnitAt, startedGame, withHand } from './fixtures'

/**
 * Re-audit harness: cast every distinct spell/gear that appears in the four
 * preset decks (texts transcribed from the live pool) and assert it (a) actually
 * gets played, (b) changes the game state, and (c) never removes a friendly unit
 * from play as a side effect.
 */

const ALL: Domain[] = ['fury', 'calm', 'mind', 'body', 'order', 'chaos']

interface SpellSpec {
  name: string
  type: 'spell' | 'gear'
  domains: Domain[]
  energy: number
  power?: number
  text: string
}

const DECK_SPELLS: SpellSpec[] = [
  // Irelia
  { name: 'Discipline', type: 'spell', domains: ['calm'], energy: 2, text: 'Give a unit +2 :rb_might: this turn. Draw 1.' },
  { name: 'En Garde', type: 'spell', domains: ['calm'], energy: 1, text: 'Give a friendly unit +1 :rb_might: this turn, then an additional +1 :rb_might: this turn if it is the only unit you control there.' },
  { name: 'Gust', type: 'spell', domains: ['chaos'], energy: 1, text: 'Return a unit at a battlefield with 3 :rb_might: or less to its owner’s hand.' },
  { name: 'Ride the Wind', type: 'spell', domains: ['calm'], energy: 1, text: 'Ready a friendly unit. If it is at a battlefield, move it and ready it.' },
  { name: 'Stacked Deck', type: 'spell', domains: ['chaos'], energy: 1, text: 'Look at the top 3 cards of your Main Deck. Put 1 into your hand and recycle the rest.' },
  { name: 'Defiant Dance', type: 'spell', domains: ['calm', 'chaos'], energy: 1, power: 1, text: 'Give a unit +2 :rb_might: this turn and another unit -2 :rb_might: this turn.' },
  { name: 'Heart of Dark Ice', type: 'gear', domains: ['calm'], energy: 3, power: 1, text: ':rb_exhaust:: Give a unit +3 :rb_might: this turn.' },
  { name: 'Guardian Angel', type: 'gear', domains: ['calm'], energy: 2, text: '[Equip] :rb_rune_calm: Attach this to a unit you control.' },
  // Annie
  { name: 'Cleave', type: 'spell', domains: ['fury'], energy: 1, text: 'Give a unit [Assault 3] this turn.' },
  { name: 'Flash', type: 'spell', domains: ['chaos'], energy: 2, text: 'Move up to 2 friendly units to base.' },
  { name: 'Rebuke', type: 'spell', domains: ['chaos'], energy: 2, power: 2, text: 'Return a unit at a battlefield to its owner’s hand.' },
  // Zed
  { name: 'Twilight Step', type: 'spell', domains: ['chaos'], energy: 2, power: 1, text: 'Move a unit with 3 :rb_might: or less.' },
  { name: 'Ruthless Strike', type: 'spell', domains: ['fury'], energy: 3, text: 'As an additional cost to play this, you may discard 1. Deal 3 to a unit at a battlefield. If you paid the additional cost, deal 5 to it instead.' },
  { name: 'Perfect Execution', type: 'spell', domains: ['fury'], energy: 3, power: 1, text: 'Ready a unit and give it [Assault 3] this turn.' },
  { name: 'Death Mark', type: 'spell', domains: ['fury', 'chaos'], energy: 2, power: 1, text: '[Burn 3]. Play a 0 :rb_might: Shadow Clone unit token.' },
  { name: 'Shadows of the Past', type: 'spell', domains: ['chaos'], energy: 3, power: 1, text: 'Return up to 2 units from trashes to their owners’ hands.' },
  // Jayce
  { name: 'Tools of Empire', type: 'gear', domains: ['body'], energy: 4, text: ':rb_exhaust:: Give a unit +2 :rb_might: this turn. If this is [Empowered], give that unit +4 :rb_might: this turn instead.' },
  { name: 'Shock Blast', type: 'spell', domains: ['mind'], energy: 3, power: 1, text: 'Deal 4 to a unit at a battlefield.' },
  { name: 'Acceleration Gate', type: 'spell', domains: ['mind', 'body'], energy: 3, power: 1, text: 'Ready up to 4 units, gear, and/or runes.' },
  { name: 'Iterative Design', type: 'spell', domains: ['mind'], energy: 4, text: 'Play a 3 :rb_might: Mech unit token.' },
  { name: 'Hextech Formula', type: 'gear', domains: ['mind'], energy: 2, text: 'This enters exhausted. :rb_exhaust:: Empower another gear.' },
]

function board(): GameState {
  let s = startedGame({ firstPlayer: 'player' })
  s = {
    ...s,
    player: {
      ...s.player,
      identity: ALL,
      runes: { ...s.player.runes, energy: 20, power: 20 },
    },
  }
  s = placeAtBase(s, 'player', makeCard({ name: 'Homebody', type: 'unit', domains: ['fury'], energy: 2, might: 2 }))
  s = placeUnitAt(s, 'ai', makeCard({ name: 'Enemy', type: 'unit', domains: ['fury'], energy: 2, might: 3 }), 0)
  return s
}

const friendlyInPlay = (s: GameState) =>
  new Set(
    [...s.player.base, ...s.battlefields.flatMap((b) => b.units).filter((u) => u.owner === 'player')].map(
      (u) => u.instanceId,
    ),
  )

/** Fill each target slot with a legal id, preferring an enemy unit (repeats OK). */
function chooseTargets(s: GameState, specs?: TargetSpec[]): { ids: string[]; stackId?: string } {
  const ids: string[] = []
  let stackId: string | undefined
  const enemyIds = new Set(
    s.battlefields.flatMap((b) => b.units).filter((u) => u.owner === 'ai').map((u) => u.instanceId),
  )
  for (const spec of specs ?? []) {
    if (spec.kind === 'player' || spec.kind === 'self') continue
    if (spec.kind === 'stackSpell') {
      stackId = legalStackTargets(s, spec)[0]?.id
      continue
    }
    const legal = legalUnitTargets(s, 'player', spec)
    if (legal.length === 0) continue
    // Prefer an enemy for every slot so a heuristic pick never lands on a
    // friendly (some compiled effects re-resolve "it" as a fresh target).
    const preferred = legal.find((u) => enemyIds.has(u.instanceId))?.instanceId ?? legal[0].instanceId
    const need = spec.count ?? 1
    for (let i = 0; i < need; i++) ids.push(preferred)
  }
  return { ids, stackId }
}

describe('preset-deck spells cast cleanly', () => {
  for (const spec of DECK_SPELLS) {
    it(`${spec.name} is played, changes state, and keeps friendlies in play`, () => {
      const card = makeCard({ ...spec, power: spec.power ?? 0 })
      let s = board()
      s = withHand(s, 'player', [card])

      const logBefore = s.log.length
      const friendlyBefore = friendlyInPlay(s)

      const specs = scriptFor(card)?.play?.targets
      const { ids, stackId } = chooseTargets(s, specs)
      const action =
        spec.type === 'gear'
          ? ({ type: 'PLAY_GEAR', card, targetInstanceIds: ids } as const)
          : ({ type: 'PLAY_SPELL', card, targetInstanceIds: ids, targetStackId: stackId } as const)

      let after = dispatch(s, action, 'player')
      expect(after.log.some((l) => l.includes(`plays ${spec.name}`))).toBe(true)

      // Drain the stack + any queued player choice.
      let guard = 0
      while ((after.stack.length > 0 || after.pendingChoices[0]?.controller === 'player') && guard++ < 8) {
        if (after.pendingChoices[0]?.controller === 'player') {
          after = dispatch(after, { type: 'RESOLVE_CHOICE', pickedIds: [] }, 'player')
        } else {
          after = dispatch(after, { type: 'PASS_PRIORITY' }, after.priority)
          after = dispatch(after, { type: 'PASS_PRIORITY' }, after.priority)
        }
      }

      expect(after.log.length).toBeGreaterThan(logBefore)
      expect(after.winner).toBeNull()
      const friendlyAfter = friendlyInPlay(after)
      for (const id of friendlyBefore) expect(friendlyAfter.has(id)).toBe(true)
    })
  }
})
