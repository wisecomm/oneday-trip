import { isSupabaseConfigured, db as sb } from './supabase'
import { mutateDb, readDb, uid } from './local-store'
import { DEMO_REGIONS, SEED_PLACES } from './seed'
import type {
  Place,
  PlaceCategory,
  Profile,
  Region,
  Reservation,
  Trip,
  TripItem,
  TripItemStatus,
  Waiting,
} from './types'

/**
 * 데이터 접근 계층.
 * 모든 화면은 이 모듈만 호출하며, Supabase 연결 여부에 따른 분기는 여기서만 일어난다.
 */

const nowIso = () => new Date().toISOString()

/* ─────────────────────── Regions (TRIP-02-01) ─────────────────────── */

export const regions = {
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
  region?: string
  categories?: PlaceCategory[]
  keyword?: string
}

export const places = {
  async list(filter: PlaceFilter = {}): Promise<Place[]> {
    if (isSupabaseConfigured) {
      let query = sb().from('places').select('*')
      if (filter.region) query = query.eq('region', filter.region)
      if (filter.categories?.length) query = query.in('category', filter.categories)
      if (filter.keyword) query = query.ilike('name', `%${filter.keyword}%`)
      const { data, error } = await query.order('rating', { ascending: false })
      if (error) throw error
      return (data ?? []) as Place[]
    }

    return SEED_PLACES.filter((p) => {
      if (filter.region && p.region !== filter.region) return false
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
          waiting_sensitivity: input.waiting_sensitivity,
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

/* ───────────────────── Waitings (RSV-05-02) ───────────────────── */

/** 이미 진행 중인 웨이팅이 있어 새 신청을 받을 수 없을 때 */
export class ActiveWaitingExistsError extends Error {
  constructor(readonly existing: Waiting) {
    super('이미 진행 중인 웨이팅이 있습니다.')
    this.name = 'ActiveWaitingExistsError'
  }
}

/** 기획 정책: 악의적 점유 방지를 위해 '미루기'는 하루 최대 2회 */
export const MAX_DELAY_PER_DAY = 2
/** '미루기' 1회당 증가하는 대기 시간(분) */
export const DELAY_STEP_MINUTES = 30

export const waitings = {
  async listByUser(userId: string): Promise<Waiting[]> {
    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('waitings')
        .select('*, place:places(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Waiting[]
    }
    return readDb()
      .waitings.filter((w) => w.user_id === userId)
      .map((w) => ({ ...w, place: SEED_PLACES.find((p) => p.id === w.place_id) }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },

  /** 현재 진행 중인 웨이팅 — 홈 하단 플로팅 바가 이 값을 구독한다 */
  async active(userId: string): Promise<Waiting | null> {
    const all = await waitings.listByUser(userId)
    return all.find((w) => w.status === 'waiting' || w.status === 'called') ?? null
  },

  async create(input: {
    user_id: string
    place_id: string
    party_size: number
    ahead_count: number
  }): Promise<Waiting> {
    // DB 에 사용자당 진행 중 웨이팅 1건 유니크 인덱스가 걸려 있다.
    // 여기서 먼저 막지 않으면 Supabase 모드에서만 제약 위반 에러가 터진다.
    const existing = await waitings.active(input.user_id)
    if (existing) throw new ActiveWaitingExistsError(existing)

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('waitings')
        .insert({ ...input, delay_count: 0, extra_minutes: 0, status: 'waiting' })
        .select('*, place:places(*)')
        .single()
      if (error) throw error
      return data as Waiting
    }
    const row: Waiting = {
      id: uid('wait'),
      delay_count: 0,
      extra_minutes: 0,
      status: 'waiting',
      created_at: nowIso(),
      ...input,
    }
    mutateDb((d) => void d.waitings.push(row))
    return { ...row, place: SEED_PLACES.find((p) => p.id === row.place_id) }
  },

  /**
   * '미루기' — 단순 순서 변경이 아니라 대기 시간 +30분을 수치로 연산해 반영한다.
   * @returns 갱신된 웨이팅. 하루 한도 초과 시 null.
   */
  async delay(id: string): Promise<Waiting | null> {
    const current = isSupabaseConfigured
      ? ((
          await sb().from('waitings').select('*, place:places(*)').eq('id', id).maybeSingle()
        ).data as Waiting | null)
      : (readDb().waitings.find((w) => w.id === id) ?? null)

    if (!current || current.delay_count >= MAX_DELAY_PER_DAY) return null

    const patch = {
      delay_count: current.delay_count + 1,
      extra_minutes: current.extra_minutes + DELAY_STEP_MINUTES,
      // 미룬 만큼 뒤 팀에게 순서를 양보한다
      ahead_count: current.ahead_count + 2,
    }

    if (isSupabaseConfigured) {
      const { data, error } = await sb()
        .from('waitings')
        .update(patch)
        .eq('id', id)
        .select('*, place:places(*)')
        .single()
      if (error) throw error
      return data as Waiting
    }

    let updated: Waiting | null = null
    mutateDb((d) => {
      const i = d.waitings.findIndex((w) => w.id === id)
      if (i >= 0) {
        d.waitings[i] = { ...d.waitings[i], ...patch }
        updated = d.waitings[i]
      }
    })
    return updated
      ? { ...(updated as Waiting), place: SEED_PLACES.find((p) => p.id === current.place_id) }
      : null
  },

  async cancel(id: string): Promise<void> {
    if (isSupabaseConfigured) {
      const { error } = await sb().from('waitings').update({ status: 'cancelled' }).eq('id', id)
      if (error) throw error
      return
    }
    mutateDb((d) => {
      const i = d.waitings.findIndex((w) => w.id === id)
      if (i >= 0) d.waitings[i] = { ...d.waitings[i], status: 'cancelled' }
    })
  },
}
