import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sharedPlans, type PlanFilter } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import {
  COMPANION_LABEL,
  TRANSPORT_LABEL,
  planAuthorLabel,
  regionLabel,
  type Companion,
  type SharedPlan,
} from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'

/** 시군구 드롭다운에서 '전체'를 뜻하는 값 */
const ALL_LEAF = ''

/**
 * SHARE-06-01 공용 플랜 리스트.
 *
 * 비로그인도 볼 수 있다. 공유 링크를 받은 사람이 로그인 벽을 먼저 만나면
 * 공유가 성립하지 않는다 — 담기를 누를 때 로그인으로 보낸다.
 */
export function PlanListPage() {
  const { groups, regions, loading: regionsLoading } = useRegions()
  const [areaCode, setAreaCode] = useState<number | null>(null)
  const [sigunguCode, setSigunguCode] = useState<number | null>(null)
  const [companions, setCompanions] = useState<Companion[]>([])
  const [sort, setSort] = useState<PlanFilter['sort']>('popular')
  const [list, setList] = useState<SharedPlan[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setList(
        await sharedPlans.list({
          areaCode: areaCode ?? undefined,
          sigunguCode: sigunguCode ?? undefined,
          companions: companions.length ? companions : undefined,
          sort,
        }),
      )
    } finally {
      setLoading(false)
    }
  }, [areaCode, sigunguCode, companions, sort])

  useEffect(() => {
    void load()
  }, [load])

  const leafOptions = regions.filter((r) => r.tour_area_code === areaCode)

  function changeArea(value: string) {
    setAreaCode(value === '' ? null : Number(value))
    // 상위 지역을 바꾸면 특정 구가 그대로 남아 혼란스러우니 '전체'로 되돌린다
    setSigunguCode(null)
  }

  function toggleCompanion(c: Companion) {
    setCompanions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  if (regionsLoading) return <Loading />

  return (
    <>
      <PageHeader title="플랜" subtitle="남이 짜 둔 하루를 그대로 가져올 수 있습니다" />

      <div className="px-4 py-4">
        <section className="mb-4">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={areaCode ?? ''}
              onChange={(e) => changeArea(e.target.value)}
              className="field"
              aria-label="시/도 선택"
            >
              <option value="">전국</option>
              {groups.map((g) => (
                <option key={g.tour_area_code} value={g.tour_area_code}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={sigunguCode ?? ALL_LEAF}
              onChange={(e) =>
                setSigunguCode(e.target.value === ALL_LEAF ? null : Number(e.target.value))
              }
              className="field"
              disabled={areaCode === null}
              aria-label="시군구 선택"
            >
              <option value={ALL_LEAF}>전체</option>
              {leafOptions.map((r) => (
                <option key={r.tour_sigungu_code} value={r.tour_sigungu_code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {(Object.keys(COMPANION_LABEL) as Companion[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCompanion(c)}
                className={companions.includes(c) ? 'chip-on' : 'chip-off'}
              >
                {COMPANION_LABEL[c]}
              </button>
            ))}
          </div>

          <div className="mt-2 flex gap-1.5">
            {(['popular', 'recent'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSort(s)}
                className={sort === s ? 'chip-on' : 'chip-off'}
              >
                {s === 'popular' ? '담은 순' : '최신순'}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <Loading />
        ) : list.length === 0 ? (
          <EmptyState
            icon="🧭"
            title="조건에 맞는 플랜이 없습니다"
            description="지역이나 동행인 조건을 넓혀 보세요."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((p) => (
              <li key={p.id}>
                <PlanCard plan={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** 리스트 카드. 설명은 두 줄로 자르고 전문은 상세에서 보여 준다 */
export function PlanCard({ plan }: { plan: SharedPlan }) {
  return (
    <Link to={`/plans/${plan.id}`} className="card block p-4">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[16px] font-extrabold text-ink-800">{plan.title}</p>
        {/* 작성자는 '운영자' 아니면 '회원' 둘뿐이다(Q17). 한쪽에만 배지를
            달면 다른 쪽은 작성자가 없는 것처럼 보이므로 둘 다 단다. 운영자만
            브랜드색인 이유는 그쪽이 고를 때 근거가 되는 신호이기 때문이다. */}
        <span
          className={`badge shrink-0 ${
            plan.origin === 'admin' ? 'bg-brand-50 text-brand-700' : 'bg-ink-100 text-ink-600'
          }`}
        >
          {planAuthorLabel(plan)}
        </span>
      </div>

      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-500">
        {plan.description}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="badge bg-ink-100 text-ink-600">
          {regionLabel(plan.group_name, plan.region_name)}
        </span>
        <span className="badge bg-ink-100 text-ink-600">장소 {plan.place_count}곳</span>
        <span className="badge bg-ink-100 text-ink-600">{TRANSPORT_LABEL[plan.transport]}</span>
        {plan.was_visited && <span className="badge bg-emerald-50 text-emerald-700">다녀옴</span>}
      </div>

      <p className="mt-2 text-[12px] text-ink-400">
        담아 간 사람 {plan.clone_count}명
        {/* 평가가 없으면 평균이 null 이다. 0.0 으로 보여 주면 '평가 없음'이
            '최하점'처럼 읽힌다 */}
        {plan.rating_avg != null && ` · ★ ${plan.rating_avg.toFixed(1)}`}
      </p>
    </Link>
  )
}
