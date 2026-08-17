import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { isSupabaseConfigured, supabase } from './supabase'
import { profiles } from './db'
import { uid } from './local-store'
import type { Profile } from './types'

/**
 * SYS-01-01 인증 컨텍스트.
 * Supabase 가 설정되면 supabase.auth 를, 아니면 localStorage 기반 데모 세션을 사용한다.
 */

export interface SessionUser {
  id: string
  email: string | null
  /** 소셜 가입 시 자동 연동된 닉네임 (SYS-01-01 비고) */
  suggestedNickname: string | null
}

interface AuthValue {
  user: SessionUser | null
  profile: Profile | null
  loading: boolean
  /** Guest 모드로 서비스 둘러보기 중인지 여부 */
  isGuest: boolean
  signInWithGoogle: () => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<void>
  signInWithEmail: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  continueAsGuest: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const DEMO_SESSION_KEY = 'oneday-trip:session'
const GUEST_KEY = 'oneday-trip:guest'

function readDemoSession(): SessionUser | null {
  try {
    const raw = localStorage.getItem(DEMO_SESSION_KEY)
    return raw ? (JSON.parse(raw) as SessionUser) : null
  } catch {
    return null
  }
}

function writeDemoSession(user: SessionUser | null) {
  if (user) localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(user))
  else localStorage.removeItem(DEMO_SESSION_KEY)
}

/** 이메일 로컬파트에서 닉네임 후보를 만든다 */
function nicknameFromEmail(email: string | null): string | null {
  if (!email) return null
  return email.split('@')[0].replace(/[._-]/g, ' ').slice(0, 12)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [isGuest, setIsGuest] = useState(() => localStorage.getItem(GUEST_KEY) === '1')

  const loadProfile = useCallback(async (u: SessionUser | null) => {
    if (!u) {
      setProfile(null)
      return
    }
    try {
      setProfile(await profiles.get(u.id))
    } catch {
      setProfile(null)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.auth.getSession()
        const s = data.session
        const next: SessionUser | null = s
          ? {
              id: s.user.id,
              email: s.user.email ?? null,
              suggestedNickname:
                (s.user.user_metadata?.full_name as string | undefined) ??
                (s.user.user_metadata?.name as string | undefined) ??
                nicknameFromEmail(s.user.email ?? null),
            }
          : null
        if (cancelled) return
        setUser(next)
        await loadProfile(next)
        setLoading(false)

        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          const u: SessionUser | null = session
            ? {
                id: session.user.id,
                email: session.user.email ?? null,
                suggestedNickname:
                  (session.user.user_metadata?.full_name as string | undefined) ??
                  (session.user.user_metadata?.name as string | undefined) ??
                  nicknameFromEmail(session.user.email ?? null),
              }
            : null
          setUser(u)
          void loadProfile(u)
        })
        return () => sub.subscription.unsubscribe()
      }

      // 데모 모드
      const demo = readDemoSession()
      if (cancelled) return
      setUser(demo)
      await loadProfile(demo)
      setLoading(false)
      return undefined
    }

    const cleanup = bootstrap()
    return () => {
      cancelled = true
      void cleanup.then((fn) => fn?.())
    }
  }, [loadProfile])

  const clearGuest = useCallback(() => {
    localStorage.removeItem(GUEST_KEY)
    setIsGuest(false)
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      })
      if (error) throw error
      return
    }
    // 데모 모드: 소셜 인증을 모사한다
    const demoUser: SessionUser = {
      id: uid('user'),
      email: 'demo.traveler@gmail.com',
      suggestedNickname: '여행자',
    }
    writeDemoSession(demoUser)
    clearGuest()
    setUser(demoUser)
    await loadProfile(demoUser)
  }, [clearGuest, loadProfile])

  const signUpWithEmail = useCallback(
    async (email: string, password: string) => {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        return
      }
      const demoUser: SessionUser = {
        id: uid('user'),
        email,
        suggestedNickname: nicknameFromEmail(email),
      }
      writeDemoSession(demoUser)
      clearGuest()
      setUser(demoUser)
      await loadProfile(demoUser)
    },
    [clearGuest, loadProfile],
  )

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      if (isSupabaseConfigured && supabase) {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        return
      }
      // 데모 모드에는 비밀번호 검증이 없다 — 동일 이메일이면 기존 세션을 재사용한다
      const existing = readDemoSession()
      const demoUser: SessionUser =
        existing?.email === email
          ? existing
          : { id: uid('user'), email, suggestedNickname: nicknameFromEmail(email) }
      writeDemoSession(demoUser)
      clearGuest()
      setUser(demoUser)
      await loadProfile(demoUser)
    },
    [clearGuest, loadProfile],
  )

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured && supabase) await supabase.auth.signOut()
    else writeDemoSession(null)
    clearGuest()
    setUser(null)
    setProfile(null)
  }, [clearGuest])

  const continueAsGuest = useCallback(() => {
    localStorage.setItem(GUEST_KEY, '1')
    setIsGuest(true)
  }, [])

  const refreshProfile = useCallback(() => loadProfile(user), [loadProfile, user])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      profile,
      loading,
      isGuest,
      signInWithGoogle,
      signUpWithEmail,
      signInWithEmail,
      signOut,
      continueAsGuest,
      refreshProfile,
    }),
    [
      user,
      profile,
      loading,
      isGuest,
      signInWithGoogle,
      signUpWithEmail,
      signInWithEmail,
      signOut,
      continueAsGuest,
      refreshProfile,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
