import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, regions as regionsApi, trips } from '@/lib/db'
import {
  dayTripTravel,
  formatDuration,
  locate,
  LOCATE_FAILURE_TEXT,
  LOCATE_LABEL,
  LOCATE_SETTINGS_HINT,
  type LatLng,
  type LocateFailure,
} from '@/lib/geo'
import { type Place, type Trip } from '@/lib/types'
import { PlaceCard } from '@/components/PlaceCard'
import { Loading } from '@/components/ui'
import { formatTripDate, upcomingTrip } from '@/lib/trip-date'

/** 홈 '하루에 다녀올 만한 곳' — 처음 이만큼, '더 보기'마다 이만큼 더(추천 장소 · 코스와 같은 10) */
const PAGE_SIZE = 10

/** 다시 고르는 간격 — 이보다 오래된 목록은 돌아와도 다시 고른다(앱으로 돌아왔을 때와 같은 10분) */
const REPICK_AFTER_MS = 10 * 60 * 1000

/**
 * '하루에 다녀올 만한 곳' 기억 — 장소 상세에 갔다가 뒤로 오면 화면이 새로 그려져 처음 10곳으로
 * 줄고 위치도 다시 쟀다. 그러면 '더 보기'로 늘린 아래쪽으로 스크롤이 돌아가지 못한다(ScrollMemory).
 * 앱을 켜 둔 동안 마지막 결과를 들고 있다가, 10분 안이면 그대로 다시 쓴다.
 */
let savedPicks: {
  picks: Place[]
  origin: LatLng | null
  basis: { here: true } | { here: false; reason: LocateFailure }
  hasMore: boolean
  at: number
} | null = null

const freshSaved = () => (savedPicks && Date.now() - savedPicks.at < REPICK_AFTER_MS ? savedPicks : null)

