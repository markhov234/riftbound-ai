import { Card } from '../../types/card'
import { EffectCtx, Effect } from './effects'
import {
  addEnergy,
  attachGear,
  bankEnergy,
  banishFromTrash,
  bounceUnit,
  buff,
  burn,
  counterStackItem,
  createToken,
  dealDamage,
  digTopN,
  discardChoice,
  draw,
  empowerGear,
  gainXP,
  gearCount,
  giveMight,
  giveMightPermanent,
  grantKeywordThisTurn,
  heal,
  killUnit,
  moveUnitEffect,
  predictChoice,
  readyGear,
  readyUnit,
  recall,
  scorePoints,
  stun,
} from './effects'
import { isEmpowered } from './statuses'
import { TargetSpec } from './targets'
import { ActivatedAbility, CardScript, TriggeredAbility } from './types'
import { GameState, UnitInPlay } from '../../types/game'

/**
 * A best-effort compiler from a card's printed rules text to an engine script.
 * It covers the common templated Riftbound phrasings; anything it can't parse is
 * logged once as "(effect not implemented)" so it's visible rather than silent.
 *
 * Explicit `CARD_SCRIPTS` entries always win — this only fills the gaps.
 */

// ── text normalisation ───────────────────────────────────────────────────

function decode(text: string): string {
  return text
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Drop "(reminder text)" spans — including ones split across sentences. */
function stripReminders(text: string): string {
  let t = text
  for (let i = 0; i < 4 && /\([^()]*\)/.test(t); i++) t = t.replace(/\([^()]*\)/g, ' ')
  // An unbalanced "(… .)" (a reminder that ran across a sentence break) — drop
  // from the last unmatched "(" to a following ")".
  t = t.replace(/\([^()]*$/g, ' ').replace(/^[^()]*\)/g, ' ')
  return t.replace(/\s+/g, ' ').trim()
}

/** The body of the card's text, minus the trailing [Flow …] alt-cost clause. */
function effectText(text: string): string {
  return decode(text).split(/\[flow\]?/i)[0]
}

function rawClauses(text: string): string[] {
  // Strip reminders on the whole body first so a "(…​.​…)" spanning a sentence
  // boundary doesn't leak into the split clauses.
  return stripReminders(effectText(text).replace(/\[>\]/g, '.'))
    .split(/(?<=[.!])\s+|\n+|(?<=[.!])(?=\[)/)
    .map((c) => stripReminders(c))
    .filter(Boolean)
}

function clausesOf(text: string): string[] {
  return rawClauses(text).map((c) => c.toLowerCase())
}

// ── target detection ─────────────────────────────────────────────────────

const MIGHT_LE = /(\d+)\s*(?::rb_might:|\[m\]|might)\s*or less/

function specFor(fragment: string): TargetSpec | null {
  const f = fragment
  const le = f.match(MIGHT_LE)
  const filter = le
    ? (u: UnitInPlay) => u.card.might + (u.counters.mightTurn ?? 0) <= parseInt(le[1], 10)
    : undefined

  if (/\benemy unit\b/.test(f)) return { kind: 'enemyUnit', filter }
  if (/\bfriendly unit\b/.test(f)) return { kind: 'friendlyUnit', filter }
  if (/\bunit (?:at a battlefield|here)\b/.test(f) || /\bat a battlefield\b/.test(f))
    return { kind: 'unitAtBattlefield', filter }
  if (/\b(?:a|an|another|that|target) units?\b/.test(f) || /\ba unit\b/.test(f))
    return { kind: 'unit', filter }
  return null
}

// ── one clause → an op (a state transform + optional target spec) ─────────

interface Op {
  spec?: TargetSpec
  run: (state: GameState, ctx: EffectCtx, target?: UnitInPlay) => GameState
}

const NUM = (s: string | undefined, dflt = 1) =>
  s && /\d/.test(s) ? parseInt(s, 10) : dflt

function opsForClause(clause: string): Op[] {
  const c = clause
  const out: Op[] = []
  const side = (ctx: EffectCtx) => ctx.controller

  // [Burn N]
  const burnM = c.match(/burn\]?\s*(\d+)/)
  if (burnM) out.push({ run: (s, ctx) => burn(s, side(ctx), parseInt(burnM[1], 10)) })

  // Deal N to <target>
  const dealM = c.match(/deals?\s+(\d+)(?:\s+damage)?\s+to\s+([^.]*)/)
  if (dealM) {
    out.push({
      spec: specFor(dealM[2]) ?? { kind: 'unit' },
      run: (s, ctx, t) => (t ? dealDamage(s, t.instanceId, parseInt(dealM[1], 10), ctx.emit) : s),
    })
  }

  // Give <target> +N / -N might [this turn]  (+ optional "and another unit -N …")
  for (const m of c.matchAll(
    /give\s+(?:me|(?:an?\s+)?(?:enemy|friendly)?\s*(?:another\s+)?unit|it|that unit)\s+([+\-−]\d+)\s*(?::rb_might:|\[m\]|might)/g,
  )) {
    const n = parseInt(m[1].replace('−', '-'), 10)
    const perm = !/this turn/.test(c)
    const selfRef = /give\s+me\b/.test(m[0])
    out.push({
      spec: selfRef ? { kind: 'self' } : specFor(m[0]) ?? { kind: 'unit' },
      run: (s, _ctx, t) =>
        t ? (perm ? giveMightPermanent(s, t.instanceId, n) : giveMight(s, t.instanceId, n)) : s,
    })
  }

  // Give <target> [Assault N] / [Deflect N] this turn
  const kwGrant = c.match(/give\s+([^.]*?)\[(assault|deflect|shield)\s*(\d+)?\]/)
  if (kwGrant) {
    const kw = kwGrant[2][0].toUpperCase() + kwGrant[2].slice(1)
    const n = NUM(kwGrant[3], kwGrant[2] === 'assault' ? 3 : 1)
    const selfRef = /\bme\b/.test(kwGrant[1])
    out.push({
      spec: selfRef ? { kind: 'self' } : specFor(kwGrant[1]) ?? { kind: 'unit' },
      run: (s, _ctx, t) => (t ? grantKeywordThisTurn(s, t.instanceId, kw, n) : s),
    })
  }

  // (predict / discard / draw are order-sensitive and handled once in parseOps)

  // Return <target> to hand / base
  const retM = c.match(/return\s+([^.]*?)\s+to\s+(?:its owner's\s+)?(hand|base)/)
  if (retM) {
    const toBase = retM[2] === 'base'
    out.push({
      spec: specFor(retM[1]) ?? { kind: 'unit' },
      run: (s, ctx, t) =>
        t
          ? toBase
            ? moveUnitEffect(s, t.instanceId, { kind: 'base' }, {}, ctx.emit)
            : bounceUnit(s, t.instanceId)
          : s,
    })
  }

  // Recall <target>
  if (/\brecall\b/.test(c) && !retM) {
    out.push({ spec: specFor(c) ?? { kind: 'unit' }, run: (s, _c, t) => (t ? recall(s, t.instanceId) : s) })
  }

  // Ready N runes
  const readyRunes = c.match(/ready\s+(\d+)\s+runes?/)
  if (readyRunes) out.push({ run: (s, ctx) => bankEnergy(s, side(ctx), parseInt(readyRunes[1], 10)) })

  // Ready (a | N) gear  (Jayce legend)
  const readyGearM = c.match(/ready\s+(a|\d+)\s+gear/)
  if (readyGearM) {
    const n = readyGearM[1] === 'a' ? 1 : parseInt(readyGearM[1], 10)
    out.push({ run: (s, ctx) => readyGear(s, side(ctx), n) })
  }

  // Empower (another | a) gear  (Hextech Formula)
  if (/empower\s+(another|a)\s+gear/.test(c)) {
    out.push({
      spec: { kind: 'otherGear' },
      run: (s, ctx) => {
        const g = ctx.targets.find((x) => x.kind === 'gear')
        return g?.instanceId ? empowerGear(s, g.instanceId) : s
      },
    })
  }

  // Ready <a unit> [and give it [Assault N]]  /  Move <a unit> and ready it
  const readyUnitM = c.match(/(?:^|\.\s*)ready\s+(?:up to \d+\s+)?(?:a\s+|that\s+)?(?:friendly\s+)?(unit|it)/)
  const moveReady = c.match(/move\s+(?:a\s+)?(?:friendly\s+)?unit\s+and\s+ready\s+it/)
  if (moveReady) {
    out.push({
      spec: { kind: 'friendlyUnit' },
      run: (s, ctx, t) =>
        t ? moveUnitEffect(s, t.instanceId, { kind: 'base' }, { ready: true }, ctx.emit) : s,
    })
  } else if (readyUnitM && !readyRunes) {
    out.push({
      spec: specFor(c) ?? { kind: 'unit' },
      run: (s, _c, t) => (t ? readyUnit(s, t.instanceId) : s),
    })
  }

  // Plain "Move <up to N> <friendly> unit(s) [to base]"  (no "and ready")
  if (!moveReady && /\bmove\s+(?:up to \d+\s+)?(?:a\s+|two\s+)?(?:friendly\s+)?units?\b/.test(c)) {
    out.push({
      spec: { kind: 'friendlyUnit' },
      run: (s, ctx, t) =>
        t ? moveUnitEffect(s, t.instanceId, { kind: 'base' }, {}, ctx.emit) : s,
    })
  }

  // Play a [ready] N Might <Name> unit token [to your base / here]
  const tokM = c.match(
    /play\s+(?:a|two)\s+(?:ready\s+)?(\d+)\s*(?::rb_might:|\[m\]|might)\s+([a-z][a-z' ]*?)\s+unit token/,
  )
  if (tokM) {
    const might = parseInt(tokM[1], 10)
    const name = tokM[2].replace(/\b\w/g, (ch) => ch.toUpperCase()).trim()
    const ready = /\bready\b/.test(tokM[0])
    out.push({
      run: (s, ctx) =>
        createToken(s, side(ctx), name, { kind: 'base' }, { might, ready, emit: ctx.emit }),
    })
  }

  // Gain N XP
  const xpM = c.match(/gain\s+(\d+)\s+xp/)
  if (xpM) out.push({ run: (s, ctx) => gainXP(s, side(ctx), parseInt(xpM[1], 10)) })

  // Score N point(s)
  const ptM = c.match(/\bscore\s+(\d+)\s+point/)
  if (ptM) out.push({ run: (s, ctx) => scorePoints(s, side(ctx), parseInt(ptM[1], 10)) })

  // [Add] :rb_energy_N:
  const addM = c.match(/\[add\]\s*:rb_energy_(\d+):/)
  if (addM) out.push({ run: (s, ctx) => addEnergy(s, side(ctx), parseInt(addM[1], 10)) })

  // Stun / Buff / Heal a unit
  if (/\bstun\b/.test(c) && !out.length)
    out.push({ spec: specFor(c) ?? { kind: 'unit' }, run: (s, _c, t) => (t ? stun(s, t.instanceId) : s) })
  if (/\bbuff\b/.test(c))
    out.push({ spec: specFor(c) ?? { kind: 'unit' }, run: (s, _c, t) => (t ? buff(s, t.instanceId) : s) })
  if (/\bheal\b/.test(c))
    out.push({
      spec: /\bme\b/.test(c) ? { kind: 'self' } : specFor(c) ?? { kind: 'unit' },
      run: (s, _c, t) => (t ? heal(s, t.instanceId) : s),
    })

  // Kill <target>
  if (/\bkill\s+(?:a\s+)?(?:friendly\s+|enemy\s+)?unit/.test(c))
    out.push({
      spec: specFor(c) ?? { kind: 'unit' },
      run: (s, ctx, t) => (t ? killUnit(s, t.instanceId, ctx.emit) : s),
    })

  // Counter a spell
  if (/counter a spell/.test(c))
    out.push({
      spec: { kind: 'stackSpell' },
      run: (s, ctx) => {
        const t = ctx.targets.find((x) => x.kind === 'stackItem')
        return t?.stackItemId ? counterStackItem(s, t.stackItemId) : s
      },
    })

  // Look at the top N … put 1 into your hand and recycle the rest
  const digM = c.match(/look at the top (\d+) cards? of your main deck\. .*put 1 into your hand/)
  if (digM) out.push({ run: (s, ctx) => digTopN(s, side(ctx), parseInt(digM[1], 10), 1) })

  return out
}

/** Whole-text ops for order-sensitive draw / predict / discard / dig phrasings. */
function drawOps(text: string): Op[] {
  const joined = stripReminders(effectText(text).replace(/\[>\]/g, '. ')).toLowerCase()
  if (/additional cost to play/.test(joined)) return [] // handled as a play option
  const ops: Op[] = []
  const side = (ctx: EffectCtx) => ctx.controller

  const drawM = joined.match(/draw\s+(\d+|a card|one card|two cards)/)
  const drawN = drawM ? (/\d/.test(drawM[1]) ? parseInt(drawM[1], 10) : drawM[1].startsWith('two') ? 2 : 1) : 0
  const drawThen = (ctx: EffectCtx) => (s: GameState) => (drawN > 0 ? draw(s, side(ctx), drawN) : s)

  const predM = joined.match(/\bpredict\s*(\d+)/)
  const digM = joined.match(/look at the top (\d+) cards? of your main deck\.?\s*put 1 into your hand/)
  const disM = joined.match(/(?:^|\.\s*)discard\s+(\d+|a card|one)\b/)
  const disIsCost = /discard[^.]*as an additional cost/.test(joined)

  let drawConsumed = false
  if (predM) {
    const x = parseInt(predM[1], 10)
    ops.push({ run: (s, ctx) => predictChoice(s, side(ctx), x, drawThen(ctx)) })
    drawConsumed = drawN > 0
  } else if (digM) {
    ops.push({ run: (s, ctx) => digTopN(s, side(ctx), parseInt(digM[1], 10), 1) })
  } else if (disM && !disIsCost) {
    const n = NUM(disM[1])
    ops.push({ run: (s, ctx) => discardChoice(s, side(ctx), n, drawThen(ctx)) })
    drawConsumed = drawN > 0
  }
  if (drawM && !drawConsumed) ops.push({ run: (s, ctx) => draw(s, side(ctx), drawN) })
  return ops
}

// Whole-text ops: strip the Flow reminder clause, then flatten all clauses.
function parseOps(text: string): Op[] {
  const ops: Op[] = []
  for (const clause of clausesOf(text)) {
    if (/^\[flow/.test(clause) || /you may play (this|it) from your trash/.test(clause)) continue
    ops.push(...opsForClause(clause))
  }
  ops.push(...drawOps(text))
  return ops
}

export function compileTargets(text: string): TargetSpec[] {
  // For "<base>. If [Empowered] / If you paid the additional cost, <boosted>
  // instead." both branches target the same thing — only count the base.
  const cond = decode(text).match(
    /^(.+?)\.\s*if (?:(?:this is|i(?:'|’)?m) \[empowered\]|you paid the additional cost),?\s*.+?\s+instead\.?$/is,
  )
  if (cond) return compileTargets(cond[1])

  return parseOps(text)
    .map((o) => o.spec)
    .filter((s): s is TargetSpec => !!s)
}

export function compileEffect(text: string): Effect | null {
  // "<base>. If this is/I'm [Empowered], <boosted> instead." — pick one branch.
  const cond = decode(text).match(
    /^(.+?)\.\s*if (?:this is|i(?:'|’)?m) \[empowered\],?\s*(.+?)\s+instead\.?$/is,
  )
  if (cond) {
    const base = compileEffect(cond[1])
    const boosted = compileEffect(cond[2])
    if (base || boosted) {
      return (ctx) => {
        const branch = isEmpowered(ctx.source) ? boosted : base
        return branch ? branch(ctx) : ctx.state
      }
    }
  }

  // "<base>. If you paid the additional cost, <boosted> instead." (Ruthless Strike)
  const paid = decode(text).match(
    /^(.+?)\.\s*if you paid the additional cost,?\s*(.+?)\s+instead\.?$/is,
  )
  if (paid) {
    const base = compileEffect(paid[1])
    const boosted = compileEffect(paid[2])
    if (base || boosted) {
      return (ctx) => {
        const branch = ctx.paidAdditional ? boosted : base
        return branch ? branch(ctx) : ctx.state
      }
    }
  }

  // "[you may] banish a card/unit from (any|your|a) trash [to <effect>] /
  //  [. If you do, <effect>]" — banish, then run the continuation only if it hit.
  const ban = decode(text).match(
    /(?:you may\s+)?banish\s+(a card|a unit|1)\s+from\s+(any|your|a)\s+trash[.,]?\s*(?:to\s+|if you do,?\s*)?(.*)$/is,
  )
  if (ban) {
    const unitsOnly = /unit/i.test(ban[1])
    const fromAnyTrash = /any/i.test(ban[2])
    const rest = ban[3]?.trim()
    const cont = rest ? compileEffect(rest) : null
    return (ctx) => {
      const before = ctx.state
      const s = banishFromTrash(before, ctx.controller, { fromAnyTrash, unitsOnly, emit: ctx.emit })
      if (s === before) return before // nothing banished — the "if you do" fails
      return cont ? cont({ ...ctx, state: s }) : s
    }
  }

  const ops = parseOps(text)
  if (ops.length === 0) return null
  return (ctx) => {
    let s = ctx.state
    let ti = 0
    for (const op of ops) {
      const t = op.spec ? resolveOpTarget(op.spec, ctx, s, ti++) : undefined
      s = op.run(s, { ...ctx, state: s }, t)
    }
    return s
  }
}

function resolveOpTarget(
  spec: TargetSpec,
  ctx: EffectCtx,
  state: GameState,
  index: number,
): UnitInPlay | undefined {
  if (spec.kind === 'self') return ctx.source as UnitInPlay | undefined
  const rt = ctx.targets[index]
  if (rt?.instanceId) {
    return [state.player.base, state.ai.base, ...state.battlefields.map((b) => b.units)]
      .flat()
      .find((u) => u.instanceId === rt.instanceId)
  }
  return undefined
}

// ── cost parsing (Empower / activated) ───────────────────────────────────

export function parseCost(fragment: string): ActivatedAbility['cost'] {
  const cost: ActivatedAbility['cost'] = {}
  const e = fragment.match(/:rb_energy_(\d+):/)
  if (e) cost.energy = parseInt(e[1], 10)
  // Each `:rb_rune_<domain>:` symbol exhausts one channeled rune (rainbow = any).
  const runes = fragment.match(/:rb_rune_([a-z]+):/g)
  if (runes) {
    cost.runes = runes.map((t) => {
      const d = t.replace(/^:rb_rune_|:$/g, '')
      return (d === 'rainbow' ? 'colorless' : d) as NonNullable<typeof cost.runes>[number]
    })
  }
  if (/:rb_exhaust:/.test(fragment) || /\bexhaust\b/.test(fragment)) cost.exhaustSelf = true
  const d = fragment.match(/discard\s+(\d+|a card|a gear|one)/i)
  if (d) cost.discard = /\d/.test(d[1]) ? parseInt(d[1], 10) : 1
  const r = fragment.match(/recycle\s+(\d+)\s+from/i)
  if (r) cost.recycleFromTrash = parseInt(r[1], 10)
  if (/disempower (this|me)/i.test(fragment)) cost.disempowerSelf = true
  return cost
}

// ── Empowered bonus ("[Empowered][>] I have +N [M]" / "[Assault N]") ──────

function empoweredBonus(text: string): { might?: number; assault?: number } {
  const dec = decode(text)
  const m = dec.match(/\[empowered\]\[>\][^.]*?i have\s+\+(\d+)\s*(?::rb_might:|\[m\]|might)/i)
  const a = dec.match(/\[empowered\]\[>\][^.]*?\[assault\s*(\d+)\]/i)
  return { might: m ? parseInt(m[1], 10) : undefined, assault: a ? parseInt(a[1], 10) : undefined }
}

// ── keyword-driven abilities ─────────────────────────────────────────────

export function autoAbilities(card: Card): {
  activated: ActivatedAbility[]
  triggers: TriggeredAbility[]
} {
  // Keyword-cost extraction runs on the UNSTRIPPED text so the reminder "(" ends
  // the cost token run (and doesn't bleed into a following ability's cost).
  const raw = decode(card.text)
  const dec = stripReminders(raw)
  const activated: ActivatedAbility[] = []
  const triggers: TriggeredAbility[] = []

  const COST_RUN = /(?:—\s*)?((?::rb_[a-z0-9_]+:|discard\s+(?:\d+|a card|a gear|one)|[,\s])*)/i

  // [Empower <cost>] — pay to gain the Empowered status.
  const empM = raw.match(new RegExp(`\\[empower\\]\\s*${COST_RUN.source}`, 'i'))
  const empowerCost = empM ? empM[1].trim().replace(/[,\s]+$/, '') : null
  if (empM) {
    activated.push({
      label: `Empower${empowerCost ? ` — ${prettyCost(empowerCost)}` : ''}`,
      cost: parseCost(empowerCost || ':rb_exhaust:'),
      when: (_s, src) => !isEmpowered(src),
      effect: (ctx) => (ctx.source ? setEmpoweredSafe(ctx) : ctx.state),
    })
  }

  // [Equip <cost>] — pay to attach this Equipment to a friendly unit.
  const eqM = card.type === 'gear' ? raw.match(new RegExp(`\\[?equip\\]?\\s*${COST_RUN.source}`, 'i')) : null
  const equipCost = eqM ? eqM[1].trim().replace(/[,\s]+$/, '') : null
  if (eqM) {
    activated.push({
      label: `Equip${equipCost ? ` — ${prettyCost(equipCost)}` : ''}`,
      cost: parseCost(equipCost ?? ''),
      targets: [{ kind: 'friendlyUnit' }],
      effect: (ctx) =>
        ctx.source && ctx.targets[0]?.instanceId
          ? attachGear(ctx.state, ctx.source.instanceId, ctx.targets[0].instanceId)
          : ctx.state,
    })
  }

  // [Vision] — predict 1 on entering play.
  if (/\[vision\]/i.test(dec)) {
    triggers.push({
      on: 'UNIT_ENTERED',
      self: true,
      effect: (ctx) => predictChoice(ctx.state, ctx.controller, 1),
    })
  }

  // [Deathknell][>] <clause>
  const dk = dec.match(/\[deathknell\]\[>\]\s*([^.]*(?:\.[^.]*)?)/i)
  if (dk) {
    const eff = compileEffect(dk[1])
    if (eff) triggers.push({ on: 'UNIT_DIED', self: true, effect: eff })
  }

  // "<cost>: <Effect>." — a plain activated ability (Sky Cruiser, Vi, Tools of Empire, …).
  // Merge an "If [Empowered], … instead." sentence back onto the ability it modifies.
  // A bare "[Empowered]" marker (from "[Empowered][>] <cost>: <effect>") gates the
  // ability that follows it — track it rather than emitting it as a clause.
  const abilityClauses: { text: string; empGated: boolean }[] = []
  let pendingEmpGate = false
  for (const cl of rawClauses(card.text)) {
    if (/^\[empowered\]\.?\s*$/i.test(cl)) {
      pendingEmpGate = true
      continue
    }
    if (/^if (?:this is|i(?:'|’)?m|you)\b/i.test(cl) && abilityClauses.length) {
      const last = abilityClauses[abilityClauses.length - 1]
      last.text = last.text.replace(/\.\s*$/, '') + `. ${cl}`
    } else {
      abilityClauses.push({ text: cl, empGated: pendingEmpGate })
      pendingEmpGate = false
    }
  }
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const leadStrip = new RegExp(
    `^\\[empower\\]\\s*(?:—\\s*)?${empowerCost ? esc(empowerCost) : ''}\\s*` +
      `|^\\[equip\\]\\s*(?:—\\s*)?${equipCost ? esc(equipCost) : ''}\\s*`,
    'i',
  )
  for (const { text: rawClause, empGated } of abilityClauses) {
    // Drop a leading "[Empower] <cost>" / "[Equip] <cost>" run — that ability is
    // parsed by its dedicated block above, and it must not be mistaken for the
    // cost of the "<cost>: <effect>" ability that follows on the same line.
    const clause = rawClause.replace(leadStrip, '')
    // Mark the real cost/effect divider — a "::" after a cost token, or a ":"
    // after a plain word — immediately before the capitalised effect. (A cost
    // token is exhaust / energy / rune, never :rb_might:.)
    const COST_TOK = /(?::rb_(?:exhaust|energy_\d+|rune_[a-z]+):)/
    const marked = clause
      .replace(new RegExp(`(${COST_TOK.source}):(\\s+[A-Z])`, 'g'), '$1‖$2')
      .replace(new RegExp(`(${COST_TOK.source})(\\s+[A-Z])`, 'g'), '$1‖$2')
      // a ":" after a plain word — but never the closing ":" of an :rb_*: token
      .replace(/(?<!:rb_[a-z0-9_]*)([a-z0-9]):(\s+[A-Z])/g, '$1‖$2')
    const parts = marked.split('‖')
    if (parts.length < 2) continue
    const costFrag = parts.slice(0, -1).join(':').replace(/‖/g, ':')
    const effFrag = parts[parts.length - 1].trim()
    if (!/:rb_exhaust:|:rb_energy_\d+:|recycle \d+ from|disempower|discard /i.test(costFrag)) continue
    const eff = compileEffect(effFrag)
    if (!eff) continue
    // Trim crumbs off the label — a leading "This enters exhausted." folded in
    // when there was no space after its period, and any stray reminder text.
    const prettyC = prettyCost(costFrag).replace(/^this enters exhausted\.\s*/i, '').trim()
    const prettyE = effFrag
      .replace(/:rb_[a-z0-9_]+:/g, '')
      .replace(/^\s*this enters exhausted\.\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
    activated.push({
      label: `${prettyC}: ${prettyE}`,
      cost: parseCost(costFrag),
      targets: compileTargets(effFrag),
      effect: eff,
      ...(empGated ? { when: (_s, src) => isEmpowered(src) } : {}),
    })
  }

  return { activated, triggers }
}

function prettyCost(frag: string): string {
  return frag
    .replace(/:rb_energy_(\d+):/g, '$1⚡')
    .replace(/:rb_rune_[a-z]+:/g, '✦')
    .replace(/:rb_exhaust:/g, '↻')
    .replace(/\s+/g, ' ')
    .trim()
}

// Mark the ability's own source (unit / legend-on-a-unit / gear) Empowered.
function setEmpoweredSafe(ctx: EffectCtx): GameState {
  const id = ctx.source!.instanceId
  const mark = <T extends { instanceId: string }>(x: T): T =>
    x.instanceId === id ? { ...x, empowered: true } : x
  const s = ctx.state
  return {
    ...s,
    player: {
      ...s.player,
      base: s.player.base.map(mark),
      gear: s.player.gear.map(mark),
    },
    ai: { ...s.ai, base: s.ai.base.map(mark), gear: s.ai.gear.map(mark) },
    battlefields: s.battlefields.map((bf) => ({ ...bf, units: bf.units.map(mark) })),
  }
}

// ── "when …" text triggers for units ────────────────────────────────────

const TRIGGER_PHRASES: { on: TriggeredAbility['on']; re: RegExp; self?: boolean; byController?: boolean }[] = [
  { on: 'UNIT_ENTERED', re: /when you play me(?:\s+to a battlefield)?,\s*/i, self: true },
  { on: 'UNIT_ENTERED', re: /when i enter(?:\s+play)?,\s*/i, self: true },
  { on: 'UNIT_MOVED', re: /(?:the first time )?when i move(?:\s+to a battlefield| each turn)?,\s*/i, self: true },
  { on: 'UNIT_MOVED', re: /the first time i move each turn,\s*/i, self: true },
  { on: 'CONQUERED', re: /when i conquer,\s*/i, self: true },
  { on: 'HELD', re: /when i hold,\s*/i, self: true },
  { on: 'COMBAT_WON', re: /(?:the first time )?(?:when )?i win a combat(?: each turn)?,\s*/i, self: true },
  { on: 'UNIT_DIED', re: /when i die,\s*/i, self: true },
  { on: 'UNIT_MOVED', re: /when i attack,\s*/i, self: true },
]

const ALL_TRIGGER_RE = new RegExp(
  TRIGGER_PHRASES.map((p) => p.re.source).join('|'),
  'i',
)

function textTriggers(card: Card): TriggeredAbility[] {
  const dec = effectText(card.text)
  const out: TriggeredAbility[] = []
  for (const p of TRIGGER_PHRASES) {
    const m = dec.match(p.re)
    if (!m) continue
    // The effect is everything after the phrase up to the next trigger phrase
    // (or the end / a [Flow] tail).
    let rest = dec.slice(m.index! + m[0].length)
    const nextTrig = rest.slice(1).search(ALL_TRIGGER_RE)
    if (nextTrig >= 0) rest = rest.slice(0, nextTrig + 1)
    let eff = compileEffect(rest)
    if (!eff) continue
    const paidGated = /if you paid the additional cost/i.test(rest)
    if (paidGated) {
      const inner = eff
      eff = (ctx) =>
        (ctx.source?.counters.paidExtra ?? 0) > 0 || ctx.paidAdditional
          ? inner(ctx)
          : ctx.state
    }
    // "if you control N or more (other) gear, …"  (Patched Porobot)
    const gearGate = rest.match(/if you control (\d+) or more (?:other )?gear/i)
    if (gearGate) {
      const need = parseInt(gearGate[1], 10)
      const inner = eff
      eff = (ctx) => (gearCount(ctx.state, ctx.controller) >= need ? inner(ctx) : ctx.state)
    }
    out.push({
      on: p.on,
      self: p.self,
      byController: p.byController,
      targets: compileTargets(rest),
      effect: eff,
    })
  }
  return out
}

// ── assembly (memoised) ─────────────────────────────────────────────────

const _cache = new Map<string, CardScript>()

export function compileScript(card: Card): CardScript {
  // Key on the printing, not the per-copy instance id, so every copy of a card
  // shares one compiled script and the cache stays small.
  const key = card.id.includes('~') ? card.id.slice(0, card.id.indexOf('~')) : card.id
  const hit = _cache.get(key)
  if (hit) return hit

  // No `keywords` here — those already come straight off `card.keywords` at the
  // call sites; duplicating them would double-count Assault/Shield.
  const script: CardScript = {}

  if (card.type === 'spell') {
    const eff = compileEffect(card.text)
    if (eff) script.play = { targets: compileTargets(card.text), effect: eff }
  } else if (card.type === 'gear') {
    // Gear are persistent permanents: their activated bodies (Empower /
    // "<cost>: <effect>") and Equip are NOT on-play effects. An on-enter effect
    // is only compiled from an explicit "when you play me/this, …" clause.
    const onPlay = decode(card.text).match(/when you play (?:me|this),?\s*([^.]*(?:\.[^.]*)*)/i)
    const eff = onPlay ? compileEffect(onPlay[1]) : null
    if (eff) script.play = { targets: compileTargets(onPlay![1]), effect: eff }
    const auto = autoAbilities(card)
    if (auto.activated.length) script.activated = auto.activated
    if (auto.triggers.length) script.triggers = auto.triggers
    const bonus = empoweredBonus(card.text)
    if (bonus.might) script.empoweredMight = bonus.might
    if (bonus.assault) script.empoweredAssault = bonus.assault
  } else {
    const trigs = textTriggers(card)
    const auto = autoAbilities(card)
    if (trigs.length || auto.triggers.length) script.triggers = [...trigs, ...auto.triggers]
    if (auto.activated.length) script.activated = auto.activated
    const bonus = empoweredBonus(card.text)
    if (bonus.might) script.empoweredMight = bonus.might
    if (bonus.assault) script.empoweredAssault = bonus.assault
  }

  _cache.set(key, script)
  return script
}

/** Test hook — forget compiled scripts. */
export function _clearCompileCache(): void {
  _cache.clear()
}
