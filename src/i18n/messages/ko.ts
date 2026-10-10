/**
 * 한국어 문구 — **키의 기준**. 새 문구는 여기에 먼저 넣고, 다른 언어(en.ts)는 이 키를 따른다.
 *
 * 키는 `화면.자리` (예: `me.signOut`). 값의 `{이름}` 은 t() 의 두 번째 인자로 채운다.
 * 다른 언어에 없는 키는 한국어로 보인다(빠진 번역은 i18n.test.ts 가 목록으로 알려 준다).
 *
 * 다국어 계획 · 결정: intent/2026-10-10-다국어/계획.md
 */
export const ko = {
  // 하단 탭 (AppLayout)
  'nav.home': '홈',
  'nav.map': '지도',
  'nav.recommend': '추천',
  'nav.trips': '내 여행',
  'nav.me': 'MY',
  'app.demoBanner':
    '데모 모드 — Supabase 환경변수(VITE_SUPABASE_URL 등)가 빌드에 없습니다. 로컬은 .env, 배포 환경은 호스팅 서비스의 환경변수 설정을 확인해 주세요',

  // MY (MyPage)
  'me.title': 'MY',
  'me.loginRequired': '로그인이 필요합니다',
  'me.loginRequiredDesc': '가입하면 여행 일정과 리뷰가 저장됩니다.',
  'me.loginOrSignup': '로그인 / 가입',
  'me.noNickname': '닉네임 미등록',
  'me.edit': '수정',
  'me.noTasteTags': '등록한 취향 태그가 없습니다',
  'me.share': '공유',
  'me.myPlans': '내가 올린 코스',
  'me.adminPlans': '운영자 코스 관리',
  'me.adminPlaces': '장소 등록 관리',
  'me.integrations': '연동 상태',
  'me.supabase': 'Supabase 백엔드',
  'me.naverMap': '네이버 지도 SDK',
  'me.connected': '연결됨',
  'me.demoMode': '데모 모드',
  'me.signOut': '로그아웃',
  'me.language': '언어',
  'me.languageHint': '화면 언어입니다. 장소 이름 · 소개는 아직 한국어로 보입니다.',
} as const

export type MessageKey = keyof typeof ko
