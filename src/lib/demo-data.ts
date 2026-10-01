import type { Place, Region, RegionGroup, SharedPlanItem } from './types'
import type { StoredSharedPlan } from './local-store'

/**
 * 데모 데이터를 담아 두는 자리.
 *
 * `seed.ts` 는 124KB 짜리 생성물이고 **데모 모드에서만** 쓰이는데, 예전에는
 * `db.ts` 가 그걸 정적으로 import 해서 Supabase 에 붙어 도는 운영 번들에도
 * 통째로 실려 나갔다. 평생 쓰이지 않을 데이터를 모든 사용자가 내려받고 있었다.
 *
 * 그래서 import 를 동적으로 바꾸고 결과를 여기 담는다. Vite 가 `seed.ts` 를
 * 별도 청크로 떼어 내므로 운영 번들에서는 사라지고, 데모 모드에서만 받아 온다.
 *
 * 읽는 쪽(`db.ts`)은 전부 동기 코드다. 그래서 **화면을 그리기 전에** 채워야
 * 한다 — `main.tsx` 가 데모 모드일 때만 `loadDemoData()` 를 await 한다.
 * 운영 모드에서는 호출되지 않고 아래 값들은 빈 채로 남는다.
 */
export interface DemoData {
  places: Place[]
  regions: Region[]
  groups: RegionGroup[]
  plans: StoredSharedPlan[]
  planItems: SharedPlanItem[]
}

const EMPTY: DemoData = { places: [], regions: [], groups: [], plans: [], planItems: [] }

export let demo: DemoData = EMPTY

let loading: Promise<DemoData> | null = null

/** 한 번만 받아 온다. 여러 번 불러도 같은 약속을 돌려준다 */
export function loadDemoData(): Promise<DemoData> {
  loading ??= (async () => {
    const [seed, demoPlans] = await Promise.all([import('./seed'), import('./demo-plans')])
    const built = demoPlans.buildDemoPlans(seed.SEED_PLACES)
    demo = {
      places: seed.SEED_PLACES,
      regions: seed.DEMO_REGIONS,
      groups: seed.DEMO_REGION_GROUPS,
      plans: built.plans,
      planItems: built.items,
    }
    return demo
  })()
  return loading
}
