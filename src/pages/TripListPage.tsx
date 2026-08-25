import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { tripItems, trips } from '@/lib/db'
import { TRANSPORT_LABEL, type Trip } from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'
import { formatTripDate } from './TripCreatePage'

export function TripListPage() {
  const { user } = useAuth()
  const [list, setList] = useState<Trip[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const rows = await trips.list(user.id)
      setList(rows)
      const entries = await Promise.all(
        rows.map(async (t) => [t.id, (await tripItems.listByTrip(t.id)).length] as const),
      )
      setCounts(Object.fromEntries(entries))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(id: string) {
    if (!window.confirm('이 여행과 담긴 장소가 모두 삭제됩니다. 계속할까요?')) return
    await trips.remove(id)
    await load()
  }

  if (loading) return <Loading />

  return (
    <>
      <PageHeader
        title="마이 트립"
        right={
          <Link to="/trips/new" className="btn-primary !px-3 !py-1.5 text-[13px]">
            + 새 여행
          </Link>
        }
      />

      <div className="px-4 py-4">
        {list.length === 0 ? (
          <EmptyState
            icon="🧳"
            title="아직 만든 여행이 없습니다"
            description="여행 날짜와 목적지를 정하면 타임라인이 만들어집니다."
            action={
              <Link to="/trips/new" className="btn-primary">
                여행 일정 만들기
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((t) => (
              <li key={t.id} className="card p-4">
                <Link to={`/trips/${t.id}`} className="block">
                  <p className="text-[16px] font-extrabold text-ink-800">{t.title}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-500">
                    {formatTripDate(t.trip_date)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="badge bg-ink-100 text-ink-600">
                      담은 장소 {counts[t.id] ?? 0}곳
                    </span>
                    <span className="badge bg-ink-100 text-ink-600">
                      {TRANSPORT_LABEL[t.transport]}
                    </span>
                  </div>
                </Link>
                <div className="mt-3 flex gap-2">
                  <Link
                    to={`/trips/${t.id}/route`}
                    className="btn-outline flex-1 !py-2 text-[13px]"
                  >
                    동선 보기
                  </Link>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    className="btn-ghost !px-3 !py-2 text-[13px] text-ink-500"
                  >
                    삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
