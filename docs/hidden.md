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
- **The AI never hides.** It plays Hidden cards normally from hand, which is
  legal (811.3) but leaves value on the table.
