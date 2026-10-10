import { describe, expect, it } from 'vitest'
import { routeDistanceKm } from '@/lib/geo'
import { MIN_GAIN_KM, MIN_STOPS_TO_OPTIMIZE, canRestoreUnsaved, optimizeStops } from './route'

/*
 * 플로챠트/동선-최적화.md 규칙 표를 그대로 옮긴 검사. 테스트 이름 앞의 [RT-…] 가 문서 ID 칸과 같다.
 */

// 서울 시내 한 줄로 늘어선 다섯 곳 — 동쪽으로 1km 쯤씩
const line = [0, 1, 2, 3, 4].map((i) => ({ lat: 37.5, lng: 127.0 + i * 0.0113 }))

describe('[RT-OPT-MIN] 3곳 이상일 때만', () => {
  it('기준 상수', () => {
    expect(MIN_STOPS_TO_OPTIMIZE).toBe(3)
  })
  it('2곳 이하는 최적화하지 않는다', () => {
    expect(optimizeStops(line.slice(0, 2))).toBeNull()
  })
})

describe('[RT-OPT] 최단 동선 — 첫 장소 고정 · 열린 경로', () => {
  it('뒤섞인 순서를 펴서 거리를 줄인다', () => {
    const shuffled = [line[0], line[3], line[1], line[4], line[2]]
    const r = optimizeStops(shuffled)!
    expect(r.order[0]).toBe(0) // 출발점 그대로
    expect(r.afterKm).toBeLessThan(r.beforeKm)
    expect(r.afterKm).toBeCloseTo(routeDistanceKm(line), 6) // 한 줄로 도는 것이 최단
    expect([...r.order].sort()).toEqual([0, 1, 2, 3, 4]) // 빠짐없이 한 번씩
  })
  it('[RT-OPT-GAIN] 0.05km 넘게 줄어야 저장할 것이 있다', () => {
    expect(MIN_GAIN_KM).toBe(0.05)
    expect(optimizeStops([line[0], line[3], line[1], line[4], line[2]])!.improved).toBe(true)
    expect(optimizeStops(line)!.improved).toBe(false) // 이미 최단
  })
})

describe('[RT-UNSAVED] 저장 안 한 순서 되살리기', () => {
  const draft = { tripId: 't1', itemIds: ['b', 'a', 'c'] }
  it('뒤로 가기로 돌아왔고 같은 항목이면 되살린다(순서는 달라도 된다)', () => {
    expect(canRestoreUnsaved(draft, 't1', ['a', 'b', 'c'], true)).toBe(true)
  })
  it('타임라인에서 새로 들어오면 버린다', () => {
    expect(canRestoreUnsaved(draft, 't1', ['a', 'b', 'c'], false)).toBe(false)
  })
  it('다른 여행이거나 항목이 바뀌었으면 버린다', () => {
    expect(canRestoreUnsaved(draft, 't2', ['a', 'b', 'c'], true)).toBe(false)
    expect(canRestoreUnsaved(draft, 't1', ['a', 'b'], true)).toBe(false)
    expect(canRestoreUnsaved(draft, 't1', ['a', 'b', 'd'], true)).toBe(false)
  })
  it('기억한 것이 없으면 버린다', () => {
    expect(canRestoreUnsaved(null, 't1', ['a'], true)).toBe(false)
  })
})
