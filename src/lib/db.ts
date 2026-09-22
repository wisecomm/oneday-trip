import { isSupabaseConfigured, db as sb } from './supabase'
import { mutateDb, readDb, uid } from './local-store'
import { DEMO_REGIONS, DEMO_REGION_GROUPS, SEED_PLACES } from './seed'
import type {
  Place,
  PlaceCategory,
  Profile,
  Region,
  RegionGroup,
  Reservation,
  Trip,
  TripItem,
  TripItemStatus,
} from './types'

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

  async upsert(input: Omit<Profile, 'created_at'>): Promise<Profile> {
    const row: Profile = { ...input, created_at: nowIso() }

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
    return readDb()
      .trip_items.filter((it) => it.trip_id === tripId)
      .map((it) => ({ ...it, place: SEED_PLACES.find((p) => p.id === it.place_id) }))
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
