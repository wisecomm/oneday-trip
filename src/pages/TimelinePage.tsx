import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
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
import { reservations, tripItems, trips } from '@/lib/db'
import { routeDistanceKm, routeMinutes } from '@/lib/geo'
import { CATEGORY_LABEL, type Trip, type TripItem } from '@/lib/types'
import { CategoryDot, PlaceThumb } from '@/components/PlaceCard'
import { BottomSheet, EmptyState, Loading, PageHeader } from '@/components/ui'
import { VisitShareSheet } from '@/components/VisitShareSheet'
import type { VisitCardInput } from '@/lib/share-card'
import { formatTripDate } from './TripCreatePage'

/**
 * TRIP-03-01 · 03. 나의 여행 > 3.1 타임라인 관리 > 여행 리스트
 * 당일치기 서비스이므로 일자 구분 없이 하나의 방문 순서만 관리한다.
 * 드래그로 순서를 바꾸면 하단 동선 요약이 즉시 재계산되고,
 * 예약 상태는 카드 배지에 자동 바인딩된다.
 */
export function TimelinePage() {
  const { tripId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // 여행 생성 직후 추천 장소가 자동으로 담긴 경우, 사용자가 직접 담은 것으로
  // 오해하지 않도록 한 번 알려준다
  const autoAdded = (location.state as { autoAdded?: number } | null)?.autoAdded ?? 0
  const [noticeOpen, setNoticeOpen] = useState(autoAdded > 0)

  const [trip, setTrip] = useState<Trip | null>(null)
  const [items, setItems] = useState<TripItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusByPlace, setStatusByPlace] = useState<Record<string, '예약 확정'>>({})
  const [shareTarget, setShareTarget] = useState<VisitCardInput | null>(null)
  const [noteTarget, setNoteTarget] = useState<TripItem | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const load = useCallback(async () => {
    const [t, list] = await Promise.all([trips.get(tripId), tripItems.listByTrip(tripId)])
    setTrip(t)
    setItems(list)

    if (user) {
      const rs = await reservations.listByUser(user.id)
      const map: Record<string, '예약 확정'> = {}
      for (const r of rs) if (r.status === 'confirmed') map[r.place_id] = '예약 확정'
      setStatusByPlace(map)
    }
    setLoading(false)
  }, [tripId, user])

  useEffect(() => {
    void load()
  }, [load])

  const orderedItems = useMemo(
    () => [...items].sort((a, b) => a.sort_order - b.sort_order),
    [items],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = orderedItems.findIndex((it) => it.id === active.id)
    const newIndex = orderedItems.findIndex((it) => it.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const reordered = arrayMove(orderedItems, oldIndex, newIndex)
    // 낙관적 갱신 — 하단 동선 요약이 즉시 재계산된다
    setItems(reordered.map((it, i) => ({ ...it, sort_order: i })))
    await tripItems.reorder(reordered.map((it, i) => ({ id: it.id, sort_order: i })))
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
    await tripItems.remove(id)
  }

  /**
   * 방문 완료 토글 — 상태만 바꾼다. 소감 작성·SNS 포스팅은 각자 별도 버튼으로 뗐다.
   */
  async function toggleVisit(item: TripItem) {
    const nextStatus = item.status === 'visited' ? 'planned' : 'visited'
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, status: nextStatus } : it)),
    )
    await tripItems.setStatus(item.id, nextStatus)
  }

  function openShare(item: TripItem, order: number) {
    if (!item.place || !trip) return
    setShareTarget({
      place: item.place,
      tripTitle: trip.title,
      tripDate: formatTripDate(trip.trip_date),
      order,
    })
  }

  /** 소감 작성/수정 시트를 연다 — 이미 써 둔 소감이 있으면 그 내용을 채워 넣는다 */
  function openNote(item: TripItem) {
    setNoteTarget(item)
    setNoteDraft(item.note ?? '')
  }

  async function saveNote() {
    if (!noteTarget) return
    setSavingNote(true)
    try {
      await tripItems.setNote(noteTarget.id, noteDraft)
      const saved = noteDraft.trim() || null
      setItems((prev) =>
        prev.map((it) => (it.id === noteTarget.id ? { ...it, note: saved } : it)),
      )
      setNoteTarget(null)
    } finally {
      setSavingNote(false)
    }
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

  const points = orderedItems
    .map((it) => it.place)
    .filter(Boolean)
    .map((p) => ({ lat: p!.lat, lng: p!.lng }))
  const totalKm = routeDistanceKm(points)
  const totalMin = routeMinutes(points, trip.transport)

  return (
    <>
      <PageHeader
        title={trip.title}
        subtitle={`${formatTripDate(trip.trip_date)} · ${trip.start_time.slice(0, 5)}~${trip.end_time.slice(0, 5)}`}
        back
      />

      <div className="px-4 py-4">
        {noticeOpen && orderedItems.length > 0 && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-brand-50 px-4 py-3">
            <span className="text-[15px]" aria-hidden>
              ✨
            </span>
            <p className="flex-1 text-[13px] leading-relaxed font-semibold text-brand-700">
              오늘의 날씨와 취향에 맞춰 추천 {autoAdded}곳을 담고 최단 동선으로 정렬했습니다.
              마음에 들지 않으면 빼고 직접 담아 보세요.
            </p>
            <button
              type="button"
              onClick={() => setNoticeOpen(false)}
              aria-label="안내 닫기"
              className="shrink-0 rounded-md px-1 text-brand-400 hover:text-brand-600"
            >
              ✕
            </button>
          </div>
        )}

        {orderedItems.length === 0 ? (
          <EmptyState
            icon="📍"
            title="아직 담은 장소가 없어요"
            description="지도나 AI 추천에서 마음에 드는 장소를 담아 보세요."
            action={
              <Link to={`/map?trip=${tripId}`} className="btn-primary">
                장소 담으러 가기
              </Link>
            }
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext
              items={orderedItems.map((it) => it.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2.5">
                {orderedItems.map((item, i) => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    order={i + 1}
                    badge={item.place ? statusByPlace[item.place.id] : undefined}
                    legMinutes={
                      i > 0 && item.place && orderedItems[i - 1].place
                        ? routeMinutes(
                            [
                              { lat: orderedItems[i - 1].place!.lat, lng: orderedItems[i - 1].place!.lng },
                              { lat: item.place.lat, lng: item.place.lng },
                            ],
                            trip.transport,
                          )
                        : null
                    }
                    onOpen={() => navigate(`/places/${item.place_id}`)}
                    onRemove={() => remove(item.id)}
                    onToggleVisit={() => toggleVisit(item)}
                    onWriteNote={() => openNote(item)}
                    onShare={() => openShare(item, i + 1)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}

        {orderedItems.length > 0 && (
          <div className="card mt-4 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-bold text-ink-700">동선 요약</p>
                <p className="mt-0.5 text-[12.5px] text-ink-500">
                  총 {totalKm.toFixed(1)}km · 이동 {totalMin}분 · {orderedItems.length}곳
                </p>
              </div>
              <Link to={`/trips/${tripId}/route`} className="btn-primary !px-3.5 !py-2 text-[13px]">
                동선 최적화
              </Link>
            </div>
          </div>
        )}

        <div className="mt-3">
          <Link to={`/map?trip=${tripId}`} className="btn-ghost w-full">
            + 장소 추가
          </Link>
        </div>
      </div>

      <VisitShareSheet input={shareTarget} onClose={() => setShareTarget(null)} />

      <BottomSheet
        open={Boolean(noteTarget)}
        onClose={() => setNoteTarget(null)}
        title={noteTarget?.note ? '소감 수정' : '소감 작성'}
      >
        <div className="flex flex-col gap-4">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={5}
            placeholder="오늘 다녀온 소감을 남겨 보세요."
            className="field resize-y leading-relaxed"
          />
          <button
            type="button"
            onClick={saveNote}
            disabled={savingNote}
            className="btn-primary w-full"
          >
            {savingNote ? '저장 중…' : '저장'}
          </button>
        </div>
      </BottomSheet>
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
  onToggleVisit,
  onWriteNote,
  onShare,
}: {
  item: TripItem
  order: number
  badge?: '예약 확정'
  legMinutes: number | null
  onOpen: () => void
  onRemove: () => void
  onToggleVisit: () => void
  onWriteNote: () => void
  onShare: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const place = item.place
  const visited = item.status === 'visited'

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
      {/*
        한 줄에 정보와 액션을 모두 넣으면 장소명이 잘리고 버튼도 눈에 띄지 않는다.
        위쪽은 정보, 아래쪽은 액션으로 나눠 이름에 폭을 온전히 내어 준다.
      */}
      <div className={`card overflow-hidden ${visited ? 'bg-ink-50' : ''}`}>
        <div className="flex items-center gap-3 p-3">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-white ${
              visited ? 'bg-emerald-500' : 'bg-brand-500'
            }`}
          >
            {visited ? '✓' : order}
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
              {visited && <span className="badge bg-emerald-50 text-emerald-700">방문 완료</span>}
              {badge && <span className="badge bg-brand-50 text-brand-700">{badge}</span>}
            </div>
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

        <div className="flex divide-x divide-ink-100 border-t border-ink-100">
          <button
            type="button"
            onClick={onToggleVisit}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[13px] font-bold transition-colors ${
              visited
                ? 'text-emerald-600 hover:bg-emerald-50'
                : 'text-brand-600 hover:bg-brand-50'
            }`}
          >
            {visited ? '방문 완료 취소' : '✓ 방문 완료'}
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 px-5 py-2.5 text-[13px] font-semibold text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600"
          >
            삭제
          </button>
        </div>

        {/* 소감 작성·SNS 포스팅은 방문을 확정한 뒤에야 의미가 있어 완료 후에만 보여준다 */}
        {visited && (
          <div className="flex divide-x divide-ink-100 border-t border-ink-100">
            <button
              type="button"
              onClick={onWriteNote}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[13px] font-bold text-ink-600 transition-colors hover:bg-ink-100"
            >
              {item.note ? '소감 수정' : '소감 작성'}
            </button>
            <button
              type="button"
              onClick={onShare}
              className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[13px] font-bold text-ink-600 transition-colors hover:bg-ink-100"
            >
              SNS에 포스팅하기
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
