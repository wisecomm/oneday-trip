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

export const regionGroups = {
  async list(): Promise<RegionGroup[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('region_groups').select('*').order('sort_order')
      if (error) throw error
      return (data ?? []) as RegionGroup[]
    }
    return DEMO_REGION_GROUPS
  },
}

export const regions = {
  /** 하위(구/시) 지역 전체. group_name 으로 필터링해 상위 지역에 속한 것만 골라 쓴다 */
  async list(): Promise<Region[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('regions').select('*').order('sort_order')
      if (error) throw error
      return (data ?? []) as Region[]
    }
    return DEMO_REGIONS
  },
}

/* ───────────────────────── Places (MAP-04-01) ───────────────────────── */

export interface PlaceFilter {
  /** 하위 지역(구/시) 하나만 볼 때. region·regions 를 동시에 주면 region 이 우선한다 */
  region?: string
  /** 상위 지역(시/도) 전체를 볼 때 — 그 아래 하위 지역 이름 목록을 그대로 넘긴다 */
  regions?: string[]
  categories?: PlaceCategory[]
  keyword?: string
}

export const places = {
  async list(filter: PlaceFilter = {}): Promise<Place[]> {
    if (isSupabaseConfigured) {
      let query = sb().from('places').select('*')
      if (filter.region) query = query.eq('region', filter.region)
      else if (filter.regions?.length) query = query.in('region', filter.regions)
      if (filter.categories?.length) query = query.in('category', filter.categories)
      if (filter.keyword) query = query.ilike('name', `%${filter.keyword}%`)
      const { data, error } = await query.order('rating', { ascending: false })
      if (error) throw error
      return (data ?? []) as Place[]
    }

    return SEED_PLACES.filter((p) => {
      if (filter.region && p.region !== filter.region) return false
      if (!filter.region && filter.regions?.length && !filter.regions.includes(p.region))
        return false
      if (filter.categories?.length && !filter.categories.includes(p.category)) return false
      if (filter.keyword && !p.name.includes(filter.keyword)) return false
      return true
    }).sort((a, b) => b.rating - a.rating)
  },

  async get(id: string): Promise<Place | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('places').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return (data as Place) ?? null
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

export type TripInput = Omit<Trip, 'id' | 'created_at'>

export const trips = {
  async list(userId: string): Promise<Trip[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('trips')
        .select('*')
        .eq('user_id', userId)
        .order('trip_date', { ascending: false })
      if (error) throw error
      return (data ?? []) as Trip[]
    }
    return readDb()
      .trips.filter((t) => t.user_id === userId)
      .sort((a, b) => b.trip_date.localeCompare(a.trip_date))
  },

  async get(id: string): Promise<Trip | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('trips').select('*').eq('id', id).maybeSingle()
      if (error) throw error
      return (data as Trip) ?? null
    }
    return readDb().trips.find((t) => t.id === id) ?? null
  },

  async create(input: TripInput): Promise<Trip> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb().from('trips').insert(input).select().single()
      if (error) throw error
      return data as Trip
    }
    const row: Trip = { ...input, id: uid('trip'), created_at: nowIso() }
    mutateDb((d) => void d.trips.push(row))
    return row
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

  /** 방문 소감 작성/수정 — 별도 이력 없이 값을 그대로 덮어쓴다. 빈 문자열은 null 로 저장한다 */
  async setNote(id: string, note: string): Promise<void> {
    const value = note.trim() || null
    if (isSupabaseConfigured) {
      const { error } = await sb().from('trip_items').update({ note: value }).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.trip_items.findIndex((it) => it.id === id)
      if (i >= 0) d.trip_items[i] = { ...d.trip_items[i], note: value }
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
