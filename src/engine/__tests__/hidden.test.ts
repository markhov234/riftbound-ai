/**
 * The `[Hidden]` keyword (rule 811) and the Facedown Zone (107.3).
 *
 * 811.1.b: "While this card is in your hand or in your Champion Zone on your
 * turn during an Open State, you may pay [A] to hide this facedown at a
 * battlefield you control that doesn't already have a facedown card hidden
 * there for as long as you control that battlefield. Beginning on the next
 * turn, this gains [Reaction] and you may play this, ignoring its base cost."
 */
import { describe, expect, it } from 'vitest'
import { GameState } from '../../types/game'
import { dispatch } from '../actions'
import { canHide, canPlayFromFacedown, hasHidden, hideBlockedReason } from '../hidden'
import { _clearCompileCache } from '../abilities/compile'
import { makeCard, placeUnitAt, startedGame, withHand } from './fixtures'

_clearCompileCache()

const hiddenSpell = makeCard({
  name: 'Test Ambush',
  type: 'spell',
  domains: ['fury'],
  energy: 3,
  keywords: ['Hidden'],
  text: '[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)Draw 1.',
})
const plainSpell = makeCard({
  name: 'Plain Spell',
  type: 'spell',
  domains: ['fury'],
  energy: 1,
  text: 'Draw 1.',
})
const grunt2 = makeCard({ name: 'Body', type: 'unit', domains: ['fury'], energy: 2, might: 2 })

/**
 * A game where `player` controls bf0 and holds `card`. No Power is banked on
 * purpose: hiding costs `[A]`, which is a rune *pip* — payable by spending one
 * of the runes `startedGame` already channelled, exactly like every other pip.
 */
