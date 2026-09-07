/**
 * One-off: fetch the live card pool, trim it to just what the four preset decks
 * (plus every token / rune / battlefield) need, and write it as a test fixture so
 * the engine tests can build the real decks offline.
 *
 *   npx tsx scripts/gen-card-pool-fixture.mts
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fetchAllCards } from '../src/data/cardStore'
import { PRESET_SPECS } from '../src/data/presetDecks'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../src/engine/__tests__/fixtures')
const outFile = resolve(outDir, 'card-pool.json')

const all = await fetchAllCards()
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

const wanted = new Set<string>()
for (const spec of PRESET_SPECS) {
  ;[spec.legend, spec.chosenChampion, ...spec.battlefields, ...spec.main.map((m) => m.name)].forEach(
    (n) => wanted.add(norm(n)),
  )
}

const keep = all.filter(
  (c) =>
    c.type === 'rune' ||
    c.type === 'battlefield' ||
    c.supertype === 'token' ||
    c.type === 'token' ||
    wanted.has(norm(c.name)) ||
    wanted.has(norm(c.cleanName)),
)

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, JSON.stringify(keep))
console.log(`wrote ${keep.length} / ${all.length} cards → ${outFile}`)
