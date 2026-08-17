import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { estimatedWaitMinutes, useWaiting } from '@/store/waiting'
import { isSupabaseConfigured } from '@/lib/supabase'

const NAV = [
  { to: '/', label: '홈', icon: 'home' },
  { to: '/map', label: '지도', icon: 'map' },
  { to: '/recommend', label: 'AI 추천', icon: 'sparkle' },
  { to: '/trips', label: '마이 트립', icon: 'route' },
  { to: '/me', label: 'MY', icon: 'user' },
] as const

export function AppLayout() {
  const { pathname } = useLocation()
  const { active } = useWaiting()

  // 지도 화면은 전체 높이를 쓰므로 본문 패딩을 제거한다
  const isMapScreen = pathname === '/map'

  return (
    <div className="min-h-dvh bg-ink-100">
      {!isSupabaseConfigured && <DemoBanner />}

      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col bg-ink-50 shadow-[0_0_60px_rgba(20,23,28,0.08)]">
        <main className={`flex-1 ${isMapScreen ? '' : 'pb-28'}`}>
          <Outlet />
        </main>

        {active && <WaitingFloatingBar minutes={estimatedWaitMinutes(active)} name={active.place?.name ?? ''} />}

        <nav className="fixed bottom-0 z-40 w-full max-w-[520px] border-t border-ink-200 bg-white/97 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <ul className="flex">
            {NAV.map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition-colors ${
                      isActive ? 'text-brand-600' : 'text-ink-400'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <NavIcon name={item.icon} active={isActive} />
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

function WaitingFloatingBar({ minutes, name }: { minutes: number; name: string }) {
  return (
    <Link
      to="/waiting"
      className="fixed bottom-[68px] left-1/2 z-40 flex w-[calc(100%-32px)] max-w-[488px] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink-800 px-4 py-3 text-white shadow-[0_12px_28px_-8px_rgba(20,23,28,0.55)]"
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-300 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-400" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold">대기순서 확인 · {name}</p>
        <p className="text-[12px] text-ink-300">예상 대기 약 {minutes}분</p>
      </div>
      <span className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[12px] font-bold">보기</span>
    </Link>
  )
}

function DemoBanner() {
  return (
    <div className="bg-brand-900 px-4 py-1.5 text-center text-[11.5px] font-medium text-brand-100">
      데모 모드 — <code className="font-mono">.env</code> 에 Supabase 키를 넣으면 실제 백엔드에 연결됩니다
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
