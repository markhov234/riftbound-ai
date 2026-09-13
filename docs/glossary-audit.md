# Glossary → engine audit

Every entry in `src/data/glossary.ts` (25 keywords + 6 game actions + 7 rules terms
+ the `:rb_*:` symbols) checked against what the engine actually does. Snapshot: **Part 2.30**.

Legend: ✅ implemented & tested · 🟡 simplified on purpose · 🔧 stub / incomplete

---

## Keywords

| Keyword | Status | Where | Notes |
|---|---|---|---|
| Accelerate | ✅ | `unitPlayOptions` + `playUnit` | reminder-text pips; the Power pip floats (2.25) |
| Action | ✅ | `spellTiming` → `timingAllows` | your main phase, or any showdown window |
| Ambush | 🟡 | `canPlay(state, side, card, to)` | **new (2.30):** Reaction timing when played to a battlefield you occupy. Placement itself is already permitted for any unit (broad simplification), so the "only Ambush units may" restriction is not enforced. |
| Assault X | ✅ | `showdownMight` (attacker) | sums instances |
| Backline | ✅ | `damageOrderRank` = 2 | enforced in `autoAssign` + `validateAssignment` |
| Deathknell | ✅ | compiler `[Deathknell][>]` → `UNIT_DIED` | `recall`/`bounce` use `removeUnit`, so replacement deaths don't trigger it |
| Deflect X | ✅ | `deflectSurcharge` | added to Power cost when an opponent targets the unit |
| Empower | ✅ | compiler `[Empower <cost>]` | `when: !isEmpowered` |
| Empowered | ✅ | compiler `[Empowered][>] …` | flat `+N [M]` / `[Assault N]`, and gated `<cost>: <effect>` abilities |
| Equip | ✅ | compiler `[Equip <cost>]` → `attachGear` | |
| Flow | ✅ | `flowCost` / `castFlow` | banishes on resolve; **AI never chooses it** (heuristic gap) |
| Ganking | ✅ | `hasGanking`; `canMove` | battlefield auras can grant it |
| Hidden | 🔧 | `spellTiming` → `action` only | the face-down-hide / next-turn / cost-0 replay mechanic is **not** modelled |
| Hunt X | ✅ | `events.ts` built-in | XP on conquer / hold |
| Legion | ✅ | **new (2.30):** compiler parses `[Legion][>]` | gates the trigger / activated ability with `legionActive` |
| Level N | ✅ | **new (2.30):** compiler parses `[Level N][>]` | gates with `levelActive` (controller XP ≥ N) |
| Quick-Draw | ✅ | **new (2.30):** `spellTiming` → reaction + `resolveTop` auto-attach | the cast asks for the friendly-unit target |
| Reaction | ✅ | `spellTiming` → `timingAllows` | any time you hold priority |
| Repeat | ✅ | **new (2.30):** `unitPlayOptions` `repeat` option + `resolveTop` loop | 🟡 re-runs with the **same** targets (paper lets choices differ) |
| Shield X | ✅ | `showdownMight` (defender) + `effHp` | |
| Tank | ✅ | `damageOrderRank` = 0 | |
| Temporary | ✅ | `phases.ts beginTurn` | killed before scoring |
| Unique | ✅ | deck-building only (no gameplay effect) | |
| Vision | ✅ | compiler `[Vision]` → predict on enter | |
| Weaponmaster | 🟡 | **new (2.30):** compiler `[Weaponmaster]` → `UNIT_ENTERED` self-trigger | auto-attaches the first unattached controlled Equipment to itself **for free** (paper: choose one, pay its Equip cost − 1 energy) |

## Game actions

| Action | Status | Where |
|---|---|---|
| Add | ✅ (basic) | `addEnergy` / `addPower`; compiler `[Add] :rb_energy_N:`. `[Reaction][>] ↻: [Add]` activated abilities (Platewyrm Egg) still not compiled. |
| Buff | ✅ | `buff()` — non-stacking `counters.buffed` |
| Burn X | ✅ | `burn()` — mills as many as possible |
| Mighty | ✅ | `isMighty` (effective Might ≥ 5). Trash-Mighty (printed ≥ 5 while in the trash) not handled — unused. |
| Predict X | ✅ | `predict` / `predictChoice` (interactive) |
| Stun | ✅ | `stun()` — 0 Might, full lethal HP, clears in cleanup, no re-stun |

## Rules terms

| Term | Status | Where |
|---|---|---|
| Token | ✅ | `supertype === 'token'`; ceases to exist off-board |
| Showdown | ✅ | `resolveShowdown` — simultaneous, lethal-first, Tank/Backline |
| Conquer | ✅ | `scoreConquer` — +1 / bf / turn, draw if not the winning point |
| Hold | ✅ | `scoreHolds` at Awaken |
| Recall | ✅ | `recall()` — to base, wipes damage + counters, no Deathknell |
| Banish | ✅ | `banishFromTrash` → `banished` pile, `CARD_BANISHED` |
| Excess damage | ✅ (tracked) | `defExcess` → `CONQUERED` event; no card reads it interactively yet |

## Symbols

`:rb_energy_N:`, `:rb_rune_<domain>:` (rainbow = colorless), `:rb_exhaust:`, `:rb_might:` — all
parsed by `parseCost` / `costOf` / `flowCost`. ✅

---

## Still open

1. **Hidden** — needs a real face-down mechanic: a `HiddenCard` slot per battlefield, a
   1-energy hide action in an Open State, and a next-turn "play ignoring base cost, targets
   restricted to that battlefield" path. Design decision pending. Only Zhonya's Hourglass in
   the current pool.
2. **Weaponmaster** discounted-cost choice — would need interactive cost payment inside a
   trigger (the engine has no such path). Auto-free-attach is the stand-in.
3. **Ambush** placement restriction — the engine lets any unit enter a battlefield it occupies;
   tightening that to Ambush-only is a broader change to `canPlaceUnitAt` and is deferred.
4. **Repeat** re-targeting — re-runs reuse the first execution's targets.
5. **AI** does not pay any optional additional cost (Accelerate / additional / **Repeat**),
   Flow-cast, or value Empower / gear lines — a heuristics gap, not a mechanics bug.
