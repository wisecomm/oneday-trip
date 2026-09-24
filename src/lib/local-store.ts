import type {
  PlaceRequest,
  PlanReport,
  Profile,
  Reservation,
  SharedPlan,
  SharedPlanItem,
  Trip,
  TripItem,
} from './types'

/**
 * 데모 모드 저장소.
 * Supabase 자격 증명이 없을 때 동일한 테이블 구조를 localStorage 위에서 재현한다.
 */
/**
 * 저장되는 여행 행. group_name·region_name 은 조회할 때 지역 목록에서 붙이는
 * 값이므로 저장하지 않는다 — 지역 이름이 바뀌어도 저장본이 낡지 않게.
 */
export type StoredTrip = Omit<Trip, 'group_name' | 'region_name'>

/** 플랜도 같은 이유로 지역 이름과 작성자 닉네임을 저장하지 않는다 */
export type StoredSharedPlan = Omit<
  SharedPlan,
  'group_name' | 'region_name' | 'author_nickname' | 'items'
>

export interface LocalDb {
  profiles: Profile[]
  trips: StoredTrip[]
  trip_items: TripItem[]
  reservations: Reservation[]
  shared_plans: StoredSharedPlan[]
  shared_plan_items: SharedPlanItem[]
  plan_reports: PlanReport[]
  /**
   * 데모에는 승인하는 주체가 없다. 요청은 pending 으로 쌓이고 거기서 멈춘다 —
   * "승인 후에만 저장된다"가 이 기능의 핵심 규칙이라, 데모가 그 규칙을
   * 거스르면 데모를 보고 기능을 이해한 사람이 틀리게 이해한다.
   */
  place_requests: PlaceRequest[]
}

const KEY = 'oneday-trip:db'

const EMPTY: LocalDb = {
  profiles: [],
  trips: [],
  trip_items: [],
  reservations: [],
  shared_plans: [],
  shared_plan_items: [],
  plan_reports: [],
  place_requests: [],
}

export function readDb(): LocalDb {
  if (typeof localStorage === 'undefined') return { ...EMPTY }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...EMPTY }
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<LocalDb>) }
  } catch {
    return { ...EMPTY }
  }
}

export function writeDb(next: LocalDb): void {
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function mutateDb(fn: (draft: LocalDb) => void): LocalDb {
  const next = readDb()
  fn(next)
  writeDb(next)
  return next
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
