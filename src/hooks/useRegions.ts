import { useEffect, useState } from 'react'
import { regionGroups as regionGroupsApi, regions as regionsApi } from '@/lib/db'
import type { Region, RegionGroup } from '@/lib/types'

/**
 * 목적지 지역 목록 — 상위(시/도) · 하위(시군구) 2단.
 * region_groups/regions 테이블에서 불러오므로, 지역을 추가·수정해도 앱을
 * 재배포할 필요가 없다.
 *
 * 키가 이름이 아니라 코드이므로, 하위 지역은 코드로 걸러 쓴다:
 *   regions.filter((r) => r.tour_area_code === selectedAreaCode)
 *
 * 미판정 지역(코드 -1)은 db 계층에서 이미 걸러져 여기 오지 않는다.
 */
export function useRegions(): {
  groups: RegionGroup[]
  regions: Region[]
  loading: boolean
} {
  const [groups, setGroups] = useState<RegionGroup[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void Promise.all([regionGroupsApi.list(), regionsApi.list()]).then(([g, r]) => {
      if (!alive) return
      setGroups(g)
      setRegions(r)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  return { groups, regions, loading }
}
