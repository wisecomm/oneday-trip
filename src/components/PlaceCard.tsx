import { useState } from 'react'
import { CATEGORY_COLOR, CATEGORY_LABEL, shownRating, type Place } from '@/lib/types'

export function CategoryDot({ category }: { category: Place['category'] }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: CATEGORY_COLOR[category] }}
      aria-hidden
    />
  )
}

export function PlaceThumb({ place, size = 56 }: { place: Place; size?: number }) {
  const [imageFailed, setImageFailed] = useState(false)

  if (place.image_url && !imageFailed) {
    return (
      <img
        src={place.image_url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-xl object-cover"
        style={{ width: size, height: size }}
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, ${CATEGORY_COLOR[place.category]}, ${CATEGORY_COLOR[place.category]}bb)`,
      }}
      aria-hidden
    >
      <span className="text-[11px] font-bold">{CATEGORY_LABEL[place.category]}</span>
    </div>
  )
}

/** ★ 4.6 (12) — 리뷰가 MIN_RATING_DISPLAY 건 미만이면 아무것도 그리지 않는다 */
export function RatingStar({ place, className = '' }: { place: Place; className?: string }) {
  const r = shownRating(place)
  if (!r) return null
  return (
    <span className={`font-bold text-ink-700 ${className}`}>
      ★ {r.avg.toFixed(1)} <span className="font-normal text-ink-400">({r.count})</span>
    </span>
  )
}

export function PlaceCard({
  place,
  onClick,
  right,
}: {
  place: Place
  onClick?: () => void
  right?: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.99]"
    >
      <PlaceThumb place={place} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <CategoryDot category={place.category} />
          <p className="truncate text-[15px] font-bold text-ink-800">{place.name}</p>
        </div>
        {place.summary && (
          <p className="mt-0.5 truncate text-[12.5px] text-ink-500">{place.summary}</p>
        )}
        {/* 리뷰가 적은 장소에 ★ 를 찍지 않는다 (MIN_RATING_DISPLAY).
            가격대(price_level)는 표시하지 않는다 — TourAPI 에 가격 정보가 없어 전 장소가 기본값 2라, 보이면 '보통 가격'이라는 거짓 정보가 된다. */}
        {shownRating(place) && (
          <p className="mt-1.5 text-[12px]">
            <RatingStar place={place} />
          </p>
        )}
      </div>
      {right}
    </button>
  )
}
