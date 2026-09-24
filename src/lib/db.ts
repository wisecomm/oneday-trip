import { isSupabaseConfigured, db as sb } from './supabase'
import { mutateDb, readDb, uid } from './local-store'
import { DEMO_REGIONS, DEMO_REGION_GROUPS, SEED_PLACES } from './seed'
import type {
  Place,
  PlaceCategory,
  PlaceRequest,
  Profile,
  Region,
  RegionGroup,
  Reservation,
  Season,
  SharedPlan,
  SharedPlanItem,
  Trip,
  TripItem,
  TripItemStatus,
} from './types'
import { DUPLICATE_RADIUS_M, REPORT_HIDE_THRESHOLD } from './types'

/**
 * 데이터 접근 계층.
 * 모든 화면은 이 모듈만 호출하며, Supabase 연결 여부에 따른 분기는 여기서만 일어난다.
 */

const nowIso = () => new Date().toISOString()

/* ─────────────────── Region groups · regions (TRIP-02-01) ─────────────────── */

/**
 * 미판정 지역·장소는 어디에도 보이지 않는다.
 *
 * 판정에 실패한 장소는 버리거나 가까운 구에 욱여넣지 않고 코드 -1 로 격리해
 * 수동 처리 대기열에 둔다. 모든 화면이 이 모듈만 통해 읽으므로, 제외 조건은
 * 여기 두 곳에만 있으면 된다.
 */
const visibleRegion = <T extends { tour_sigungu_code: number }>(r: T) =>
  r.tour_sigungu_code >= 0

export const regionGroups = {
  async list(): Promise<RegionGroup[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('region_groups')
        .select('*')
        .gte('tour_area_code', 0)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as RegionGroup[]
    }
    return DEMO_REGION_GROUPS.filter((g) => g.tour_area_code >= 0)
  },
}

export const regions = {
  /** 하위(시군구) 전체. tour_area_code 로 걸러 상위 지역에 속한 것만 골라 쓴다 */
  async list(): Promise<Region[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('regions')
        .select('*')
        .gte('tour_sigungu_code', 0)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as Region[]
    }
    return DEMO_REGIONS.filter(visibleRegion)
  },
}

/* ───────────────────────── Places (MAP-04-01) ───────────────────────── */

export interface PlaceFilter {
  /** 상위 지역(시/도). 이것만 주면 그 시/도 전체를 본다 */
  areaCode?: number
  /** 하위 지역(시군구). areaCode 와 함께 준다 */
  sigunguCode?: number
  categories?: PlaceCategory[]
  keyword?: string
}

/**
 * Supabase 조회에 지역 이름을 함께 가져오는 select.
 *
 * 화면마다 코드→이름 변환을 부르게 하면 어딘가는 반드시 놓친다 — 실제로
 * share-card.ts 가 지역 이름을 인스타그램 해시태그로 쓰고 있어서, 놓치면
 * 사용자 게시물에 코드 숫자가 나간다. 조회 결과에 이름을 실어 보내면
 * 표시 지점이 알아서 안전해진다.
 */
const PLACE_SELECT = '*, region:regions!inner(name, group:region_groups!inner(name))'

type PlaceRow = Omit<Place, 'region_name' | 'group_name'> & {
  region?: { name: string; group?: { name: string } | null } | null
}

const flattenPlace = (row: PlaceRow): Place => ({
  ...(row as unknown as Place),
  region_name: row.region?.name ?? '',
  group_name: row.region?.group?.name ?? '',
})

