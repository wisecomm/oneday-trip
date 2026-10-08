import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { sharedPlans } from '@/lib/db'
import {
  PLAN_HIDDEN_REASON_LABEL,
  TRANSPORT_LABEL,
  regionLabel,
  type SharedPlan,
} from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'

/**
 * SHARE-06-04 내가 올린 플랜.
 *
 * 내려간 플랜도 보여 준다 — 왜 내려갔는지 모르면 작성자가 할 수 있는 일이
 * 없다. 담긴 장소가 카탈로그에서 사라졌는지, 운영자가 내렸는지를 구분해
 * 적는다. 작성자가 스스로 내린 것은 사유가 없다.
 */
export function MyPlansPage() {
  const { user } = useAuth()
  const [list, setList] = useState<SharedPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      setList(await sharedPlans.listMine(user.id))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  async function setHidden(id: string, hidden: boolean) {
    setBusy(id)
    try {
      await sharedPlans.setHidden(id, hidden)
      await load()
    } finally {
      setBusy(null)
    }
  }

  async function remove(id: string) {
    if (
      !window.confirm(
        '이 코스를 지웁니다. 이미 담아 간 사람의 여행은 복사본이라 그대로 남습니다.',
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

  if (loading) return <Loading />

  return (
    <>
      <PageHeader title="내가 올린 코스" back />

      <div className="px-4 py-4">
        {list.length === 0 ? (
          <EmptyState
            icon="🧭"
            title="아직 올린 코스가 없습니다"
            description="내 여행 타임라인에서 '추천 코스 공유'를 누르면 공개할 수 있습니다."
            action={
              <Link to="/trips" className="btn-primary">
                내 여행 보기
              </Link>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((p) => (
              <li key={p.id} className="card p-4">
                <Link to={`/plans/${p.id}`} className="block">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 text-[16px] font-extrabold text-ink-800">
                      {p.title}
                    </p>
                    {p.is_hidden && (
                      <span className="badge shrink-0 bg-ink-200 text-ink-600">내려감</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-500">
                    {p.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="badge bg-ink-100 text-ink-600">
                      {regionLabel(p.group_name, p.region_name)}
                    </span>
                    <span className="badge bg-ink-100 text-ink-600">장소 {p.place_count}곳</span>
                    <span className="badge bg-ink-100 text-ink-600">
                      {TRANSPORT_LABEL[p.transport]}
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-400">
                    담아 간 사람 {p.clone_count}명
                  </p>
                </Link>

                {p.is_hidden && p.hidden_reason && (
                  <p className="mt-2 rounded-lg bg-ink-100 px-3 py-2 text-[12.5px] text-ink-600">
                    내려간 사유: {PLAN_HIDDEN_REASON_LABEL[p.hidden_reason]}
                    {p.hidden_reason === 'place_removed' &&
                      ' — 담긴 장소가 카탈로그에서 사라졌습니다. 다시 올리려면 여행을 고쳐 새로 올려 주세요.'}
                    {p.hidden_reason === 'admin' &&
                      ' — 운영자가 내린 코스입니다. 복구는 운영자에게 문의해 주세요.'}
                  </p>
                )}

                {/* 공개본은 스냅샷이라 원본 여행을 고쳐도 바뀌지 않는다.
                    반영하려면 그 여행에서 다시 올려야 하는데, 지금은 '다시
                    올리기'가 기존 플랜을 갱신하지 않고 하나 더 만든다. 그
                    경로를 제대로 만들기 전까지는 링크를 두지 않는다 — 누르면
                    중복 플랜이 생기기 때문이다. */}

                <div className="mt-2 flex gap-2">
                  {/* 운영자가 내린 플랜은 작성자가 되살릴 수 없다 — 그러면
                      운영자 조치가 아무 의미가 없어진다. 작성자가 스스로
                      내린 것은 hidden_reason 이 null 이라 여기 걸리지 않는다. */}
                  {p.hidden_reason !== 'admin' && (
                    <button
                      type="button"
                      onClick={() => setHidden(p.id, !p.is_hidden)}
                      disabled={busy === p.id}
                      className="btn-ghost flex-1 !py-2 text-[13px]"
                    >
                      {p.is_hidden ? '다시 공개' : '비공개로 내리기'}
                    </button>
                  )}
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
        )}
      </div>
    </>
  )
}
