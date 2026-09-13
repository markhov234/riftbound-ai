# Battlefield abilities — what works, and what doesn't

Last verified 2026-09-13, mechanically, against the shipped fixture.
**64 distinct battlefields have rules text: 5 are banned** (so they can never
legally appear in a deck), leaving 59 playable — **39 work, 20 do nothing**.

Two tests cover this, and they do different jobs:

```
npx vitest run src/engine/__tests__/battlefields-audit.test.ts    # behaviour, per card
npx vitest run src/engine/__tests__/battlefields-census.test.ts   # this list, as a whole
```

The census exists because **this page drifted**. It listed Piltovan Forge and
Risen Altar as unimplemented for days after `effectiveAbilityCost` was written
for exactly those two, and nothing failed. The census now asserts that every
battlefield is either implemented or named as a gap, and that every name in the
gap list is still a real, unbanned card — so implementing one breaks the build
until it is struck from both the test and this page.

## How a battlefield ability gets executed

Three separate mechanisms, and which one a card needs decides how hard it is:

| Mechanism | Where | Examples |
|---|---|---|
| **Trigger** on a game event | `BESPOKE` in `abilities/battlefields.ts`, or compiled from `"When you conquer/hold/defend here, …"` | Minefield, The Papertree, Fortified Position |
| **Static aura** read at combat/move time | `battlefieldAura` | Trifarian War Camp, Forbidding Waste, Black Flame Altar |
| **Rule change** checked at the point of the rule | `canPlaceUnitAt`, `canMove`, `effectiveCost` | Rockfall Path, Vilemaw's Lair, Mystic Vortex |

Events a battlefield trigger can listen for: `CONQUERED`, `HELD`, `DEFENDED`,
`CARD_PLAYED`, `TURN_BEGAN`.

## Still not implemented (20 legal cards)

Grouped by **what the engine is missing**, because that's what decides the fix.

### Needs a cost hook in `effectiveCost` (4)
Ornn's Forge · Marai Spire · Sandswept Tomb · Vaults of Helia

All are "this class of thing costs N less/more". `effectiveCost` already does
this for Mystic Vortex and for Empowered-unit auras, so these are mostly a
matter of adding patterns — the awkward part is the ones that count *"the first
X each turn"*, which needs per-turn state like `freeGearThisTurn`.

**Piltovan Forge and Risen Altar are done** — `effectiveAbilityCost` in
costs.ts, which discounts *ability* costs rather than play costs.

### Needs an event the engine doesn't raise (6)
Star Spring · Valley of Idols · Back-Alley Bar · Ripper's Bay ·
Forgotten Library · Dragon Roost

Missing events: a unit *entering a specific battlefield*, a unit *moving from*
one, a card *returning to hand*, and *"the first time each turn"* bookkeeping.

**Threshold of the Gray is done.** It needed `COMBAT_STARTED`, now raised at
both points combat can open: `declareShowdown` (the turn player initiates it)
and `forceContestedShowdowns` (the end-of-turn net — moving in commits you to
the fight, so an undeclared contested battlefield still resolves as a combat).

**The timing is load-bearing and the rules are explicit.** Core Rules 459 makes
Step 1 the Combat Showdown Step: 459.2.b establishes attacker and defender,
459.2.d puts the resulting triggered abilities on the Combat Chain, and only
then does 459.2.e–f open the reaction window. Damage is Step 2 (460). So "when
combat starts here" fires *before* players may react, and the Energy that
Threshold of the Gray hands out is spendable in the very showdown it opened —
which is the whole point of the card. Paying it out after the fight resolved
would have made it nearly useless.

### Needs a replacement effect or rules-level hook (6)
Altar of Blood (replace a combat death) · Void Gate (bonus damage on every
instance) · Heisho, Shell of the World (ignore Deflect while paying) ·
Gardens of Becoming (grant an activated ability to units) ·
Forge of the Fluft (grant an activated ability to legends) ·
Forgotten Monument (scoring lockout by turn number)

### Needs machinery that doesn't exist yet (4)
The Academy (grant `[Repeat]` equal to base cost) ·
Reckoner's Arena (re-fire other cards' conquer effects) ·
Bandle Tree (raise a Facedown Zone's capacity above 1) ·
Treasure Hoard (create a **gear** token — `createToken` only makes units)

## Banned, so deliberately skipped (5)

Aspirant's Climb · Obelisk of Power · The Arena's Greatest · The Dreaming Tree ·
Reaver's Row are on the ban list (`src/data/bannedCards.ts`) and cannot be in a
constructed deck, so their abilities are not worth writing. (This list said four
until the census counted them; Reaver's Row was missing.)

## Partial implementations, called out

- **Veiled Temple** readies a gear but never offers the "if it's an Equipment,
  you may detach it" half.
- **Fortified Position** grants `[Shield 2]` *for the turn* rather than "this
  combat" — the engine has no combat-scoped duration, and a showdown never
  spans a turn boundary, so the two only differ if you defend twice in a turn.
- **Dusk Rose Lab** and **Abandoned Hall** pick the affected unit for you rather
  than prompting, because battlefield-trigger targets are auto-selected
  (`autoTargetsForTrigger`).