export const places = {
  async list(filter: PlaceFilter = {}): Promise<Place[]> {
    if (isSupabaseConfigured) {
      let query = sb()
        .from('places')
        .select(PLACE_SELECT)
        // 미판정 장소는 목록에 넣지 않는다
        .gte('tour_sigungu_code', 0)
      if (filter.areaCode !== undefined) query = query.eq('tour_area_code', filter.areaCode)
      if (filter.sigunguCode !== undefined)
        query = query.eq('tour_sigungu_code', filter.sigunguCode)
      if (filter.categories?.length) query = query.in('category', filter.categories)
      if (filter.keyword) query = query.ilike('name', `%${filter.keyword}%`)
      // 정렬 기준을 source_rating 으로 두지 않는다 — TourAPI 가 평점을 주지 않아
      // 전부 null 이라 정렬이 무작위가 된다. 이름순이 최소한 예측 가능하다.
      const { data, error } = await query.order('name')
      if (error) throw error
      return ((data ?? []) as unknown as PlaceRow[]).map(flattenPlace)
    }

    return SEED_PLACES.filter((p) => {
      if (p.tour_sigungu_code < 0) return false
      if (filter.areaCode !== undefined && p.tour_area_code !== filter.areaCode) return false
      if (filter.sigunguCode !== undefined && p.tour_sigungu_code !== filter.sigunguCode)
        return false
      if (filter.categories?.length && !filter.categories.includes(p.category)) return false
      if (filter.keyword && !p.name.includes(filter.keyword)) return false
      return true
    }).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  },

  async get(id: string): Promise<Place | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('places')
        .select(PLACE_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data ? flattenPlace(data as unknown as PlaceRow) : null
    }
    return SEED_PLACES.find((p) => p.id === id) ?? null
  },
}

/* ─────────────────────── Profiles (SYS-01-02) ─────────────────────── */

export const profiles = {
  async get(userId: string): Promise<Profile | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
      if (error) throw error
      return (data as Profile) ?? null
    }
    return readDb().profiles.find((p) => p.id === userId) ?? null
  },

  /**
   * 역할(`role`)은 여기서 넘기지 않는다. 화면에서 보낼 수 있게 두면 온보딩
   * 요청에 `role: 'admin'` 을 실어 보내는 길이 열린다. 관리자 임명은 SQL 로만 한다.
   */
  async upsert(input: Omit<Profile, 'created_at' | 'role'>): Promise<Profile> {
    const row: Profile = { ...input, role: 'user', created_at: nowIso() }

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('profiles')
        .upsert({
          id: input.id,
          nickname: input.nickname,
          taste_tags: input.taste_tags,
        })
        .select()
        .single()
      if (error) throw error
      return data as Profile
    }

    mutateDb((d) => {
      const i = d.profiles.findIndex((p) => p.id === input.id)
      if (i >= 0) d.profiles[i] = { ...d.profiles[i], ...input }
      else d.profiles.push(row)
    })
    return row
  },
}

/* ───────────────── Trips (TRIP-02-01 / TRIP-02-02) ───────────────── */

/** 저장할 때는 코드만 넘긴다. 이름은 조회 시 조인해서 채운다 */
export type TripInput = Omit<Trip, 'id' | 'created_at' | 'group_name' | 'region_name'>

/** 여행도 장소와 같은 이유로 지역 이름을 함께 가져온다 */
const TRIP_SELECT = '*, group:region_groups!inner(name), region:regions(name)'

type TripRow = Omit<Trip, 'group_name' | 'region_name'> & {
  group?: { name: string } | null
  region?: { name: string } | null
}

const flattenTrip = (row: TripRow): Trip => ({
  ...(row as unknown as Trip),
  group_name: row.group?.name ?? '',
  region_name: row.region?.name ?? null,
})

/** 데모 모드에서는 조인이 없으니 지역 배열에서 이름을 찾아 붙인다 */
function demoTripNames(t: Omit<Trip, 'group_name' | 'region_name'>): Trip {
  const g = DEMO_REGION_GROUPS.find((x) => x.tour_area_code === t.tour_area_code)
  const r =
    t.tour_sigungu_code === null
      ? null
      : DEMO_REGIONS.find(
          (x) =>
            x.tour_area_code === t.tour_area_code &&
            x.tour_sigungu_code === t.tour_sigungu_code,
        )
  return { ...(t as Trip), group_name: g?.name ?? '', region_name: r?.name ?? null }
}

