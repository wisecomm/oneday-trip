import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, tripItems, trips } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import { distanceKm } from '@/lib/geo'
import { CATEGORY_LABEL, type Place, type PlaceCategory, type Trip } from '@/lib/types'
import { MapView } from '@/components/MapView'
import { CategoryDot, PlaceThumb } from '@/components/PlaceCard'
import { BottomSheet, Loading } from '@/components/ui'

const CATEGORIES: PlaceCategory[] = ['babzip', 'cafe', 'sulzip', 'spot']

/** 하위 지역(구/시) 선택 대신 상위 지역 전체를 보고 싶을 때 쓰는 표식값 — 실제 지역명이 아니다 */
const ALL_LEAF = '전체'

/**
 * 다른 탭(홈·AI 추천 등)을 눌렀다가 지도로 돌아왔을 때 보던 자리 그대로
 * 보여주기 위한 세션 기억 — 컴포넌트 바깥(모듈 스코프)에 둬서 언마운트 후
 * 재마운트에도 값이 남아 있게 한다. 새로고침하면 초기화된다(의도된 동작).
 */
let savedFilters: { group: string; region: string; active: PlaceCategory[] } | null = null
let savedViewport: { lat: number; lng: number; zoom: number } | null = null

/**
 * MAP-04-01 · 04. 로컬 장소 탐색 > 4.1 맛집/명소 지도 > 실시간 지도 홈
 * 필터 클릭 시 마커 배열을 갱신·재렌더링하고, 마커 클릭 시 하단 미니 상세 카드를 띄운다.
 * 비로그인(Guest) 상태에서도 열람 가능하다.
 */
