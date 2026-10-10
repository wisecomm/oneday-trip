import { describe, expect, it } from 'vitest'
import { kstDate, upcomingTrip } from './trip-date'

describe('kstDate — 한국 날짜', () => {
  it('UTC 로는 전날이어도 한국 날짜', () => {
    expect(kstDate(0, new Date('2026-10-10T16:00:00Z'))).toBe('2026-10-11') // KST 10/11 01:00
  })
  it('며칠 뒤 — 월말 · 연말을 넘긴다', () => {
    expect(kstDate(7, new Date('2026-10-28T03:00:00Z'))).toBe('2026-11-04')
    expect(kstDate(7, new Date('2026-12-30T03:00:00Z'))).toBe('2027-01-06')
  })
  it('며칠 앞', () => {
    expect(kstDate(-1, new Date('2026-03-01T03:00:00Z'))).toBe('2026-02-28')
  })
})

describe('upcomingTrip — 오늘 이후 가장 빠른 여행', () => {
  const trips = [
    { id: 'past', trip_date: '2026-10-09' },
    { id: 'far', trip_date: '2026-12-01' },
    { id: 'today', trip_date: '2026-10-11' },
    { id: 'soon', trip_date: '2026-10-20' },
  ]
  it('오늘 여행도 다가오는 여행', () => {
    expect(upcomingTrip(trips, '2026-10-11')?.id).toBe('today')
  })
  it('지난 여행만 있으면 없음', () => {
    expect(upcomingTrip([trips[0]], '2026-10-11')).toBeNull()
  })
})
