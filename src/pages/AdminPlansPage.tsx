import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sharedPlans } from '@/lib/db'
import {
  PLAN_HIDDEN_REASON_LABEL,
  planAuthorLabel,
  regionLabel,
  type SharedPlan,
} from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'

/**
 * PLACE-07-01 / SHARE-06-06 운영자 플랜 관리.
 *
 * 공개된 플랜과 내려간 플랜을 한 화면에서 본다. 내려간 쪽이 할 일이 있는
 * 목록이므로 위에 둔다 — 특히 담긴 장소가 사라져 자동으로 내려간 플랜은
 * 사람이 손봐야 한다.
 */
export function AdminPlansPage() {
  const [list, setList] = useState<SharedPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 관리자는 RLS 상 내려간 플랜도 읽을 수 있다
      setList(await sharedPlans.listAll())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function setHidden(id: string, hidden: boolean) {
    setBusy(id)
    try {
      await sharedPlans.setHidden(id, hidden, 'admin')
      await load()
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <Loading />

  const hidden = list.filter((p) => p.is_hidden)
  const visible = list.filter((p) => !p.is_hidden)

  return (
    <>
      <PageHeader
        title="운영자 플랜 관리"
        back
        right={
          <Link to="/admin/plans/new" className="btn-primary !px-3 !py-1.5 text-[13px]">
            + 새 플랜
          </Link>
        }
      />

      <div className="px-4 py-4">
        {list.length === 0 ? (
          <EmptyState
            icon="🧭"
            title="아직 플랜이 없습니다"
            description="운영자가 먼저 완성된 하루를 올려 두어야 사용자가 담아 갈 것이 생깁니다."
            action={
              <Link to="/admin/plans/new" className="btn-primary">
                첫 플랜 만들기
              </Link>
            }
          />
        ) : (
          <>
            {hidden.length > 0 && (
              <section className="mb-6">
                <h2 className="section-title mb-2">
                  내려간 플랜 <span className="text-ink-400">{hidden.length}</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {hidden.map((p) => (
                    <li key={p.id} className="card p-4">
                      <Row plan={p} />
                      <p className="mt-2 rounded-lg bg-ink-100 px-3 py-2 text-[12.5px] text-ink-600">
                        사유: {p.hidden_reason ? PLAN_HIDDEN_REASON_LABEL[p.hidden_reason] : '알 수 없음'}
                        {p.hidden_reason === 'place_removed' &&
                          ' — 담긴 장소가 재수집으로 사라졌습니다. 장소를 갈아 끼우거나 플랜을 지워 주세요.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setHidden(p.id, false)}
                        disabled={busy === p.id}
                        className="btn-outline mt-2 w-full !py-2 text-[13px]"
                      >
                        다시 공개
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h2 className="section-title mb-2">
                공개 중 <span className="text-ink-400">{visible.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {visible.map((p) => (
                  <li key={p.id} className="card p-4">
                    <Row plan={p} />
                    <button
                      type="button"
                      onClick={() => setHidden(p.id, true)}
                      disabled={busy === p.id}
                      className="btn-ghost mt-2 w-full !py-2 text-[13px]"
                    >
                      내리기
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  )
}

function Row({ plan }: { plan: SharedPlan }) {
  return (
    <Link to={`/plans/${plan.id}`} className="block">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[15px] font-extrabold text-ink-800">{plan.title}</p>
        <span
          className={`badge shrink-0 ${
            plan.origin === 'admin' ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-600'
          }`}
        >
          {planAuthorLabel(plan)}
        </span>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-500">
        {regionLabel(plan.group_name, plan.region_name)} · 장소 {plan.place_count}곳 · 담아 간
        사람 {plan.clone_count}명
      </p>
    </Link>
  )
}