export const trips = {
  async list(userId: string): Promise<Trip[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trips')
        .select(TRIP_SELECT)
        .eq('user_id', userId)
        .order('trip_date', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as TripRow[]).map(flattenTrip)
    }
    return readDb()
      .trips.filter((t) => t.user_id === userId)
      .sort((a, b) => b.trip_date.localeCompare(a.trip_date))
      .map(demoTripNames)
  },

  async get(id: string): Promise<Trip | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trips')
        .select(TRIP_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data ? flattenTrip(data as unknown as TripRow) : null
    }
    const t = readDb().trips.find((x) => x.id === id)
    return t ? demoTripNames(t) : null
  },

  async create(input: TripInput): Promise<Trip> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('trips').insert(input).select(TRIP_SELECT).single()
      if (error) throw error
      return flattenTrip(data as unknown as TripRow)
    }
    const row = { ...input, id: uid('trip'), created_at: nowIso() }
    mutateDb((d) => void d.trips.push(row))
    return demoTripNames(row)
  },

  async update(id: string, patch: Partial<TripInput>): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trips').update(patch).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trips.findIndex((t) => t.id === id)
      if (i >= 0) d.trips[i] = { ...d.trips[i], ...patch }
    })
  },

  async remove(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trips').delete().eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      d.trips = d.trips.filter((t) => t.id !== id)
      d.trip_items = d.trip_items.filter((it) => it.trip_id !== id)
    })
  },
}

/* ─────────────────── Trip items (TRIP-03-01) ─────────────────── */

export const tripItems = {
  async listByTrip(tripId: string): Promise<TripItem[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trip_items')
        .select('*, place:places(*)')
        .eq('trip_id', tripId)
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as TripItem[]
    }
    // 장소 카탈로그가 교체되면 예전 place_id 를 가리키는 행이 localStorage 에
    // 남는다. 그대로 넘기면 place 가 undefined 인 항목이 화면에 흘러가므로,
    // 찾지 못한 것은 조용히 걸러낸다.
    return readDb()
      .trip_items.filter((it) => it.trip_id === tripId)
      .map((it) => ({ ...it, place: SEED_PLACES.find((p) => p.id === it.place_id) }))
      .filter((it) => it.place !== undefined)
      .sort((a, b) => a.sort_order - b.sort_order)
  },

  async add(input: {
    trip_id: string
    place_id: string
    planned_time?: string | null
  }): Promise<TripItem> {
    const sort_order = (await tripItems.listByTrip(input.trip_id)).length

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trip_items')
        .insert({
          trip_id: input.trip_id,
          place_id: input.place_id,
          sort_order,
          planned_time: input.planned_time ?? null,
          status: 'planned',
        })
        .select('*, place:places(*)')
        .single()
      if (error) throw error
      return data as TripItem
    }

    const row: TripItem = {
      id: uid('item'),
      trip_id: input.trip_id,
      place_id: input.place_id,
      sort_order,
      planned_time: input.planned_time ?? null,
      status: 'planned',
      note: null,
      rating: null,
    }
    mutateDb((d) => void d.trip_items.push(row))
    return { ...row, place: SEED_PLACES.find((p) => p.id === row.place_id) }
  },

  /** 드래그 앤 드롭 정렬 결과를 일괄 반영 */
  async reorder(items: Array<{ id: string; sort_order: number }>): Promise<void> {
    if (isSupabaseConfigured) {
      await Promise.all(
        items.map(({ id, sort_order }) =>
          sb().from('trip_items').update({ sort_order }).eq('id', id),
        ),
      )
      return
    }
    mutateDb((d) => {
      for (const patch of items) {
        const i = d.trip_items.findIndex((it) => it.id === patch.id)
        if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], sort_order: patch.sort_order }
      }
    })
  },

  async setStatus(id: string, status: TripItemStatus): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trip_items').update({ status }).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trip_items.findIndex((it) => it.id === id)
      if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], status }
    })
  },

  /** 방문 리뷰(소감+별점) 작성/수정 — 별도 이력 없이 값을 그대로 덮어쓴다. 빈 문자열은 null 로 저장한다 */
  async setReview(id: string, note: string, rating: number | null): Promise<void> {
    const noteValue = note.trim() || null
    if (isSupabaseConfigured) {
      const { error } = await sb()
        .from('trip_items')
        .update({ note: noteValue, rating })
        .eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trip_items.findIndex((it) => it.id === id)
      if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], note: noteValue, rating }
    })
  },

  async remove(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trip_items').delete().eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => void (d.trip_items = d.trip_items.filter((it) => it.id !== id)))
  },
}

