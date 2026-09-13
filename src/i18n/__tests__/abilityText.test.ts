import { describe, expect, it } from 'vitest'
import poolData from '../../engine/__tests__/fixtures/card-pool.json'
import { compileScript } from '../../engine/abilities/compile'
import { abilityLabelKo, choiceLabelKo, targetLabelKo } from '../abilityText'

const POOL = poolData as { name: string; text?: string }[]

/**
 * These labels are built by the text→script compiler, so they are English
 * wherever a card is. Everything else on the board translates, which left the
 * *buttons* as the last English on screen — you read a fully Korean card and
 * then clicked "Exhaust + 1 rune: ready a friendly unit".
 */

describe('ability button labels', () => {
  it('keeps a keyword ability as its keyword plus cost', () => {
    // Keywords stay English everywhere on screen — they are the reader's anchor
    // to the printed card — and the cost half is already glyphs.
    expect(abilityLabelKo('Empower — 2⚡')).toBe('Empower — 2⚡')
    expect(abilityLabelKo('Equip — ✦')).toBe('Equip — ✦')
    expect(abilityLabelKo('Empower')).toBe('Empower')
  })

  it('translates both halves of a cost: effect label', () => {
    expect(abilityLabelKo('↻: Empower another gear.')).toBe('↻: 다른 장비 하나를 강화합니다.')
    expect(abilityLabelKo('Discard a gear, 1⚡, ↻: Deal 4 to a unit at a battlefield.')).toBe(
      '장비 하나 버리기, 1⚡, ↻: 전장에 있는 유닛 하나에게 피해 4를 줍니다.',
    )
  })

  it('does not split at a colon that belongs to the effect', () => {
    // `Units here have "↻: Gain 1 XP."` is one effect whose *quoted* ability
    // carries the colon. Splitting on the first ": " gave a nonsense cost half
    // of `Units here have "↻` and the label came back untranslated.
    const ko = abilityLabelKo('Units here have "↻: Gain 1 XP."')
    expect(ko).not.toBeNull()
    expect(ko).toContain('여기 있는 유닛')
  })

  it('keeps the whole sentences when the compiler elided the tail', () => {
    // The compiler cuts an effect over 60 chars with "…", which lops the last
    // sentence off mid-clause. That fragment can never translate, and it must
    // not veto the complete sentences in front of it.
    const ko = abilityLabelKo('↻: Give a unit +2 :rb_might: this turn. If this is [Empowered]…')
    expect(ko).not.toBeNull()
    expect(ko).toContain('위력 +2를')
    expect(ko!.endsWith('…')).toBe(true)
  })

  it('returns null rather than a half-English button', () => {
    expect(abilityLabelKo('↻: Recite a limerick about turnips.')).toBeNull()
    expect(abilityLabelKo('Sing loudly: Draw 1.')).toBeNull()
  })

  it('covers every ability label the real card pool produces', () => {
    const missing: string[] = []
    for (const card of POOL) {
      let script
      try {
        script = compileScript(card as never)
      } catch {
        continue
      }
      for (const ab of script.activated ?? []) {
        if (ab.label && abilityLabelKo(ab.label) === null) missing.push(`${card.name}: ${ab.label}`)
      }
    }
    // Closed vocabulary — 24 shapes over the pool — so this can hold at zero.
    // A new card with a new ability shape fails here, which is the point.
    expect(missing, `${missing.length} untranslated:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('target prompts', () => {
  it('picks the particle by how the digit is read aloud', () => {
    // 4 is 사 (no final consonant) → 를; 3 is 삼 → 을.
    expect(targetLabelKo('to deal 4 damage')).toBe('피해 4를 줄 대상')
    expect(targetLabelKo('to deal 3 damage')).toBe('피해 3을 줄 대상')
    expect(targetLabelKo('to give +2 Might this turn')).toBe('이번 턴 위력 +2를 줄 대상')
    expect(targetLabelKo('to give +1 Might this turn')).toBe('이번 턴 위력 +1을 줄 대상')
  })

  it('reads a keyword grant with its number', () => {
    expect(targetLabelKo('to grant [Assault 3]')).toBe('[Assault 3]을 줄 대상')
    expect(targetLabelKo('to grant [Deflect 2]')).toBe('[Deflect 2]를 줄 대상')
  })

  it('covers every target label the real card pool produces', () => {
    const missing: string[] = []
    for (const card of POOL) {
      let script
      try {
        script = compileScript(card as never)
      } catch {
        continue
      }
      const specs = [
        ...(script.play?.targets ?? []),
        ...(script.activated ?? []).flatMap((a) => a.targets ?? []),
      ]
      for (const sp of specs) {
        if (sp.label && targetLabelKo(sp.label) === null) missing.push(`${card.name}: ${sp.label}`)
      }
    }
    expect(missing, `${missing.length} untranslated:\n${missing.join('\n')}`).toEqual([])
  })
})

describe('choice prompts', () => {
  it('translates the extra-cost buttons', () => {
    expect(choiceLabelKo('Accelerate (+1⚡): enter ready')).toBe('[Accelerate] (+1⚡): 준비된 채로 등장')
    expect(choiceLabelKo('Pay additional (+2⚡)')).toBe('추가 비용 지불 (+2⚡)')
  })

  it('translates modal titles', () => {
    expect(choiceLabelKo('Discard 2 cards')).toBe('카드 2장을 버리세요')
    expect(choiceLabelKo('Ready up to 3 — units, gear and/or runes')).toContain('최대 3개')
  })

  it('returns null for an unknown prompt', () => {
    expect(choiceLabelKo('Recite a limerick about turnips')).toBeNull()
  })
})
