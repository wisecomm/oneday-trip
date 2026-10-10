import type { MessageKey } from './ko'

/**
 * English — Claude 초안, 사람 검수 전(intent/2026-10-10-다국어/계획.md 의 검수 목록).
 * 빠진 키는 한국어로 보인다.
 */
export const en: Partial<Record<MessageKey, string>> = {
  'nav.home': 'Home',
  'nav.map': 'Map',
  'nav.recommend': 'Picks',
  'nav.trips': 'Trips',
  'nav.me': 'My',
  'app.demoBanner':
    'Demo mode — Supabase environment variables (VITE_SUPABASE_URL, etc.) are missing from this build. Check .env locally, or the hosting service settings when deployed.',

  'me.title': 'My',
  'me.loginRequired': 'Please sign in',
  'me.loginRequiredDesc': 'Sign up to save your trips and reviews.',
  'me.loginOrSignup': 'Sign in / Sign up',
  'me.noNickname': 'No nickname yet',
  'me.edit': 'Edit',
  'me.noTasteTags': 'No interest tags yet',
  'me.share': 'Sharing',
  'me.myPlans': 'Courses I shared',
  'me.adminPlans': 'Manage courses (admin)',
  'me.adminPlaces': 'Manage places (admin)',
  'me.integrations': 'Connections',
  'me.supabase': 'Supabase backend',
  'me.naverMap': 'Naver Maps SDK',
  'me.connected': 'Connected',
  'me.demoMode': 'Demo mode',
  'me.signOut': 'Sign out',
  'me.language': 'Language',
  'me.languageHint': 'App language. Place names and descriptions are still shown in Korean.',
}
