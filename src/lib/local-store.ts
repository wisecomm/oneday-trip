import type { Profile, Reservation, Trip, TripItem } from './types'

/**
 * 데모 모드 저장소.
 * Supabase 자격 증명이 없을 때 동일한 테이블 구조를 localStorage 위에서 재현한다.
 */
export interface LocalDb {
  profiles: Profile[]
  trips: Trip[]
  trip_items: TripItem[]
  reservations: Reservation[]
}

const KEY = 'oneday-trip:db'

const EMPTY: LocalDb = {
  profiles: [],
  trips: [],
  trip_items: [],
  reservations: [],
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
