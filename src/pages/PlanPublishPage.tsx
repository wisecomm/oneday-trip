import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { sharedPlans, tripItems, trips } from '@/lib/db'
import {
  MIN_PLAN_PLACES,
  regionLabel,
  type Trip,
  type TripItem,
} from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'

/**
 * SHARE-06-03 내 여행을 공용 플랜으로 올리기.
 *
 * 올리기는 라이브 공개가 아니라 스냅샷 복사다. 무엇이 넘어가고 무엇이 남는지
 * 올리기 전에 이 화면에서 그대로 보여 준다 — 사용자가 공개하려는 건 동선이지
 * 일기가 아니다.
 *
 * **다녀와서 전부 리뷰를 쓴 여행만 올릴 수 있다 (Q19).** 리뷰를 쓰면 그 항목이
 * visited 로 바뀌므로, 모든 항목이 visited 인지로 판정한다. 가 보지도 않은
 * 동선이 남에게 "가 볼 만한 하루"로 건네지는 걸 막는 장치다. 관리자는 예외다 —
 * 큐레이션 플랜은 원래 아무도 안 다녀온 동선이고, 그 판단에 책임지는 자리다.
 */
export function PlanPublishPage() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [items, setItems] = useState<TripItem[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'

  const load = useCallback(async () => {
    if (!tripId) return
    setLoading(true)
    try {
      const t = await trips.get(tripId)
      setTrip(t)
      if (t) setTitle(t.title)
      setItems(await tripItems.listByTrip(tripId))
    } finally {
      setLoading(false)
    }
  }, [tripId])

  useEffect(() => {
    void load()
  }, [load])

  async function publish() {
    if (!trip) return
    const t = title.trim()
    const d = description.trim()
    if (t.length < 2) {
      setError('공개용 제목을 2자 이상 입력해 주세요.')
      return
    }
    if (d.length < 5) {
      setError('설명을 5자 이상 입력해 주세요. 리스트에서 고를 때 제목만으로는 부족합니다.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const plan = await sharedPlans.publishFromTrip(trip.id, { title: t, description: d })
      navigate(`/plans/${plan.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '올리기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (!trip) {
    return (
      <>
        <PageHeader title="플랜으로 올리기" back />
        <EmptyState icon="🔍" title="여행을 찾을 수 없습니다" />
      </>
    )
  }

  // 한 곳짜리는 플랜이 아니라 즐겨찾기다
  const tooFew = items.length < MIN_PLAN_PLACES

  const unreviewed = useMemo(
    () => items.filter((it) => it.status !== 'visited').length,
    [items],
  )
  const needsReview = !isAdmin && unreviewed > 0
  // 제목·설명 검사를 누른 뒤가 아니라 버튼 상태로 보여 준다. 눌러 봐야 아는
  // 버튼은 무엇을 더 해야 하는지를 숨긴다.
  const titleOk = title.trim().length >= 2
  const descOk = description.trim().length >= 5
  const canPublish = !busy && !needsReview && titleOk && descOk

  const blockReason = needsReview
    ? `아직 리뷰를 쓰지 않은 장소가 ${unreviewed}곳 있습니다. 다녀온 뒤 전부 리뷰를 써야 올릴 수 있습니다.`
    : !titleOk
      ? '공개용 제목을 2자 이상 입력해 주세요.'
      : !descOk
        ? '설명을 5자 이상 입력해 주세요.'
        : null

  return (
    <>
      <PageHeader title="플랜으로 올리기" subtitle={trip.title} back />

      <div className="px-5 py-5">
        {tooFew ? (
          <EmptyState
            icon="📍"
            title={`장소가 ${MIN_PLAN_PLACES}곳 이상이어야 올릴 수 있습니다`}
            description="한 곳짜리는 플랜이 아니라 즐겨찾기입니다. 타임라인에 장소를 더 담아 주세요."
          />
        ) : (
          <>
            <section className="mb-6">
              <label className="label" htmlFor="plan-title">
                공개용 제목
              </label>
              <input
                id="plan-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                className="field"
              />
              <p className="hint mt-1.5">
                원본 제목이 "엄마 생신 나들이"처럼 사적인 이름이라면 바꿔 주세요.
              </p>
            </section>

            <section className="mb-6">
              <label className="label" htmlFor="plan-desc">
                설명
              </label>
              <textarea
                id="plan-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="어떤 하루인지 한두 문장으로 적어 주세요"
                className="field"
              />
              <p className="hint mt-1.5">
                리스트에서 플랜을 고르는 기준이 됩니다. 필수입니다.
              </p>
            </section>

            <section className="card mb-6 p-4">
              <h2 className="section-title mb-2">공개되는 내용</h2>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-600">
                <li>· 목적지 {regionLabel(trip.group_name, trip.region_name)}</li>
                <li>
                  · 장소 {items.length}곳과 순서, 시각
                </li>
                <li>
                  · 이동수단 · 동행인 · 시작/종료 시각
                </li>
                <li>· 요일과 계절 (특정 날짜는 공개되지 않습니다)</li>
              </ul>
              <h2 className="section-title mt-4 mb-2">공개되지 않는 내용</h2>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-600">
                <li>· 여행 날짜 — 언제 어디 있었는지의 기록이 됩니다</li>
                <li>· 방문 소감과 별점</li>
                <li>· 방문 여부 (다녀온 플랜이라는 배지만 붙습니다)</li>
              </ul>
              <p className="hint mt-3">
                올린 뒤 원본 여행을 고쳐도 공개본은 바뀌지 않습니다. 다시 올려야 반영됩니다.
              </p>
            </section>

            <button
              type="button"
              onClick={publish}
              disabled={!canPublish}
              className="btn-primary w-full"
            >
              {busy ? '올리는 중…' : '공개하기'}
            </button>
            {blockReason && <p className="hint mt-2">{blockReason}</p>}
            {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
          </>
        )}
      </div>
    </>
  )
}
