import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { places as placesApi } from '@/lib/db'
import { CATEGORY_COLOR, CATEGORY_LABEL, shownRating, type Place } from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'
import { CategoryDot, RatingStar } from '@/components/PlaceCard'

/**
 * 장소 상세 — 사진 · 주소 · 가격대 · 영업시간 · 소개 · 태그 · 전화 연결.
 */
export function PlaceDetailPage() {
  const { placeId = '' } = useParams()

  const [place, setPlace] = useState<Place | null>(null)
  const [loading, setLoading] = useState(true)

  // 사진 URL이 죽어 있는 경우(TourAPI CDN 만료 등) 그라디언트 플레이스홀더로 되돌아간다
  const [imageFailed, setImageFailed] = useState(false)
  // 조회 실패와 '없는 장소'는 다르다 (RoutePage 와 같은 이유)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setImageFailed(false)
    setLoadFailed(false)
    placesApi
      .get(placeId)
      .then((p) => {
        if (alive) setPlace(p)
      })
      .catch(() => {
        if (alive) setLoadFailed(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [placeId])

  if (loading) return <Loading />
  if (loadFailed)
    return (
      <EmptyState
        icon="📡"
        title="불러오지 못했습니다"
        description="네트워크 상태를 확인한 뒤 다시 열어 주세요."
      />
    )
  if (!place) return <EmptyState title="장소를 찾을 수 없습니다" />

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
              {CATEGORY_LABEL[place.category]} · {place.group_name} {place.region_name}
            </span>
          </div>
        </div>
      ) : (
        <div
          className="flex h-44 items-center justify-center text-white"
          style={{
            // CSS 변수(--color-babzip 등)를 쓰면 안 된다 — 클래스로 쓰이지 않는 테마
            // 변수는 Tailwind v4 가 빌드에서 지워, 사진 없는 장소의 배경이 비었다.
            background: `linear-gradient(135deg, ${CATEGORY_COLOR[place.category]}, color-mix(in srgb, ${CATEGORY_COLOR[place.category]} 65%, #14171c))`,
          }}
        >
          <span className="text-[13px] font-bold tracking-wide opacity-90">
            {CATEGORY_LABEL[place.category]} · {place.group_name} {place.region_name}
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
          {/* 값이 없는 항목은 줄째 숨긴다 — 빈 칸이 남은 화면이 그 영역이 아예 없는
              화면보다 나쁘다. 가격대(price_level)는 표시하지 않는다 — TourAPI 에 가격 정보가 없어 전 장소가 기본값 2라, 보이면 '보통 가격'이라는 거짓 정보가 된다. */}
          {shownRating(place) && (
            <p className="mt-2 text-[13px]">
              <RatingStar place={place} /> <span className="text-ink-400">· 방문한 사람들의 별점</span>
            </p>
          )}
          {/* 영업시간은 따로 한 줄 — 같은 줄에 두면 길어서 넘어갈 때 구분선만 위에 남는다 */}
          {place.open_hours && (
            <p className="mt-1 text-[13px] leading-relaxed whitespace-pre-line text-ink-600">
              {place.open_hours}
            </p>
          )}
        </div>

        {place.summary && (
          <p className="mb-4 text-[14px] leading-relaxed text-ink-700">{place.summary}</p>
        )}

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
      </div>
    </>
  )
}
