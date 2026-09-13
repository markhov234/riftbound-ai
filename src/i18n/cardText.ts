/**
 * Best-effort Korean rendering of Riftbound card rules text.
 *
 * This is a **template translator**, not a general one. Riftbound rules text is
 * written from a small grammar ("When you play me, <effect>.", "<cost>: <effect>",
 * "Deal N to <target>."), so an ordered rule list covers most of it. Anything a
 * rule does not match is **left in English** — a wrong translation of a card is
 * worse than an untranslated one, so this never guesses.
 *
 * Two things are deliberately left alone even inside a translated sentence:
 *   - `[Keyword]` brackets, because the card art on screen is printed in English
 *     and the keyword is the reader's anchor. `GlossaryText` makes them hoverable
 *     with a Korean explanation (see `glossary.ko.ts`).
 *   - `:rb_*:` symbol tokens, which `GlossaryText` renders as glyphs.
 *
 * The UI always shows the English original beneath the Korean, so nothing that
 * fails to translate is ever lost.
 */

import { numObj, obj, to } from './korean'

/** A segment of card text plus whether we managed to translate it. */
export interface CardTextSegment {
  text: string
  translated: boolean
  /** True for parenthesised reminder text, which the UI dims. */
  reminder: boolean
  /**
   * True for a segment with no prose to translate — a bare `[Keyword]` line, an
   * `[Empower] :rb_energy_2:` cost line, the `[NO TEXT]` placeholder. These read
   * identically in both languages, so they are neither translated nor a miss.
   */
  neutral: boolean
}

/** `[Action]`, `[Empower] :rb_energy_2:`, `[Deflect 2]`, `[Empowered][>]`, `[NO TEXT]`. */
function isNeutral(s: string): boolean {
  const stripped = s
    .replace(/\[NO TEXT\]/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/:rb_[a-z0-9_]+:/gi, '')
    .replace(/&gt;|&lt;|&quot;/gi, '')
    .replace(/[\s.,:;—–-]/g, '')
  return stripped === ''
}

// ── Verb conjugation ───────────────────────────────────────────────────────

/**
 * Every verb these rules can emit, in the three forms the assembly code needs.
 * A table rather than suffix surgery — Korean verb stems are irregular
 * (줍니다 → 줄 수, 만듭니다 → 만들 수), and string-trimming "니다" produces
 * nonsense like "줍수 있습니다".
 */
const VERBS: { plain: string; can: string; and: string }[] = [
  { plain: '뽑습니다', can: '뽑을 수 있습니다', and: '뽑고' },
  { plain: '버립니다', can: '버릴 수 있습니다', and: '버리고' },
  { plain: '넣습니다', can: '넣을 수 있습니다', and: '넣고' },
  { plain: '얻습니다', can: '얻을 수 있습니다', and: '얻고' },
  { plain: '봅니다', can: '볼 수 있습니다', and: '보고' },
  { plain: '줍니다', can: '줄 수 있습니다', and: '주고' },
  { plain: '냅니다', can: '낼 수 있습니다', and: '내고' },
  { plain: '만듭니다', can: '만들 수 있습니다', and: '만들고' },
  { plain: '가집니다', can: '가질 수 있습니다', and: '가지고' },
  { plain: '됩니다', can: '될 수 있습니다', and: '되고' },
  { plain: '바꿉니다', can: '바꿀 수 있습니다', and: '바꾸고' },
  { plain: '되돌립니다', can: '되돌릴 수 있습니다', and: '되돌리고' },
  { plain: '기절시킵니다', can: '기절시킬 수 있습니다', and: '기절시키고' },
  { plain: '소진시킵니다', can: '소진시킬 수 있습니다', and: '소진시키고' },
  { plain: '이동시킵니다', can: '이동시킬 수 있습니다', and: '이동시키고' },
  { plain: '늘어납니다', can: '늘어날 수 있습니다', and: '늘어나고' },
  { plain: '줄어듭니다', can: '줄어들 수 있습니다', and: '줄어들고' },
  // …합니다 verbs (regular): 재활용·파괴·강화·치료·회수·추방·승리·등장·지불·선택·합니다
  { plain: '합니다', can: '할 수 있습니다', and: '하고' },
]

/** Rewrite a clause's final verb into its "can" or "and" form. */
function conjugate(clause: string, form: 'can' | 'and'): string | null {
  for (const v of VERBS) {
    if (clause.endsWith(v.plain)) {
      return clause.slice(0, -v.plain.length) + v[form]
    }
  }
  return null
}

