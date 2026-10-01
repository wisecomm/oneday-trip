import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { planRatings, sharedPlans } from '@/lib/db'
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  COMPANION_LABEL,
  TRANSPORT_LABEL,
  PLAN_RATING_LABEL,
  planAuthorLabel,
  regionLabel,
  type PlanRating,
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
 * 드래그로 한다 — 담기는 편집 가능한 출발점이지 고정된 상품이 아니다.
 * 운영자 편집 화면도 같은 조작이다 — 두 화면이 다르면 손이 헷갈린다.
 */
export function PlanDetailPage() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [plan, setPlan] = useState<SharedPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [tripDate, setTripDate] = useState(todayIso(7))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 만족도 (SHARE-06-07)
  const [ratings, setRatings] = useState<PlanRating[]>([])
  const [myRating, setMyRating] = useState<PlanRating | null>(null)
  const [canRate, setCanRate] = useState(false)
  const [rateOpen, setRateOpen] = useState(false)
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')

  const load = useCallback(async () => {
    if (!planId) return
    setLoading(true)
    try {
      const [p, rs] = await Promise.all([
        sharedPlans.get(planId),
        planRatings.listByPlan(planId),
      ])
      setPlan(p)
      setRatings(rs)
      if (user) {
        const [mine, able] = await Promise.all([
          planRatings.mine(planId, user.id),
          planRatings.canRate(planId, user.id),
        ])
        setMyRating(mine)
        setCanRate(able)
        if (mine) {
          setScore(mine.rating)
          setComment(mine.comment ?? '')
        }
      }
    } finally {
      setLoading(false)
    }
  }, [planId, user])

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

  async function saveRating() {
    if (!plan || !user) return
    setBusy(true)
    setError(null)
    try {
      await planRatings.save(plan.id, user.id, score, comment)
      setRateOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '만족도 저장에 실패했습니다.')
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
          <p className="mt-2 text-[12px] text-ink-400">
            담아 간 사람 {plan.clone_count}명
            {/* 평가가 없으면 평균이 null 이다. 0.0 으로 보여 주면 '평가 없음'이
                '최하점'처럼 읽힌다 */}
            {plan.rating_avg != null
              ? ` · 만족도 ★ ${plan.rating_avg.toFixed(1)} (${plan.rating_count}명)`
              : ' · 아직 평가 없음'}
          </p>
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
            순서는 담은 뒤 내 타임라인에서 끌어서 바꿀 수 있습니다.
          </p>
        </section>

        <section className="mt-5">
          <h2 className="section-title mb-2">
            만족도{' '}
            <span className="text-ink-400">
              {plan.rating_avg != null ? `★ ${plan.rating_avg.toFixed(1)}` : '없음'}
            </span>
          </h2>

          {/* 담은 적 있는 사람만 평가할 수 있다. 담지도 않은 사람의 점수가
              섞이면 그 숫자는 믿을 게 못 된다. 판정은 DB 가 하고 여기서는
              버튼을 가릴 뿐이다 */}
          {canRate ? (
            <button
              type="button"
              onClick={() => setRateOpen(true)}
              className="btn-outline w-full !py-2 text-[13px]"
            >
              {myRating ? '내 평가 고치기' : '다녀온 뒤 평가 남기기'}
            </button>
          ) : (
            <p className="hint">담아서 다녀온 분만 평가를 남길 수 있습니다.</p>
          )}

          {ratings.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {ratings.map((r) => (
                <li key={r.id} className="card p-3">
                  <p className="text-[13px] font-bold text-ink-700">
                    ★ {r.rating}{' '}
                    <span className="font-normal text-ink-400">
                      {PLAN_RATING_LABEL[r.rating]}
                    </span>
                  </p>
                  {r.comment && <p className="hint mt-1">{r.comment}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="mt-5">
          <button type="button" onClick={startClone} className="btn-primary w-full">
            내 여행으로 담기
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

      <BottomSheet open={rateOpen} onClose={() => setRateOpen(false)} title="이 플랜 어땠나요?">
        <div className="mb-3 flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setScore(n)}
              aria-label={`${n}점`}
              className={`flex-1 rounded-xl py-3 text-[18px] ${
                score >= n ? 'bg-brand-50 text-brand-600' : 'bg-ink-100 text-ink-300'
              }`}
            >
              ★
            </button>
          ))}
        </div>
        <p className="mb-3 text-center text-[13px] font-semibold text-ink-600">
          {PLAN_RATING_LABEL[score]}
        </p>

        <label className="label" htmlFor="rating-comment">
          한 줄 (선택)
        </label>
        <input
          id="rating-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={200}
          placeholder="다음 사람에게 도움이 될 한마디"
          className="field"
        />
        <p className="hint mt-2">
          한 플랜에 한 번만 남길 수 있고, 언제든 고칠 수 있습니다.
        </p>
        <button
          type="button"
          onClick={saveRating}
          disabled={busy}
          className="btn-primary mt-4 w-full"
        >
          {busy ? '저장 중…' : myRating ? '고치기' : '남기기'}
        </button>
      </BottomSheet>

    </>
  )
}
