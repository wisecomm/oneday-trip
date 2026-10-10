import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase'
import { isNaverMapConfigured } from '@/lib/naver'
import { EmptyState, PageHeader } from '@/components/ui'
import { knownTasteTags } from '@/lib/types'
import { LANGUAGES, useI18n } from '@/i18n'

export function MyPage() {
  const { user, profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { t } = useI18n()

  if (!user) {
    return (
      <>
        <PageHeader title={t('me.title')} />
        <EmptyState
          icon="👤"
          title={t('me.loginRequired')}
          description={t('me.loginRequiredDesc')}
          action={
            <Link to="/login" className="btn-primary">
              {t('me.loginOrSignup')}
            </Link>
          }
        />
        {/* 비회원도 언어는 고른다 — 이 브라우저에만 기억 */}
        <div className="px-4 pb-6">
          <LanguagePicker />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader title={t('me.title')} />

      <div className="px-4 py-4">
        <section className="card mb-5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 text-[18px] font-extrabold text-white">
              {(profile?.nickname ?? '여')[0]}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-extrabold text-ink-800">
                {profile?.nickname ?? t('me.noNickname')}
              </p>
              <p className="truncate text-[12.5px] text-ink-500">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/onboarding?edit=1')}
              className="btn-outline !px-3 !py-1.5 text-[13px]"
            >
              {t('me.edit')}
            </button>
          </div>

          {profile && (
            <>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {knownTasteTags(profile.taste_tags).length === 0 ? (
                  <span className="hint">{t('me.noTasteTags')}</span>
                ) : (
                  knownTasteTags(profile.taste_tags).map((t) => (
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
          <h2 className="section-title mb-3">{t('me.share')}</h2>
          <ul className="card divide-y divide-ink-100">
            <li>
              <Link
                to="/me/plans"
                className="flex items-center justify-between px-4 py-3.5 text-[14px] font-semibold text-ink-700"
              >
                {t('me.myPlans')}
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
                  {t('me.adminPlans')}
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
                  {t('me.adminPlaces')}
                  <span aria-hidden className="text-ink-300">
                    ›
                  </span>
                </Link>
              </li>
            )}
          </ul>
        </section>

        <section className="mb-6">
          <LanguagePicker />
        </section>

        <section className="mb-6">
          <h2 className="section-title mb-3">{t('me.integrations')}</h2>
          <ul className="card divide-y divide-ink-100">
            <StatusRow label={t('me.supabase')} ok={isSupabaseConfigured} envKey="VITE_SUPABASE_URL" />
            <StatusRow
              label={t('me.naverMap')}
              ok={isNaverMapConfigured}
              envKey="VITE_NAVER_MAP_CLIENT_ID"
            />
          </ul>
        </section>

        <button type="button" onClick={signOut} className="btn-ghost w-full">
          {t('me.signOut')}
        </button>
      </div>
    </>
  )
}

function StatusRow({ label, ok, envKey }: { label: string; ok: boolean; envKey: string }) {
  const { t } = useI18n()
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-ink-800">{label}</span>
        <code className="text-[11.5px] text-ink-400">{envKey}</code>
      </span>
      <span className={`badge ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}`}>
        {ok ? t('me.connected') : t('me.demoMode')}
      </span>
    </li>
  )
}

/** 화면 언어 고르기 — 회원은 프로필에, 비회원은 이 브라우저에 기억(I18nProvider) */
function LanguagePicker() {
  const { t, lang, setLang } = useI18n()
  return (
    <div>
      <h2 className="section-title mb-3">{t('me.language')}</h2>
      <div className="flex gap-2" role="radiogroup" aria-label={t('me.language')}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={lang === l.code}
            onClick={() => void setLang(l.code)}
            className={lang === l.code ? 'chip-on' : 'chip-off'}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="hint mt-2">{t('me.languageHint')}</p>
    </div>
  )
}
