import type { Place } from './types'

/*
 * 묶음 칸은 화면이 아니라 **지도에 고정된 격자**다. 가장 큰 칸(위도 GRID_BASE_DEG 도)에서
 * 한 단계 내려갈 때마다 칸을 정확히 넷으로 나눈다(가로 · 세로 반씩). 그래서
 *   - 확대하면 묶음이 갈라지기만 한다 — 대표는 그 칸 안에서 가장 나은 곳이라, 칸이 갈라져도
 *     자기가 든 작은 칸에서 여전히 가장 나은 곳이다. 확대했더니 대표가 사라지는 일이 없다.
 *   - 화면을 옮겨도 칸 경계가 따라 움직이지 않는다 — 같은 줌에서는 같은 대표.
 * 예전에는 화면 안 장소들의 범위를 기준으로 칸을 다시 그어, 확대하면 칸 경계가 바뀌어
 * 보이던 대표('용산역광장 +3')가 다른 칸의 대표에 밀려 숨는 일이 있었다.
 */

/** 가장 큰 칸 — 위도 8도(남한 전체가 칸 한두 개) */
const GRID_BASE_DEG = 8
/** 격자 기준점 — 남한 남서쪽 바다. 어디든 고정이면 된다 */
const GRID_ORIGIN = { lat: 32, lng: 124 }
/**
 * 경도 칸 너비 보정 — 위도 36도(남한 가운데)의 cos. 칸이 대략 정사각형이 되게.
 * 화면마다 바꾸면 격자가 움직이므로 고정값이다.
 */
const LNG_SCALE = Math.cos((36 * Math.PI) / 180)
/** 가장 잘게 나누는 단계 — 8도 / 2^20 ≈ 0.85m */
const MAX_LEVEL = 20

/** 대표 우선순위 — 리뷰 많은 곳 → 평균 높은 곳 → id. 항상 한 줄로 정해져야 칸이 갈라져도 대표가 그대로다 */
function better(a: Place, b: Place): number {
  return (
    b.rating_count - a.rating_count ||
    (b.rating_avg ?? -1) - (a.rating_avg ?? -1) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function groupAt(places: Place[], level: number) {
  const cell = GRID_BASE_DEG / 2 ** level
  const cells = new Map<string, { rep: Place; members: Place[] }>()
  for (const p of places) {
    const key = `${Math.floor((p.lat - GRID_ORIGIN.lat) / cell)}:${Math.floor(((p.lng - GRID_ORIGIN.lng) * LNG_SCALE) / cell)}`
    const c = cells.get(key)
    if (!c) cells.set(key, { rep: p, members: [p] })
    else {
      c.members.push(p)
      if (better(p, c.rep) < 0) c.rep = p
    }
  }
  return cells
}

/**
 * 장소가 max 곳을 넘으면 주변끼리 묶어 대표 1곳씩만 남긴다 — 돌려주는 Map 은 대표 id → 그 칸에
 * 묶인 장소들(대표가 맨 앞, 나머지는 대표 우선순위 순). '+N' 마커를 누르면 화면이 이 목록을 보여 준다.
 *
 * 고정 격자(위)에서 대표가 max 이하가 되는 가장 잘은 단계를 이분 탐색으로 찾는다 — 단계가 내려갈수록
 * 칸이 넷으로 갈라지기만 하니 칸 수는 단계에 따라 줄지 않는다. 가장 큰 칸(0단계)은 남한 전체가
 * 칸 한두 개라 늘 답이 있다. 대표는 리뷰 많은 곳 → 평균 높은 곳 → id 순.
 */
export function groupRepresentatives(places: Place[], max: number): Map<string, Place[]> {
  const result = new Map<string, Place[]>()
  if (places.length <= max) {
    for (const p of places) result.set(p.id, [p])
    return result
  }
  let lo = 0
  let hi = MAX_LEVEL
  let best = groupAt(places, 0)
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const cells = groupAt(places, mid)
    if (cells.size <= max) {
      lo = mid
      best = cells
    } else hi = mid - 1
  }
  for (const { rep, members } of best.values()) {
    result.set(rep.id, [rep, ...members.filter((m) => m !== rep).sort(better)])
  }
  return result
}
