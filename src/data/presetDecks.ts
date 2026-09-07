import { Card, Deck, DeckEntry, Domain } from '../types/card'
import { resolveByName } from './cardStore'
import { isBanned } from './bannedCards'

// Two recognisable meta decks, transcribed (names + quantities) from public
// decklists on rift-atlas.com. Card names are resolved against the live card
// pool at load time; anything that fails to resolve is backfilled with a
// domain-legal card so the deck is always 40 main + 12 runes and playable.

export interface PresetSpec {
  id: string
  name: string
  legend: string
  chosenChampion: string
  battlefields: [string, string, string]
  /** Rune counts by domain; must sum to 12. */
  runes: Partial<Record<Domain, number>>
  /** Main deck (includes the chosen champion); quantities should sum to 40. */
  main: { name: string; qty: number }[]
}

export const PRESET_SPECS: PresetSpec[] = [
  {
    id: 'preset-irelia-blade-dancer',
    name: 'Irelia, Blade Dancer',
    legend: 'Irelia - Blade Dancer',
    chosenChampion: 'Irelia - Fervent',
    battlefields: [
      'Windswept Hillock',
      'Ravenbloom Conservatory',
      'The Candlelit Sanctum',
    ],
    runes: { calm: 6, chaos: 6 },
    main: [
      { name: 'Irelia - Fervent', qty: 3 },
      { name: 'Draven - Audacious', qty: 3 },
      { name: 'Stellacorn Herder', qty: 3 },
      { name: 'Defy', qty: 2 },
      { name: 'Discipline', qty: 2 },
      { name: 'En Garde', qty: 2 },
      { name: 'Gust', qty: 2 },
      { name: 'Ride the Wind', qty: 2 },
      { name: 'Stacked Deck', qty: 2 },
      { name: 'Defiant Dance', qty: 1 },
      { name: 'Guardian Angel', qty: 2 },
      { name: 'Heart of Dark Ice', qty: 2 },
      { name: "Zhonya's Hourglass", qty: 2 },
    ],
  },
  {
    id: 'preset-annie-dark-child',
    name: 'Annie, Dark Child',
    legend: 'Annie - Dark Child',
    chosenChampion: 'Annie - Stubborn',
    battlefields: ['Trifarian War Camp', 'Zaun Warrens', 'Navori Fighting Pit'],
    runes: { fury: 6, chaos: 6 },
    main: [
      { name: 'Annie - Stubborn', qty: 3 },
      { name: 'Darius - Trifarian', qty: 3 },
      { name: "Kai'Sa - Survivor", qty: 3 },
      { name: 'Vi - Destructive', qty: 1 },
      { name: 'Pouty Poro', qty: 3 },
      { name: 'Sneaky Deckhand', qty: 3 },
      { name: 'Traveling Merchant', qty: 3 },
      { name: 'Cleave', qty: 3 },
      { name: 'Flash', qty: 2 },
      { name: 'Gust', qty: 2 },
      { name: 'Rebuke', qty: 2 },
      { name: 'Ride the Wind', qty: 2 },
      { name: 'Stacked Deck', qty: 3 },
    ],
  },
  {
    // Vendetta (VEN) — Zed shadow aggro, Fury/Chaos. Names transcribed from
    // public Vendetta Zed lists (riftbound.gg / Star City Games).
    id: 'preset-zed-master-of-shadows',
    name: 'Zed, Master of Shadows',
    legend: 'Zed - Master of Shadows',
    chosenChampion: 'Zed, From the Shadows',
    battlefields: ['Shadow Temple', 'Threshold of the Gray', 'Kinkou Temple'],
    runes: { fury: 6, chaos: 6 },
    main: [
      { name: 'Zed, From the Shadows', qty: 3 },
      { name: 'Zed, Without a Sound', qty: 2 },
      { name: 'Shadow Order Disciple', qty: 3 },
      { name: 'Gust Monk', qty: 3 },
      { name: 'Kinkou Lifeblade', qty: 3 },
      { name: 'Blade Twirler', qty: 3 },
      { name: 'Punching Poro', qty: 2 },
      { name: 'Shadow Fiend', qty: 2 },
      { name: 'Akali, Deadly Weapon', qty: 2 },
      { name: 'Kennen, Storm of Shuriken', qty: 2 },
      { name: 'Shadow Assassin', qty: 2 },
      { name: 'Twilight Step', qty: 2 },
      { name: 'Ruthless Strike', qty: 3 },
      { name: 'Perfect Execution', qty: 2 },
      { name: 'Death Mark', qty: 2 },
      { name: 'Shadows of the Past', qty: 2 },
    ],
  },
  {
    // Vendetta (VEN) — Jayce gear / Empower midrange, Mind/Body.
    id: 'preset-jayce-defender-of-tomorrow',
    name: 'Jayce, Defender of Tomorrow (Gear)',
    legend: 'Jayce - Defender of Tomorrow',
    chosenChampion: 'Jayce, Hammer in Hand',
    battlefields: ['Piltovan Forge', 'Risen Altar', 'Mystic Vortex'],
    runes: { mind: 6, body: 6 },
    main: [
      { name: 'Jayce, Hammer in Hand', qty: 3 },
      { name: 'Jayce, Man of Progress', qty: 2 },
      { name: 'Jayce, Brilliant Inventor', qty: 1 },
      { name: 'Hextech Formula', qty: 3 },
      { name: 'Hextech Disc', qty: 3 },
      { name: 'Questionable Tome', qty: 3 },
      { name: 'Tools of Empire', qty: 2 },
      { name: 'Jagged Cutlass', qty: 2 },
      { name: 'Platewyrm Egg', qty: 2 },
      { name: 'Repair Specialist', qty: 3 },
      { name: 'Patched Porobot', qty: 3 },
      { name: 'Otterpus', qty: 2 },
      { name: 'Viktor, Innovator', qty: 2 },
      { name: 'Applied Researchers', qty: 2 },
      { name: 'Sky Cruiser', qty: 2 },
      { name: 'Acceleration Gate', qty: 2 },
      { name: 'Shock Blast', qty: 2 },
      { name: 'Iterative Design', qty: 1 },
    ],
  },
]

