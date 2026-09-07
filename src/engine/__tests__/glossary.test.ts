import { describe, expect, it } from 'vitest'
import { GLOSSARY, lookupKeyword, lookupPlain, lookupSymbol } from '../../data/glossary'

describe('glossary', () => {
  it('covers every keyword the game text can print', () => {
    for (const kw of [
      'Accelerate',
      'Action',
      'Ambush',
      'Assault 3',
      'Backline',
      'Deathknell',
      'Deflect',
      'Empower',
      'Empowered',
      'Equip',
      'Flow',
      'Ganking',
      'Hidden',
      'Hunt 1',
      'Legion',
      'Level 6',
      'Quick-Draw',
      'Reaction',
      'Repeat',
      'Shield 2',
      'Tank',
      'Temporary',
      'Unique',
      'Vision',
      'Weaponmaster',
      'Stun',
      'Mighty',
    ]) {
      expect(lookupKeyword(`[${kw}]`), kw).toBeDefined()
    }
  })

  it('has 25 keywords + 6 game actions + plain rules terms', () => {
    const all = Object.values(GLOSSARY)
    expect(all.filter((e) => e.kind === 'keyword')).toHaveLength(25)
    expect(all.filter((e) => e.kind === 'action')).toHaveLength(6)
    expect(all.filter((e) => e.kind === 'rule').length).toBeGreaterThanOrEqual(5)
  })

  it('resolves the plain rules terms used in card text', () => {
    for (const w of ['token', 'showdown', 'conquer', 'hold', 'recall', 'banish', 'excess damage']) {
      expect(lookupPlain(w), w).toBeDefined()
    }
    expect(lookupPlain('token')!.text).toMatch(/never (drawn|part of a deck)/i)
    // Only 'rule'-kind entries resolve as plain terms.
    expect(lookupPlain('tank')).toBeUndefined()
  })

  it('resolves :rb_*: symbols to a glyph + explanation', () => {
    expect(lookupSymbol(':rb_energy_1:')).toEqual({ glyph: '⟨1⚡⟩', text: '1 energy' })
    expect(lookupSymbol(':rb_exhaust:')?.text).toMatch(/exhaust/i)
    expect(lookupSymbol(':rb_rune_fury:')?.text).toBe('1 Fury Power')
    expect(lookupSymbol(':rb_rune_rainbow:')?.text).toMatch(/any domain/i)
  })
})
