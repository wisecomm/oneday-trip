import { TRANSPORT_SPEED_KMH, type Transport } from './types'

export interface LatLng {
  lat: number
  lng: number
}

/** 두 좌표 사이의 대권 거리(km) — Haversine */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * TRIP-02-02: 이동 수단에 따른 가상 이동 경로 소요 시간(분).
 * 직선 거리에 1.3배의 우회 계수를 적용해 실제 도로 거리를 근사한다.
 */
export function travelMinutes(a: LatLng, b: LatLng, transport: Transport): number {
  const km = distanceKm(a, b) * 1.3
  return Math.max(1, Math.round((km / TRANSPORT_SPEED_KMH[transport]) * 60))
}

/** 경로 전체의 이동 거리(km) 합계 */
export function routeDistanceKm(points: LatLng[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i += 1) sum += distanceKm(points[i - 1], points[i])
  return sum
}

/** 경로 전체의 이동 소요 시간(분) 합계 */
export function routeMinutes(points: LatLng[], transport: Transport): number {
  let sum = 0
  for (let i = 1; i < points.length; i += 1) sum += travelMinutes(points[i - 1], points[i], transport)
  return sum
}

/**
 * TRIP-03-02: 동선 최적화.
 * 첫 장소를 출발점으로 고정한 뒤 최근접 이웃(Nearest Neighbour)으로 순서를 만들고,
 * 2-opt 교환으로 교차 구간을 펴서 개선한다. 당일치기라 방문지가 보통 소수라
 * 이 조합만으로 사실상 최적해에 도달한다.
 *
 * @returns 입력 배열에 대한 방문 순서 인덱스
 */
export function optimizeOrder<T extends LatLng>(points: T[]): number[] {
  const n = points.length
  if (n <= 2) return points.map((_, i) => i)

  // 1) 최근접 이웃으로 초기 경로 구성
  const visited = new Array<boolean>(n).fill(false)
  const order: number[] = [0]
  visited[0] = true
  for (let step = 1; step < n; step += 1) {
    const last = order[order.length - 1]
    let best = -1
    let bestDist = Infinity
    for (let i = 0; i < n; i += 1) {
      if (visited[i]) continue
      const d = distanceKm(points[last], points[i])
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    order.push(best)
    visited[best] = true
  }

  // 2) 2-opt 개선 — 출발점(index 0)은 고정
  const dist = (a: number, b: number) => distanceKm(points[order[a]], points[order[b]])
  let improved = true
  let guard = 0
  while (improved && guard < 50) {
    improved = false
    guard += 1
    for (let i = 1; i < n - 1; i += 1) {
      for (let k = i + 1; k < n; k += 1) {
        const before = dist(i - 1, i) + (k + 1 < n ? dist(k, k + 1) : 0)
        const after = dist(i - 1, k) + (k + 1 < n ? dist(i, k + 1) : 0)
        if (after < before - 1e-9) {
          const segment = order.slice(i, k + 1).reverse()
          order.splice(i, segment.length, ...segment)
          improved = true
        }
      }
    }
  }

  return order
}

export interface Insets {
  top: number
  right: number
  bottom: number
  left: number
}

/** 위경도 배열을 SVG 뷰포트 좌표로 정규화 (지도 API 미설정 시 폴백 렌더링용) */
export function projectToViewport(
  points: LatLng[],
  width: number,
  height: number,
  insets: Insets,
): Array<{ x: number; y: number }> {
  if (points.length === 0) return []
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const spanLat = Math.max(maxLat - minLat, 1e-4)
  const spanLng = Math.max(maxLng - minLng, 1e-4)
  const w = Math.max(1, width - insets.left - insets.right)
  const h = Math.max(1, height - insets.top - insets.bottom)

  // 위도에 따라 경도 1도의 실제 거리가 줄어드는 것을 보정한다 (정거원통도법)
  const midLat = (minLat + maxLat) / 2
  const lngScale = Math.cos((midLat * Math.PI) / 180)
  const spanX = spanLng * lngScale

  // 축별로 늘이면 지형이 왜곡되므로, 두 축에 같은 배율을 적용하고 남는 공간은 가운데 정렬한다
  const scale = Math.min(w / spanX, h / spanLat)
  const offsetX = insets.left + (w - spanX * scale) / 2
  const offsetY = insets.top + (h - spanLat * scale) / 2

  return points.map((p) => ({
    x: offsetX + (p.lng - minLng) * lngScale * scale,
    // 위도는 위쪽이 큰 값이므로 y축을 뒤집는다
    y: offsetY + (maxLat - p.lat) * scale,
  }))
}
