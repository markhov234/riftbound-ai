import { describe, expect, it } from 'vitest'
import { GameState } from '../../types/game'
import { dispatch } from '../actions'
import { _clearCompileCache } from '../abilities/compile'
import { CARD_SCRIPTS, normKey, scriptFor } from '../abilities/scripts'
import { readyPermanentsChoice, readyRuneAt } from '../abilities/effects'
import { grunt, makeCard, placeUnitAt, startedGame, withHand } from './fixtures'

_clearCompileCache()

const accelGate = makeCard({
  name: 'Acceleration Gate',
  type: 'spell',
  domains: ['fury'],
  energy: 3,
  text: 'Ready up to 4 units, gear, and/or runes.',
})

const someGear = makeCard({
  name: 'Test Widget',
  type: 'gear',
  domains: ['fury'],
  energy: 1,
  text: 'This enters exhausted. :rb_exhaust:: Draw 1.',
})

/** Two exhausted units, one exhausted gear and two spent runes. */
function messyBoard(): GameState {
  let s = startedGame({ firstPlayer: 'player' })
  s = placeUnitAt(s, 'player', grunt, 0)
  s = placeUnitAt(s, 'player', grunt, 0)
  s = {
    ...s,
    battlefields: s.battlefields.map((bf, i) =>
      i === 0 ? { ...bf, units: bf.units.map((u) => ({ ...u, exhausted: true })) } : bf,
    ),
    player: {
      ...s.player,
      gear: [
        {
          instanceId: 'g1',
          card: someGear,
          owner: 'player' as const,
          exhausted: true,
          counters: {},
        },
      ],
      runes: {
        ...s.player.runes,
        spent: s.player.runes.channeled.slice(0, 2),
      },
    },
  }
  return s
}

describe('Acceleration Gate readies units, gear AND runes', () => {
  it('is scripted (the compiler only ever produced one unit target)', () => {
    // "ready ... unit" matched the generic ready-a-unit op, which readies
    // exactly one unit and can't touch gear or runes.
    expect(CARD_SCRIPTS[normKey('Acceleration Gate')]).toBeTruthy()
    expect(scriptFor(accelGate)?.play).toBeTruthy()
  })

  it('offers every exhausted unit, gear and spent rune as one list', () => {
    const s = messyBoard()
    const after = readyPermanentsChoice(s, 'player', 4)
    const choice = after.pendingChoices[0]
    expect(choice).toBeTruthy()
    expect(choice.kind).toBe('permanent')
    expect(choice.max).toBe(4)
    expect(choice.min).toBe(0) // "up to" — skippable
    // 2 units + 1 gear + 2 runes
    expect(choice.legalIds).toHaveLength(5)
    expect(choice.legalIds.filter((id) => id.startsWith('u:'))).toHaveLength(2)
    expect(choice.legalIds.filter((id) => id.startsWith('g:'))).toHaveLength(1)
    expect(choice.legalIds.filter((id) => id.startsWith('r:'))).toHaveLength(2)
    expect(choice.optionLabels).toHaveLength(5)
  })

  it('readies one of each kind when picked', () => {
    const s = messyBoard()
    const queued = readyPermanentsChoice(s, 'player', 4)
    const choice = queued.pendingChoices[0]
    const pick = [
      choice.legalIds.find((i) => i.startsWith('u:'))!,
      choice.legalIds.find((i) => i.startsWith('g:'))!,
      choice.legalIds.find((i) => i.startsWith('r:'))!,
    ]
    const after = choice.resolve(pick)(queued)

    expect(after.battlefields[0].units.filter((u) => !u.exhausted)).toHaveLength(1)
    expect(after.player.gear[0].exhausted).toBe(false)
    expect(after.player.runes.spent).toHaveLength(1) // one un-spent
  })

  it('caps at the stated maximum', () => {
    const s = messyBoard()
    const queued = readyPermanentsChoice(s, 'player', 2)
    const choice = queued.pendingChoices[0]
    const after = choice.resolve(choice.legalIds)(queued) // try to take all 5
    const readied =
      after.battlefields[0].units.filter((u) => !u.exhausted).length +
      (after.player.gear[0].exhausted ? 0 : 1) +
      (s.player.runes.spent.length - after.player.runes.spent.length)
    expect(readied).toBe(2)
  })

  it('the AI resolves it without a prompt', () => {
    const s = { ...messyBoard(), ai: { ...messyBoard().ai } }
    const after = readyPermanentsChoice(s, 'ai', 4)
    expect(after.pendingChoices).toHaveLength(0)
  })

  it('readying a rune frees it for another pip', () => {
    const s = messyBoard()
    const before = s.player.runes.spent.length
    const after = readyRuneAt(s, 'player', 0)
    expect(after.player.runes.spent).toHaveLength(before - 1)
  })

  it('casting it queues the picker', () => {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', grunt, 0)
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, units: bf.units.map((u) => ({ ...u, exhausted: true })) } : bf,
      ),
      player: { ...s.player, runes: { ...s.player.runes, energy: 9 } },
    }
    s = withHand(s, 'player', [accelGate])
    let after = dispatch(s, { type: 'PLAY_SPELL', card: accelGate }, 'player')
    after = dispatch(after, { type: 'PASS_PRIORITY' }, 'player')
    after = dispatch(after, { type: 'PASS_PRIORITY' }, 'ai')
    expect(after.pendingChoices[0]?.kind).toBe('permanent')
  })
})

describe('CARD_SCRIPTS registry', () => {
  it('has no duplicate keys', () => {
    // `Object.fromEntries` lets a later `R(name, …)` silently replace an earlier
    // one — that is how a second Guardian Angel entry wiped out its play effect.
    const keys = Object.keys(CARD_SCRIPTS)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
