import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * .env 에 Supabase 자격 증명이 없으면 앱은 로컬 데모 모드(localStorage)로 동작한다.
 * 자격 증명이 채워지면 동일한 화면이 그대로 실제 Supabase 백엔드에 연결된다.
 * (데이터 접근 분기는 lib/db.ts, 인증 분기는 lib/auth.tsx 에서 처리)
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null

/** null 체크를 매번 하지 않기 위한 헬퍼 — 설정된 경우에만 호출할 것 */
export function db(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}
