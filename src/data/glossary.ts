// Riftbound keywords & game actions, transcribed from the official glossary
// (riftbound.gg/rules/glossary/, Core Rules revision 2026-07-16).

export interface GlossaryEntry {
  term: string
  /** True for keywords printed as "Keyword — takes a cost". */
  cost?: boolean
  kind: 'keyword' | 'action' | 'rule'
  text: string
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  accelerate: {
    term: 'Accelerate',
    kind: 'keyword',
    text: "Optional additional cost as you play this unit: pay 1 energy and 1 Power to have it enter ready instead of exhausted. The Power must match one of the unit's domains (any domain if it has none).",
  },
  action: {
    term: 'Action',
    kind: 'keyword',
    text: 'Permission only, with no effect of its own: this may be played or activated during Showdowns, on any player’s turn.',
  },
  ambush: {
    term: 'Ambush',
    kind: 'keyword',
    text: 'This may be played to a battlefield where you control units, and has Reaction while being played there.',
  },
  assault: {
    term: 'Assault X',
    kind: 'keyword',
    text: 'While I am an attacker, I have +X Might. Multiple instances add together.',
  },
  backline: {
    term: 'Backline',
    kind: 'keyword',
    text: 'I must be assigned lethal damage after all other units I share a controller with that lack Backline.',
  },
  deathknell: {
    term: 'Deathknell',
    kind: 'keyword',
    text: 'Triggers when this permanent is killed and sent to the trash. If the death is replaced — recalled, for example — the trigger is removed instead of resolving.',
  },
  deflect: {
    term: 'Deflect X',
    kind: 'keyword',
    text: 'Opponents must pay X more Power, of any domain, each time they choose me with a spell or ability. Multiple instances add together.',
  },
  empower: {
    term: 'Empower',
    cost: true,
    kind: 'keyword',
    text: 'Activated ability: pay its cost to give this permanent or legend the Empowered status. Can only be played if it is not already Empowered.',
  },
  empowered: {
    term: 'Empowered',
    kind: 'keyword',
    text: 'While I have the Empowered status, I gain the ability that follows.',
  },
  equip: {
    term: 'Equip',
    cost: true,
    kind: 'keyword',
    text: 'Activated ability on Equipment gear: pay its cost to attach it to a unit you control. The chosen unit is a target and becomes Equipped.',
  },
  flow: {
    term: 'Flow',
    cost: true,
    kind: 'keyword',
    text: 'You may play this spell from your trash for its Flow cost, then banish it. This replaces the base cost but does not change when you may play it.',
  },
  ganking: {
    term: 'Ganking',
    kind: 'keyword',
    text: 'I may move from one battlefield to another with a standard move. This adds permission only — no extra moves and no added cost.',
  },
  hidden: {
    term: 'Hidden',
    kind: 'keyword',
    text: 'On your turn in an Open State you may pay 1 energy to hide this facedown at a battlefield you control, one per battlefield. From the next turn it gains Reaction and may be played ignoring its base cost, but its targets and placement are restricted to that battlefield.',
  },
  hunt: {
    term: 'Hunt X',
    kind: 'keyword',
    text: 'When I conquer or hold, my controller gains X XP. Multiple instances add together.',
  },
  legion: {
    term: 'Legion',
    kind: 'keyword',
    text: 'If you have played another Main Deck card this turn, this card gains the ability that follows. A single card played satisfies every one of your Legion instances.',
  },
  level: {
    term: 'Level N',
    kind: 'keyword',
    text: 'While you have N or more XP, this card gains the ability that follows. This is re-checked continuously — it switches off the moment your XP drops below N, and re-checks against the new controller’s XP if control changes.',
  },
  'quick-draw': {
    term: 'Quick-Draw',
    kind: 'keyword',
    text: 'This gear has Reaction, and when you play it, attach it to a unit you control.',
  },
  reaction: {
    term: 'Reaction',
    kind: 'keyword',
    text: 'Permission only: everything Action grants, plus this may be played or activated during Closed States, on any player’s turn.',
  },
  repeat: {
    term: 'Repeat',
    cost: true,
    kind: 'keyword',
    text: 'Optional additional cost as you play this spell or ability: pay it to carry out the instructions one additional time on resolution. Choices may differ between executions, and the card still counts as played only once.',
  },
  shield: {
    term: 'Shield X',
    kind: 'keyword',
    text: 'While I am a defender, I have +X Might. Multiple instances add together.',
  },
  tank: {
    term: 'Tank',
    kind: 'keyword',
    text: 'I must be assigned lethal damage before any other unit I share a controller with that lacks Tank.',
  },
  temporary: {
    term: 'Temporary',
    kind: 'keyword',
    text: "Kill this at the start of its controller's Beginning Phase, before scoring.",
  },
  unique: {
    term: 'Unique',
    kind: 'keyword',
    text: 'A deck constraint with no gameplay effect: your deck may contain only one card with this name.',
  },
  vision: {
    term: 'Vision',
    kind: 'keyword',
    text: 'When this is played, predict. Multiple instances trigger separately.',
  },
  weaponmaster: {
    term: 'Weaponmaster',
    kind: 'keyword',
    text: 'When you play me, you may choose an Equipment you control and pay its Equip cost reduced by 1 energy to attach it to me, ignoring the Equip ability’s usual timing.',
  },

