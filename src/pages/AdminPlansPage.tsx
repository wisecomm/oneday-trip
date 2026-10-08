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

  /**
   * 내려간 플랜만 지울 수 있게 한다. 공개 중인 플랜에 삭제 버튼을 바로 두면
   * '내리기' 옆에서 한 번의 실수로 되돌릴 수 없는 일이 된다. 내린 뒤 다시 보고
   * 지우는 두 단계가 맞다.
   */
  async function remove(id: string) {
    if (
      !window.confirm(
        '이 코스를 지웁니다. 되돌릴 수 없습니다. 이미 담아 간 사람의 여행은 복사본이라 그대로 남습니다.',
      )
    )
      return
    setBusy(id)
    try {
      await sharedPlans.remove(id)
      await load()
    } finally {
      setBusy(null)
    }
  }

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
        title="운영자 코스 관리"
        back
        right={
          <Link to="/trips" className="btn-primary !px-3 !py-1.5 text-[13px]">
            + 새 코스
          </Link>
        }
      />

      <div className="px-4 py-4">
        {list.length === 0 ? (
          <EmptyState
            icon="🧭"
            title="아직 코스가 없습니다"
            description="운영자도 사용자와 같은 길로 만듭니다 — 여행을 하나 짜고 '코스로 올리기' 를 누르면 운영자 코스가 됩니다."
            action={
              <Link to="/trips" className="btn-primary">
                내 여행에서 만들기
              </Link>
            }
          />
        ) : (
          <>
            {hidden.length > 0 && (
              <section className="mb-6">
                <h2 className="section-title mb-2">
                  내려간 코스 <span className="text-ink-400">{hidden.length}</span>
                </h2>
                <ul className="flex flex-col gap-2">
                  {hidden.map((p) => (
                    <li key={p.id} className="card p-4">
                      <Row plan={p} />
                      <p className="mt-2 rounded-lg bg-ink-100 px-3 py-2 text-[12.5px] text-ink-600">
                        사유: {p.hidden_reason ? PLAN_HIDDEN_REASON_LABEL[p.hidden_reason] : '알 수 없음'}
                        {p.hidden_reason === 'place_removed' &&
                          ' — 담긴 장소가 재수집으로 사라졌습니다. 장소를 갈아 끼우거나 코스를 지워 주세요.'}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setHidden(p.id, false)}
                          disabled={busy === p.id}
                          className="btn-outline flex-1 !py-2 text-[13px]"
                        >
                          다시 공개
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(p.id)}
                          disabled={busy === p.id}
                          className="btn-ghost !px-3 !py-2 text-[13px] text-ink-500"
                        >
                          삭제
                        </button>
                      </div>
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
