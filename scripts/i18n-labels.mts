/**
 * Coverage of the compiler-generated labels — ability buttons, target prompts,
 * choice titles — by `i18n/abilityText.ts`.
 *
 *   npx tsx scripts/i18n-labels.mts
 *
 * These are the strings on the *controls*, so an untranslated one is English
 * sitting on a button in an otherwise Korean board. Companion to
 * scripts/i18n-misses.mts, which covers the card rules text.
 */
import poolData from '../src/engine/__tests__/fixtures/card-pool.json'
import { compileScript } from '../src/engine/abilities/compile'
import { CARD_SCRIPTS } from '../src/engine/abilities/scripts'
import { abilityLabelKo, targetLabelKo } from '../src/i18n/abilityText'

const pool = poolData as { name: string; text?: string }[]

const abil = new Map<string, number>()
const targ = new Map<string, number>()
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const card of pool) {
  let script
  try {
    script = compileScript(card as never)
  } catch {
    continue
  }
  const bespoke = CARD_SCRIPTS[card.name as keyof typeof CARD_SCRIPTS] as
    | { activated?: { label?: string; targets?: { label?: string }[] }[] }
    | undefined
  const all = [...(script.activated ?? []), ...(bespoke?.activated ?? [])]
  for (const ab of all) {
    if (ab.label) bump(abil, ab.label)
    for (const tg of ab.targets ?? []) if (tg.label) bump(targ, tg.label)
  }
  for (const tg of script.play?.targets ?? []) if (tg.label) bump(targ, tg.label)
}

function report(name: string, m: Map<string, number>, fn: (s: string) => string | null) {
  const rows = [...m.entries()].sort((a, b) => b[1] - a[1])
  const total = rows.reduce((n, [, c]) => n + c, 0)
  const hit = rows.filter(([k]) => fn(k) !== null)
  const done = hit.reduce((n, [, c]) => n + c, 0)
  console.log(`\n${name}: ${done}/${total} = ${((done / total) * 100).toFixed(1)}%  (${rows.length} shapes)`)
  for (const [k, c] of rows) {
    const ko = fn(k)
    if (!ko) console.log(`  MISS ${String(c).padStart(2)}  ${k}`)
  }
  for (const [k] of rows.slice(0, 6)) {
    const ko = fn(k)
    if (ko) console.log(`  ok       ${k}\n           → ${ko}`)
  }
}

report('ability labels', abil, abilityLabelKo)
report('target labels', targ, targetLabelKo)
