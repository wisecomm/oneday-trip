import { SEED_PLACES } from './seed'
import type { PlaceCategory, Profile, SharedPlanItem } from './types'
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

/**
 * 사용자 플랜의 작성자. 이 행이 없으면 닉네임을 찾지 못해 카드에 '알 수 없음'
 * 이 찍힌다 — 데모에서 사용자 플랜과 운영자 플랜을 구분해 보여 주는 게
 * 목적인데 그러면 구분이 안 된다.
 */
export const DEMO_AUTHOR_PROFILE: Profile = {
  id: DEMO_AUTHOR_ID,
  nickname: '하루여행자',
  taste_tags: [],
  role: 'user',
  created_at: new Date(0).toISOString(),
}

/**
 * 장소가 넉넉한 시군구를 고르되 **시/도가 겹치지 않게** 먼저 채운다.
 *
 * 그냥 앞에서부터 집으면 데모 카탈로그가 서울에 몰려 있어 셋 다 서울이 된다.
 * 지역 필터가 무슨 일을 하는지 데모에서 보이지 않는다.
 */
function pickLeaves(count: number, perPlan: number) {
  const byLeaf = new Map<string, typeof SEED_PLACES>()
  for (const p of SEED_PLACES) {
    if (p.tour_sigungu_code < 0) continue
    const key = `${p.tour_area_code}-${p.tour_sigungu_code}`
    const bucket = byLeaf.get(key)
    if (bucket) bucket.push(p)
    else byLeaf.set(key, [p])
  }
  const usable = [...byLeaf.values()].filter((v) => v.length >= perPlan)

  const picked: typeof usable = []
  const usedAreas = new Set<number>()
  for (const bucket of usable) {
    if (picked.length >= count) break
    const area = bucket[0].tour_area_code
    if (usedAreas.has(area)) continue
    usedAreas.add(area)
    picked.push(bucket)
  }
  // 시/도 수가 모자라면 남은 것으로 채운다
  for (const bucket of usable) {
    if (picked.length >= count) break
    if (!picked.includes(bucket)) picked.push(bucket)
  }
  return picked
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

/**
 * 하루 코스로 그럴듯한 순서. 앞에서부터 그냥 3곳을 집으면 데모 카탈로그가
 * 카테고리별로 뭉쳐 있어 밥집만 셋이 나온다 — 코스가 아니라 목록이 된다.
 */
const COURSE_SHAPE: PlaceCategory[] = ['babzip', 'cafe', 'spot']

/**
 * 'HH:MM' 에 시간을 더한다.
 *
 * 시(hh)만 더하면 11:30 시작인 플랜의 첫 항목이 11:00 이 되어 플랜 시작보다
 * 앞선다 — 분을 버리기 때문이다.
 */
function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = (h + hours) % 24
  return `${String(total).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 원하는 카테고리 순서대로 한 곳씩 뽑고, 모자라면 남은 것으로 채운다 */
function pickCourse(bucket: typeof SEED_PLACES): typeof SEED_PLACES {
  const picked: typeof SEED_PLACES = []
  for (const category of COURSE_SHAPE) {
    const next = bucket.find((p) => p.category === category && !picked.includes(p))
    if (next) picked.push(next)
  }
  for (const p of bucket) {
    if (picked.length >= PLACES_PER_PLAN) break
    if (!picked.includes(p)) picked.push(p)
  }
  return picked.slice(0, PLACES_PER_PLAN)
}

function build(): { plans: StoredSharedPlan[]; items: SharedPlanItem[] } {
  const leaves = pickLeaves(TEMPLATES.length, PLACES_PER_PLAN)
  const plans: StoredSharedPlan[] = []
  const items: SharedPlanItem[] = []

  leaves.forEach((bucket, i) => {
    const t = TEMPLATES[i]
    const id = `demo-plan-${i + 1}`
    const picked = pickCourse(bucket)
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
      // 데모에도 만족도를 넣어 둔다 — 세 번째는 평가가 없는 상태를 보여 준다
      rating_avg: [4.5, 4.0, null][i] ?? null,
      rating_count: [8, 3, 0][i] ?? 0,
      is_hidden: false,
      hidden_reason: null,
      created_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
      updated_at: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
    })

    picked.forEach((p, j) => {
      items.push({
        id: `${id}-item-${j + 1}`,
        plan_id: id,
        place_id: p.id,
        sort_order: j,
        planned_time: addHours(t.start, j * 2),
        tip: j === 0 ? '문 여는 시간에 맞춰 가면 덜 기다립니다.' : null,
      })
    })
  })

  return { plans, items }
}

export const DEMO_PLANS = build()
