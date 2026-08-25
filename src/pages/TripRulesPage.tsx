import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { places as placesApi, tripItems, trips } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import { optimizeOrder } from '@/lib/geo'
import { fetchWeather, recommend, type TripContext } from '@/lib/recommend'
import { SEED_PLACES } from '@/lib/seed'
import {
  TRANSPORT_LABEL,
  TRANSPORT_SPEED_KMH,
  type Profile,
  type Region,
  type RegionGroup,
  type Transport,
  type Trip,
  type TripDraft,
} from '@/lib/types'
import { Loading, PageHeader, StepGuide } from '@/components/ui'

/** 여행 생성 직후 자동으로 담아 줄 추천 장소 개수 */
const AUTO_ADD_COUNT = 3

/**
 * 여행 생성 직후 타임라인이 비어 있으면 사용자가 무엇부터 해야 할지 막막해진다.
 * 그래서 AI 추천(MAP-04-02)과 같은 기준으로 상위 장소를 골라 자동으로 담아 준다.
 *
 * · 순서는 추천 순위가 아니라 최단 동선(TRIP-03-02)으로 정렬해, 첫 화면부터
 *   말이 되는 일정이 보이게 한다.
 *
 * @returns 실제로 담은 장소 수
 */
async function seedRecommendedPlaces(
  tripId: string,
  destination: string,
  count: number,
  profile: Profile | null,
  groups: RegionGroup[],
  regions: Region[],
): Promise<number> {
  // destination 은 leaf 지역(regions.name)일 수도, '전체'로 골라 상위 지역
  // 전체(region_groups.name)를 가리킬 수도 있다 — 후자면 그 아래 leaf 를 다 모은다
  const asGroup = groups.find((g) => g.name === destination)
  const filter = asGroup
    ? { regions: regions.filter((r) => r.group_name === destination).map((r) => r.name) }
    : { region: destination }

  const anchor = asGroup ?? SEED_PLACES.find((p) => p.region === destination) ?? SEED_PLACES[0]
  const [list, weather] = await Promise.all([
    placesApi.list(filter),
    fetchWeather(anchor.lat, anchor.lng),
  ])
  if (list.length === 0) return 0

  const now = new Date()
  const ctx: TripContext = { hour: now.getHours(), weekday: now.getDay(), ...weather }

  const picked = recommend(list, ctx, profile, count).map((s) => s.place)
  const order = optimizeOrder(picked.map((p) => ({ lat: p.lat, lng: p.lng })))

  // add() 가 기존 개수로 sort_order 를 계산하므로 순차로 넣어야 순서가 보존된다
  for (const index of order) {
    await tripItems.add({ trip_id: tripId, place_id: picked[index].id })
  }
  return picked.length
}

/**
 * TRIP-02-02 · 02. 여행 일정 계획 > 2.2 여행 규칙 설정 > 주 이동수단 지정
 *
 * 두 가지 모드로 동작한다.
 *  · 생성 모드 (/trips/new/rules): 1단계에서 받은 초안에 규칙을 얹어 여기서 처음 저장한다.
 *  · 수정 모드 (/trips/:tripId/rules): 이미 저장된 여행의 규칙만 갱신한다.
 */
export function TripRulesPage() {
  const { tripId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()
  const { groups, regions } = useRegions()

  const isCreate = !tripId
  const draft = (location.state ?? null) as TripDraft | null

  const [trip, setTrip] = useState<Trip | null>(null)
  const [transport, setTransport] = useState<Transport>('transit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isCreate || !tripId) return
    let alive = true
    void trips.get(tripId).then((t) => {
      if (!alive || !t) return
      setTrip(t)
      setTransport(t.transport)
    })
    return () => {
      alive = false
    }
  }, [tripId, isCreate])

  // 초안 없이 생성 단계로 직접 들어온 경우 (새로고침·북마크) 1단계로 되돌린다
  if (isCreate && !draft) return <Navigate to="/trips/new" replace />
  if (!isCreate && !trip) return <Loading />

  const headerSubtitle = isCreate ? draft!.title : trip!.title

  async function save() {
    setBusy(true)
    setError(null)
    try {
      if (isCreate) {
        if (!user) return
        const created = await trips.create({
          user_id: user.id,
          ...draft!,
          transport,
        })

        // 추천 장소 담기는 부가 기능이다. 여기서 실패해도 여행 자체는 이미
        // 만들어졌으므로, 오류로 흐름을 끊지 않고 빈 타임라인으로 보낸다.
        let added = 0
        try {
          added = await seedRecommendedPlaces(
            created.id,
            created.destination,
            AUTO_ADD_COUNT,
            profile,
            groups,
            regions,
          )
        } catch (err) {
          console.error('[TripRules] 추천 장소 자동 담기에 실패했습니다.', err)
        }

        navigate(`/trips/${created.id}`, { replace: true, state: { autoAdded: added } })
      } else {
        await trips.update(tripId!, { transport })
        navigate(`/trips/${tripId}`, { replace: true })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="여행 규칙 설정" subtitle={headerSubtitle} back />

      <div className="px-5 py-5">
        <div className="mb-6">
          <StepGuide steps={['여행 일정', '여행 규칙']} current={1} />
        </div>

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

        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
        )}

        <button type="button" onClick={save} disabled={busy} className="btn-primary w-full">
          {busy
            ? isCreate
              ? '추천 장소를 담는 중…'
              : '저장 중…'
            : isCreate
              ? '여행 저장하고 타임라인 보기'
              : '규칙 저장하고 타임라인 보기'}
        </button>
      </div>
    </>
  )
}
