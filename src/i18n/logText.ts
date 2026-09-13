/**
 * Korean rendering of the engine's activity-log lines.
 *
 * The engine writes free-form English through ~140 `appendLog(...)` calls, but
 * those collapse to about 110 distinct templates with a fixed vocabulary — so
 * pattern-matching the rendered line is far cheaper than refactoring every call
 * site into a structured `{ key, params }` record (which would also mean
 * rewriting the ~20 tests that assert on log substrings).
 *
 * Same contract as `cardText.ts`: **anything unmatched is left in English**.
 * Card names pass through untranslated, matching the English card art.
 *
 * Vocabulary is kept consistent with `data/glossary.ko.ts`:
 * 점령 conquer · 유지 hold · 결전 showdown · 무덤 trash · 소진 exhausted ·
 * 위력 Might · 기절 stun · 추방 banish · 회수 recall · 재활용 recycle ·
 * 소각 burn · 예지 predict · 강화 buff/empower.
 */

/**
 * Log lines name the sides literally as "player" / "ai". As a *subject* 나 is
 * irregular — 나 + 가 contracts to 내가, not 나가 — so `side()` returns the
 * ready-made subject form rather than a bare noun a particle is appended to.
 */
function side(s: string): string {
  const t = s.trim()
  if (/^player$/i.test(t)) return '내가'
  if (/^ai$/i.test(t)) return 'AI가'
  return t
}

/** The bare noun, for building other particles. */
function bare(s: string): string {
  const t = s.trim()
  if (/^player$/i.test(t)) return '나'
  if (/^ai$/i.test(t)) return 'AI'
  return t
}

/** `'s` possessive — "ai's Cleave" → "AI의 Cleave". */
function poss(s: string): string {
  return bare(s) + '의'
}

/** Dative 에게/에게는 — "ai has no runes" → "AI에게". */
function dative(s: string): string {
  return bare(s) + '에게'
}

import { numObj, numTo, numTopic } from './korean'

/** Rune domains as they appear in log lines (strings.ts owns the UI copy). */
const DOMAIN_KO: Record<string, string> = {
  fury: '분노',
  calm: '평온',
  mind: '정신',
  body: '육체',
  order: '질서',
  chaos: '혼돈',
  colorless: '무색',
}

type Rule = [RegExp, (m: RegExpMatchArray) => string]

/**
 * Ordered — the first match wins, so put specific patterns before general ones
 * (e.g. "plays X to base" before "plays X").
 */
