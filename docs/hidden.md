# The Hidden keyword (rule 811)

Implemented in `src/engine/hidden.ts`, with state on each battlefield
(`Battlefield.facedown` — the Facedown Zone of rule 107.3).

## What works

- **Hide** (`HIDE_CARD`) — pay 1 Power, on your turn during an Open State, at a
  battlefield you control whose Facedown Zone is empty. Hiding is **not**
  playing: no chain, no `CARD_PLAYED` event, nothing trashed (811.1.c.1–2).
- **One card per battlefield** (107.3.b), **controller only** (107.3.c).
- **Play from facedown** — free ("ignoring its base cost") and Reaction-timed
  (811.6), but only from a **later turn** than the one it was hidden on. That is
  what `FacedownCard.turnHidden` is for.
- **Permanents enter at that battlefield** (811.1.d.1). Gear included, which is
  the one case gear does not go to base (151.2).
- **Losing the battlefield** reveals and trashes the card at the next cleanup
  (107.3.d / 461.5.c) — hooked into both the end-of-turn cleanup and the
  post-showdown control step.
- **Privacy** — the hide log never names the card (128.4), and the opponent's
  facedown slot shows no name and no hover preview. A zone change does reveal
  it (421.4), so *that* log line names it.
- **The `[A]` cost is a rune pip**, not the separate `runes.power` pool — `HIDE_COST` goes
  through the same `canAfford`/`payCost` path as every printed `:rb_rune_*:` symbol, spending one
  free channelled rune and no Energy. It was charged against `runes.power` at first, which made
  Hidden the only cost in the game you could not pay with a rune: you had to click Recycle first.
  (Recycling a rune for Power is still a real thing — 163.2.b — it is just not how you pay here.)
- **Being attacked does not reveal a hidden card.** It survives a contested battlefield, a won
  defence and an inconclusive fight. It is revealed and trashed only when you actually *lose*
  control (107.3.d) — including a mutual wipe, which leaves the battlefield Uncontrolled (461.5.b).
- **Provenance** — `playedFaceDown` is stamped on a unit so a "when you play me
  from face down" trigger can tell (Tornado Warrior, Evelynn - Entrancing).
  Spells carry the same fact as `StackItem.fromFacedown`. The `CARD_PLAYED` event also carries
  `fromFacedown`, for the cards that watch *any* card being played that way
  (Katarina - Reckless, Black Market Broker).

## Not implemented

- **811.1.d.2 — the target restriction.** A hidden spell, or the play effect of
  a hidden permanent, should have to choose its targets from among options *at
  that battlefield*. Targets are currently chosen freely. The placement half
  (d.1) **is** enforced; this half is not.
- **811.1.d — "cannot be played from Hidden with no valid targets"** follows
  from the above, and is likewise unenforced.
## The AI (Part 2.74)

The AI hides and replays. `candidateActions` proposes a `HIDE_CARD` for every
Hidden card in hand at every battlefield `canHide` allows, and a play-from-
facedown for anything in its own Facedown Zone that `canPlayFromFacedown`
clears. All the rules live in `hidden.ts`; the AI only proposes.

`boardScore` needed a term for a facedown card, or hiding could never be
chosen: it spends a rune and removes a card from hand, so every hide scored as
a pure loss and the greedy search discarded it. The card is priced at a hand
card's value plus a flat premium, deliberately *close* to the hand-card line —
pricing a held card far above it is a hoarding incentive, since holding would
then beat using. (Measured: `0.6 + 0.45 * cost` and `0.9 + 0.18 * cost` give
the same replay rate, 15 vs 14 of 38, so the low price is defensive rather than
a measured win.) It is halved at a contested battlefield, where losing control
would reveal and trash it.

Measured over 12 preset games of the Vex deck (8 Hidden cards; Irelia has 3,
the other three presets none): **38 hidden → 14 replayed, 17 still hidden when
the game ended, 7 lost with the battlefield.** Every one accounted for. Over 20
games the AI holds the opponent to 1.35 points with Hidden enabled against 1.60
with it disabled — a small real gain. Win rate is useless here: the AI beats
the scripted bot 20/20 either way.

**Playing from hiding now says so in the log.** It used to read as a plain
"ai plays X", identical to a card from hand, which hid the one thing the
keyword is for. Rule 421.4 reveals a facedown card as it changes zones, so
naming it is correct — and a surprise the player cannot see is not a surprise.
The *hide* line still never names the card (128.4).

