/**
 * Korean particle and conjugation helpers, shared by the card-text and
 * activity-log translators.
 *
 * Korean object/subject particles depend on whether the preceding syllable ends
 * in a consonant (받침). That is decidable for Hangul and for digits (which have
 * a fixed reading), but **not** for the English card names this app displays:
 * "Cleave" transliterates to 클리브 (no 받침 → 를) while "Stacked Deck" ends in
 * 덱 (받침 → 을), and nothing in the Latin spelling reliably tells them apart.
 * For those we emit the `을(를)` form, which is the standard convention for
 * foreign proper nouns in Korean game text.
 */

/** True when a word's last syllable ends in a consonant. */
export function hasFinalConsonant(word: string): boolean {
  const ch = word.trim().replace(/[)\]}"'’,.]+$/, '').slice(-1)
  const code = ch.charCodeAt(0)
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return true // non-Hangul: assume consonant
  return (code - 0xac00) % 28 !== 0
}

/** Pick between the 받침 and non-받침 form of a particle. */
export function particle(noun: string, withBatchim: string, withoutBatchim: string): string {
  return hasFinalConsonant(noun) ? withBatchim : withoutBatchim
}

/** Object particle 을/를 after a Korean noun. */
export const obj = (n: string) => n + particle(n, '을', '를')

/** Directional particle 으로/로. */
export const to = (n: string) => n + particle(n, '으로', '로')

/**
 * 받침 of a digit depends on how it is read aloud: 1 일 and 8 팔 end in a
 * consonant, 2 이 and 4 사 do not. So "+2" takes 를 but "+1" takes 을.
 */
const DIGIT_BATCHIM: Record<string, boolean> = {
  '0': true, // 영
  '1': true, // 일
  '2': false, // 이
  '3': true, // 삼
  '4': false, // 사
  '5': false, // 오
  '6': true, // 육
  '7': true, // 칠
  '8': true, // 팔
  '9': false, // 구
}

/** Object particle after a number like "+2" or "3". */
export function numObj(n: string): string {
  const last = n.trim().slice(-1)
  return n + ((DIGIT_BATCHIM[last] ?? true) ? '을' : '를')
}

/** Subject particle after a number. */
export function numSubj(n: string): string {
  const last = n.trim().slice(-1)
  return n + ((DIGIT_BATCHIM[last] ?? true) ? '이' : '가')
}

/** Directional particle after a number — "전장 1로" / "전장 2로". */
export function numTo(n: string): string {
  const last = n.trim().slice(-1)
  return n + ((DIGIT_BATCHIM[last] ?? true) ? '으로' : '로')
}

/** Topic particle 은/는 after a number. */
export function numTopic(n: string): string {
  const last = n.trim().slice(-1)
  return n + ((DIGIT_BATCHIM[last] ?? true) ? '은' : '는')
}

/**
 * Object / subject particle after an English card name — ambiguous, so both
 * forms are shown. See the module comment.
 */
export const foreignObj = (n: string) => `${n}을(를)`
export const foreignSubj = (n: string) => `${n}이(가)`
