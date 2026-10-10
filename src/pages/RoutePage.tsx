import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useNavigationType, useParams } from 'react-router-dom'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { tripItems, trips } from '@/lib/db'
import { optimizeOrder, routeDistanceKm, routeMinutes } from '@/lib/geo'
import { TRANSPORT_LABEL, regionLabel, type Place, type Trip, type TripItem } from '@/lib/types'
import { MapView } from '@/components/MapView'
import { EmptyState, Loading, PageHeader } from '@/components/ui'
import { CategoryDot } from '@/components/PlaceCard'

/**
 * TRIP-03-02 · 03. 나의 여행 > 3.2 경로 최적화 > 동선 최적화 지도
 * 등록 장소의 위경도를 배열로 모아 Polyline 으로 잇고,
 * [경로 최적화] 클릭 시 최단 거리 기준으로 방문 순서를 자동 재정렬한다.
 *
 * 순서 조정은 **드래그**다 (Q18). 원래는 위/아래 화살표 버튼이었고, 핸드폰에서
 * 드래그가 스크롤 제스처와 충돌한다는 게 이유였다. 실제로는 내 타임라인이
 * 드래그라 같은 일을 화면마다 다르게 하고 있었고, 충돌은 핸들에만 드래그를
 * 걸고(touch-none) 6px 이동 후 시작하게 하는 것으로 막는다.
 *
 * 저장 방식은 타임라인과 다르다. 여기서는 화면에서만 순서를 바꾸고 '순서
 * 저장하기' 를 눌러야 반영된다 — 최적화 결과를 보고 되돌릴 수 있어야 하는
 * 화면이기 때문이다.
 */
/**
 * 저장하지 않은 순서 — 정거장을 눌러 장소 상세에 갔다가 뒤로 오면 화면이 새로 그려져, 끌거나
 * 최적화해 둔 순서가 사라졌다. 앱을 켜 둔 동안 들고 있다가 뒤로 가기로 돌아왔을 때만 되살린다
 * (타임라인에서 새로 들어오면 버린다 — 저장 안 하고 나간 것이므로).
 */
let unsavedOrder: {
  tripId: string
  itemIds: string[]
  saved: { before: number; after: number } | null
} | null = null

