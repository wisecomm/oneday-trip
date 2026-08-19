import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, tripItems, trips } from '@/lib/db'
import { DESTINATIONS } from '@/lib/seed'
import { distanceKm } from '@/lib/geo'
import { CATEGORY_LABEL, type Place, type PlaceCategory, type Trip } from '@/lib/types'
import { MapView } from '@/components/MapView'
import { CategoryDot, PlaceThumb } from '@/components/PlaceCard'
import { BottomSheet, Loading } from '@/components/ui'

const CATEGORIES: PlaceCategory[] = ['babzip', 'cafe', 'sulzip', 'spot']

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

  const [region, setRegion] = useState<string>(params.get('region') ?? DESTINATIONS[0])
  const [active, setActive] = useState<PlaceCategory[]>([])
  const [list, setList] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Place | null>(null)
  const [trip, setTrip] = useState<Trip | null>(null)
  const [pickedCount, setPickedCount] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(await placesApi.list({ region, categories: active.length ? active : undefined }))
    } finally {
      setLoading(false)
    }
  }, [region, active])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!tripId) return
    void trips.get(tripId).then((t) => {
      setTrip(t)
      if (t) setRegion(t.destination)
    })
    void tripItems
      .listByTrip(tripId)
      .then((items) => setPickedCount(items.length))
  }, [tripId])

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
        setList((prev) =>
          [...prev].sort((a, b) => distanceKm(me, a) - distanceKm(me, b)),
        )
        setToast('내 위치에서 가까운 순으로 정렬했습니다.')
      },
      () => setToast('위치 권한이 거부되어 재탐색할 수 없습니다.'),
    )
  }

  async function addToTrip(place: Place) {
    if (!tripId || !trip) return
    if (pickedCount >= trip.max_places_per_day) {
      setToast(`최대 ${trip.max_places_per_day}곳까지만 담을 수 있습니다.`)
      return
    }
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
      />

      {/* 상단 필터 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
        <div className="pointer-events-auto mb-2 flex items-center gap-2">
          <select
            value={region}
            onChange={(e) => {
              setRegion(e.target.value)
              setParams((p) => {
                p.set('region', e.target.value)
                return p
              })
            }}
            className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-[13.5px] font-bold text-ink-700 shadow-sm"
            aria-label="지역 선택"
          >
            {DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {trip && (
            <span className="truncate rounded-xl bg-ink-800 px-3 py-2 text-[12.5px] font-bold text-white shadow-sm">
              담는 중 · {pickedCount}/{trip.max_places_per_day}
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

            {selected.waiting_count > 0 && (
              <p className="mt-2 text-[13px] font-bold text-babzip">
                실시간 대기 {selected.waiting_count}팀
              </p>
            )}

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