function ready(card = hiddenSpell): GameState {
  let s = startedGame({ firstPlayer: 'player' })
  s = placeUnitAt(s, 'player', grunt2, 0) // controlling bf0
  s = withHand(s, 'player', [card])
  return { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
}

describe('hiding a card (421 / 811.1.b)', () => {
  it('recognises the keyword', () => {
    expect(hasHidden(hiddenSpell)).toBe(true)
    expect(hasHidden(plainSpell)).toBe(false)
  })

  it('spends a rune for [A] and puts the card in the battlefield’s Facedown Zone', () => {
    const s = ready()
    expect(canHide(s, 'player', hiddenSpell, 0).ok).toBe(true)
    const spentBefore = s.player.runes.spent.length

    const after = dispatch(s, { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    // Paid the same way a printed `:rb_rune_*:` pip is: one channelled rune is
    // marked spent for the turn. No Energy, and no trip through RECYCLE_RUNE.
    expect(after.player.runes.spent).toHaveLength(spentBefore + 1)
    expect(after.player.runes.energy).toBe(s.player.runes.energy)
    expect(after.player.hand).toHaveLength(0)
    expect(after.battlefields[0].facedown?.card.name).toBe('Test Ambush')
    expect(after.battlefields[0].facedown?.owner).toBe('player')
  })

  it('never names the hidden card in the log — it is Private (128.4)', () => {
    const after = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    expect(after.log.some((l) => l.includes('Test Ambush'))).toBe(false)
    expect(after.log.some((l) => /hides a card/.test(l))).toBe(true)
  })

  it('refuses a card without Hidden, and a battlefield you do not control', () => {
    const s = ready(plainSpell)
    expect(canHide(s, 'player', plainSpell, 0).ok).toBe(false)

    // bf1 has nobody on it, so it is Open, not controlled.
    const withHidden = withHand(s, 'player', [hiddenSpell])
    expect(canHide(withHidden, 'player', hiddenSpell, 1).reason).toMatch(/control/)
  })

  it('holds exactly one card (107.3.b)', () => {
    const second = makeCard({ ...hiddenSpell, id: 'second', name: 'Other Ambush' })
    let s = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    s = withHand(s, 'player', [second])
    expect(canHide(s, 'player', second, 0).reason).toMatch(/already hidden/)
  })

  it('is not a play: no chain, and the card is not trashed', () => {
    const after = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    expect(after.stack).toHaveLength(0) // 811.1.c.2
    expect(after.player.trash).toHaveLength(0)
    expect(after.cardsPlayedThisTurn).toBe(0)
  })
})

describe('explaining why you cannot hide', () => {
  it('names the missing Power rather than the battlefield', () => {
    // Order matters: the per-battlefield check used to run first and mask this,
    // so the Hide option silently vanished with no reason a player could act on.
    const s = ready()
    // Every channelled rune already spent on pips this turn — nothing left to pay [A].
    const broke = {
      ...s,
      player: {
        ...s.player,
        runes: { ...s.player.runes, spent: [...s.player.runes.channeled] },
      },
    }
    expect(hideBlockedReason(broke, 'player', hiddenSpell)).toMatch(/Power/)
  })

  it('says you need to control a battlefield when you hold none', () => {
    let s = ready()
    // Strip the unit that was giving control of bf0.
    s = { ...s, battlefields: s.battlefields.map((bf) => ({ ...bf, units: [] })) }
    expect(hideBlockedReason(s, 'player', hiddenSpell)).toMatch(/control a battlefield/)
  })

  it('says the slot is taken once something is already hidden there', () => {
    const s = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    const another = makeCard({ ...hiddenSpell, id: 'another', name: 'Another Ambush' })
    const withPower = { ...withHand(s, 'player', [another]) }
    expect(hideBlockedReason(withPower, 'player', another)).toMatch(/already hides/)
  })

  it('returns null when hiding really is available', () => {
    expect(hideBlockedReason(ready(), 'player', hiddenSpell)).toBeNull()
  })

  it('says so plainly for a card without the keyword', () => {
    expect(hideBlockedReason(ready(plainSpell), 'player', plainSpell)).toMatch(/\[Hidden\]/)
  })
})

describe('playing from facedown (811.1.b / 811.6)', () => {
  it('cannot be played the turn it was hidden', () => {
    const after = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    expect(canPlayFromFacedown(after, 'player', 0).reason).toMatch(/next turn/)

    const tried = dispatch(
      after,
      { type: 'PLAY_SPELL', card: hiddenSpell, fromFacedown: 0 },
      'player',
    )
    expect(tried.stack).toHaveLength(0)
    expect(tried.battlefields[0].facedown).toBeTruthy() // still there
  })

  it('is free from a later turn, and leaves the Facedown Zone', () => {
    let s = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    // Fake the turn rolling over without disturbing the board.
    s = { ...s, turn: s.turn + 2 }
    const energyBefore = s.player.runes.energy
    expect(canPlayFromFacedown(s, 'player', 0).ok).toBe(true)

    const after = dispatch(s, { type: 'PLAY_SPELL', card: hiddenSpell, fromFacedown: 0 }, 'player')
    expect(after.stack).toHaveLength(1)
    expect(after.battlefields[0].facedown).toBeNull()
    // "ignoring its base cost" — the 3-energy spell cost nothing.
    expect(after.player.runes.energy).toBe(energyBefore)
  })

  it('the opponent cannot play your hidden card', () => {
    let s = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    s = { ...s, turn: s.turn + 2 }
    expect(canPlayFromFacedown(s, 'ai', 0).reason).toMatch(/not your hidden card/)
  })
})

describe('losing the battlefield (107.3.d / 461.5.c)', () => {
  it('reveals and trashes the hidden card at the next cleanup', () => {
    let s = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    // The AI takes the battlefield outright: remove the player's only unit there
    // and drop an AI unit in, then end the turn to run the cleanup.
    s = {
      ...s,
      battlefields: s.battlefields.map((bf, i) =>
        i === 0 ? { ...bf, units: bf.units.filter((u) => u.owner !== 'player') } : bf,
      ),
    }
    s = placeUnitAt(s, 'ai', grunt2, 0)
    const after = dispatch(s, { type: 'END_TURN' }, 'player')

    expect(after.battlefields[0].facedown).toBeFalsy()
    expect(after.player.trash.map((c) => c.name)).toContain('Test Ambush')
    // 421.4 — a facedown card changing zones is revealed, so the log may name it.
    expect(after.log.some((l) => /Test Ambush/.test(l))).toBe(true)
  })

  it('stays put while you still hold the battlefield', () => {
    const s = dispatch(ready(), { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    const after = dispatch(s, { type: 'END_TURN' }, 'player')
    expect(after.battlefields[0].facedown?.card.name).toBe('Test Ambush')
    expect(after.player.trash).toHaveLength(0)
  })
})

describe('a hidden *unit* played back from facedown', () => {
  const hiddenUnit = makeCard({
    name: 'Test Lurker',
    type: 'unit',
    domains: ['fury'],
    energy: 5,
    might: 3,
    keywords: ['Hidden'],
    text: '[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)',
  })

  it('enters at its own battlefield for free, stamped as played face down', () => {
    let s = ready(hiddenUnit)
    s = dispatch(s, { type: 'HIDE_CARD', card: hiddenUnit, index: 0 }, 'player')
    s = { ...s, turn: s.turn + 2 }
    const energyBefore = s.player.runes.energy

    const after = dispatch(
      s,
      { type: 'PLAY_UNIT', card: hiddenUnit, to: { kind: 'battlefield', index: 0 }, fromFacedown: 0 },
      'player',
    )
    const lurker = after.battlefields[0].units.find((u) => u.card.name === 'Test Lurker')
    expect(lurker, 'the unit should be on the board').toBeTruthy()
    expect(after.player.runes.energy).toBe(energyBefore) // 811.1.b — free
    expect(after.battlefields[0].facedown).toBeNull()
    // 811.1.d.1 restricts it to *that* battlefield, and the stamp is what lets a
    // "when you play me from face down" trigger tell where it came from.
    expect(lurker!.location).toEqual({ kind: 'battlefield', index: 0 })
    expect(lurker!.counters.playedFaceDown).toBe(1)
  })

  it('cannot be sent to a different battlefield (811.1.d.1)', () => {
    let s = ready(hiddenUnit)
    s = dispatch(s, { type: 'HIDE_CARD', card: hiddenUnit, index: 0 }, 'player')
    s = { ...s, turn: s.turn + 2 }
    const after = dispatch(
      s,
      { type: 'PLAY_UNIT', card: hiddenUnit, to: { kind: 'base' }, fromFacedown: 0 },
      'player',
    )
    expect(after.player.base.some((u) => u.card.name === 'Test Lurker')).toBe(false)
    expect(after.battlefields[0].facedown).toBeTruthy() // untouched
  })

  it('played normally from hand carries no face-down stamp', () => {
    const s = ready(hiddenUnit)
    const after = dispatch(s, { type: 'PLAY_UNIT', card: hiddenUnit, to: { kind: 'base' } }, 'player')
    const lurker = after.player.base.find((u) => u.card.name === 'Test Lurker')!
    expect(lurker.counters.playedFaceDown).toBeUndefined()
    expect(after.player.runes.energy).toBe(9 - hiddenUnit.energy) // paid in full
  })
})

describe('CARD_PLAYED carries the facedown provenance', () => {
  // Katarina - Reckless and Black Market Broker read "When you play *a card*
  // from face down, …" — they watch any card, not their own, so the event has
  // to say where it came from.
  // `scriptFor` keys off the card *name*, so a synthetic Katarina exercises the
  // real script even though she is not in the preset-deck fixture.
  const katarina = makeCard({
    name: 'Katarina - Reckless',
    type: 'unit',
    domains: ['fury'],
    energy: 4,
    might: 4,
    text: 'When you play a card from face down, deal 2 to an enemy unit.',
  })

  /** Katarina watching, an enemy unit to shoot, and a card hidden at bf0. */
  function watched(): GameState {
    let s = ready()
    s = placeUnitAt(s, 'player', katarina, 0)
    // Might 4, so 2 damage marks it instead of killing it outright.
    s = placeUnitAt(s, 'ai', makeCard({ name: 'Tough', type: 'unit', domains: ['fury'], might: 4 }), 1)
    s = dispatch(s, { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    return { ...s, turn: s.turn + 2 }
  }

  it('fires a "when you play a card from face down" watcher', () => {
    const s = watched()
    const enemy = s.battlefields[1].units[0]
    expect(enemy.damage).toBe(0)

    const after = dispatch(s, { type: 'PLAY_SPELL', card: hiddenSpell, fromFacedown: 0 }, 'player')
    const hit = after.battlefields[1].units.find((u) => u.instanceId === enemy.instanceId)
    expect(hit?.damage, 'Katarina should have dealt 2').toBe(2)
  })

  it('does NOT fire for an ordinary play from hand', () => {
    let s = watched()
    // Put a normal spell in hand and cast it the usual way.
    s = withHand(s, 'player', [plainSpell])
    const enemy = s.battlefields[1].units[0]
    const after = dispatch(s, { type: 'PLAY_SPELL', card: plainSpell }, 'player')
    const same = after.battlefields[1].units.find((u) => u.instanceId === enemy.instanceId)
    expect(same?.damage).toBe(0)
  })
})

describe('being attacked does not reveal a hidden card — losing the battlefield does', () => {
  const u = (n: string, might: number) =>
    makeCard({ name: n, type: 'unit', domains: ['fury'], energy: 2, might })

  /** Hide at bf0, then let the AI attack it with `atk` against my `def`. */
  function attacked(def: number, atk: number): GameState {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', u('Def', def), 0)
    s = withHand(s, 'player', [hiddenSpell])
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
    s = dispatch(s, { type: 'HIDE_CARD', card: hiddenSpell, index: 0 }, 'player')
    s = dispatch(s, { type: 'END_TURN' }, 'player')
    s = placeUnitAt(s, 'ai', u('Atk', atk), 0)
    s = dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'ai')
    s = dispatch(s, { type: 'PASS_PRIORITY' }, 'player')
    return dispatch(s, { type: 'PASS_PRIORITY' }, 'ai')
  }

  it('survives being contested and winning the defence', () => {
    const after = attacked(6, 1)
    expect(after.battlefields[0].facedown?.card.name).toBe('Test Ambush')
    expect(after.player.trash.map((c) => c.name)).not.toContain('Test Ambush')
  })

  it('survives an inconclusive fight, because the attackers are recalled', () => {
    // Neither can kill the other, so 461.3.d "No Result" recalls the attacker
    // and I keep control — and therefore keep the card.
    const after = attacked(6, 1)
    expect(after.battlefields[0].units.every((x) => x.owner === 'player')).toBe(true)
    expect(after.battlefields[0].facedown).toBeTruthy()
  })

  it('is revealed and trashed only when the battlefield is actually lost (107.3.d)', () => {
    const after = attacked(1, 6)
    expect(after.battlefields[0].facedown).toBeFalsy()
    expect(after.player.trash.map((c) => c.name)).toContain('Test Ambush')
  })

  it('is also lost on a mutual wipe, since the battlefield becomes Uncontrolled', () => {
    // 461.5.b — nobody holds it, so nobody's Facedown Zone survives.
    const after = attacked(3, 3)
    expect(after.battlefields[0].units).toHaveLength(0)
    expect(after.battlefields[0].facedown).toBeFalsy()
    expect(after.player.trash.map((c) => c.name)).toContain('Test Ambush')
  })
})

describe('springing it in a response window — the point of the keyword', () => {
  const lurker = makeCard({
    name: 'Lurker',
    type: 'unit',
    domains: ['fury'],
    energy: 5,
    might: 3,
    keywords: ['Hidden'],
    text: '[Hidden] (Hide now for :rb_rune_rainbow:.)',
  })
  const u = (n: string, might: number) =>
    makeCard({ name: n, type: 'unit', domains: ['fury'], energy: 2, might })

  /** Hidden at bf0, then the AI declares a showdown there — I hold priority. */
  function midShowdown(): GameState {
    let s = startedGame({ firstPlayer: 'player' })
    s = placeUnitAt(s, 'player', u('Wall', 6), 0)
    s = withHand(s, 'player', [lurker])
    s = { ...s, player: { ...s.player, runes: { ...s.player.runes, energy: 9 } } }
    s = dispatch(s, { type: 'HIDE_CARD', card: lurker, index: 0 }, 'player')
    s = dispatch(s, { type: 'END_TURN' }, 'player')
    s = placeUnitAt(s, 'ai', u('Atk', 2), 0)
    return dispatch(s, { type: 'DECLARE_SHOWDOWN', index: 0 }, 'ai')
  }

  it('is playable on the opponent’s turn once they give me priority (811.6)', () => {
    const s = midShowdown()
    expect(s.activePlayer).toBe('ai')
    expect(s.priority).toBe('player')
    expect(canPlayFromFacedown(s, 'player', 0).ok).toBe(true)
  })

  it('a hidden UNIT can enter a contested battlefield (811.1.d.1 over 355.2.a)', () => {
    // The normal rule is "your Base or a battlefield you control", and a
    // contested one is controlled by nobody — but Hidden grants permission to
    // play the permanent to *that* battlefield, which is the ambush.
    const s = midShowdown()
    const before = s.player.runes.energy
    const after = dispatch(
      s,
      { type: 'PLAY_UNIT', card: lurker, to: { kind: 'battlefield', index: 0 }, fromFacedown: 0 },
      'player',
    )
    expect(after.battlefields[0].units.map((x) => x.card.name)).toContain('Lurker')
    expect(after.battlefields[0].facedown).toBeNull()
    expect(after.player.runes.energy).toBe(before) // free, despite costing 5
  })

  it('still refuses a different battlefield', () => {
    const s = midShowdown()
    const after = dispatch(
      s,
      { type: 'PLAY_UNIT', card: lurker, to: { kind: 'battlefield', index: 1 }, fromFacedown: 0 },
      'player',
    )
    expect(after.battlefields[1].units).toHaveLength(0)
    expect(after.battlefields[0].facedown).toBeTruthy()
  })
})

describe('811.3 — Hidden grants no timing of its own from hand', () => {
  it('a Hidden-only spell keeps sorcery timing when played normally', async () => {
    const { spellTiming } = await import('../actions')
    expect(spellTiming(hiddenSpell)).toBe('sorcery')
    const both = makeCard({
      ...hiddenSpell,
      id: 'both',
      name: 'Hidden Action',
      keywords: ['Hidden', 'Action'],
      text: '[Hidden][Action] Draw 1.',
    })
    expect(spellTiming(both)).toBe('action')
  })
})
