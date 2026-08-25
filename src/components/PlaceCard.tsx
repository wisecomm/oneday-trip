import { useState } from 'react'
import { CATEGORY_COLOR, CATEGORY_LABEL, type Place } from '@/lib/types'

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
        <p className="mt-0.5 truncate text-[12.5px] text-ink-500">{place.summary}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-500">
          <span className="font-semibold text-ink-700">★ {place.rating.toFixed(1)}</span>
          <span>·</span>
          <span>{'₩'.repeat(place.price_level)}</span>
        </div>
      </div>
      {right}
    </button>
  )
}
