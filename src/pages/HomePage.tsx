import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, reservations, trips } from '@/lib/db'
import type { Place, Reservation, Trip } from '@/lib/types'
import { PlaceCard } from '@/components/PlaceCard'
import { Loading } from '@/components/ui'
import { formatTripDate } from './TripCreatePage'

/**
 * 지역별로 고르게 섞어 count 개를 뽑는다.
 * rating 이 없거나 전부 0인 장소가 섞여 있으면(TourAPI 수집분) DB 의 rating
 * 정렬이 무의미해져 항상 같은 지역·카테고리 몇 곳만 노출되는 문제가 있었다.
 * 지역별 라운드로빈으로 뽑고 지역 내부는 매 호출마다 섞어, 한 지역이 결과를
 * 독차지하지 않고 새로고침마다 다른 곳이 보이게 한다.
 */
function pickSpread(places: Place[], count: number): Place[] {
  const byRegion = new Map<string, Place[]>()
  for (const p of places) {
    const bucket = byRegion.get(p.region) ?? []
    bucket.push(p)
    byRegion.set(p.region, bucket)
  }
  for (const bucket of byRegion.values()) {
    for (let i = bucket.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[bucket[i], bucket[j]] = [bucket[j], bucket[i]]
    }
  }

  const queues = [...byRegion.values()]
  const result: Place[] = []
  for (let round = 0; result.length < count && queues.some((q) => round < q.length); round += 1) {
    for (const q of queues) {
      if (result.length >= count) break
      if (round < q.length) result.push(q[round])
    }
  }
  return result
}

export function HomePage() {
  const { user, profile, isGuest } = useAuth()
  const [myTrips, setMyTrips] = useState<Trip[]>([])
  const [upcoming, setUpcoming] = useState<Reservation[]>([])
  const [popular, setPopular] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function load() {
      const [t, r, p] = await Promise.all([
        user ? trips.list(user.id) : Promise.resolve([]),
        user ? reservations.listByUser(user.id) : Promise.resolve([]),
        placesApi.list({}),
      ])
      if (!alive) return
      setMyTrips(t)
      setUpcoming(r.filter((x) => x.status === 'confirmed').slice(0, 2))
      // list() 는 rating 내림차순인데, TourAPI 로 들여온 장소는 rating 이 전부 0이라
      // 동점이다. 동점 처리 순서는 DB 가 보장해 주지 않고, 실제로는 삽입 순서를
      // 그대로 따라가 매번 같은 지역·카테고리 몇 곳만 뜨는 문제가 있었다.
      // '인기 있는 곳' 은 실제 순위가 없으므로, 지역별로 고르게 섞어 노출한다.
      setPopular(pickSpread(p, 5))
      setLoading(false)
    }
    void load()
    return () => {
      alive = false
    }
  }, [user])

  if (loading) return <Loading />

  const nextTrip = myTrips[0]

  return (
    <div className="px-4 pt-5">
      <header className="mb-5">
        <p className="text-[13px] font-semibold text-ink-500">
          {isGuest ? '둘러보는 중' : '안녕하세요'}
        </p>
        <h1 className="text-[22px] font-extrabold text-ink-900">
          {profile?.nickname ?? (user ? '여행자' : 'Guest')}님
        </h1>
      </header>

      {!user && (
        <div className="card mb-5 p-4">
          <p className="text-[14px] font-bold text-ink-800">가입하면 일정을 저장할 수 있어요</p>
          <p className="hint mt-1">지도 탐색은 로그인 없이도 가능합니다.</p>
          <Link to="/login" className="btn-primary mt-3 w-full">
            3초 만에 시작하기
          </Link>
        </div>
      )}

      {nextTrip ? (
        <Link to={`/trips/${nextTrip.id}`} className="card mb-5 block overflow-hidden">
          <div className="bg-gradient-to-br from-brand-500 to-brand-700 px-5 py-5 text-white">
            <p className="text-[12px] font-semibold text-brand-100">다가오는 여행</p>
            <p className="mt-1 text-[19px] font-extrabold">{nextTrip.title}</p>
            <p className="mt-1 text-[13px] text-brand-100">
              {formatTripDate(nextTrip.trip_date)}
            </p>
          </div>
          <div className="px-4 py-3 text-[13px] font-bold text-brand-600">
            타임라인 열기 →
          </div>
        </Link>
      ) : (
        user && (
          <Link to="/trips/new" className="card mb-5 flex items-center gap-3 p-4">
            <span className="text-2xl" aria-hidden>
              🧳
            </span>
            <div className="flex-1">
              <p className="text-[14.5px] font-bold text-ink-800">첫 여행 일정을 만들어 보세요</p>
              <p className="hint">날짜와 목적지만 정하면 타임라인이 자동 생성됩니다.</p>
            </div>
          </Link>
        )
      )}

      <section className="mb-6">
        <div className="grid grid-cols-3 gap-2.5">
          <QuickLink to="/map" icon="🗺️" label="여행 지도" desc="실시간 마커 탐색" />
          <QuickLink to="/recommend" icon="✨" label="AI 추천" desc="날씨·취향 맞춤" />
          <QuickLink to="/trips" icon="🧭" label="나의 여행" desc="동선 최적화" />
        </div>
      </section>

      {upcoming.length > 0 && (
        <section className="mb-6">
          <h2 className="section-title mb-3">예약 확정</h2>
          <ul className="flex flex-col gap-2">
            {upcoming.map((r) => (
              <li key={r.id} className="card flex items-center gap-3 p-3.5">
                <span className="text-xl" aria-hidden>
                  🎫
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold text-ink-800">{r.place?.name}</p>
                  <p className="text-[12.5px] text-ink-500">
                    {new Date(r.reserved_at).toLocaleString('ko-KR')} · {r.party_size}명
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">지금 인기 있는 곳</h2>
          <Link to="/map" className="text-[13px] font-semibold text-brand-600">
            지도에서 보기
          </Link>
        </div>
        <ul className="flex flex-col gap-2.5">
          {popular.map((p) => (
            <li key={p.id}>
              <Link to={`/places/${p.id}`} className="block">
                <PlaceCard place={p} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function QuickLink({
  to,
  icon,
  label,
  desc,
}: {
  to: string
  icon: string
  label: string
  desc: string
}) {
  return (
    <Link to={to} className="card flex flex-col gap-1 p-4">
      <span className="text-xl" aria-hidden>
        {icon}
      </span>
      <span className="text-[14px] font-bold text-ink-800">{label}</span>
      <span className="text-[11.5px] text-ink-500">{desc}</span>
    </Link>
  )
}
