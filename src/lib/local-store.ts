import type {
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
  'group_name' | 'region_name' | 'items'
>

export interface LocalDb {
  profiles: Profile[]
  trips: StoredTrip[]
  trip_items: TripItem[]
  reservations: Reservation[]
  shared_plans: StoredSharedPlan[]
  shared_plan_items: SharedPlanItem[]
}

const KEY = 'oneday-trip:db'

/**
 * 저장되는 행의 필드 목록.
 *
 * 타입이 있는데 왜 값으로 또 적는가. 타입은 런타임에 사라져서, 저장본이 지금
 * 코드와 같은 모양인지 코드가 스스로 확인할 수 없다. 그래서 목록을 값으로도
 * 둔다.
 *
 * `satisfies Record<keyof T, true>` 로 묶어 두었으므로, 타입에 필드를 더하고
 * 여기를 빠뜨리면 tsc 가 막는다. 저장본 형식이 바뀐 것을 사람이 알아채고
 * 번호를 올리는 대신 컴파일러가 알려주는 것이 요점이다 — 고친 사람은 자기
 * 브라우저를 비우고 테스트하니 멀쩡해 보이고, 저장본이 남은 사람만 깨진다.
 * 2026-10-01 에 플랜 목록이 통째로 하얗게 뜬 것이 그 경우였다. 옛 행에
 * `rating_avg` 가 아예 없어 `undefined.toFixed()` 에서 터졌다.
 */
const SHAPE = {
  profiles: {
    id: true, nickname: true, taste_tags: true, role: true, created_at: true,
  } satisfies Record<keyof Profile, true>,

  trips: {
    id: true, user_id: true, title: true, tour_area_code: true,
    tour_sigungu_code: true, trip_date: true, start_time: true, end_time: true,
    companions: true, transport: true, source_plan_id: true, created_at: true,
  } satisfies Record<keyof StoredTrip, true>,

  trip_items: {
    id: true, trip_id: true, place_id: true, sort_order: true,
    planned_time: true, status: true, note: true, rating: true, place: true,
  } satisfies Record<keyof TripItem, true>,

  reservations: {
    id: true, user_id: true, place_id: true, trip_item_id: true,
    reserved_at: true, party_size: true, deposit: true, status: true, place: true,
  } satisfies Record<keyof Reservation, true>,

  shared_plans: {
    id: true, origin: true, author_user_id: true, title: true, description: true,
    tour_area_code: true, tour_sigungu_code: true, transport: true,
    companions: true, start_time: true, end_time: true, weekday: true,
    season: true, place_count: true, duration_minutes: true, was_visited: true,
    clone_count: true, rating_avg: true, rating_count: true, is_hidden: true,
    hidden_reason: true, created_at: true, updated_at: true,
  } satisfies Record<keyof StoredSharedPlan, true>,

  shared_plan_items: {
    id: true, plan_id: true, place_id: true, sort_order: true,
    planned_time: true, tip: true, place: true,
  } satisfies Record<keyof SharedPlanItem, true>,
}

/**
 * 형식 번호. 필드 이름은 그대로인데 뜻이 바뀐 경우(예: 분 단위를 초 단위로)
 * 를 위한 수동 손잡이다. 필드가 늘고 주는 것은 아래 지문이 알아서 잡는다.
 */
const VERSION = 3

/** SHAPE 가 바뀌면 함께 바뀐다. 저장본의 값과 다르면 버리고 다시 심는다 */
const SHAPE_KEY = 'oneday-trip:db-shape'
const shapeFingerprint = (): string =>
  `v${VERSION}|` +
  Object.entries(SHAPE)
    .map(([table, cols]) => `${table}(${Object.keys(cols).sort().join(',')})`)
    .sort()
    .join('|')

/** VERSION_KEY 를 쓰던 시절의 찌꺼기. 한동안 지워 준다 */
const LEGACY_VERSION_KEY = 'oneday-trip:db-version'

const EMPTY: LocalDb = {
  profiles: [],
  trips: [],
  trip_items: [],
  reservations: [],
  shared_plans: [],
  shared_plan_items: [],
}

export function readDb(): LocalDb {
  if (typeof localStorage === 'undefined') return { ...EMPTY }
  try {
    const want = shapeFingerprint()
    if (localStorage.getItem(SHAPE_KEY) !== want) {
      localStorage.removeItem(KEY)
      localStorage.removeItem(LEGACY_VERSION_KEY)
      localStorage.setItem(SHAPE_KEY, want)
      return { ...EMPTY }
    }
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