  // ── Game actions (not highlighted on cards) ────────────────────────────
  add: {
    term: 'Add',
    cost: true,
    kind: 'action',
    text: 'Put the listed resources into your Rune Pool. Add abilities resolve immediately on finalization without passing priority, and a Reaction Add ability can be activated while paying a cost.',
  },
  buff: {
    term: 'Buff',
    kind: 'action',
    text: 'Place a buff counter on a unit. A unit that already has one does not receive a second, and effects conditional on it being buffed this way will not fire.',
  },
  burn: {
    term: 'Burn X',
    kind: 'action',
    text: "Put the top X cards of the named Main Deck into its owner's trash. You must burn as many as possible.",
  },
  mighty: {
    term: 'Mighty',
    kind: 'action',
    text: 'A unit is Mighty while its Might is 5 or greater, including temporarily. A unit in the trash counts as Mighty if its printed Might is 5 or greater.',
  },
  predict: {
    term: 'Predict X',
    kind: 'action',
    text: 'Look at the top card of your Main Deck and choose whether to recycle it. Predict X looks at X cards, recycles any number of them, and returns the rest to the top in any order.',
  },
  stun: {
    term: 'Stun',
    kind: 'action',
    text: 'A stunned unit contributes no Might during the combat damage step, but still must be dealt damage equal to its full Might to be killed. It wears off during end-of-turn cleanup. An already-stunned unit cannot be stunned again.',
  },

  // ── Plain rules terms (highlighted in card text even without brackets) ──
  token: {
    term: 'Token',
    kind: 'rule',
    text: 'A game object an effect creates on the board. Never part of a deck and never drawn. If a token would move to any zone other than the board or the chain — killed, bounced, discarded, recycled — it ceases to exist instead.',
  },
  showdown: {
    term: 'Showdown',
    kind: 'rule',
    text: 'Combat at a contested battlefield: both sides total their Might, deal that much damage to the other side’s units, and units dealt lethal damage are killed. Tank units must be dealt lethal first, Backline last.',
  },
  conquer: {
    term: 'Conquer',
    kind: 'rule',
    text: 'Take control of a battlefield you did not already control — by winning its showdown or moving in unopposed. You score 1 point (once per battlefield per turn) and, if it does not win the game, draw a card.',
  },
  hold: {
    term: 'Hold',
    kind: 'rule',
    text: 'Control a battlefield at the start of your turn: score 1 point for each such battlefield (once per battlefield per turn) during your Awaken.',
  },
  recall: {
    term: 'Recall',
    kind: 'rule',
    text: 'Return a unit to its owner’s base, removing all damage and counters. A recalled token ceases to exist. Recall replaces a would-be death, so Deathknell does not trigger.',
  },
  banish: {
    term: 'Banish',
    kind: 'rule',
    text: 'Remove a card from the game entirely (not to the trash). Flow-cast spells banish themselves after resolving.',
  },
  'excess damage': {
    term: 'Excess damage',
    kind: 'rule',
    text: 'Showdown damage beyond what was needed to kill the assigned units. Whoever conquers "assigns" that excess — some effects care how much.',
  },
}

// ── :rb_*: symbol tokens ──────────────────────────────────────────────────

export interface SymbolInfo {
  /** Short glyph shown inline in place of the raw token. */
  glyph: string
  /** Hover text. */
  text: string
}

const DOMAIN_LABEL: Record<string, string> = {
  fury: 'Fury',
  calm: 'Calm',
  mind: 'Mind',
  body: 'Body',
  order: 'Order',
  chaos: 'Chaos',
}

export function lookupSymbol(token: string): SymbolInfo | undefined {
  const m = token.match(/^:rb_([a-z0-9_]+):$/)
  if (!m) return undefined
  const key = m[1]

  const energy = key.match(/^energy_(\d+)$/)
  if (energy) return { glyph: `⟨${energy[1]}⚡⟩`, text: `${energy[1]} energy` }

  const rune = key.match(/^rune_([a-z]+)$/)
  if (rune) {
    if (rune[1] === 'rainbow') return { glyph: '⟨✦⟩', text: '1 Power of any domain' }
    const label = DOMAIN_LABEL[rune[1]] ?? rune[1]
    return { glyph: `⟨${label[0]}✦⟩`, text: `1 ${label} Power` }
  }

  switch (key) {
    case 'exhaust':
      return { glyph: '↻', text: 'Exhaust this (turn it sideways) as a cost.' }
    case 'might':
      return { glyph: 'Might', text: 'Might — a unit’s combat strength and health.' }
    default:
      return { glyph: `⟨${key}⟩`, text: key.replace(/_/g, ' ') }
  }
}

// ── Keyword lookup from a card-text token like "[Assault 3]" ──────────────

export function lookupKeyword(token: string): GlossaryEntry | undefined {
  const inner = token.replace(/^\[|\]$/g, '').trim().toLowerCase()
  // Strip a trailing number / X: "assault 3" -> "assault"
  const base = inner.replace(/\s+(\d+|x)$/i, '').trim()
  return GLOSSARY[base] ?? GLOSSARY[inner]
}

/** Plain game-terms highlighted in card text (no brackets): "token", "conquer", … */
export const PLAIN_TERMS = [
  'excess damage',
  'showdown',
  'conquer',
  'token',
  'hold',
  'recall',
  'banish',
] as const

export function lookupPlain(word: string): GlossaryEntry | undefined {
  const entry = GLOSSARY[word.trim().toLowerCase()]
  return entry?.kind === 'rule' ? entry : undefined
}

export const ALL_GLOSSARY: GlossaryEntry[] = Object.values(GLOSSARY)
