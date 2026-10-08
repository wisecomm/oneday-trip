/**
 * 도메인 타입 — supabase/schema.sql 의 테이블 정의와 1:1로 대응한다.
 */

export type PlaceCategory = 'babzip' | 'cafe' | 'sulzip' | 'spot'

/** 이동 수단 (TRIP-02-02: 주 이동수단 라디오버튼) */
export type Transport = 'walk' | 'transit' | 'car'

/** 동행인 유형 (TRIP-02-01) */
export type Companion = 'solo' | 'couple' | 'friends' | 'family'

/**
 * 목적지 상위 지역(시/도).
 *
 * 키는 이름이 아니라 TourAPI areaCode 다. 이름을 키로 쓰면 '강서구'가 서울·부산에
 * 둘 다 있어 접두어를 붙여야 하고, 행정구역 개칭이 FK 연쇄가 된다.
 */
export interface RegionGroup {
  /** TourAPI areaCode. 관광공사 자체 코드이지 행정표준코드가 아니다 */
  tour_area_code: number
  name: string
  lat: number
  lng: number
  sort_order: number
}

/**
 * 목적지 하위 지역(시군구).
 *
 * sigungu_code 는 area_code 안에서만 유일하다 — 서울의 1과 부산의 1은 다른 구다.
 * 그래서 항상 쌍으로 다룬다. 이름은 접두어 없이 '성동구' 그대로다.
 */
export interface Region {
  tour_area_code: number
  tour_sigungu_code: number
  name: string
  /** 행정표준코드(법정동). 다른 데이터 소스와 맞추는 열쇠 */
  ldong_cd: string | null
  lat: number
  lng: number
  sort_order: number
}

/** 미판정 센티넬. 이 코드를 가진 지역·장소는 사용자에게 보이지 않는다 */
export const NO_REGION_CODE = -1

/** 장소의 지역을 어느 순위로 판정했는지 */
export type RegionSource = 'tour' | 'addr' | 'geo' | 'manual' | 'unresolved'

/** 연동(TourAPI 배치)이 넣은 행인지, 사람이 등록한 행인지 */
export type PlaceSource = 'tour' | 'manual'

/** 수동 등록 장소의 id 접두사. TourAPI contentid 는 숫자뿐이라 겹치지 않는다 */
export const MANUAL_PLACE_PREFIX = 'm-'

/** 목적지 표시용 문구 — 구를 고르지 않았으면 '서울 전체' */
export function regionLabel(groupName: string, regionName: string | null): string {
  return regionName ? `${groupName} ${regionName}` : `${groupName} 전체`
}

/** 관리자 임명은 화면이 아니라 SQL 로 한다 — 임명 화면 자체가 공격면이다 */
export type UserRole = 'user' | 'admin'

export interface Profile {
  id: string
  nickname: string
  taste_tags: string[]
  role: UserRole
  created_at: string
}

export interface Trip {
  id: string
  user_id: string
  title: string
  tour_area_code: number
  /** null 이면 '시/도 전체'. 사용자가 고른 값이지 '모름'이 아니다 */
  tour_sigungu_code: number | null
  /** 조회 시 regions/region_groups 를 조인해 채운다 — 화면은 이 이름만 쓴다 */
  group_name: string
  region_name: string | null
  /** 당일치기 서비스이므로 여행은 하루 단위다 */
  trip_date: string
  /** 하루 동선의 시작·종료 시각. 'HH:MM' 형식 (기본 09:00~20:00) */
  start_time: string
  end_time: string
  companions: Companion[]
  transport: Transport
  /**
   * 담아 온 플랜. 직접 만든 여행이면 null 이다.
   *
   * 출처 표시에도 쓰지만 더 중요한 건 '담은 사람만 평가' 판정이다 — 이
   * 값이 없으면 누가 담았는지 알 수 없어 담지도 않은 사람의 별점을 막을
   * 방법이 없다. 플랜이 지워지면 null 이 되고 여행은 그대로 남는다.
   */
  source_plan_id: string | null
  /**
   * 이 여행을 공유해 만든 추천 코스. 공유하지 않았으면 null 이다.
   *
   * 있으면 타임라인이 '추천 코스 공유' 버튼 대신 '공유 완료'를 보여 준다.
   * 같은 여행을 두 번 공유해 똑같은 코스가 둘 생기는 것도 이걸로 막는다.
   *
   * 연결을 이 쪽(비공개 여행)에 두는 이유: 반대 방향(공개 코스 → 여행)은
   * 남의 비공개 여행 id 를 누구나 읽는 행에 싣는 것이라 뺐다 (Q23).
   * 코스가 지워지면 null 이 된다.
   */
  published_plan_id: string | null
  created_at: string
}