export function ExplorePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  // 타임라인에서 '장소 추가'로 진입한 경우 — 담기 CTA 가 활성화된다
  const tripId = params.get('trip')

  const { groups, regions } = useRegions()
  // 여행 목적지(tripId)나 URL region 쿼리로 들어온 경우는 그 값이 우선이고,
  // 그것도 아니면 지난번 보던 필터를 그대로 복원한다
  const [group, setGroup] = useState<string>(() =>
    tripId || params.get('region') ? '' : (savedFilters?.group ?? ''),
  )
  const [region, setRegion] = useState<string>(
    () => params.get('region') ?? (tripId ? '' : (savedFilters?.region ?? '')),
  )
  const [active, setActive] = useState<PlaceCategory[]>(() =>
    tripId || params.get('region') ? [] : (savedFilters?.active ?? []),
  )
  const [initialViewport] = useState(() => (tripId ? null : savedViewport))
  const [list, setList] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Place | null>(null)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [pickedCount, setPickedCount] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null)

  // 필터가 바뀔 때마다 세션 기억을 갱신한다
  useEffect(() => {
    if (!group || !region) return
    savedFilters = { group, region, active }
  }, [group, region, active])

  const handleViewportChange = useCallback((v: { lat: number; lng: number; zoom: number }) => {
    savedViewport = v
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const categories = active.length ? active : undefined
      const filter =
        region === ALL_LEAF
          ? { regions: regions.filter((r) => r.group_name === group).map((r) => r.name), categories }
          : { region, categories }
      const result = await placesApi.list(filter)
      // 내 위치를 확보한 상태라면 기본 정렬(평점순) 대신 거리순을 유지한다
      setList(
        myLocation
          ? [...result].sort((a, b) => distanceKm(myLocation, a) - distanceKm(myLocation, b))
          : result,
      )
    } finally {
      setLoading(false)
    }
  }, [region, group, regions, active, myLocation])

  // 지역 목록이 비동기로 도착하므로, url 에 region 쿼리가 없고 여행 목적지로부터
  // 채워질 예정도 아니라면 첫 상위 지역 + 전체보기로 채운다
  useEffect(() => {
    if (region || tripId || groups.length === 0) return
    setGroup(groups[0].name)
    setRegion(ALL_LEAF)
  }, [groups, region, tripId])

  // region 이 url 쿼리로부터 실제 지역명으로 채워진 경우, 소속 상위 지역을 역으로 맞춘다
  useEffect(() => {
    if (!region || region === ALL_LEAF || regions.length === 0) return
    const match = regions.find((r) => r.name === region)
    if (match && match.group_name !== group) setGroup(match.group_name)
  }, [region, regions, group])

  useEffect(() => {
    if (!region || groups.length === 0) return
    void load()
  }, [load, region, groups.length])

  // 여행 목적지 원본 문자열 — regions/groups 가 아직 로딩 중일 수 있어 일단 받아만 두고,
  // 아래 별도 effect 에서 leaf 지역인지 상위 지역(전체) 인지 구분해 반영한다
  const [tripDestination, setTripDestination] = useState<string | null>(null)

  useEffect(() => {
    if (!tripId) return
    void trips.get(tripId).then((t) => {
      setTrip(t)
      setTripDestination(t?.destination ?? null)
    })
    void tripItems
      .listByTrip(tripId)
      .then((items) => setPickedCount(items.length))
  }, [tripId])

  useEffect(() => {
    if (!tripDestination || regions.length === 0 || groups.length === 0) return
    const leaf = regions.find((r) => r.name === tripDestination)
    if (leaf) {
      setGroup(leaf.group_name)
      setRegion(leaf.name)
    } else if (groups.some((g) => g.name === tripDestination)) {
      setGroup(tripDestination)
      setRegion(ALL_LEAF)
    }
  }, [tripDestination, regions, groups])

  /** 상위 지역을 바꾸면 하위 선택은 '전체'로 되돌린다 — 특정 구 하나로 좁혀 놓은 채 다른 시/도로
   *  넘어가면 그 시/도에 없는 지역명이 남아 있는 꼴이라 혼란스럽다 */
  function changeGroup(next: string) {
    setGroup(next)
    setRegion(ALL_LEAF)
    setParams((p) => {
      p.delete('region')
      return p
    })
  }

  function changeRegion(next: string) {
    setRegion(next)
    setParams((p) => {
      if (next === ALL_LEAF) p.delete('region')
      else p.set('region', next)
      return p
    })
  }

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(id)
  }, [toast])

  function toggle(c: PlaceCategory) {
    setActive((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  /** 내 위치 주변 재탐색 — 브라우저 위치를 받아 가까운 순으로 정렬한다 */
  function researchNearby() {
    if (!navigator.geolocation) {
      setToast('이 브라우저에서는 위치 정보를 사용할 수 없습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const me = { lat: coords.latitude, lng: coords.longitude }

        // 지금 필터가 다른 시/도로 좁혀져 있으면 '재탐색'을 눌러도 애초에
        // 목록에 내 위치 근처 장소가 없다. 가장 가까운 하위 지역(구/시)을 찾아
        // 그 상위 지역으로 필터를 옮기고, 하위 지역·카테고리는 전체로 되돌려
        // 놓쳐서 빠지는 곳이 없게 한다.
        const nearestRegion = regions.reduce<{ region: (typeof regions)[number]; d: number } | null>(
          (best, r) => {
            const d = distanceKm(me, r)
            return !best || d < best.d ? { region: r, d } : best
          },
          null,
        )

        setMyLocation(me)
        if (nearestRegion) {
          setGroup(nearestRegion.region.group_name)
          setRegion(ALL_LEAF)
          setActive([])
          setParams((p) => {
            p.delete('region')
            return p
          })
        }

        setToast(
          nearestRegion
            ? `내 위치(${nearestRegion.region.group_name} 인근)에서 가까운 순으로 정렬했습니다.`
            : '내 위치에서 가까운 순으로 정렬했습니다.',
        )
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setToast(
            '위치 권한이 거부되어 있습니다. 브라우저 설정의 사이트 설정(또는 개인정보 보호)에서 이 사이트의 위치 접근을 허용한 뒤 다시 시도해 주세요.',
          )
        } else if (err.code === err.TIMEOUT) {
          setToast('위치 확인이 시간 초과되었습니다. 잠시 후 다시 시도해 주세요.')
        } else {
          setToast('현재 위치를 확인할 수 없습니다. GPS·네트워크 상태를 확인해 주세요.')
        }
      },
      { timeout: 8000 },
    )
  }

  async function addToTrip(place: Place) {
    if (!tripId || !trip) return
    await tripItems.add({ trip_id: tripId, place_id: place.id })
    setPickedCount((n) => n + 1)
    setSelected(null)
    setToast('일정에 담았습니다.')
  }

  return (
    <div className="relative h-dvh">
      <MapView
        places={list}
        selectedId={selected?.id ?? null}
        onSelect={setSelected}
        className="h-full w-full bg-ink-100"
        safeInsets={{ top: 100, bottom: 120 }}
        userLocation={myLocation}
        initialViewport={initialViewport}
        onViewportChange={handleViewportChange}
      />

      {/* 상단 필터 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
        <div className="pointer-events-auto mb-2 flex items-center gap-1.5">
          <select
            value={group}
            onChange={(e) => changeGroup(e.target.value)}
            className="min-w-0 rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-[13px] font-bold text-ink-700 shadow-sm"
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
            onChange={(e) => changeRegion(e.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-[13px] font-bold text-ink-700 shadow-sm"
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
          {trip && (
            <span className="shrink-0 truncate rounded-xl bg-ink-800 px-2.5 py-2 text-[12px] font-bold text-white shadow-sm">
              담는 중 · {pickedCount}곳
            </span>
          )}
        </div>

        <div className="pointer-events-auto flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setActive([])}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold shadow-sm ${
              active.length === 0 ? 'bg-ink-800 text-white' : 'bg-white text-ink-600'
            }`}
          >
            전체
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold shadow-sm ${
                active.includes(c) ? 'bg-ink-800 text-white' : 'bg-white text-ink-600'
              }`}
            >
              <CategoryDot category={c} />
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {/* 내 위치 주변 재탐색 */}
      <button
        type="button"
        onClick={researchNearby}
        className="absolute right-3 bottom-32 z-10 flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[13px] font-bold text-ink-700 shadow-lg"
      >
        <span aria-hidden>🎯</span> 내 위치 주변 재탐색
      </button>

      {loading && (
        <div className="absolute inset-x-0 top-28 flex justify-center">
          <span className="rounded-full bg-white px-4 py-1.5 text-[12.5px] font-semibold text-ink-500 shadow">
            마커 갱신 중…
          </span>
        </div>
      )}

      {toast && (
        <div className="absolute inset-x-0 bottom-40 z-30 flex justify-center px-6">
          <p className="rounded-xl bg-ink-800 px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}

      {/* 마커 클릭 시 하단 미니 상세 카드 */}
      <BottomSheet open={Boolean(selected)} onClose={() => setSelected(null)}>
        {selected && (
          <div>
            <div className="flex items-start gap-3">
              <PlaceThumb place={selected} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <CategoryDot category={selected.category} />
                  <h2 className="truncate text-[17px] font-extrabold text-ink-800">
                    {selected.name}
                  </h2>
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-500">{selected.address}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-500">
                  <span className="font-bold text-ink-700">★ {selected.rating.toFixed(1)}</span>
                  <span>·</span>
                  <span>{'₩'.repeat(selected.price_level)}</span>
                  <span>·</span>
                  <span>{selected.open_hours}</span>
                </div>
              </div>
            </div>

            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-600">{selected.summary}</p>

            <div className="mt-4 flex gap-2">
              {tripId ? (
                <button
                  type="button"
                  onClick={() => addToTrip(selected)}
                  className="btn-primary flex-1"
                >
                  일정에 담기
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    user
                      ? navigate('/trips')
                      : navigate('/login', { state: { from: '/map' } })
                  }
                  className="btn-ghost flex-1"
                >
                  {user ? '내 여행에 담기' : '로그인하고 담기'}
                </button>
              )}
              <Link to={`/places/${selected.id}`} className="btn-primary flex-1">
                상세 · 예약
              </Link>
            </div>
          </div>
        )}
      </BottomSheet>

      {!loading && list.length === 0 && (
        <div className="absolute inset-x-0 top-1/2 flex justify-center">
          <Loading label="표시할 장소가 없습니다" />
        </div>
      )}
    </div>
  )
}
