import { describe, expect, it } from 'vitest'
import poolData from '../../engine/__tests__/fixtures/card-pool.json'
import { cardTextKo, cardTextCoverage, translateCardText } from '../cardText'
import { GLOSSARY, ALL_GLOSSARY } from '../../data/glossary'
import { GLOSSARY_KO, koFor, symbolTextKo } from '../../data/glossary.ko'

const POOL = poolData as { name: string; text?: string }[]

describe('Korean glossary', () => {
  it('covers every English entry', () => {
    for (const key of Object.keys(GLOSSARY)) {
      const ko = GLOSSARY_KO[key as keyof typeof GLOSSARY_KO]
      expect(ko, `missing Korean for "${key}"`).toBeTruthy()
      expect(ko.term.length).toBeGreaterThan(0)
      expect(ko.text.length).toBeGreaterThan(0)
    }
  })

  it('resolves by entry identity, so lookups get the right gloss', () => {
    for (const entry of ALL_GLOSSARY) {
      expect(koFor(entry), `no gloss for "${entry.term}"`).toBeTruthy()
    }
  })

  it('translates generated symbol text', () => {
    expect(symbolTextKo('3 energy')).toBe('에너지 3')
    expect(symbolTextKo('1 Fury Power')).toBe('Fury 파워 1')
    expect(symbolTextKo('1 Power of any domain')).toBe('아무 도메인의 파워 1')
    expect(symbolTextKo('something unmapped')).toBeUndefined()
  })
})

describe('card text translation', () => {
  it('translates the common clause shapes', () => {
    expect(cardTextKo('Draw 1.')).toBe('카드 1장을 뽑습니다.')
    expect(cardTextKo('When I move, draw 1.')).toBe('내가 이동할 때, 카드 1장을 뽑습니다.')
    expect(cardTextKo('Deal 3 to a unit.')).toBe('유닛 하나에게 피해 3을 줍니다.')
    expect(cardTextKo('Kill a friendly gear.')).toBe('내 장비 하나를 파괴합니다.')
  })

  it('picks the object particle by how the number is read aloud', () => {
    // 2 is 이 (no final consonant) → 를; 1 is 일 → 을.
    expect(cardTextKo('Give a unit +2 :rb_might: this turn.')).toContain('위력 +2를')
    expect(cardTextKo('Give a unit +1 :rb_might: this turn.')).toContain('위력 +1을')
  })

  it('conjugates "you may" without mangling the verb stem', () => {
    // Regression: naive "니다"-trimming produced "이동시킵수 있습니다".
    const ko = cardTextKo('When you hold here, you may move a unit at a battlefield to its base.')
    expect(ko).toContain('이동시킬 수 있습니다')
    expect(ko).not.toContain('시킵수')
    expect(cardTextKo('You may kill a friendly gear.')).toContain('파괴할 수 있습니다')
  })

  it('picks the directional particle for the destination', () => {
    expect(cardTextKo('Move a unit to base.')).toContain('기지로') // 지: no final consonant
  })

  it('keeps keyword brackets in English inside a translated sentence', () => {
    // They are the reader's anchor to the (English) card art, and GlossaryText
    // makes them hoverable with a Korean explanation.
    const ko = cardTextKo('[Ganking]Recycle 1 from your trash: Give me +1 :rb_might: this turn.')!
    expect(ko).toContain('[Ganking]')
    expect(ko).toContain('위력 +1을') // :rb_might: is consumed and rendered as a word
  })

  it('passes an untranslated symbol cost through unchanged', () => {
    const ko = cardTextKo(':rb_exhaust:: Empower another gear.')!
    expect(ko).toContain(':rb_exhaust:')
    expect(ko).toContain('다른 장비 하나를 강화합니다')
  })

  it('treats keyword-only lines as neutral rather than a miss', () => {
    for (const s of ['[Reaction]', '[Empower] :rb_energy_2:', '[NO TEXT]', '[Deflect 2]']) {
      const segs = translateCardText(s)
      expect(segs.every((x) => x.neutral), s).toBe(true)
      expect(cardTextCoverage(s).total).toBe(0)
    }
  })

  it('leaves an unrecognised sentence in English rather than guessing', () => {
    // Deliberately synthetic. Real card text was used here and went stale the
    // moment a rule covered it — the point of this test is the *fallback*, so
    // it needs a sentence no future rule will ever claim.
    const en = 'The clockwork owl recites a limerick about turnips.'
    const segs = translateCardText(en).filter((s) => !s.reminder && !s.neutral)
    expect(segs.every((s) => !s.translated)).toBe(true)
    expect(segs.map((s) => s.text).join(' ')).toBe(en)
  })

  it('returns null when nothing could be translated', () => {
    expect(cardTextKo('The clockwork owl recites a limerick about turnips.')).toBeNull()
  })

  it('drops reminder parentheticals from the Korean line', () => {
    const ko = cardTextKo('Units here have [Ganking]. (They can move from battlefield to battlefield.)')!
    expect(ko).not.toContain('They can move')
    expect(ko).toContain('[Ganking]')
  })

  it('never emits a broken verb ending across the whole card pool', () => {
    // The three shapes the old string-trimming conjugation produced.
    for (const c of POOL) {
      if (!c.text) continue
      const ko = cardTextKo(c.text)
      if (!ko) continue
      expect(ko, c.name).not.toMatch(/[가-힣]수 있습니다/)
      expect(ko, c.name).not.toMatch(/[가-힣]니다고/)
      expect(ko, c.name).not.toContain('(으)로')
    }
  })

  it('holds its measured coverage of the real card pool', () => {
    let total = 0
    let translated = 0
    for (const c of POOL) {
      if (!c.text) continue
      const r = cardTextCoverage(c.text)
      total += r.total
      translated += r.translated
    }
    // Guards against a refactor silently regressing the rule set. Raise the
    // floor when rules are added; see docs/i18n.md for what is uncovered.
    //
    // The floor tracks the *pool*, not just the rules: adding the Vex preset
    // grew the fixture 212 → 235 cards and coverage fell 0.51 → 0.47 without a
    // single rule changing, because that list is mostly Vendetta/Unleashed
    // cards whose wordings have no templates yet. Lowered deliberately — if it
    // drops again with the pool unchanged, that is a real regression.
    expect(total).toBeGreaterThan(200)
    expect(translated / total).toBeGreaterThan(0.60)
  })
})
