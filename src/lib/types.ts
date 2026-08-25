/**
 * 도메인 타입 — supabase/schema.sql 의 테이블 정의와 1:1로 대응한다.
 */

export type PlaceCategory = 'babzip' | 'cafe' | 'sulzip' | 'spot'

/** 이동 수단 (TRIP-02-02: 주 이동수단 라디오버튼) */
export type Transport = 'walk' | 'transit' | 'car'

/** 동행인 유형 (TRIP-02-01) */
export type Companion = 'solo' | 'couple' | 'friends' | 'family' | 'pet'

/** 목적지 상위 지역(시/도) */
export interface RegionGroup {
  name: string
  lat: number
  lng: number
  sort_order: number
}

/**
 * 목적지 하위 지역(구/시). places.region / trips.destination 이 이 name 을
 * 그대로 참조한다. name 은 '부산 서구'처럼 그룹명을 붙여 전역 유일성을 보장한다
 * — '강서구'처럼 다른 구 이름을 부분 문자열로 포함하는 경우가 있어서다.
 */
export interface Region {
  name: string
  lat: number
  lng: number
  sort_order: number
  group_name: string
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
  destination: string
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
  region: string
  address: string
  lat: number
  lng: number
  image_url: string | null
  rating: number
  price_level: number
  tags: string[]
  summary: string
  open_hours: string
  /** 전화번호 — TourAPI 가 제공하지 않으면 null */
  phone: string | null
}

/**
 * 여행 생성 마법사 1단계(TRIP-02-01)에서 2단계(TRIP-02-02)로 넘기는 초안.
 * 규칙까지 정하고 나서야 한 번에 저장하므로, 그 사이에는 DB 가 아니라
 * 라우터 state 로만 들고 다닌다.
 */
export interface TripDraft {
  title: string
  destination: string
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