/* ─────────────────── Reservations (RSV-05-01) ─────────────────── */

export const reservations = {
  async listByUser(userId: string): Promise<Reservation[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('reservations')
        .select('*, place:places(*)')
        .eq('user_id', userId)
        .order('reserved_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Reservation[]
    }
    return readDb()
      .reservations.filter((r) => r.user_id === userId)
      .map((r) => ({ ...r, place: SEED_PLACES.find((p) => p.id === r.place_id) }))
      .filter((r) => r.place !== undefined)
      .sort((a, b) => a.reserved_at.localeCompare(b.reserved_at))
  },

  async create(input: {
    user_id: string
    place_id: string
    trip_item_id?: string | null
    reserved_at: string
    party_size: number
    deposit: number
  }): Promise<Reservation> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('reservations')
        .insert({ ...input, trip_item_id: input.trip_item_id ?? null, status: 'confirmed' })
        .select('*, place:places(*)')
        .single()
      if (error) throw error
      return data as Reservation
    }
    const row: Reservation = {
      id: uid('rsv'),
      trip_item_id: input.trip_item_id ?? null,
      status: 'confirmed',
      ...input,
    }
    mutateDb((d) => void d.reservations.push(row))
    return { ...row, place: SEED_PLACES.find((p) => p.id === row.place_id) }
  },

  async cancel(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('reservations').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.reservations.findIndex((r) => r.id === id)
      if (i >= 0) d.reservations[i] = { ...d.reservations[i], status: 'cancelled' }
    })
  },
}

/* ─────────────────── Shared plans (SHARE-06) ─────────────────── */

export interface PlanFilter {
  areaCode?: number
  sigunguCode?: number
  companions?: string[]
  transport?: string
  /** 인기순(담은 수)이 기본이다 — 장소 평점이 전부 null 이라 쓸 수 없다 */
  sort?: 'popular' | 'recent'
}

/**
 * 지역 이름과 작성자 닉네임을 함께 가져온다.
 *
 * 작성자는 `profiles` 가 아니라 `public_profiles` 뷰에서 온다. 본체를 열면
 * `taste_tags` 까지 딸려 나가고, RLS 는 행 단위라 컬럼을 가려 주지 않는다.
 * 운영자 플랜은 `author_user_id` 가 null 이라 이 조인을 타지 않는다.
 */
const PLAN_SELECT =
  '*, group:region_groups!inner(name), region:regions(name), author:public_profiles(nickname)'

type PlanRow = Omit<SharedPlan, 'group_name' | 'region_name' | 'author_nickname'> & {
  group?: { name: string } | null
  region?: { name: string } | null
  author?: { nickname: string } | null
}

const flattenPlan = (row: PlanRow): SharedPlan => ({
  ...(row as unknown as SharedPlan),
  group_name: row.group?.name ?? '',
  region_name: row.region?.name ?? null,
  author_nickname: row.author?.nickname ?? null,
})

/** 데모 모드에는 조인이 없으니 지역·작성자 이름을 직접 찾아 붙인다 */
function demoPlanNames(p: StoredPlan): SharedPlan {
  const g = DEMO_REGION_GROUPS.find((x) => x.tour_area_code === p.tour_area_code)
  const r =
    p.tour_sigungu_code === null
      ? null
      : DEMO_REGIONS.find(
          (x) =>
            x.tour_area_code === p.tour_area_code && x.tour_sigungu_code === p.tour_sigungu_code,
        )
  const author =
    p.author_user_id === null
      ? null
      : (readDb().profiles.find((x) => x.id === p.author_user_id)?.nickname ?? null)
  return {
    ...(p as SharedPlan),
    group_name: g?.name ?? '',
    region_name: r?.name ?? null,
    author_nickname: author,
  }
}

type StoredPlan = Omit<SharedPlan, 'group_name' | 'region_name' | 'author_nickname' | 'items'>

/** 여행을 공용 플랜으로 올릴 때 사용자가 새로 입력하는 값 */
export interface PublishInput {
  title: string
  description: string
}

