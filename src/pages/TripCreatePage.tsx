import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { trips } from '@/lib/db'
import { DESTINATIONS } from '@/lib/seed'
import { COMPANION_LABEL, type Companion } from '@/lib/types'
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

/**
 * TRIP-02-01 · 02. 여행 일정 계획 > 2.1 일정 생성 > 여행 일정 설정
 * 하루 단위 당일치기 서비스이므로 기간이 아닌 날짜 하나를 고른다.
 */
export function TripCreatePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [destination, setDestination] = useState<string>(DESTINATIONS[0])
  const [tripDate, setTripDate] = useState(todayIso(7))
  const [companions, setCompanions] = useState<Companion[]>(['friends'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleCompanion(c: Companion) {
    setCompanions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function create() {
    if (!user) return
    setBusy(true)
    setError(null)
    try {
      const trip = await trips.create({
        user_id: user.id,
        title: `${destination} 당일치기`,
        destination,
        trip_date: tripDate,
        companions,
        max_places_per_day: 3, // 기본값 3개 제안 (TRIP-02-02 기획 가이드)
        transport: 'transit',
      })
      navigate(`/trips/${trip.id}/rules`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '일정 생성에 실패했습니다.')
    } finally {
      setBusy(false)
    }
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
            onChange={(e) => setDestination(e.target.value)}
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
          onClick={create}
          disabled={busy}
          className="btn-primary w-full"
        >
          다음 · 여행 규칙 설정
        </button>
      </div>
    </>
  )
}
