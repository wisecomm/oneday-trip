import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { trips } from '@/lib/db'
import { TRANSPORT_LABEL, TRANSPORT_SPEED_KMH, type Transport, type Trip } from '@/lib/types'
import { Loading, PageHeader, StepGuide } from '@/components/ui'

/**
 * TRIP-02-02 · 02. 여행 일정 계획 > 2.2 여행 규칙 설정 > 방문 제약 조건 지정
 * 무리한 일정으로 여행 품질이 떨어지는 것을 막는 UX 제약 장치.
 */
export function TripRulesPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const [trip, setTrip] = useState<Trip | null>(null)
  const [maxPlaces, setMaxPlaces] = useState(3)
  const [transport, setTransport] = useState<Transport>('transit')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void trips.get(tripId).then((t) => {
      if (!alive || !t) return
      setTrip(t)
      setMaxPlaces(t.max_places_per_day)
      setTransport(t.transport)
    })
    return () => {
      alive = false
    }
  }, [tripId])

  if (!trip) return <Loading />

  async function save() {
    setBusy(true)
    try {
      await trips.update(tripId, { max_places_per_day: maxPlaces, transport })
      navigate(`/trips/${tripId}`, { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="여행 규칙 설정" subtitle={trip.title} back />

      <div className="px-5 py-5">
        <div className="mb-6">
          <StepGuide steps={['사용자 등록', '여행 일정', '여행 규칙']} current={2} />
        </div>

        <section className="mb-8">
          <p className="label">하루에 다닐 수 있는 최대 방문 리스트</p>
          <div className="card p-5">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-[28px] font-extrabold text-brand-600">{maxPlaces}곳</span>
              <span className="text-[12.5px] font-semibold text-ink-400">
                {maxPlaces <= 2 ? '여유로운 일정' : maxPlaces === 3 ? '권장 (기본값)' : '빡빡한 일정'}
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={maxPlaces}
              onChange={(e) => setMaxPlaces(Number(e.target.value))}
              className="w-full accent-brand-500"
              aria-label="하루 최대 방문 장소 개수"
            />
            <div className="mt-1 flex justify-between text-[11.5px] text-ink-400">
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} className={n === maxPlaces ? 'font-bold text-brand-600' : ''}>
                  {n}
                </span>
              ))}
            </div>
          </div>
          <p className="hint mt-2">
            동선 피로도를 스스로 제약하는 장치입니다. 한도를 넘으면 타임라인에 장소를 추가할 수 없습니다.
          </p>
        </section>

        <section className="mb-8">
          <p className="label">주 이동수단</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TRANSPORT_LABEL) as Transport[]).map((t) => {
              const active = transport === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTransport(t)}
                  aria-pressed={active}
                  className={`card flex flex-col items-center gap-1 py-4 transition-colors ${
                    active ? 'ring-2 ring-brand-500' : ''
                  }`}
                >
                  <span className="text-2xl" aria-hidden>
                    {t === 'walk' ? '🚶' : t === 'transit' ? '🚌' : '🚗'}
                  </span>
                  <span
                    className={`text-[13px] font-bold ${active ? 'text-brand-600' : 'text-ink-600'}`}
                  >
                    {TRANSPORT_LABEL[t]}
                  </span>
                  <span className="text-[11px] text-ink-400">
                    평균 {TRANSPORT_SPEED_KMH[t]}km/h
                  </span>
                </button>
              )
            })}
          </div>
          <p className="hint mt-2">
            선택한 이동수단의 평균 속도로 장소 간 이동 소요 시간이 계산되어 동선에 반영됩니다.
          </p>
        </section>

        <button type="button" onClick={save} disabled={busy} className="btn-primary w-full">
          규칙 저장하고 타임라인 보기
        </button>
      </div>
    </>
  )
}
