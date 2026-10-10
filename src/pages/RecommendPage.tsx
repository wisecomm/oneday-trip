import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { recommendPlaces, tripItems, trips } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import { regionLabel, shownRating, type Place, type Trip } from '@/lib/types'
import { CategoryDot, PlaceThumb, RatingStar } from '@/components/PlaceCard'
import { BottomSheet, EmptyState, Loading, PageHeader } from '@/components/ui'
import { formatTripDate } from '@/lib/trip-date'

/** 추천 장소를 한 번에 보여 주는 곳 수 — 처음 이만큼, '더 보기'마다 이만큼 더 */
const PAGE_SIZE = 10

/** 하위 지역(구/시) 선택 대신 상위 지역 전체를 보고 싶을 때 쓰는 표식값 — 실제 지역명이 아니다 */
/** 시군구 드롭다운에서 '전체'를 뜻하는 값 */
const ALL_LEAF = ''

/**
 * MAP-04-02 · 04. 로컬 장소 탐색 > 4.2 추천 장소
 * 고른 지역의 장소를 **방문자 별점** 높은 순으로 보여 주고(10/10 — 시간대 · 날씨 · 취향 점수는
 * 없앰), [저장하기]로 나의 여행 방문 리스트(3.1)에 다이렉트 추가한다.
 *
 * 비회원도 본다(Q22). [저장하기]를 누를 때 로그인으로 보낸다 — 공용 코스의 '담기'와 같은 방식이다.
 * 추천 탭(RecommendHubPage) 안의 '추천 장소'로 들어가므로 embedded 면 머리말을
 * 그리지 않는다.
 */
