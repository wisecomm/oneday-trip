/**
 * 도메인 타입 — supabase/schema.sql 의 테이블 정의와 1:1로 대응한다.
 */

export type PlaceCategory = 'babzip' | 'cafe' | 'sulzip' | 'spot'

/** 이동 수단 (TRIP-02-02: 주 이동수단 라디오버튼) */
export type Transport = 'walk' | 'transit' | 'car'

/** 동행인 유형 (TRIP-02-01) */
export type Companion = 'solo' | 'couple' | 'friends' | 'family' | 'pet'

/** 웨이팅 성향 (SYS-01-02: 대기 민감 1 ~ 느긋 5) */
export type WaitingSensitivity = 1 | 2 | 3 | 4 | 5

export interface Profile {
  id: string
  nickname: string
  taste_tags: string[]
  waiting_sensitivity: WaitingSensitivity
  created_at: string
}

export interface Trip {
  id: string
  user_id: string
  title: string
  destination: string
  /** 당일치기 서비스이므로 여행은 하루 단위다 */
  trip_date: string
  companions: Companion[]
  /** TRIP-02-02: 하루에 다닐 수 있는 최대 방문 리스트 (1~5, 기본 3) */
  max_places_per_day: number
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
  /** 실시간 대기 인원 현황 (RSV-05-02) */
  waiting_count: number
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

export type WaitingStatus = 'waiting' | 'called' | 'cancelled' | 'done'

export interface Waiting {
  id: string
  user_id: string
  place_id: string
  party_size: number
  /** 신청 시점 기준 내 앞의 팀 수 */
  ahead_count: number
  /** '미루기' 누적 횟수 — 하루 최대 2회 (기획 정책) */
  delay_count: number
  /** 미루기로 누적된 추가 대기 시간(분) */
  extra_minutes: number
  status: WaitingStatus
  created_at: string
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
