import { useEffect, useRef, useState } from 'react'
import {
  hasNaverAuthFailed,
  isNaverMapConfigured,
  loadNaverMaps,
  onNaverAuthFailure,
} from '@/lib/naver'
import { projectToViewport, type LatLng } from '@/lib/geo'
import { groupRepresentatives } from '@/lib/map-group'
import { CATEGORY_COLOR, CATEGORY_ICON, type Place } from '@/lib/types'

/** 지도 위치 — baseZoom 은 점 마커 모드에서 '전체를 맞춘 줌'(복원할 때 이름표 기준으로 쓴다) */
export interface MapViewport {
  lat: number
  lng: number
  zoom: number
  baseZoom?: number | null
}

interface MapViewProps {
  places: Place[]
  /** 폴백 지도에서 마커가 침범하면 안 되는 상·하 UI 영역(px) */
  safeInsets?: { top?: number; bottom?: number }
  /** 순번 마커(1,2,3…)와 Polyline 을 그릴 방문 순서. 미지정 시 일반 마커만 표시 */
  route?: Place[]
  selectedId?: string | null
  onSelect?: (place: Place) => void
  className?: string
  /** 지도의 '↻ 내 위치 다시 찾기' 버튼으로 확보한 사용자 위치 — 있으면 파란 점으로 표시하고 뷰에 포함시킨다 */
  userLocation?: LatLng | null
  /**
   * 이전에 보고 있던 지도 위치(중심·줌)를 복원할 때 쓴다 — 있으면 마운트 시
   * 자동 fitBounds/setCenter 대신 이 위치로 초기화한다 (네이버 SDK 지도만 지원).
   */
  initialViewport?: MapViewport | null
  /** 사용자가 지도를 움직일 때마다(드래그·줌) 현재 중심/줌을 알려준다 (네이버 SDK 지도만 지원) */
  onViewportChange?: (v: MapViewport) => void
  /**
   * 점 마커로 그린다 — 이름표 없이 카테고리색 작은 점. 시/도 전체처럼 수천 곳을 한 번에
   * 그릴 때 쓴다. 고른 장소와 방문 순번 마커는 이 모드에서도 이름표 마커로 그린다.
   *
   * 네이버 지도에서는 '전체를 맞춘 줌'보다 확대하면 화면 안의 점을 이름표 마커로 바꾸고,
   * 그 줌 이하로 줄이면 다시 점으로 돌린다(지도를 움직일 때마다 화면 안만 다시 본다).
   */
  compact?: boolean
  /**
   * 지도를 맞출 때 내 위치도 화면에 넣을지(기본 true). 지도 탭은 '내 위치 주변'일 때만 켠다 —
   * 부천에 있으면서 강동구를 고르면 부천까지 넣느라 강동구가 작게 보였다. 끄면 고른 지역의
   * 장소에만 맞추고, 내 위치 점은 그 화면 안에 있을 때 그대로 보인다.
   */
  fitUserLocation?: boolean
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
  initialViewport,
  onViewportChange,
  compact,
  fitUserLocation,
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
        initialViewport={initialViewport}
        onViewportChange={onViewportChange}
        compact={compact}
        fitUserLocation={fitUserLocation}
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
      compact={compact}
      fitUserLocation={fitUserLocation}
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
  initialViewport,
  onViewportChange,
  compact,
  fitUserLocation = true,
  onFail,
}: MapViewProps & { onFail: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  // 고른 장소가 바뀔 때 그 두 마커만 다시 그리려고 장소 id 로 마커를 찾아 둔다.
  // 예전에는 고를 때마다 마커 전체를 지우고 다시 만들었는데, 시/도 전체(수천 곳)에서는
  // 한 번 누를 때마다 그만큼을 다시 만든다.
  const markerByIdRef = useRef(new Map<string, { marker: any; place: Place }>())
  const selectedIdRef = useRef<string | null | undefined>(selectedId)
  selectedIdRef.current = selectedId
  const drawnSelectedRef = useRef<string | null | undefined>(null)
  const userMarkerRef = useRef<any>(null)
  const polylineRef = useRef<any>(null)
  // 복원할 위치가 있을 때, 마운트 직후 첫 자동 맞춤(fitBounds)만 건너뛰기 위한 플래그
  const appliedInitialViewport = useRef(false)
  const [ready, setReady] = useState(false)

  // 점 마커 모드의 '전체를 맞춘 줌'. 이보다 확대하면 화면 안의 점을 이름표로, 이 줌 이하로
  // 줄이면 다시 점으로. 자동 맞춤 직후의 줌을 잡는다 — 맞춤이 애니메이션이면 끝난 뒤(idle)에.
  const baseZoomRef = useRef<number | null>(initialViewport?.baseZoom ?? null)
  // 맞춘 직후 이 시각까지 오는 idle 만 '맞춤이 끝난 것'으로 본다 — 맞춤으로 화면이 안 바뀌어
  // idle 이 오지 않으면, 뒤에 사용자가 확대한 줌을 전체 줌으로 잘못 잡지 않게
  const captureBaseUntilRef = useRef(0)
  /** 점 마커 모드에서 마커마다 지금 그려 둔 모양 — 없으면 점 */
  const looksRef = useRef(new Map<string, MarkerLook>())
  const orderIndexRef = useRef(new Map<string, number>())
  const compactRef = useRef(!!compact)
  compactRef.current = !!compact

  /** 이 마커를 지금 어떤 모양으로 그릴지 — 고른 장소는 늘 이름표 */
  const iconFor = (id: string, place: Place, selected: boolean) => {
    const look = looksRef.current.get(id) ?? 'dot'
    const dot = compactRef.current && look === 'dot'
    return markerIcon(window.naver, place, orderIndexRef.current.get(id), selected, dot, typeof look === 'number' ? look - 1 : 0)
  }

  /**
   * 점 마커 모드에서 줌 · 화면에 맞춰 모양을 바꾼다. 바뀌는 마커만 다시 그린다.
   *   전체 줌 이하            → 모두 점
   *   확대 · 화면 안 ≤ 100곳 → 화면 안은 이름표, 밖은 점
   *   확대 · 화면 안 > 100곳 → 화면을 칸으로 나눠 칸마다 대표 1곳만 이름표(+N), 나머지는 숨김
   */
  const refreshTags = useRef(() => {})
  refreshTags.current = () => {
    const naver = window.naver
    const map = mapRef.current
    if (!naver?.maps || !map) return
    const base = baseZoomRef.current
    const zoomedIn = compactRef.current && base !== null && map.getZoom() > base
    const next = new Map<string, MarkerLook>()
    if (zoomedIn) {
      const view = map.getBounds?.()
      const inView: Place[] = []
      for (const { place } of markerByIdRef.current.values()) {
        if (
          typeof view?.hasLatLng !== 'function' ||
          view.hasLatLng(new naver.maps.LatLng(place.lat, place.lng))
        ) {
          inView.push(place)
        }
      }
      if (inView.length <= TAG_MAX) {
        for (const p of inView) next.set(p.id, 'tag')
      } else {
        const reps = groupRepresentatives(inView, TAG_MAX)
        for (const p of inView) {
          const n = reps.get(p.id)
          next.set(p.id, n === undefined ? 'hidden' : n > 1 ? n : 'tag')
        }
      }
    }
    // 고른 장소는 숨기지 않는다
    const sel = selectedIdRef.current
    if (sel && next.get(sel) === 'hidden') next.set(sel, 'tag')

    const prev = looksRef.current
    looksRef.current = next
    for (const id of new Set([...prev.keys(), ...next.keys()])) {
      const a = prev.get(id) ?? 'dot'
      const b = next.get(id) ?? 'dot'
      if (a === b) continue
      const hit = markerByIdRef.current.get(id)
      if (!hit) continue
      if (b === 'hidden') {
        hit.marker.setVisible(false)
        continue
      }
      if (a === 'hidden') hit.marker.setVisible(true)
      hit.marker.setIcon(iconFor(id, hit.place, id === sel))
    }
  }

  useEffect(() => {
    let cancelled = false
    loadNaverMaps()
      .then((naver) => {
        if (cancelled || !containerRef.current) return
        // 지도 생성 단계에서 던지는 예외도 폴백으로 이어져야 한다.
        // 여기서 놓치면 사용자에게는 빈 화면만 남는다.
        mapRef.current = new naver.maps.Map(containerRef.current, {
          center: new naver.maps.LatLng(
            initialViewport?.lat ?? places[0]?.lat ?? 37.5665,
            initialViewport?.lng ?? places[0]?.lng ?? 126.978,
          ),
          zoom: initialViewport?.zoom ?? 11,
        })
        // 사용자가 지도를 움직일 때마다(드래그·줌 종료 시) 이름표 ↔ 점을 다시 보고,
        // 현재 위치를 상위로 올려 보낸다
        naver.maps.Event.addListener(mapRef.current, 'idle', () => {
          const m = mapRef.current
          if (Date.now() < captureBaseUntilRef.current) {
            baseZoomRef.current = m.getZoom()
            captureBaseUntilRef.current = 0
          }
          refreshTags.current()
          const c = m.getCenter()
          onViewportChange?.({ lat: c.lat(), lng: c.lng(), zoom: m.getZoom(), baseZoom: baseZoomRef.current })
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
    // 최초 1회만 지도 인스턴스를 만든다 — initialViewport/onViewportChange 는 그 시점 값만 쓴다
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
    markerByIdRef.current = new Map()
    looksRef.current = new Map()
    userMarkerRef.current?.setMap(null)
    userMarkerRef.current = null
    polylineRef.current?.setMap(null)

    const orderIndex = new Map(route?.map((p, i) => [p.id, i + 1]) ?? [])
    orderIndexRef.current = orderIndex
    const bounds = new naver.maps.LatLngBounds()

    if (userLocation) {
      const pos = new naver.maps.LatLng(userLocation.lat, userLocation.lng)
      if (fitUserLocation) bounds.extend(pos)
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

    const currentSelected = selectedIdRef.current
    places.forEach((place) => {
      const pos = new naver.maps.LatLng(place.lat, place.lng)
      bounds.extend(pos)

      const selected = place.id === currentSelected
      const marker = new naver.maps.Marker({
        position: pos,
        map,
        zIndex: selected ? 10 : 1,
        icon: markerIcon(naver, place, orderIndex.get(place.id), selected, !!compact),
      })

      naver.maps.Event.addListener(marker, 'click', () => onSelect?.(place))
      markersRef.current.push(marker)
      markerByIdRef.current.set(place.id, { marker, place })
    })
    drawnSelectedRef.current = currentSelected

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

    let fitted = true
    if (initialViewport && !appliedInitialViewport.current) {
      fitted = false
      // 복원할 위치가 있으면 자동 맞춤을 건너뛰고 그 자리를 그대로 둔다.
      // places 가 아직 비어 있으면(비동기 로딩 중) 이번 렌더는 판단을 유보하고
      // 플래그를 세우지 않는다 — 그렇지 않으면 빈 배열로 열린 첫 렌더에서 플래그가
      // 바로 소모돼, 실제 장소 목록이 도착하는 다음 렌더에서 자동 맞춤이 다시 걸린다.
      if (places.length > 0) {
        appliedInitialViewport.current = true
      }
    } else if (userLocation && fitUserLocation) {
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
    } else {
      fitted = false
    }
    // 방금 자동으로 맞췄다면 그 줌이 '전체' — 맞춤이 끝난 뒤(idle) 다시 한 번 잡는다
    if (fitted) {
      baseZoomRef.current = map.getZoom()
      captureBaseUntilRef.current = Date.now() + 1000
    }
    refreshTags.current()
    // 고른 장소는 아래 효과가 따로 바꾼다 — 고를 때마다 지도를 다시 맞추지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, route, compact, onSelect, userLocation, initialViewport, ready, fitUserLocation])

  // 고른 장소가 바뀌면 이전 것과 새 것, 두 마커의 모양만 바꾼다
  useEffect(() => {
    const naver = window.naver
    if (!naver?.maps || !ready) return
    const prev = drawnSelectedRef.current
    if (prev === selectedId) return
    for (const id of [prev, selectedId]) {
      if (!id) continue
      const hit = markerByIdRef.current.get(id)
      if (!hit) continue
      const selected = id === selectedId
      if (selected) hit.marker.setVisible(true)
      if (!selected && looksRef.current.get(id) === 'hidden') hit.marker.setVisible(false)
      hit.marker.setIcon(iconFor(id, hit.place, selected))
      hit.marker.setZIndex(selected ? 10 : 1)
    }
    drawnSelectedRef.current = selectedId
  }, [selectedId, route, compact, ready])

  return <div ref={containerRef} className={className} />
}

/**
 * 확대했을 때 화면 안에 이름표로 그리는 최대 곳 수 — 넘으면 주변끼리 합쳐 칸마다 대표 1곳만(+N).
 * 처음엔 1,000 이었다 — 그만큼은 휴대폰 화면에 이름표가 너무 많아 100 으로 줄였다(10/9).
 */
export const TAG_MAX = 100

/** 점 마커 모드의 마커 모양: 점 · 이름표 · 숨김 · 대표(숫자 = 칸 안의 곳 수) */
type MarkerLook = 'dot' | 'tag' | 'hidden' | number

/** 마커 콘텐츠 래퍼의 가로 너비(px) — 이름표가 원보다 넓어도 항상 이 축을 기준으로 가운데 정렬한다 */
const MARKER_WIDTH = 92

/** 점 마커 지름(px) — 흰 테두리 포함 */
const DOT_SIZE = 12

/**
 * 네이버 마커 아이콘. 점 모드라도 고른 장소와 방문 순번이 있는 장소는 이름표 마커다 —
 * 점을 눌렀을 때 무엇을 골랐는지 지도 위에서 보이게.
 */
function markerIcon(
  naver: any,
  place: Place,
  order: number | undefined,
  selected: boolean,
  compact: boolean,
  more = 0,
) {
  if (compact && !selected && order === undefined) {
    return {
      content: dotHtml(place),
      anchor: new naver.maps.Point(DOT_SIZE / 2, DOT_SIZE / 2),
    }
  }
  const size = selected ? 38 : 30
  return {
    content: markerHtml(place, order, selected, more),
    // 콘텐츠는 이름표까지 포함한 MARKER_WIDTH 너비의 래퍼다. 원의 중앙 하단이
    // 좌표에 오도록, 래퍼 가로 중앙(원도 이름표도 이 축에 맞춰 가운데 정렬된다)
    // · 원의 세로 하단(래퍼 맨 위에서 size 만큼)을 앵커로 잡는다.
    anchor: new naver.maps.Point(MARKER_WIDTH / 2, size),
  }
}

function dotHtml(place: Place): string {
  return `<div style="width:${DOT_SIZE}px;height:${DOT_SIZE}px;box-sizing:border-box;border-radius:999px;
    background:${CATEGORY_COLOR[place.category]};border:2px solid #fff;cursor:pointer;
    box-shadow:0 1px 3px rgba(0,0,0,.3)"></div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 마커 콘텐츠 HTML — 카테고리색 원 아래 중앙에 가게 이름표를 붙인다.
 * 래퍼 너비를 MARKER_WIDTH 로 고정해 두면, 이름 길이와 무관하게 원과 이름표가
 * 항상 같은 가로축을 기준으로 가운데 정렬되므로 anchor 계산이 흔들리지 않는다.
 */
function markerHtml(place: Place, order: number | undefined, selected: boolean, more = 0): string {
  const color = CATEGORY_COLOR[place.category]
  const size = selected ? 38 : 30
  // 방문 순번이 있으면(동선 지도) 숫자를, 없으면(일반 탐색) 카테고리 아이콘을 보여준다
  const label = order ?? CATEGORY_ICON[place.category]
  const fontSize = order !== undefined ? (selected ? 15 : 13) : (selected ? 17 : 15)
  const name = escapeHtml(place.name)
  return `<div style="display:flex;flex-direction:column;align-items:center;width:${MARKER_WIDTH}px">
    <div style="width:${size}px;height:${size}px;box-sizing:border-box;border-radius:999px;
      background:${color};color:#fff;display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:${fontSize}px;font-family:inherit;line-height:1;cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,.28);border:2.5px solid #fff;position:relative">${label}${
        more > 0
          ? `<span style="position:absolute;top:-8px;left:${size - 10}px;min-width:18px;height:18px;padding:0 4px;
              box-sizing:border-box;border-radius:999px;background:#21262e;color:#fff;border:1.5px solid #fff;
              font-size:10px;font-weight:800;line-height:15px;text-align:center;white-space:nowrap">+${more > 999 ? '999' : more}</span>`
          : ''
      }</div>
    <span style="margin-top:3px;max-width:84px;font-size:11px;font-weight:700;color:#21262e;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:inherit;
      text-shadow:-1px -1px 0 #fff,1px -1px 0 #fff,-1px 1px 0 #fff,1px 1px 0 #fff,0 0 4px #fff">${name}</span>
  </div>`
}

/**
 * 내 위치 마커 — 장소 마커(핀 모양)와 구분되도록 파란 점 + 후광으로 그리고,
 * 지도 위에서 눈에 띄도록 바깥으로 번져 나가는 파동 애니메이션(index.css 의
 * my-location-pulse)을 겹친다. 파동은 절대 위치라 22×22 앵커 계산에 영향을 주지 않는다.
 */
function myLocationMarkerHtml(): string {
  return `<div style="position:relative;width:22px;height:22px">
    <span class="my-location-pulse" style="position:absolute;inset:0;border-radius:999px;background:#3282f6"></span>
    <div style="position:relative;width:22px;height:22px;border-radius:999px;background:#3282f6;
      border:3px solid #fff;box-shadow:0 0 0 5px rgba(50,130,246,.25),0 4px 10px rgba(0,0,0,.25)"></div>
  </div>`
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
  compact,
  fitUserLocation = true,
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

  // 내 위치도 좌표 범위 계산에 포함시켜야 뷰가 실제로 그쪽으로 옮겨간다. 맞추지 않을 때
  // (fitUserLocation false)는 장소들의 범위 안에 있을 때만 점을 그린다 — 범위를 넓히지 않는다
  const allLatLng = places.map((p) => ({ lat: p.lat, lng: p.lng }))
  const drawUser =
    !!userLocation &&
    (fitUserLocation ||
      (places.length > 1 &&
        userLocation.lat >= Math.min(...places.map((p) => p.lat)) &&
        userLocation.lat <= Math.max(...places.map((p) => p.lat)) &&
        userLocation.lng >= Math.min(...places.map((p) => p.lng)) &&
        userLocation.lng <= Math.max(...places.map((p) => p.lng))))
  if (userLocation && drawUser) allLatLng.push(userLocation)

  const allPoints = projectToViewport(allLatLng, W, H, {
    // 상단 필터·하단 내비게이션 UI 와 겹치지 않도록 여백을 확보한다
    top: (safeInsets?.top ?? 0) + 40,
    bottom: (safeInsets?.bottom ?? 0) + 40,
    right: 44,
    left: 44,
  })
  const points = allPoints.slice(0, places.length)
  const userPoint = userLocation && drawUser ? allPoints[allPoints.length - 1] : null
  const byId = new Map(places.map((p, i) => [p.id, points[i]]))
  const selectedIndex = places.findIndex((p) => p.id === selectedId)
  const drawOrder = places.map((_, i) => i).filter((i) => i !== selectedIndex)
  if (selectedIndex >= 0) drawOrder.push(selectedIndex)
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

        {/* 고른 장소를 맨 나중에 그려 점들 위에 오게 한다 — SVG 는 나중에 그린 것이 위다 */}
        {drawOrder.map((i) => {
          const place = places[i]
          const pt = points[i]
          if (!pt) return null
          const selected = place.id === selectedId
          const order = orderIndex.get(place.id)
          if (compact && !selected && order === undefined) {
            return (
              <circle
                key={place.id}
                cx={pt.x}
                cy={pt.y}
                r={DOT_SIZE / 2 - 1}
                fill={CATEGORY_COLOR[place.category]}
                stroke="#fff"
                strokeWidth="2"
                onClick={() => onSelect?.(place)}
                style={{ cursor: 'pointer' }}
              />
            )
          }
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
              {/* 방문 순번이 있으면(동선 지도) 숫자를, 없으면(일반 탐색) 카테고리 아이콘을 보여준다 */}
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={order !== undefined ? (selected ? 14 : 12) : (selected ? 16 : 14)}
                fontWeight="800"
                fill="#fff"
              >
                {order ?? CATEGORY_ICON[place.category]}
              </text>
              {/* 원 아래 중앙에 이름표 — 흰 테두리(halo)로 지도 위에서도 읽히게 한다 */}
              <text
                y={r + 13}
                textAnchor="middle"
                fontSize={selected ? 12.5 : 11}
                fontWeight="700"
                stroke="#fff"
                strokeWidth="3"
                style={{ paintOrder: 'stroke' }}
                fill="#21262e"
              >
                {place.name.length > 8 ? `${place.name.slice(0, 8)}…` : place.name}
              </text>
            </g>
          )
        })}

        {userPoint && (
          <g transform={`translate(${userPoint.x} ${userPoint.y})`}>
            {/* 바깥으로 번져 나가는 파동 — 눈에 띄게 반복 애니메이션 */}
            <circle r={7} fill="#3282f6">
              <animate attributeName="r" values="7;22;7" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.55;0;0.55" dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle r={7} fill="#3282f6" stroke="#fff" strokeWidth="2.5" />
          </g>
        )}
      </svg>
    </div>
  )
}
