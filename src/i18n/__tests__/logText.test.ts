import { describe, expect, it } from 'vitest'
import poolData from '../../engine/__tests__/fixtures/card-pool.json'
import { __setCardData } from '../../data/cardStore'
import { buildPresetDecks } from '../../data/presetDecks'
import { dispatch, initGame, runAITurn, stepAITurn } from '../../engine'
import { logLineKo, logCoverage, showdownSummaryKo, isTurnMarker, logWeight } from '../logText'
import type { Card } from '../../types/card'

const POOL = poolData as unknown as Card[]
__setCardData(POOL)

/** Play out a few AI-vs-bot games and collect every distinct log line. */
function sampleLogLines(): string[] {
  const decks = buildPresetDecks(POOL)
  const lines = new Set<string>()
  for (let seed = 0; seed < 4; seed++) {
    let s = initGame(decks[seed % decks.length], decks[(seed + 2) % decks.length], POOL, {
      difficulty: seed % 2 ? 'hard' : 'medium',
    })
    for (const l of s.log) lines.add(l) // includes the "Game start." line
    s = dispatch(s, { type: 'KEEP_HAND' }, 'player')
    for (let i = 0; i < 120 && !s.winner; i++) {
      const before = s.log.length
      s = runAITurn(s)
      if (s.priority === 'player' && s.phase === 'action' && !s.pendingChoices[0]) {
        s = dispatch(s, { type: 'END_TURN' }, 'player')
      }
      for (const l of s.log.slice(before)) lines.add(l)
      if (s.log.length === before && i > 5) break
    }
  }
  return [...lines]
}

describe('activity-log translation', () => {
  it('translates the common line shapes', () => {
    expect(logLineKo('ai plays Cleave to base.')).toBe('AI가 Cleave을(를) 기지에 냅니다.')
    // "<gear> equips <unit>." — both halves are card names, not sides.
    expect(logLineKo('Guardian Angel equips Shadow Order Disciple.')).toBe(
      'Guardian Angel이(가) Shadow Order Disciple에게 장착됩니다.',
    )
    expect(logLineKo('player draws for the turn.')).toBe('내가 턴 시작에 카드를 뽑습니다.')
    expect(logLineKo("— ai's turn —")).toBe('— AI의 턴 —')
    expect(logLineKo('ai passes.')).toBe('AI가 패스합니다.')
  })

  it('uses the contracted subject form for the player', () => {
    // 나 + 가 contracts to 내가; "나가" would be wrong.
    const ko = logLineKo('player passes.')!
    expect(ko.startsWith('내가')).toBe(true)
    expect(ko).not.toContain('나가')
  })

  it('picks numeric particles by how the digit is read', () => {
    // 1 일 (final consonant) → 을 ; 2 이 (none) → 를
    expect(logLineKo('ai conquers battlefield 1: +1 point.')).toContain('전장 1을')
    expect(logLineKo('ai conquers battlefield 2: +1 point.')).toContain('전장 2를')
    expect(logLineKo('Punching Poro takes 2 damage.')).toContain('피해 2를')
  })

  it('resolves the directional particle after a battlefield number', () => {
    expect(logLineKo('ai moves Gust Monk to battlefield 1.')).toContain('전장 1으로')
    expect(logLineKo('ai moves Gust Monk to battlefield 2.')).toContain('전장 2로')
    expect(logLineKo('ai moves Gust Monk to battlefield 1.')).not.toContain('(으)로')
  })

  it('keeps card names in English, matching the card art', () => {
    expect(logLineKo('ai plays Punching Poro to base.')).toContain('Punching Poro')
  })

  it('translates showdown summaries for the briefing panel', () => {
    const ko = showdownSummaryKo("ai destroyed all of player's units — ai takes Kinkou Temple.")
    expect(ko).toContain('AI가')
    expect(ko).toContain('Kinkou Temple')
    expect(ko).not.toMatch(/^결전 결과/) // prefix stripped
    expect(showdownSummaryKo('both sides were wiped out — Bandle Tree is now open (no one scores).'))
      .toContain('양쪽 모두 전멸')
  })

  // These five shapes were live in the engine with no rule behind them — the
  // Vex card scripts and the 163.2.b rune rewrite each added wording without
  // adding a translation, which is what pushed coverage under its threshold.
  it('translates the shapes the newer card scripts emit', () => {
    expect(logLineKo('ai channels a rune exhausted (no energy this turn).')).toContain(
      '소진된',
    )
    expect(logLineKo('ai readies a body rune.')).toContain('육체')
    expect(logLineKo('Astral Heron: your next card costs 2 energy and 2 runes less.')).toContain(
      'Astral Heron',
    )
    // The engine words the same swap two ways; both have to land.
    for (const line of [
      'Tideturner and Vex - Apathetic swap places.',
      'Zed, Without a Sound swaps places with Shadow Clone.',
    ]) {
      expect(logLineKo(line), line).toContain('위치가 서로 바뀝니다')
    }
  })

  it('returns null for an unrecognised line rather than guessing', () => {
    expect(logLineKo('something the engine never writes')).toBeNull()
  })

  it('covers the lines real games actually produce', () => {
    const lines = sampleLogLines()
    expect(lines.length).toBeGreaterThan(80)
    const { total, translated } = logCoverage(lines)
    const missing = lines.filter((l) => !logLineKo(l))
    // These are engine-authored from a fixed vocabulary, so coverage should be
    // effectively complete, and it currently is. This threshold sat at 0.97 while
    // reality drifted to 0.968, so the test failed about one run in six instead of
    // naming the gap — sampling variance straddling the line. Keep the headroom small.
    expect(translated / total, `untranslated shapes:\n${missing.join('\n')}`).toBeGreaterThan(
      0.99,
    )
  })

  it('leaves no unresolved particle placeholders after a number', () => {
    // Deck shuffling makes the sampled set vary run to run, so pin the lines
    // that carry a number explicitly and use the sample as an extra sweep.
    const fixed = [
      'ai predicts 2, recycles 1.',
      'ai conquers battlefield 1: +1 point.',
      'ai conquers battlefield 2: +1 point.',
      'ai moves Gust Monk to battlefield 1.',
      'ai moves Gust Monk to battlefield 2.',
      'ai plays Gust Monk to battlefield 1.',
      'ai holds 2 battlefield(s): +2 point(s).',
      'Gust Monk takes 2 damage.',
      'Gust Monk gets +2 might this turn.',
      'Gust Monk gets +1 might permanently.',
      'ai gains 2 XP.',
      'ai assigned 3 excess damage.',
      'ai pays +2 Power (Deflect).',
      'Battlefield 2 is not contested.',
      'ai burns 3 card(s).',
      'ai draws 2.',
    ]
    for (const l of [...fixed, ...sampleLogLines()]) {
      const ko = logLineKo(l)
      if (!ko) continue
      expect(ko, l).not.toMatch(/\d+\(으\)로/)
      expect(ko, l).not.toMatch(/\d+을\(를\)/)
      expect(ko, l).not.toMatch(/\d+이\(가\)/)
    }
  })
})

