/**
 * Rank the card-text sentences `cardText.ts` cannot translate yet, so the next
 * batch of rules is aimed at what actually appears on cards rather than at
 * whatever is easiest to write.
 *
 *   npx tsx scripts/i18n-misses.mts [topN]
 *
 * Shapes are normalised (digits → N, `:rb_*:` → §) so one wording counts once
 * however many numbers it is printed with. `docs/i18n.md` points here.
 */
import poolData from '../src/engine/__tests__/fixtures/card-pool.json'
import { translateCardText } from '../src/i18n/cardText'

const topN = Number(process.argv[2] ?? 60)
const cards = poolData as { name: string; text?: string }[]

let total = 0
let done = 0
let remTotal = 0
let remDone = 0
const misses = new Map<string, { n: number; cards: Set<string> }>()

for (const c of cards) {
  if (!c.text) continue
  for (const seg of translateCardText(c.text)) {
    if (seg.neutral) continue
    if (seg.reminder) {
      remTotal++
      if (seg.translated) remDone++
    }
    total++
    if (seg.translated) {
      done++
      continue
    }
    const key = seg.text
      .replace(/\d+/g, 'N')
      .replace(/:rb_[a-z0-9_]+:/gi, '§')
      .replace(/\s+/g, ' ')
      .trim()
    const hit = misses.get(key) ?? { n: 0, cards: new Set<string>() }
    hit.n++
    hit.cards.add(c.name)
    misses.set(key, hit)
  }
}

const ranked = [...misses.entries()].sort((a, b) => b[1].n - a[1].n)
const proseT = total - remTotal
const proseD = done - remDone
console.log(`prose     ${proseD}/${proseT} = ${((proseD / proseT) * 100).toFixed(1)}%`)
console.log(`reminders ${remDone}/${remTotal} = ${((remDone / remTotal) * 100).toFixed(1)}%`)
console.log(`overall   ${done}/${total} = ${((done / total) * 100).toFixed(1)}%`)
console.log(`untranslated  ${total - done} sentences in ${ranked.length} distinct shapes\n`)
for (const [shape, v] of ranked.slice(0, topN)) {
  console.log(`${String(v.n).padStart(3)}  ${shape}`)
  console.log(`     ${[...v.cards].slice(0, 3).join(', ')}`)
}
