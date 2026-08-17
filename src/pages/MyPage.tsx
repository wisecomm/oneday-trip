import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { reservations } from '@/lib/db'
import { isSupabaseConfigured } from '@/lib/supabase'
import { isNaverMapConfigured } from '@/lib/naver'
import type { Reservation } from '@/lib/types'
import { EmptyState, Loading, PageHeader } from '@/components/ui'

export function MyPage() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [list, setList] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setList(await reservations.listByUser(user.id))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) return <Loading />

  if (!user) {
    return (
      <>
        <PageHeader title="MY" />
        <EmptyState
          icon="👤"
          title="로그인이 필요합니다"
          description="가입하면 일정과 예약 내역이 저장됩니다."
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
              <p className="hint mt-2">웨이팅 성향 {profile.waiting_sensitivity} / 5</p>
            </>
          )}
        </section>

        <section className="mb-6">
          <h2 className="section-title mb-3">예약 내역</h2>
          {list.length === 0 ? (
            <p className="hint">예약 내역이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.map((r) => (
                <li key={r.id} className="card flex items-center gap-3 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-ink-800">{r.place?.name}</p>
                    <p className="text-[12.5px] text-ink-500">
                      {new Date(r.reserved_at).toLocaleString('ko-KR')} · {r.party_size}명 ·{' '}
                      {r.deposit.toLocaleString()}원
                    </p>
                  </div>
                  {r.status === 'confirmed' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await reservations.cancel(r.id)
                        await load()
                      }}
                      className="btn-ghost !px-3 !py-1.5 text-[12.5px]"
                    >
                      취소
                    </button>
                  ) : (
                    <span className="badge bg-ink-100 text-ink-500">취소됨</span>
                  )}
                </li>
              ))}
            </ul>
          )}
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
