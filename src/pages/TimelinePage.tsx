import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
import { useAuth } from '@/lib/auth'
import { reservations, tripItems, trips, waitings } from '@/lib/db'
import { routeDistanceKm, routeMinutes } from '@/lib/geo'
import { CATEGORY_LABEL, type Trip, type TripItem } from '@/lib/types'
import { CategoryDot, PlaceThumb } from '@/components/PlaceCard'
import { EmptyState, Loading, PageHeader } from '@/components/ui'
import { dayCount } from './TripCreatePage'

/**
 * TRIP-03-01 · 03. 마이 트립 > 3.1 타임라인 관리 > 일자별 여행 리스트
 * 드래그로 방문 순서를 바꾸면 하단 동선 요약이 즉시 재계산된다.
 * 예약/웨이팅 상태는 카드 배지에 자동 바인딩된다.
 */
export function TimelinePage() {
  const { tripId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [trip, setTrip] = useState<Trip | null>(null)
  const [items, setItems] = useState<TripItem[]>([])
  const [day, setDay] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusByPlace, setStatusByPlace] = useState<Record<string, '예약 확정' | '웨이팅 중'>>({})

  const load = useCallback(async () => {
    const [t, list] = await Promise.all([trips.get(tripId), tripItems.listByTrip(tripId)])
    setTrip(t)
    setItems(list)

    if (user) {
      const [rs, ws] = await Promise.all([
        reservations.listByUser(user.id),
        waitings.listByUser(user.id),
      ])
      const map: Record<string, '예약 확정' | '웨이팅 중'> = {}
      for (const r of rs) if (r.status === 'confirmed') map[r.place_id] = '예약 확정'
      for (const w of ws) if (w.status === 'waiting') map[w.place_id] = '웨이팅 중'
      setStatusByPlace(map)
    }
    setLoading(false)
  }, [tripId, user])

  useEffect(() => {
    void load()
  }, [load])

  const days = trip ? dayCount(trip.start_date, trip.end_date) : 1
  const dayItems = useMemo(
    () => items.filter((it) => it.day_index === day).sort((a, b) => a.sort_order - b.sort_order),
    [items, day],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = dayItems.findIndex((it) => it.id === active.id)
    const newIndex = dayItems.findIndex((it) => it.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(dayItems, oldIndex, newIndex)
    // 낙관적 갱신 — 하단 동선 요약이 즉시 재계산된다
    setItems((prev) => [
      ...prev.filter((it) => it.day_index !== day),
      ...reordered.map((it, i) => ({ ...it, sort_order: i })),
    ])
    await tripItems.reorder(
      reordered.map((it, i) => ({ id: it.id, sort_order: i, day_index: day })),
    )
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
    await tripItems.remove(id)
  }

  if (loading) return <Loading />
  if (!trip)
    return (
      <EmptyState
        title="여행을 찾을 수 없습니다"
        action={
          <Link to="/trips" className="btn-primary">
            내 여행 목록
          </Link>
        }
      />
    )

  const points = dayItems
    .map((it) => it.place)
    .filter(Boolean)
    .map((p) => ({ lat: p!.lat, lng: p!.lng }))
  const totalKm = routeDistanceKm(points)
  const totalMin = routeMinutes(points, trip.transport)
  const isFull = dayItems.length >= trip.max_places_per_day

  return (
    <>
      <PageHeader
        title={trip.title}
        subtitle={`${trip.start_date} ~ ${trip.end_date} · 하루 최대 ${trip.max_places_per_day}곳`}
        back
        right={
          <Link
            to={`/trips/${tripId}/rules`}
            className="rounded-lg px-2 py-1.5 text-[13px] font-semibold text-ink-500"
          >
            규칙
          </Link>
        }
      />

      {/* 일자별 탭 — 여행 기간에 따라 동적으로 생성 */}
      <div className="sticky top-[57px] z-20 flex gap-2 overflow-x-auto border-b border-ink-200 bg-white px-4 py-2.5">
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => {
          const count = items.filter((it) => it.day_index === d).length
          const active = d === day
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ${
                active ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-500'
              }`}
            >
              Day {d}
              {count > 0 && (
                <span className={active ? 'ml-1 text-brand-200' : 'ml-1 text-ink-400'}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="px-4 py-4">
        {dayItems.length === 0 ? (
          <EmptyState
            icon="📍"
            title={`Day ${day} 일정이 비어 있어요`}
            description="지도나 AI 추천에서 마음에 드는 장소를 담아 보세요."
            action={
              <Link to={`/map?trip=${tripId}&day=${day}`} className="btn-primary">
                장소 담으러 가기
              </Link>
            }
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={dayItems.map((it) => it.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2.5">
                {dayItems.map((item, i) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    order={i + 1}
                    badge={item.place ? statusByPlace[item.place.id] : undefined}
                    legMinutes={
                      i > 0 && item.place && dayItems[i - 1].place
                        ? routeMinutes(
                            [
                              { lat: dayItems[i - 1].place!.lat, lng: dayItems[i - 1].place!.lng },
                              { lat: item.place.lat, lng: item.place.lng },
                            ],
                            trip.transport,
                          )
                        : null
                    }
                    onOpen={() => navigate(`/places/${item.place_id}`)}
                    onRemove={() => remove(item.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {dayItems.length > 0 && (
          <div className="card mt-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-bold text-ink-700">Day {day} 동선 요약</p>
                <p className="mt-0.5 text-[12.5px] text-ink-500">
                  총 {totalKm.toFixed(1)}km · 이동 {totalMin}분 · {dayItems.length}곳
                </p>
              </div>
              <Link to={`/trips/${tripId}/route?day=${day}`} className="btn-primary !px-3.5 !py-2 text-[13px]">
                동선 최적화
              </Link>
            </div>
          </div>
        )}

        <div className="mt-3">
          {isFull ? (
            <p className="rounded-xl bg-amber-50 px-4 py-3 text-[13px] leading-relaxed text-amber-700">
              하루 최대 방문 {trip.max_places_per_day}곳을 모두 채웠습니다. 더 담으려면 여행 규칙에서
              한도를 조정하세요.
            </p>
          ) : (
            <Link to={`/map?trip=${tripId}&day=${day}`} className="btn-ghost w-full">
              + Day {day}에 장소 추가 ({dayItems.length}/{trip.max_places_per_day})
            </Link>
          )}
        </div>
      </div>
    </>
  )
}

function SortableItem({
  item,
  order,
  badge,
  legMinutes,
  onOpen,
  onRemove,
}: {
  item: TripItem
  order: number
  badge?: '예약 확정' | '웨이팅 중'
  legMinutes: number | null
  onOpen: () => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const place = item.place

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? 'z-10 opacity-90' : ''}
    >
      {legMinutes !== null && (
        <div className="flex items-center gap-2 py-1 pl-6 text-[11.5px] text-ink-400">
          <span className="h-4 w-px bg-ink-300" />
          이동 약 {legMinutes}분
        </div>
      )}
      <div className="card flex items-center gap-3 p-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[13px] font-extrabold text-white">
          {order}
        </span>

        {place && <PlaceThumb place={place} size={46} />}

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-1.5">
            {place && <CategoryDot category={place.category} />}
            <p className="truncate text-[14.5px] font-bold text-ink-800">
              {place?.name ?? '알 수 없는 장소'}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-ink-500">
              {place ? CATEGORY_LABEL[place.category] : ''} · {place?.open_hours}
            </span>
            {badge && (
              <span
                className={`badge ${
                  badge === '예약 확정'
                    ? 'bg-brand-50 text-brand-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {badge}
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={onRemove}
          aria-label="일정에서 빼기"
          className="shrink-0 rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 hover:text-ink-500"
        >
          ✕
        </button>

        {/* 드래그 앤 드롭 정렬 핸들 */}
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
