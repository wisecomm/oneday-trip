import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'

/**
 * 탭은 다섯 개다. 375px(iPhone SE) 화면에서 칸당 75px 이다.
 *
 * 한때 '플랜' 탭까지 여섯 개였고 칸이 62.5px 라 라벨을 전부 두 글자로 줄였다
 * ("여행 지도"·"나의 여행" 같은 네 글자는 줄바꿈되거나 잘렸다). 그 결과 '여행'과
 * '플랜'이 무엇을 보여 주는지 말해 주지 못했다. 플랜을 추천 탭 안의 '추천 코스'로
 * 옮겨 탭을 줄이고(Q22), 넓어진 칸으로 '내 여행'을 쓴다. 네 글자는 여전히
 * 빠듯하니 세 글자 안에서 고른다.
 */
const NAV = [
  { to: '/', label: '홈', icon: 'home' },
  { to: '/map', label: '지도 1', icon: 'map' },
  { to: '/recommend', label: '추천', icon: 'sparkle' },
  { to: '/trips', label: '내 여행', icon: 'route' },
  { to: '/me', label: 'MY', icon: 'user' },
] as const

/**
 * 탭이 켜지는 주소. 코스 상세(/plans/:id)는 추천 탭에서 들어가는 화면이라 추천을
 * 켠다 — 안 그러면 상세에 들어가는 순간 어느 탭도 켜지지 않아 위치를 잃는다.
 */
function isTabActive(to: string, pathname: string, matched: boolean): boolean {
  if (to === '/recommend') return matched || pathname.startsWith('/plans/')
  return matched
}

export function AppLayout() {
  const { pathname } = useLocation()

  // 지도 화면은 전체 높이를 쓰므로 본문 패딩을 제거한다
  const isMapScreen = pathname === '/map'

  return (
    <div className="min-h-dvh bg-ink-100">
      {!isSupabaseConfigured && <DemoBanner />}

      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-ink-50 shadow-[0_0_60px_rgba(20,23,28,0.08)]">
        <main className={`flex-1 ${isMapScreen ? '' : 'pb-28'}`}>
          <Outlet />
        </main>

        <nav className="fixed bottom-0 z-40 w-full max-w-[520px] border-t border-ink-200 bg-white/97 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <ul className="flex">
            {NAV.map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      isTabActive(item.to, pathname, isActive) ? 'text-brand-600' : 'text-ink-400'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <NavIcon name={item.icon} active={isTabActive(item.to, pathname, isActive)} />
                      {item.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}

function DemoBanner() {
  return (
    <div className="bg-brand-900 px-4 py-1.5 text-center text-[11.5px] font-medium text-brand-100">
      데모 모드 — Supabase 환경변수(VITE_SUPABASE_URL 등)가 빌드에 없습니다. 로컬은{' '}
      <code className="font-mono">.env</code>, 배포 환경은 호스팅 서비스의 환경변수 설정을
      확인해 주세요
    </div>
  )
}

function NavIcon({ name, active }: { name: string; active: boolean }) {
  const stroke = active ? 2.2 : 1.8
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5.5 9.5V20h13V9.5" />
        </svg>
      )
    case 'map':
      return (
        <svg {...common}>
          <path d="M9 4 3.5 6.2v13.3L9 17.3l6 2.2 5.5-2.2V4L15 6.2 9 4Z" />
          <path d="M9 4v13.3M15 6.2v13.3" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...common}>
          <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 11 10.1 9 12 3.5Z" />
          <path d="M18.5 16.5 19.2 18.6l2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7.7-2.1Z" />
        </svg>
      )
    case 'route':
      return (
        <svg {...common}>
          <circle cx="6" cy="6.5" r="2.5" />
          <circle cx="18" cy="17.5" r="2.5" />
          <path d="M8.5 6.5H14a3.5 3.5 0 0 1 0 7h-4a3.5 3.5 0 0 0 0 7h5.5" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
        </svg>
      )
  }
}
