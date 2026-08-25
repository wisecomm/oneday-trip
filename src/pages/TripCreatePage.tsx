import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { trips } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import { COMPANION_LABEL, type Companion, type TripDraft } from '@/lib/types'
import { Loading, PageHeader, StepGuide } from '@/components/ui'

/** 하위 지역(구/시) 선택 대신 상위 지역 전체를 목적지로 삼을 때 쓰는 표식값 — 실제 지역명이 아니다 */
const ALL_LEAF = '전체'

function todayIso(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

/** 날짜를 '8월 24일 (월)' 형태로 표기 */
export function formatTripDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${weekday})`
}

/** 날짜를 'MM-DD' 형태로 표기 — 제목 끝에 붙는 짧은 표기 */
function formatMonthDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 목적지·날짜로부터 만드는 기본 제목.
 * 구/시를 '전체'로 골랐을 때는 특정 구 이름이 없으므로 상위 지역명만 쓴다.
 */
export function defaultTripTitle(destination: string, group: string, tripDate: string): string {
  const place = destination === ALL_LEAF ? group : destination
  return `${place} 당일치기 ${formatMonthDay(tripDate)}`
}

/** 기존 제목과 겹치면 '-01', '-02'… 순번을 붙여 구분한다 */
function dedupeTitle(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let n = 1
  while (existing.includes(`${base}-${String(n).padStart(2, '0')}`)) n += 1
  return `${base}-${String(n).padStart(2, '0')}`
}

/**
 * TRIP-02-01 · 02. 여행 일정 계획 > 2.1 일정 생성 > 여행 일정 설정
 * 하루 단위 당일치기 서비스이므로 기간이 아닌 날짜 하나를 고른다.
 *
 * 이 단계에서는 저장하지 않는다. 규칙(TRIP-02-02)까지 정한 뒤에 한 번에
 * 저장하므로, 중간에 이탈해도 빈 여행이 남지 않는다.
 */
export function TripCreatePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { groups, regions, loading: regionsLoading } = useRegions()

  const [group, setGroup] = useState<string>('')
  const [destination, setDestination] = useState<string>('')
  const [title, setTitle] = useState('')
  // 사용자가 제목을 직접 손댔다면 목적지를 바꿔도 덮어쓰지 않는다
  const [titleEdited, setTitleEdited] = useState(false)
  const [tripDate, setTripDate] = useState(todayIso(7))
  const [companions, setCompanions] = useState<Companion[]>(['friends'])
  const [existingTitles, setExistingTitles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const leafOptions = regions.filter((r) => r.group_name === group)

  // 제목 중복 확인용 — 내 기존 여행 제목 목록을 미리 받아 둔다
  useEffect(() => {
    if (!user) return
    void trips.list(user.id).then((rows) => setExistingTitles(rows.map((t) => t.title)))
  }, [user])

  // 지역 목록이 비동기로 도착하면 첫 상위 지역 + '전체'를 기본 선택으로 채운다
  useEffect(() => {
    if (groups.length === 0 || group) return
    setGroup(groups[0].name)
    setDestination(ALL_LEAF)
  }, [groups, group])

  // 목적지·날짜가 바뀔 때마다 자동 제목을 다시 계산한다 (직접 수정한 경우는 건드리지 않는다)
  useEffect(() => {
    if (titleEdited || !destination || !group) return
    const base = defaultTripTitle(destination, group, tripDate)
    setTitle(dedupeTitle(base, existingTitles))
  }, [destination, group, tripDate, existingTitles, titleEdited])

  function changeGroup(next: string) {
    setGroup(next)
    // 상위 지역을 바꾸면 특정 구 이름이 그대로 남아 혼란스러우니 '전체'로 되돌린다
    setDestination(ALL_LEAF)
  }

  function changeTitle(next: string) {
    setTitle(next)
    // 비우면 다시 자동 생성 모드로 돌아간다
    setTitleEdited(next.trim().length > 0)
  }

  function toggleCompanion(c: Companion) {
    setCompanions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function goToRules() {
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      setError('여행 제목을 입력해 주세요.')
      return
    }
    setError(null)
    // '전체' 는 실제 지역명이 아니므로, 저장은 상위 지역명(region_groups.name)으로 한다
    const effectiveDestination = destination === ALL_LEAF ? group : destination
    const draft: TripDraft = {
      title: trimmed,
      destination: effectiveDestination,
      trip_date: tripDate,
      companions,
    }
    navigate('/trips/new/rules', { state: draft })
  }

  if (regionsLoading) return <Loading />

  return (
    <>
      <PageHeader title="여행 일정 설정" subtitle="여행 날짜와 목적지를 정해 주세요" back />

      <div className="px-5 py-5">
        <div className="mb-6">
          <StepGuide steps={['사용자 등록', '여행 일정', '여행 규칙']} current={1} />
        </div>

        <section className="mb-7">
          <p className="label">목적지</p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={group}
              onChange={(e) => changeGroup(e.target.value)}
              className="field"
              aria-label="시/도 선택"
            >
              {groups.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="field"
              aria-label="구/시 선택"
            >
              <option value={ALL_LEAF}>전체</option>
              {leafOptions.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name.slice(group.length + 1)}
                </option>
              ))}
            </select>
          </div>
          <p className="hint mt-1.5">선택한 지역 기준으로 추천 검색 인덱스가 활성화됩니다.</p>
        </section>

        <section className="mb-7">
          <label className="label" htmlFor="trip-title">
            여행 제목
          </label>
          <input
            id="trip-title"
            value={title}
            onChange={(e) => changeTitle(e.target.value)}
            maxLength={30}
            placeholder={group ? defaultTripTitle(destination, group, tripDate) : ''}
            className="field"
          />
          <p className="hint mt-1.5">
            {titleEdited
              ? '직접 입력한 제목이 사용됩니다.'
              : '목적지·날짜에 맞춰 자동으로 채워집니다. 원하는 이름으로 바꿔도 됩니다.'}
          </p>
        </section>

        <section className="mb-7">
          <label className="label" htmlFor="trip-date">
            여행 날짜
          </label>
          <input
            id="trip-date"
            type="date"
            value={tripDate}
            onChange={(e) => setTripDate(e.target.value)}
            className="field"
          />
          <p className="mt-2 text-[13px] font-semibold text-brand-600">
            {formatTripDate(tripDate)} 당일치기
          </p>
        </section>

        <section className="mb-8">
          <p className="label">동행인 유형</p>
          <div className="flex flex-wrap gap-2">
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
        </section>

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
        )}

        <button
          type="button"
          onClick={goToRules}
          disabled={!destination}
          className="btn-primary w-full"
        >
          다음 · 여행 규칙 설정
        </button>
      </div>
    </>
  )
}
