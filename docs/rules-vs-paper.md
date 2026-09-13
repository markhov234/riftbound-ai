# Riftbound-AI vs. paper Riftbound — rules audit

Comparison of this app's engine against the published Riftbound rules (learnriftbound.gg,
riftbound.gg/rules, riftboundfaq.com, RiftJudge rulings). Snapshot: **Part 2.19**, after the
showdown-declaration rework, first-turn-draw skip, and end-of-turn hand limit.

Legend: ✅ matches · 🟡 simplified on purpose (documented) · 🔧 diverges — fix candidate

---

## 1. Setup

| Rule | Paper | App | |
|---|---|---|---|
| Deck size | 40 main + 12 rune + 3 battlefield | 40 / 12 / 3 (`presetDecks`, `DeckBuilder`) | ✅ |
| Battlefields in play (1v1) | Each player reveals **one** of their 3 at random; 2 total | Each player **picks** one (`BattlefieldPicker`); 2 total | 🟡 pick vs random — deliberate UX choice |
| Opening hand | 4 | `OPENING_HAND = 4` | ✅ |
| Mulligan | Recycle 0–2 cards (to bottom of deck), draw that many back | `doMulligan` — bottom-of-deck + redraw, cap `MAX_MULLIGAN = 2` | ✅ |
| First turn | Player on the play **skips their first Draw step** | `beginTurn` skips the draw when `turn === 0` | ✅ |
| Going second | Channels **3** runes on turn 1 instead of 2 | `beginTurn` `goingSecond` bonus (+1), `firstChannelBonusUsed` | ✅ |
| Chosen Champion | Starts in the **Champion Zone** (not the deck); playable from there any time on your turn; does not return there once it leaves | `PlayerState.championZone`; `setup.ts` seeds it, `presetDecks` no longer shuffles a copy in; `playUnit` clears the zone + sets `championPlayed` | ✅ *(2.33)* |

## 2. Turn structure

Paper phases: **Awaken → Beginning (score Holds, start-of-turn triggers) → Channel (2 runes) →
Draw (1, then clear Rune Pool) → Main → End**.

App `beginTurn` order: ready units/gear → `UNIT_READIED` triggers → kill own `[Temporary]` →
**score Holds** (`scoreHolds` + `HELD` event) → `refreshRunes` (clears pool, channels 2) →
banked energy → **draw 1** (deck-out check) → enter `action` phase. `endTurn`: force undeclared
showdowns → clean per-turn counters → `TURN_ENDED` → advance, `round = ⌊turn/2⌋+1`.

| Item | Paper | App | |
|---|---|---|---|
| Score Holds before Channel/Draw | yes | yes | ✅ |
| Rune Pool empties each turn | yes (unspent energy is lost) | `refreshRunes` resets `energy = channeled.length`, `power = 0`, `spent = []` | ✅ (equivalent) |
| Ramp | +2 channeled runes/turn, tap them all for energy | same (channeled runes persist, energy = count) | ✅ |
| Max hand size | **none** (RiftJudge ruling — no discard step) | no end-of-turn discard (was wrongly enforcing 7 through 2.32) | ✅ *(2.33 fix)* |
| Temporary units | removed at start of your turn | killed in `beginTurn` before scoring | ✅ |

## 3. Runes & costs

