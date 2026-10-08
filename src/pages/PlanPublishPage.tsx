import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
 *
 * **관리자가 올리면 운영자 플랜이 된다 (Q20).** 관리자 전용 작성 화면을 따로
 * 두지 않는다 — 여행 만들기에 이미 있는 지역·시간·동행·장소 검색·순서 조정·동선
 * 최적화를 두 벌로 유지할 이유가 없었다. 관리자도 여행을 하나 짜고 여기서
 * 올린다. 작성자는 비워지고 origin 이 'admin' 이 된다.
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
  /** trip_item.id → 한 줄 팁. 관리자 전용 작성 화면을 없애면서 이리로 옮겼다 (Q20) */
  const [tips, setTips] = useState<Record<string, string>>({})

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
      const plan = await sharedPlans.publishFromTrip(trip.id, {
        title: t,
        description: d,
        asAdmin: isAdmin,
        tips,
      })
      // replace: 뒤로 가기가 이 입력 화면이 아니라 타임라인으로 가게 한다 — 돌아온
      // 타임라인은 '공유 완료'를 보여 준다. justShared 는 상세 화면의 완료 안내용.
      navigate(`/plans/${plan.id}`, { replace: true, state: { justShared: true } })
    } catch (e) {
      setError(e instanceof Error ? e.message : '공유하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (!trip) {
    return (
      <>
        <PageHeader title="추천 코스 공유" back />
        <EmptyState icon="🔍" title="여행을 찾을 수 없습니다" />
      </>
    )
  }

  // 이미 공유한 여행은 다시 공유하지 않는다 (Q23). 타임라인 버튼만 숨기면
  // 주소로 바로 들어오거나 뒤로 가기로 돌아왔을 때 같은 코스가 하나 더 생긴다.
  // (이 아래는 early return 뒤라 훅을 두지 않는다)
  if (trip.published_plan_id) {
    return (
      <>
        <PageHeader title="추천 코스 공유" back />
        <EmptyState
          icon="✅"
          title="이미 추천 코스로 공유한 여행입니다"
          description="다시 공유하려면 '내가 올린 코스'에서 지운 뒤 공유해 주세요."
          action={
            <Link to={`/plans/${trip.published_plan_id}`} className="btn-primary">
              코스 보기
            </Link>
          }
        />
      </>
    )
  }

  // 한 곳짜리는 플랜이 아니라 즐겨찾기다
  const tooFew = items.length < MIN_PLAN_PLACES

  // useMemo 를 쓰지 않는다. 이 줄은 early return 아래에 있어서 훅을 두면
  // 렌더마다 훅 개수가 달라져 "Rendered more hooks than during the previous
  // render" 로 화면이 통째로 죽는다. 항목 몇 개를 세는 일이라 메모할 값도 없다.
  const unreviewed = items.filter((it) => it.status !== 'visited').length
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
      <PageHeader
        title={isAdmin ? '운영자 추천 코스 공유' : '추천 코스 공유'}
        subtitle={trip.title}
        back
      />

      <div className="px-5 py-5">
        {tooFew ? (
          <EmptyState
            icon="📍"
            title={`장소가 ${MIN_PLAN_PLACES}곳 이상이어야 올릴 수 있습니다`}
            description="한 곳짜리는 코스가 아니라 즐겨찾기입니다. 타임라인에 장소를 더 담아 주세요."
          />
        ) : (
          <>
            {isAdmin && (
              <p className="mb-5 rounded-xl bg-brand-50 px-4 py-3 text-[13px] font-semibold text-brand-700">
                관리자 계정이라 <b>운영자 코스</b>로 올라갑니다. 작성자는 표시되지
                않고 목록에 "운영자" 배지가 붙습니다.
              </p>
            )}

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
                리스트에서 코스를 고르는 기준이 됩니다. 필수입니다.
              </p>
            </section>

            <section className="mb-6">
              <p className="label">장소별 한 줄 팁 (선택)</p>
              <p className="hint mb-2">
                "문 여는 시간에 맞춰 가면 덜 기다립니다" 같은 것. 코스 상세에서 그 장소
                아래에 붙습니다. 비워 두면 표시되지 않습니다.
              </p>
              <ol className="flex flex-col gap-2">
                {items
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((it, i) => (
                    <li key={it.id} className="card p-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700">
                          {i + 1}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-[14px] font-bold text-ink-800">
                          {it.place?.name ?? '이름 없는 장소'}
                        </p>
                      </div>
                      <input
                        value={tips[it.id] ?? ''}
                        onChange={(e) =>
                          setTips((prev) => ({ ...prev, [it.id]: e.target.value }))
                        }
                        maxLength={120}
                        placeholder="한 줄 팁 (선택)"
                        aria-label={`${it.place?.name ?? '장소'} 팁`}
                        className="field !py-2 mt-2 text-[13px]"
                      />
                    </li>
                  ))}
              </ol>
            </section>

            <section className="card mb-6 p-4">
              <h2 className="section-title mb-2">공개되는 내용</h2>
              <ul className="flex flex-col gap-1 text-[13px] text-ink-600">
                <li>· 목적지 {regionLabel(trip.group_name, trip.region_name)}</li>
                <li>
                  · 장소 {items.length}곳과 순서, 시각, 한 줄 팁
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
                <li>· 방문 여부 (다녀온 코스라는 배지만 붙습니다)</li>
              </ul>
              <p className="hint mt-3">
                공유한 뒤 원본 여행을 고쳐도 공개본은 바뀌지 않습니다. 다시 공유해야 반영됩니다.
              </p>
            </section>

            {error && (
              <p
                ref={(el) => el?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                className="mb-2 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700"
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={publish}
              disabled={!canPublish}
              className="btn-primary w-full"
            >
              {busy ? '공유하는 중…' : '공개하기'}
            </button>
            {blockReason && <p className="hint mt-2">{blockReason}</p>}
          </>
        )}
      </div>
    </>
  )
}
