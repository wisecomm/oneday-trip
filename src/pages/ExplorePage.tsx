import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, tripItems, trips, type PlaceFilter } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import {
  DAY_TRIP_RADIUS_KM,
  distanceKm,
  locate,
  LOCATE_FAILURE_TEXT,
  LOCATE_LABEL,
  LOCATE_SETTINGS_HINT,
  type LatLng,
} from '@/lib/geo'
import {
  CATEGORY_LABEL,
  openHoursOneLine,
  shownRating,
  type Place,
  type PlaceCategory,
  type Trip,
} from '@/lib/types'
import { MapView, type MapViewport } from '@/components/MapView'
import { CategoryDot, PlaceThumb, RatingStar } from '@/components/PlaceCard'
import { BottomSheet, Loading } from '@/components/ui'

const CATEGORIES: PlaceCategory[] = ['babzip', 'cafe', 'sulzip', 'spot']

/** 시군구 드롭다운에서 '전체'를 뜻하는 값. 실제 코드가 아니다 */
const ALL_LEAF = ''

/** 시/도 드롭다운에서 '내 위치 주변'을 뜻하는 값. 실제 코드가 아니다 */
const NEAR_OPTION = 'near'

/** URL 쿼리 파라미터 — 지역은 코드로 주고받는다 */
const P_AREA = 'area'
const P_SIGUNGU = 'sigungu'