export interface Place {
  id: string
  name: string
  category: PlaceCategory
  tour_area_code: number
  /** 모르면 NO_REGION_CODE(-1). null 을 쓰지 않는다 */
  tour_sigungu_code: number
  /** 조회 시 조인해 채운다 — 화면과 공유 캡션은 코드가 아니라 이 이름을 쓴다 */
  group_name: string
  region_name: string
  address: string
  lat: number
  lng: number
  image_url: string | null
  tags: string[]
  /** TourAPI 상세를 아직 받지 못했으면 빈 문자열 — 화면에서 그 영역을 숨긴다 */
  summary: string
  open_hours: string
  phone: string | null
  /** TourAPI 목록의 modifiedtime. 재수집이 바뀐 것만 다시 받는 근거 */
  source_modified_at: string | null
  region_source: RegionSource
  region_note: string | null
  /**
   * 이 장소가 어디서 왔는가. `region_source`('지역을 어떻게 판정했는가')와는
   * 다른 축이다 — 관리자가 TourAPI 장소의 구만 고치면 `region_source` 는
   * 'manual' 이 되지만 `source` 는 'tour' 그대로다.
   */
  source: PlaceSource
  /** 수동 등록 행의 등록자. 연동 행은 null */
  created_by: string | null
  /**
   * 사용자 리뷰 별점의 평균 — 사람당 한 표(같은 장소를 여러 번 리뷰했으면 가장
   * 최근 여행의 별점). 리뷰가 없으면 **0 이 아니라 null** 이다.
   * 리뷰가 바뀔 때 DB 트리거가
   * 그 장소만 다시 계산한다 (README-플로챠트.md ❶❹).
   */
  rating_avg: number | null
  /** 위 평균에 들어간 사람 수. 화면은 MIN_RATING_DISPLAY 이상일 때만 ★ 를 보인다 */
  rating_count: number
}

/**
 * 여행 생성 마법사 1단계(TRIP-02-01)에서 2단계(TRIP-02-02)로 넘기는 초안.
 * 규칙까지 정하고 나서야 한 번에 저장하므로, 그 사이에는 DB 가 아니라
 * 라우터 state 로만 들고 다닌다.
 */
export interface TripDraft {
  title: string
  tour_area_code: number
  tour_sigungu_code: number | null
  trip_date: string
  start_time: string
  end_time: string
  companions: Companion[]
}

/**
 * 'waiting'(웨이팅)은 기능과 함께 2026-10-01 에 enum 에서도 뺐다.
 * visited 는 리뷰를 쓰면 붙고, 플랜 올리기 조건이 이 값을 본다 (Q19).
 */
export type TripItemStatus = 'planned' | 'reserved' | 'visited'

export interface TripItem {
  id: string
  trip_id: string
  place_id: string
  sort_order: number
  planned_time: string | null
  status: TripItemStatus
  /** 방문 리뷰 — 소감·별점 모두 작성 후에는 값을 덮어써서 수정한다(별도 이력 없음) */
  note: string | null
  rating: number | null
  place?: Place
}

/* ───────────────── SHARE-06 공용 여행 플랜 ───────────────── */

/** 운영자가 만든 플랜인지, 사용자가 올린 플랜인지 */
export type PlanOrigin = 'admin' | 'user'

/** 플랜이 왜 내려갔는지 — 관리자 화면의 분류축 */
export type PlanHiddenReason = 'place_removed' | 'admin'

export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

