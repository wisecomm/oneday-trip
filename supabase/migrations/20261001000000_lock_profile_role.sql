-- =====================================================================
-- 권한 상승 차단 — profiles.role 을 API 로 바꿀 수 없게 한다
--
-- 20260924000000 에서 profiles 에 role 을 추가하면서, 기존 정책이
--
--   create policy "own profile" on public.profiles for all
--     using (auth.uid() = id) with check (auth.uid() = id);
--
-- 로 자기 행 '전체'를 열어 둔다는 점을 놓쳤다. 그래서 로그인한 누구나
--
--   update profiles set role = 'admin' where id = <자기 uuid>
--
-- 한 줄로 관리자가 될 수 있었다. 가입하면서 role='admin' 으로 프로필을
-- 만드는 것도 가능했다. is_admin() 에 기대는 모든 장치 — 운영자 플랜 작성,
-- places 직접 쓰기, 등록 요청 승인, 남의 플랜 숨김 — 가 통째로 무력화된다.
--
-- 문서 7-D6: "관리자 지정은 화면으로 만들지 않는다. SQL 로 직접 role 을
-- 바꾼다." 그 의도를 DB 가 강제하게 만든다.
-- =====================================================================

-- ── 1. 컬럼 권한 ─────────────────────────────────────────────────────
-- 컬럼 단위 revoke 만으로는 소용이 없다. 테이블 단위 update 권한이 모든
-- 컬럼을 덮기 때문에, 먼저 테이블 권한을 회수하고 쓸 컬럼만 다시 준다.
revoke update on public.profiles from anon, authenticated;
revoke insert on public.profiles from anon, authenticated;

grant update (nickname, taste_tags) on public.profiles to authenticated;
grant insert (id, nickname, taste_tags) on public.profiles to authenticated;

-- ── 2. 트리거 ────────────────────────────────────────────────────────
-- 컬럼 권한만으로는 부족하다. Supabase 의 기본 권한이나 누군가의
-- `grant all on all tables` 한 줄에 다시 열릴 수 있기 때문이다. 실제
-- 보증은 이 트리거다.
--
-- security definer 로 만들면 안 된다. 정의자 권한 함수 안에서는
-- current_user 가 호출자가 아니라 함수 소유자(postgres)가 되어, 판정이
-- 항상 통과해 버린다. 호출자의 역할을 봐야 하므로 invoker 로 둔다.
--
-- 판정 기준을 is_admin() 으로 두지 않는 이유: 그러면 관리자가 API 로 다른
-- 사람을 승격시킬 수 있고, 관리자 계정 하나가 뚫리면 거기서 번진다.
-- 역할 변경은 SQL(대시보드/마이그레이션)에서만 — 즉 PostgREST 가 쓰는
-- anon·authenticated 역할로 들어온 요청은 전부 거부한다.
create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;                       -- postgres / service_role 은 통과
  end if;

  if tg_op = 'INSERT' then
    -- 가입 시 role 을 실어 보내도 무시하고 'user' 로 만든다. 오류를 내는
    -- 대신 조용히 낮추는 쪽이 낫다 — 정상 가입을 막지 않는다.
    new.role := 'user';
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception '역할은 API 로 바꿀 수 없습니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_role();