/** 운영자가 원본 없이 만들 때 넘기는 값 */
export interface AdminPlanInput {
  title: string
  description: string
  tour_area_code: number
  tour_sigungu_code: number | null
  transport: Trip['transport']
  companions: Trip['companions']
  start_time: string
  end_time: string
  season?: Season | null
  items: Array<{ place_id: string; planned_time?: string | null; tip?: string | null }>
}

const SEASON_OF_MONTH: Season[] = [
  'winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter',
]

/** 특정 날짜는 위치 이력이 된다. 요일과 계절만 남긴다 */
function weekdayAndSeason(tripDate: string): { weekday: number; season: Season } {
  const d = new Date(`${tripDate}T00:00:00`)
  return { weekday: d.getDay(), season: SEASON_OF_MONTH[d.getMonth()] }
}

export const sharedPlans = {
  async list(filter: PlanFilter = {}): Promise<SharedPlan[]> {
    if (isSupabaseConfigured) {
      let query = sb().from('shared_plans').select(PLAN_SELECT).eq('is_hidden', false)
      if (filter.areaCode !== undefined) query = query.eq('tour_area_code', filter.areaCode)
      if (filter.sigunguCode !== undefined)
        query = query.eq('tour_sigungu_code', filter.sigunguCode)
      if (filter.transport) query = query.eq('transport', filter.transport)
      if (filter.companions?.length) query = query.overlaps('companions', filter.companions)
      const { data, error } =
        filter.sort === 'recent'
          ? await query.order('created_at', { ascending: false })
          : await query.order('clone_count', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as PlanRow[]).map(flattenPlan)
    }

    return readDb()
      .shared_plans.filter((p) => {
        if (p.is_hidden) return false
        if (filter.areaCode !== undefined && p.tour_area_code !== filter.areaCode) return false
        if (filter.sigunguCode !== undefined && p.tour_sigungu_code !== filter.sigunguCode)
          return false
        if (filter.transport && p.transport !== filter.transport) return false
        if (filter.companions?.length && !p.companions.some((c) => filter.companions!.includes(c)))
          return false
        return true
      })
      .sort((a, b) =>
        filter.sort === 'recent'
          ? b.created_at.localeCompare(a.created_at)
          : b.clone_count - a.clone_count,
      )
      .map(demoPlanNames)
  },

  /** 상세 — 항목과 장소까지 채워 준다 */
  async get(id: string): Promise<SharedPlan | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .select(PLAN_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      if (!data) return null

      const { data: items, error: itemsError } = await sb()
        .from('shared_plan_items')
        .select('*, place:places(*)')
        .eq('plan_id', id)
        .order('sort_order')
      if (itemsError) throw itemsError

      return { ...flattenPlan(data as unknown as PlanRow), items: (items ?? []) as SharedPlanItem[] }
    }

    const p = readDb().shared_plans.find((x) => x.id === id)
    if (!p) return null
    // 카탈로그가 교체되면 예전 place_id 를 가리키는 항목이 남는다. 장소를 찾지
    // 못한 항목은 조용히 걸러 낸다 — 화면에 빈 카드가 흘러가지 않게.
    const items = readDb()
      .shared_plan_items.filter((it) => it.plan_id === id)
      .map((it) => ({ ...it, place: SEED_PLACES.find((pl) => pl.id === it.place_id) }))
      .filter((it) => it.place !== undefined)
      .sort((a, b) => a.sort_order - b.sort_order)
    return { ...demoPlanNames(p), items }
  },

  /** 내가 올린 플랜 (내려간 것도 보인다 — 왜 내려갔는지 알아야 하므로) */
  async listMine(userId: string): Promise<SharedPlan[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .select(PLAN_SELECT)
        .eq('author_user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as unknown as PlanRow[]).map(flattenPlan)
    }
    return readDb()
      .shared_plans.filter((p) => p.author_user_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(demoPlanNames)
  },

  /**
   * 내 여행을 공용 플랜으로 올린다 — 스냅샷 복사다.
   *
   * `trip_date` 는 요일·계절로만 남기고, 항목의 `note`·`rating`·`status` 는
   * 넘기지 않는다. 공개하려는 건 동선이지 일기가 아니다.
   */
  async publishFromTrip(tripId: string, input: PublishInput): Promise<SharedPlan> {
    const trip = await trips.get(tripId)
    if (!trip) throw new Error('여행을 찾을 수 없습니다')
    const items = await tripItems.listByTrip(tripId)
    const { weekday, season } = weekdayAndSeason(trip.trip_date)
    const row = {
      origin: 'user' as const,
      author_user_id: trip.user_id,
      title: input.title,
      description: input.description,
      tour_area_code: trip.tour_area_code,
      tour_sigungu_code: trip.tour_sigungu_code,
      transport: trip.transport,
      companions: trip.companions,
      start_time: trip.start_time,
      end_time: trip.end_time,
      weekday,
      season,
      place_count: items.length,
      // 원본을 나중에 다시 조회해 알아낼 수는 없다 — 올리는 이 시점에 계산한다
      was_visited: items.some((it) => it.status === 'visited'),
      source_trip_id: trip.id,
      source_updated_at: nowIso(),
    }

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .insert(row)
        .select(PLAN_SELECT)
        .single()
      if (error) throw error
      const plan = flattenPlan(data as unknown as PlanRow)
      const { error: itemsError } = await sb().from('shared_plan_items').insert(
        items.map((it) => ({
          plan_id: plan.id,
          place_id: it.place_id,
          sort_order: it.sort_order,
          planned_time: it.planned_time,
        })),
      )
      if (itemsError) throw itemsError
      return plan
    }

    const stored: StoredPlan = {
      ...row,
      id: uid('plan'),
      duration_minutes: null,
      clone_count: 0,
      is_hidden: false,
      hidden_reason: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    mutateDb((d) => {
      d.shared_plans.push(stored)
      for (const it of items) {
        d.shared_plan_items.push({
          id: uid('planitem'),
          plan_id: stored.id,
          place_id: it.place_id,
          sort_order: it.sort_order,
          planned_time: it.planned_time,
          tip: null,
        })
      }
    })
    return demoPlanNames(stored)
  },

  /** 운영자가 원본 여행 없이 만든다. source_trip_id 가 null 인 플랜이다 */
  async createByAdmin(input: AdminPlanInput): Promise<SharedPlan> {
    const row = {
      origin: 'admin' as const,
      author_user_id: null,
      title: input.title,
      description: input.description,
      tour_area_code: input.tour_area_code,
      tour_sigungu_code: input.tour_sigungu_code,
      transport: input.transport,
      companions: input.companions,
      start_time: input.start_time,
      end_time: input.end_time,
      weekday: null,
      season: input.season ?? null,
      place_count: input.items.length,
      was_visited: false,
      source_trip_id: null,
      source_updated_at: null,
    }

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('shared_plans')
        .insert(row)
        .select(PLAN_SELECT)
        .single()
      if (error) throw error
      const plan = flattenPlan(data as unknown as PlanRow)
      const { error: itemsError } = await sb().from('shared_plan_items').insert(
        input.items.map((it, i) => ({
          plan_id: plan.id,
          place_id: it.place_id,
          sort_order: i,
          planned_time: it.planned_time ?? null,
          tip: it.tip ?? null,
        })),
      )
      if (itemsError) throw itemsError
      return plan
    }

    const stored: StoredPlan = {
      ...row,
      id: uid('plan'),
      duration_minutes: null,
      clone_count: 0,
      is_hidden: false,
      hidden_reason: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    }
    mutateDb((d) => {
      d.shared_plans.push(stored)
      input.items.forEach((it, i) => {
        d.shared_plan_items.push({
          id: uid('planitem'),
          plan_id: stored.id,
          place_id: it.place_id,
          sort_order: i,
          planned_time: it.planned_time ?? null,
          tip: it.tip ?? null,
        })
      })
    })
    return demoPlanNames(stored)
  },

  /**
   * 담기 — 복제이지 참조가 아니다. 원본 플랜이 내려가도 내 여행은 그대로다.
   *
   * RLS 아래에서 사용자는 남의 행을 update 할 수 없으므로 clone_count 증가를
   * 클라이언트가 할 수 없다. 담기와 카운트를 서버 함수 하나로 묶었다.
   */
  async clone(
    planId: string,
    tripDate: string,
    /** 데모 모드에서만 쓴다. Supabase 모드는 서버가 auth.uid() 로 정한다 */
    opts: { userId: string; title?: string },
  ): Promise<string> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().rpc('clone_shared_plan', {
        p_plan_id: planId,
        p_trip_date: tripDate,
        p_title: opts.title ?? null,
      })
      if (error) throw error
      return data as string
    }

    const plan = await sharedPlans.get(planId)
    if (!plan || plan.is_hidden) throw new Error('플랜을 찾을 수 없습니다')

    const trip = await trips.create({
      user_id: opts.userId,
      title: opts.title ?? plan.title,
      tour_area_code: plan.tour_area_code,
      tour_sigungu_code: plan.tour_sigungu_code,
      trip_date: tripDate,
      start_time: plan.start_time,
      end_time: plan.end_time,
      companions: plan.companions,
      transport: plan.transport,
    })

    mutateDb((d) => {
      for (const it of plan.items ?? []) {
        // status 는 planned 로, note·rating 은 비운 채로 들어간다.
        // 여행의 시작 시각을 플랜과 같게 잡았으므로 planned_time 은 그대로 옮긴다.
        d.trip_items.push({
          id: uid('item'),
          trip_id: trip.id,
          place_id: it.place_id,
          sort_order: it.sort_order,
          planned_time: it.planned_time,
          status: 'planned',
          note: null,
          rating: null,
        })
      }
      const i = d.shared_plans.findIndex((p) => p.id === planId)
      if (i >= 0) d.shared_plans[i] = { ...d.shared_plans[i], clone_count: d.shared_plans[i].clone_count + 1 }
    })
    return trip.id
  },

  /** 작성자·관리자만 내린다. 이미 담아 간 사람의 여행은 복사본이라 그대로 남는다 */
  async setHidden(id: string, hidden: boolean): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb()
        .from('shared_plans')
        .update({ is_hidden: hidden, hidden_reason: hidden ? 'admin' : null })
        .eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.shared_plans.findIndex((p) => p.id === id)
      if (i >= 0)
        d.shared_plans[i] = {
          ...d.shared_plans[i],
          is_hidden: hidden,
          hidden_reason: hidden ? 'admin' : null,
        }
    })
  },

  async remove(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('shared_plans').delete().eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      d.shared_plans = d.shared_plans.filter((p) => p.id !== id)
      d.shared_plan_items = d.shared_plan_items.filter((it) => it.plan_id !== id)
    })
  },

  /**
   * 신고. 같은 사람이 같은 플랜을 여러 번 신고할 수 없다(DB unique).
   * 서로 다른 사람의 신고가 3건 쌓이면 DB 트리거가 자동으로 내린다.
   */
  async report(planId: string, reporterId: string, reason: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb()
        .from('plan_reports')
        .insert({ plan_id: planId, reporter_id: reporterId, reason })
      if (error) throw error
      return
    }
    mutateDb((d) => {
      if (d.plan_reports.some((r) => r.plan_id === planId && r.reporter_id === reporterId)) {
        throw new Error('이미 신고한 플랜입니다')
      }
      d.plan_reports.push({
        id: uid('report'),
        plan_id: planId,
        reporter_id: reporterId,
        reason,
        resolved: false,
        created_at: nowIso(),
      })
      // 데모도 서버 트리거와 같은 임계값을 따른다. 한 건에 바로 내려가면
      // 데모를 본 사람이 규칙을 틀리게 이해한다.
      const open = d.plan_reports.filter((r) => r.plan_id === planId && !r.resolved).length
      const i = d.shared_plans.findIndex((p) => p.id === planId)
      if (i >= 0 && d.shared_plans[i].origin === 'user' && open >= REPORT_HIDE_THRESHOLD)
        d.shared_plans[i] = { ...d.shared_plans[i], is_hidden: true, hidden_reason: 'reported' }
    })
  },
}