// ── Targets ────────────────────────────────────────────────────────────────

const TARGETS: [RegExp, string][] = [
  [/^me$/i, '나'],
  [/^myself$/i, '나'],
  [/^this$/i, '이 카드'],
  [/^that unit$/i, '그 유닛'],
  [/^that gear$/i, '그 장비'],
  [/^it$/i, '그것'],
  [/^a friendly unit$/i, '내 유닛 하나'],
  [/^an? enemy unit$/i, '상대 유닛 하나'],
  [/^a friendly gear$/i, '내 장비 하나'],
  [/^an? enemy gear$/i, '상대 장비 하나'],
  [/^a unit at a battlefield$/i, '전장에 있는 유닛 하나'],
  [/^a unit here$/i, '여기 있는 유닛 하나'],
  [/^an? enemy unit here$/i, '여기 있는 상대 유닛 하나'],
  [/^a friendly unit here$/i, '여기 있는 내 유닛 하나'],
  [/^a unit$/i, '유닛 하나'],
  [/^a gear$/i, '장비 하나'],
  [/^a spell$/i, '주문 하나'],
  [/^each unit$/i, '각 유닛'],
  [/^each friendly unit$/i, '내 각 유닛'],
  [/^each enemy unit$/i, '상대의 각 유닛'],
  [/^all units$/i, '모든 유닛'],
  [/^another friendly unit$/i, '다른 내 유닛 하나'],
  [/^up to (\d+) units?$/i, '유닛 최대 $1체'],
  [/^up to (\d+) friendly units?$/i, '내 유닛 최대 $1체'],
  [/^(\d+) units?$/i, '유닛 $1체'],
]

/** Translate a target noun phrase, or return null to leave the sentence alone. */
function target(s: string): string | null {
  const t = s.trim()
  for (const [re, ko] of TARGETS) {
    const m = t.match(re)
    if (m) return ko.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '')
  }
  return null
}

// ── Places ─────────────────────────────────────────────────────────────────

