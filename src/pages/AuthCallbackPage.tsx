import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { Loading } from '@/components/ui'

/**
 * SYS-01-01 · OAuth 리다이렉트 착지점.
 *
 * 성공 시: 세션이 감지되면 프로필 유무에 따라 온보딩(SYS-01-02) 또는 홈으로 보낸다.
 * 실패 시: Supabase 는 오류를 쿼리스트링이나 URL 프래그먼트로 실어 보내므로
 *          양쪽을 모두 읽어 사용자에게 이유를 보여준다. 조용히 로그인 화면으로
 *          되돌리면 사용자는 무엇이 잘못됐는지 알 수 없다.
 */
export function AuthCallbackPage() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  const query = new URLSearchParams(location.search)
  // 프래그먼트는 '#access_token=...&error=...' 형태라 앞의 '#' 을 떼고 파싱한다
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''))

  const errorCode = query.get('error') ?? hash.get('error')
  const errorDescription =
    query.get('error_description') ?? hash.get('error_description') ?? null

  if (errorCode) {
    return (
      <AuthError
        code={errorCode}
        description={errorDescription}
      />
    )
  }

  if (loading) return <Loading label="로그인 처리 중" />

  // 오류 파라미터도 세션도 없는 상태 — 콜백 URL 로 직접 들어온 경우다
  if (!user) {
    return (
      <AuthError
        code="no_session"
        description="로그인 세션을 확인하지 못했습니다. 다시 시도해 주세요."
      />
    )
  }

  return <Navigate to={profile ? '/' : '/onboarding'} replace />
}

function AuthError({ code, description }: { code: string; description: string | null }) {
  const hint =
    code === 'no_session'
      ? null
      : code.includes('provider') || description?.includes('provider')
        ? 'Supabase 대시보드에서 해당 소셜 로그인 제공자가 활성화되어 있는지 확인해 주세요.'
        : 'Supabase 대시보드의 Redirect URL 설정에 현재 주소가 등록되어 있는지 확인해 주세요.'

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center px-6 py-12">
        <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-2xl">
          ⚠️
        </div>
        <h1 className="text-[20px] font-extrabold text-ink-900">로그인을 완료하지 못했습니다</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-600">
          {description ?? '알 수 없는 오류가 발생했습니다.'}
        </p>
        <p className="mt-1 text-[12px] text-ink-400">오류 코드: {code}</p>
        {hint && <p className="hint mt-3 rounded-xl bg-ink-100 px-4 py-3">{hint}</p>}

        <Link to="/login" className="btn-primary mt-7 w-full">
          로그인 화면으로 돌아가기
        </Link>
        <Link to="/map" className="btn-ghost mt-2 w-full">
          가입 없이 둘러보기
        </Link>
      </div>
    </div>
  )
}