/* ─────────────────── Place requests (PLACE-07) ─────────────────── */

export type PlaceRequestInput = Pick<
  PlaceRequest,
  | 'name'
  | 'category'
  | 'address'
  | 'lat'
  | 'lng'
  | 'image_url'
  | 'tour_area_code'
  | 'tour_sigungu_code'
  | 'memo'
>

/** 위도 1도는 약 111km. 반경 100m 판정에는 이 근사로 충분하다 */
function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (aLat - bLat) * 111_000
  const dLng = (aLng - bLng) * 111_000 * Math.cos((aLat * Math.PI) / 180)
  return Math.sqrt(dLat * dLat + dLng * dLng)
}

export const placeRequests = {
  /** 내 등록 요청 (PLACE-07-03). 반려된 것도 사유와 함께 보인다 */
  async listMine(userId: string): Promise<PlaceRequest[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('place_requests')
        .select('*')
        .eq('requester_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as PlaceRequest[]
    }
    return readDb()
      .place_requests.filter((r) => r.requester_id === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  /** 검수 대기열 (PLACE-07-01). 승인이 밀리는 만큼 요청자가 기다린다 */
  async listPending(): Promise<PlaceRequest[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('place_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at')
      if (error) throw error
      return (data ?? []) as PlaceRequest[]
    }
    return readDb()
      .place_requests.filter((r) => r.status === 'pending')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  },

  /**
   * 반경 100m 안의 같은 카테고리 장소 — "혹시 이거 아닌가요?" 로 띄운다.
   *
   * 막지는 않는다. 한 건물에 카페가 둘인 경우가 흔하고, 지점이 빠진 자리에
   * 새 가게가 들어오기도 한다. 차단은 맞는 등록을 막는 쪽으로 틀리고,
   * 그 실패는 사용자에게 "왜 안 되는지 모르겠다"로 남는다.
   */
  async findNearby(
    lat: number,
    lng: number,
    category: PlaceCategory,
    areaCode: number,
    sigunguCode: number,
  ): Promise<Place[]> {
    const candidates = await places.list({
      areaCode,
      sigunguCode,
      categories: [category],
    })
    return candidates
      .filter((p) => metersBetween(lat, lng, p.lat, p.lng) <= DUPLICATE_RADIUS_M)
      .slice(0, 5)
  },

  /**
   * 등록 요청. 승인 전에는 `places` 에 들어가지 않으므로, 요청자도 그 장소를
   * 자기 여행에 담을 수 없다. 대신 카탈로그에 있으면 곧 공개된 것이 된다.
   */
  async create(requesterId: string, input: PlaceRequestInput): Promise<PlaceRequest> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('place_requests')
        // status 를 넘기지 않는다. 넘겨도 RLS 의 with check 가 pending 만 허용한다.
        .insert({ ...input, requester_id: requesterId })
        .select()
        .single()
      if (error) throw error
      return data as PlaceRequest
    }
    const row: PlaceRequest = {
      ...input,
      id: uid('preq'),
      requester_id: requesterId,
      status: 'pending',
      reject_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      created_place_id: null,
      created_at: nowIso(),
    }
    mutateDb((d) => void d.place_requests.push(row))
    return row
  },

  /**
   * 승인 — 이때 비로소 `places` 에 행이 생긴다.
   *
   * 요청을 읽고, 장소를 넣고, 요청 상태를 쓰는 것이 한 트랜잭션이어야 한다.
   * 중간에 끊기면 "승인은 됐는데 장소가 없는" 요청이 남으므로 서버 함수로 묶었다.
   * 데모에는 승인하는 주체가 없어 이 경로를 막아 둔다.
   */
  async approve(requestId: string): Promise<string> {
    if (!isSupabaseConfigured) {
      throw new Error('데모 모드에서는 등록 요청을 승인할 수 없습니다')
    }
    const { data, error } = await sb().rpc('approve_place_request', { p_request_id: requestId })
    if (error) throw error
    return data as string
  },

  /** 반려해도 지우지 않는다. 같은 곳을 다시 요청할 때 사유를 보여 주기 위해서다 */
  async reject(requestId: string, reason: string): Promise<void> {
    if (!isSupabaseConfigured) {
      throw new Error('데모 모드에서는 등록 요청을 반려할 수 없습니다')
    }
    const { error } = await sb().rpc('reject_place_request', {
      p_request_id: requestId,
      p_reason: reason,
    })
    if (error) throw error
  },
}
