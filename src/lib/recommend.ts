import type { Place, PlaceCategory } from './types'

/**
 * MAP-04-02 추천 — **방문자 별점만** 본다(10/10).
 *
 * 예전에는 시간대 · 날씨(open-meteo) · 프로필 취향 태그를 더해 점수를 매겼다. 시각은 화면을 연
 * 순간이라 여행 날짜와 상관없었고, 날씨 · 시간대 가산은 종류 단위라 같은 종류 안에서는 순서를
 * 바꾸지 못했다. 그래서 모두 없애고 별점(아래 ratingScore)만 남겼다. 리뷰가 거의 없는 지금은
 * 대부분 동점이라 동점 순서(씨앗 · 무작위)가 섞어 준다.
 *
 * 운영의 추천 장소는 DB 함수 recommend_places(`20261017000000`)가 같은 규칙으로 고른다 —
 * 규칙을 바꾸면 두 곳을 함께 바꾸고 플로챠트/추천.md 도 고친다.
 */

/**
 * 방문자 별점을 점수로 바꿀 때의 기준 (플로챠트/홈.md ❶ 의 rating_avg).
 *
 * 리뷰가 적은 장소는 평균을 PRIOR_MEAN 쪽으로 당긴다(베이지안 평균) — 한 사람이
 * 준 5점 하나로 순위 맨 위에 서지 못하게. PRIOR_WEIGHT 는 "가상의 보통 리뷰
 * 몇 건을 미리 깔아 두는가"다.
 *
 *   리뷰 1건 5점  → 보정 3.7 → +1.3
 *   리뷰 3건 5점  → 보정 4.2 → +2.4
 *   리뷰 10건 5점 → 보정 4.7 → +3.3
 *   1점 쪽은 같은 크기로 깎는다.
 */
const RATING_PRIOR_MEAN = 3
const RATING_PRIOR_WEIGHT = 2
const RATING_SCORE_PER_STAR = 2

export function ratingScore(place: Place): number {
  if (place.rating_avg == null || place.rating_count <= 0) return 0
  const n = place.rating_count
  const adjusted =
    (place.rating_avg * n + RATING_PRIOR_MEAN * RATING_PRIOR_WEIGHT) / (n + RATING_PRIOR_WEIGHT)
  return (adjusted - RATING_PRIOR_MEAN) * RATING_SCORE_PER_STAR
}

/** 점수를 매기고 순서를 정한 후보 — 동점 순서(tie)를 지녀 쪽을 나눠 꺼내도 순서가 흔들리지 않는다 */
export interface Ranked {
  place: Place
  score: number
  tie: number
}

/**
 * 동점 순서 — 씨앗(seed)과 장소 id 로 정해지는 0~1 값(FNV-1a). 같은 씨앗이면 늘 같은 순서라
 * '더 보기'로 쪽을 넘겨도 순서가 흔들리지 않고, 화면을 다시 열면 씨앗이 바뀌어 섞인다.
 * 데모 모드용 — 운영은 DB 함수가 md5(seed || id) 로 같은 일을 한다.
 */
export function tieHash(seed: string, id: string): number {
  let h = 0x811c9dc5
  for (const ch of seed + id) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h / 2 ** 32
}

/**
 * 후보 전부를 별점 점수 높은 순으로. 동점은 tieOf(장소 id) 순 — 없으면 무작위
 * (리뷰가 거의 없는 지금은 대부분 동점이라, 그대로 두면 가나다순 앞쪽만 뽑힌다).
 */
export function rankAll(list: Place[], tieOf?: (id: string) => number): Ranked[] {
  return list
    .map((place) => ({ place, score: ratingScore(place), tie: tieOf ? tieOf(place.id) : Math.random() }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
}

/**
 * 순서를 정한 후보(rankAll)에서 한 쪽(limit 곳)을 꺼낸다 — rest 는 남은 후보(순서 그대로),
 * '더 보기'가 다음 쪽을 여기서 꺼낸다.
 *
 * 한 종류가 쪽을 다 채우지 않게 — 종류마다 limit 의 절반(10 이면 5곳)까지만 먼저 넣고,
 * 다른 종류가 모자라 자리가 남으면 점수순으로 마저 채운다. 쪽마다 같은 규칙. (예전엔 시간대 ·
 * 날씨 가산 때문에 필요했고, 별점만 남은 지금은 별점 높은 곳이 한 종류에 몰려도 섞이게 둔다.)
 */
export function takePage(ranked: Ranked[], limit: number): { page: Ranked[]; rest: Ranked[] } {
  const cap = Math.ceil(limit / 2)
  const perCategory = new Map<PlaceCategory, number>()
  const picked = new Set<Ranked>()
  const skipped: Ranked[] = []
  for (const s of ranked) {
    if (picked.size >= limit) break
    const n = perCategory.get(s.place.category) ?? 0
    if (n < cap) {
      picked.add(s)
      perCategory.set(s.place.category, n + 1)
    } else {
      skipped.push(s)
    }
  }
  for (const s of skipped) {
    if (picked.size >= limit) break
    picked.add(s)
  }
  const page = [...picked].sort((a, b) => b.score - a.score || a.tie - b.tie)
  return { page, rest: ranked.filter((s) => !picked.has(s)) }
}

export interface CategoryQuota {
  category: PlaceCategory
  count: number
}

/**
 * 여행 생성 직후 자동 담기(TripRulesPage) — 종류마다 quota 만큼 별점 점수(ratingScore — 리뷰가 적으면 3점 쪽으로 당긴 평균) 높은 순으로,
 * 동점(리뷰 없는 곳 등)은 무작위. 한 종류가 모자라면 남은 곳에서 같은 순서로 채운다.
 */
export function pickByRating(list: Place[], quota: CategoryQuota[]): Place[] {
  const ranked = rankAll(list).map((r) => r.place)
  const picked: Place[] = []
  const pickedIds = new Set<string>()
  for (const { category, count } of quota) {
    for (const place of ranked.filter((p) => p.category === category).slice(0, count)) {
      picked.push(place)
      pickedIds.add(place.id)
    }
  }
  const target = quota.reduce((sum, q) => sum + q.count, 0)
  for (const place of ranked) {
    if (picked.length >= target) break
    if (!pickedIds.has(place.id)) picked.push(place)
  }
  return picked
}
