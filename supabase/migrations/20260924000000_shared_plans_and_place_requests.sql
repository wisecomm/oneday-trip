-- =====================================================================
-- 공용 여행 플랜 (SHARE-06) · 장소 등록 (PLACE-07)
--
-- 근거: intent/2026-09-20-플랜-공유/intent.md  (열린 질문 15건 전부 종결)
--
-- 이 마이그레이션이 하는 일
--   1. 역할(profiles.role)과 is_admin()
--   2. places 에 출처 구분 — source / created_by (연동 행과 수동 행)
--   3. 공용 플랜 3종 — shared_plans / shared_plan_items / plan_reports
--   4. 장소 등록 요청 — place_requests (승인 전 값이 머무는 곳)
--   5. 담기·승인 RPC 와 RLS
--
-- 이 마이그레이션이 하지 않는 일
--   · 기존 TourAPI 행을 건드리지 않는다. places 의 select 정책도 그대로 둔다
--     (미승인 장소는 places 가 아니라 place_requests 에 있으므로 가릴 것이 없다).
-- =====================================================================

-- ── 1. 열거형 ────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

-- 장소의 출처. region_source_kind 와 혼동하면 안 된다 — 그쪽은 '지역을 어떻게
-- 판정했는가'이고, 이쪽은 '이 장소가 어디서 왔는가'다. 관리자가 TourAPI 장소의
-- 구만 고쳐도 region_source 는 'manual' 이 되지만 source 는 'tour' 그대로다.
do $$ begin
  create type place_source_kind as enum ('tour', 'manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_origin as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type plan_hidden_reason as enum ('reported', 'place_removed', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type place_request_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ── 2. 역할과 is_admin() ─────────────────────────────────────────────
alter table public.profiles
  add column if not exists role user_role not null default 'user';

-- security definer 여야 하는 이유: RLS 정책 안에서 profiles 를 다시 select 하면
-- profiles 자신의 RLS 가 또 평가되면서 무한 재귀로 막힌다. 정의자 권한으로 도는
-- 함수로 감싸 그 고리를 끊는다. search_path 를 고정하지 않으면 호출자가 만든
-- 동명 객체를 타고 들어올 수 있다.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- 관리자 지정 화면은 만들지 않는다. 임명 화면 자체가 가장 위험한 공격면이고,
-- 관리자 수가 한 자릿수인 단계에서는 SQL 한 줄이 맞다:
--   update public.profiles set role = 'admin' where id = '<uuid>';

-- ── 3. places 의 출처 구분 ───────────────────────────────────────────
alter table public.places
  add column if not exists source place_source_kind not null default 'tour';

alter table public.places
  add column if not exists created_by uuid references auth.users on delete set null;

-- 수동 등록 행만 모아 보는 관리자 화면용. 전체의 극히 일부라 부분 인덱스로 둔다.
create index if not exists places_manual_idx
  on public.places (source)
  where source = 'manual'::place_source_kind;

-- 수동 등록 id 는 'm-000001' 꼴이다. TourAPI contentid 는 6~7자리 숫자뿐이라
-- 접두사만으로 충돌이 구조적으로 불가능하다. 다만 실제 안전장치는 이 규약이
-- 아니라 수집 배치 쪽 `on conflict ... where places.source = 'tour'` 다.
create sequence if not exists public.manual_place_seq;

-- ── 4. 공용 플랜 ─────────────────────────────────────────────────────
-- trips 에 is_public 플래그를 다는 방식을 쓰지 않는 이유는 둘이다.
--   · trip_date·companions·note·rating 이 통째로 따라 나간다. 공개하려는 건
--     동선이지 일기가 아니다.
--   · 운영자 플랜에는 애초에 원본 여행이 없다. 플래그 구조로는 표현할 수 없다.
create table if not exists public.shared_plans (
  id                 uuid primary key default gen_random_uuid(),
  origin             plan_origin not null,
  -- origin='admin' 이면 null 이고 화면은 '운영자'로 고정 표시한다
  author_user_id     uuid references auth.users on delete cascade,
  title              text not null check (char_length(title) between 2 and 60),
  -- 설명은 선택이 아니라 필수다. 운영자 큐레이션 플랜은 사실상 이 칸이 본체라
  -- 선택값으로 두면 빈 채로 올라간다.
  description        text not null check (char_length(description) between 5 and 500),
  tour_area_code     smallint not null references public.region_groups(tour_area_code),
  -- null 이면 '시/도 전체'. 미판정(-1)은 여기 오지 않는다 — 사람이 고른 값이다.
  tour_sigungu_code  smallint,
  transport          transport_type not null default 'transit',
  companions         text[] not null default '{}'
    constraint shared_plans_companions_valid
    check (companions <@ array['solo', 'couple', 'friends', 'family', 'pet']::text[]),
  start_time         time not null default '09:00',
  end_time           time not null default '20:00',
  -- trip_date 대신 들어가는 값. 특정 날짜는 위치 이력이 된다.
  weekday            smallint check (weekday between 0 and 6),
  season             text check (season in ('spring', 'summer', 'autumn', 'winter')),
  -- 리스트 카드용 비정규화 값
  place_count        smallint not null default 0 check (place_count >= 0),
  duration_minutes   integer,
  -- 원본 여행에 visited 항목이 있었는지. 스냅샷이므로 올릴 때 한 번 계산해 넣는다.
  -- 원본을 다시 조회해 알아낼 수는 없다 — 남의 trips 는 관리자도 못 읽는다.
  was_visited        boolean not null default false,
  clone_count        integer not null default 0 check (clone_count >= 0),
  is_hidden          boolean not null default false,
  hidden_reason      plan_hidden_reason,
  -- 원본 여행(있을 때). 갱신 배너 판정용이고, 원본이 지워져도 플랜은 남는다.
  source_trip_id     uuid references public.trips on delete set null,
  source_updated_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint shared_plans_author_matches_origin check (
    (origin = 'admin' and author_user_id is null) or
    (origin = 'user'  and author_user_id is not null)
  ),
  -- 복합 FK 는 MATCH SIMPLE 이라 sigungu 가 null 이면 검사를 건너뛴다.
  -- 그래서 '시/도 전체'는 통과하고 구를 지정한 경우에만 검증된다.
  constraint shared_plans_region_fkey foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);

create index if not exists shared_plans_browse_idx
  on public.shared_plans (tour_area_code, tour_sigungu_code, clone_count desc)
  where is_hidden = false;

create index if not exists shared_plans_recent_idx
  on public.shared_plans (created_at desc)
  where is_hidden = false;

create index if not exists shared_plans_author_idx
  on public.shared_plans (author_user_id);

create index if not exists shared_plans_source_trip_idx
  on public.shared_plans (source_trip_id);

-- trip_items 와 같은 모양이다. 개인 기록(status·note·rating)만 빠지고 공개용
-- 한 줄 팁이 들어간다. 같은 모양이라야 올리기/담기가 대칭 변환이 된다.
create table if not exists public.shared_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.shared_plans on delete cascade,
  place_id     text not null references public.places on delete cascade,
  sort_order   smallint not null default 0,
  planned_time time,
  tip          text check (tip is null or char_length(tip) <= 120),
  created_at   timestamptz not null default now()
);