const RUNE_NAME: Record<Domain, string> = {
  fury: 'Fury Rune',
  calm: 'Calm Rune',
  mind: 'Mind Rune',
  body: 'Body Rune',
  order: 'Order Rune',
  chaos: 'Chaos Rune',
  colorless: 'Rune',
}

const MAIN_SIZE = 40
const RUNE_SIZE = 12

function addEntry(entries: DeckEntry[], cardId: string, qty: number): void {
  const existing = entries.find((e) => e.cardId === cardId)
  if (existing) existing.quantity += qty
  else entries.push({ cardId, quantity: qty })
}

function total(entries: DeckEntry[]): number {
  return entries.reduce((s, e) => s + e.quantity, 0)
}

function identityFromLegend(legend: Card | undefined): Domain[] {
  const ids = (legend?.domains ?? []).filter((d) => d !== 'colorless')
  return ids.length > 0 ? ids : ['fury', 'calm', 'mind', 'body', 'order', 'chaos']
}

function withinIdentity(card: Card, identity: Domain[]): boolean {
  return card.domains.every((d) => d === 'colorless' || identity.includes(d))
}

function buildOne(spec: PresetSpec, pool: Card[]): Deck {
  const now = Date.now()
  const missing: string[] = []
  const resolve = (name: string): Card | undefined => {
    const c = resolveByName(name)
    if (!c) missing.push(name)
    return c
  }

  const legend = resolve(spec.legend)
  const champion = resolve(spec.chosenChampion)
  const identity = identityFromLegend(legend)

  // Battlefields — 3 in the deck, all must be legal.
  const battlefieldIds: string[] = []
  for (const bfName of spec.battlefields) {
    const bf = resolve(bfName)
    if (bf && !isBanned(bf)) battlefieldIds.push(bf.id)
  }
  while (battlefieldIds.length < 3) {
    const filler = pool.find(
      (c) => c.type === 'battlefield' && !isBanned(c) && !battlefieldIds.includes(c.id),
    )
    if (!filler) break
    battlefieldIds.push(filler.id)
  }

  // Runes
  const runes: DeckEntry[] = []
  for (const [domain, count] of Object.entries(spec.runes) as [Domain, number][]) {
    const rune = resolveByName(RUNE_NAME[domain]) ?? pool.find((c) => c.type === 'rune')
    if (rune) addEntry(runes, rune.id, count)
  }
  fill(runes, RUNE_SIZE, pool.filter((c) => c.type === 'rune'))

  // Main deck
  const cards: DeckEntry[] = []
  for (const { name, qty } of spec.main) {
    const card = resolve(name)
    if (card && !isBanned(card)) addEntry(cards, card.id, qty)
  }
  // Guarantee the chosen champion is present.
  if (champion && !cards.some((e) => e.cardId === champion.id)) {
    addEntry(cards, champion.id, 3)
  }
  // Backfill with in-identity non-champion units so the deck has enough bodies
  // to actually contest battlefields (the specs above run light on units).
  const fillers = pool
    .filter(
      (c) =>
        c.type === 'unit' &&
        c.supertype !== 'champion' &&
        c.supertype !== 'token' &&
        !isBanned(c) &&
        withinIdentity(c, identity),
    )
    .sort((a, b) => a.energy - b.energy)
  fill(cards, MAIN_SIZE, fillers)
  trim(cards, MAIN_SIZE)

  if (missing.length > 0) {
    console.warn(
      `[presetDecks] "${spec.name}": ${missing.length} card(s) not found in pool, backfilled — ${missing.join(', ')}`,
    )
  }

  return {
    id: spec.id,
    name: spec.name,
    legendId: legend?.id ?? null,
    chosenChampionId: champion?.id ?? null,
    battlefieldIds,
    runes,
    cards,
    preset: true,
    createdAt: now,
    updatedAt: now,
  }
}

/** Top up `entries` toward `target` using `source` cards (max 3 copies each). */
function fill(entries: DeckEntry[], target: number, source: Card[]): void {
  let i = 0
  while (total(entries) < target && source.length > 0) {
    const card = source[i % source.length]
    const existing = entries.find((e) => e.cardId === card.id)
    if (!existing || existing.quantity < 3) {
      addEntry(entries, card.id, 1)
    }
    i++
    if (i > target * 4) break // safety
  }
}

function trim(entries: DeckEntry[], target: number): void {
  while (total(entries) > target && entries.length > 0) {
    const last = entries[entries.length - 1]
    last.quantity -= 1
    if (last.quantity <= 0) entries.pop()
  }
}

export function buildPresetDecks(pool: Card[]): Deck[] {
  return PRESET_SPECS.map((spec) => buildOne(spec, pool))
}
