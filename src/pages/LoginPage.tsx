import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { GoogleMark } from '@/components/ui'

/**
 * SYS-01-01 · 01. 온보딩 및 회원 > 1.1 로그인 / 가입 > 소셜 로그인
 * 최초 접속 시 이탈률 최소화를 위해 Guest 모드 진입점을 반드시 노출한다.
 * 이메일 가입은 이 화면에서 모드를 토글하는 대신 별도 화면(/signup)으로 분리한다.
 */
export function LoginPage() {
  const { user, signInWithGoogle, signInWithEmail, continueAsGuest } = useAuth()
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
      await signInWithEmail(email, password)
      navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '처리 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function google() {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
      // Supabase 모드에서는 브라우저가 구글 동의 화면으로 떠나고,
      // 돌아오는 곳은 /auth/callback 이다. 여기서 이동시키면 화면만 깜빡인다.
      if (!isSupabaseConfigured) navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '소셜 로그인에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-ink-50">
      <div className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col justify-center bg-white px-6 py-12">
        <div className="mb-9">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-2xl">
            🗺️
          </div>
          <h1 className="text-[26px] leading-tight font-extrabold text-ink-900">
            하루여행
          </h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
            여행 일정과 로컬 맛집을 지도 위에서 한 번에.
            <br />
            동선 최적화부터 실시간 예약까지.
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
              autoComplete="current-password"
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
            로그인
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-[13px]">
          <Link to="/signup" className="font-semibold text-brand-600">
            이메일로 가입하기
          </Link>
          <Link to="/help/account" className="text-ink-500">
            ID/PW 찾기
          </Link>
        </div>

        {/* Guest 모드 진입점 — 이탈률 최소화 (기획 가이드) */}
        <button
          type="button"
          onClick={() => {
            continueAsGuest()
            navigate('/map', { replace: true })
          }}
          className="mt-8 w-full py-3 text-[14px] font-semibold text-ink-500 underline underline-offset-4"
        >
          가입 없이 서비스 둘러보기
        </button>
      </div>
    </div>
  )
}