create index if not exists shared_plan_items_plan_idx
  on public.shared_plan_items (plan_id, sort_order);

-- places 를 on delete cascade 로 참조한다. 인덱스가 없으면 장소를 한 행 지울
-- 때마다 이 테이블을 통째로 훑는다 — 재수집이 바로 그 경로를 탄다.
create index if not exists shared_plan_items_place_idx
  on public.shared_plan_items (place_id);

create table if not exists public.plan_reports (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.shared_plans on delete cascade,
  reporter_id uuid not null references auth.users on delete cascade,
  reason      text not null check (char_length(reason) between 2 and 300),
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  -- 혼자 세 번 눌러 남의 플랜을 내릴 수 없게 한다
  unique (plan_id, reporter_id)
);

create index if not exists plan_reports_open_idx
  on public.plan_reports (plan_id)
  where resolved = false;

-- ── 5. 장소 등록 요청 ────────────────────────────────────────────────
-- 사용자가 넣은 값은 승인 전까지 places 에 들어가지 않는다. 이 선택 덕분에
-- places 에 승인 상태 컬럼이 필요 없고, select 정책 using(true) 를 그대로
-- 둘 수 있다. 카탈로그에 있으면 공개된 것이다.
create table if not exists public.place_requests (
  id                uuid primary key default gen_random_uuid(),
  requester_id      uuid not null references auth.users on delete cascade,
  name              text not null check (char_length(name) between 1 and 60),
  category          place_category not null,
  address           text not null check (char_length(address) between 2 and 200),
  -- 지도에서 핀을 찍어 받는다. 주소 검색(지오코딩)은 쓰지 않는다 — 주소로
  -- 안 잡히는 새 가게·푸드트럭이 이 기능이 겨냥하는 대상이다.
  lat               double precision not null,
  lng               double precision not null,
  image_url         text,
  -- 요청자가 고른 값. 좌표에서 시군구를 되찾는 역지오코딩은 넣지 않는다.
  tour_area_code    smallint not null references public.region_groups(tour_area_code),
  tour_sigungu_code smallint not null,
  memo              text check (memo is null or char_length(memo) <= 200),
  status            place_request_status not null default 'pending',
  reject_reason     text,
  reviewed_by       uuid references auth.users on delete set null,
  reviewed_at       timestamptz,
  -- 승인 시 만들어진 places.id. 장소가 나중에 지워져도 요청 이력은 남긴다.
  created_place_id  text references public.places on delete set null,
  created_at        timestamptz not null default now(),

  constraint place_requests_region_fkey foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);

