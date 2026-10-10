import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** 기록(history) 항목마다 마지막 스크롤 위치 — 앱을 켜 둔 동안만 기억한다 */
const positions = new Map<string, number>()

/** 목록이 늦게 그려져도 이 시간까지는 원래 자리로 돌아가려고 다시 시도한다 */
const RESTORE_TIMEOUT_MS = 3000

/**
 * 뒤로 가기로 돌아오면 그 화면을 떠날 때의 스크롤 자리로, 새 화면으로 가면 맨 위로.
 *
 * 브라우저 기본 복원(scrollRestoration 'auto')은 돌아온 순간 한 번만 맞추는데, 우리 화면은
 * 목록을 받는 동안 '불러오는 중'이라 그때는 높이가 짧아 맨 위로 떨어졌다(내 여행 목록에서 여행을
 * 눌렀다 돌아오면 처음으로). 그래서 직접 기억하고, 목록이 그려져 높이가 찰 때까지 몇 초 동안
 * 다시 맞춘다. 그사이 사용자가 직접 스크롤하면 그만둔다.
 *
 * 같은 주소에서 쿼리만 바꾸는 replace(지도 ?area 등)는 건드리지 않는다.
 */
export function ScrollMemory() {
  const location = useLocation()
  const navType = useNavigationType()
  const keyRef = useRef(location.key)
  const pathRef = useRef(location.pathname)

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
    const onScroll = () => positions.set(keyRef.current, window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // 화면이 바뀐 직후(그리기 전) — 이후의 스크롤 이벤트는 새 항목의 것으로 센다
  useLayoutEffect(() => {
    const samePath = pathRef.current === location.pathname
    keyRef.current = location.key
    pathRef.current = location.pathname

    if (navType !== 'POP') {
      if (!samePath) window.scrollTo(0, 0)
      return
    }

    const target = positions.get(location.key) ?? 0
    if (target <= 0) {
      window.scrollTo(0, 0)
      return
    }

    let frame = 0
    let done = false
    const started = Date.now()
    const stop = () => {
      done = true
      cancelAnimationFrame(frame)
      for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(ev, stop)
    }
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) {
      window.addEventListener(ev, stop, { passive: true })
    }
    const tryRestore = () => {
      if (done) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      window.scrollTo(0, Math.min(target, Math.max(max, 0)))
      if (max >= target || Date.now() - started > RESTORE_TIMEOUT_MS) {
        stop()
        return
      }
      frame = requestAnimationFrame(tryRestore)
    }
    tryRestore()
    return stop
  }, [location.key, location.pathname, navType])

  return null
}
