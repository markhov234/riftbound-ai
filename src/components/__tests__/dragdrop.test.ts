import { describe, expect, it } from 'vitest'
import { parseZoneId, zoneId, type DropLocation } from '../useDragDrop'

/**
 * Drop zones are addressed by a string written into `data-drop-zone` on one
 * element and read back off another, so TypeScript cannot connect the two
 * halves. If the writer and the reader ever disagree, nothing throws — every
 * drop just silently stops working. Hence a round-trip test.
 */
describe('drop zone ids', () => {
  const locations: DropLocation[] = [
    { kind: 'base' },
    { kind: 'battlefield', index: 0 },
    { kind: 'battlefield', index: 1 },
    { kind: 'battlefield', index: 12 },
  ]

  it('round-trips every location the board can offer', () => {
    for (const to of locations) {
      expect(parseZoneId(zoneId(to)), zoneId(to)).toEqual(to)
    }
  })

  it('parses a battlefield index of more than one digit', () => {
    // `id.slice(2)` worked for bf0-bf9 and would have quietly mangled bf10.
    expect(parseZoneId('bf10')).toEqual({ kind: 'battlefield', index: 10 })
  })

  it('rejects anything that is not a zone id', () => {
    for (const bad of ['', 'bf', 'bfx', 'base2', 'BASE', 'unit-3', 'bf-1', 'bf1x']) {
      expect(parseZoneId(bad), bad).toBeNull()
    }
  })
})
