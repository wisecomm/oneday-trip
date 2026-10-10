import { optimizeOrder, routeDistanceKm, type LatLng } from '@/lib/geo'

/*
 * 동선 최적화 규칙 — 플로챠트/동선-최적화.md 의 규칙 표.
 *
 * [RT-…] 는 문서 규칙 표의 ID 칸과 같다 — 바꾸면 문서 · 이 파일 · route.test.ts 를 같은 커밋에서 고친다.
 */

/** [RT-OPT-MIN] 경로 최적화는 이만큼 이상일 때만 — 2곳 이하는 순서가 하나뿐이라 효과가 없다 */
export const MIN_STOPS_TO_OPTIMIZE = 3

/** [RT-OPT-GAIN] 이보다 덜 줄면 '이미 최단 동선' — 저장할 것이 없다(km) */
export const MIN_GAIN_KM = 0.05

export interface OptimizeResult {
  /** 입력 배열에 대한 새 방문 순서(인덱스) */
  order: number[]
  beforeKm: number
  afterKm: number
  /** MIN_GAIN_KM 넘게 줄었나 — 그래야 '순서 저장하기'가 켜진다 */
  improved: boolean
}

/**
 * [RT-OPT] 최단 동선 — 첫 장소는 출발점으로 고정, 최근접 이웃 → 2-opt(optimizeOrder).
 * 돌아오는 길은 세지 않는 열린 경로. 3곳 미만이면 null.
 */
export function optimizeStops(stops: readonly LatLng[]): OptimizeResult | null {
  if (stops.length < MIN_STOPS_TO_OPTIMIZE) return null
  const beforeKm = routeDistanceKm([...stops])
  const order = optimizeOrder([...stops])
  const afterKm = routeDistanceKm(order.map((i) => stops[i]))
  return { order, beforeKm, afterKm, improved: afterKm < beforeKm - MIN_GAIN_KM }
}

/**
 * [RT-UNSAVED] 저장 안 한 순서를 되살릴까 — 뒤로 가기로 돌아왔고(cameBack) 같은 여행의 같은 항목들일
 * 때만. 타임라인에서 새로 들어오면(cameBack false) 저장 안 하고 나간 것이라 버린다.
 */
export function canRestoreUnsaved(
  draft: { tripId: string; itemIds: readonly string[] } | null,
  tripId: string,
  currentIds: readonly string[],
  cameBack: boolean,
): boolean {
  if (!cameBack || !draft || draft.tripId !== tripId) return false
  if (draft.itemIds.length !== currentIds.length) return false
  const current = new Set(currentIds)
  return draft.itemIds.every((id) => current.has(id))
}
