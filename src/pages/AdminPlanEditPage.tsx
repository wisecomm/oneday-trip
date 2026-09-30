import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { places, sharedPlans } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  COMPANION_LABEL,
  MIN_PLAN_PLACES,
  TRANSPORT_LABEL,
  type Companion,
  type Place,
  type PlaceCategory,
  type Transport,
} from '@/lib/types'
import { Loading, PageHeader } from '@/components/ui'

const ALL_LEAF = ''

interface Draft {
  place: Place
  planned_time: string
  tip: string
}

/**
 * SHARE-06-05 운영자 플랜 작성.
 *
 * 원본 여행 없이 빈 상태에서 시작한다. 남의 여행을 불러오는 입구는 없다 —
 * 그건 그 사람이 언제 어디 있었는지의 기록이고, 한 번 열면 "관리자는 모든
 * 여행을 볼 수 있다"가 시스템의 성질이 된다 (7-D7).
 *
 * 순서 조정은 ▲▼ 다. 드래그 앤 드롭은 쓰지 않는다 (12번).
 */
export function AdminPlanEditPage() {
  const navigate = useNavigate()
  const { groups, regions, loading: regionsLoading } = useRegions()

  const [areaCode, setAreaCode] = useState<number | null>(null)
  const [sigunguCode, setSigunguCode] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [transport, setTransport] = useState<Transport>('transit')
  const [companions, setCompanions] = useState<Companion[]>(['friends'])
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('18:00')

  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<PlaceCategory | null>(null)
  const [found, setFound] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Draft[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const leafOptions = useMemo(
    () => regions.filter((r) => r.tour_area_code === areaCode),
    [regions, areaCode],
  )

  useEffect(() => {
    if (groups.length === 0 || areaCode !== null) return
    setAreaCode(groups[0].tour_area_code)
  }, [groups, areaCode])

  const search = useCallback(async () => {
    if (areaCode === null) return
    setSearching(true)
    try {
      const rows = await places.list({
        areaCode,
        sigunguCode: sigunguCode ?? undefined,
        categories: category ? [category] : undefined,
        keyword: keyword.trim() || undefined,
      })
      setFound(rows.slice(0, 30))
    } finally {
      setSearching(false)
    }
  }, [areaCode, sigunguCode, category, keyword])

  function add(place: Place) {
    if (picked.some((d) => d.place.id === place.id)) return
    setPicked((prev) => [...prev, { place, planned_time: '', tip: '' }])
  }

  function move(index: number, delta: number) {
    setPicked((prev) => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function patch(index: number, field: 'planned_time' | 'tip', value: string) {
    setPicked((prev) => prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)))
  }

  async function save() {
    const t = title.trim()
    const d = description.trim()
    if (t.length < 2) return setError('제목을 2자 이상 입력해 주세요.')
    if (d.length < 5) return setError('설명을 5자 이상 입력해 주세요.')
    if (picked.length < MIN_PLAN_PLACES)
      return setError(`장소를 ${MIN_PLAN_PLACES}곳 이상 담아 주세요.`)
    if (areaCode === null) return setError('지역을 골라 주세요.')

    setBusy(true)
    setError(null)
    try {
      const plan = await sharedPlans.createByAdmin({
        title: t,
        description: d,
        tour_area_code: areaCode,
        tour_sigungu_code: sigunguCode,
        transport,
        companions,
        start_time: startTime,
        end_time: endTime,
        items: picked.map((p) => ({
          place_id: p.place.id,
          planned_time: p.planned_time || null,
          tip: p.tip.trim() || null,
        })),
      })
      navigate(`/plans/${plan.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  if (regionsLoading) return <Loading />

  return (
    <>
      <PageHeader title="새 공용 플랜" subtitle="원본 여행 없이 직접 엮습니다" back />

      <div className="px-5 py-5">
        <section className="mb-6">
          <label className="label" htmlFor="admin-title">
            제목
          </label>
          <input
            id="admin-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={60}
            placeholder="예: 성수동 반나절"
            className="field"
          />
        </section>

        <section className="mb-6">
          <label className="label" htmlFor="admin-desc">
            설명
          </label>
          <textarea
            id="admin-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="어떤 하루인지 한두 문장으로"
            className="field"
          />
          <p className="hint mt-1.5">리스트에서 고르는 기준이 됩니다. 필수입니다.</p>
        </section>

        <section className="mb-6">
          <p className="label">지역</p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={areaCode ?? ''}
              onChange={(e) => {
                setAreaCode(Number(e.target.value))
                setSigunguCode(null)
              }}
              className="field"
              aria-label="시/도 선택"
            >
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
        </section>

        <section className="mb-6">
          <p className="label">이동수단 · 동행인 · 시간</p>
          <div className="mb-2 flex gap-1.5">
            {(Object.keys(TRANSPORT_LABEL) as Transport[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTransport(t)}
                className={transport === t ? 'chip-on' : 'chip-off'}
              >
                {TRANSPORT_LABEL[t]}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(Object.keys(COMPANION_LABEL) as Companion[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() =>
                  setCompanions((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
                  )
                }
                className={companions.includes(c) ? 'chip-on' : 'chip-off'}
              >
                {COMPANION_LABEL[c]}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="field"
              aria-label="시작 시각"
            />
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="field"
              aria-label="종료 시각"
            />
          </div>
        </section>

        <section className="mb-6">
          <p className="label">장소 찾기</p>
          <div className="mb-2 flex gap-2">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search()}
              placeholder="이름으로 검색 (비우면 전체)"
              className="field flex-1"
            />
            <button type="button" onClick={() => void search()} className="btn-outline !px-4">
              검색
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className={category === null ? 'chip-on' : 'chip-off'}
            >
              전체
            </button>
            {(Object.keys(CATEGORY_LABEL) as PlaceCategory[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={category === c ? 'chip-on' : 'chip-off'}
              >
                {CATEGORY_ICON[c]} {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          {searching ? (
            <Loading label="찾는 중" />
          ) : (
            found.length > 0 && (
              <ul className="mt-3 flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {found.map((p) => {
                  const already = picked.some((d) => d.place.id === p.id)
                  return (
                    <li key={p.id} className="card flex items-center gap-2 p-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold text-ink-800">{p.name}</p>
                        <p className="truncate text-[12px] text-ink-500">
                          {CATEGORY_ICON[p.category]} {CATEGORY_LABEL[p.category]} · {p.address}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => add(p)}
                        disabled={already}
                        className="btn-ghost shrink-0 !px-3 !py-1.5 text-[12.5px]"
                      >
                        {already ? '담김' : '담기'}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          )}
        </section>

        <section className="mb-6">
          <p className="label">동선 {picked.length}곳</p>
          {picked.length === 0 ? (
            <p className="hint">위에서 장소를 찾아 담아 주세요.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {picked.map((d, i) => (
                <li key={d.place.id} className="card p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[12px] font-bold text-brand-700">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-bold text-ink-800">{d.place.name}</p>
                      <p className="truncate text-[12px] text-ink-500">
                        {CATEGORY_ICON[d.place.category]} {CATEGORY_LABEL[d.place.category]}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label="위로"
                        className="btn-outline !px-2.5 !py-1"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === picked.length - 1}
                        aria-label="아래로"
                        className="btn-outline !px-2.5 !py-1"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPicked((prev) => prev.filter((x) => x.place.id !== d.place.id))
                        }
                        aria-label="빼기"
                        className="btn-ghost !px-2.5 !py-1 text-ink-500"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-[auto_1fr] gap-2">
                    <input
                      type="time"
                      value={d.planned_time}
                      onChange={(e) => patch(i, 'planned_time', e.target.value)}
                      className="field !py-2 text-[13px]"
                      aria-label={`${d.place.name} 시각`}
                    />
                    <input
                      value={d.tip}
                      onChange={(e) => patch(i, 'tip', e.target.value)}
                      maxLength={120}
                      placeholder="한 줄 팁 (선택)"
                      className="field !py-2 text-[13px]"
                      aria-label={`${d.place.name} 팁`}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <button type="button" onClick={save} disabled={busy} className="btn-primary w-full">
          {busy ? '저장 중…' : '공개하기'}
        </button>
        {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
      </div>
    </>
  )
}