const numParam = (v: string | null): number | null => {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 다른 탭(홈·AI 추천 등)을 눌렀다가 지도로 돌아왔을 때 보던 자리 그대로
 * 보여주기 위한 세션 기억 — 컴포넌트 바깥(모듈 스코프)에 둬서 언마운트 후
 * 재마운트에도 값이 남아 있게 한다. 새로고침하면 초기화된다(의도된 동작).
 */
let savedFilters: {
  areaCode: number | null
  sigunguCode: number | null
  active: PlaceCategory[]
  /** 내 위치 주변을 보던 중이면 그 위치 — 메모리에만 둔다(URL 에 좌표를 싣지 않는다) */
  near: LatLng | null
  /** 그 위치가 속한 지역 이름('경기 부천시') */
  nearLabel: string | null
} | null = null
let savedViewport: MapViewport | null = null

/**
 * 내 위치 주변에서 보여 줄 곳 수 — 하루 거리(120km) 안을 통째로 보이면 수도권은 7,000곳
 * 가까이 돼 지도가 점으로 뒤덮인다. 반경을 좁혀 가까운 이만큼만 보인다(places.nearest).
 */
const NEAR_LIMIT = 100

/** 3.2km · 15km — 10km 아래만 소수 한 자리 */
const formatKm = (km: number) => (km < 10 ? `${Math.max(km, 0.1).toFixed(1)}km` : `${Math.round(km)}km`)

/** '+N' 묶음 목록에 한 번에 보여 주는 곳 수 — 묶음이 수천 곳일 수 있어 자른다 */
const GROUP_LIST_MAX = 50

/** 내 위치 주변 결과가 이보다 많으면 지도에 점으로 그린다 */
const COMPACT_SEARCH_MIN = 300

/**
 * 이름 검색 결과가 이보다 많을 때만 점으로 그린다. 그 아래는 이름표 + 겹침 묶기('+N', 대표는
 * 검색어에 더 맞는 이름) — 겹침 묶기가 화면에 보이는 마커 수를 칸 수만큼으로 줄여 준다.
 * 예전엔 300 이었는데, '용산'처럼 결과가 300을 넘으면 점이 돼 이름이 안 보였다.
 */
const COMPACT_KEYWORD_MIN = 2000

/**
 * MAP-04-01 · 04. 로컬 장소 탐색 > 4.1 맛집/명소 지도 > 실시간 지도 홈
 * 찾기 흐름(시/도 · 이름 검색 · 내 위치 주변 · 점 ↔ 이름표)은 플로챠트/지도.md.
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
  const [areaCode, setAreaCode] = useState<number | null>(() =>
    tripId || params.get(P_AREA)
      ? numParam(params.get(P_AREA))
      : (savedFilters?.areaCode ?? null),
  )
  const [sigunguCode, setSigunguCode] = useState<number | null>(() =>
    tripId || params.get(P_AREA)
      ? numParam(params.get(P_SIGUNGU))
      : (savedFilters?.sigunguCode ?? null),
  )
  const [active, setActive] = useState<PlaceCategory[]>(() =>
    tripId || params.get(P_AREA) ? [] : (savedFilters?.active ?? []),
  )
  const restoredNear = tripId || params.get(P_AREA) ? null : (savedFilters?.near ?? null)
  const [initialViewport] = useState(() => (tripId ? null : savedViewport))
  const [list, setList] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Place | null>(null)
  /**
   * '+N' 대표 마커를 눌렀을 때 그 칸에 묶인 장소들(대표가 맨 앞) — 목록 시트로 보여 주고,
   * 목록에서 고르면 그 장소 시트(selected)를 연다
   */
  const [group, setGroup] = useState<Place[] | null>(null)

  /**
   * 지도 위 상단 UI(검색창 · 지역 · 카테고리 · 검색 결과 줄)의 실제 높이 — 지도가 자동으로 맞출 때
   * 마커를 이 아래에만 놓는다. 검색 결과 줄이 생기면 높아지므로 잴 때마다 바꾼다.
   */
  const topRef = useRef<HTMLDivElement>(null)
  const [topInset, setTopInset] = useState(150)
  useEffect(() => {
    const el = topRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setTopInset(Math.round(el.getBoundingClientRect().height)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const [trip, setTrip] = useState<Trip | null>(null)
  const [pickedCount, setPickedCount] = useState(0)
  const [toast, setToast] = useState<string | null>(null)
  const [myLocation, setMyLocation] = useState<LatLng | null>(restoredNear)
  /**
   * 내 위치 주변 — '↻ 내 위치 다시 찾기'로 켜진다. 켜져 있으면 시/도 필터 대신 내 위치에서
   * 가까운 NEAR_LIMIT(100)곳을 시/도 경계 없이 본다. 반경은 100곳이 찰 때까지 넓히되 하루 거리
   * (직선 DAY_TRIP_RADIUS_KM, 홈 '하루에 다녀올 만한 곳'과 같은 거리)를 넘지 않는다. 시/도를 고르거나 ✕ 를 누르면 꺼지고, 그 전에 보던 시/도로 돌아간다
   * (areaCode · sigunguCode 는 켜져 있는 동안 그대로 남겨 둔다).
   */
  const [nearMe, setNearMe] = useState(restoredNear !== null)
  /** 내 위치가 속한 지역 — '경기 부천시'. 시/도 칸에 '📍 경기 부천시'로 보인다 */
  const [nearLabel, setNearLabel] = useState<string | null>(() =>
    restoredNear ? (savedFilters?.nearLabel ?? null) : null,
  )
  /** 위치를 새로 찾은 뒤 첫 목록에서 지역 이름을 정한다 — 카테고리를 바꿔도 흔들리지 않게 한 번만 */
  const labelPending = useRef(false)
  /** 내 위치 주변에서 보여 주는 가장 먼 곳까지의 거리 — '가까운 100곳 · 3.2km 안' */
  const [nearKm, setNearKm] = useState<number | null>(null)
  /** 위치를 찾는 동안 — 버튼을 '찾는 중…'으로 바꾸고 다시 누르지 못하게 한다 */
  const [locating, setLocating] = useState(false)

  /**
   * 이름 검색 (MAP-04-01).
   *
   * 카탈로그가 15,518곳인데 이름으로 찾는 길이 없었다. 지역과 카테고리로
   * 좁혀 핀 중에서 눈으로 찾아야 했고, 아는 가게 이름이 있어도 소용이 없었다.
   * `PlaceFilter.keyword` 는 db.ts 에 진작 있었는데 채우는 화면이 없었다.
   *
   * 입력하는 즉시가 아니라 **멈추고 300ms 뒤에** 질의한다. 한 글자마다 쏘면
   * '강남'을 치는 동안 질의가 네 번 날아간다.
   *
   * 검색어가 있으면 지역 필터를 무시하고 전국에서 찾는다 — 이름을 알고 찾는
   * 사람에게 "그 가게는 다른 구에 있습니다"는 도움이 안 된다.
   */
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const searching = keyword.trim().length > 0

  useEffect(() => {
    const id = setTimeout(() => setKeyword(keywordInput), 300)
    return () => clearTimeout(id)
  }, [keywordInput])

  // 필터가 바뀔 때마다 세션 기억을 갱신한다
  useEffect(() => {
    if (areaCode === null && !nearMe) return
    savedFilters = {
      areaCode,
      sigunguCode,
      active,
      near: nearMe ? myLocation : null,
      nearLabel: nearMe ? nearLabel : null,
    }
  }, [areaCode, sigunguCode, active, nearMe, myLocation, nearLabel])

  const handleViewportChange = useCallback((v: MapViewport) => {
    savedViewport = v
  }, [])

  /**
   * 이 위치가 속한 지역 이름('경기 부천시').
   *
   * 가장 가까운 장소가 3km 안에 있으면 그 장소의 지역을 쓴다 — 장소의 지역은 TourAPI 주소에서
   * 온 것이라 정확하다. 없으면 가장 가까운 시군구 중심점으로 짐작한다(경계 근처에서는 옆 구가
   * 될 수 있다).
   */
  const regionLabelAt = useCallback(
    (at: LatLng, nearest: Place[]): string | null => {
      const first = nearest[0]
      if (first && distanceKm(at, first) <= 3 && first.group_name) {
        return `${first.group_name} ${first.region_name}`.trim()
      }
      let best: { r: (typeof regions)[number]; d: number } | null = null
      for (const r of regions) {
        const d = distanceKm(at, r)
        if (!best || d < best.d) best = { r, d }
      }
      if (!best) return null
      const g = groups.find((x) => x.tour_area_code === best.r.tour_area_code)
      return `${g?.name ?? ''} ${best.r.name}`.trim()
    },
    [regions, groups],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const categories = active.length ? active : undefined
      const kw = keyword.trim()
      let result: Place[]
      if (!kw && nearMe && myLocation) {
        // 내 위치 주변 — 하루 거리 안에서 가까운 NEAR_LIMIT 곳만(반경을 좁혀서)
        const near = await placesApi.nearest(myLocation, {
          limit: NEAR_LIMIT,
          maxKm: DAY_TRIP_RADIUS_KM,
          categories,
        })
        result = near.places
        setNearKm(near.km)
      } else {
        const filter: PlaceFilter = kw
          ? { categories, keyword: kw }
          : areaCode === null
            ? { categories }
            : sigunguCode === null
              ? { areaCode, categories }
              : { areaCode, sigunguCode, categories }
        result = await placesApi.list(filter)
      }
      // 내 위치를 확보한 상태라면 기본 정렬(평점순) 대신 거리순을 유지한다
      const sorted = myLocation
        ? [...result].sort((a, b) => distanceKm(myLocation, a) - distanceKm(myLocation, b))
        : result
      setList(sorted)
      if (!kw && nearMe && myLocation && labelPending.current) {
        labelPending.current = false
        setNearLabel(regionLabelAt(myLocation, sorted))
      }
    } finally {
      setLoading(false)
    }
  }, [areaCode, sigunguCode, active, myLocation, keyword, nearMe, regionLabelAt])

  // 지역 목록이 비동기로 도착하므로, url 에 지역 쿼리가 없고 여행 목적지로부터
  // 채워질 예정도 아니라면 첫 상위 지역 + 전체보기로 채운다
  useEffect(() => {
    if (areaCode !== null || tripId || groups.length === 0) return
    setAreaCode(groups[0].tour_area_code)
    setSigunguCode(null)
  }, [groups, areaCode, tripId])

  useEffect(() => {
    // 검색 중 · 내 위치 주변에서는 지역이 아직 안 정해졌어도 돈다 — 시/도를 보지 않는다
    if (!searching && !nearMe && (areaCode === null || groups.length === 0)) return
    void load()
  }, [load, areaCode, sigunguCode, groups.length, searching, nearMe])

  useEffect(() => {
    if (!tripId) return
    void trips.get(tripId).then((t) => {
      setTrip(t)
      // 코드라서 leaf 인지 상위 전체인지 따로 구분할 필요가 없다 — 그대로 옮긴다
      if (t) {
        setAreaCode(t.tour_area_code)
        setSigunguCode(t.tour_sigungu_code)
      }
    })
    void tripItems
      .listByTrip(tripId)
      .then((items) => setPickedCount(items.length))
  }, [tripId])

  /** 상위 지역을 바꾸면 하위 선택은 '전체'로 되돌린다 — 특정 구 하나로 좁혀 놓은 채 다른 시/도로
   *  넘어가면 그 시/도에 없는 지역명이 남아 있는 꼴이라 혼란스럽다 */
  function changeGroup(next: number) {
    setNearMe(false)
    setAreaCode(next)
    setSigunguCode(null)
    setParams((p) => {
      p.set(P_AREA, String(next))
      p.delete(P_SIGUNGU)
      return p
    })
  }

  /** 내 위치 주변을 끄고, 켜기 전에 보던 시/도 · 시군구로 돌아간다 */
  function exitNear() {
    setNearMe(false)
    setParams((p) => {
      if (areaCode !== null) p.set(P_AREA, String(areaCode))
      if (sigunguCode !== null) p.set(P_SIGUNGU, String(sigunguCode))
      return p
    })
  }

  function changeRegion(next: number | null) {
    setSigunguCode(next)
    setParams((p) => {
      if (next === null) p.delete(P_SIGUNGU)
      else p.set(P_SIGUNGU, String(next))
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

  /**
   * '↻ 내 위치 다시 찾기' — 위치를 새로 재서(10초까지) 내 위치 주변으로 바꾼다. 홈과 같은
   * 함수(locate) · 같은 실패 문구를 쓴다. 내 위치에서 가까운 100곳을 시/도 경계 없이
   * 보여 준다 — 시 경계 근처라면 옆 시 · 도의 장소도 섞인다. 지도는 그 100곳과 내 위치에 맞춘다.
   * 고른 카테고리는 그대로 둔다. 좌표는 URL 에 싣지 않는다.
   */
  async function researchNearby() {
    if (locating) return
    setLocating(true)
    const found = await locate(10000, { fresh: true })
    setLocating(false)
    if (!found.at) {
      setToast(
        found.reason === 'denied'
          ? `${LOCATE_FAILURE_TEXT.denied}. ${LOCATE_SETTINGS_HINT}`
          : found.reason === 'unsupported'
            ? LOCATE_FAILURE_TEXT.unsupported
            : `${LOCATE_FAILURE_TEXT[found.reason]}. GPS · 네트워크를 확인하고 다시 찾아 주세요.`,
      )
      return
    }
    labelPending.current = true
    setNearLabel(null)
    // 보던 목록(다른 시/도)과 새 위치를 한 화면에 맞추느라 지도가 잠깐 멀리 빠지지 않게 비운다 —
    // 빈 목록이면 지도가 내 위치로 먼저 옮겨 가고, 가까운 곳이 오면 거기에 맞춘다
    setList([])
    setMyLocation(found.at)
    setNearMe(true)
    setParams((p) => {
      p.delete(P_AREA)
      p.delete(P_SIGUNGU)
      return p
    })
    setToast(`내 위치에서 가까운 ${NEAR_LIMIT}곳을 보여 줍니다.`)
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
        onSelectGroup={setGroup}
        className="h-full w-full bg-ink-100"
        safeInsets={{ top: topInset, bottom: 120 }}
        userLocation={myLocation}
        // 내 위치까지 화면에 넣는 것은 '내 위치 주변'일 때만 — 강동구를 고르면 강동구에만 맞춘다
        fitUserLocation={nearMe && !searching}
        // 이름 검색 결과는 겹친 마커를 '+N' 으로 묶고, 검색어에 더 맞는 이름을 대표로
        groupOverlaps={searching}
        groupKeyword={searching ? keyword.trim() : undefined}
        initialViewport={initialViewport}
        onViewportChange={handleViewportChange}
        // 시/도 전체(경기 3,357곳 등)는 이름표 없이 점으로 — 이름표 마커 수천 개는 겹쳐
        // 읽히지도 않고 지도가 무거워진다. 내 위치 주변도 결과가 많으면 같은 이유로 점.
        // 이름 검색은 2,000곳 넘을 때만 점 — 그 아래는 이름표 + 겹침 묶기
        compact={
          searching
            ? list.length > COMPACT_KEYWORD_MIN
            : nearMe
              ? list.length > COMPACT_SEARCH_MIN
              : sigunguCode === null
        }
      />

      {/* 상단 필터 — 높이를 재서 지도가 마커를 이 아래로만 맞추게 한다 */}
      <div ref={topRef} className="pointer-events-none absolute inset-x-0 top-0 p-3">
        <div className="pointer-events-auto mb-2 flex items-center gap-1.5">
          <input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            placeholder="가게·명소 이름으로 찾기"
            aria-label="장소 이름 검색"
            className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[13px] text-ink-700 shadow-sm placeholder:text-ink-400"
          />
          {keywordInput && (
            <button
              type="button"
              onClick={() => setKeywordInput('')}
              aria-label="검색어 지우기"
              className="shrink-0 rounded-xl border border-ink-200 bg-white px-3 py-2 text-[13px] font-bold text-ink-500 shadow-sm"
            >
              ✕
            </button>
          )}
        </div>

        <div className="pointer-events-auto mb-2 flex items-center gap-1.5">
          <select
            value={nearMe ? NEAR_OPTION : (areaCode ?? '')}
            onChange={(e) => changeGroup(Number(e.target.value))}
            className="min-w-0 rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-[13px] font-bold text-ink-700 shadow-sm"
            aria-label="시/도 선택"
          >
            {/* 내 위치 주변인 동안만 보이는 자리표시 — 시/도를 고르면 꺼진다 */}
            {nearMe && (
              <option value={NEAR_OPTION} disabled>
                {nearLabel ? `📍 ${nearLabel}` : LOCATE_LABEL.nearMe}
              </option>
            )}
            {groups.map((g) => (
              <option key={g.tour_area_code} value={g.tour_area_code}>
                {g.name}
              </option>
            ))}
          </select>
          {nearMe ? (
            <button
              type="button"
              onClick={exitNear}
              aria-label="내 위치 주변 해제"
              className="flex min-w-0 flex-1 items-center justify-between gap-1.5 rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-[13px] font-bold text-ink-700 shadow-sm"
            >
              <span className="truncate">
                {loading || searching || nearKm === null
                  ? '내 위치 주변'
                  : list.length < NEAR_LIMIT
                    ? `하루 거리 ${DAY_TRIP_RADIUS_KM}km 안 · ${list.length}곳`
                    : `가까운 ${list.length}곳 · ${formatKm(nearKm)} 안`}
              </span>
              <span className="shrink-0 text-ink-400">✕</span>
            </button>
          ) : (
            <select
              value={sigunguCode ?? ALL_LEAF}
              onChange={(e) =>
                changeRegion(e.target.value === ALL_LEAF ? null : Number(e.target.value))
              }
              className="min-w-0 flex-1 rounded-xl border border-ink-200 bg-white px-2.5 py-2 text-[13px] font-bold text-ink-700 shadow-sm"
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
          )}
          {trip && (
            <span className="shrink-0 truncate rounded-xl bg-ink-800 px-2.5 py-2 text-[12px] font-bold text-white shadow-sm">
              담는 중 · {pickedCount}곳
            </span>
          )}
        </div>

        {searching && (
          <p className="pointer-events-auto mb-2 rounded-xl bg-ink-800/90 px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm">
            "{keyword}" — 전국에서 {list.length}곳 찾았습니다
            {list.length === 0 && ' · 이름의 일부만 넣어 보세요'}
          </p>
        )}

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

      {/* 내 위치 — '↻ 내 위치 다시 찾기', 찾는 동안 '찾는 중…'(홈과 같은 문구 묶음) */}
      <button
        type="button"
        onClick={() => void researchNearby()}
        disabled={locating}
        className="absolute right-3 bottom-32 z-10 flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-[13px] font-bold text-ink-700 shadow-lg disabled:opacity-70"
      >
        {locating ? LOCATE_LABEL.finding : LOCATE_LABEL.refindMine}
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
      {/* '+N' 묶음 — 묶인 장소 목록. 고르면 아래 장소 시트로 */}
      <BottomSheet
        open={Boolean(group)}
        onClose={() => setGroup(null)}
        title={group ? `이 근처 ${group.length}곳` : undefined}
      >
        {group && (
          <>
            <ul className="-mx-1 flex flex-col">
              {group.slice(0, GROUP_LIST_MAX).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setGroup(null)
                      setSelected(p)
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left hover:bg-ink-50"
                  >
                    <PlaceThumb place={p} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <CategoryDot category={p.category} />
                        <p className="truncate text-[14.5px] font-bold text-ink-800">{p.name}</p>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-ink-500">{p.address}</p>
                    </div>
                    {shownRating(p) && (
                      <span className="shrink-0 text-[12px]">
                        <RatingStar place={p} />
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            {group.length > GROUP_LIST_MAX && (
              <p className="mt-2 text-center text-[12.5px] text-ink-400">
                외 {group.length - GROUP_LIST_MAX}곳 — 지도를 더 확대하면 나뉘어 보입니다
              </p>
            )}
          </>
        )}
      </BottomSheet>

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
                {/* 가격대는 없다 — TourAPI 에 가격 정보가 없다 (price_level 칸은 20261008050000 에서 삭제) */}
                {(shownRating(selected) || selected.open_hours) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-500">
                    <RatingStar place={selected} />
                    {shownRating(selected) && selected.open_hours && <span>·</span>}
                    {selected.open_hours && (
                      <span className="line-clamp-2">{openHoursOneLine(selected.open_hours)}</span>
                    )}
                  </div>
                )}
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
                상세 보기
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
