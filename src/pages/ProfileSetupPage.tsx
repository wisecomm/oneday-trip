import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { profiles } from '@/lib/db'
import { TASTE_TAGS, type WaitingSensitivity } from '@/lib/types'
import { PageHeader, StepGuide } from '@/components/ui'

const SENSITIVITY_LABEL: Record<WaitingSensitivity, string> = {
  1: '대기 매우 민감',
  2: '대기 민감',
  3: '보통',
  4: '조금 느긋',
  5: '아주 느긋',
}

/**
 * SYS-01-02 · 01. 온보딩 및 회원 > 1.2 사용자 프로필 > 사용자 등록
 * 가입 직후 필수 등록 프로세스. 입력값은 로컬 추천 필터링(MAP-04-02)의
 * 개인화 기초 세그먼트 데이터로 적재된다.
 */
export function ProfileSetupPage() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const isEdit = params.get('edit') === '1'

  const [nickname, setNickname] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [sensitivity, setSensitivity] = useState<WaitingSensitivity>(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname)
      setTags(profile.taste_tags)
      setSensitivity(profile.waiting_sensitivity)
    } else if (user?.suggestedNickname) {
      // 소셜 가입 시 닉네임 자동 연동 (기획 가이드)
      setNickname(user.suggestedNickname)
    }
  }, [profile, user])

  if (!loading && !user) return <Navigate to="/login" replace />
  // 이미 등록을 마친 사용자는 홈으로 — 편집 진입(?edit=1)은 예외
  if (!loading && profile && !isEdit) return <Navigate to="/" replace />

  function toggleTag(tag: string) {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]))
  }

  async function save() {
    if (!user) return
    if (nickname.trim().length < 2) {
      setError('닉네임은 2자 이상 입력해 주세요.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await profiles.upsert({
        id: user.id,
        nickname: nickname.trim(),
        taste_tags: tags,
        waiting_sensitivity: sensitivity,
      })
      await refreshProfile()
      navigate(isEdit ? '/me' : '/trips/new', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="mx-auto w-full max-w-[520px]">
        <PageHeader
          title={isEdit ? '프로필 수정' : '사용자 등록'}
          subtitle={isEdit ? undefined : '가입 직후 1회만 등록하면 됩니다'}
          back={isEdit}
        />

        <div className="px-5 py-5">
          {!isEdit && (
            <div className="mb-6">
              <StepGuide steps={['사용자 등록', '여행 일정', '여행 규칙']} current={0} />
            </div>
          )}

          <section className="mb-7">
            <label className="label" htmlFor="nickname">
              닉네임
            </label>
            <input
              id="nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={12}
              placeholder="여행자"
              className="field"
            />
            <p className="hint mt-1.5">소셜 가입 시 계정 이름이 자동으로 연동됩니다.</p>
          </section>

          <section className="mb-7">
            <p className="label">선호 식당 / 테마 카테고리</p>
            <div className="flex flex-wrap gap-2">
              {TASTE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={tags.includes(tag) ? 'chip-on' : 'chip-off'}
                >
                  {tag}
                </button>
              ))}
            </div>
            <p className="hint mt-2">중복 선택 가능 · AI 추천 피드의 개인화 기준이 됩니다.</p>
          </section>

          <section className="mb-8">
            <p className="label">웨이팅 성향</p>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={sensitivity}
              onChange={(e) => setSensitivity(Number(e.target.value) as WaitingSensitivity)}
              className="w-full accent-brand-500"
              aria-label="웨이팅 성향"
            />
            <div className="mt-1 flex justify-between text-[11.5px] text-ink-400">
              <span>대기 민감</span>
              <span className="font-bold text-brand-600">{SENSITIVITY_LABEL[sensitivity]}</span>
              <span>느긋</span>
            </div>
            <p className="hint mt-2">
              민감할수록 대기 팀이 적은 장소를 우선 추천하고, 웨이팅 알림을 더 일찍 보냅니다.
            </p>
          </section>

          {error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
          )}

          <button type="button" onClick={save} disabled={busy} className="btn-primary w-full">
            {isEdit ? '변경 사항 저장' : '저장하고 여행 만들기'}
          </button>
        </div>
      </div>
    </div>
  )
}
