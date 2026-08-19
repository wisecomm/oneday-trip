import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { DESTINATIONS } from '@/lib/seed'
import { COMPANION_LABEL, type Companion, type TripDraft } from '@/lib/types'
import { PageHeader, StepGuide } from '@/components/ui'

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

/** 목적지로부터 만드는 기본 제목 */
export function defaultTripTitle(destination: string): string {
  return `${destination} 당일치기`
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

  const [destination, setDestination] = useState<string>(DESTINATIONS[0])
  const [title, setTitle] = useState(() => defaultTripTitle(DESTINATIONS[0]))
  // 사용자가 제목을 직접 손댔다면 목적지를 바꿔도 덮어쓰지 않는다
  const [titleEdited, setTitleEdited] = useState(false)
  const [tripDate, setTripDate] = useState(todayIso(7))
  const [companions, setCompanions] = useState<Companion[]>(['friends'])
  const [error, setError] = useState<string | null>(null)

  function changeDestination(next: string) {
    setDestination(next)
    if (!titleEdited) setTitle(defaultTripTitle(next))
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
    const draft: TripDraft = { title: trimmed, destination, trip_date: tripDate, companions }
    navigate('/trips/new/rules', { state: draft })
  }

  return (
    <>
      <PageHeader title="여행 일정 설정" subtitle="여행 날짜와 목적지를 정해 주세요" back />

      <div className="px-5 py-5">
        <div className="mb-6">
          <StepGuide steps={['사용자 등록', '여행 일정', '여행 규칙']} current={1} />
        </div>

        <section className="mb-7">
          <label className="label" htmlFor="destination">
            목적지 도시
          </label>
          <select
            id="destination"
            value={destination}
            onChange={(e) => changeDestination(e.target.value)}
            className="field"
          >
            {DESTINATIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <p className="hint mt-1.5">
            선택한 지역 기준으로 추천 검색 인덱스가 활성화됩니다.
          </p>
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
            placeholder={defaultTripTitle(destination)}
            className="field"
          />
          <p className="hint mt-1.5">
            {titleEdited
              ? '직접 입력한 제목이 사용됩니다.'
              : '목적지에 맞춰 자동으로 채워집니다. 원하는 이름으로 바꿔도 됩니다.'}
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

        <button type="button" onClick={goToRules} className="btn-primary w-full">
          다음 · 여행 규칙 설정
        </button>
      </div>
    </>
  )
}
