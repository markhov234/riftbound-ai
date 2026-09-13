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
    .replace(/[\s.,:;()—–-]/g, '')
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
  [/^a unit at a battlefield with (\d+) :rb_might: or less$/i, '전장에 있는 위력 $1 이하의 유닛 하나'],
  [/^a unit with (\d+) :rb_might: or less$/i, '위력 $1 이하의 유닛 하나'],
  [/^a unit that'?s \[empowered\]$/i, '[Empowered] 유닛 하나'],
  [/^another unit$/i, '다른 유닛 하나'],
  [/^a friendly gear here$/i, '여기 있는 내 장비 하나'],
  [/^a non-token unit$/i, '토큰이 아닌 유닛 하나'],
  [/^each unit here$/i, '여기 있는 각 유닛'],
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
  // ── Part 2.71: the recurring tail, measured with scripts/i18n-misses.mts ──
  [/^return (.+?) to (?:its|their) owner'?s hand$/i,
   (m) => { const t = target(m[1]); return t && `${obj(t)} 주인의 손으로 되돌립니다` }],
  [/^give (.+?) \+(\d+) :rb_might: this turn and (.+?) -(\d+) :rb_might: this turn$/i,
   (m) => {
     const a = target(m[1])
     const b = target(m[3])
     return a && b && `이번 턴 ${a}에게 위력 +${m[2]}${numObj(m[2]).slice(-1)} 주고, ${b}에게 위력 -${m[4]}${numObj(m[4]).slice(-1)} 줍니다`
   }],
  [/^if a player would score (\d+) point from conquering or holding during their first or second turn, they draw (\d+) instead$/i,
   (m) => `플레이어가 자신의 첫 번째 또는 두 번째 턴에 점령이나 유지로 ${m[1]}점을 얻게 될 경우, 대신 카드 ${m[2]}장을 뽑습니다`],
  [/^put (\d+) into your hand and recycle the rest$/i,
   (m) => `그중 ${m[1]}장을 손패에 넣고 나머지는 재활용합니다`],
  [/^disempower (.+)$/i, (m) => { const t = target(m[1]); return t && `${obj(t)} 강화 해제합니다` }],
  [/^empower it at end of turn$/i, () => '턴 종료 시 그것을 강화합니다'],
  [/^banish a card(?: you own)?$/i, () => '카드 하나를 추방합니다'],
  [/^banish a card from any trash$/i, () => '아무 무덤에서 카드 하나를 추방합니다'],
  [/^banish a card from any trash to give (.+?) \[assault (\d+)\] this turn$/i,
   (m) => { const t = target(m[1]); return t && `아무 무덤에서 카드 하나를 추방해, 이번 턴 ${t}에게 [Assault ${m[2]}]을 줍니다` }],
  [/^move a unit with (\d+) :rb_might: or less$/i, (m) => `위력이 ${m[1]} 이하인 유닛 하나를 이동시킵니다`],
  [/^ready up to (\d+) units?, gear,? and\/or runes?$/i, (m) => `유닛·장비·룬을 합쳐 최대 ${m[1]}개를 준비 상태로 되돌립니다`],
  [/^i have \[assault (\d+)\]$/i, (m) => `나는 [Assault ${m[1]}]을 가집니다`],
  [/^i have \[assault\] equal to the number of gear you control$/i,
   () => '나는 내가 지배하는 장비의 수만큼 [Assault]를 가집니다'],
  [/^\[stun\] (.+)$/i, (m) => { const t = target(m[1]); return t && `${obj(t)} [Stun] 상태로 만듭니다` }],

  // costs
  [/^this costs (:rb_[a-z0-9_]+:) less(?: if you control something that'?s \[empowered\])?$/i,
   (m) => `이 카드의 비용이 ${m[1]} 만큼 줄어듭니다`],
  [/^your spells cost (:rb_[a-z0-9_]+:) less, to a minimum of (:rb_[a-z0-9_]+:)$/i,
   (m) => `내 주문의 비용이 ${m[1]} 만큼 줄어듭니다. 최소 ${m[2]}입니다`],
  [/^your next card costs (:rb_[a-z0-9_]+:) less$/i, (m) => `다음에 내는 카드의 비용이 ${m[1]} 만큼 줄어듭니다`],
  [/^during showdowns here, cards with \[reaction\] cost (:rb_[a-z0-9_]+:) more to play$/i,
   (m) => `여기서 대결이 벌어지는 동안, [Reaction] 카드의 비용이 ${m[1]} 만큼 늘어납니다`],
  [/^as an additional cost to play this, you may discard (\d+)$/i,
   (m) => `이 카드를 내는 추가 비용으로 카드 ${m[1]}장을 버릴 수 있습니다`],
  [/^if you paid the additional cost, deal (\d+) to it instead$/i,
   (m) => `추가 비용을 지불했다면, 대신 그것에게 피해 ${m[1]}을 줍니다`],
  [/^if this is \[empowered\], \[add\] (:rb_[a-z0-9_]+:) instead$/i,
   (m) => `이 카드가 [Empowered]라면, 대신 ${m[1]}을 [Add]합니다`],

  // modal
  // `normaliseNumbers` rewrites the word "one" to "1" before any rule sees the
  // sentence, so a literal /choose one/ can never match. Accept both.
  [/^choose (?:one|1) ?—?\s*(.+)$/i, (m) => { const e = translateEffect(m[1]); return e && `하나를 선택합니다 — ${e}` }],
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
  [/^when you banish a card you own,?$/i, '내가 소유한 카드를 추방할 때,'],
  [/^when you choose or ready me,?$/i, '나를 지정하거나 준비 상태로 만들 때,'],
  [/^when i become \[?empowered\]?,?$/i, '내가 [Empowered] 상태가 될 때,'],
  [/^when combat starts here,?$/i, '여기서 전투가 시작될 때,'],
  [/^when you play me from face down,?$/i, '내가 뒷면에서 나올 때,'],
  [/^when you play your first card each turn,?$/i, '매 턴 내가 첫 카드를 낼 때,'],
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

// ── Reminder text ──────────────────────────────────────────────────────────

/**
 * Parenthesised reminder text is the rules blurb a card prints for a keyword it
 * carries — "[Action] (Play any time, even before spells and abilities
 * resolve.)". It was previously **dropped** from the Korean line on the grounds
 * that the glossary already explains the keyword. That left a Korean reader
 * looking at nothing where an English reader gets a full explanation, and it is
 * a third of all the text on the cards: 133 of 398 sentences in the pool.
 *
 * It is also the easiest third. Reminder text is boilerplate — the same wording
 * on every card carrying the keyword — so this is a lookup table, not grammar.
 * 50 shapes cover all 133 sentences. \`$1\`… are the capture groups, which is how
 * one entry serves "[Deflect 1]" and "[Deflect 2]".
 *
 * Anything not matched here is still dropped rather than shown in English: a
 * reminder is redundant with the keyword gloss, so losing one costs little,
 * while a half-English parenthetical is exactly the noise the Korean line is
 * meant to avoid.
 */
const REMINDERS: [RegExp, string][] = [
  // Timing keywords
  [/^play any time, even before spells and abilities resolve\.?$/i,
   '주문과 능력이 해결되기 전을 포함해 언제든지 낼 수 있습니다.'],
  [/^play on your turn or in showdowns\.?$/i,
   '내 턴이나 대결 중에 낼 수 있습니다.'],
  [/^hidden cards have \[reaction\]\.?$/i,
   '숨겨진 카드는 [Reaction]을 가집니다.'],
  [/^abilities that add resources can'?t be reacted to\.?$/i,
   '자원을 추가하는 능력에는 반응할 수 없습니다.'],

  // Hidden / Flow
  [/^hide now for (.+?) to react with later for (.+?)\.?$/i,
   '지금 $1를 내고 숨긴 뒤, 나중에 $2로 반응할 수 있습니다.'],
  [/^you may play (?:this|it) from your trash for its flow cost\. then banish it\.?$/i,
   '내 무덤에서 Flow 비용으로 낼 수 있습니다. 그 뒤 추방됩니다.'],
  [/^you must still pay its power cost\.?$/i,
   '파워 비용은 그대로 지불해야 합니다.'],

  // Shield-style taxes
  [/^opponents must pay (.+?) to choose me with a spell or ability\.?$/i,
   '상대가 주문이나 능력으로 나를 지정하려면 $1를 더 지불해야 합니다.'],

  // Empower
  // The two "Pay the cost:" wordings come first: the generic `(.+?):` rules
  // below would otherwise capture the literal words "Pay the cost" into $1 and
  // print them, in English, inside an otherwise Korean sentence.
  [/^pay the cost: empower me\. use only if not empowered\.?$/i,
   '비용을 지불합니다: 나를 강화합니다. 강화되지 않았을 때만 사용합니다.'],
  [/^pay the cost: empower this\. use only if not empowered\.?$/i,
   '비용을 지불합니다: 이 카드를 강화합니다. 강화되지 않았을 때만 사용합니다.'],
  [/^(.+?): empower me\. use only if not empowered\.?$/i,
   '$1: 나를 강화합니다. 강화되지 않았을 때만 사용합니다.'],
  [/^(.+?): empower this\. use only if not empowered\.?$/i,
   '$1: 이 카드를 강화합니다. 강화되지 않았을 때만 사용합니다.'],
  [/^it becomes empowered if it'?s not already\.?$/i,
   '아직 강화되지 않았다면 강화됩니다.'],
  [/^i become empowered if i'?m not already\.?$/i,
   '내가 아직 강화되지 않았다면 강화됩니다.'],

  // Combat modifiers
  [/^\+(\d+) (.+?) while it'?s an attacker\.?$/i, '공격자인 동안 $2 +$1.'],
  [/^\+(\d+) (.+?) while i'?m an attacker\.?$/i, '내가 공격자인 동안 $2 +$1.'],
  [/^\+(\d+) (.+?) while it'?s a defender\.?$/i, '방어자인 동안 $2 +$1.'],
  [/^\+(\d+) (.+?) while they'?re defenders\.?$/i, '방어자인 동안 $2 +$1.'],
  [/^\+(\d+) (.+?) while i'?m an attacker for each instance of assault\.?$/i,
   '[Assault] 하나당, 내가 공격자인 동안 $2 +$1.'],
  [/^\+(\d+) (.+?) while it'?s a defender\. it must be assigned combat damage first\.?$/i,
   '방어자인 동안 $2 +$1. 전투 피해를 가장 먼저 할당받아야 합니다.'],
  [/^i must be assigned combat damage last\.?$/i,
   '나는 전투 피해를 가장 나중에 할당받아야 합니다.'],
  [/^it doesn'?t deal combat damage this turn\.?$/i,
   '이번 턴에 전투 피해를 주지 않습니다.'],
  [/^this includes attackers\.?$/i, '공격자도 포함됩니다.'],
  [/^each instance of damage the spell deals is increased by (\d+)\.?$/i,
   '그 주문이 주는 각 피해가 $1씩 증가합니다.'],

  // Movement
  [/^i can move from battlefield to battlefield\.?$/i,
   '나는 전장에서 전장으로 이동할 수 있습니다.'],
  [/^they can move from battlefield to battlefield\.?$/i,
   '전장에서 전장으로 이동할 수 있습니다.'],
  [/^send it to base\. this isn'?t a move\.?$/i,
   '기지로 보냅니다. 이것은 이동이 아닙니다.'],
  [/^i enter exhausted\.?$/i, '나는 소진된 채로 등장합니다.'],
  [/^you may pay (.+?) as an additional cost to have me enter ready\.?$/i,
   '추가 비용으로 $1를 지불하면 준비된 채로 등장시킬 수 있습니다.'],

  // Deck manipulation
  [/^put the top (\d+) cards? of your main deck into your trash\.?$/i,
   '내 메인 덱 맨 위 카드 $1장을 무덤에 넣습니다.'],
  [/^they put the top card of their main deck into their trash\.?$/i,
   '자신의 메인 덱 맨 위 카드 1장을 무덤에 넣습니다.'],
  [/^to burn (\d+), put the top card of your main deck into your trash\.?$/i,
   '[Burn $1]을 하려면, 내 메인 덱 맨 위 카드 1장을 무덤에 넣습니다.'],
  [/^to burn (\d+), they put the top (\d+) cards? of their main deck into their trash\.?$/i,
   '[Burn $1]을 하려면, 자신의 메인 덱 맨 위 카드 $2장을 무덤에 넣습니다.'],
  [/^look at the top card of your main deck\. you may recycle it\.?$/i,
   '내 메인 덱 맨 위 카드를 봅니다. 그 카드를 재활용할 수 있습니다.'],

  // Buffs / status
  [/^give it a \+(\d+) (.+?) buff if it doesn'?t have one\.?$/i,
   '버프가 없다면 $2 +$1 버프를 줍니다.'],
  [/^if it doesn'?t have a buff, it gets a \+(\d+) (.+?) buff\.?$/i,
   '버프가 없다면 $2 +$1 버프를 얻습니다.'],
  [/^a unit is mighty while it has (\d+)\+ (.+?)\.?$/i,
   '유닛은 $2가 $1 이상인 동안 Mighty입니다.'],
  [/^units with (\d+) (.+?) can conquer and hold\.?$/i,
   '$2가 $1인 유닛도 점령하고 유지할 수 있습니다.'],
  [/^it'?s alone if there are no other friendly units here\.?$/i,
   '여기에 다른 내 유닛이 없다면 혼자입니다.'],

  // Misc timing
  [/^this happens before scoring\.?$/i, '이것은 점수 획득보다 먼저 일어납니다.'],
  [/^kill me at the start of your beginning phase, before scoring\.?$/i,
   '내 시작 단계가 시작될 때, 점수 획득보다 먼저 나를 파괴합니다.'],
  [/^when i die, get the effects\.?$/i, '내가 죽을 때 그 효과를 받습니다.'],
  [/^you may pay the additional cost to repeat the spell'?s effect\.?$/i,
   '추가 비용을 지불하면 그 주문의 효과를 한 번 더 반복할 수 있습니다.'],
  // A granted ability, quoted verbatim inside the reminder (Zed's Death Mark).
  // The card API returns the quote marks as `&quot;`; `CardRulesText` decodes
  // them before we see them, but the fixtures do not, so accept either form.
  [/^it has (?:&quot;|")when i attack, you may banish a unit from your trash\. if you do, give me \[assault (\d+)\] this turn\.(?:&quot;|")$/i,
   '“내가 공격할 때, 내 무덤에서 유닛 하나를 추방할 수 있습니다. 그렇게 했다면, 이번 턴에 나에게 [Assault $1]을 줍니다.” 능력을 가집니다.'],
  [/^(.+?): attach this to a unit you control\.?$/i,
   '$1: 이 장비를 내 유닛 하나에 부착합니다.'],
]

/** Korean for one parenthesised reminder, or null to keep dropping it. */
function translateReminder(s: string): string | null {
  const inner = s.replace(/^\(\s*/, '').replace(/\s*\)$/, '').trim()
  for (const [re, ko] of REMINDERS) {
    const m = inner.match(re)
    if (m) return '(' + ko.replace(/\$(\d)/g, (_, d) => m[Number(d)] ?? '') + ')'
  }
  return null
}

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
    if (rest) return `${kw[1].trim()} ${rest}`
    // Fall through rather than giving up. Returning null here made every
    // EFFECTS rule whose pattern *starts* with a keyword unreachable — the peel
    // stripped "[Stun]", failed to translate the bare "a unit", and answered for
    // the whole sentence. `[stun] a unit` and `[stun] it` had been dead since
    // they were written. The last thing this function does is try the full body
    // against EFFECTS, which is exactly what those rules need.
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
        // Same fall-through as the keyword peel: a recognised trigger whose body
        // has no rule must not veto a rule for the sentence as a whole.
        if (rest) return `${ko} ${rest}`
        break
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
    // Reminder text is boilerplate for a keyword the card carries. Translating
    // it is a table lookup, and it is a third of everything printed on a card —
    // so it is translated where a rule exists, and only dropped where none does.
    if (reminder) {
      if (isNeutral(s)) return { text: s, translated: false, reminder: true, neutral: true }
      const ko = translateReminder(s)
      return { text: ko ?? s, translated: ko !== null, reminder: true, neutral: false }
    }
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
  // A reminder survives only if it is *in Korean*. An untranslated one is
  // redundant with the keyword's own Korean gloss, and leaving it in English
  // is the noise this line exists to remove.
  const segs = translateCardText(text).filter((s) => !s.reminder || s.translated)
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
