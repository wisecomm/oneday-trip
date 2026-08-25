import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { GoogleMark } from '@/components/ui'

/**
 * SYS-01-01 · 이메일로 가입하기.
 * 로그인 화면(/login)에서 모드를 토글하던 방식이 헷갈린다는 지적으로
 * 별도 화면으로 분리했다 — 가입 흐름 자체는 로그인과 동일하다(구글 OAuth ·
 * 이메일+비밀번호), 진입 경로만 다르다.
 */
export function SignupPage() {
  const { user, signInWithGoogle, signUpWithEmail } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user) return <Navigate to="/onboarding" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signUpWithEmail(email, password)
      navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '가입 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
      if (!isSupabaseConfigured) navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '소셜 가입에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-ink-50">
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center bg-white px-6 py-12">
        <div className="mb-9">
          <Link
            to="/login"
            className="mb-4 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-500"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M15 5l-7 7 7 7"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            로그인으로 돌아가기
          </Link>
          <h1 className="text-[26px] leading-tight font-extrabold text-ink-900">
            이메일로 가입하기
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
            이메일과 비밀번호만으로 바로 시작할 수 있어요.
          </p>
        </div>

        <button type="button" onClick={google} disabled={busy} className="btn-outline w-full">
          <GoogleMark />
          Google로 계속하기
        </button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-ink-200" />
          <span className="text-[12px] text-ink-400">또는 이메일</span>
          <span className="h-px flex-1 bg-ink-200" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="email">
              이메일
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="traveler@example.com"
              className="field"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              비밀번호
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="6자 이상"
              className="field"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
          )}

          <button type="submit" disabled={busy} className="btn-primary mt-1 w-full">
            이메일로 가입하기
          </button>
        </form>

        <p className="mt-4 text-center text-[13px] text-ink-500">
          이미 계정이 있으신가요?{' '}
          <Link to="/login" className="font-semibold text-brand-600">
            로그인
          </Link>
        </p>
      </div>
    </div>
  )
}
