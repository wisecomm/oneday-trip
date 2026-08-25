import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, reservations } from '@/lib/db'
import { CATEGORY_LABEL, type Place } from '@/lib/types'
import { BottomSheet, EmptyState, Loading, PageHeader, Stepper } from '@/components/ui'
import { CategoryDot } from '@/components/PlaceCard'

/** 예약금 — 인원 1명당 1만원 */
const DEPOSIT_PER_PERSON = 10_000

function nextHourIso(): string {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 2)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/**
 * RSV-05-01 · 05. 예약 및 실시간 대기 > 5.1 실시간 예약 > 레스토랑 상세 및 예약
 * 예약 확정 시 타임라인(3.1) 해당 날짜/시간대에 예약 카드가 바인딩되고,
 * 카카오톡 공유 버튼으로 동행에게 예약 내용을 전달한다.
 */
export function PlaceDetailPage() {
  const { placeId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [place, setPlace] = useState<Place | null>(null)
  const [loading, setLoading] = useState(true)

  const [sheet, setSheet] = useState<'none' | 'reserve'>('none')
  const [when, setWhen] = useState(nextHourIso())
  const [party, setParty] = useState(2)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState<{ when: string; party: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // 사진 URL이 죽어 있는 경우(TourAPI CDN 만료 등) 그라디언트 플레이스홀더로 되돌아간다
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setImageFailed(false)
    void placesApi.get(placeId).then((p) => {
      if (!alive) return
      setPlace(p)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [placeId])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  if (loading) return <Loading />
  if (!place) return <EmptyState title="장소를 찾을 수 없습니다" />

  const deposit = party * DEPOSIT_PER_PERSON

  async function reserve() {
    if (!user || !place) {
      navigate('/login')
      return
    }
    setBusy(true)
    try {
      await reservations.create({
        user_id: user.id,
        place_id: place.id,
        reserved_at: new Date(when).toISOString(),
        party_size: party,
        deposit,
      })
      setSheet('none')
      setConfirmed({ when, party })
    } finally {
      setBusy(false)
    }
  }

  /** 예약 내용을 카카오톡 템플릿 카드로 동행에게 공유 */
  async function shareToKakao() {
    if (!place || !confirmed) return
    const text = `[하루트립 예약 확정]\n${place.name}\n${new Date(confirmed.when).toLocaleString('ko-KR')} · ${confirmed.party}명\n${place.address}`
    try {
      if (navigator.share) {
        await navigator.share({ title: '하루트립 예약 확정', text })
      } else {
        await navigator.clipboard.writeText(text)
        setToast('예약 내용을 클립보드에 복사했습니다.')
      }
    } catch {
      /* 사용자가 공유를 취소한 경우 — 무시 */
    }
  }

  return (
    <>
      <PageHeader title={place.name} subtitle={CATEGORY_LABEL[place.category]} back />

      {/* 대표 이미지 영역 — 실제 사진이 있으면 그걸 쓰고, 없거나 로드 실패 시 그라디언트로 대체한다 */}
      {place.image_url && !imageFailed ? (
        <div className="relative h-44">
          <img
            src={place.image_url}
            alt={place.name}
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink-900/70 to-transparent px-4 pt-8 pb-3">
            <span className="text-[13px] font-bold tracking-wide text-white">
              {CATEGORY_LABEL[place.category]} · {place.region}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="flex h-44 items-center justify-center text-white"
          style={{
            background: `linear-gradient(135deg, var(--color-${place.category}), color-mix(in srgb, var(--color-${place.category}) 65%, #14171c))`,
          }}
        >
          <span className="text-[13px] font-bold tracking-wide opacity-90">
            {CATEGORY_LABEL[place.category]} · {place.region}
          </span>
        </div>
      )}

      <div className="px-4 py-4">
        <div className="mb-4">
          <div className="flex items-center gap-1.5">
            <CategoryDot category={place.category} />
            <h2 className="text-[20px] font-extrabold text-ink-800">{place.name}</h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-500">{place.address}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-600">
            <span className="font-bold">★ {place.rating.toFixed(1)}</span>
            <span className="text-ink-300">|</span>
            <span>{'₩'.repeat(place.price_level)}</span>
            <span className="text-ink-300">|</span>
            <span>{place.open_hours}</span>
          </div>
        </div>

        <p className="mb-4 text-[14px] leading-relaxed text-ink-700">{place.summary}</p>

        {place.tags.length > 0 && (
          <div className="mb-5 flex flex-wrap gap-1.5">
            {place.tags.map((t) => (
              <span key={t} className="chip-off !cursor-default">
                #{t}
              </span>
            ))}
          </div>
        )}

        {place.phone && (
          <a href={`tel:${place.phone}`} className="card mb-4 flex items-center justify-between p-4">
            <div>
              <p className="text-[12.5px] font-semibold text-ink-500">전화 문의</p>
              <p className="mt-0.5 text-[18px] font-extrabold text-ink-800">{place.phone}</p>
            </div>
            <span className="btn-outline !px-3.5 !py-2.5 text-[13.5px]">📞 전화 걸기</span>
          </a>
        )}

        {confirmed ? (
          <div className="card border border-brand-200 p-4">
            <p className="text-[13px] font-bold text-brand-700">예약이 확정되었습니다</p>
            <p className="mt-1 text-[14px] font-bold text-ink-800">
              {new Date(confirmed.when).toLocaleString('ko-KR')} · {confirmed.party}명
            </p>
            <p className="hint mt-1">
              마이 트립 타임라인의 해당 날짜에 예약 카드가 자동으로 표시됩니다.
            </p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={shareToKakao} className="btn-ghost flex-1">
                동행에게 공유하기
              </button>
              <button
                type="button"
                onClick={() => navigate('/trips')}
                className="btn-primary flex-1"
              >
                타임라인 보기
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setSheet('reserve')} className="btn-primary w-full">
            실시간 예약하기
          </button>
        )}
      </div>

      {/* 예약 시트 */}
      <BottomSheet open={sheet === 'reserve'} onClose={() => setSheet('none')} title="예약 정보 입력">
        <div className="flex flex-col gap-5">
          <div>
            <label className="label" htmlFor="when">
              예약 일시
            </label>
            <input
              id="when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <p className="label">방문 인원수</p>
            <Stepper value={party} onChange={setParty} min={1} max={12} />
          </div>

          <div className="rounded-xl bg-ink-100 p-4">
            <div className="flex items-center justify-between text-[14px]">
              <span className="font-semibold text-ink-600">예약금</span>
              <span className="font-extrabold text-ink-800">{deposit.toLocaleString()}원</span>
            </div>
            <p className="hint mt-1.5">
              1인 {DEPOSIT_PER_PERSON.toLocaleString()}원 · 방문 시 전액 차감됩니다.
            </p>
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-700">
              데모 빌드에서는 실제 결제가 일어나지 않습니다. 운영 배포 시 PG사 결제 모듈(토스페이먼츠 ·
              카카오페이 등)을 이 위치에 연동하세요.
            </p>
          </div>

          <button type="button" onClick={reserve} disabled={busy} className="btn-primary w-full">
            예약 확정하기
          </button>
        </div>
      </BottomSheet>

      {toast && (
        <div className="fixed inset-x-0 bottom-28 z-40 flex justify-center px-6">
          <p className="rounded-xl bg-ink-800 px-4 py-2.5 text-[13px] font-semibold text-white shadow-lg">
            {toast}
          </p>
        </div>
      )}
    </>
  )
}
