import { useEffect, useRef, useState } from 'react'
import {
  hasNaverAuthFailed,
  isNaverMapConfigured,
  loadNaverMaps,
  onNaverAuthFailure,
} from '@/lib/naver'
import { projectToViewport, type LatLng } from '@/lib/geo'
import { CATEGORY_COLOR, type Place } from '@/lib/types'

interface MapViewProps {
  places: Place[]
  /** 폴백 지도에서 마커가 침범하면 안 되는 상·하 UI 영역(px) */
  safeInsets?: { top?: number; bottom?: number }
  /** 순번 마커(1,2,3…)와 Polyline 을 그릴 방문 순서. 미지정 시 일반 마커만 표시 */
  route?: Place[]
  selectedId?: string | null
  onSelect?: (place: Place) => void
  className?: string
  /** '내 위치 주변 재탐색' 등으로 확보한 사용자 위치 — 있으면 파란 점으로 표시하고 뷰에 포함시킨다 */
  userLocation?: LatLng | null
}

/**
 * 지도 뷰.
 * 네이버 지도 키가 있으면 실제 SDK 지도를, 없으면 동일한 인터랙션의 SVG 폴백 지도를 렌더링한다.
 * 등록 장소의 위경도 좌표를 배열로 모아 Polyline 으로 이어준다. (TRIP-03-02 개발 조건)
 */
export function MapView({
  places,
  route,
  selectedId,
  onSelect,
  className,
  safeInsets,
  userLocation,
}: MapViewProps) {
  // 다른 화면에서 이미 인증 실패가 확인됐다면 처음부터 폴백으로 간다
  const [naverFailed, setNaverFailed] = useState(hasNaverAuthFailed)
  const useNaver = isNaverMapConfigured && !naverFailed

  // 인증 실패는 지도 생성 이후에 도착할 수 있다
  useEffect(() => onNaverAuthFailure(() => setNaverFailed(true)), [])

  if (useNaver) {
    return (
      <NaverMap
        places={places}
        route={route}
        selectedId={selectedId}
        onSelect={onSelect}
        className={className}
        userLocation={userLocation}
        onFail={() => setNaverFailed(true)}
      />
    )
  }

  return (
    <FallbackMap
      places={places}
      route={route}
      selectedId={selectedId}
      onSelect={onSelect}
      className={className}
      safeInsets={safeInsets}
      userLocation={userLocation}
    />
  )
}

/* ────────────────────────── 네이버 SDK 지도 ────────────────────────── */

