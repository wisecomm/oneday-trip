import { useCallback, useEffect, useRef, useState } from 'react'
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

/** 추천 코스를 한 번에 받는 개수 — 처음 이만큼, '코스 더 보기'마다 이만큼 더(추천 장소와 같다) */
const PAGE_SIZE = 10

/**
 * 마지막으로 본 조건 · 목록 — 코스 상세에 갔다가 뒤로 오면 화면이 새로 그려져 조건이 처음 값으로,
 * 목록이 처음 10개로 돌아갔다(스크롤도 제자리로 못 감). 앱을 켜 둔 동안 들고 있다가 10분 안이면
 * 그대로 다시 쓴다(홈 '하루에 다녀올 만한 곳'과 같은 10분).
 */
let savedCourses: { filterKey: string; list: SharedPlan[]; total: number; at: number } | null = null
const KEEP_MS = 10 * 60 * 1000
const freshSaved = () => (savedCourses && Date.now() - savedCourses.at < KEEP_MS ? savedCourses : null)

/**
 * SHARE-06-01 공용 플랜 리스트 — 화면에서는 '추천 코스'라 부른다(Q22).
 *
 * 비로그인도 볼 수 있다. 공유 링크를 받은 사람이 로그인 벽을 먼저 만나면
 * 공유가 성립하지 않는다 — 담기를 누를 때 로그인으로 보낸다.
 * 추천 탭(RecommendHubPage) 안으로 들어가므로 embedded 면 머리말을 그리지 않는다.
 */
export function PlanListPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { groups, regions, loading: regionsLoading } = useRegions()
  const [saved] = useState(freshSaved)
  const savedFilter = saved ? (JSON.parse(saved.filterKey) as PlanFilter) : null
  const [areaCode, setAreaCode] = useState<number | null>(savedFilter?.areaCode ?? null)
  const [sigunguCode, setSigunguCode] = useState<number | null>(savedFilter?.sigunguCode ?? null)
  const [companions, setCompanions] = useState<Companion[]>((savedFilter?.companions as Companion[] | undefined) ?? [])
  const [sort, setSort] = useState<PlanFilter['sort']>(savedFilter?.sort ?? 'popular')
  const [list, setList] = useState<SharedPlan[]>(saved?.list ?? [])
  const [total, setTotal] = useState(saved?.total ?? 0)
  const [loading, setLoading] = useState(!saved)
  /** 기억해 둔 목록을 그대로 쓴 조건 — 이 조건이면 처음 불러오기를 건너뛴다(바꾸면 지움) */
  const restoredKeyRef = useRef<string | null>(saved?.filterKey ?? null)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 조건이 바뀌면 늘어난다 — 늦게 도착한 이전 조건의 응답(특히 '더 보기')을 버린다 */
  const requestRef = useRef(0)

  const filter: PlanFilter = {
    areaCode: areaCode ?? undefined,
    sigunguCode: sigunguCode ?? undefined,
    companions: companions.length ? companions : undefined,
    sort,
  }
  const filterKey = JSON.stringify(filter)

  const load = useCallback(async () => {
    const req = ++requestRef.current
    setLoading(true)
    try {
      const { plans, total } = await sharedPlans.list(JSON.parse(filterKey) as PlanFilter, {
        offset: 0,
        limit: PAGE_SIZE,
      })
      if (req !== requestRef.current) return
      setList(plans)
      setTotal(total)
      savedCourses = { filterKey, list: plans, total, at: Date.now() }
    } finally {
      if (req === requestRef.current) setLoading(false)
    }
  }, [filterKey])

  /** 다음 쪽 — 이미 받은 개수부터 PAGE_SIZE 개. 그사이 새 코스가 끼어 겹치면 한 번만 둔다 */
  async function showMore() {
    const req = requestRef.current
    setLoadingMore(true)
    try {
      const { plans, total } = await sharedPlans.list(filter, { offset: list.length, limit: PAGE_SIZE })
      if (req !== requestRef.current) return
      const seen = new Set(list.map((p) => p.id))
      const next = [...list, ...plans.filter((p) => !seen.has(p.id))]
      setList(next)
      setTotal(total)
      // 받은 시각(at)은 그대로 — 같은 목록을 늘린 것이라 10분 계산을 새로 시작하지 않는다
      if (savedCourses?.filterKey === filterKey) savedCourses = { ...savedCourses, list: next, total }
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    // 상세에 갔다 돌아와 기억해 둔 목록을 쓰는 중이면 다시 받지 않는다
    if (restoredKeyRef.current === filterKey) return
    restoredKeyRef.current = null
    void load()
  }, [load, filterKey])

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
      {!embedded && (
        <PageHeader title="추천 코스" subtitle="남이 짜 둔 하루를 그대로 가져올 수 있습니다" />
      )}

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
            title="조건에 맞는 코스가 없습니다"
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

        {!loading && list.length < total && (
          <button
            type="button"
            onClick={() => void showMore()}
            disabled={loadingMore}
            className="mt-3 w-full rounded-xl border border-ink-200 bg-white py-3 text-[13.5px] font-bold text-ink-700 shadow-sm hover:bg-ink-50 disabled:opacity-60"
          >
            {loadingMore ? '불러오는 중…' : `코스 더 보기 · ${list.length} / ${total}개`}
          </button>
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
