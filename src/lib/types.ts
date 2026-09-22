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

/** 목적지 표시용 문구 — 구를 고르지 않았으면 '서울 전체' */
export function regionLabel(groupName: string, regionName: string | null): string {
  return regionName ? `${groupName} ${regionName}` : `${groupName} 전체`
}

export interface Profile {
  id: string
  nickname: string
  taste_tags: string[]
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
