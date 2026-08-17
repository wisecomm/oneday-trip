import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { waitings } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import type { Waiting } from '@/lib/types'

/**
 * RSV-05-02: 진행 중인 원격 웨이팅을 앱 전역에서 구독한다.
 * 신청이 완료되면 홈 하단 플로팅 바가 '대기순서 확인' 상태로 실시간 전이한다.
 */
interface WaitingValue {
  active: Waiting | null
  loading: boolean
  refresh: () => Promise<void>
}

const WaitingContext = createContext<WaitingValue | null>(null)

export function WaitingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [active, setActive] = useState<Waiting | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setActive(null)
      return
    }
    setLoading(true)
    try {
      setActive(await waitings.active(user.id))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo(() => ({ active, loading, refresh }), [active, loading, refresh])
  return <WaitingContext.Provider value={value}>{children}</WaitingContext.Provider>
}

export function useWaiting(): WaitingValue {
  const ctx = useContext(WaitingContext)
  if (!ctx) throw new Error('useWaiting must be used within <WaitingProvider>')
  return ctx
}

/**
 * 대기 예상 시간(분) = 앞 팀 수 × 팀당 회전 시간 + 미루기로 누적된 추가 시간.
 * '미루기'를 순서 변경이 아닌 시간 수치로 보여주기 위한 계산식이다.
 */
export const MINUTES_PER_TEAM = 7

export function estimatedWaitMinutes(w: Waiting): number {
  return w.ahead_count * MINUTES_PER_TEAM + w.extra_minutes
}