export function RoutePage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const navType = useNavigationType()

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
  // 조회가 실패한 것과 여행이 없는 것은 다르다. 둘을 같게 다루면 네트워크가
  // 끊겼을 때 "여행을 찾을 수 없습니다"가 떠서 사용자가 여행이 지워진 줄 안다.
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setLoadFailed(false)
    Promise.all([trips.get(tripId), tripItems.listByTrip(tripId)])
      .then(([t, list]) => {
        if (!alive) return
        setTrip(t)
        const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order)
        // 뒤로 가기로 돌아왔고 장소 구성이 그대로면 저장 안 한 순서를 되살린다
        const draft = unsavedOrder
        const sameSet =
          draft?.tripId === tripId &&
          draft.itemIds.length === sorted.length &&
          sorted.every((it) => draft.itemIds.includes(it.id))
        if (navType === 'POP' && draft && sameSet) {
          const byId = new Map(sorted.map((it) => [it.id, it]))
          setItems(draft.itemIds.map((id, i) => ({ ...byId.get(id)!, sort_order: i })))
          setSaved(draft.saved)
          setDirty(true)
        } else {
          unsavedOrder = null
          setItems(sorted)
        }
      })
      .catch(() => {
        if (alive) setLoadFailed(true)
      })
      .finally(() => {
        // 성공이든 실패든 반드시 끈다. 이게 없으면 화면이 '불러오는 중'에
        // 영영 멈춘다 — 2026-10-01 에 실제로 그랬다.
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
    // navType 은 처음 들어온 방식만 본다 — 바뀌어도 다시 불러오지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId])

  // 저장 안 한 순서를 들고 있는다(장소 상세에 다녀와도 남게). 저장하면 버린다
  useEffect(() => {
    if (loading) return
    unsavedOrder = dirty ? { tripId, itemIds: items.map((it) => it.id), saved } : null
  }, [loading, dirty, items, saved, tripId])

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

  const sensors = useSensors(
    // 드래그는 6px 움직인 뒤에야 시작된다. 핸드폰에서 세로 스크롤과 충돌하지
    // 않게 하는 값이고, 핸들에 touch-none 을 걸어 브라우저가 그 영역의
    // 스크롤 제스처를 가져가지 않게 한다. 내 타임라인과 같은 설정이다.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** 끌어서 순서를 바꾼다. 화면에서만 바뀌고 저장은 '순서 저장하기' 를 눌러야 한다 */
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = items.findIndex((it) => it.place_id === active.id)
    const to = items.findIndex((it) => it.place_id === over.id)
    if (from < 0 || to < 0) return
    setItems(arrayMove(items, from, to).map((it, i) => ({ ...it, sort_order: i })))
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
      // 이미 최단 동선이면(개선폭이 미미하면) 저장할 게 없으니 버튼을 활성화하지 않는다
      if (after < before - 0.05) {
        setDirty(true)
      }
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
  if (loadFailed)
    return (
      <EmptyState
        icon="📡"
        title="불러오지 못했습니다"
        description="네트워크 상태를 확인한 뒤 다시 열어 주세요."
      />
    )
  if (!trip) return <EmptyState title="여행을 찾을 수 없습니다" />

  return (
    <>
      <PageHeader
        title="동선 최적화"
        subtitle={`${regionLabel(trip.group_name, trip.region_name)} · ${TRANSPORT_LABEL[trip.transport]} 기준`}
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

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={routePlaces.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
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
                      <SortableStop
                        key={place.id}
                        place={place}
                        index={i}
                        legLabel={
                          legMin === null
                            ? null
                            : `${TRANSPORT_LABEL[trip.transport]} 약 ${legMin}분`
                        }
                        selected={selectedId === place.id}
                        onOpen={() => navigate(`/places/${place.id}`)}
                      />
                    )
                  })}
                </ol>
              </SortableContext>
            </DndContext>
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

/**
 * 경로의 한 정거장. 끌어서 순서를 바꾼다.
 *
 * 핸들은 카드 전체가 아니라 점 여섯 개 아이콘에만 붙인다 — 카드 본문은 누르면 장소 상세로
 * 가는 버튼이라(타임라인과 같다, 10/10), 카드를 통째로 끌 수 있게 하면 누르려다 끌려 버린다.
 * 지도 핀을 누르면 그 카드가 테두리로 표시된다(selected).
 */
function SortableStop({
  place,
  index,
  legLabel,
  selected,
  onOpen,
}: {
  place: Place
  index: number
  legLabel: string | null
  selected: boolean
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: place.id,
  })

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'opacity-60' : ''}
    >
      {legLabel && (
        <div className="flex items-center gap-2 py-1 pl-3.5 text-[11.5px] text-ink-400">
          <span className="h-4 w-px bg-ink-300" />
          {legLabel}
        </div>
      )}
      <div
        className={`card flex w-full items-center gap-2 p-3 ${
          selected ? 'ring-2 ring-brand-400' : ''
        }`}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[13px] font-extrabold text-white">
            {index + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <CategoryDot category={place.category} />
              <p className="truncate text-[14.5px] font-bold text-ink-800">{place.name}</p>
            </div>
            <p className="truncate text-[12px] text-ink-500">{place.address}</p>
          </div>
        </button>

        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="순서 변경 핸들"
          className="shrink-0 cursor-grab touch-none rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 active:cursor-grabbing"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <circle cx="5" cy="4" r="1.4" />
            <circle cx="11" cy="4" r="1.4" />
            <circle cx="5" cy="8" r="1.4" />
            <circle cx="11" cy="8" r="1.4" />
            <circle cx="5" cy="12" r="1.4" />
            <circle cx="11" cy="12" r="1.4" />
          </svg>
        </button>
      </div>
    </li>
  )
}
