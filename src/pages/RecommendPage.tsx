import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, tripItems, trips } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import { contextLabel, fetchWeather, recommend, type Scored, type TripContext } from '@/lib/recommend'
import type { Trip } from '@/lib/types'
import { CategoryDot, PlaceThumb } from '@/components/PlaceCard'
import { BottomSheet, EmptyState, Loading, PageHeader } from '@/components/ui'
import { formatTripDate } from './TripCreatePage'

/** 하위 지역(구/시) 선택 대신 상위 지역 전체를 보고 싶을 때 쓰는 표식값 — 실제 지역명이 아니다 */
const ALL_LEAF = '전체'

/**
 * MAP-04-02 · 04. 로컬 장소 탐색 > 4.2 AI 추천 > 맥락 인지 추천 피드
 * 실시간 날씨 API + 회원 프로필 취향 태그를 결합해 초개인화 카드를 구성하고,
 * [저장하기]로 나의 여행 방문 리스트(3.1)에 다이렉트 추가한다.
 */
export function RecommendPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const { groups, regions } = useRegions()
  const [group, setGroup] = useState<string>('')
  const [region, setRegion] = useState<string>('')
  const [ctx, setCtx] = useState<TripContext | null>(null)
  const [feed, setFeed] = useState<Scored[]>([])
  const [loading, setLoading] = useState(true)
  const [myTrips, setMyTrips] = useState<Trip[]>([])
  // 로그인하지 않았거나 나의 여행 로딩이 끝나야 '다가오는 여행 목적지' 기본값을 확정할 수 있다
  const [myTripsLoaded, setMyTripsLoaded] = useState(false)
  const [saveTarget, setSaveTarget] = useState<Scored | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 날씨는 구/시 단위로 갈라 볼 필요가 없어, 선택된 시/도의 중심 좌표를 그대로 쓴다
      const anchor = groups.find((g) => g.name === group)
      const filter =
        region === ALL_LEAF
          ? { regions: regions.filter((r) => r.group_name === group).map((r) => r.name) }
          : { region }
      const [list, weather] = await Promise.all([
        placesApi.list(filter),
        anchor ? fetchWeather(anchor.lat, anchor.lng) : Promise.resolve({ weather: 'clear' as const, temperature: null }),
      ])
      const now = new Date()
      const nextCtx: TripContext = {
        hour: now.getHours(),
        weekday: now.getDay(),
        ...weather,
      }
      setCtx(nextCtx)
      setFeed(recommend(list, nextCtx, profile))
    } finally {
      setLoading(false)
    }
  }, [region, group, regions, groups, profile])

  // 지역 목록·나의 여행이 모두 준비되면 기본 지역을 정한다 — 오늘 이후로 예정된
  // 여행이 있으면 그중 가장 빠른 여행의 목적지로, 없으면 첫 상위 지역으로 맞춘다
  useEffect(() => {
    if (region || groups.length === 0 || regions.length === 0 || !myTripsLoaded) return

    const today = new Date().toISOString().slice(0, 10)
    const upcoming = myTrips
      .filter((t) => t.trip_date >= today)
      .sort((a, b) => a.trip_date.localeCompare(b.trip_date))[0]

    let defaultGroup = groups[0].name
    if (upcoming) {
      const leaf = regions.find((r) => r.name === upcoming.destination)
      if (leaf) defaultGroup = leaf.group_name
      else if (groups.some((g) => g.name === upcoming.destination)) defaultGroup = upcoming.destination
    }

    setGroup(defaultGroup)
    setRegion(ALL_LEAF)
  }, [groups, regions, region, myTrips, myTripsLoaded])

  useEffect(() => {
    if (!region || groups.length === 0) return
    void load()
  }, [load, region, groups.length])

  function changeGroup(next: string) {
    setGroup(next)
    setRegion(ALL_LEAF)
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

  const regionLabel = region === ALL_LEAF ? group : region
  const headline = useMemo(
    () => (ctx ? contextLabel(ctx, regionLabel) : '추천 맥락을 분석하는 중'),
    [ctx, regionLabel],
  )

  return (
    <>
      <PageHeader title="AI 추천" subtitle="시간 · 날씨 · 취향을 반영한 실시간 큐레이션" />

      <div className="px-4 py-4">
        <div className="card mb-4 overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-brand-800 px-5 py-5 text-white">
            <p className="text-[12px] font-semibold text-brand-100">실시간 맥락 데이터</p>
            <p className="mt-1 text-[19px] leading-snug font-extrabold">{headline}</p>
            {ctx && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <ContextChip>
                  {ctx.weather === 'rain'
                    ? '🌧️ 비'
                    : ctx.weather === 'snow'
                      ? '🌨️ 눈'
                      : ctx.weather === 'cloudy'
                        ? '☁️ 흐림'
                        : '☀️ 맑음'}
                </ContextChip>
                {ctx.temperature !== null && <ContextChip>{Math.round(ctx.temperature)}°C</ContextChip>}
                <ContextChip>{ctx.hour}시</ContextChip>
                <ContextChip>
                  {profile ? `취향 ${profile.taste_tags.length}개 반영` : '기본 추천'}
                </ContextChip>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 px-4 py-3">
            <select
              value={group}
              onChange={(e) => changeGroup(e.target.value)}
              className="field !w-auto min-w-0 !py-2 !text-[13.5px] font-bold"
              aria-label="시/도 선택"
            >
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="field min-w-0 flex-1 !py-2 !text-[13.5px] font-bold"
              aria-label="구/시 선택"
            >
              <option value={ALL_LEAF}>전체</option>
              {regions
                .filter((r) => r.group_name === group)
                .map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name.slice(group.length + 1)}
                  </option>
                ))}
            </select>
            <button
              type="button"
              onClick={load}
              className="btn-ghost shrink-0 !py-2 text-[13.5px] whitespace-nowrap"
            >
              새로고침
            </button>
          </div>
        </div>

        {!profile && user && (
          <button
            type="button"
            onClick={() => navigate('/onboarding')}
            className="mb-4 w-full rounded-xl bg-amber-50 px-4 py-3 text-left text-[13px] font-semibold text-amber-700"
          >
            취향 태그를 등록하면 추천 정확도가 크게 올라갑니다 → 사용자 등록하기
          </button>
        )}

        {loading ? (
          <Loading label="맥락 분석 중" />
        ) : feed.length === 0 ? (
          <EmptyState icon="✨" title="추천할 장소가 없습니다" />
        ) : (
          <ul className="flex flex-col gap-3">
            {feed.map(({ place, reasons }, i) => (
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
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-500">{place.summary}</p>
                    <div className="mt-1 flex items-center gap-2 text-[12px] text-ink-500">
                      <span className="font-bold text-ink-700">★ {place.rating.toFixed(1)}</span>
                    </div>
                  </button>
                </div>

                {reasons.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-t border-ink-100 px-3.5 py-2.5">
                    {reasons.slice(0, 3).map((r) => (
                      <span
                        key={r}
                        className="rounded-md bg-brand-50 px-2 py-1 text-[11.5px] font-semibold text-brand-700"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                )}

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

function ContextChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-white/15 px-2.5 py-1 text-[12px] font-semibold">{children}</span>
  )
}

function SaveSheet({
  target,
  trips: myTrips,
  onClose,
  onSaved,
  onCreateTrip,
}: {
  target: Scored | null
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
      await tripItems.add({ trip_id: trip.id, place_id: target.place.id })
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