const RULES: Rule[] = [
  // ── turn / phase markers ────────────────────────────────────────────────
  // Note: this one names the sides "You"/"AI", not "player"/"ai".
  [
    /^Game start\. (You|AI) will take the first turn\.$/i,
    (m) => `게임 시작. ${/^you$/i.test(m[1]) ? '내가' : 'AI가'} 선공입니다.`,
  ],
  [/^— (player|ai)'s turn —$/i, (m) => `— ${poss(m[1])} 턴 —`],
  [/^(player|ai) draws for the turn\.$/i, (m) => `${side(m[1])} 턴 시작에 카드를 뽑습니다.`],
  [
    /^(player|ai) is on the play — no draw on the first turn\.$/i,
    (m) => `${side(m[1])} 선공이라 첫 턴에는 카드를 뽑지 않습니다.`,
  ],
  [/^(player|ai) keeps their hand\.$/i, (m) => `${side(m[1])} 손패를 그대로 유지합니다.`],
  [/^(player|ai) passes\.$/i, (m) => `${side(m[1])} 패스합니다.`],
  [/^(player|ai) declines\.$/i, (m) => `${side(m[1])} 거절합니다.`],

  // ── runes / resources ───────────────────────────────────────────────────
  [
    /^(player|ai) channels a rune \(\+1 energy\)\.$/i,
    (m) => `${side(m[1])} 룬을 충전합니다 (에너지 +1).`,
  ],
  [
    /^(player|ai) channels an extra rune for going second\.$/i,
    (m) => `${side(m[1])} 후공이라 룬을 하나 더 충전합니다.`,
  ],
  [
    /^(player|ai) recycles a rune \(\+1 power\)\.$/i,
    (m) => `${side(m[1])} 룬을 재활용합니다 (파워 +1).`,
  ],
  [
    // Rule 163.2.b — recycling converts a rune already on the board, so it
    // stays channelled but exhausted and adds no energy this turn.
    /^(player|ai) channels a rune exhausted \(no energy this turn\)\.$/i,
    (m) => `${side(m[1])} 룬을 소진된 채로 충전합니다 (이번 턴 에너지 없음).`,
  ],
  [
    /^(player|ai) has no runes left to (channel|recycle)\.$/i,
    (m) => `${dative(m[1])} ${m[2] === 'channel' ? '충전' : '재활용'}할 룬이 없습니다.`,
  ],
  // The hide line must never name the card (128.4) — the engine already omits
  // it, and the Korean must not reintroduce it.
  [/^(player|ai) hides a card at battlefield (\d+)\.$/i,
   (m) => `${side(m[1])} 전장 ${m[2]}에 카드 1장을 숨깁니다.`],
  [/^(player|ai) plays (.+?) from hiding at (.+?)\.$/i,
   (m) => `${side(m[1])} 숨겨둔 ${m[2]}을(를) ${numTo(m[3])} 냅니다.`],
  [/^(player|ai) plays (.+?) from hiding\.$/i,
   (m) => `${side(m[1])} 숨겨둔 ${m[2]}을(를) 냅니다.`],
  [/^(.+?): combat begins — ability triggers\.$/i, (m) => `${m[1]}: 전투가 시작되어 능력이 발동합니다.`],
  [/^(player|ai) adds (\d+) energy\.$/i, (m) => `${side(m[1])} 에너지 ${numObj(m[2])} 얻습니다.`],
  [/^(player|ai) adds (\d+) Power\.$/i, (m) => `${side(m[1])} 파워 ${numObj(m[2])} 얻습니다.`],
  // Fall-backs for a non-side source (a card name), where the particle after a
  // Latin name is genuinely undecidable — see the module header.
  [/^(.+?) adds (.+?) energy\.$/i, (m) => `${m[1]}이(가) 에너지 ${m[2]}을(를) 얻습니다.`],
  [/^(.+?) adds (.+?) Power\.$/i, (m) => `${m[1]}이(가) 파워 ${m[2]}을(를) 얻습니다.`],
  [/^(player|ai) gains (\d+) XP\.$/i, (m) => `${side(m[1])} 경험치(XP) ${numObj(m[2])} 얻습니다.`],

  // ── playing cards ───────────────────────────────────────────────────────
  // `locLabel(to)` appends the destination, so these must precede the bare
  // "plays X." rule or the destination gets swallowed into the card name.
  [/^(player|ai) plays (.+?) to base\.$/i, (m) => `${side(m[1])} ${m[2]}을(를) 기지에 냅니다.`],
  [
    /^(player|ai) plays (.+?) to battlefield (\d+)\.$/i,
    (m) => `${side(m[1])} ${m[2]}을(를) 전장 ${numTo(m[3])} 냅니다.`,
  ],
  [
    /^(player|ai) plays (.+?) here\.$/i,
    (m) => `${side(m[1])} ${m[2]}을(를) 여기에 냅니다.`,
  ],
  [
    /^(player|ai) plays (.+?) from the trash \(Flow\)\.$/i,
    (m) => `${side(m[1])} 무덤에서 ${m[2]}을(를) 흐름으로 사용합니다.`,
  ],
  [
    /^(player|ai) plays (.+?) ignoring its Energy cost\.$/i,
    (m) => `${side(m[1])} 에너지 비용을 무시하고 ${m[2]}을(를) 냅니다.`,
  ],
  [/^(player|ai) plays (.+?)\.$/i, (m) => `${side(m[1])} ${m[2]}을(를) 냅니다.`],
  [/^(player|ai)'s (.+?) enters play\.$/i, (m) => `${poss(m[1])} ${m[2]}이(가) 등장합니다.`],
  [
    /^(player|ai)'s (.+?) enters play (.+)\.$/i,
    (m) => `${poss(m[1])} ${m[2]}이(가) ${m[3]} 상태로 등장합니다.`,
  ],
  // "<gear> equips <unit>." — both halves are card names, not sides.
  [/^(.+?) equips (.+?)\.$/i, (m) => `${m[1]}이(가) ${m[2]}에게 장착됩니다.`],
  [
    /^(player|ai) creates a (.+?) gear token\.$/i,
    (m) => `${side(m[1])} ${m[2]} 장비 토큰을 만듭니다.`,
  ],
  [
    /^(player|ai) creates a (.+?) token at base\.$/i,
    (m) => `${side(m[1])} 기지에 ${m[2]} 토큰을 만듭니다.`,
  ],

  // ── the stack ───────────────────────────────────────────────────────────
  [
    /^(player|ai)'s (.+?) ability goes on the stack\.$/i,
    (m) => `${poss(m[1])} ${m[2]} 능력이 대기열에 올라갑니다.`,
  ],
  [
    /^(player|ai)'s (.+?) goes on the stack\.$/i,
    (m) => `${poss(m[1])} ${m[2]}이(가) 대기열에 올라갑니다.`,
  ],
  [
    /^(player|ai)'s (.+?) ability resolves\.$/i,
    (m) => `${poss(m[1])} ${m[2]} 능력이 해결됩니다.`,
  ],
  [/^(player|ai)'s (.+?) resolves\.$/i, (m) => `${poss(m[1])} ${m[2]}이(가) 해결됩니다.`],
  [/^(.+?) is countered\.$/i, (m) => `${m[1]}이(가) 무효화됩니다.`],
  [
    /^The countered spell is no longer on the stack\.$/i,
    () => '무효화할 주문이 대기열에 없습니다.',
  ],
  [/^Resolve the stack first\.$/i, () => '먼저 대기열을 해결하세요.'],

  // ── triggers / abilities ────────────────────────────────────────────────
  [/^(.+?): (player|ai)'s ability triggers\.$/i, (m) => `${m[1]}: ${poss(m[2])} 능력이 발동합니다.`],
  [/^(.+?): ability triggers\.$/i, (m) => `${m[1]}: 능력이 발동합니다.`],
  [/^(.+?)'s ability has no effect\.$/i, (m) => `${m[1]}의 능력은 아무 효과가 없습니다.`],
  [/^(.+?) has no effect\.$/i, (m) => `${m[1]}은(는) 아무 효과가 없습니다.`],
  [/^(.+?): (.+?) can't be used now\.$/i, (m) => `${m[1]}: 지금은 ${m[2]}을(를) 사용할 수 없습니다.`],
  [/^(.+?) has no such ability\.$/i, (m) => `${m[1]}에게는 그런 능력이 없습니다.`],
  [/^Can't activate now\.$/i, () => '지금은 발동할 수 없습니다.'],
  [/^No such source\.$/i, () => '해당 원본을 찾을 수 없습니다.'],
  [/^Not yours\.$/i, () => '내 것이 아닙니다.'],

  // ── unit state ──────────────────────────────────────────────────────────
  [/^(.+?) takes (\d+) damage\.$/i, (m) => `${m[1]}이(가) 피해 ${numObj(m[2])} 받습니다.`],
  [/^(.+?) is destroyed\.$/i, (m) => `${m[1]}이(가) 파괴됩니다.`],
  [/^(.+?) is stunned\.$/i, (m) => `${m[1]}이(가) 기절합니다.`],
  [/^(.+?) is already stunned\.$/i, (m) => `${m[1]}은(는) 이미 기절해 있습니다.`],
  [/^(.+?) is exhausted\.$/i, (m) => `${m[1]}이(가) 소진됩니다.`],
  [/^(.+?) is Empowered\.$/i, (m) => `${m[1]}이(가) 강화됩니다.`],
  [/^(.+?) is not Empowered\.$/i, (m) => `${m[1]}은(는) 강화 상태가 아닙니다.`],
  [/^(.+?) is buffed \(\+1 Might\)\.$/i, (m) => `${m[1]}이(가) 강화됩니다 (위력 +1).`],
  [/^(.+?) already has a buff counter\.$/i, (m) => `${m[1]}에게는 이미 강화 카운터가 있습니다.`],
  [/^(.+?) heals (.+?)\.$/i, (m) => `${m[1]}이(가) ${m[2]}을(를) 치료합니다.`],
  [/^(.+?) gets ([+-]?\d+) might this turn\.$/i, (m) => `${m[1]}이(가) 이번 턴 위력 ${numObj(m[2])} 얻습니다.`],
  [
    /^(.+?) gets ([+-]?\d+) might permanently\.$/i,
    (m) => `${m[1]}이(가) 위력 ${numObj(m[2])} 영구히 얻습니다.`,
  ],
  [/^(.+?) gains (.+?) this turn\.$/i, (m) => `${m[1]}이(가) 이번 턴 ${m[2]}을(를) 얻습니다.`],
  [/^(.+?) is recalled to (player|ai)'s base\.$/i, (m) => `${m[1]}이(가) ${poss(m[2])} 기지로 회수됩니다.`],
  [/^(.+?) is returned to (player|ai)'s hand\.$/i, (m) => `${m[1]}이(가) ${poss(m[2])} 손패로 돌아갑니다.`],
  [/^(.+?) \(token\) ceases to exist\.$/i, (m) => `${m[1]} (토큰)이(가) 존재하지 않게 됩니다.`],
  [/^Temporary — (.+?) is removed\.$/i, (m) => `일시적 — ${m[1]}이(가) 제거됩니다.`],
  [/^(player|ai) readies (.+?) gear\.$/i, (m) => `${side(m[1])} 장비 ${m[2]}개를 준비 상태로 만듭니다.`],

  // ── movement / battlefields ─────────────────────────────────────────────
  [/^(player|ai) moves (.+?) to base\.$/i, (m) => `${side(m[1])} ${m[2]}을(를) 기지로 옮깁니다.`],
  [
    /^(player|ai) moves (.+?) to battlefield (\d+)\.$/i,
    (m) => `${side(m[1])} ${m[2]}을(를) 전장 ${numTo(m[3])} 옮깁니다.`,
  ],
  [/^(.+?) moves to base\.$/i, (m) => `${m[1]}이(가) 기지로 이동합니다.`],
  [/^(.+?) moves to battlefield (\d+)\.$/i, (m) => `${m[1]}이(가) 전장 ${numTo(m[2])} 이동합니다.`],
  [/^Can't move: (.+?)\.$/i, (m) => `이동할 수 없습니다: ${m[1]}.`],
  [/^Battlefield (\d+) is not contested\.$/i, (m) => `전장 ${numTopic(m[1])} 교전 중이 아닙니다.`],

  // ── scoring ─────────────────────────────────────────────────────────────
  [
    /^(player|ai) conquers battlefield (\d+): \+1 point\.$/i,
    (m) => `${side(m[1])} 전장 ${numObj(m[2])} 점령합니다: +1점.`,
  ],
  [
    /^(player|ai) conquers battlefield (\d+) \(already scored here this turn\)\.$/i,
    (m) => `${side(m[1])} 전장 ${numObj(m[2])} 점령합니다 (이번 턴 이미 득점함).`,
  ],
  [
    /^(player|ai) holds (\d+) battlefield\(s\): \+(\d+) point\(s\)\.$/i,
    (m) => `${side(m[1])} 전장 ${m[2]}개를 유지합니다: +${m[3]}점.`,
  ],
  [/^(player|ai) scores (\d+) point\(s\)\.$/i, (m) => `${side(m[1])} ${m[2]}점을 얻습니다.`],
  [
    /^Otterpus: (player|ai) draws instead of scoring an early point\.$/i,
    (m) => `Otterpus: ${side(m[1])} 초반 득점 대신 카드를 뽑습니다.`,
  ],
  [/^AI wins the game!$/i, () => 'AI가 승리했습니다!'],
  [/^(player|ai) wins the game!$/i, (m) => `${side(m[1])} 승리했습니다!`],

  // ── showdowns / combat ──────────────────────────────────────────────────
  [
    /^(player|ai) declares a showdown at battlefield (\d+)\.$/i,
    (m) => `${side(m[1])} 전장 ${m[2]}에서 결전을 선언합니다.`,
  ],
  [
    /^(player|ai) did not declare — battlefield (\d+) resolves\.$/i,
    (m) => `${side(m[1])} 선언하지 않아 전장 ${m[2]}이(가) 자동 해결됩니다.`,
  ],
  [
    /^No showdown at battlefield (\d+) — not contested\.$/i,
    (m) => `전장 ${m[1]}에는 결전이 없습니다 — 교전 중이 아닙니다.`,
  ],
  [/^Can't declare a showdown now\.$/i, () => '지금은 결전을 선언할 수 없습니다.'],
  [
    /^The showdown is inconclusive — (player|ai)'s units fall back to base\.$/i,
    (m) => `결전이 결판나지 않았습니다 — ${poss(m[1])} 유닛들이 기지로 후퇴합니다.`,
  ],
  [
    /^(player|ai) assigned (\d+) excess damage\.$/i,
    (m) => `${side(m[1])} 초과 피해 ${numObj(m[2])} 배분했습니다.`,
  ],
  [/^No damage to assign\.$/i, () => '배분할 피해가 없습니다.'],
  [/^That damage assignment isn't legal\.$/i, () => '그 피해 배분은 규칙에 맞지 않습니다.'],
  [
    /^Showdown result: (player|ai) destroyed all of (player|ai)'s units — (player|ai) (takes|holds) (.+)\.$/i,
    (m) =>
      `결전 결과: ${side(m[1])} ${poss(m[2])} 유닛을 모두 파괴했습니다 — ` +
      `${side(m[3])}가 ${m[5]}을(를) ${m[4] === 'takes' ? '점령' : '유지'}합니다.`,
  ],
  [
    /^Showdown result: both sides were wiped out — (.+?) is now open \(no one scores\)\.$/i,
    (m) => `결전 결과: 양쪽 모두 전멸했습니다 — ${m[1]}이(가) 비었습니다 (아무도 득점하지 않음).`,
  ],
  [
    /^Showdown result: neither side was cleared — (player|ai)'s units fall back to base\.$/i,
    (m) => `결전 결과: 어느 쪽도 전멸하지 않았습니다 — ${poss(m[1])} 유닛들이 기지로 후퇴합니다.`,
  ],

  // ── cards: draw / discard / trash / deck ────────────────────────────────
  [/^(player|ai) draws (\d+)\.$/i, (m) => `${side(m[1])} 카드 ${m[2]}장을 뽑습니다.`],
  [/^(player|ai) discards (.+?)\.$/i, (m) => `${side(m[1])} ${m[2]}을(를) 버립니다.`],
  [/^(player|ai) burns (\d+) card\(s\)\.$/i, (m) => `${side(m[1])} 카드 ${m[2]}장을 소각합니다.`],
  [/^(player|ai) has nothing to burn\.$/i, (m) => `${dative(m[1])} 소각할 카드가 없습니다.`],
  [
    /^(player|ai) recycles (\d+) card\(s\) from hand\.$/i,
    (m) => `${side(m[1])} 손패에서 카드 ${m[2]}장을 재활용합니다.`,
  ],
  [/^(player|ai) recycles it\.$/i, (m) => `${side(m[1])} 그 카드를 재활용합니다.`],
  [
    /^(player|ai) predicts (\d+), recycles (\d+)\.$/i,
    (m) => `${side(m[1])} 예지 ${numObj(m[2])} 하고 ${m[3]}장을 재활용합니다.`,
  ],
  [
    /^(player|ai) returns (.+?) from the trash to hand\.$/i,
    (m) => `${side(m[1])} 무덤에서 ${m[2]}을(를) 손패로 되돌립니다.`,
  ],
  [
    /^(player|ai) banishes (.+?) from (.+?) trash\.$/i,
    (m) => `${side(m[1])} ${m[3]} 무덤에서 ${m[2]}을(를) 추방합니다.`,
  ],
  [/^(player|ai) reveals (.+?) \((.+?)\)\.$/i, (m) => `${side(m[1])} ${m[2]}을(를) 공개합니다 (${m[3]}).`],
  [/^(player|ai)'s Main Deck is empty\.$/i, (m) => `${poss(m[1])} 메인 덱이 비었습니다.`],
  [
    /^(player|ai) has no cards to (look at|predict)\.$/i,
    (m) => `${dative(m[1])} ${m[2] === 'predict' ? '예지할' : '볼'} 카드가 없습니다.`,
  ],
  [
    /^(player|ai) has no spell in the trash to return\.$/i,
    (m) => `${poss(m[1])} 무덤에 되돌릴 주문이 없습니다.`,
  ],
  [/^(.+?) is not in your trash\.$/i, (m) => `${m[1]}은(는) 내 무덤에 없습니다.`],
  [/^Not enough cards in the trash\.$/i, () => '무덤에 카드가 부족합니다.'],
  [/^Not enough cards to discard\.$/i, () => '버릴 카드가 부족합니다.'],
  [/^No units in any trash to return\.$/i, () => '어느 무덤에도 되돌릴 유닛이 없습니다.'],
  [/^AI returns no units\.$/i, () => 'AI가 아무 유닛도 되돌리지 않습니다.'],
  [
    /^\(a token was removed from (player|ai)'s deck\)$/i,
    (m) => `(${poss(m[1])} 덱에서 토큰이 제거되었습니다)`,
  ],

  // ── costs / refusals ────────────────────────────────────────────────────
  [/^Can't play (.+?): not enough energy\/power\/runes\.$/i, (m) => `${m[1]}을(를) 낼 수 없습니다: 에너지/파워/룬이 부족합니다.`],
  [
    /^Can't play (.+?): not enough energy\/runes for the extra cost\.$/i,
    (m) => `${m[1]}을(를) 낼 수 없습니다: 추가 비용을 낼 에너지/룬이 부족합니다.`,
  ],
  [
    /^Can't play (.+?): nothing to discard for the additional cost\.$/i,
    (m) => `${m[1]}을(를) 낼 수 없습니다: 추가 비용으로 버릴 카드가 없습니다.`,
  ],
  [
    /^Can't play (.+?): only units can enter the board\.$/i,
    (m) => `${m[1]}을(를) 낼 수 없습니다: 유닛만 보드에 등장할 수 있습니다.`,
  ],
  [/^Can't play (.+?): invalid targets\.$/i, (m) => `${m[1]}을(를) 낼 수 없습니다: 대상이 올바르지 않습니다.`],
  [/^Can't play (.+?) there: (.+?)\.$/i, (m) => `${m[1]}을(를) 거기에 낼 수 없습니다: ${m[2]}.`],
  [/^Can't play (.+?): (.+?)\.$/i, (m) => `${m[1]}을(를) 낼 수 없습니다: ${m[2]}.`],
  [/^Can't Flow-cast (.+?) now\.$/i, (m) => `지금은 ${m[1]}을(를) 흐름으로 사용할 수 없습니다.`],
  [/^Invalid targets for (.+?)\.$/i, (m) => `${m[1]}의 대상이 올바르지 않습니다.`],
  [/^(.+?) has no Flow\.$/i, (m) => `${m[1]}에게는 흐름이 없습니다.`],
  [/^Not enough resources for Flow\.$/i, () => '흐름을 사용할 자원이 부족합니다.'],
  [/^Not enough resources\.$/i, () => '자원이 부족합니다.'],
  [/^Not enough Power for Deflect \(\+(\d+)\)\.$/i, (m) => `굴절 비용(+${m[1]})을 낼 파워가 부족합니다.`],
  [/^(player|ai) pays \+(\d+) Power \(Deflect\)\.$/i, (m) => `${side(m[1])} 굴절 비용으로 파워 ${numObj("+"+m[2])} 지불합니다.`],
  [
    /^(player|ai) pays the additional cost for (.+?)\.$/i,
    (m) => `${side(m[1])} ${m[2]}의 추가 비용을 지불합니다.`,
  ],
  [/^(player|ai) pays \[Repeat\] for (.+?)\.$/i, (m) => `${side(m[1])} ${m[2]}에 [Repeat] 비용을 지불합니다.`],
  [/^(player|ai) repeats\.$/i, (m) => `${side(m[1])} 효과를 한 번 더 실행합니다.`],
  [/^(.+?) can't pay (.+?) — skipped\.$/i, (m) => `${m[1]}이(가) ${m[2]}을(를) 지불할 수 없어 건너뜁니다.`],
  [/^Pick at least (\d+) for "(.+?)"\.$/i, (m) => `"${m[2]}"에는 최소 ${m[1]}개를 골라야 합니다.`],
  [
    /^(player|ai)'s next gear this turn ignores its Energy cost\.$/i,
    (m) => `${poss(m[1])} 이번 턴 다음 장비는 에너지 비용을 무시합니다.`,
  ],
  [/^No Shadow Clone to swap with\.$/i, () => '자리를 바꿀 Shadow Clone이 없습니다.'],

  // ── card scripts ────────────────────────────────────────────────────────
  [
    // Astral Heron and friends discount the next card by both pools at once.
    /^(.+?): your next card costs (\d+) energy and (\d+) runes less\.$/i,
    (m) => `${m[1]}: 다음에 내는 카드의 비용이 에너지 ${m[2]}, 룬 ${m[3]}만큼 줄어듭니다.`,
  ],
  [
    /^(.+?) and (.+?) swap places\.$/i,
    (m) => `${m[1]}과(와) ${m[2]}의 위치가 서로 바뀝니다.`,
  ],
  [
    // Zed phrases the same event the other way round; both reach the log.
    /^(.+?) swaps places with (.+?)\.$/i,
    (m) => `${m[1]}과(와) ${m[2]}의 위치가 서로 바뀝니다.`,
  ],
  [
    /^(player|ai) readies a (fury|calm|mind|body|order|chaos|colorless) rune\.$/i,
    (m) => `${side(m[1])} ${DOMAIN_KO[m[2].toLowerCase()]} 룬을 준비 상태로 되돌립니다.`,
  ],
]

/**
 * Translate one log line, or return null when no rule matches so the caller can
 * keep the English.
 */
export function logLineKo(line: string): string | null {
  const s = line.trim()
  for (const [re, fn] of RULES) {
    const m = s.match(re)
    if (m) return fn(m)
  }
  return null
}

/**
 * `ShowdownReport.summary` is the same sentence the "Showdown result: …" log
 * line wraps, so it reuses those rules and drops the prefix.
 */
export function showdownSummaryKo(summary: string): string | null {
  const ko = logLineKo(`Showdown result: ${summary}`)
  return ko ? ko.replace(/^결전 결과:\s*/, '') : null
}

/** Coverage helper for the test. */
export function logCoverage(lines: string[]): { total: number; translated: number } {
  let translated = 0
  for (const l of lines) if (logLineKo(l)) translated++
  return { total: lines.length, translated }
}

/**
 * Is this log line a turn break rather than commentary?
 * The engine writes them as `— <side>'s turn —`; the log renders them as a
 * section divider so a turn is scannable at a glance.
 */
export function isTurnMarker(text: string): boolean {
  return /^—\s*.+'s turn\s*—$/.test(text.trim())
}

/**
 * How loud a log line should be. The log used to be one flat grey stream, so
 * a conquest and a rune channel looked identical and the eye had nothing to
 * catch on. Three tiers: what changed the game, what a player chose, and
 * bookkeeping.
 */
export type LogWeight = 'major' | 'normal' | 'minor'

export function logWeight(text: string): LogWeight {
  if (
    /showdown|conquer|destroy|is destroyed|wins the game|point|excess|killed|banish/i.test(text)
  ) {
    return 'major'
  }
  if (/channels a rune|draws|passes|recycles a rune|ready|no draw|keeps their hand/i.test(text)) {
    return 'minor'
  }
  return 'normal'
}