create index if not exists place_requests_queue_idx
  on public.place_requests (created_at)
  where status = 'pending'::place_request_status;

create index if not exists place_requests_requester_idx
  on public.place_requests (requester_id, created_at desc);

create index if not exists place_requests_created_place_idx
  on public.place_requests (created_place_id);

-- ── 6. 장소가 사라지면 그 플랜을 내린다 ──────────────────────────────
-- 항목만 조용히 지우면 3곳짜리 플랜이 2곳이 된 채 공개돼 있고 아무도 모른다.
-- 반대로 FK 를 restrict 로 걸면 재수집 배치가 장소를 못 지워 통째로 실패한다.
-- 카탈로그 갱신이 공유 기능 때문에 막히는 건 순서가 뒤바뀐 것이다.
-- 그래서 cascade 는 유지하고, 그렇게 사라졌을 때 부모를 내린다.
create or replace function public.shared_plan_items_hide_parent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 플랜 자체가 지워진 경우에는 매칭되는 행이 없어 아무 일도 하지 않는다
  update public.shared_plans
     set is_hidden     = true,
         hidden_reason = 'place_removed',
         place_count   = greatest(place_count - 1, 0),
         updated_at    = now()
   where id = old.plan_id
     and is_hidden = false;
  return old;
end;
$$;

drop trigger if exists shared_plan_items_place_removed on public.shared_plan_items;
create trigger shared_plan_items_place_removed
  after delete on public.shared_plan_items
  for each row execute function public.shared_plan_items_hide_parent();

-- ── 7. 신고 3건이면 자동으로 내린다 ──────────────────────────────────
-- 자동 숨김만 두고 복구는 자동화하지 않는다. 잘못 숨긴 플랜의 피해는
-- "안 보인다" 한 줄이고, 잘못 남겨 둔 플랜의 피해는 그걸 본 모든 사람에게
-- 간다. 사람이 붙어야 하는 쪽은 되살릴 때다.
create or replace function public.plan_reports_autohide()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  open_count integer;
  plan_origin_value plan_origin;
begin
  select origin into plan_origin_value
    from public.shared_plans where id = new.plan_id;

  -- 운영자 플랜은 신고를 받되 자동으로 내리지 않는다. 관리자 화면에만 올린다.
  if plan_origin_value = 'admin' then
    return new;
  end if;

  select count(*) into open_count
    from public.plan_reports
   where plan_id = new.plan_id and resolved = false;

  if open_count >= 3 then
    update public.shared_plans
       set is_hidden = true, hidden_reason = 'reported', updated_at = now()
     where id = new.plan_id and is_hidden = false;
  end if;

  return new;
end;
$$;

drop trigger if exists plan_reports_autohide_trigger on public.plan_reports;
create trigger plan_reports_autohide_trigger
  after insert on public.plan_reports
  for each row execute function public.plan_reports_autohide();

-- ── 8. 작성자 닉네임 노출 ────────────────────────────────────────────
-- profiles 에 using(true) select 정책을 그냥 열면 안 된다. 거기엔 taste_tags
-- (취향 이력)가 같이 있고, RLS 는 행 단위라 컬럼을 가려 주지 않는다. 정책
-- 하나를 여는 순간 가입자 전원의 닉네임과 취향을 긁을 수 있게 된다.
--
-- 그래서 뷰 하나만 공개한다. 노출 범위는 '공개된 플랜을 하나 이상 올린 사용자'
-- 로 좁혀지고, taste_tags 는 애초에 뷰에 없다. 뷰는 소유자 권한으로 돌아
-- profiles 의 RLS 를 통과한다(security_invoker 를 켜지 않는다).
create or replace view public.public_profiles as
  select p.id, p.nickname
    from public.profiles p
   where exists (
     select 1 from public.shared_plans sp
      where sp.author_user_id = p.id
        and sp.is_hidden = false
   );

