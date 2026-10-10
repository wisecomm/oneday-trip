-- 다국어 1단계 — 사용자 언어 설정
--
-- 화면 언어를 회원마다 기억한다(intent/2026-10-10-다국어/계획.md). 지금은 한국어 · 영어 두 가지.
-- 비회원은 브라우저에만 기억한다(localStorage) — DB 칸은 회원 것.
--
-- profiles 는 테이블 단위 update · insert 권한을 회수하고 쓸 칸만 다시 준다(role 을 API 로 못 바꾸게).
-- 새 칸도 같은 방식으로 연다 — 칸 단위 grant 를 더하지 않으면 앱이 이 칸을 못 쓴다.
alter table public.profiles
  add column language text not null default 'ko'
  check (language in ('ko', 'en'));

grant update (language) on public.profiles to authenticated;
grant insert (language) on public.profiles to authenticated;
