import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { tripItems, trips } from '@/lib/db'
import { optimizeOrder, routeDistanceKm, routeMinutes } from '@/lib/geo'
import { TRANSPORT_LABEL, type Place, type Trip, type TripItem } from '@/lib/types'
import { MapView } from '@/components/MapView'
import { EmptyState, Loading, PageHeader } from '@/components/ui'
import { CategoryDot } from '@/components/PlaceCard'

/**
 * TRIP-03-02 · 03. 마이 트립 > 3.2 경로 최적화 > 동선 최적화 지도
 * 등록 장소의 위경도를 배열로 모아 Polyline 으로 잇고,
 * [경로 최적화] 클릭 시 최단 거리 기준으로 방문 순서를 자동 재정렬한다.
 */
export function RoutePage() {
  const { tripId = '' } = useParams()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [items, setItems] = useState<TripItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [saved, setSaved] = useState<{ before: number; after: number } | null>(null)
  // 경로 최적화나 수동 순서 변경으로 화면상 순서가 DB 에 반영된 상태와 달라지면 켜진다
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([trips.get(tripId), tripItems.listByTrip(tripId)]).then(([t, list]) => {
      if (!alive) return
      setTrip(t)
      setItems([...list].sort((a, b) => a.sort_order - b.sort_order))
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [tripId])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(id)
  }, [toast])

  const routePlaces = useMemo(
    () => items.map((it) => it.place).filter(Boolean) as Place[],
    [items],
  )
  const points = routePlaces.map((p) => ({ lat: p.lat, lng: p.lng }))
  const totalKm = routeDistanceKm(points)
  const totalMin = trip ? routeMinutes(points, trip.transport) : 0

  /** 인접한 두 항목의 순서를 맞바꾼다 — 드래그 대신 위/아래 버튼을 쓰는 이유는
   *  핸드폰에서 드래그가 화면 스크롤 제스처와 자주 충돌해 손가락으로 정확히
   *  집어 옮기기 어렵기 때문이다. 버튼은 오탐 없이 항상 정확히 한 칸씩 움직인다.
   *  화면에서만 순서를 바꾸고, 실제 저장은 '저장' 버튼을 눌러야 이뤄진다. */
  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next.map((it, i) => ({ ...it, sort_order: i })))
    setSaved(null)
    setDirty(true)
  }

  /** 최단 거리 기준으로 화면상 순서만 재정렬한다 — 저장은 '저장' 버튼을 눌러야 이뤄진다 */
  function optimize() {
    if (!trip || items.length < 3) return
    setOptimizing(true)
    try {
      const before = routeDistanceKm(points)
      const order = optimizeOrder(points)
      const reordered = order.map((i) => items[i])
      const after = routeDistanceKm(
        reordered.map((it) => ({ lat: it.place!.lat, lng: it.place!.lng })),
      )

      setItems(reordered.map((it, i) => ({ ...it, sort_order: i })))
      setSaved({ before, after })
      setDirty(true)
    } finally {
      setOptimizing(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await tripItems.reorder(items.map((it, i) => ({ id: it.id, sort_order: i })))
      setDirty(false)
      setToast('저장했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Loading />
  if (!trip) return <EmptyState title="여행을 찾을 수 없습니다" />

  return (
    <>
      <PageHeader
        title="동선 최적화"
        subtitle={`${trip.destination} · ${TRANSPORT_LABEL[trip.transport]} 기준`}
        back
      />

      {routePlaces.length === 0 ? (
        <EmptyState icon="🧭" title="등록된 장소가 없습니다" />
      ) : (
        <>
          <MapView
            places={routePlaces}
            route={routePlaces}
            selectedId={selectedId}
            onSelect={(p) => setSelectedId(p.id)}
            className="h-[46vh] w-full bg-ink-100"
          />

          <div className="px-4 py-4">
            <div className="card mb-3 flex items-center justify-between p-4">
              <div>
                <p className="text-[12.5px] font-semibold text-ink-500">현재 동선</p>
                <p className="mt-0.5 text-[18px] font-extrabold text-ink-800">
                  {totalKm.toFixed(1)}km
                  <span className="ml-2 text-[14px] font-bold text-ink-500">이동 {totalMin}분</span>
                </p>
              </div>
              <button
                type="button"
                onClick={optimize}
                disabled={optimizing || routePlaces.length < 3}
                className="btn-primary !px-4 !py-2.5 text-[13.5px]"
              >
                {optimizing ? '계산 중…' : '경로 최적화'}
              </button>
            </div>

            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="btn-primary mb-3 w-full"
            >
              {saving ? '저장 중…' : dirty ? '순서 저장하기' : '저장됨'}
            </button>

            {routePlaces.length < 3 && (
              <p className="hint mb-3">장소가 3곳 이상일 때 최적화 효과가 있습니다.</p>
            )}

            {saved && (
              <p className="mb-3 rounded-xl bg-brand-50 px-4 py-3 text-[13px] font-semibold text-brand-700">
                {saved.after < saved.before - 0.05
                  ? `동선을 ${(saved.before - saved.after).toFixed(1)}km 단축했습니다. (${saved.before.toFixed(1)}km → ${saved.after.toFixed(1)}km)`
                  : '이미 최단 동선입니다. 순서를 바꿀 필요가 없어요.'}
              </p>
            )}

            <ol className="flex flex-col gap-2">
              {routePlaces.map((place, i) => {
                const legMin =
                  i > 0
                    ? routeMinutes(
                        [
                          { lat: routePlaces[i - 1].lat, lng: routePlaces[i - 1].lng },
                          { lat: place.lat, lng: place.lng },
                        ],
                        trip.transport,
                      )
                    : null
                return (
                  <li key={place.id}>
                    {legMin !== null && (
                      <div className="flex items-center gap-2 py-1 pl-3.5 text-[11.5px] text-ink-400">
                        <span className="h-4 w-px bg-ink-300" />
                        {TRANSPORT_LABEL[trip.transport]} 약 {legMin}분
                      </div>
                    )}
                    <div
                      className={`card flex w-full items-center gap-2 p-3 ${
                        selectedId === place.id ? 'ring-2 ring-brand-400' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedId(place.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[13px] font-extrabold text-white">
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <CategoryDot category={place.category} />
                            <p className="truncate text-[14.5px] font-bold text-ink-800">
                              {place.name}
                            </p>
                          </div>
                          <p className="truncate text-[12px] text-ink-500">{place.address}</p>
                        </div>
                      </button>

                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label="위로 이동"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink-200 text-ink-500 disabled:opacity-30"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                              d="M5 15l7-7 7 7"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => move(i, 1)}
                          disabled={i === routePlaces.length - 1}
                          aria-label="아래로 이동"
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink-200 text-ink-500 disabled:opacity-30"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                            <path
                              d="M5 9l7 7 7-7"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
          <p className="rounded-xl bg-ink-800 px-4 py-2.5 text-center text-[13px] font-semibold text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}
    </>
  )
}