grant select on public.public_profiles to anon, authenticated;

-- ── 9. 담기 (복제) ───────────────────────────────────────────────────
-- 인기순 정렬에 clone_count 가 필요한데 RLS 아래에서 사용자는 남의 행을
-- update 할 수 없다. 클라이언트가 update 를 시도하다 조용히 실패하는 구조를
-- 만들지 않기 위해, 담기와 카운트를 한 함수 안에서 처리한다.
create or replace function public.clone_shared_plan(
  p_plan_id   uuid,
  p_trip_date date,
  p_title     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  public.shared_plans%rowtype;
  v_trip  uuid;
  v_user  uuid := auth.uid();
begin
  if v_user is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  select * into v_plan from public.shared_plans
   where id = p_plan_id and is_hidden = false;

  if not found then
    raise exception '플랜을 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  insert into public.trips
    (user_id, title, tour_area_code, tour_sigungu_code,
     trip_date, start_time, end_time, companions, transport)
  values
    (v_user, coalesce(p_title, v_plan.title), v_plan.tour_area_code,
     v_plan.tour_sigungu_code, p_trip_date, v_plan.start_time, v_plan.end_time,
     v_plan.companions, v_plan.transport)
  returning id into v_trip;

  -- status 는 전부 planned 로, note·rating 은 비운 채로 들어간다.
  -- 여행의 시작 시각을 플랜과 같게 잡았으므로 planned_time 은 그대로 옮긴다.
  insert into public.trip_items (trip_id, place_id, sort_order, planned_time)
  select v_trip, i.place_id, i.sort_order, i.planned_time
    from public.shared_plan_items i
   where i.plan_id = p_plan_id
   order by i.sort_order;

  update public.shared_plans
     set clone_count = clone_count + 1
   where id = p_plan_id;

  return v_trip;
end;
$$;

revoke all on function public.clone_shared_plan(uuid, date, text) from public;
grant execute on function public.clone_shared_plan(uuid, date, text) to authenticated;

-- ── 10. 장소 등록 요청 승인·거절 ─────────────────────────────────────
-- 요청을 읽고 places 에 넣고 요청 상태를 쓰는 것이 한 트랜잭션이어야 한다.
-- 중간에 끊기면 "승인은 됐는데 장소가 없는" 요청이 남는다.
create or replace function public.approve_place_request(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req      public.place_requests%rowtype;
  v_place_id text;
begin
  if not public.is_admin() then
    raise exception '관리자만 승인할 수 있습니다' using errcode = '42501';
  end if;

  select * into v_req from public.place_requests
   where id = p_request_id and status = 'pending';

  if not found then
    raise exception '대기 중인 요청이 아닙니다' using errcode = 'P0002';
  end if;

  v_place_id := 'm-' || lpad(nextval('public.manual_place_seq')::text, 6, '0');

  insert into public.places
    (id, name, category, tour_area_code, tour_sigungu_code, address, lat, lng,
     image_url, source, created_by, region_source)
  values
    (v_place_id, v_req.name, v_req.category, v_req.tour_area_code,
     v_req.tour_sigungu_code, v_req.address, v_req.lat, v_req.lng,
     v_req.image_url, 'manual', v_req.requester_id, 'manual');

  update public.place_requests
     set status = 'approved',
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         created_place_id = v_place_id
   where id = p_request_id;

  return v_place_id;
end;
$$;

revoke all on function public.approve_place_request(uuid) from public;
grant execute on function public.approve_place_request(uuid) to authenticated;

-- 거절해도 지우지 않는다. 같은 곳을 다시 요청할 때 "전에 이런 이유로
-- 거절됐다"를 보여 주기 위해서다. 요청을 고치는 건 안 되고 새로 내는 것만 된다.
create or replace function public.reject_place_request(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 거절할 수 있습니다' using errcode = '42501';
  end if;

  update public.place_requests
     set status = 'rejected',
         reject_reason = p_reason,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_request_id and status = 'pending';

  if not found then
    raise exception '대기 중인 요청이 아닙니다' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.reject_place_request(uuid, text) from public;
grant execute on function public.reject_place_request(uuid, text) to authenticated;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.shared_plans      enable row level security;
alter table public.shared_plan_items enable row level security;
alter table public.plan_reports      enable row level security;
alter table public.place_requests    enable row level security;

-- ── 공용 플랜 ────────────────────────────────────────────────────────
-- 내려간 플랜은 작성자와 관리자에게만 보인다. 링크를 받은 비로그인 사용자도
-- 공개된 플랜은 그대로 볼 수 있어야 한다 — 로그인 벽을 먼저 만나면 공유가
-- 성립하지 않는다.
drop policy if exists "public plans are readable" on public.shared_plans;
create policy "public plans are readable"
  on public.shared_plans for select
  using (
    is_hidden = false
    or author_user_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "authors and admins write plans" on public.shared_plans;
create policy "authors and admins write plans"
  on public.shared_plans for insert
  with check (
    (origin = 'user'  and author_user_id = auth.uid())
    or (origin = 'admin' and public.is_admin())
  );

drop policy if exists "authors and admins update plans" on public.shared_plans;
create policy "authors and admins update plans"
  on public.shared_plans for update
  using (author_user_id = auth.uid() or public.is_admin())
  with check (author_user_id = auth.uid() or public.is_admin());

drop policy if exists "authors and admins delete plans" on public.shared_plans;
create policy "authors and admins delete plans"
  on public.shared_plans for delete
  using (author_user_id = auth.uid() or public.is_admin());

-- 항목은 부모 플랜의 접근성을 따른다
drop policy if exists "plan items follow the plan" on public.shared_plan_items;
create policy "plan items follow the plan"
  on public.shared_plan_items for select
  using (
    exists (
      select 1 from public.shared_plans p
       where p.id = plan_id
         and (p.is_hidden = false or p.author_user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "plan items are written by the plan owner" on public.shared_plan_items;
create policy "plan items are written by the plan owner"
  on public.shared_plan_items for all
  using (
    exists (
      select 1 from public.shared_plans p
       where p.id = plan_id
         and (p.author_user_id = auth.uid() or public.is_admin())
    )
  )
  with check (
    exists (
      select 1 from public.shared_plans p
       where p.id = plan_id
         and (p.author_user_id = auth.uid() or public.is_admin())
    )
  );

-- ── 신고 ─────────────────────────────────────────────────────────────
drop policy if exists "own reports" on public.plan_reports;
create policy "own reports"
  on public.plan_reports for select
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "report as myself" on public.plan_reports;
create policy "report as myself"
  on public.plan_reports for insert
  with check (reporter_id = auth.uid());

drop policy if exists "admins resolve reports" on public.plan_reports;
create policy "admins resolve reports"
  on public.plan_reports for update
  using (public.is_admin())
  with check (public.is_admin());

-- ── 장소 등록 요청 ───────────────────────────────────────────────────
drop policy if exists "own place requests" on public.place_requests;
create policy "own place requests"
  on public.place_requests for select
  using (requester_id = auth.uid() or public.is_admin());

-- 요청은 언제나 pending 으로 시작한다. 클라이언트가 status 를 넣어 승인을
-- 건너뛰지 못하게 with check 에 박아 둔다.
drop policy if exists "request as myself" on public.place_requests;
create policy "request as myself"
  on public.place_requests for insert
  with check (requester_id = auth.uid() and status = 'pending');

-- 요청자는 자기 요청을 고칠 수 없다. 관리자가 보고 있는 값과 저장된 값이
-- 다르면 승인 버튼이 무엇을 승인한 것인지 알 수 없다. 고치려면 새로 요청한다.
drop policy if exists "admins review requests" on public.place_requests;
create policy "admins review requests"
  on public.place_requests for update
  using (public.is_admin())
  with check (public.is_admin());

-- ── places 쓰기 ──────────────────────────────────────────────────────
-- select 정책("places are readable by everyone")은 그대로 둔다. 미승인 장소는
-- place_requests 에 있으므로 읽기 쪽에서 가릴 것이 없다.
-- 사용자는 places 에 직접 쓰지 않는다 — 승인 함수(security definer)만 쓴다.
drop policy if exists "admins write places" on public.places;
create policy "admins write places"
  on public.places for insert
  with check (public.is_admin());

drop policy if exists "admins update places" on public.places;
create policy "admins update places"
  on public.places for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete places" on public.places;
create policy "admins delete places"
  on public.places for delete
  using (public.is_admin());
