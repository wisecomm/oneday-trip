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

/**
 * 하루 거리 (README-플로챠트.md ❷) — 편도 2시간을 직선 약 120km 로 본다.
 * DB 함수 home_picks 도 같은 값을 쓴다. 바꾸면 두 곳을 함께 바꾼다.
 */
export const DAY_TRIP_RADIUS_KM = 120

/**
 * 도시 사이 이동의 평균 속도(km/h). 고속도로 · KTX 를 섞은 값이다.
 *
 * 처음부터 끝까지 이 속도로 나누면 가까운 곳이 비현실적으로 짧아진다 — 1km 가
 * '차로 약 1분'. 그래서 출발 뒤 CITY_LEG_KM 까지는 시내 속도(차 30km/h)로,
 * 나머지만 이 속도로 계산한다. 반대로 시내 속도만 쓰면 '편도 2시간'이 46km 로
 * 줄어든다.
 */
const INTERCITY_SPEED_KMH = 80

/** 출발 뒤 이 거리(도로 km)까지는 시내를 빠져나가는 구간으로 보고 시내 속도로 계산한다 */
const CITY_LEG_KM = 10

/** 걸어서 이 시간(분) 안이면 차 대신 도보로 보여 준다 */
const WALK_MAX_MINUTES = 15

export interface DayTripTravel {
  mode: 'walk' | 'car'
  minutes: number
}

/**
 * 기준점에서 그 장소까지의 대략 이동 시간 (홈 '하루에 다녀올 만한 곳' 카드).
 *
 *   도로 거리 = 직선 × 1.3 (travelMinutes 와 같은 우회 계수)
 *   걸어서 15분 안   → 도보 (4km/h)
 *   그보다 멀면      → 차. 처음 10km 는 30km/h, 나머지는 80km/h
 *
 * 30분이 넘으면 5분 단위로 반올림한다 — '약 2시간 7분' 같은 정밀함은 거짓이다.
 */
export function dayTripTravel(from: LatLng, to: LatLng): DayTripTravel {
  const road = distanceKm(from, to) * 1.3
  const walk = (road / TRANSPORT_SPEED_KMH.walk) * 60
  if (walk <= WALK_MAX_MINUTES) return { mode: 'walk', minutes: Math.max(1, Math.round(walk)) }

  const city = Math.min(road, CITY_LEG_KM)
  const raw = (city / TRANSPORT_SPEED_KMH.car) * 60 + ((road - city) / INTERCITY_SPEED_KMH) * 60
  const minutes = raw >= 30 ? Math.round(raw / 5) * 5 : Math.max(1, Math.round(raw))
  return { mode: 'car', minutes }
}

/** 65 → '약 1시간 5분', 40 → '약 40분', 120 → '약 2시간' */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `약 ${minutes}분`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `약 ${h}시간` : `약 ${h}시간 ${m}분`
}

/** 위치를 못 얻은 까닭 — 화면이 안내 문구를 고르는 데 쓴다 */
export type LocateFailure = 'denied' | 'timeout' | 'unavailable' | 'unsupported'

export type LocateResult = { at: LatLng; reason: null } | { at: null; reason: LocateFailure }

/**
 * 내 위치를 쓰는 화면(홈 · 지도)이 같은 말을 쓰도록 문구를 한곳에 둔다.
 * 버튼: 홈은 '↻ 다시 찾기'(기준 표시 옆이라 짧게), 지도는 '↻ 내 위치 다시 찾기'
 * (지도 위에 혼자 떠 있어 무엇을 찾는지 적는다). 찾는 동안은 둘 다 '찾는 중…'.
 */
export const LOCATE_LABEL = {
  finding: '찾는 중…',
  refind: '↻ 다시 찾기',
  refindMine: '↻ 내 위치 다시 찾기',
  here: '📍 현재 위치 기준',
  nearMe: '📍 내 위치 주변',
} as const

/** 못 얻은 까닭 — 짧은 한 마디 */
export const LOCATE_FAILURE_TEXT: Record<LocateFailure, string> = {
  denied: '위치 권한이 꺼져 있어요',
  timeout: '위치를 찾지 못했어요',
  unavailable: '위치를 찾지 못했어요',
  unsupported: '이 브라우저는 위치를 쓸 수 없어요',
}

/** 권한이 꺼져 있으면 다시 눌러도 브라우저가 묻지 않는다 — 켜는 곳을 알려 준다 */
export const LOCATE_SETTINGS_HINT = '브라우저 설정 → 사이트 설정 → 위치에서 이 사이트를 허용한 뒤 다시 찾아 주세요.'

/**
 * 현재 위치와, 못 얻었다면 그 까닭.
 *
 * 브라우저의 timeout 옵션은 권한 창이 떠 있는 동안에는 흐르지 않는다. 그래서
 * 따로 타이머를 걸어 권한 창을 포함해 timeoutMs 가 지나면 끝낸다 — 그 뒤에
 * 허용하면 다음 호출(화면의 '다시 찾기' 등)부터 쓴다.
 *
 * fresh 면 브라우저가 기억해 둔 위치를 쓰지 않고 새로 잰다(사용자가 직접 다시 찾을 때).
 * 아니면 10분 안에 잰 위치를 그대로 쓴다.
 */
export function locate(timeoutMs: number, { fresh = false }: { fresh?: boolean } = {}): Promise<LocateResult> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve({ at: null, reason: 'unsupported' })
      return
    }
    const timer = setTimeout(() => resolve({ at: null, reason: 'timeout' }), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        clearTimeout(timer)
        resolve({ at: { lat: coords.latitude, lng: coords.longitude }, reason: null })
      },
      (err) => {
        clearTimeout(timer)
        resolve({
          at: null,
          reason:
            err.code === err.PERMISSION_DENIED ? 'denied' : err.code === err.TIMEOUT ? 'timeout' : 'unavailable',
        })
      },
      { timeout: timeoutMs, maximumAge: fresh ? 0 : 10 * 60 * 1000 },
    )
  })
}

/** 현재 위치. 권한 거부 · 미지원 · timeoutMs 안에 응답이 없으면 null */
export function currentPosition(timeoutMs: number): Promise<LatLng | null> {
  return locate(timeoutMs).then((r) => r.at)
}