/**
 * 공용 플랜.
 *
 * `trips` 의 복사본이 아니라 독립된 물건이다. 올릴 때 스냅샷으로 복사하므로
 * 원본 여행을 고쳐도 따라 바뀌지 않고, 운영자 플랜은 원본 자체가 없다.
 * 개인 기록(trip_date·note·rating)은 넘어오지 않는다 — 공개하려는 건 동선이지
 * 일기가 아니다.
 */
export interface SharedPlan {
  id: string
  origin: PlanOrigin
  /** origin='admin' 이면 null. 화면은 '운영자'로 고정 표시한다 */
  author_user_id: string | null
  title: string
  description: string
  tour_area_code: number
  /** null 이면 '시/도 전체'. 미판정(-1)은 여기 오지 않는다 */
  tour_sigungu_code: number | null
  /** 조회 시 조인해 채운다 — 화면은 코드가 아니라 이름을 쓴다 */
  group_name: string
  region_name: string | null
  transport: Transport
  companions: Companion[]
  start_time: string
  end_time: string
  /** trip_date 대신 들어가는 값. 특정 날짜는 위치 이력이 된다 */
  weekday: number | null
  season: Season | null
  place_count: number
  duration_minutes: number | null
  /** 원본 여행에 방문 기록이 있었는지. 카드의 '다녀옴' 배지 */
  was_visited: boolean
  /** 담은 수. 코스의 인기 신호 */
  clone_count: number
  /**
   * 만족도 평균. 평가가 없으면 **0 이 아니라 null** 이다 — 0 이면 '평가 없음'과
   * '최하점'이 구분되지 않는다. 담은 수가 '고르게 만드는 힘'이라면 이쪽은
   * '실제로 좋았는지'다.
   */
  rating_avg: number | null
  rating_count: number
  is_hidden: boolean
  hidden_reason: PlanHiddenReason | null
  created_at: string
  updated_at: string
  /** 상세 조회에서만 채운다 */
  items?: SharedPlanItem[]
}

/**
 * 공용 플랜의 항목. `TripItem` 과 같은 모양이고 개인 기록만 빠진다.
 * 같은 모양이라야 올리기·담기가 대칭 변환이 된다.
 */
export interface SharedPlanItem {
  id: string
  plan_id: string
  place_id: string
  sort_order: number
  planned_time: string | null
  /** 공개용 한 줄 팁. 개인 리뷰(note)를 대신한다 */
  tip: string | null
  place?: Place
}

/**
 * 플랜 만족도 (SHARE-06-07).
 *
 * 그 플랜을 담은 적 있는 사람만 남길 수 있고, 자기 플랜은 평가할 수 없다.
 * 사람당 플랜당 1건이며 고칠 수는 있다. 판정은 DB 의 RLS 가 한다.
 */
export interface PlanRating {
  id: string
  plan_id: string
  user_id: string
  rating: number
  comment: string | null
  created_at: string
  updated_at: string
}

/**
 * 작성자 표시 문구.
 *
 * 누가 올렸는지는 보여 주지 않는다 — '운영자' 아니면 '회원' 두 가지뿐이다.
 * 닉네임을 띄우려면 profiles 를 내보내는 창이 하나 필요한데, 그 창을 좁게
 * 만들면 숨겨진 플랜의 작성자가 창에서 빠져 '알 수 없음' 이 뜨고, 넓게
 * 만들면 안 내보내도 될 것까지 나간다. 읽는 사람에게 닉네임이 주는 값이
 * 그 비용만큼 크지 않다고 보고 아예 내리지 않기로 했다 (Q17).
 */
export function planAuthorLabel(plan: Pick<SharedPlan, 'origin'>): string {
  return plan.origin === 'admin' ? '운영자' : '회원'
}

export const PLAN_HIDDEN_REASON_LABEL: Record<PlanHiddenReason, string> = {
  place_removed: '장소 삭제',
  admin: '관리자 조치',
}

export const SEASON_LABEL: Record<Season, string> = {
  spring: '봄',
  summer: '여름',
  autumn: '가을',
  winter: '겨울',
}

/** 플랜으로 인정하는 최소 장소 수. 한 곳짜리는 플랜이 아니라 즐겨찾기다 */
export const MIN_PLAN_PLACES = 2