describe('stepAITurn', () => {
  it('reaches the same state as runAITurn', () => {
    const decks = buildPresetDecks(POOL)
    const base = dispatch(
      initGame(decks[0], decks[1], POOL, { difficulty: 'medium' }),
      { type: 'KEEP_HAND' },
      'player',
    )
    const whole = runAITurn(base)

    let s = base
    let guard = 0
    for (;;) {
      const { state, done } = stepAITurn(s)
      s = state
      if (done || guard++ > 200) break
    }
    expect(s.log).toEqual(whole.log)
    expect(s.priority).toBe(whole.priority)
    expect(s.player.points).toBe(whole.player.points)
    expect(s.ai.points).toBe(whole.ai.points)
  })

  it('advances one action at a time', () => {
    const decks = buildPresetDecks(POOL)
    // Advance to a real AI turn — from the opening state its only step is the
    // mulligan, so one step and the whole turn would be the same thing.
    let s = dispatch(
      initGame(decks[0], decks[1], POOL, { difficulty: 'medium' }),
      { type: 'KEEP_HAND' },
      'player',
    )
    s = runAITurn(s)
    if (s.priority === 'player' && s.phase === 'action') {
      s = dispatch(s, { type: 'END_TURN' }, 'player')
    }
    const whole = runAITurn(s)
    expect(whole.log.length).toBeGreaterThan(s.log.length + 1) // a turn worth of actions

    const one = stepAITurn(s)
    expect(one.state).not.toBe(s)
    expect(one.done).toBe(false)

    // The real property is that stepping *converges* on the same turn, not that
    // any particular step logs fewer lines — a turn whose tail is all priority
    // passes logs nothing extra, and asserting on line counts made this test
    // fail whenever a card's stats changed what the AI decided to do.
    let t = one.state
    let guard = 0
    for (;;) {
      const r = stepAITurn(t)
      t = r.state
      if (r.done || guard++ > 200) break
    }
    expect(t.log).toEqual(whole.log)
  })

  it('reports done and stops when the AI has nothing to do', () => {
    const decks = buildPresetDecks(POOL)
    const base = dispatch(
      initGame(decks[0], decks[1], POOL, { difficulty: 'medium' }),
      { type: 'KEEP_HAND' },
      'player',
    )
    const settled = runAITurn(base)
    const { state, done } = stepAITurn(settled)
    expect(done).toBe(true)
    expect(state).toBe(settled) // no-op, so React bails and nothing reschedules
  })
})

describe('log presentation', () => {
  // This regex shipped broken once — a build step ate its backslashes and it
  // silently matched nothing, so every turn divider rendered as plain text.
  it('recognises the turn markers the engine writes', () => {
    for (const side of ['player', 'ai']) {
      expect(isTurnMarker(`— ${side}'s turn —`), side).toBe(true)
    }
  })

  it('does not mistake ordinary lines for a turn break', () => {
    for (const line of [
      'PLAYER draws for the turn.',
      'ai channels a rune (+1 energy).',
      'Showdown at battlefield 1: player (4 might) vs ai (2 might).',
    ]) {
      expect(isTurnMarker(line), line).toBe(false)
    }
  })

  it('ranks what changed the game above bookkeeping', () => {
    expect(logWeight('player conquers battlefield 1: +1 point.')).toBe('major')
    expect(logWeight('Poke is destroyed.')).toBe('major')
    expect(logWeight('player channels a rune (+1 energy).')).toBe('minor')
    expect(logWeight('player draws 1.')).toBe('minor')
    expect(logWeight('player plays Steel Paws to base.')).toBe('normal')
  })
})
