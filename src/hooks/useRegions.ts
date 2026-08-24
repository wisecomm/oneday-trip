import { useEffect, useState } from 'react'
import { regions as regionsApi } from '@/lib/db'
import type { Region } from '@/lib/types'

/**
 * 목적지 지역 목록.
 * regions 테이블에서 불러오므로, 지역을 추가·수정해도 앱을 재배포할 필요가 없다.
 */
export function useRegions(): { regions: Region[]; loading: boolean } {
  const [regions, setRegions] = useState<Region[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void regionsApi.list().then((list) => {
      if (!alive) return
      setRegions(list)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  return { regions, loading }
}