function NaverMap({
  places,
  route,
  selectedId,
  onSelect,
  className,
  userLocation,
  onFail,
}: MapViewProps & { onFail: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const userMarkerRef = useRef<any>(null)
  const polylineRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadNaverMaps()
      .then((naver) => {
        if (cancelled || !containerRef.current) return
        // 지도 생성 단계에서 던지는 예외도 폴백으로 이어져야 한다.
        // 여기서 놓치면 사용자에게는 빈 화면만 남는다.
        mapRef.current = new naver.maps.Map(containerRef.current, {
          center: new naver.maps.LatLng(places[0]?.lat ?? 37.5665, places[0]?.lng ?? 126.978),
          zoom: 11,
        })
        setReady(true)
      })
      .catch((err) => {
        console.error('[MapView] 네이버 지도를 쓸 수 없어 SVG 폴백으로 전환합니다.\n', err)
        onFail()
      })
    return () => {
      cancelled = true
    }
    // 최초 1회만 지도 인스턴스를 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 마커 · Polyline 갱신
  useEffect(() => {
    const naver = window.naver
    const map = mapRef.current
    if (!naver?.maps || !map) return

    // 이전 마커의 리스너까지 정리해야 클릭 핸들러가 누적되지 않는다
    markersRef.current.forEach((m) => {
      naver.maps.Event.clearInstanceListeners(m)
      m.setMap(null)
    })
    markersRef.current = []
    userMarkerRef.current?.setMap(null)
    userMarkerRef.current = null
    polylineRef.current?.setMap(null)

    const orderIndex = new Map(route?.map((p, i) => [p.id, i + 1]) ?? [])
    const bounds = new naver.maps.LatLngBounds()

    if (userLocation) {
      const pos = new naver.maps.LatLng(userLocation.lat, userLocation.lng)
      bounds.extend(pos)
      userMarkerRef.current = new naver.maps.Marker({
        position: pos,
        map,
        zIndex: 20,
        icon: {
          content: myLocationMarkerHtml(),
          anchor: new naver.maps.Point(11, 11),
        },
      })
    }

    places.forEach((place) => {
      const pos = new naver.maps.LatLng(place.lat, place.lng)
      bounds.extend(pos)

      const selected = place.id === selectedId
      const size = selected ? 38 : 30

      const marker = new naver.maps.Marker({
        position: pos,
        map,
        zIndex: selected ? 10 : 1,
        icon: {
          content: markerHtml(place, orderIndex.get(place.id), selected),
          // 마커 콘텐츠의 중앙 하단이 좌표에 오도록 앵커를 잡는다
          anchor: new naver.maps.Point(size / 2, size),
        },
      })

      naver.maps.Event.addListener(marker, 'click', () => onSelect?.(place))
      markersRef.current.push(marker)
    })

    if (route && route.length > 1) {
      polylineRef.current = new naver.maps.Polyline({
        map,
        path: route.map((p) => new naver.maps.LatLng(p.lat, p.lng)),
        strokeColor: '#3282f6',
        strokeWeight: 4,
        strokeOpacity: 0.9,
        strokeStyle: 'solid',
        strokeLineCap: 'round',
        strokeLineJoin: 'round',
      })
    }

    if (userLocation) {
      // 내 위치를 확보했을 때는 그 지점을 기준으로 뷰를 옮긴다 — 장소가 없거나
      // 하나뿐이면 내 위치에 바로 확대, 여러 곳이면 내 위치를 포함해 전부 보이게 맞춘다
      if (places.length === 0) {
        map.setCenter(new naver.maps.LatLng(userLocation.lat, userLocation.lng))
        map.setZoom(14)
      } else {
        map.fitBounds(bounds, { top: 56, right: 48, bottom: 56, left: 48 })
      }
    } else if (places.length === 1) {
      map.setCenter(new naver.maps.LatLng(places[0].lat, places[0].lng))
      map.setZoom(15)
    } else if (places.length > 1) {
      map.fitBounds(bounds, { top: 56, right: 48, bottom: 56, left: 48 })
    }
  }, [places, route, selectedId, onSelect, userLocation, ready])

  return <div ref={containerRef} className={className} />
}

/**
 * 마커 콘텐츠 HTML.
 * anchor 를 (size/2, size) 로 잡으므로 바깥 래퍼 없이 정확히 size × size 로만 그린다.
 * 래퍼에 transform 을 주면 앵커 계산과 어긋나 마커가 좌표에서 밀린다.
 */
function markerHtml(place: Place, order: number | undefined, selected: boolean): string {
  const color = CATEGORY_COLOR[place.category]
  const size = selected ? 38 : 30
  const label = order ?? ''
  return `<div style="width:${size}px;height:${size}px;box-sizing:border-box;border-radius:999px;
    background:${color};color:#fff;display:flex;align-items:center;justify-content:center;
    font-weight:800;font-size:${selected ? 15 : 13}px;font-family:inherit;cursor:pointer;
    box-shadow:0 4px 12px rgba(0,0,0,.28);border:2.5px solid #fff">${label}</div>`
}

/** 내 위치 마커 — 장소 마커(핀 모양)와 구분되도록 파란 점 + 후광으로 그린다 */
function myLocationMarkerHtml(): string {
  return `<div style="width:22px;height:22px;border-radius:999px;background:#3282f6;
    border:3px solid #fff;box-shadow:0 0 0 5px rgba(50,130,246,.25),0 4px 10px rgba(0,0,0,.25)"></div>`
}

/* ───────────────────── 폴백 지도 (키 미설정 시) ───────────────────── */

function FallbackMap({
  places,
  route,
  selectedId,
  onSelect,
  className,
  safeInsets,
  userLocation,
}: MapViewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  // 뷰박스를 컨테이너 픽셀 크기와 1:1로 맞춰야 마커가 왜곡되거나 잘리지 않는다
  const [{ W, H }, setSize] = useState({ W: 375, H: 480 })

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ W: Math.round(width), H: Math.round(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // 내 위치도 좌표 범위 계산에 포함시켜야 뷰가 실제로 그쪽으로 옮겨간다
  const allLatLng = places.map((p) => ({ lat: p.lat, lng: p.lng }))
  if (userLocation) allLatLng.push(userLocation)

  const allPoints = projectToViewport(allLatLng, W, H, {
    // 상단 필터·하단 내비게이션 UI 와 겹치지 않도록 여백을 확보한다
    top: (safeInsets?.top ?? 0) + 40,
    bottom: (safeInsets?.bottom ?? 0) + 40,
    right: 44,
    left: 44,
  })
  const points = allPoints.slice(0, places.length)
  const userPoint = userLocation ? allPoints[allPoints.length - 1] : null
  const byId = new Map(places.map((p, i) => [p.id, points[i]]))
  const orderIndex = new Map(route?.map((p, i) => [p.id, i + 1]) ?? [])
  const routePoints = (route ?? []).map((p) => byId.get(p.id)).filter(Boolean) as Array<{
    x: number
    y: number
  }>

  return (
    <div ref={boxRef} className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-full w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="장소 위치 지도"
      >
        <defs>
          <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0V32" fill="none" stroke="#dfe3ea" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="#eef2f6" />
        <rect width={W} height={H} fill="url(#grid)" />

        {routePoints.length > 1 && (
          <polyline
            points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#3282f6"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="1 0"
            opacity="0.9"
          />
        )}

        {places.map((place, i) => {
          const pt = points[i]
          if (!pt) return null
          const selected = place.id === selectedId
          const order = orderIndex.get(place.id)
          const r = selected ? 17 : 14
          return (
            <g
              key={place.id}
              transform={`translate(${pt.x} ${pt.y})`}
              onClick={() => onSelect?.(place)}
              style={{ cursor: 'pointer' }}
            >
              <circle r={r + 3} fill="#fff" opacity="0.95" />
              <circle r={r} fill={CATEGORY_COLOR[place.category]} />
              {order !== undefined && (
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={selected ? 14 : 12}
                  fontWeight="800"
                  fill="#fff"
                >
                  {order}
                </text>
              )}
              {selected && (
                <text
                  y={-r - 10}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="700"
                  fill="#21262e"
                >
                  {place.name}
                </text>
              )}
            </g>
          )
        })}

        {userPoint && (
          <g transform={`translate(${userPoint.x} ${userPoint.y})`}>
            <circle r={12} fill="#3282f6" opacity="0.22" />
            <circle r={7} fill="#3282f6" stroke="#fff" strokeWidth="2.5" />
          </g>
        )}
      </svg>
    </div>
  )
}