export function HomePage() {
  const { user, profile, isGuest } = useAuth()
  const [myTrips, setMyTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)

  /**
   * '하루에 다녀올 만한 곳' (플로챠트/홈.md).
   *
   * 화면이 열리면 위치를 묻는다. 거부 · 미지원 · 5초 안에 응답이 없으면 서울
   * 강남구 중심을 기준점으로 같은 흐름을 탄다. 어느 기준인지 섹션 머리에 보이고,
   * '다시 찾기'로 위치를 새로 재서 다시 고른다 — 권한 창에서 늦게 허용했거나
   * 거부했다가 설정에서 허용한 경우, 자리를 옮긴 경우를 위해서다. 앱으로 돌아왔을 때
   * 마지막으로 고른 지 10분이 지났으면 저절로 다시 고른다.
   *
   * 이 섹션은 위치를 기다리느라 늦을 수 있어 나머지 홈과 따로 불러온다 — 기다리는
   * 동안 다가오는 여행은 먼저 보인다. 다시 고르는 동안에는 지금 카드를 그대로 둔다.
   */
  const [saved] = useState(freshSaved)
  const [picks, setPicks] = useState<Place[]>(saved?.picks ?? [])
  const [picksLoading, setPicksLoading] = useState(!saved)
  /** '더 보기' — 받는 중 · 더 받을 곳이 남았는지(마지막으로 받은 쪽이 꽉 찼으면 남은 것으로 본다) */
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(saved?.hasMore ?? true)
  const [origin, setOrigin] = useState<LatLng | null>(saved?.origin ?? null)
  /** 기준점이 내 위치인지 · 아니면 왜 강남인지 */
  const [basis, setBasis] = useState<{ here: true } | { here: false; reason: LocateFailure } | null>(
    saved?.basis ?? null,
  )
  const [refreshing, setRefreshing] = useState(false)
  const lastPickedAt = useRef(saved?.at ?? 0)
  /** 늦게 도착한 옛 요청의 결과가 새 결과를 덮지 않게 */
  const pickRequest = useRef(0)

  const loadPicks = useCallback(async (fresh: boolean) => {
    const id = ++pickRequest.current
    setRefreshing(true)
    try {
      // 사용자가 직접 다시 찾을 때는 기억해 둔 위치를 쓰지 않고, 조금 더 기다린다
      const found = await locate(fresh ? 10000 : 5000, { fresh })
      let base = found.at
      if (!base) {
        // 강남 좌표는 코드에 적지 않고 지역 표의 (서울 1, 강남구 1) 에서 읽는다
        const all = await regionsApi.list()
        const gangnam = all.find((r) => r.tour_area_code === 1 && r.tour_sigungu_code === 1)
        base = gangnam ? { lat: gangnam.lat, lng: gangnam.lng } : null
      }
      const list = await placesApi.homePicks(base, PAGE_SIZE)
      if (id !== pickRequest.current) return
      setOrigin(base)
      setPicks(list)
      setHasMore(list.length === PAGE_SIZE)
      const nextBasis = found.at ? { here: true as const } : { here: false as const, reason: found.reason }
      setBasis(nextBasis)
      lastPickedAt.current = Date.now()
      savedPicks = { picks: list, origin: base, basis: nextBasis, hasMore: list.length === PAGE_SIZE, at: lastPickedAt.current }
    } catch (err) {
      console.error('[Home] 하루에 다녀올 만한 곳을 불러오지 못했습니다.', err)
    } finally {
      if (id === pickRequest.current) {
        setRefreshing(false)
        setPicksLoading(false)
      }
    }
  }, [])

  /**
   * 더 보기 — 이미 보인 곳을 빼고 다음 PAGE_SIZE 곳(같은 순서). 기준점은 처음 고른 그 자리(origin).
   * 그사이 다시 골랐으면 버린다.
   */
  async function showMorePicks() {
    const id = pickRequest.current
    setLoadingMore(true)
    try {
      const more = await placesApi.homePicks(
        origin,
        PAGE_SIZE,
        picks.map((p) => p.id),
      )
      if (id !== pickRequest.current) return
      setPicks((prev) => [...prev, ...more])
      setHasMore(more.length === PAGE_SIZE)
      // 고른 시각(at)은 그대로 — 더 보기는 같은 결과를 늘린 것이라 10분 계산을 새로 시작하지 않는다
      if (savedPicks) {
        savedPicks = {
          ...savedPicks,
          picks: [...savedPicks.picks, ...more],
          hasMore: more.length === PAGE_SIZE,
        }
      }
    } catch (err) {
      console.error('[Home] 더 보기를 불러오지 못했습니다.', err)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    // 10분 안에 고른 목록이 있으면(상세에 갔다 돌아옴 등) 그대로 — 위치도 다시 재지 않는다
    if (!freshSaved()) void loadPicks(false)
    return () => {
      pickRequest.current++ // 화면을 떠나면 늦게 온 결과를 버린다
    }
  }, [loadPicks])

  // 앱(탭)으로 돌아왔을 때 마지막으로 고른 지 10분이 지났으면 다시 고른다
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (lastPickedAt.current && Date.now() - lastPickedAt.current > REPICK_AFTER_MS) void loadPicks(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadPicks])

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

  // 오늘(한국 날짜) 이후 가장 빠른 여행. 예전엔 날짜가 가장 늦은 여행(myTrips[0])이라, 지난 여행이 '다가오는
  // 여행'으로 뜨거나 여행이 여럿이면 가장 먼 여행이 떴다(10/10 고침). 없으면 '새 여행' 카드
  const nextTrip = upcomingTrip(myTrips)

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
              <p className="text-[14.5px] font-bold text-ink-800">
                {myTrips.length === 0 ? '첫 여행 일정을 만들어 보세요' : '다음 여행 일정을 만들어 보세요'}
              </p>
              <p className="hint">날짜와 목적지만 정하면 타임라인이 자동 생성됩니다.</p>
            </div>
          </Link>
        )
      )}

      <section className="mb-6">
        <div className="grid grid-cols-3 gap-2.5">
          <QuickLink to="/map" icon="🗺️" label="여행 지도" desc="실시간 마커 탐색" />
          <QuickLink to="/recommend" icon="✨" label="AI 추천" desc="별점 높은 곳" />
          <QuickLink to="/trips" icon="🧭" label="나의 여행" desc="동선 최적화" />
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="section-title">하루에 다녀올 만한 곳</h2>
          <Link to="/map" className="text-[13px] font-semibold text-brand-600">
            지도에서 보기
          </Link>
        </div>
        <PickBasis
          basis={basis}
          refreshing={refreshing}
          onRefresh={() => void loadPicks(true)}
        />
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
        {!picksLoading && picks.length > 0 && hasMore && (
          <button
            type="button"
            onClick={() => void showMorePicks()}
            disabled={loadingMore || refreshing}
            className="mt-2.5 w-full rounded-xl border border-ink-200 bg-white py-3 text-[13.5px] font-bold text-ink-700 shadow-sm hover:bg-ink-50 disabled:opacity-60"
          >
            {loadingMore ? '불러오는 중…' : `더 보기 · 지금 ${picks.length}곳`}
          </button>
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
 * 섹션 머리 둘째 줄: 무엇을 기준으로 골랐는지 + '다시 찾기'(내 위치를 새로 재서 다시 고른다).
 * 권한이 꺼져 있으면 다시 찾아도 브라우저가 묻지 않으므로 설정에서 켜는 법을 함께 적는다.
 */
function PickBasis({
  basis,
  refreshing,
  onRefresh,
}: {
  basis: { here: true } | { here: false; reason: LocateFailure } | null
  refreshing: boolean
  onRefresh: () => void
}) {
  if (!basis) return <div className="mb-3" />
  const canRetry = basis.here || basis.reason !== 'unsupported'
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[12.5px] text-ink-500">
          {basis.here ? (
            <>{LOCATE_LABEL.here}</>
          ) : (
            <>
              서울 강남구 기준 · <span className="text-ink-400">{LOCATE_FAILURE_TEXT[basis.reason]}</span>
            </>
          )}
        </p>
        {canRetry && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 rounded-full border border-ink-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-60"
          >
            {refreshing ? LOCATE_LABEL.finding : LOCATE_LABEL.refind}
          </button>
        )}
      </div>
      {!basis.here && basis.reason === 'denied' && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">
          {LOCATE_SETTINGS_HINT}
        </p>
      )}
    </div>
  )
}

/**
 * 카드 오른쪽: 기준점에서의 이동 시간.
 * ★ 는 PlaceCard 가 다른 화면과 같은 규칙(shownRating)으로 그린다.
 */
function PickMeta({ place, origin }: { place: Place; origin: LatLng | null }) {
  const travel = origin ? dayTripTravel(origin, place) : null
  if (!travel) return null
  return (
    <p className="shrink-0 whitespace-nowrap text-right text-[12px] text-ink-500">
      {travel.mode === 'walk' ? '도보' : '차로'} {formatDuration(travel.minutes)}
    </p>
  )
}
