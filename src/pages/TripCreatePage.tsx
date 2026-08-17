import { useMemo, useState } from 'react'
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

export function dayCount(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.max(1, Math.round(ms / 86_400_000) + 1)
}

/**
 * TRIP-02-01 · 02. 여행 일정 계획 > 2.1 일정 생성 > 여행 일정 설정
 * 일자가 확정되어야 마이 트립 타임라인 일자 탭이 동적으로 생성된다.
 */
export function TripCreatePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [destination, setDestination] = useState<string>(DESTINATIONS[0])
  const [startDate, setStartDate] = useState(todayIso(7))
  const [endDate, setEndDate] = useState(todayIso(9))
  const [companions, setCompanions] = useState<Companion[]>(['friends'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = useMemo(() => dayCount(startDate, endDate), [startDate, endDate])
  const invalidRange = new Date(endDate) < new Date(startDate)

  function toggleCompanion(c: Companion) {
    setCompanions((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  async function create() {
    if (!user) return
    if (invalidRange) {
      setError('종료일은 시작일보다 빠를 수 없습니다.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const trip = await trips.create({
        user_id: user.id,
        title: `${destination} ${days - 1 > 0 ? `${days - 1}박 ${days}일` : '당일치기'}`,
        destination,
        start_date: startDate,
        end_date: endDate,
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
      <PageHeader title="여행 일정 설정" subtitle="여행 기간과 목적지를 정해 주세요" back />

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
          <p className="label">여행 기간</p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="field"
              aria-label="시작일"
            />
            <span className="text-ink-400">–</span>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="field"
              aria-label="종료일"
            />
          </div>
          <p className="mt-2 text-[13px] font-semibold text-brand-600">
            {invalidRange ? '기간을 다시 선택해 주세요' : `총 ${days}일 일정 · Day 1 ~ Day ${days}`}
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
          disabled={busy || invalidRange}
          className="btn-primary w-full"
        >
          다음 · 여행 규칙 설정
        </button>
      </div>
    </>
  )
}
