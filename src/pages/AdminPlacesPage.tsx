import { useCallback, useEffect, useMemo, useState } from 'react'
import { adminPlaces } from '@/lib/db'
import { useRegions } from '@/hooks/useRegions'
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  regionLabel,
  type Place,
  type PlaceCategory,
} from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'

/**
 * PLACE-07-01 장소 등록 관리.
 *
 * 카탈로그에 없는 가게를 넣는 **유일한 길**이다. 사용자 요청 경로는 만들지
 * 않기로 했고(Q21), 검수 대기 섹션도 그때 함께 걷어냈다. 관리자가 넣으면
 * 바로 `places` 에 들어간다.
 */
export function AdminPlacesPage() {
  const { groups, regions, loading: regionsLoading } = useRegions()

  const [manual, setManual] = useState<Place[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 직접 등록 폼
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<PlaceCategory>('babzip')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [areaCode, setAreaCode] = useState<number | null>(null)
  const [sigunguCode, setSigunguCode] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setManual(await adminPlaces.listManual())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (groups.length === 0 || areaCode !== null) return
    setAreaCode(groups[0].tour_area_code)
  }, [groups, areaCode])

  const leafOptions = useMemo(
    () => regions.filter((r) => r.tour_area_code === areaCode),
    [regions, areaCode],
  )

  async function create() {
    const latNum = Number(lat)
    const lngNum = Number(lng)
    if (name.trim().length < 1) return setError('이름을 입력해 주세요.')
    if (address.trim().length < 2) return setError('주소를 입력해 주세요.')
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum))
      return setError('좌표를 숫자로 입력해 주세요.')
    // 사람이 고른 지역에 미판정(-1)이 나타날 수는 없다
    if (areaCode === null || sigunguCode === null) return setError('지역을 골라 주세요.')

    setBusy('new')
    setError(null)
    try {
      await adminPlaces.create({
        name: name.trim(),
        category,
        address: address.trim(),
        lat: latNum,
        lng: lngNum,
        image_url: imageUrl.trim() || null,
        tour_area_code: areaCode,
        tour_sigungu_code: sigunguCode,
      })
      setName('')
      setAddress('')
      setLat('')
      setLng('')
      setImageUrl('')
      setOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '등록에 실패했습니다.')
    } finally {
      setBusy(null)
    }
  }

  if (loading || regionsLoading) return <Loading />

  return (
    <>
      <PageHeader
        title="장소 등록 관리"
        subtitle={`수동 등록 ${manual.length}곳`}
        back
        right={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="btn-primary !px-3 !py-1.5 text-[13px]"
          >
            {open ? '닫기' : '+ 직접 등록'}
          </button>
        }
      />

      <div className="px-4 py-4">
        {error && <p className="mb-3 text-[13px] text-red-600">{error}</p>}

        {open && (
          <section className="card mb-5 p-4">
            <h2 className="section-title mb-3">직접 등록</h2>
            <p className="hint mb-3">
              관리자가 넣은 장소는 승인 단계 없이 바로 카탈로그에 들어갑니다.
            </p>

            <label className="label" htmlFor="ap-name">
              이름
            </label>
            <input
              id="ap-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="field mb-3"
            />

            <p className="label">카테고리</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
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

            <label className="label" htmlFor="ap-address">
              주소
            </label>
            <input
              id="ap-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={200}
              className="field mb-3"
            />

            <p className="label">지역</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
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
                value={sigunguCode ?? ''}
                onChange={(e) => setSigunguCode(Number(e.target.value))}
                className="field"
                aria-label="시군구 선택"
              >
                <option value="">고르기</option>
                {leafOptions.map((r) => (
                  <option key={r.tour_sigungu_code} value={r.tour_sigungu_code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <p className="label">좌표</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <input
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                inputMode="decimal"
                placeholder="위도 37.5665"
                className="field"
                aria-label="위도"
              />
              <input
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                inputMode="decimal"
                placeholder="경도 126.9780"
                className="field"
                aria-label="경도"
              />
            </div>

            <label className="label" htmlFor="ap-image">
              사진 URL (선택)
            </label>
            <input
              id="ap-image"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://"
              className="field mb-4"
            />

            <button
              type="button"
              onClick={create}
              disabled={busy === 'new'}
              className="btn-primary w-full"
            >
              {busy === 'new' ? '등록 중…' : '바로 등록'}
            </button>
          </section>
        )}

        <section>
          <h2 className="section-title mb-2">
            수동 등록된 장소 <span className="text-ink-400">{manual.length}</span>
          </h2>
          {manual.length === 0 ? (
            <EmptyState
              icon="📍"
              title="아직 수동 등록된 장소가 없습니다"
              description="연동(TourAPI)으로 들어온 장소는 여기 나오지 않습니다."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {manual.map((p) => (
                <li key={p.id} className="card p-3.5">
                  <p className="text-[14px] font-bold text-ink-800">{p.name}</p>
                  <p className="mt-0.5 text-[12.5px] text-ink-500">
                    {CATEGORY_ICON[p.category]} {CATEGORY_LABEL[p.category]} ·{' '}
                    {regionLabel(p.group_name, p.region_name)}
                  </p>
                  <p className="mt-0.5 font-mono text-[11.5px] text-ink-400">{p.id}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