/** 만족도 별점을 말로 바꿔 준다. 숫자만 있으면 무슨 뜻인지 매번 가늠해야 한다 */
export const PLAN_RATING_LABEL: Record<number, string> = {
  1: '아쉬웠어요',
  2: '그저 그랬어요',
  3: '괜찮았어요',
  4: '좋았어요',
  5: '아주 좋았어요',
}

export const CATEGORY_LABEL: Record<PlaceCategory, string> = {
  babzip: '밥집',
  cafe: '카페',
  sulzip: '술집',
  spot: '명소',
}

export const CATEGORY_COLOR: Record<PlaceCategory, string> = {
  babzip: '#f2664a',
  cafe: '#b5762f',
  sulzip: '#7c5cd6',
  spot: '#23a06a',
}

/** 지도 마커 등에서 색상만으로 구분하기 어려울 때(색맹 등) 함께 쓰는 카테고리 아이콘 */
export const CATEGORY_ICON: Record<PlaceCategory, string> = {
  babzip: '🍚',
  cafe: '☕',
  sulzip: '🍺',
  spot: '📍',
}

export const TRANSPORT_LABEL: Record<Transport, string> = {
  walk: '도보',
  transit: '대중교통',
  car: '자가용',
}

/** 이동 수단별 평균 속도(km/h) — 동선 소요 시간 추정에 사용 (TRIP-02-02) */
/**
 * 사용자 별점(★)을 화면에 보이는 최소 리뷰 수 (README-플로챠트.md ❸).
 * 리뷰가 1건뿐이면 평균이 곧 그 사람의 별점이라, 순서에는 반영하되 보이지는 않는다.
 */
export const MIN_RATING_DISPLAY = 3

/**
 * 영업시간을 한 줄로 — 지도 시트 · 타임라인 카드처럼 좁은 자리용.
 * 원문은 줄바꿈(\n)으로 나뉜 목록이다('[평일]\n11:30~15:00\n마지막 주문 14:00').
 * 장소 상세는 줄을 그대로 보여 준다(whitespace-pre-line).
 */
export function openHoursOneLine(text: string): string {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  // '[평일]' 같은 머리말은 다음 줄과 띄어쓰기로 붙인다 — '[평일] 11:30~15:00 · [주말] …'
  let out = ''
  lines.forEach((line, i) => {
    const prevIsHeading = i > 0 && /^\[.*\]$/.test(lines[i - 1])
    out += i === 0 ? line : prevIsHeading ? ` ${line}` : ` · ${line}`
  })
  return out
}

/**
 * 화면에 ★ 로 보일 장소 별점 — 사용자 리뷰 평균이 MIN_RATING_DISPLAY 건 이상일 때만.
 */
export function shownRating(
  place: Pick<Place, 'rating_avg' | 'rating_count'>,
): { avg: number; count: number } | null {
  return place.rating_avg != null && place.rating_count >= MIN_RATING_DISPLAY
    ? { avg: place.rating_avg, count: place.rating_count }
    : null
}

export const TRANSPORT_SPEED_KMH: Record<Transport, number> = {
  walk: 4,
  transit: 18,
  car: 30,
}

export const COMPANION_LABEL: Record<Companion, string> = {
  solo: '혼자',
  couple: '연인',
  friends: '친구',
  family: '가족',
}

/**
 * SYS-01-02: 선호 식당/테마 카테고리 태그.
 *
 * 장소에 실제로 붙는 태그만 둔다 — 수집 스크립트(load.mjs 의 tagsOf)가 붙이는 다섯과
 * 같아야 회원 취향이 추천에 걸린다. 근거 없이 고를 수만 있던 태그는 2026-10-08 에
 * 뺐다(20261008070000 · 20261008080000). 저장값에 옛 태그가 남아 있을 수 있어
 * 화면은 knownTasteTags() 로 거른다.
 */
export const TASTE_TAGS = [
  '카페',
  '디저트',
  '오마카세',
  '주차가능',
  '심야영업',
] as const

/** 저장된 취향 태그 중 지금 목록(TASTE_TAGS)에 있는 것만 — 목록에서 뺀 태그를 화면에 남기지 않는다 */
export function knownTasteTags(tags: string[]): string[] {
  return tags.filter((t) => (TASTE_TAGS as readonly string[]).includes(t))
}
