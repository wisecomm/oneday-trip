import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { profiles } from '@/lib/db'
import type { AppLanguage } from '@/lib/types'
import { ko, type MessageKey } from './messages/ko'
import { en } from './messages/en'

/*
 * 화면 문구 다국어(다국어 1단계 — intent/2026-10-10-다국어/계획.md).
 *
 *   const { t, lang, setLang } = useI18n()
 *   t('me.signOut')                     → '로그아웃' / 'Sign out'
 *   t('home.more', { n: 10 })           → 값 안의 {n} 을 채운다
 *
 * 언어는 회원이면 profiles.language, 비회원이면 이 브라우저(localStorage), 처음이면 브라우저 언어
 * (한국어면 ko, 아니면 en). 고르면 셋 다 맞춘다.
 */

export type { MessageKey }
export const LANGUAGES: readonly { code: AppLanguage; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
]

const DICTS: Record<AppLanguage, Partial<Record<MessageKey, string>>> = { ko, en }
const STORAGE_KEY = 'oneday-trip:lang'

type Vars = Record<string, string | number>

/** 키를 그 언어 문구로 — 없으면 한국어. React 밖(유틸 · 테스트)에서도 쓴다 */
export function translate(lang: AppLanguage, key: MessageKey, vars?: Vars): string {
  const text = DICTS[lang][key] ?? ko[key]
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

const isLanguage = (v: unknown): v is AppLanguage => v === 'ko' || v === 'en'

/** 처음 언어 — 이 브라우저에 고른 적이 있으면 그것, 없으면 브라우저 언어(한국어면 ko, 아니면 en) */
export function initialLanguage(): AppLanguage {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(saved)) return saved
  } catch {
    // 개인 정보 보호 모드 등 — 브라우저 언어로
  }
  const nav = typeof navigator === 'undefined' ? 'ko' : navigator.language.toLowerCase()
  return nav.startsWith('ko') ? 'ko' : 'en'
}

function remember(lang: AppLanguage) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // 저장 못 해도 이번 화면에서는 바뀐다
  }
}

interface I18nValue {
  lang: AppLanguage
  setLang: (next: AppLanguage) => Promise<void>
  t: (key: MessageKey, vars?: Vars) => string
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, profile, refreshProfile } = useAuth()
  const [lang, setLangState] = useState<AppLanguage>(initialLanguage)

  // 회원은 프로필 언어가 기준 — 다른 기기에서 바꿨으면 여기도 따른다
  useEffect(() => {
    if (profile && isLanguage(profile.language) && profile.language !== lang) {
      setLangState(profile.language)
      remember(profile.language)
    }
    // 프로필이 바뀔 때만 본다(lang 을 보면 고르는 순간 옛 프로필 값으로 되돌아간다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.language])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback(
    async (next: AppLanguage) => {
      setLangState(next)
      remember(next)
      if (user && profile) {
        try {
          await profiles.setLanguage(user.id, next)
          await refreshProfile()
        } catch (err) {
          // 저장에 실패해도 이 기기에서는 바뀐 언어로 쓴다
          console.error('[i18n] 언어를 프로필에 저장하지 못했습니다.', err)
        }
      }
    },
    [user, profile, refreshProfile],
  )

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext)
  if (!v) throw new Error('useI18n 은 I18nProvider 안에서만 쓸 수 있습니다')
  return v
}
