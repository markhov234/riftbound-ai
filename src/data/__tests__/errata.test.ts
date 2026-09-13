import { describe, expect, it } from 'vitest'
import poolData from '../../engine/__tests__/fixtures/card-pool.json'
import { Card } from '../../types/card'
import { applyErrata, __ERRATA } from '../errata'

const pool = poolData as unknown as Card[]

describe('card errata', () => {
  it('every erratum still matches a card in the shipped pool', () => {
    // If the API ever ships the corrected wording, `from` stops matching and the
    // erratum silently does nothing — this test says so out loud instead.
    for (const e of __ERRATA) {
      const card = pool.find((c) => c.name.toLowerCase() === e.name.toLowerCase())
      expect(card, `${e.name} is not in the card pool`).toBeTruthy()
      expect(card!.text, `${e.name}: printed text no longer contains the errata'd sentence`).toContain(e.from)
    }
  })

  it("rewrites Zhonya's Hourglass to the errata'd effect", () => {
    const before = pool.find((c) => c.name === "Zhonya's Hourglass")!
    const after = applyErrata(pool).find((c) => c.name === "Zhonya's Hourglass")!

    expect(before.text).toContain('Recall that unit exhausted')
    expect(after.text).toContain('Heal that unit, exhaust it, and recall it')
    expect(after.text).not.toContain('Recall that unit exhausted')
    // The [Hidden] reminder line in front of it is untouched.
    expect(after.text.startsWith('[Hidden]')).toBe(true)
  })

  it('leaves every other card byte-identical', () => {
    const after = applyErrata(pool)
    const changed = after.filter((c, i) => c !== pool[i]).map((c) => c.name)
    expect(changed).toEqual(["Zhonya's Hourglass"])
  })

  it('is a no-op when the pool already has the corrected text', () => {
    const fixed = applyErrata(applyErrata(pool))
    expect(fixed).toEqual(applyErrata(pool))
  })
})
