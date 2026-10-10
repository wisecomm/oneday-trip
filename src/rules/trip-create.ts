import { optimizeOrder } from '@/lib/geo'
import { pickByRating, type CategoryQuota } from '@/lib/recommend'
import { formatMonthDay, kstDate } from '@/lib/trip-date'
import type { Companion, Place, TripDraft } from '@/lib/types'

/*
 * 새 여행 만들기 규칙 — 플로챠트/여행-만들기.md 의 규칙 표.
 *
 * 화면(TripCreatePage · TripRulesPage)에는 React 상태 · 이펙트 · 마크업만 두고, 무엇을 기본값으로
 * 할지 · 어떻게 고를지는 여기서 정한다. [TC-…] 는 문서 규칙 표의 ID 칸과 같다 — 바꾸면 문서 ·
 * 이 파일 · trip-create.test.ts 를 같은 커밋에서 고친다.
 */

/**
 * [TC-DATE] 기본 여행 날짜 — 한국 날짜로 오늘에서 이만큼 뒤. 0 = 만드는 날(10/10 — 예전엔 일주일 뒤 +7).
 */
export const DEFAULT_DAY_OFFSET = 0

/** [TC-DATE] 기본 여행 날짜 'YYYY-MM-DD' (한국 날짜) */
export const defaultTripDate = (now?: Date) => kstDate(DEFAULT_DAY_OFFSET, now)

/** [TC-TIME] 하루 활동 시간 — 화면에서 묻지 않고 이 값으로 저장, 타임라인에서 바꾼다 */
export const DEFAULT_START_TIME = '09:00'
export const DEFAULT_END_TIME = '20:00'

/** [TC-COMPANION] 동행인 기본값 */
export const DEFAULT_COMPANIONS: readonly Companion[] = ['friends']

/** [TC-TITLE-EDIT] 제목 최대 길이 */
export const TITLE_MAX = 30

/**
 * [TC-TITLE] 자동 제목 — '(시군구 이름 또는 시/도 이름) 당일치기 MM-DD'.
 * 시군구를 '전체'로 골랐을 때는 특정 구 이름이 없으므로 시/도 이름만 쓴다.
 */
export function defaultTripTitle(groupName: string, regionName: string | null, tripDate: string): string {
  return `${regionName ?? groupName} 당일치기 ${formatMonthDay(tripDate)}`
}

/** [TC-TITLE-DUP] 내 기존 여행 제목과 겹치면 '-01', '-02' … 순번을 붙인다 */
export function dedupeTitle(base: string, existing: readonly string[]): string {
  if (!existing.includes(base)) return base
  let n = 1
  while (existing.includes(`${base}-${String(n).padStart(2, '0')}`)) n += 1
  return `${base}-${String(n).padStart(2, '0')}`
}

/** [TC-TITLE] + [TC-TITLE-DUP] 지금 목적지 · 날짜로 만든 자동 제목(중복 순번까지) */
export function autoTripTitle(
  groupName: string,
  regionName: string | null,
  tripDate: string,
  existing: readonly string[],
): string {
  return dedupeTitle(defaultTripTitle(groupName, regionName, tripDate), existing)
}

/**
 * [TC-TITLE-EDIT] 사용자가 고친 제목인가 — 고친 제목은 목적지 · 날짜를 바꿔도 덮지 않는다.
 * 칸을 비우면(공백만 남아도) 다시 자동 제목으로 돌아간다.
 */
export const isTitleEdited = (input: string) => input.trim().length > 0

/** [TC-CHECK] ① 일정 → ② 규칙으로 넘어가기 전 검사 — 문제가 있으면 화면에 보일 문구, 없으면 null */
export function checkStepOne(input: { title: string; areaCode: number | null }): string | null {
  if (input.title.trim().length === 0) return '여행 제목을 입력해 주세요.'
  if (input.areaCode === null) return '목적지를 골라 주세요.'
  return null
}

/**
 * [TC-DRAFT] ② 규칙 화면으로 넘기는 초안 — 저장은 ②에서 한 번(①은 저장하지 않는다).
 * 시군구 null 은 '시/도 전체'. 제목은 앞뒤 공백을 지운다.
 */
export function buildDraft(input: {
  title: string
  areaCode: number
  sigunguCode: number | null
  tripDate: string
  companions: readonly Companion[]
}): TripDraft {
  return {
    title: input.title.trim(),
    tour_area_code: input.areaCode,
    tour_sigungu_code: input.sigunguCode,
    trip_date: input.tripDate,
    start_time: DEFAULT_START_TIME,
    end_time: DEFAULT_END_TIME,
    companions: [...input.companions],
  }
}

/** [TC-SEED] 저장 직후 자동으로 담는 구성 — 밥집 2 · 카페 1 · 명소 4, 총 7곳 */
export const AUTO_ADD_QUOTA: readonly CategoryQuota[] = [
  { category: 'babzip', count: 2 },
  { category: 'cafe', count: 1 },
  { category: 'spot', count: 4 },
]

/**
 * [TC-SEED] + [TC-SEED-ORDER] 자동 담기 — 그 지역 장소 중 무엇을 어떤 순서로 담을지.
 *
 * 고르기는 별점만(pickByRating — 종류마다 별점 높은 순, 리뷰 없는 곳끼리는 무작위, 모자라면 남은
 * 곳에서 채움). 순서는 별점 순위가 아니라 최단 동선 — 첫 장소(밥집 1위)를 출발점으로
 * optimizeOrder. 돌려준 배열 순서 그대로 하나씩 담으면 된다(화면이 tripItems.add 를 차례로).
 */
export function planAutoAdd(list: readonly Place[]): Place[] {
  if (list.length === 0) return []
  const picked = pickByRating([...list], [...AUTO_ADD_QUOTA])
  return optimizeOrder(picked.map((p) => ({ lat: p.lat, lng: p.lng }))).map((i) => picked[i])
}
