/**
 * 도메인 타입 — supabase/schema.sql 의 테이블 정의와 1:1로 대응한다.
 */

export type PlaceCategory = 'babzip' | 'cafe' | 'sulzip' | 'spot'

/** 이동 수단 (TRIP-02-02: 주 이동수단 라디오버튼) */
export type Transport = 'walk' | 'transit' | 'car'

/** 동행인 유형 (TRIP-02-01) */
export type Companion = 'solo' | 'couple' | 'friends' | 'family' | 'pet'

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

/**
 * 공개된 작성자 정보. `profiles` 본체가 아니라 `public_profiles` 뷰에서 온다 —
 * 그 뷰에는 id·nickname 뿐이고, 공개 플랜을 하나 이상 올린 사용자만 들어 있다.
 */
export interface PublicProfile {
  id: string
  nickname: string
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
  /**
   * 외부(TourAPI)가 준 평점. 주지 않으면 null 이다 — 0 이 아니다.
   * 0 으로 두면 '평점 없음'과 '0점'이 구분되지 않아 전 장소가 ★ 0.0 으로 보인다.
   * 값이 null 이면 화면에서 별점 영역을 아예 숨긴다.
   */
  source_rating: number | null
  price_level: number
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

export type TripItemStatus = 'planned' | 'reserved' | 'waiting' | 'visited'

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

export type ReservationStatus = 'confirmed' | 'cancelled'

export interface Reservation {
  id: string
  user_id: string
  place_id: string
  trip_item_id: string | null
  reserved_at: string
  party_size: number
  deposit: number
  status: ReservationStatus
  place?: Place
}

/* ───────────────── SHARE-06 공용 여행 플랜 ───────────────── */

/** 운영자가 만든 플랜인지, 사용자가 올린 플랜인지 */
export type PlanOrigin = 'admin' | 'user'

/** 플랜이 왜 내려갔는지 — 관리자 화면의 분류축 */
export type PlanHiddenReason = 'reported' | 'place_removed' | 'admin'

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
  /** public_profiles 뷰에서 조인해 채운다. 운영자 플랜이면 null */
  author_nickname: string | null
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
  /** 담은 수. source_rating 이 전부 null 이라 이것이 첫 번째 인기 신호다 */
  clone_count: number
  is_hidden: boolean
  hidden_reason: PlanHiddenReason | null
  source_trip_id: string | null
  source_updated_at: string | null
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

export interface PlanReport {
  id: string
  plan_id: string
  reporter_id: string
  reason: string
  resolved: boolean
  created_at: string
}

/** 작성자 표시 문구 — 운영자 플랜과 사용자 플랜을 한 줄로 다룬다 */
export function planAuthorLabel(plan: Pick<SharedPlan, 'origin' | 'author_nickname'>): string {
  if (plan.origin === 'admin') return '운영자'
  return plan.author_nickname ?? '알 수 없음'
}

export const PLAN_HIDDEN_REASON_LABEL: Record<PlanHiddenReason, string> = {
  reported: '신고 누적',
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

/** 이 수만큼 서로 다른 사람이 신고하면 자동으로 내려간다 (DB 트리거) */
export const REPORT_HIDE_THRESHOLD = 3

/* ───────────────── PLACE-07 장소 등록 요청 ───────────────── */

export type PlaceRequestStatus = 'pending' | 'approved' | 'rejected'

/**
 * 사용자의 장소 등록 요청.
 *
 * 승인되기 전까지 값은 여기 머문다 — `places` 에 들어가지 않는다. 그래서
 * 카탈로그에 있으면 곧 공개된 것이고, 읽는 쪽에서 가릴 것이 없다.
 * 요청자도 승인 전에는 그 장소를 자기 여행에 담을 수 없다.
 */
export interface PlaceRequest {
  id: string
  requester_id: string
  name: string
  category: PlaceCategory
  address: string
  /** 지도에서 핀을 찍어 받는다 — 주소 검색(지오코딩)은 쓰지 않는다 */
  lat: number
  lng: number
  image_url: string | null
  /** 요청자가 드롭다운에서 고른 값. 역지오코딩은 넣지 않는다 */
  tour_area_code: number
  tour_sigungu_code: number
  memo: string | null
  status: PlaceRequestStatus
  /** 거절 사유. 같은 곳을 다시 요청할 때 보여 준다 */
  reject_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_place_id: string | null
  created_at: string
}

export const PLACE_REQUEST_STATUS_LABEL: Record<PlaceRequestStatus, string> = {
  pending: '확인 중',
  approved: '등록됨',
  rejected: '반려됨',
}

/** 중복 후보로 띄울 반경(m). 차단하지 않고 "혹시 이거 아닌가요?" 만 묻는다 */
export const DUPLICATE_RADIUS_M = 100

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
  pet: '반려견 동반',
}

/** SYS-01-02: 선호 식당/테마 카테고리 태그 */
export const TASTE_TAGS = [
  '비건',
  '카페',
  '반려견 동반',
  '노포',
  '오마카세',
  '뷰맛집',
  '가성비',
  '혼밥',
  '주차가능',
  '심야영업',
  '디저트',
  '로컬맛집',
] as const
