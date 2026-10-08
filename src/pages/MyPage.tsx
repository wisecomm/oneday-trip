import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { isNaverMapConfigured } from '@/lib/naver'
import { EmptyState, PageHeader } from '@/components/ui'

export function MyPage() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()

  if (!user) {
    return (
      <>
        <PageHeader title="MY" />
        <EmptyState
          icon="👤"
          title="로그인이 필요합니다"
          description="가입하면 여행 일정과 리뷰가 저장됩니다."
          action={
            <Link to="/login" className="btn-primary">
              로그인 / 가입
            </Link>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader title="MY" />

      <div className="px-4 py-4">
        <section className="card mb-5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 text-[18px] font-extrabold text-white">
              {(profile?.nickname ?? '여')[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-extrabold text-ink-800">
                {profile?.nickname ?? '닉네임 미등록'}
              </p>
              <p className="truncate text-[12.5px] text-ink-500">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/onboarding?edit=1')}
              className="btn-outline !px-3 !py-1.5 text-[13px]"
            >
              수정
            </button>
          </div>

          {profile && (
            <>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {profile.taste_tags.length === 0 ? (
                  <span className="hint">등록한 취향 태그가 없습니다</span>
                ) : (
                  profile.taste_tags.map((t) => (
                    <span key={t} className="chip-off !cursor-default">
                      #{t}
                    </span>
                  ))
                )}
              </div>
            </>
          )}
        </section>

        {/* SHARE-06-04 · 관리자면 PLACE-07-01 까지 (7-D6 의 role 로 판정) */}
        <section className="mb-6">
          <h2 className="section-title mb-3">공유</h2>
          <ul className="card divide-y divide-ink-100">
            <li>
              <Link
                to="/me/plans"
                className="flex items-center justify-between px-4 py-3.5 text-[14px] font-semibold text-ink-700"
              >
                내가 올린 코스
                <span aria-hidden className="text-ink-300">
                  ›
                </span>
              </Link>
            </li>
            {profile?.role === 'admin' && (
              <li>
                <Link
                  to="/admin/plans"
                  className="flex items-center justify-between px-4 py-3.5 text-[14px] font-semibold text-ink-700"
                >
                  운영자 코스 관리
                  <span aria-hidden className="text-ink-300">
                    ›
                  </span>
                </Link>
              </li>
            )}
            {profile?.role === 'admin' && (
              <li>
                <Link
                  to="/admin/places"
                  className="flex items-center justify-between px-4 py-3.5 text-[14px] font-semibold text-ink-700"
                >
                  장소 등록 관리
                  <span aria-hidden className="text-ink-300">
                    ›
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </section>

        <section className="mb-6">
          <h2 className="section-title mb-3">연동 상태</h2>
          <ul className="card divide-y divide-ink-100">
            <StatusRow label="Supabase 백엔드" ok={isSupabaseConfigured} envKey="VITE_SUPABASE_URL" />
            <StatusRow
              label="네이버 지도 SDK"
              ok={isNaverMapConfigured}
              envKey="VITE_NAVER_MAP_CLIENT_ID"
            />
          </ul>
        </section>

        <button type="button" onClick={signOut} className="btn-ghost w-full">
          로그아웃
        </button>
      </div>
    </>
  )
}

function StatusRow({ label, ok, envKey }: { label: string; ok: boolean; envKey: string }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink-800">{label}</span>
        <code className="text-[11.5px] text-ink-400">{envKey}</code>
      </span>
      <span className={`badge ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}`}>
        {ok ? '연결됨' : '데모 모드'}
      </span>
    </li>
  )
}
