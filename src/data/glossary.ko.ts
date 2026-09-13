import { GLOSSARY, type GlossaryEntry, type GlossaryKey } from './glossary'

/**
 * Korean glossary, keyed to `GLOSSARY` in `glossary.ts` — the `Record<GlossaryKey, …>`
 * annotation makes a missing entry a compile error.
 *
 * `term` is a Korean *gloss*, not a replacement: the UI keeps showing the English
 * keyword (that is what is printed on the card and on the card art in this app)
 * and puts this beside it, so a Korean reader can map one to the other.
 *
 * Shared vocabulary: 위력 Might · 에너지 energy · 파워 Power · 도메인 domain ·
 * 유닛 unit · 전장 battlefield · 무덤 trash · 소진 exhausted · 준비 ready ·
 * 점령 conquer · 유지 hold · 결전 showdown · 회수 recall · 추방 banish ·
 * 치명 피해 lethal damage · 조종자 controller · 지속물 permanent · 장비 gear.
 */
export const GLOSSARY_KO: Record<GlossaryKey, { term: string; text: string }> = {
  // ── Keywords ────────────────────────────────────────────────────────────
  accelerate: {
    term: '가속',
    text: '이 유닛을 낼 때 선택적으로 지불하는 추가 비용입니다. 에너지 1과 파워 1을 지불하면 소진 상태가 아니라 준비 상태로 등장합니다. 이때 파워는 그 유닛의 도메인 중 하나와 일치해야 합니다(도메인이 없으면 아무 도메인이나 가능).',
  },
  action: {
    term: '행동',
    text: '그 자체로는 효과가 없고 사용 시점만 넓혀 줍니다. 이 카드는 결전 중에, 그리고 누구의 턴에서든 사용하거나 발동할 수 있습니다.',
  },
  ambush: {
    term: '매복',
    text: '내가 유닛을 조종하고 있는 전장에 직접 낼 수 있으며, 그렇게 내는 동안에는 반응 키워드를 가집니다.',
  },
  assault: {
    term: '강습 X',
    text: '내가 공격자일 때 위력 +X를 얻습니다. 여러 개가 있으면 모두 더해집니다.',
  },
  backline: {
    term: '후방',
    text: '같은 조종자의 유닛 중 후방이 없는 유닛에게 모두 치명 피해가 배분된 뒤에야 나에게 피해를 배분할 수 있습니다.',
  },
  deathknell: {
    term: '죽음의 종소리',
    text: '이 지속물이 파괴되어 무덤으로 갈 때 발동합니다. 죽음이 다른 것으로 대체되면(예: 회수) 발동이 해결되지 않고 사라집니다.',
  },
  deflect: {
    term: '굴절 X',
    text: '상대가 주문이나 능력으로 나를 지정할 때마다 아무 도메인의 파워를 X만큼 더 지불해야 합니다. 여러 개가 있으면 모두 더해집니다.',
  },
  empower: {
    term: '강화하기',
    text: '발동형 능력입니다. 비용을 지불해 이 지속물이나 레전드에게 "강화됨" 상태를 부여합니다. 이미 강화된 상태에서는 사용할 수 없습니다.',
  },
  empowered: {
    term: '강화됨',
    text: '내가 "강화됨" 상태인 동안 뒤에 적힌 능력을 얻습니다.',
  },
  equip: {
    term: '장착',
    text: 'Equipment 유형 장비의 발동형 능력입니다. 비용을 지불해 내가 조종하는 유닛에 부착합니다. 선택한 유닛은 대상이 되며 "장착됨" 상태가 됩니다.',
  },
  flow: {
    term: '흐름',
    text: '이 주문을 무덤에서 흐름 비용으로 사용한 뒤 추방할 수 있습니다. 기본 비용을 대체할 뿐, 사용할 수 있는 시점은 바뀌지 않습니다.',
  },
  ganking: {
    term: '갱킹',
    text: '일반 이동으로 한 전장에서 다른 전장으로 이동할 수 있습니다. 허용만 추가할 뿐, 추가 이동이나 추가 비용은 없습니다.',
  },
  hidden: {
    term: '은신',
    text: '내 턴의 열린 상태에서 에너지 1을 지불해, 내가 조종하는 전장에 이 카드를 뒷면으로 숨길 수 있습니다(전장당 한 장). 다음 턴부터 반응 키워드를 얻고 기본 비용을 무시하고 사용할 수 있지만, 대상과 배치는 그 전장으로 제한됩니다.',
  },
  hunt: {
    term: '사냥 X',
    text: '내가 점령하거나 유지할 때 내 조종자가 경험치(XP) X를 얻습니다. 여러 개가 있으면 모두 더해집니다.',
  },
  legion: {
    term: '군단',
    text: '이번 턴에 다른 메인 덱 카드를 낸 적이 있다면 이 카드는 뒤에 적힌 능력을 얻습니다. 카드 한 장만 내도 내 모든 군단 능력이 함께 켜집니다.',
  },
  level: {
    term: '레벨 N',
    text: '내 경험치(XP)가 N 이상인 동안 이 카드는 뒤에 적힌 능력을 얻습니다. 계속 다시 확인하므로 XP가 N 밑으로 떨어지는 순간 꺼지고, 조종자가 바뀌면 새 조종자의 XP로 다시 확인합니다.',
  },
  'quick-draw': {
    term: '속사',
    text: '이 장비는 반응 키워드를 가지며, 낼 때 내가 조종하는 유닛에 바로 부착됩니다.',
  },
  reaction: {
    term: '반응',
    text: '사용 시점만 넓혀 줍니다. 행동이 허용하는 모든 것에 더해, 닫힌 상태에서도 누구의 턴에서든 사용하거나 발동할 수 있습니다.',
  },
  repeat: {
    term: '반복',
    text: '이 주문이나 능력을 사용할 때 선택적으로 지불하는 추가 비용입니다. 지불하면 해결할 때 지시를 한 번 더 수행합니다. 각 수행마다 선택을 다르게 할 수 있으며, 카드를 낸 횟수는 여전히 한 번입니다.',
  },
  shield: {
    term: '방벽 X',
    text: '내가 방어자일 때 위력 +X를 얻습니다. 여러 개가 있으면 모두 더해집니다.',
  },
  tank: {
    term: '방패병',
    text: '같은 조종자의 유닛 중 방패병이 없는 유닛보다 먼저 나에게 치명 피해를 배분해야 합니다.',
  },
  temporary: {
    term: '일시적',
    text: '조종자의 시작 페이즈가 시작될 때, 점수 획득 전에 이 카드를 파괴합니다.',
  },
  unique: {
    term: '고유',
    text: '게임 중 효과는 없고 덱 구성 제약입니다. 이 이름의 카드는 덱에 한 장만 넣을 수 있습니다.',
  },
  vision: {
    term: '예지력',
    text: '이 카드를 낼 때 예지를 합니다. 여러 개가 있으면 각각 따로 발동합니다.',
  },
  weaponmaster: {
    term: '무기의 달인',
    text: '나를 낼 때, 내가 조종하는 Equipment 하나를 골라 그 장착 비용을 에너지 1만큼 줄여 지불하고 나에게 부착할 수 있습니다. 장착 능력의 평소 사용 시점 제한은 무시합니다.',
  },

  // ── Game actions ────────────────────────────────────────────────────────
  add: {
    term: '추가',
    text: '적힌 자원을 내 룬 풀에 넣습니다. 추가 능력은 우선권을 넘기지 않고 확정 즉시 해결되며, 반응을 가진 추가 능력은 비용을 지불하는 도중에도 발동할 수 있습니다.',
  },
  buff: {
    term: '강화',
    text: '유닛에 강화 카운터를 올립니다. 이미 강화 카운터가 있는 유닛은 두 번째를 받지 않으며, "이렇게 강화되면"을 조건으로 하는 효과도 발동하지 않습니다.',
  },
  burn: {
    term: '소각 X',
    text: '지정된 메인 덱의 맨 위 카드 X장을 그 주인의 무덤에 넣습니다. 가능한 만큼 최대로 소각해야 합니다.',
  },
  mighty: {
    term: '강대함',
    text: '유닛의 위력이 5 이상인 동안 그 유닛은 강대합니다(일시적인 증가도 포함). 무덤에 있는 유닛은 인쇄된 위력이 5 이상이면 강대한 것으로 봅니다.',
  },
  predict: {
    term: '예지 X',
    text: '내 메인 덱 맨 위 카드를 보고 재활용할지 정합니다. 예지 X는 X장을 보고 원하는 만큼 재활용한 뒤, 나머지를 원하는 순서로 맨 위에 되돌립니다.',
  },
  stun: {
    term: '기절',
    text: '기절한 유닛은 전투 피해 단계에서 위력을 전혀 보태지 않지만, 파괴하려면 여전히 온전한 위력만큼의 피해를 주어야 합니다. 턴 종료 정리 단계에 풀리며, 이미 기절한 유닛은 다시 기절시킬 수 없습니다.',
  },

  // ── Plain rules terms ───────────────────────────────────────────────────
  token: {
    term: '토큰',
    text: '효과가 보드 위에 만들어 내는 게임 개체입니다. 덱에 들어가지도, 뽑히지도 않습니다. 토큰이 보드나 체인이 아닌 다른 영역으로 가게 되면(파괴·되돌리기·버리기·재활용) 그 대신 존재하지 않게 됩니다.',
  },
  showdown: {
    term: '결전',
    text: '교전 중인 전장에서 벌어지는 전투입니다. 양쪽이 위력을 합산해 그만큼의 피해를 상대 유닛들에게 주고, 치명 피해를 받은 유닛은 파괴됩니다. 방패병에게 먼저, 후방에게 마지막에 치명 피해를 배분해야 합니다.',
  },
  conquer: {
    term: '점령',
    text: '아직 내 것이 아니던 전장의 지배권을 가져오는 것입니다(결전에서 이기거나, 저항 없이 이동해 들어가서). 1점을 얻고(전장당 턴당 한 번), 그것으로 게임이 끝나지 않는다면 카드를 한 장 뽑습니다.',
  },
  hold: {
    term: '유지',
    text: '내 턴이 시작될 때 전장을 지배하고 있는 것입니다. 각성 단계에 그런 전장 하나당 1점을 얻습니다(전장당 턴당 한 번).',
  },
  recall: {
    term: '회수',
    text: '유닛을 주인의 기지로 되돌리며, 모든 피해와 카운터를 제거합니다. 회수된 토큰은 존재하지 않게 됩니다. 회수는 죽음을 대체하므로 죽음의 종소리가 발동하지 않습니다.',
  },
  banish: {
    term: '추방',
    text: '카드를 무덤이 아니라 게임에서 완전히 제외합니다. 흐름으로 사용한 주문은 해결 후 스스로를 추방합니다.',
  },
  'excess damage': {
    term: '초과 피해',
    text: '배분된 유닛들을 파괴하는 데 필요한 양을 넘어선 결전 피해입니다. 점령하는 쪽이 그 초과분을 "배분"하며, 일부 효과는 그 양을 참조합니다.',
  },
}