| Rule | Paper | App | |
|---|---|---|---|
| Channel | 2/turn, stay face-up, ready each Awaken | same | ✅ |
| `:rb_rune_<domain>:` Power pip | recycle a rune of that domain — its Energy is already in the pool (**floating**), so the pip needs a rune but **no extra Energy** | pip needs one un-spent channeled rune (prefers the domain); `spent[]` for the turn; **costs no Energy** (Part 2.24 fix) | ✅ *(floating modelled)* |
| Printed cost pips (the number in the gem) | the number is the Energy, pips are Power; total = number + pips | badge shows the Energy number, a `✦N` tag flags the Power pips; `costOf` → `runes: N×'colorless'` (any channeled rune) | 🟡 pip **domains** not in our data — any rune pays a printed pip; scripted-ability pips keep their domain in `parseCost` (payment prefers it, doesn't strictly require it) |
| Recycle (the standalone action) | take a channeled rune (even exhausted), send it to the deck bottom, gain 1 Power | `RECYCLE_RUNE` pulls a **new** rune from the deck for 1 generic "Power" for the turn; returns next Awaken | 🟡 mainly used for Deflect surcharges; channeled runes are never sent to the deck (they ramp) |
| Accelerate / "additional cost to play" | pay the printed `:rb_energy_N::rb_rune_d:` | reminder text parsed; explicit Energy charged, the rune pip floats (Part 2.24) | ✅ |
| Rune floating (one rune pays toward two things) | supported | **modelled** — a Power pip recycles a rune whose Energy already funded the pool (Part 2.24) | ✅ |
| Cost modifiers (auras / rules / grants) | cards can raise or lower what you pay | `src/engine/costs.ts` `effectiveCost` — wired for **Applied Researchers** ("[Empowered] your spells cost ⚡1✦1 less, min ⚡1"), **Mystic Vortex** ("[Reaction] cards cost ✦ more during a showdown here"), and **Jayce, Man of Progress** (next gear ignores its Energy cost). Applied at every card-play affordability check + payment | 🟡 partial — abilities not hooked yet, so **Piltovan Forge** / **Risen Altar** (Empower-ability discounts) and **The Academy** / **Marai Spire** (Repeat-cost tweaks) still inert |

## 4. Movement & showdowns  *(reworked in Part 2.18)*

| Rule | Paper | App | |
|---|---|---|---|
| Move | Move **one or more ready units** to a battlefield; moving exhausts them | One `MOVE_UNIT` per unit (move them in one at a time), each exhausts | 🟡 many actions vs one — same result |
| Move onto **open** battlefield | claim it (an "open showdown"; opp. may still play spells) | conquer immediately, no priority window | 🟡 no window on an open claim |
| Move onto **enemy-held** battlefield | begins a showdown | **contests** it — no auto-fight; mover keeps priority | ✅ *(new)* |
| Reinforce before fighting | move extra units in the same action, *then* the showdown runs | move more units in across your priority, then **Declare Showdown** button / `DECLARE_SHOWDOWN` | ✅ *(new)* |
| Reinforce **after** the showdown opens | only via `[Action]`/`[Reaction]` cards & abilities, not a plain move | `canMove` blocked while `pendingShowdown`; Actions/Reactions allowed | ✅ |
| Not declaring | n/a — moving in *is* the fight, that turn | forced auto-resolve of every still-contested battlefield in `endTurn` (`forceContestedShowdowns`) | 🟡 safety net; player normally clicks Declare |
| Showdown priority window | closes when all players pass focus in a row w/o acting | `pendingShowdown`; both pass → resolve | ✅ |
| `defend` triggers | fire when a unit first becomes a defender **in a combat** | `DEFENDED` emitted in `declareShowdown` (not on move-in) | ✅ *(new — was firing early)* |
| Resolve | sum Might each side; **simultaneous** damage = total Might; lethal-before-spread; excess carries between units, wasted after all die | `resolveShowdown` sums `showdownMight`, both pools assigned, `autoAssign` / manual `DamageModal`, `validateAssignment` enforces lethal-first | ✅ |
| Might = attack **and** health | yes | `showdownMight` (attack) vs `effHp`/`lethalMight` (health, ignores Stun) | ✅ |
| Tank / Backline | Tank assigned lethal first, Backline last; ties within a band = assigner's choice | `damageOrderRank` (Tank 0 / normal 1 / Backline 2), enforced in `autoAssign` + `validateAssignment` | ✅ |
| Conquer | attacker must destroy **all** defenders (only their units remain) | `finishShowdown` — winner = one side has survivors & other has none | ✅ |
| Attacker doesn't clear the board | surviving attackers **recalled to base**, defender keeps control, no score | "inconclusive" → declarer's units fall back to base, exhausted, healed | ✅ |
| Tie (equal Might) | all units on both sides destroyed | both pools assigned in full → typically mutual destruction; bf goes open | ✅ (emergent) |
| Post-combat | all units at every location heal | `finishShowdown` wipes `damage` on survivors | ✅ |
| "Excess damage" | just the carry-over; wasted once all die | tracked as `defExcess`, passed to `CONQUERED` event for triggers | 🟡 extra bookkeeping; harmless |

## 5. Scoring

| Rule | Paper | App | |
|---|---|---|---|
| Win at | 8 points | `VICTORY_SCORE = 8` | ✅ |
| Hold | +1 per battlefield you control at start of your turn | `scoreHolds`, once per bf per turn (`scoredThisTurn`) | ✅ |
| Conquer | +1 when you take a battlefield by combat/open-claim; **no draw** (466.1) | `scoreConquer`, once per bf per turn | ✅ |
| Conquer draw | only 466.1.b.2 — at 1 short of the Victory Score, a Conquer without a sweep gains no point and draws 1 instead | issued inside `award`, next to the refusal | ✅ |
| Otterpus | "If a player would score 1 point from conquering or holding during their first or second turn, they draw 1 instead" — symmetric, either side's copy | `award`: `otterpusOut && round <= 2`; `round = floor(turn/2)+1` with `turn` from 0, so rounds 1-2 are each player's first two turns | ✅ |
| Defender winning a defense | no points | no points (keeps control only) | ✅ |
| Final (8th) point | only from a **Hold**, a **full sweep** (conquer every battlefield that turn), or a card ability | `award()` refuses a winning point from `kind:'conquer'` unless `controlledCount == battlefields.length`; Holds & abilities allowed | 🟡 "sweep" = *currently control all*, paper = *scored at all this turn* — edge cases differ |
| Direct-from-card points | some cards score directly | compiler `score point` op → `award(…, 'hold')` path | ✅ |
| Otterpus (early-game replacement) | card-specific | `award()` special-case rounds 1–2 | ✅ |

## 6. Known divergences — fix candidates

1. ✅ **First player skips their first draw** — done (Part 2.19). `beginTurn` skips the draw when
   `turn === 0` and logs "…on the play — no draw on the first turn."
2. ✅ **Max hand size 7** — done (Part 2.19). `MAX_HAND_SIZE = 7`; `endTurn` splits into a
   showdown/discard gate + `finishEndTurn` tail. Over the cap: a human gets an interactive
   `handCard` pick (the turn pauses on a `pendingChoice`, resumes via its `resolve`
   continuation), the AI auto-discards. Verified live + 4 tests.
3. **Open-battlefield claim has no priority window** (🟡→🔧?). Paper lets the opponent respond
   with spells before you take an uncontrolled battlefield. Could route an open move-in through
   the same `pendingShowdown` window with an empty defender set. Low value, more clicks.
4. **Battlefield selection is a pick, not random** (🟡). Intentional; leave as-is unless you
   want tournament-faithful randomness (could add a "random" button).
5. **Printed cost pip domains** (🟡). Card data lacks per-pip domains, so all printed pips are
   rainbow. Fixable only with richer card data; domain *identity* (`withinIdentity`) is still
   enforced at play time.
6. **Final-point "sweep" test** (🟡). `controlledCount == N` vs "scored at every battlefield
   this turn". Rare; tighten `award()` if it ever bites.

Everything else is either an exact match or a deliberate, documented simplification.
