import { useEffect, useState } from 'react'
import { regionGroups as regionGroupsApi, regions as regionsApi } from '@/lib/db'
import type { Region, RegionGroup } from '@/lib/types'

/**
 * 목적지 지역 목록 — 상위(시/도) · 하위(구/시) 2단.
 * region_groups/regions 테이블에서 불러오므로, 지역을 추가·수정해도 앱을
 * 재배포할 필요가 없다.
 *
 * 하위 지역은 group_name 으로 상위 지역에 속한 것만 걸러 쓴다:
 *   regions.filter((r) => r.group_name === selectedGroup)
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
