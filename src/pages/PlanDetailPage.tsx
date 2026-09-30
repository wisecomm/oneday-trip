import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { sharedPlans } from '@/lib/db'
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  COMPANION_LABEL,
  TRANSPORT_LABEL,
  planAuthorLabel,
  regionLabel,
  type SharedPlan,
} from '@/lib/types'
import { BottomSheet, EmptyState, Loading, PageHeader } from '@/components/ui'

function todayIso(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/**
 * SHARE-06-02 공용 플랜 상세.
 *
 * 순서 확인은 읽기 전용이다. 순서를 바꾸는 것은 담은 *뒤* 내 타임라인에서
 * ▲▼ 로 한다 — 담기는 편집 가능한 출발점이지 고정된 상품이 아니다.
 */
export function PlanDetailPage() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [plan, setPlan] = useState<SharedPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [tripDate, setTripDate] = useState(todayIso(7))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!planId) return
    setLoading(true)
    try {
      setPlan(await sharedPlans.get(planId))
    } finally {
      setLoading(false)
    }
  }, [planId])

  useEffect(() => {
    void load()
  }, [load])

  /** 담기는 로그인이 필요하다. 링크를 받은 사람은 여기서 처음 로그인을 만난다 */
  function startClone() {
    if (!user) {
      navigate('/login', { state: { from: `/plans/${planId}` } })
      return
    }
    setCloneOpen(true)
  }

  async function confirmClone() {
    if (!plan || !user) return
    setBusy(true)
    setError(null)
    try {
      const tripId = await sharedPlans.clone(plan.id, tripDate, { userId: user.id })
      navigate(`/trips/${tripId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '담기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function submitReport() {
    if (!plan || !user) return
    setBusy(true)
    setError(null)
    try {
      await sharedPlans.report(plan.id, user.id, reason.trim())
      setReportOpen(false)
      setReason('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '신고에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading />
  if (!plan) {
    return (
      <>
        <PageHeader title="플랜" back />
        <EmptyState
          icon="🔍"
          title="플랜을 찾을 수 없습니다"
          description="내려갔거나 삭제된 플랜일 수 있습니다."
          action={
            <Link to="/plans" className="btn-primary">
              플랜 둘러보기
            </Link>
          }
        />
      </>
    )
  }

  const items = plan.items ?? []

  return (
    <>
      <PageHeader title={plan.title} subtitle={planAuthorLabel(plan)} back />

      <div className="px-4 py-4">
        <section className="card p-4">
          <p className="text-[14px] leading-relaxed text-ink-700">{plan.description}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="badge bg-ink-100 text-ink-600">
              {regionLabel(plan.group_name, plan.region_name)}
            </span>
            <span className="badge bg-ink-100 text-ink-600">
              {plan.start_time.slice(0, 5)}–{plan.end_time.slice(0, 5)}
            </span>
            <span className="badge bg-ink-100 text-ink-600">
              {TRANSPORT_LABEL[plan.transport]}
            </span>
            {plan.companions.map((c) => (
              <span key={c} className="badge bg-ink-100 text-ink-600">
                {COMPANION_LABEL[c]}
              </span>
            ))}
            {plan.was_visited && (
              <span className="badge bg-emerald-50 text-emerald-700">다녀옴</span>
            )}
          </div>
          <p className="mt-2 text-[12px] text-ink-400">담아 간 사람 {plan.clone_count}명</p>
        </section>

        <section className="mt-4">
          <h2 className="section-title mb-2">
            동선 <span className="text-ink-400">{items.length}곳</span>
          </h2>
          <ol className="flex flex-col gap-2">
            {items.map((it, i) => (
              <li key={it.id} className="card flex items-start gap-3 p-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/places/${it.place_id}`}
                    className="block truncate text-[15px] font-bold text-ink-800"
                  >
                    {it.place?.name ?? '알 수 없는 장소'}
                  </Link>
                  <p className="mt-0.5 text-[12.5px] text-ink-500">
                    {it.place && (
                      <>
                        {CATEGORY_ICON[it.place.category]} {CATEGORY_LABEL[it.place.category]}
                      </>
                    )}
                    {it.planned_time && ` · ${it.planned_time.slice(0, 5)}`}
                  </p>
                  {it.tip && <p className="hint mt-1">{it.tip}</p>}
                </div>
              </li>
            ))}
          </ol>
          <p className="hint mt-2">
            순서는 담은 뒤 내 타임라인에서 ▲▼ 로 바꿀 수 있습니다.
          </p>
        </section>

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={startClone} className="btn-primary flex-1">
            내 여행으로 담기
          </button>
          <button
            type="button"
            onClick={() => (user ? setReportOpen(true) : navigate('/login'))}
            className="btn-ghost !px-3 text-[13px] text-ink-500"
          >
            신고
          </button>
        </div>
        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
      </div>

      <BottomSheet open={cloneOpen} onClose={() => setCloneOpen(false)} title="언제 가시나요?">
        <label className="label" htmlFor="clone-date">
          여행 날짜
        </label>
        <input
          id="clone-date"
          type="date"
          value={tripDate}
          onChange={(e) => setTripDate(e.target.value)}
          className="field"
        />
        <p className="hint mt-2">
          담으면 내 여행이 새로 만들어집니다. 원본 플랜이 나중에 바뀌거나 내려가도 내 여행은
          그대로입니다.
        </p>
        <button
          type="button"
          onClick={confirmClone}
          disabled={busy}
          className="btn-primary mt-4 w-full"
        >
          {busy ? '담는 중…' : '담기'}
        </button>
      </BottomSheet>

      <BottomSheet open={reportOpen} onClose={() => setReportOpen(false)} title="신고하기">
        <label className="label" htmlFor="report-reason">
          어떤 점이 문제인가요?
        </label>
        <input
          id="report-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          placeholder="예: 설명이 광고입니다"
          className="field"
        />
        <p className="hint mt-2">
          여러 사람이 신고하면 자동으로 내려가고 운영자가 확인합니다. 한 플랜에 한 번만 신고할
          수 있습니다.
        </p>
        <button
          type="button"
          onClick={submitReport}
          disabled={busy || reason.trim().length < 2}
          className="btn-primary mt-4 w-full"
        >
          {busy ? '보내는 중…' : '신고 보내기'}
        </button>
      </BottomSheet>
    </>
  )
}
