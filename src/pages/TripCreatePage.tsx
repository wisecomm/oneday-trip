import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { trips } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import { COMPANION_LABEL, type Companion } from '@/lib/types'
import { formatTripDate } from '@/lib/trip-date'
import {
  DEFAULT_COMPANIONS,
  TITLE_MAX,
  autoTripTitle,
  buildDraft,
  checkStepOne,
  defaultTripDate,
  defaultTripTitle,
  isTitleEdited,
} from '@/rules/trip-create'
import { Loading, PageHeader, StepGuide } from '@/components/ui'

/** 하위 지역(구/시) 선택 대신 상위 지역 전체를 목적지로 삼을 때 쓰는 표식값 — 실제 지역명이 아니다 */
/** 시군구 드롭다운에서 '전체'를 뜻하는 값. 저장할 때는 null 이 된다 */
const ALL_LEAF = ''

/**
 * TRIP-02-01 · 02. 여행 일정 계획 > 2.1 일정 생성 > 여행 일정 설정
 * 하루 단위 당일치기 서비스이므로 기간이 아닌 날짜 하나를 고른다.
 *
 * 이 단계에서는 저장하지 않는다. 규칙(TRIP-02-02)까지 정한 뒤에 한 번에
 * 저장하므로, 중간에 이탈해도 빈 여행이 남지 않는다.
 *
 * 기본값 · 자동 제목 · 검사 · 초안 규칙은 src/rules/trip-create.ts([TC-…]) — 이 화면은 상태와 마크업만.
 */
export function TripCreatePage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { groups, regions, loading: regionsLoading } = useRegions()

  // 지역은 이름이 아니라 코드로 들고 다닌다. sigungu 가 null 이면 '전체'다.
  const [areaCode, setAreaCode] = useState<number | null>(null)
  const [sigunguCode, setSigunguCode] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  // 사용자가 제목을 직접 손댔다면 목적지를 바꿔도 덮어쓰지 않는다
  const [titleEdited, setTitleEdited] = useState(false)
  const [tripDate, setTripDate] = useState(() => defaultTripDate())
  const [companions, setCompanions] = useState<Companion[]>(() => [...DEFAULT_COMPANIONS])
  const [existingTitles, setExistingTitles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const leafOptions = regions.filter((r) => r.tour_area_code === areaCode)
  const groupName = groups.find((g) => g.tour_area_code === areaCode)?.name ?? ''
  const regionName = leafOptions.find((r) => r.tour_sigungu_code === sigunguCode)?.name ?? null

  // 제목 중복 확인용 — 내 기존 여행 제목 목록을 미리 받아 둔다
  useEffect(() => {
    if (!user) return
    void trips.list(user.id).then((rows) => setExistingTitles(rows.map((t) => t.title)))
  }, [user])

  // 지역 목록이 비동기로 도착하면 첫 상위 지역 + '전체'를 기본 선택으로 채운다
  useEffect(() => {
    if (groups.length === 0 || areaCode !== null) return
    setAreaCode(groups[0].tour_area_code)
    setSigunguCode(null)
  }, [groups, areaCode])

  // 목적지·날짜가 바뀔 때마다 자동 제목을 다시 계산한다 (직접 수정한 경우는 건드리지 않는다)
  useEffect(() => {
    if (titleEdited || !groupName) return
    setTitle(autoTripTitle(groupName, regionName, tripDate, existingTitles))
  }, [groupName, regionName, tripDate, existingTitles, titleEdited])

  function changeGroup(next: number) {
    setAreaCode(next)
    // 상위 지역을 바꾸면 특정 구가 그대로 남아 혼란스러우니 '전체'로 되돌린다
    setSigunguCode(null)
  }

  function changeTitle(next: string) {
    setTitle(next)
    // 비우면 다시 자동 생성 모드로 돌아간다
    setTitleEdited(isTitleEdited(next))
  }

  function toggleCompanion(c: Companion) {
    setCompanions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  function goToRules() {
    const problem = checkStepOne({ title, areaCode })
    if (problem !== null || areaCode === null) {
      setError(problem)
      return
    }
    setError(null)
    const draft = buildDraft({ title, areaCode, sigunguCode, tripDate, companions })
    navigate('/trips/new/rules', { state: draft })
  }

  if (regionsLoading) return <Loading />

  return (
    <>
      <PageHeader title="여행 일정 설정" subtitle="여행 날짜와 목적지를 정해 주세요" back />

      <div className="px-5 py-5">
        <div className="mb-6">
          <StepGuide steps={['여행 일정', '여행 규칙']} current={0} />
        </div>

        <section className="mb-7">
          <p className="label">목적지</p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={areaCode ?? ''}
              onChange={(e) => changeGroup(Number(e.target.value))}
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
            maxLength={TITLE_MAX}
            placeholder={groupName ? defaultTripTitle(groupName, regionName, tripDate) : ''}
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
          disabled={areaCode === null}
          className="btn-primary w-full"
        >
          다음 · 여행 규칙 설정
        </button>
      </div>
    </>
  )
}
