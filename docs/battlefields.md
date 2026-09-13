# Battlefield abilities — what works, and what doesn't

Audited against the full 1451-card pool on 2026-09-10.
**64 distinct battlefields have rules text. 37 work; 23 do nothing; 4 more are
banned** (so they can never legally appear in a deck).

Run the census yourself against the shipped fixture with
`npx vitest run src/engine/__tests__/battlefields-audit.test.ts`.

## How a battlefield ability gets executed

Three separate mechanisms, and which one a card needs decides how hard it is:

| Mechanism | Where | Examples |
|---|---|---|
| **Trigger** on a game event | `BESPOKE` in `abilities/battlefields.ts`, or compiled from `"When you conquer/hold/defend here, …"` | Minefield, The Papertree, Fortified Position |
| **Static aura** read at combat/move time | `battlefieldAura` | Trifarian War Camp, Forbidding Waste, Black Flame Altar |
| **Rule change** checked at the point of the rule | `canPlaceUnitAt`, `canMove`, `effectiveCost` | Rockfall Path, Vilemaw's Lair, Mystic Vortex |

Events a battlefield trigger can listen for: `CONQUERED`, `HELD`, `DEFENDED`,
`CARD_PLAYED`, `TURN_BEGAN`.

## Still not implemented (23 legal cards)

Grouped by **what the engine is missing**, because that's what decides the fix.

### Needs a cost hook in `effectiveCost` (6)
Piltovan Forge · Ornn's Forge · Risen Altar · Marai Spire · Sandswept Tomb ·
Vaults of Helia

All are "this class of thing costs N less/more". `effectiveCost` already does
this for Mystic Vortex and for Empowered-unit auras, so these are mostly a
matter of adding patterns — the awkward part is the ones that count *"the first
X each turn"*, which needs per-turn state like `freeGearThisTurn`.

### Needs an event the engine doesn't raise (8)
Star Spring · Valley of Idols · Back-Alley Bar · Ripper's Bay ·
Threshold of the Gray · Forgotten Library · The Dreaming Tree · Dragon Roost

Missing events: a unit *entering a specific battlefield*, a unit *moving from*
one, a card *returning to hand*, **combat starting**, and *"the first time each
turn"* bookkeeping.

### Needs a replacement effect or rules-level hook (5)
Altar of Blood (replace a combat death) · Void Gate (bonus damage on every
instance) · Heisho, Shell of the World (ignore Deflect while paying) ·
Gardens of Becoming (grant an activated ability to units) ·
Forgotten Monument (scoring lockout by turn number)

### Needs machinery that doesn't exist yet (4)
The Academy (grant `[Repeat]` equal to base cost) ·
Reckoner's Arena (re-fire other cards' conquer effects) ·
Bandle Tree (raise a Facedown Zone's capacity above 1) ·
Treasure Hoard (create a **gear** token — `createToken` only makes units)

## Banned, so deliberately skipped (4)

Aspirant's Climb · Obelisk of Power · The Arena's Greatest · The Dreaming Tree
are on the ban list (`src/data/bannedCards.ts`) and cannot be in a constructed
deck, so their abilities are not worth writing.

## Partial implementations, called out

- **Veiled Temple** readies a gear but never offers the "if it's an Equipment,
  you may detach it" half.
- **Fortified Position** grants `[Shield 2]` *for the turn* rather than "this
  combat" — the engine has no combat-scoped duration, and a showdown never
  spans a turn boundary, so the two only differ if you defend twice in a turn.
- **Dusk Rose Lab** and **Abandoned Hall** pick the affected unit for you rather
  than prompting, because battlefield-trigger targets are auto-selected
  (`autoTargetsForTrigger`).