/**
 * Keyed by entry *identity* rather than by term text — `lookupKeyword`,
 * `lookupPlain` and `ALL_GLOSSARY` all hand back the very objects in `GLOSSARY`,
 * so this can never drift the way a term→key regex would.
 */
const BY_ENTRY = new Map<GlossaryEntry, { term: string; text: string }>(
  (Object.keys(GLOSSARY) as GlossaryKey[]).map((k) => [GLOSSARY[k], GLOSSARY_KO[k]]),
)

/** The Korean gloss for a glossary entry, or `undefined` if there isn't one. */
export function koFor(entry: GlossaryEntry): { term: string; text: string } | undefined {
  return BY_ENTRY.get(entry)
}

/** `:rb_*:` symbol hover text, keyed by the English string `lookupSymbol` returns. */
export const SYMBOL_KO: Record<string, string> = {
  'Exhaust this (turn it sideways) as a cost.': '비용으로 이 카드를 소진합니다(옆으로 눕힙니다).',
  'Might — a unit’s combat strength and health.': '위력 — 유닛의 전투력이자 체력입니다.',
  '1 Power of any domain': '아무 도메인의 파워 1',
}

/** `${n} energy` / `1 ${Domain} Power`, which are generated rather than fixed. */
export function symbolTextKo(text: string): string | undefined {
  if (SYMBOL_KO[text]) return SYMBOL_KO[text]
  const energy = text.match(/^(\d+) energy$/)
  if (energy) return `에너지 ${energy[1]}`
  const power = text.match(/^1 (\w+) Power$/)
  if (power) return `${power[1]} 파워 1`
  return undefined
}
