/**
 * 네이버 지도 JavaScript API v3 로더 (TRIP-03-02 / MAP-04-01).
 *
 * VITE_NAVER_MAP_CLIENT_ID 가 없으면 SDK 를 불러오지 않고,
 * MapView 가 SVG 폴백 지도로 대체 렌더링한다.
 */

declare global {
  interface Window {
    naver?: any
    /** 네이버 SDK 가 인증 실패 시 호출하는 전역 훅 */
    navermap_authFailure?: () => void
  }
}

const CLIENT_ID = import.meta.env.VITE_NAVER_MAP_CLIENT_ID

/**
 * 인증 파라미터 이름.
 * 신규 NAVER Cloud Platform 콘솔은 `ncpKeyId`, 구 콘솔은 `ncpClientId` 를 쓴다.
 * 콘솔 세대에 따라 달라지므로 .env 로 바꿀 수 있게 열어 둔다.
 */
const AUTH_PARAM = import.meta.env.VITE_NAVER_MAP_AUTH_PARAM ?? 'ncpKeyId'

export const isNaverMapConfigured = Boolean(CLIENT_ID)

/** SDK 가 실제로 쓸 수 있는 상태인지 — Map 생성자까지 있어야 준비된 것이다 */
function isReady(): boolean {
  return typeof window.naver?.maps?.Map === 'function'
}

const AUTH_HELP =
  `인증에 실패했습니다. NCP 콘솔의 Web 서비스 URL 에 ${window.location.origin} 이 ` +
  `등록되어 있는지, 인증 파라미터(현재 ${AUTH_PARAM})가 콘솔 세대와 맞는지 확인해 주세요. ` +
  `신규 콘솔은 ncpKeyId, 구 콘솔은 ncpClientId 입니다.`

/**
 * 인증 실패 통지.
 *
 * 네이버 SDK 는 지도 인스턴스를 먼저 만들어 준 뒤, 인증 결과가 돌아오면 그때
 * `navermap_authFailure` 를 호출하고 window.naver.maps 를 null 로 바꾼다.
 * 즉 실패는 로드 성공 '이후'에 도착할 수 있어, Promise 거부만으로는 잡을 수 없다.
 * (놓치면 화면에는 네이버의 auth_fail 타일만 깔린 채 폴백이 뜨지 않는다)
 * 그래서 로드 성패와 별개로 구독 가능한 통지 경로를 둔다.
 */
type AuthFailureListener = () => void
const authListeners = new Set<AuthFailureListener>()
let authFailed = false

// 전역 훅은 모듈 로드 시점에 한 번만 심어 두어 어느 시점의 실패든 받는다
window.navermap_authFailure = () => {
  authFailed = true
  loader = null
  console.error('[naver] ' + AUTH_HELP)
  authListeners.forEach((listener) => listener())
}

export function hasNaverAuthFailed(): boolean {
  return authFailed
}

/** 인증 실패를 구독한다. 이미 실패한 뒤라면 즉시 호출된다. */
export function onNaverAuthFailure(listener: AuthFailureListener): () => void {
  if (authFailed) {
    listener()
    return () => {}
  }
  authListeners.add(listener)
  return () => void authListeners.delete(listener)
}

let loader: Promise<any> | null = null

export function loadNaverMaps(timeoutMs = 8000): Promise<any> {
  if (!CLIENT_ID) return Promise.reject(new Error('VITE_NAVER_MAP_CLIENT_ID is not set'))
  if (authFailed) return Promise.reject(new Error(AUTH_HELP))
  if (isReady()) return Promise.resolve(window.naver)
  if (loader) return loader

  loader = new Promise((resolve, reject) => {
    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      loader = null
      unsubscribe()
      reject(new Error(message))
    }
    const succeed = () => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve(window.naver)
    }

    // 로드 도중에 인증 실패가 확정되면 곧바로 거부한다.
    // (로드 이후에 도착하는 실패는 MapView 가 따로 구독해 처리한다)
    const unsubscribe = onNaverAuthFailure(() => fail(AUTH_HELP))

    const script = document.createElement('script')
    script.async = true
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?${AUTH_PARAM}=${CLIENT_ID}`

    script.onload = () => {
      // 인증에 실패하면 스크립트는 정상 로드되지만 window.naver.maps 가 null 로 남는다.
      // 즉 onload 만으로는 성공을 판단할 수 없고, Map 생성자의 존재를 직접 확인해야 한다.
      if (isReady()) {
        succeed()
        return
      }
      // 통지 경로 ②: 부트스트랩이 비동기로 본체를 받아오는 경우가 있어 잠시 더 지켜본다
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (isReady()) {
          clearInterval(timer)
          succeed()
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          fail(AUTH_HELP)
        }
      }, 150)
    }

    script.onerror = () => fail('네이버 지도 SDK 를 내려받지 못했습니다. 네트워크를 확인해 주세요.')

    // 통지 경로 ③: 위 어느 것도 불리지 않는 경우를 대비한 최종 안전장치
    setTimeout(() => {
      if (!isReady()) fail(AUTH_HELP)
    }, timeoutMs + 2000)

    document.head.appendChild(script)
  })

  return loader
}