function place(s: string): string | null {
  const t = s.trim().toLowerCase()
  if (/^(to )?(its owner'?s |your |the |its )?base$/.test(t)) return '기지'
  if (/^(to )?(a |any )?battlefield$/.test(t)) return '전장'
  if (/^(to )?here$/.test(t)) return '여기'
  if (/^(to )?(your |their )?hand$/.test(t)) return '손패'
  if (/^(to )?(your |their |the )?trash(es)?$/.test(t)) return '무덤'
  return null
}

// ── Effect clauses ─────────────────────────────────────────────────────────

type Rule = [RegExp, (m: RegExpMatchArray) => string | null]

const EFFECTS: Rule[] = [
  // ── Added to lift Korean coverage: the recurring shapes from the pool ──
  [/^they reveal their hand$/i, () => '그 플레이어는 손패를 공개합니다'],
  [/^you can look at their facedown cards this turn$/i, () => '이번 턴 동안 상대의 뒷면 카드를 볼 수 있습니다'],
  [/^they can'?t move it this turn$/i, () => '그 플레이어는 이번 턴에 그것을 이동시킬 수 없습니다'],
  [/^disempower it at end of turn$/i, () => '턴 종료 시 그것의 [Empowered]를 해제합니다'],
  [/^choose an opponent$/i, () => '상대 한 명을 선택합니다'],
  [/^choose a player$/i, () => '플레이어 한 명을 선택합니다'],
  [/^if you played this from your hand, draw (\d+)$/i, (m) => `이 카드를 손에서 냈다면, 카드 ${m[1]}장을 뽑습니다`],
  [/^ready (\d+) runes?$/i, (m) => `룬 ${m[1]}개를 준비 상태로 되돌립니다`],
  [/^equip :rb_rune_([a-z]+):$/i, (m) => `장착 :rb_rune_${m[1]}:`],
  [/^— discard (\d+)$/i, (m) => `— 카드 ${m[1]}장 버리기`],
  [/^players ignore \[deflect\] while paying for spells and abilities choosing something here$/i, () => '여기 있는 대상을 선택하는 주문과 능력의 비용을 지불할 때 [Deflect]를 무시합니다'],
  [/^each spell that chooses one or more units here that are friendly to it costs :rb_rune_rainbow: less$/i, () => '여기 있는 자신의 유닛을 하나 이상 선택하는 주문은 비용이 :rb_rune_rainbow: 만큼 줄어듭니다'],
  [/^costs of your units here cost :rb_energy_(\d+): or :rb_rune_rainbow: less$/i, (m) => `여기 있는 내 유닛의 비용이 :rb_energy_${m[1]}: 또는 :rb_rune_rainbow: 만큼 줄어듭니다`],
  [/^the first friendly gear activated ability played each turn costs :rb_energy_(\d+): less$/i, (m) => `매 턴 처음 사용하는 내 장비의 발동 능력 비용이 :rb_energy_${m[1]}: 만큼 줄어듭니다`],
  [/^while a unit here is defending alone, it has -(\d+) :rb_might:$/i, (m) => `여기 있는 유닛이 혼자 방어할 때, 위력 -${m[1]}을 가집니다`],
  [/^your non-token units cost :rb_energy_(\d+): more to play this turn$/i, (m) => `이번 턴 토큰이 아닌 내 유닛의 비용이 :rb_energy_${m[1]}: 만큼 늘어납니다`],
  [/^deal (\d+) to each unit here$/i, (m) => `여기 있는 각 유닛에게 피해 ${m[1]}을 입힙니다`],
  [/^you may kill a unit you control here to draw (\d+)$/i, (m) => `여기 있는 내 유닛 하나를 죽여 카드 ${m[1]}장을 뽑을 수 있습니다`],
  [/^\[stun\] a unit$/i, () => '유닛 하나를 [Stun] 상태로 만듭니다'],
  [/^\[stun\] it$/i, () => '그것을 [Stun] 상태로 만듭니다'],
  [/^they may give a unit they control here \+(\d+) :rb_might: this turn$/i, (m) => `이번 턴 여기 있는 자신의 유닛에게 위력 +${m[1]}을 줄 수 있습니다`],
  [/^they may pay :rb_energy_(\d+): to \[buff\] it$/i, (m) => `:rb_energy_${m[1]}:을 지불해 그것을 [Buff]할 수 있습니다`],
  [/^they may move another unit they control here to its base$/i, () => '여기 있는 자신의 다른 유닛을 기지로 이동시킬 수 있습니다'],
  [/^you may ready something besides me that'?s exhausted$/i, () => '나 외에 소진된 것 하나를 준비 상태로 되돌릴 수 있습니다'],
  [/^you may banish me to banish it$/i, () => '나를 추방하여 그것을 추방할 수 있습니다'],
  [/^you may deal (\d+) to a unit at a battlefield i moved to or from$/i, (m) => `내가 이동을 시작하거나 도착한 전장의 유닛에게 피해 ${m[1]}을 입힐 수 있습니다`],
  [/^give a spell in your trash \[flow\] equal to its cost this turn$/i, () => '이번 턴 내 무덤의 주문 하나에 그 비용만큼의 [Flow]를 부여합니다'],
  [/^give your next spell this turn \[repeat\] equal to its base cost$/i, () => '이번 턴 다음에 내는 주문에 기본 비용만큼의 [Repeat]을 부여합니다'],
  [/^play a (\d+) :rb_might: recruit unit token to your base$/i, (m) => `위력 ${m[1]}의 Recruit 유닛 토큰을 내 기지에 냅니다`],
  [/^when you hold here, your non-token units cost :rb_energy_(\d+): more to play this turn$/i, (m) => `내가 여기를 유지할 때, 이번 턴 토큰이 아닌 내 유닛의 비용이 :rb_energy_${m[1]}: 만큼 늘어납니다`],
  [/^units here have &quot;:rb_exhaust:: gain (\d+) xp\.&quot;$/i, (m) => `여기 있는 유닛은 “:rb_exhaust:: 경험치 ${m[1]}을 얻습니다.”를 가집니다`],
  // draw / discard / recycle / burn
  [/^draw (\d+)$/i, (m) => `카드 ${m[1]}장을 뽑습니다`],
  [/^draw a card$/i, () => '카드 1장을 뽑습니다'],
  [/^discard (\d+)$/i, (m) => `카드 ${m[1]}장을 버립니다`],
  [/^discard a card$/i, () => '카드 1장을 버립니다'],
  [/^recycle (\d+)(?: from your trash)?$/i, (m) => `무덤에서 ${m[1]}장을 재활용합니다`],
  [/^recycle (\d+) from your hand$/i, (m) => `손패에서 ${m[1]}장을 재활용합니다`],
  [/^\[burn (\d+)\]$/i, (m) => `[Burn ${m[1]}]을 합니다`],
  [/^burn (\d+)$/i, (m) => `덱 맨 위 ${m[1]}장을 무덤에 넣습니다`],

  // damage / kill / status
  [
    /^deal (\d+)(?: damage)? to (.+)$/i,
    (m) => {
      const t = target(m[2])
      return t && `${t}에게 피해 ${numObj(m[1])} 줍니다`
    },
  ],
  [
    /^kill (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 파괴합니다`
    },
  ],
  [
    /^stun (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 기절시킵니다`
    },
  ],
  [
    /^buff (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 강화합니다`
    },
  ],
  [
    /^heal (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 치료합니다`
    },
  ],
  [
    /^recall (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 회수합니다`
    },
  ],
  [
    /^ready (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 준비 상태로 만듭니다`
    },
  ],
  [
    /^exhaust (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 소진시킵니다`
    },
  ],
  [
    /^banish (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 추방합니다`
    },
  ],

  // might / keyword grants
  [
    /^give (.+?) ([+-]\d+) :rb_might: this turn$/i,
    (m) => {
      const t = target(m[1])
      return t && `${t}에게 이번 턴 동안 위력 ${numObj(m[2])} 줍니다`
    },
  ],
  [
    /^give (.+?) ([+-]\d+) :rb_might:$/i,
    (m) => {
      const t = target(m[1])
      return t && `${t}에게 위력 ${numObj(m[2])} 줍니다`
    },
  ],
  [
    /^give (.+?) (\[[^\]]+\]) this turn$/i,
    (m) => {
      const t = target(m[1])
      return t && `${t}에게 이번 턴 동안 ${m[2]}을 줍니다`
    },
  ],
  [
    /^give (.+?) (\[[^\]]+\])$/i,
    (m) => {
      const t = target(m[1])
      return t && `${t}에게 ${m[2]}을 줍니다`
    },
  ],
  [/^i have ([+-]\d+) :rb_might:$/i, (m) => `나는 위력 ${numObj(m[1])} 가집니다`],
  [
    /^i have ([+-]\d+) :rb_might: and (\[[^\]]+\])$/i,
    (m) => `나는 위력 ${m[1]}과 ${m[2]}을 가집니다`,
  ],

  // movement
  [
    /^move (.+?) to (.+)$/i,
    (m) => {
      const t = target(m[1])
      const p = place(m[2])
      return t && p && `${obj(t)} ${to(p)} 이동시킵니다`
    },
  ],
  // Bare "Move <target>" — no destination named. Must stay after the
  // "move X to Y" rule above so an explicit destination still wins.
  [
    /^move (.+)$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 이동시킵니다`
    },
  ],
  [
    /^return (.+?) to (?:its owner'?s |their owners' |your )?hands?$/i,
    (m) => {
      const t = target(m[1])
      return t && `${obj(t)} 주인의 손패로 되돌립니다`
    },
  ],

  // tokens
  [
    /^play an? (\d+) :rb_might: (.+?) unit token to your base$/i,
    (m) => `내 기지에 위력 ${m[1]}의 ${m[2]} 유닛 토큰을 냅니다`,
  ],
  [
    /^play an? (\d+) :rb_might: (.+?) unit token here$/i,
    (m) => `여기에 위력 ${m[1]}의 ${m[2]} 유닛 토큰을 냅니다`,
  ],

  // deck manipulation
  [
    /^look at the top (\d+) cards? of your main deck$/i,
    (m) => `내 메인 덱 맨 위 ${m[1]}장을 봅니다`,
  ],
  [
    /^put (\d+) into your hand and recycle the rest$/i,
    (m) => `그중 ${m[1]}장을 손패에 넣고 나머지는 재활용합니다`,
  ],
  [/^\[predict (\d+)\]$/i, (m) => `[Predict ${m[1]}]을 합니다`],

  // resources
  [/^add :rb_energy_(\d+):$/i, (m) => `에너지 ${numObj(m[1])} 얻습니다`],
  [/^gain (\d+) xp$/i, (m) => `경험치(XP) ${numObj(m[1])} 얻습니다`],
  [/^score (\d+) points?$/i, (m) => `${m[1]}점을 얻습니다`],

  // game-enders / global
  [/^you win the game$/i, () => '게임에서 승리합니다'],
  [
    /^increase the points needed to win the game by (\d+)$/i,
    (m) => `승리에 필요한 점수가 ${m[1]} 늘어납니다`,
  ],
  [
    /^i enter ready if you have a card with my name in your trash$/i,
    () => '무덤에 내 이름과 같은 카드가 있으면 나는 준비 상태로 등장합니다',
  ],
  [/^this enters exhausted$/i, () => '이 카드는 소진 상태로 등장합니다'],
  [/^i enter exhausted$/i, () => '나는 소진 상태로 등장합니다'],
  [
    /^you may hide an additional card here$/i,
    () => '여기에 카드를 한 장 더 숨길 수 있습니다',
  ],

  // "…instead" variants (the branch half of "If [Empowered], … instead.")
  [/^deal (\d+) instead$/i, (m) => `대신 피해 ${numObj(m[1])} 줍니다`],
  [
    /^give (.+?) ([+-]\d+) :rb_might: this turn instead$/i,
    (m) => {
      const t = target(m[1])
      return t && `대신 ${t}에게 이번 턴 동안 위력 ${numObj(m[2])} 줍니다`
    },
  ],
  [/^draw (\d+) instead$/i, (m) => `대신 카드 ${m[1]}장을 뽑습니다`],

  // trash / hand movement
  [
    /^return an? (spell|unit|gear|card) from your trash to your hand$/i,
    () => '무덤에서 카드 한 장을 손패로 되돌립니다',
  ],
  [
    /^return up to (\d+) units? from trashes to their owners' hands$/i,
    (m) => `무덤에서 유닛 최대 ${m[1]}체를 주인의 손패로 되돌립니다`,
  ],

  // multi-unit movement
  [
    /^move up to (\d+) friendly units? to (.+)$/i,
    (m) => {
      const p = place(m[2])
      return p && `내 유닛 최대 ${m[1]}체를 ${to(p)} 이동시킵니다`
    },
  ],
  [
    /^move me and (.+?) to each other's locations$/i,
    (m) => `나와 ${obj(target(m[1]) ?? m[1])} 서로의 위치로 바꿉니다`,
  ],

  // cost modifiers
  [
    /^each spell that chooses one or more units here that are friendly to it costs (:rb_[a-z0-9_]+:) less$/i,
    (m) => `여기 있는 자기편 유닛을 하나 이상 지정하는 각 주문의 비용이 ${m[1]}만큼 줄어듭니다`,
  ],
  [
    /^\[empower\] costs of your units here cost (.+?) less$/i,
    (m) => `여기 있는 내 유닛들의 [Empower] 비용이 ${m[1]}만큼 줄어듭니다`,
  ],

  // additional cost
  [
    /^you may discard (\d+) as an additional cost to play me$/i,
    (m) => `나를 낼 때 추가 비용으로 카드 ${m[1]}장을 버릴 수 있습니다`,
  ],
  [
    /^you may pay (.+?) as an additional cost to play me$/i,
    (m) => `나를 낼 때 추가 비용으로 ${m[1]}을 지불할 수 있습니다`,
  ],

  // bare token play (no destination named)
  [
    /^play an? (\d+) :rb_might: (.+?) unit token$/i,
    (m) => `위력 ${m[1]}의 ${m[2]} 유닛 토큰을 냅니다`,
  ],

  // empower
  [/^empower me$/i, () => '나를 강화합니다'],
  [/^empower this$/i, () => '이 카드를 강화합니다'],
  [/^empower another gear$/i, () => '다른 장비 하나를 강화합니다'],
  [/^empower (.+)$/i, (m) => {
    const t = target(m[1])
    return t && `${obj(t)} 강화합니다`
  }],

  // "They <effect>" — the chosen opponent
  [/^they \[burn (\d+)\]$/i, (m) => `그 플레이어가 [Burn ${m[1]}]을 합니다`],
  [/^they draw (\d+)$/i, (m) => `그 플레이어가 카드 ${m[1]}장을 뽑습니다`],
  [/^they discard (\d+)$/i, (m) => `그 플레이어가 카드 ${m[1]}장을 버립니다`],

  [/^choose a player$/i, () => '플레이어 한 명을 선택합니다'],

  // Battlefield statics — "Units here have …", which are always on screen.
  [/^units here have (\[[^\]]+\])$/i, (m) => `여기 있는 유닛들은 ${m[1]}을 가집니다`],
  [
    /^units here have ([+-]\d+) :rb_might:$/i,
    (m) => `여기 있는 유닛들은 위력 ${numObj(m[1])} 가집니다`,
  ],
  [
    /^units here with (\[[^\]]+\]) have (\[[^\]]+\])$/i,
    (m) => `여기 있는 ${m[1]} 유닛들은 ${m[2]}을 가집니다`,
  ],
  [
    /^units here with (\[[^\]]+\]) have ([+-]\d+) :rb_might:$/i,
    (m) => `여기 있는 ${m[1]} 유닛들은 위력 ${numObj(m[2])} 가집니다`,
  ],

  // reveal / top-of-deck
  [
    /^reveal the top card of your main deck$/i,
    () => '내 메인 덱 맨 위 카드를 공개합니다',
  ],
  [
    /^look at the top card of your main deck$/i,
    () => '내 메인 덱 맨 위 카드를 봅니다',
  ],
  // Number words are normalised to digits before rules run, so "one" is "1" here.
  [
    /^you may recycle 1 or both of them$/i,
    () => '그중 하나 또는 둘 다를 재활용할 수 있습니다',
  ],
  [
    /^put those you don'?t back in any order$/i,
    () => '재활용하지 않은 카드는 원하는 순서로 맨 위에 되돌립니다',
  ],
  [/^otherwise, recycle it$/i, () => '그렇지 않다면 재활용합니다'],
  [
    /^if it'?s a (spell|unit|gear), put it in your hand$/i,
    () => '그 카드가 주문이라면 손패에 넣습니다',
  ],
]

/** "if <condition>," clause heads. */
function condition(s: string): string | null {
  const t = s.trim()
  let m
  if ((m = t.match(/^you paid the additional cost$/i))) return '추가 비용을 지불했다면,'
  if ((m = t.match(/^you control (\d+) or more other gear$/i)))
    return `내가 다른 장비를 ${m[1]}개 이상 조종하고 있다면,`
  if ((m = t.match(/^you have (\d+)\+? units? here$/i)))
    return `여기에 내 유닛이 ${m[1]}체 이상 있다면,`
  if ((m = t.match(/^you assigned (\d+) or more excess damage$/i)))
    return `초과 피해를 ${m[1]} 이상 배분했다면,`
  if ((m = t.match(/^i'?m \[empowered\]$/i))) return '내가 [Empowered] 상태라면,'
  if ((m = t.match(/^this is \[empowered\]$/i))) return '이 카드가 [Empowered] 상태라면,'
  return null
}

/** Wrapper clauses that take a translated inner effect. */
const WRAPPERS: Rule[] = [
  [
    /^if you paid the additional cost, (.+)$/i,
    (m) => {
      const e = translateSentence(m[1] + '.')
      return e && `추가 비용을 지불했다면, ${e.replace(/\.$/, '')}`
    },
  ],
  [
    /^if i'?m \[empowered\], (.+)$/i,
    (m) => {
      const e = translateSentence(m[1] + '.')
      return e && `내가 [Empowered] 상태라면, ${e.replace(/\.$/, '')}`
    },
  ],
  [
    /^if this is \[empowered\], (.+)$/i,
    (m) => {
      const e = translateSentence(m[1] + '.')
      return e && `이 카드가 [Empowered] 상태라면, ${e.replace(/\.$/, '')}`
    },
  ],
  [
    /^if you have (\d+)\+ units here, (.+)$/i,
    (m) => {
      const e = translateSentence(m[2] + '.')
      return e && `여기에 내 유닛이 ${m[1]}체 이상 있다면, ${e.replace(/\.$/, '')}`
    },
  ],
  [
    /^you may (.+?) to (.+)$/i,
    (m) => {
      const cost = translateEffect(m[1])
      const eff = translateEffect(m[2])
      if (!cost || !eff) return null
      const c = conjugate(cost, 'and')
      const e = conjugate(eff, 'can')
      return c && e && `${c} ${e}`
    },
  ],
]

// ── Trigger prefixes ───────────────────────────────────────────────────────

const TRIGGERS: [RegExp, string][] = [
  [/^when you play me or the first time you play a non-token gear each turn,?$/i, '내가 나올 때, 또는 매 턴 처음으로 토큰이 아닌 장비를 낼 때,'],
  [/^when an opponent plays a gear,?$/i, '상대가 장비를 낼 때,'],
  [/^when an opponent plays a unit while i'?m at a battlefield,?$/i, '내가 전장에 있는 동안 상대가 유닛을 낼 때,'],
  [/^when you play a card on an opponent'?s turn,?$/i, '상대 턴에 카드를 낼 때,'],
  [/^when i become ready,?$/i, '내가 준비 상태가 될 때,'],
  [/^the first time i move each turn,?$/i, '매 턴 내가 처음 이동할 때,'],
  [/^at the end of your turn,?$/i, '내 턴이 끝날 때,'],
  [/^at the start of your beginning phase,?$/i, '내 시작 단계가 시작될 때,'],
  [/^at the start of each player'?s beginning phase,?$/i, '각 플레이어의 시작 단계가 시작될 때,'],
  [/^while you control this battlefield,?$/i, '내가 이 전장을 지배하는 동안,'],
  [/^when you play me from face down on your turn,?$/i, '내 턴에 내가 뒷면에서 나올 때,'],
  [/^when a player plays a spell,?$/i, '플레이어가 주문을 낼 때,'],
  [/^when a player plays a unit here,?$/i, '플레이어가 여기에 유닛을 낼 때,'],
  [/^the first time a player plays a non-token unit here each turn,?$/i, '매 턴 플레이어가 여기에 토큰이 아닌 유닛을 처음 낼 때,'],
  [/^when a unit here is returned to a player'?s hand,?$/i, '여기 있는 유닛이 주인의 손으로 돌아갈 때,'],
  [/^when you play me,?$/i, '내가 나올 때,'],
  [/^when you play this,?$/i, '이 카드가 나올 때,'],
  [/^when i enter,?$/i, '내가 등장할 때,'],
  [/^when i move,?$/i, '내가 이동할 때,'],
  [/^when i attack,?$/i, '내가 공격할 때,'],
  [/^when i conquer,?$/i, '내가 점령할 때,'],
  [/^when i die,?$/i, '내가 죽을 때,'],
  [/^when i am killed,?$/i, '내가 파괴될 때,'],
  [/^when you conquer here,?$/i, '내가 여기를 점령할 때,'],
  [/^when you hold here,?$/i, '내가 여기를 유지할 때,'],
  [/^when you defend here,?$/i, '내가 여기서 방어할 때,'],
  [/^at the start of your turn,?$/i, '내 턴이 시작될 때,'],
  [/^at the end of your turn,?$/i, '내 턴이 끝날 때,'],
  [/^if you do,?$/i, '그렇게 했다면,'],
  [/^you may$/i, '~할 수 있습니다:'],
]

// ── Sentence assembly ──────────────────────────────────────────────────────

/**
 * Index of the `:` that divides an activated ability's cost from its effect —
 * the first colon not part of a `:rb_*:` symbol token. Returns -1 if there
 * isn't one.
 */
function dividerColon(s: string): number {
  const symbols = [...s.matchAll(/:rb_[a-z0-9_]+:/gi)].map((m) => [
    m.index!,
    m.index! + m[0].length,
  ])
  const inside = (i: number) => symbols.some(([a, b]) => i >= a && i < b)
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ':' && !inside(i)) return i
  }
  return -1
}

/** Card text mixes "2" and "two"; normalise so one rule matches both. */
const NUMBER_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
}

function normaliseNumbers(s: string): string {
  return s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi,
    (w) => NUMBER_WORDS[w.toLowerCase()] ?? w,
  )
}

/** Strip the trailing period so effect rules can match, then put it back. */
function withoutPeriod(s: string): [string, string] {
  const m = s.match(/^(.*?)([.!]?)$/s)
  return m ? [m[1].trim(), m[2]] : [s, '']
}

function translateEffect(s: string): string | null {
  const [body] = withoutPeriod(normaliseNumbers(s))
  for (const [re, fn] of EFFECTS) {
    const m = body.match(re)
    if (m) {
      const out = fn(m)
      if (out) return out
    }
  }
  return null
}

/**
 * Translate one sentence. Handles an optional "<trigger>," prefix and an
 * optional "<cost>:" prefix, then the effect body. Returns null if the body
 * cannot be translated — a half-translated sentence is not offered.
 */
function translateSentence(s: string): string | null {
  const [body, dot] = withoutPeriod(normaliseNumbers(s))
  if (!body) return null
  const end = dot === '!' ? '!' : '.'

  // Peel a leading keyword run — "[Ganking]Recycle 1…", "[Empowered][>] I have…",
  // "[Action][>] :rb_energy_1:: Move me…". The keywords stay English (they are
  // the reader's anchor to the card art) and the rest is translated.
  const kw = body.match(/^((?:\[[^\]]+\]|&gt;|\s)+)(.+)$/)
  if (kw && /\[/.test(kw[1]) && kw[2].trim()) {
    const rest = translateSentence(kw[2].trim() + end)
    return rest && `${kw[1].trim()} ${rest}`
  }

  // "<cost>: <effect>" — an activated ability. Costs are a mix of symbols and
  // prose ("Recycle 1 from your trash:", "Discard a gear, :rb_energy_1:, ↻:"),
  // so find the divider colon: the first one that is not inside a `:rb_*:`
  // token. Symbol-only cost halves pass through; prose ones are translated if
  // a rule matches and left in English if not.
  const divider = dividerColon(body)
  if (divider > 0) {
    const rawCost = body.slice(0, divider).trim()
    const eff = translateSentence(body.slice(divider + 1).trim() + end)
    if (eff) {
      const cost = isNeutral(rawCost) ? rawCost : (translateEffect(rawCost) ?? rawCost)
      return `${cost}: ${eff}`
    }
  }

  // "<trigger>, <rest>"
  const comma = body.match(/^([^,]+),\s*(.+)$/)
  if (comma) {
    for (const [re, ko] of TRIGGERS) {
      if (re.test(comma[1].trim())) {
        const rest = translateSentence(comma[2] + end)
        return rest && `${ko} ${rest}`
      }
    }
  }

  // "<a> and <b>" / "<a>, then <b>" — two effects in one sentence. Only offered
  // when BOTH halves translate, so a compound never comes out half-English.
  const compound = body.match(/^(.+?),? (?:and|then) (.+)$/i)
  if (compound) {
    const a = translateEffect(compound[1])
    const b = translateEffect(compound[2].replace(/^it /i, ''))
    const joined = a && conjugate(a, 'and')
    if (joined && b) return `${joined} ${b}${end}`
  }

  // "<trigger>, if <condition>, <effect>" — a guarded trigger body.
  const guarded = body.match(/^if (.+?), (.+)$/i)
  if (guarded) {
    const cond = condition(guarded[1])
    const eff = translateSentence(guarded[2] + end)
    if (cond && eff) return `${cond} ${eff}`
  }

  // Conditional / compound wrappers that take a translated inner clause.
  for (const [re, fn] of WRAPPERS) {
    const m = body.match(re)
    if (m) {
      const out = fn(m)
      if (out) return out + end
    }
  }

  // "You may <effect>"
  const may = body.match(/^you may (.+)$/i)
  if (may) {
    const eff = translateEffect(may[1])
    const can = eff && conjugate(eff, 'can')
    if (can) return can + end
  }

  const eff = translateEffect(body)
  return eff && eff + end
}

// ── Segmentation ───────────────────────────────────────────────────────────

/**
 * Split card text into reminder-text parentheticals and sentences. Riftbound
 * text often runs a sentence straight into the next with no space after `)` or
 * `.`, so we split on those boundaries too.
 */
function segments(text: string): { text: string; reminder: boolean }[] {
  const out: { text: string; reminder: boolean }[] = []
  const re = /\([^)]*\)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) pushSentences(text.slice(last, m.index), out)
    out.push({ text: m[0], reminder: true })
    last = m.index! + m[0].length
  }
  if (last < text.length) pushSentences(text.slice(last), out)
  return out.filter((s) => s.text.trim())
}

function pushSentences(chunk: string, out: { text: string; reminder: boolean }[]) {
  for (const part of chunk.split(/(?<=[.!])\s*(?=[A-Z:[])|\n+/)) {
    const t = part.trim()
    if (t) out.push({ text: t, reminder: false })
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Translate card rules text segment by segment. Untranslatable segments come
 * back with their English text and `translated: false`, so the caller can show
 * them as-is rather than dropping them.
 */
export function translateCardText(text: string): CardTextSegment[] {
  return segments(text).map(({ text: s, reminder }) => {
    // Reminder text restates a keyword the glossary already covers in Korean —
    // translating it again adds noise, so it is dropped from the Korean line.
    if (reminder) return { text: s, translated: false, reminder: true, neutral: false }
    if (isNeutral(s)) return { text: s, translated: false, reminder: false, neutral: true }
    const ko = translateSentence(s)
    return { text: ko ?? s, translated: ko !== null, reminder: false, neutral: false }
  })
}

/**
 * The Korean line for a card: translated sentences in Korean, untranslated ones
 * left in English, keyword-only lines kept as-is, reminder parentheticals
 * dropped. Returns null when there was nothing to translate, or nothing that
 * could be — the caller then just shows the English.
 */
export function cardTextKo(text: string): string | null {
  const segs = translateCardText(text).filter((s) => !s.reminder)
  if (!segs.some((s) => s.translated)) return null
  return segs.map((s) => s.text).join(' ')
}

/**
 * Translation coverage over the prose sentences of a card — neutral
 * (keyword-only) and reminder segments are excluded from both counts, since
 * neither has anything to translate. Used by the coverage test.
 */
export function cardTextCoverage(text: string): { total: number; translated: number } {
  const segs = translateCardText(text).filter((s) => !s.reminder && !s.neutral)
  return { total: segs.length, translated: segs.filter((s) => s.translated).length }
}
