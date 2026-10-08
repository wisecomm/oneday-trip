import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, regions as regionsApi, trips } from '@/lib/db'
import { currentPosition, dayTripTravel, formatDuration, type LatLng } from '@/lib/geo'
import { MIN_RATING_DISPLAY, type Place, type Trip } from '@/lib/types'
import { PlaceCard } from '@/components/PlaceCard'
import { Loading } from '@/components/ui'
import { formatTripDate } from '@/lib/trip-date'

export function HomePage() {
  const { user, profile, isGuest } = useAuth()
  const [myTrips, setMyTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  /**
   * '하루에 다녀올 만한 곳' (README-플로챠트.md).
   *
   * 화면이 열리면 위치를 묻는다. 거부 · 미지원 · 5초 안에 응답이 없으면 서울
   * 강남구 중심을 기준점으로 같은 흐름을 탄다. 이 섹션은 위치를 기다리느라 늦을
   * 수 있어 나머지 홈과 따로 불러온다 — 기다리는 동안 다가오는 여행은 먼저 보인다.
   */
  const [picks, setPicks] = useState<Place[]>([])
  const [picksLoading, setPicksLoading] = useState(true)
  const [origin, setOrigin] = useState<LatLng | null>(null)

  useEffect(() => {
    let alive = true
    async function loadPicks() {
      try {
        let base = await currentPosition(5000)
        if (!base) {
          // 강남 좌표는 코드에 적지 않고 지역 표의 (서울 1, 강남구 1) 에서 읽는다
          const all = await regionsApi.list()
          const gangnam = all.find((r) => r.tour_area_code === 1 && r.tour_sigungu_code === 1)
          base = gangnam ? { lat: gangnam.lat, lng: gangnam.lng } : null
        }
        const list = await placesApi.homePicks(base, 5)
        if (!alive) return
        setOrigin(base)
        setPicks(list)
      } catch (err) {
        console.error('[Home] 하루에 다녀올 만한 곳을 불러오지 못했습니다.', err)
      } finally {
        if (alive) setPicksLoading(false)
      }
    }
    void loadPicks()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const t = user ? await trips.list(user.id) : []
        if (!alive) return
        setMyTrips(t)
      } catch (err) {
        // 여기서 멈추면 화면이 스피너에 갇힌다. 빈 홈이라도 보여주는 편이 낫다.
        console.error('[Home] 홈 데이터를 불러오지 못했습니다.', err)
      } finally {
        if (alive) setLoading(false)
      }
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

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">하루에 다녀올 만한 곳</h2>
          <Link to="/map" className="text-[13px] font-semibold text-brand-600">
            지도에서 보기
          </Link>
        </div>
        {picksLoading ? (
          <p className="hint py-6 text-center">가까운 곳을 찾는 중…</p>
        ) : picks.length === 0 ? (
          <p className="hint py-6 text-center">지금은 보여 드릴 장소가 없습니다</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {picks.map((p) => (
              <li key={p.id}>
                <Link to={`/places/${p.id}`} className="block">
                  <PlaceCard place={p} right={<PickMeta place={p} origin={origin} />} />
                </Link>
              </li>
            ))}
          </ul>
        )}
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

/**
 * 카드 오른쪽: 별점과 기준점에서의 이동 시간.
 *
 * ★ 는 리뷰가 MIN_RATING_DISPLAY(3)건 이상일 때만 보인다 (❸). 1~2건인 장소도
 * 순서에는 반영되지만, 리뷰가 1건뿐이면 평균이 곧 그 사람의 별점이라 숨긴다.
 */
function PickMeta({ place, origin }: { place: Place; origin: LatLng | null }) {
  const showRating = place.rating_avg != null && place.rating_count >= MIN_RATING_DISPLAY
  const travel = origin ? dayTripTravel(origin, place) : null
  return (
    <div className="shrink-0 text-right text-[12px] leading-tight">
      {showRating && (
        <p className="font-bold text-ink-700">
          ★ {place.rating_avg!.toFixed(1)}{' '}
          <span className="font-normal text-ink-400">({place.rating_count})</span>
        </p>
      )}
      {travel && (
        <p className="mt-0.5 whitespace-nowrap text-ink-500">
          {travel.mode === 'walk' ? '도보' : '차로'} {formatDuration(travel.minutes)}
        </p>
      )}
    </div>
  )
}
