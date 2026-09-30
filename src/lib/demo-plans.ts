import { SEED_PLACES } from './seed'
import type { SharedPlanItem } from './types'
import type { StoredSharedPlan } from './local-store'

/**
 * 데모 모드의 공용 플랜.
 *
 * `seed.ts` 에 넣지 않는다 — 그 파일은 `load.mjs` 가 통째로 다시 쓰므로 손으로
 * 넣은 플랜이 재수집 때마다 사라진다. 대신 여기서 데모 카탈로그를 읽어
 * *계산해서* 만든다. 장소 id 가 바뀌어도 따라간다.
 *
 * 운영자 플랜 2개와 사용자 플랜 1개를 만든다 — 두 출처가 리스트에서 어떻게
 * 다르게 보이는지가 데모의 핵심이기 때문이다.
 */

const DEMO_AUTHOR_ID = 'demo-user'

/** 데모 카탈로그에서 장소가 넉넉한 시군구를 앞에서부터 고른다 */
function pickLeaves(count: number, perPlan: number) {
  const byLeaf = new Map<string, typeof SEED_PLACES>()
  for (const p of SEED_PLACES) {
    if (p.tour_sigungu_code < 0) continue
    const key = `${p.tour_area_code}-${p.tour_sigungu_code}`
    const bucket = byLeaf.get(key)
    if (bucket) bucket.push(p)
    else byLeaf.set(key, [p])
  }
  return [...byLeaf.values()].filter((v) => v.length >= perPlan).slice(0, count)
}

const TEMPLATES = [
  {
    origin: 'admin' as const,
    title: '반나절 먹고 걷기',
    description: '점심 먹고 커피 한 잔 한 뒤 가까운 명소까지 걸어서 도는 코스입니다.',
    transport: 'walk' as const,
    companions: ['friends' as const],
    start: '11:30',
    end: '17:00',
  },
  {
    origin: 'admin' as const,
    title: '느긋한 하루',
    description: '이동을 줄이고 한 동네에서 오래 머무는 코스입니다. 처음 와 보는 분께 권합니다.',
    transport: 'transit' as const,
    companions: ['couple' as const],
    start: '10:00',
    end: '18:00',
  },
  {
    origin: 'user' as const,
    title: '지난 주말에 다녀온 길',
    description: '친구랑 실제로 돌았던 순서 그대로입니다. 두 번째 집이 제일 좋았어요.',
    transport: 'car' as const,
    companions: ['friends' as const, 'solo' as const],
    start: '12:00',
    end: '20:00',
  },
]

const PLACES_PER_PLAN = 3

function build(): { plans: StoredSharedPlan[]; items: SharedPlanItem[] } {
  const leaves = pickLeaves(TEMPLATES.length, PLACES_PER_PLAN)
  const plans: StoredSharedPlan[] = []
  const items: SharedPlanItem[] = []

  leaves.forEach((bucket, i) => {
    const t = TEMPLATES[i]
    const id = `demo-plan-${i + 1}`
    const picked = bucket.slice(0, PLACES_PER_PLAN)
    const head = picked[0]

    plans.push({
      id,
      origin: t.origin,
      author_user_id: t.origin === 'admin' ? null : DEMO_AUTHOR_ID,
      title: `${head.region_name} ${t.title}`,
      description: t.description,
      tour_area_code: head.tour_area_code,
      tour_sigungu_code: head.tour_sigungu_code,
      transport: t.transport,
      companions: [...t.companions],
      start_time: t.start,
      end_time: t.end,
      weekday: null,
      season: null,
      place_count: picked.length,
      duration_minutes: null,
      // 사용자 플랜만 다녀온 것으로 둔다 — 배지가 붙은 카드와 안 붙은 카드를
      // 데모에서 나란히 볼 수 있어야 한다
      was_visited: t.origin === 'user',
      clone_count: [12, 5, 3][i] ?? 0,
      is_hidden: false,
      hidden_reason: null,
      source_trip_id: null,
      source_updated_at: null,
      created_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
    })

    picked.forEach((p, j) => {
      items.push({
        id: `${id}-item-${j + 1}`,
        plan_id: id,
        place_id: p.id,
        sort_order: j,
        planned_time: `${String(Number(t.start.slice(0, 2)) + j * 2).padStart(2, '0')}:00`,
        tip: j === 0 ? '문 여는 시간에 맞춰 가면 덜 기다립니다.' : null,
      })
    })
  })

  return { plans, items }
}

export const DEMO_PLANS = build()