export function RecommendPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const { groups, regions } = useRegions()
  const [areaCode, setAreaCode] = useState<number | null>(null)
  const [sigunguCode, setSigunguCode] = useState<number | null>(null)
  const [feed, setFeed] = useState<Place[]>([])
  /** 이 지역 후보 전체 수 — '추천 더 보기 · 10 / N곳' */
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  /**
   * 동점 순서 씨앗 — 지역을 고를 때마다 새로 정한다. 같은 씨앗이면 서버가 같은 순서로 고르므로
   * '더 보기'로 쪽을 넘겨도 순서가 흔들리지 않고, 화면을 다시 열면 섞인다.
   * 요청 번호도 함께 — 지역을 바꾼 뒤 늦게 온 이전 응답을 버린다.
   */
  const seedRef = useRef('')
  const requestRef = useRef(0)
  const [myTrips, setMyTrips] = useState<Trip[]>([])
  // 로그인하지 않았거나 나의 여행 로딩이 끝나야 '다가오는 여행 목적지' 기본값을 확정할 수 있다
  const [myTripsLoaded, setMyTripsLoaded] = useState(false)
  const [saveTarget, setSaveTarget] = useState<Place | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  /**
   * 첫 쪽 — 서버(recommend_places)가 이 지역 장소를 별점으로 매겨 10곳만 돌려준다. 예전처럼 지역
   * 장소를 전부(경기 3,357곳) 받아 브라우저에서 매기지 않는다.
   */
  const load = useCallback(async () => {
    if (areaCode === null) return
    const req = ++requestRef.current
    seedRef.current = Math.random().toString(36).slice(2, 10)
    setLoading(true)
    try {
      const res = await recommendPlaces({
        areaCode,
        sigunguCode: sigunguCode ?? undefined,
        exclude: [],
        count: PAGE_SIZE,
        seed: seedRef.current,
      })
      if (req !== requestRef.current) return
      setFeed(res.places)
      setTotal(res.total)
    } finally {
      if (req === requestRef.current) setLoading(false)
    }
  }, [areaCode, sigunguCode])

  // 지역 목록·나의 여행이 모두 준비되면 기본 지역을 정한다 — 오늘 이후로 예정된
  // 여행이 있으면 그중 가장 빠른 여행의 목적지로, 없으면 첫 상위 지역으로 맞춘다
  useEffect(() => {
    if (areaCode !== null || groups.length === 0 || regions.length === 0 || !myTripsLoaded) return

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = myTrips
      .filter((t) => t.trip_date >= today)
      .sort((a, b) => a.trip_date.localeCompare(b.trip_date))[0]

    // 다가오는 여행이 있으면 그 목적지로 맞춘다. 코드라 이름 매칭이 필요 없다.
    setAreaCode(upcoming ? upcoming.tour_area_code : groups[0].tour_area_code)
    setSigunguCode(upcoming ? upcoming.tour_sigungu_code : null)
  }, [groups, regions, areaCode, myTrips, myTripsLoaded])

  useEffect(() => {
    if (areaCode === null || groups.length === 0) return
    void load()
  }, [load, areaCode, groups.length])

  /** 다음 쪽 — 보인 곳을 빼고 같은 씨앗으로 서버에 다음 10곳을 묻는다 */
  async function showMore() {
    if (areaCode === null) return
    const req = requestRef.current
    setLoadingMore(true)
    try {
      const res = await recommendPlaces({
        areaCode,
        sigunguCode: sigunguCode ?? undefined,
        exclude: feed.map((p) => p.id),
        count: PAGE_SIZE,
        seed: seedRef.current,
      })
      if (req !== requestRef.current) return
      setFeed((prev) => [...prev, ...res.places])
      setTotal(res.total)
    } finally {
      setLoadingMore(false)
    }
  }

  function changeGroup(next: number) {
    setAreaCode(next)
    setSigunguCode(null)
  }

  useEffect(() => {
    if (!user) {
      setMyTripsLoaded(true)
      return
    }
    void trips.list(user.id).then((list) => {
      setMyTrips(list)
      setMyTripsLoaded(true)
    })
  }, [user])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(id)
  }, [toast])

  // 화면에 보이는 목적지 문구 — 구를 고르지 않았으면 '서울 전체'
  const groupName = groups.find((g) => g.tour_area_code === areaCode)?.name ?? ''
  const regionName =
    regions.find(
      (r) => r.tour_area_code === areaCode && r.tour_sigungu_code === sigunguCode,
    )?.name ?? null
  const destinationLabel = regionLabel(groupName, regionName)

  return (
    <>
      {!embedded && (
        <PageHeader title="추천 장소" subtitle="방문자 별점 높은 순" />
      )}

      <div className="px-4 py-4">
        <div className="card mb-4 overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-5 py-5 text-white">
            <p className="text-[12px] font-semibold text-brand-100">방문자 별점 높은 순</p>
            <p className="mt-1 text-[19px] leading-snug font-extrabold">
              {destinationLabel ? `${destinationLabel}에서 가볼만한 곳` : '가볼만한 곳'}
            </p>
          </div>

          <div className="flex items-center gap-1.5 px-4 py-3">
            <select
              value={areaCode ?? ''}
              onChange={(e) => changeGroup(Number(e.target.value))}
              className="field !w-auto min-w-0 !py-2 !text-[13.5px] font-bold"
              aria-label="시/도 선택"
            >
              {groups.map((g) => (
                <option key={g.tour_area_code} value={g.tour_area_code}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={sigunguCode ?? ALL_LEAF}
              onChange={(e) =>
                setSigunguCode(e.target.value === ALL_LEAF ? null : Number(e.target.value))
              }
              className="field min-w-0 flex-1 !py-2 !text-[13.5px] font-bold"
              aria-label="시군구 선택"
            >
              <option value={ALL_LEAF}>전체</option>
              {regions
                .filter((r) => r.tour_area_code === areaCode)
                .map((r) => (
                  <option key={r.tour_sigungu_code} value={r.tour_sigungu_code}>
                    {r.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {loading ? (
          <Loading label="불러오는 중" />
        ) : feed.length === 0 ? (
          <EmptyState icon="✨" title="추천할 장소가 없습니다" />
        ) : (
          <ul className="flex flex-col gap-3">
            {feed.map((place, i) => (
              <li key={place.id} className="card overflow-hidden">
                <div className="flex items-center gap-3 p-3.5">
                  <span className="w-5 shrink-0 text-center text-[15px] font-extrabold text-ink-300">
                    {i + 1}
                  </span>
                  <PlaceThumb place={place} size={58} />
                  <button
                    type="button"
                    onClick={() => navigate(`/places/${place.id}`)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      <CategoryDot category={place.category} />
                      <p className="truncate text-[15px] font-bold text-ink-800">{place.name}</p>
                    </div>
                    {place.summary && (
                      <p className="mt-0.5 truncate text-[12.5px] text-ink-500">{place.summary}</p>
                    )}
                    {shownRating(place) && (
                      <p className="mt-1 text-[12px]">
                        <RatingStar place={place} />
                      </p>
                    )}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!user) {
                      navigate('/login')
                      return
                    }
                    setSaveTarget(feed[i])
                  }}
                  className="w-full border-t border-ink-100 py-3 text-[13.5px] font-bold text-brand-600 hover:bg-brand-50"
                >
                  저장하기 · 나의 여행에 추가
                </button>
              </li>
            ))}
          </ul>
        )}

        {!loading && feed.length < total && (
          <button
            type="button"
            onClick={() => void showMore()}
            disabled={loadingMore}
            className="mt-3 w-full rounded-xl border border-ink-200 bg-white py-3 text-[13.5px] font-bold text-ink-700 shadow-sm hover:bg-ink-50 disabled:opacity-60"
          >
            {loadingMore ? '불러오는 중…' : `추천 더 보기 · ${feed.length} / ${total}곳`}
          </button>
        )}
      </div>

      <SaveSheet
        target={saveTarget}
        trips={myTrips}
        onClose={() => setSaveTarget(null)}
        onSaved={(msg) => {
          setSaveTarget(null)
          setToast(msg)
        }}
        onCreateTrip={() => navigate('/trips/new')}
      />

      {toast && (
        <div className="fixed inset-x-0 bottom-28 z-40 flex justify-center px-6">
          <p className="rounded-xl bg-ink-800 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}
    </>
  )
}

function SaveSheet({
  target,
  trips: myTrips,
  onClose,
  onSaved,
  onCreateTrip,
}: {
  target: Place | null
  trips: Trip[]
  onClose: () => void
  onSaved: (message: string) => void
  onCreateTrip: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function save(trip: Trip) {
    if (!target) return
    setBusy(true)
    try {
      await tripItems.add({ trip_id: trip.id, place_id: target.id })
      onSaved(`${trip.title}에 저장했습니다.`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={Boolean(target)} onClose={onClose} title="어느 일정에 저장할까요?">
      {myTrips.length === 0 ? (
        <div>
          <p className="hint mb-4">아직 만든 여행이 없습니다. 먼저 여행 일정을 만들어 주세요.</p>
          <button type="button" onClick={onCreateTrip} className="btn-primary w-full">
            여행 일정 만들기
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {myTrips.map((trip) => {
            return (
              <li key={trip.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(trip)}
                  className="flex w-full items-center gap-3 rounded-xl border border-ink-200 p-3.5 text-left transition-colors hover:bg-ink-50 disabled:opacity-45"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-ink-800">{trip.title}</p>
                    <p className="text-[12px] text-ink-500">{formatTripDate(trip.trip_date)}</p>
                  </div>
                  <span className="shrink-0 text-[13px] font-bold text-brand-600">담기</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </BottomSheet>
  )
}
