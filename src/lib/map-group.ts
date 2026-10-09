import type { Place } from './types'

/**
 * 장소가 max 곳을 넘으면 주변끼리 묶어 대표 1곳씩만 남긴다 — 돌려주는 Map 은 대표 id → 묶인 곳 수.
 *
 * 장소들이 차지한 범위를 정사각형 칸(경도는 cos(위도)로 보정)으로 나눠 같은 칸끼리 묶는다.
 * 대표가 max 이하가 되는 가장 잘은 칸을 이분 탐색으로 찾는다 — 한 변을 √max − 1 칸 이하로
 * 나누면 칸 수가 max 를 넘을 수 없어 늘 답이 있다. 대표는 리뷰 많은 곳 → 평균 높은 곳 → id 순.
 */
export function groupRepresentatives(places: Place[], max: number): Map<string, number> {
  const result = new Map<string, number>()
  if (places.length <= max) {
    for (const p of places) result.set(p.id, 1)
    return result
  }
  const lats = places.map((p) => p.lat)
  const lngs = places.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const minLng = Math.min(...lngs)
  const lngScale = Math.cos((((minLat + Math.max(...lats)) / 2) * Math.PI) / 180)
  const span = Math.max(Math.max(...lats) - minLat, (Math.max(...lngs) - minLng) * lngScale, 1e-6)
  const better = (a: Place, b: Place) =>
    b.rating_count - a.rating_count ||
    (b.rating_avg ?? -1) - (a.rating_avg ?? -1) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const group = (k: number) => {
    const cell = span / k
    const cells = new Map<string, { rep: Place; n: number }>()
    for (const p of places) {
      const key = `${Math.floor((p.lat - minLat) / cell)}:${Math.floor(((p.lng - minLng) * lngScale) / cell)}`
      const c = cells.get(key)
      if (!c) cells.set(key, { rep: p, n: 1 })
      else {
        c.n += 1
        if (better(p, c.rep) < 0) c.rep = p
      }
    }
    return cells
  }

  // 대표가 max 이하인 가장 잘게 나눈 칸 수 k 를 이분 탐색으로 찾는다. k 가 √max − 1 이하면
  // 칸이 (k+1)² ≤ max 개를 넘을 수 없으니 그 값은 늘 된다(lo).
  let lo = Math.max(1, Math.floor(Math.sqrt(max)) - 1)
  let hi = Math.ceil(Math.sqrt(places.length)) * 4
  let best = group(lo)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const cells = group(mid)
    if (cells.size <= max) {
      lo = mid
      best = cells
    } else hi = mid - 1
  }
  for (const { rep, n } of best.values()) result.set(rep.id, n)
  return result
}
