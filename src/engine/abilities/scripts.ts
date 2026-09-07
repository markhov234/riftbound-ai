import { Card } from '../../types/card'
import { GameState } from '../../types/game'
import {
  bankEnergy,
  bounceUnit,
  buff,
  burn,
  counterStackItem,
  createToken,
  dealDamage,
  digTopN,
  discardCards,
  draw,
  EffectCtx,
  gainXP,
  giveMight,
  giveMightPermanent,
  grantKeywordThisTurn,
  killGear,
  moveUnitEffect,
  predictChoice,
  readyUnit,
  returnCardFromTrash,
  returnSpellFromTrash,
  returnUnitsFromTrash,
  scorePoints,
  setEmpowered,
  soleControllerAt,
  stun,
  targetUnit,
} from './effects'
import { autoAbilities, compileScript } from './compile'
import { isEmpowered, legionActive, levelActive } from './statuses'
import { ActivatedAbility, CardScript } from './types'
import { appendLog } from '../state'

// Registry keyed by a normalized card name. `scriptFor` normalizes the card's
// name / cleanName the same way and looks both up.

export function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const R = (name: string, script: CardScript): [string, CardScript] => [normKey(name), script]

export const CARD_SCRIPTS: Record<string, CardScript> = Object.fromEntries([
  // ── Irelia deck ────────────────────────────────────────────────────────
  // Irelia - Blade Dancer (legend): "When you choose a friendly unit, you may
  // exhaust me and pay a rune to ready it." Modelled as an activated ability:
  // exhaust the legend + 1 rune → ready one of your exhausted units.
  R('Irelia - Blade Dancer', {
    activated: [
      {
        // `exhaustSelf` already blocks re-use for the turn (see `activateAbility`
        // + the legend-ability filter in GameBoard); no `when` guard, since one
        // would re-fire against the just-exhausted legend at resolution.
        label: 'Exhaust + 1 rune: ready a friendly unit',
        cost: { exhaustSelf: true, runes: ['colorless'] },
        targets: [{ kind: 'friendlyUnit', filter: (u) => u.exhausted }],
        effect: (ctx) => {
          const u = targetUnit(ctx)
          if (!u) return ctx.state
          return appendLog(readyUnit(ctx.state, u.instanceId), `Irelia readies ${u.card.name}.`)
        },
      },
    ],
  }),
  R('Irelia - Fervent', { keywords: ['Deflect'] }),
  R('Draven - Audacious', {
    keywords: ['Deflect'],
    triggers: [
      {
        on: 'COMBAT_WON',
        self: true,
        condition: (_e, _s, src) => (src?.counters.combatWinsThisTurn ?? 0) === 1,
        effect: (ctx) => scorePoints(ctx.state, ctx.controller, 1),
      },
      {
        on: 'UNIT_DIED',
        self: true,
        condition: (e) => e.type === 'UNIT_DIED' && e.inCombat,
        effect: (ctx) =>
          scorePoints(ctx.state, ctx.controller === 'player' ? 'ai' : 'player', 1),
      },
    ],
  }),
  R('Stellacorn Herder', {
    triggers: [{ on: 'UNIT_MOVED', self: true, effect: (ctx) => draw(ctx.state, ctx.controller, 1) }],
  }),
  R('Defy', {
    play: {
      timing: 'reaction',
      targets: [
        {
          kind: 'stackSpell',
          spellFilter: (c) => c.energy <= 4,
        },
      ],
      effect: (ctx) => {
        const t = ctx.targets.find((x) => x.kind === 'stackItem')
        return t?.stackItemId ? counterStackItem(ctx.state, t.stackItemId) : ctx.state
      },
    },
  }),
  R('Discipline', {
    play: {
      timing: 'reaction',
      targets: [{ kind: 'unit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        let s = ctx.state
        if (u) s = giveMight(s, u.instanceId, 2)
        return draw(s, ctx.controller, 1)
      },
    },
  }),
  R('En Garde', {
    play: {
      timing: 'reaction',
      targets: [{ kind: 'friendlyUnit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        if (!u) return ctx.state
        let s = giveMight(ctx.state, u.instanceId, 1)
        if (soleControllerAt(s, u)) s = giveMight(s, u.instanceId, 1)
        return s
      },
    },
  }),
  R('Fight or Flight', {
    play: {
      timing: 'action',
      targets: [{ kind: 'unit', filter: (u) => u.location.kind === 'battlefield' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? moveUnitEffect(ctx.state, u.instanceId, { kind: 'base' }, {}, ctx.emit) : ctx.state
      },
    },
  }),
  R('Gust', {
    play: {
      timing: 'reaction',
      targets: [
        {
          kind: 'unitAtBattlefield',
          filter: (u) => u.card.might + (u.counters.mightTurn ?? 0) <= 3,
        },
      ],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? bounceUnit(ctx.state, u.instanceId) : ctx.state
      },
    },
  }),
  R('Ride the Wind', {
    play: {
      timing: 'action',
      targets: [{ kind: 'friendlyUnit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        if (!u || u.location.kind !== 'battlefield') {
          return u ? readyUnit(ctx.state, u.instanceId) : ctx.state
        }
        // Move to another battlefield and ready — interim behaviour. With 2
        // battlefields in a 1v1 this is "move to the other one".
        const count = ctx.state.battlefields.length
        const to = { kind: 'battlefield' as const, index: (u.location.index + 1) % count }
        return moveUnitEffect(ctx.state, u.instanceId, to, { ready: true }, ctx.emit)
      },
    },
  }),
  R('Stacked Deck', {
    play: { timing: 'action', effect: (ctx) => digTopN(ctx.state, ctx.controller, 3, 1) },
  }),
  R('Defiant Dance', {
    play: {
      timing: 'reaction',
      targets: [{ kind: 'unit' }, { kind: 'unit' }],
      effect: (ctx) => {
        const a = targetUnit(ctx, 0)
        const b = targetUnit(ctx, 1)
        let s = ctx.state
        if (a) s = giveMight(s, a.instanceId, 2)
        if (b) s = giveMight(s, b.instanceId, -2)
        return s
      },
    },
  }),
  R('Guardian Angel', {
    play: {
      timing: 'action',
      targets: [{ kind: 'friendlyUnit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? grantShield(ctx.state, u.instanceId) : ctx.state
      },
    },
  }),
  R('Heart of Dark Ice', {
    play: {
      timing: 'action',
      targets: [{ kind: 'unit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? giveMight(ctx.state, u.instanceId, 3) : ctx.state
      },
    },
  }),
  R("Zhonya's Hourglass", {
    play: {
      timing: 'action',
      targets: [{ kind: 'friendlyUnit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? grantShield(ctx.state, u.instanceId) : ctx.state
      },
    },
  }),

  // ── Annie deck ─────────────────────────────────────────────────────────
  R('Annie - Dark Child', {
    triggers: [
      {
        on: 'TURN_ENDED',
        condition: (e, _s, _src) => e.type === 'TURN_ENDED',
        byController: true,
        effect: (ctx) => bankEnergy(ctx.state, ctx.controller, 2),
      },
    ],
  }),
  R('Annie - Stubborn', {
    triggers: [
      {
        on: 'UNIT_ENTERED',
        self: true,
        choose: {
          kind: 'trashCard',
          min: 1,
          max: 1,
          label: 'Return a spell from your trash to your hand',
          legal: (state, _src, controller) =>
            (controller === 'player' ? state.player : state.ai).trash
              .filter((c) => c.type === 'spell')
              .map((c) => c.id),
        },
        effect: (ctx) =>
          ctx.picks && ctx.picks[0]
            ? returnCardFromTrash(ctx.state, ctx.controller, ctx.picks[0])
            : returnSpellFromTrash(ctx.state, ctx.controller),
      },
    ],
  }),
  R('Darius - Trifarian', {
    triggers: [
      {
        on: 'CARD_PLAYED',
        byController: true,
        condition: (e) => e.type === 'CARD_PLAYED' && e.nth === 2,
        effect: (ctx) => {
          if (!ctx.source) return ctx.state
          const s = giveMight(ctx.state, ctx.source.instanceId, 2)
          return readyUnit(s, ctx.source.instanceId)
        },
      },
    ],
  }),
  R("Kai'Sa - Survivor", {
    keywords: ['Accelerate'],
    triggers: [
      {
        on: 'CONQUERED',
        condition: (e, _s, src) =>
          e.type === 'CONQUERED' &&
          !!src &&
          src.owner === e.side &&
          src.location.kind === 'battlefield' &&
          src.location.index === e.index,
        effect: (ctx) => draw(ctx.state, ctx.controller, 1),
      },
    ],
  }),
  R('Vi - Destructive', {
    keywords: ['Ganking'],
    activated: [
      {
        label: 'Recycle 1 from trash: +1 might this turn',
        cost: { recycleFromTrash: 1 },
        effect: (ctx) =>
          ctx.source ? giveMight(ctx.state, ctx.source.instanceId, 1) : ctx.state,
      },
    ],
  }),
  R('Pouty Poro', { keywords: ['Deflect'] }),
  R('Sneaky Deckhand', {
    // [Deathknell] — when this dies, its controller draws a card.
    triggers: [
      {
        on: 'UNIT_DIED',
        self: true,
        effect: (ctx) => draw(ctx.state, ctx.controller, 1),
      },
    ],
  }),
  R('Traveling Merchant', {
    triggers: [
      {
        on: 'UNIT_MOVED',
        self: true,
        choose: {
          kind: 'handCard',
          min: 1,
          max: 1,
          label: 'Discard a card, then draw 1',
          legal: (state, _src, controller) =>
            (controller === 'player' ? state.player : state.ai).hand.map((c) => c.id),
        },
        effect: (ctx) =>
          draw(discardCards(ctx.state, ctx.controller, ctx.picks ?? [], ctx.emit), ctx.controller, 1),
      },
    ],
  }),
  R('Cleave', {
    play: {
      timing: 'action',
      targets: [{ kind: 'unit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? grantKeywordThisTurn(ctx.state, u.instanceId, 'Assault', 3) : ctx.state
      },
    },
  }),
  R('Flash', {
    play: {
      timing: 'reaction',
      targets: [
        { kind: 'friendlyUnit', filter: (u) => u.location.kind === 'battlefield', optional: true },
        { kind: 'friendlyUnit', filter: (u) => u.location.kind === 'battlefield', optional: true },
      ],
      effect: (ctx) => {
        let s = ctx.state
        for (const t of ctx.targets) {
          if (t.instanceId) s = moveUnitEffect(s, t.instanceId, { kind: 'base' }, {}, ctx.emit)
        }
        return s
      },
    },
  }),
  R('Rebuke', {
    play: {
      timing: 'action',
      targets: [{ kind: 'unitAtBattlefield' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        return u ? bounceUnit(ctx.state, u.instanceId) : ctx.state
      },
    },
  }),
  R('Void Seeker', {
    play: {
      timing: 'action',
      targets: [{ kind: 'unitAtBattlefield' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        let s = ctx.state
        if (u) s = dealDamage(s, u.instanceId, 4, ctx.emit)
        return draw(s, ctx.controller, 1)
      },
    },
  }),
  R('Scrapheap', {
    play: { timing: 'action', effect: (ctx) => draw(ctx.state, ctx.controller, 1) },
  }),

  // ── Vendetta token spawners ──────────────────────────────────────────────
  // "When you play a card on an opponent's turn, play a 1 Might Recruit token."
  R('Viktor, Innovator', {
    triggers: [
      {
        on: 'CARD_PLAYED',
        byController: true,
        condition: (_e, state, src) => !!src && state.activePlayer !== src.owner,
        effect: (ctx) =>
          createToken(ctx.state, ctx.controller, 'Recruit', { kind: 'base' }, {
            might: 1,
            emit: ctx.emit,
          }),
      },
    ],
  }),
  // "Play a 3 Might Mech unit token."
  R('Iterative Design', {
    play: {
      timing: 'sorcery',
      effect: (ctx) =>
        createToken(ctx.state, ctx.controller, 'Mech', { kind: 'base' }, {
          might: 3,
          emit: ctx.emit,
        }),
    },
  }),
  // "[Burn 3]. Play a 0 Might Shadow Clone unit token."
  R('Death Mark', {
    play: {
      timing: 'sorcery',
      effect: (ctx) => {
        const s = burn(ctx.state, ctx.controller, 3)
        return createToken(s, ctx.controller, 'Shadow Clone', { kind: 'base' }, {
          might: 0,
          text: 'When I attack, you may banish a unit from your trash to give me [Assault 4] this turn.',
          emit: ctx.emit,
        })
      },
    },
  }),
  // [Deathknell] — "Play a 1 Might Bird unit token with [Deflect] to your base."
  R('Carrion Dredger', {
    triggers: [
      {
        on: 'UNIT_DIED',
        self: true,
        effect: (ctx) =>
          createToken(ctx.state, ctx.controller, 'Bird', { kind: 'base' }, {
            might: 1,
            keywords: ['Deflect'],
            emit: ctx.emit,
          }),
      },
    ],
  }),
  // "[Predict 5] … Draw 2."
  R('Clairvoyance', {
    play: {
      timing: 'reaction',
      effect: (ctx) =>
        predictChoice(ctx.state, ctx.controller, 5, (s) => draw(s, ctx.controller, 2)),
    },
  }),
  // "Return up to 2 units from trashes to their owners' hands."
  R('Shadows of the Past', {
    play: {
      timing: 'sorcery',
      effect: (ctx) => returnUnitsFromTrash(ctx.state, ctx.controller, 2),
    },
  }),

  // ── Zed – Master of Shadows (banish → Empower → Flow) ──────────────────
  // Legend: "When you banish a card you own, Empower me." The `[Action][>]
  // Disempower me, ↻: Discard 1, then draw 1` ability is compiled from text.
  R('Zed - Master of Shadows', {
    triggers: [
      {
        on: 'CARD_BANISHED',
        byController: true,
        effect: (ctx) => {
          const ps = ctx.controller === 'player' ? ctx.state.player : ctx.state.ai
          if (ps.legendEmpowered) return ctx.state
          return {
            ...appendLog(ctx.state, `Zed – Master of Shadows is Empowered.`),
            [ctx.controller]: { ...ps, legendEmpowered: true },
          } as GameState
        },
      },
    ],
  }),
  // "When I conquer, play a 0 Might Shadow Clone token" (compiled) +
  // "[Action][>] :rb_energy_1::rb_rune_chaos:: swap me and a Shadow Clone".
  R('Zed, Without a Sound', {
    activated: [
      {
        label: 'Swap places with a Shadow Clone',
        cost: { energy: 1, runes: ['chaos'] },
        effect: (ctx) => swapWithShadowClone(ctx),
      },
    ],
  }),
  // "When you play me, [Burn 2]" (compiled) + "When I conquer, give a spell in
  // your trash [Flow] equal to its cost this turn."
  R('Kennen, Storm of Shuriken', {
    triggers: [
      {
        on: 'CONQUERED',
        self: true,
        effect: (ctx) => {
          const ps = ctx.controller === 'player' ? ctx.state.player : ctx.state.ai
          const ids = ps.trash.filter((c) => c.type === 'spell').map((c) => c.id)
          if (ids.length === 0) return ctx.state
          return appendLog(
            { ...ctx.state, flowGranted: [...new Set([...ctx.state.flowGranted, ...ids])] },
            `Kennen grants [Flow] to ${ids.length} spell(s) in the trash this turn.`,
          )
        },
      },
    ],
  }),

  // ── Jayce (gear payoffs) ───────────────────────────────────────────────
  // "When you play me … you may ready something besides me that's exhausted."
  R('Jayce, Brilliant Inventor', {
    triggers: [
      { on: 'UNIT_ENTERED', self: true, effect: (ctx) => readyOneExhausted(ctx) },
      {
        on: 'CARD_PLAYED',
        byController: true,
        condition: (e) => e.type === 'CARD_PLAYED' && e.card.type === 'gear',
        effect: (ctx) => readyOneExhausted(ctx),
      },
    ],
  }),
  // "When I become ready, choose one to give me this turn — [Assault 2] /
  // [Deflect 2] / [Ganking]."
  R('Jayce, Hammer in Hand', {
    triggers: [
      {
        on: 'UNIT_READIED',
        self: true,
        choose: {
          kind: 'keyword',
          min: 1,
          max: 1,
          label: 'choose a keyword to give me this turn',
          legal: () => ['Assault 2', 'Deflect 2', 'Ganking'],
        },
        effect: (ctx) => {
          const pick = ctx.picks?.[0]
          if (!pick || !ctx.source) return ctx.state
          const m = pick.match(/^(\w+)(?:\s+(\d+))?$/)
          if (!m) return ctx.state
          return grantKeywordThisTurn(ctx.state, ctx.source.instanceId, m[1], m[2] ? +m[2] : 1)
        },
      },
    ],
  }),
  // "When you play me, you may kill a friendly gear. …" (partial: the kill only)
  R('Jayce, Man of Progress', {
    triggers: [
      {
        on: 'UNIT_ENTERED',
        self: true,
        effect: (ctx) => {
          const g = (ctx.controller === 'player' ? ctx.state.player : ctx.state.ai).gear[0]
          return g ? killGear(ctx.state, g.instanceId) : ctx.state
        },
      },
    ],
  }),

  // ── Keyword demos (fixture cards — dormant unless the pool has these names) ──
  // [Vision] — when played, predict 2 (interactive).
  R('Farsight Scout', {
    triggers: [
      {
        on: 'UNIT_ENTERED',
        self: true,
        effect: (ctx) => predictChoice(ctx.state, ctx.controller, 2),
      },
    ],
  }),
  // [Legion] — if you played another card this turn, buff me.
  R('Legion Brute', {
    triggers: [
      {
        on: 'UNIT_ENTERED',
        self: true,
        when: (state, _src, controller) => legionActive(state, controller),
        effect: (ctx) => (ctx.source ? buff(ctx.state, ctx.source.instanceId) : ctx.state),
      },
    ],
  }),
  // [Level 3] — while you have 3+ XP, this scores an extra point on conquer.
  R('Veteran Ascended', {
    triggers: [
      {
        on: 'CONQUERED',
        self: true,
        when: (state, _src, controller) => levelActive(state, controller, 3),
        effect: (ctx) => scorePoints(ctx.state, ctx.controller, 1),
      },
    ],
  }),
  // [Empower] / [Empowered] — pay to gain the status, then the dependent ability.
  R('Empowered Sentinel', {
    activated: [
      {
        label: 'Empower (exhaust): gain Empowered',
        cost: { exhaustSelf: true },
        effect: (ctx) =>
          ctx.source ? setEmpowered(ctx.state, ctx.source.instanceId) : ctx.state,
      },
    ],
    triggers: [
      {
        on: 'CONQUERED',
        self: true,
        when: (_state, src) => isEmpowered(src),
        effect: (ctx) => gainXP(ctx.state, ctx.controller, 1),
      },
    ],
  }),
  // Debuff demo — stuns and permanently weakens the target.
  R('Crippling Hex', {
    play: {
      timing: 'action',
      targets: [{ kind: 'unit' }],
      effect: (ctx) => {
        const u = targetUnit(ctx)
        if (!u) return ctx.state
        return stun(giveMightPermanent(ctx.state, u.instanceId, -1), u.instanceId)
      },
    },
  }),
])

/** Zed, Without a Sound — swap Zed and a friendly Shadow Clone's locations. */
function swapWithShadowClone(ctx: EffectCtx): GameState {
  const s = ctx.state
  const all = [...s.player.base, ...s.ai.base, ...s.battlefields.flatMap((b) => b.units)]
  const zed = all.find((u) => u.instanceId === ctx.source?.instanceId)
  const clone = all.find(
    (u) => u.owner === ctx.controller && /shadow clone/i.test(u.card.name),
  )
  if (!zed || !clone) return appendLog(s, `No Shadow Clone to swap with.`)

  const swapped = all.map((u) =>
    u.instanceId === zed.instanceId
      ? { ...u, location: clone.location }
      : u.instanceId === clone.instanceId
        ? { ...u, location: zed.location }
        : u,
  )
  const baseOf = (side: 'player' | 'ai') =>
    swapped.filter((u) => u.owner === side && u.location.kind === 'base')
  return appendLog(
    {
      ...s,
      player: { ...s.player, base: baseOf('player') },
      ai: { ...s.ai, base: baseOf('ai') },
      battlefields: s.battlefields.map((b) => ({
        ...b,
        units: swapped.filter(
          (u) => u.location.kind === 'battlefield' && u.location.index === b.index,
        ),
      })),
    },
    `${zed.card.name} swaps places with ${clone.card.name}.`,
  )
}

/** Ready the first exhausted friendly unit or gear that isn't the source. */
function readyOneExhausted(ctx: EffectCtx): GameState {
  const s = ctx.state
  const me = ctx.source?.instanceId
  const side = ctx.controller
  const ps = side === 'player' ? s.player : s.ai
  const unit = [...ps.base, ...s.battlefields.flatMap((b) => b.units)].find(
    (u) => u.owner === side && u.exhausted && u.instanceId !== me,
  )
  if (unit) {
    return {
      ...s,
      player: { ...s.player, base: s.player.base.map(readyIf(unit.instanceId)) },
      ai: { ...s.ai, base: s.ai.base.map(readyIf(unit.instanceId)) },
      battlefields: s.battlefields.map((b) => ({ ...b, units: b.units.map(readyIf(unit.instanceId)) })),
    }
  }
  const g = ps.gear.find((x) => x.exhausted && x.instanceId !== me)
  if (g) {
    return {
      ...s,
      [side]: { ...ps, gear: ps.gear.map((x) => (x.instanceId === g.instanceId ? { ...x, exhausted: false } : x)) },
    } as GameState
  }
  return s
}
const readyIf =
  (id: string) =>
  <T extends { instanceId: string; exhausted: boolean }>(x: T): T =>
    x.instanceId === id ? { ...x, exhausted: false } : x

function grantShield(state: GameState, instanceId: string): GameState {
  return {
    ...state,
    player: {
      ...state.player,
      base: state.player.base.map(bump(instanceId)),
    },
    ai: { ...state.ai, base: state.ai.base.map(bump(instanceId)) },
    battlefields: state.battlefields.map((bf) => ({
      ...bf,
      units: bf.units.map(bump(instanceId)),
    })),
  }
}
const bump =
  (instanceId: string) =>
  <T extends { instanceId: string; counters: Record<string, number> }>(u: T): T =>
    u.instanceId === instanceId
      ? { ...u, counters: { ...u.counters, shield: (u.counters.shield ?? 0) + 1 } }
      : u

// ── Lookup ───────────────────────────────────────────────────────────────

function explicitScript(card: Card): CardScript | undefined {
  return (
    CARD_SCRIPTS[normKey(card.name)] ??
    CARD_SCRIPTS[normKey(card.cleanName)] ??
    CARD_SCRIPTS[normKey(card.name.replace(/,/g, ' -'))]
  )
}

/**
 * The hand-written script when there is one, otherwise a script compiled from
 * the card's printed text. A hand-written script that omits a section still
 * picks up that section (triggers/activated/Empowered bonus) from the compiled one.
 */
/** Activated abilities available on a legend — explicit script + text-compiled. */
export function legendAbilities(card: Card): ActivatedAbility[] {
  return [...(explicitScript(card)?.activated ?? []), ...autoAbilities(card).activated].filter(
    (ab, i, arr) => arr.findIndex((x) => x.label === ab.label) === i,
  )
}

export function scriptFor(card: Card): CardScript | undefined {
  const explicit = explicitScript(card)
  const compiled = compileScript(card)
  if (!explicit) return compiled

  // A hand-written script is the source of truth for the sections it defines —
  // only borrow a whole section it leaves out (so bespoke cards still get auto
  // Empower / Empowered-Might without double-firing their own triggers).
  return {
    keywords: explicit.keywords ?? compiled.keywords,
    play: explicit.play ?? compiled.play,
    triggers: explicit.triggers ?? compiled.triggers,
    activated: explicit.activated ?? compiled.activated,
    empoweredMight: explicit.empoweredMight ?? compiled.empoweredMight,
    empoweredAssault: explicit.empoweredAssault ?? compiled.empoweredAssault,
  }
}
