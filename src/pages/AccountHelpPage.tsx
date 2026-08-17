import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/ui'

/**
 * SYS-01-01 부속 화면 — ID/PW 찾기.
 * Supabase Auth 의 비밀번호 재설정 메일 발송을 호출한다.
 */
export function AccountHelpPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (isSupabaseConfigured && supabase) {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        })
        if (err) throw err
      }
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '메일 발송에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto w-full max-w-[520px]">
        <PageHeader title="ID / 비밀번호 찾기" back />
        <div className="px-5 py-5">
          {sent ? (
            <div>
              <p className="text-[15px] font-bold text-ink-800">재설정 메일을 보냈습니다</p>
              <p className="hint mt-1.5">
                {email} 로 전송된 링크에서 비밀번호를 다시 설정해 주세요.
                {!isSupabaseConfigured && ' (데모 모드에서는 실제 메일이 발송되지 않습니다.)'}
              </p>
              <Link to="/login" className="btn-primary mt-5 w-full">
                로그인으로 돌아가기
              </Link>
            </div>
          ) : (
            <form onSubmit={submit}>
              <label className="label" htmlFor="reset-email">
                가입한 이메일
              </label>
              <input
                id="reset-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="traveler@example.com"
                className="field"
              />
              <p className="hint mt-1.5">
                소셜 계정으로 가입한 경우, 해당 소셜 서비스에서 비밀번호를 관리합니다.
              </p>
              {error && (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className="btn-primary mt-5 w-full">
                재설정 메일 받기
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
