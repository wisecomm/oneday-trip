-- =====================================================================
-- 위치기반 여행 일정 및 맛집 지도 서비스 — Supabase 스키마
--
-- 이 파일은 supabase/migrations/ 를 전부 적용한 결과의 스냅샷이다.
-- 스키마를 바꿀 때는 migrations/ 에 타임스탬프 파일을 추가하고 이 파일도
-- 같은 내용으로 갱신한다.
-- =====================================================================

-- ── 확장 ────────────────────────────────────────────────────────────
-- 장소 이름 검색(ilike '%키워드%')이 인덱스를 타게 한다
create extension if not exists pg_trgm;

-- ── 열거형 ───────────────────────────────────────────────────────────
create type place_category   as enum ('babzip', 'cafe', 'sulzip', 'spot');
create type transport_type   as enum ('walk', 'transit', 'car');
create type trip_item_status as enum ('planned', 'visited');

-- 장소의 지역을 어느 순위로 판정했는지. 실패한 행을 성공 경로로 적어 두면
-- 리포트의 성공률이 부풀려지므로 'unresolved' 를 따로 둔다.
create type region_source_kind as enum (
  'tour',        -- 1순위: TourAPI 응답의 sigunguCode
  'addr',        -- 2순위: 주소에서 시군구명 매칭
  'geo',         -- 3순위: 좌표 → 행정구역 경계
  'manual',      -- 사람이 지정 — 재수집이 건드리지 않는다
  'unresolved'   -- 판정 실패 — 미판정 코드(-1)로 격리
);

create type user_role as enum ('user', 'admin');

-- 장소가 '어디서 왔는가'. region_source_kind('지역을 어떻게 판정했는가')와는
-- 다른 축이다. 관리자가 TourAPI 장소의 구만 고치면 region_source 는 'manual'
-- 이 되지만 source 는 'tour' 그대로다. 한 컬럼에 얹으면 "수동 등록만 보기"가
-- 영원히 부정확해진다.
create type place_source_kind    as enum ('tour', 'manual');
create type plan_origin          as enum ('admin', 'user');
create type plan_hidden_reason   as enum ('place_removed', 'admin');

-- ── SYS-01-02 사용자 프로필 ──────────────────────────────────────────
create table public.profiles (
  id                  uuid primary key references auth.users on delete cascade,
  nickname            text not null check (char_length(nickname) between 2 and 12),
  taste_tags          text[] not null default '{}',
  created_at          timestamptz not null default now(),
  -- 관리자 임명은 화면으로 만들지 않는다. 임명 화면 자체가 가장 위험한
  -- 공격면이고, 관리자 수가 한 자릿수인 단계에서는 SQL 한 줄이 맞다.
  -- (컬럼 순서가 created_at 뒤인 것은 마이그레이션이 alter table 로 붙였기
  --  때문이다. 이 파일은 적용 결과의 스냅샷이라 그 순서를 그대로 따른다)
  role                user_role not null default 'user'
);

-- RLS 정책 안에서 profiles 를 다시 select 하면 profiles 자신의 RLS 가 또
-- 평가되면서 무한 재귀로 막힌다. 정의자 권한 함수로 감싸 그 고리를 끊는다.
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

-- 역할을 API 로 바꿀 수 없게 한다.
--
-- "own profile" 정책은 자기 행 '전체'를 열어 준다. role 컬럼을 추가하면서
-- 이걸 놓쳐, 한때 로그인한 누구나 update profiles set role='admin' 한 줄로
-- 관리자가 될 수 있었다. is_admin() 에 기대는 모든 장치가 무력화된다.
--
-- 테이블 단위 update/insert 권한이 모든 컬럼을 덮으므로, 먼저 회수하고
-- 쓸 컬럼만 다시 준다. 컬럼 단위 revoke 만으로는 소용이 없다.
revoke update on public.profiles from anon, authenticated;
revoke insert on public.profiles from anon, authenticated;
grant update (nickname, taste_tags) on public.profiles to authenticated;
grant insert (id, nickname, taste_tags) on public.profiles to authenticated;

-- 권한이 누군가의 `grant all on all tables` 한 줄에 다시 열릴 수 있으므로
-- 실제 보증은 트리거다.
--
-- security definer 로 만들면 안 된다. 정의자 권한 함수 안에서는
-- current_user 가 호출자가 아니라 함수 소유자가 되어 판정이 항상 통과한다.
-- 판정 기준을 is_admin() 으로 두지도 않는다 — 그러면 관리자가 API 로 남을
-- 승격시킬 수 있고, 관리자 계정 하나가 뚫리면 거기서 번진다.
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

create trigger profiles_role_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_role();

-- ── 목적지 지역 (공개 읽기) ───────────────────────────────────────────
-- 키는 이름이 아니라 TourAPI 코드다. 이름을 키로 쓰면 '강서구'가 서울·부산에
-- 둘 다 있어 '부산 강서구'처럼 접두어를 붙여야 하고, 행정구역 개칭이 FK 연쇄가
-- 된다. 코드가 키면 name 은 update 한 번으로 바꿀 수 있는 단순 속성이 된다.
create table public.region_groups (
  -- TourAPI areaCode. 관광공사 자체 코드이지 행정표준코드가 아니라서
  -- 이름에 출처를 드러낸다.
  tour_area_code  smallint primary key,
  name            text not null unique,
  lat             double precision not null,
  lng             double precision not null,
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now()
);

create table public.regions (
  tour_area_code     smallint not null references public.region_groups(tour_area_code),
  -- sigunguCode 는 areaCode 안에서만 유일하다. 서울의 1과 부산의 1은 다른 구다.
  tour_sigungu_code  smallint not null,
  -- 접두어 없이 '성동구'. 같은 시/도 안에서만 유일하면 된다.
  name               text not null,
  -- 행정표준코드(법정동) lDongRegnCd + lDongSignguCd. TourAPI 목록 응답이
  -- 100% 채워 보내므로 받아 둔다 — 다른 데이터 소스와 맞추는 열쇠다.
  ldong_cd           text,
  lat                double precision not null,
  lng                double precision not null,
  sort_order         smallint not null default 0,
  created_at         timestamptz not null default now(),
  primary key (tour_area_code, tour_sigungu_code),
  unique (tour_area_code, name)
);

create index regions_group_idx on public.regions (tour_area_code, sort_order);

-- 판정에 실패한 장소는 버리지도, 가까운 구에 욱여넣지도 않는다. 시/도마다
-- (N, -1) 미판정 행을 두고 거기로 격리해 수동 처리 대기열로 쓴다. 시/도조차
-- 모르면 (-1, -1) 이다. 이 행들은 load.mjs 가 만든다.

-- ── MAP-04-01 장소 카탈로그 (공개 읽기) ──────────────────────────────
create table public.places (
  id                 text primary key,          -- TourAPI contentid
  name               text not null,
  category           place_category not null,
  tour_area_code     smallint not null,
  tour_sigungu_code  smallint not null,         -- 모르면 -1 (null 을 쓰지 않는다)
  address            text not null,
  lat                double precision not null,
  lng                double precision not null,
  image_url          text,
  tags               text[] not null default '{}',
  summary            text not null default '',
  open_hours         text not null default '',
  phone              text,
  -- TourAPI 목록의 modifiedtime. 재수집 때 "바뀐 것만 상세를 다시 받는" 근거다.
  source_modified_at text,
  region_source      region_source_kind not null default 'tour',
  region_note        text,                      -- 미판정 사유 한 줄
  created_at         timestamptz not null default now(),
  -- 연동 행(배치가 쓴다)과 수동 행(관리자 등록, 사용자 요청 승인)의 구분.
  -- 수동 행의 id 는 'm-000001' 꼴이다 — TourAPI contentid 는 6~7자리 숫자뿐이라
  -- 접두사만으로 충돌이 불가능하다. 다만 실제 안전장치는 이 규약이 아니라
  -- 수집 배치의 `on conflict ... where places.source = 'tour'` 다.
  -- (컬럼 순서는 위 profiles.role 과 같은 이유로 created_at 뒤다)
  source             place_source_kind not null default 'tour',
  created_by         uuid references auth.users on delete set null,
  -- 사용자 리뷰 별점의 평균과 개수 (플로챠트/홈.md). 리뷰가 바뀔 때 trip_items 트리거가 그 장소만 다시 계산하고, 평가가
  -- 없으면 rating_avg 는 0 이 아니라 null 이다. 장소 적재 upsert 는 두 칸을
  -- 건드리지 않는다. (컬럼 순서는 마이그레이션이 alter 로 붙인 그대로다)
  rating_avg         numeric(2,1) check (rating_avg between 1 and 5),
  rating_count       integer not null default 0 check (rating_count >= 0),
  -- TourAPI 원래 콘텐츠 타입(39 음식점 · 12 관광지 · 14 문화시설 · 28 레포츠 · 38 쇼핑 ·
  -- 32 숙박). 앱 분류는 category 가 정하고 이 칸은 출처를 남긴다 — 28 · 38 · 32 는
  -- category 'spot' 으로 명소에 함께 나온다. 수동 등록 행은 null. 허용 값 제약은 일부러
  -- 두지 않는다(타입을 늘릴 때 load.mjs 한 줄로 끝나게).
  content_type       smallint,
  -- TourAPI 에서 표출 중단(showflag 0)된 시각. null 이면 보인다. 숨긴 장소는 지도 ·
  -- 검색 · 추천 · 홈 후보에서만 빠지고, 이미 담긴 타임라인은 그대로 연다 — 행을 지우면
  -- trip_items 가 cascade 로 함께 지워진다. 표출이 재개되면 시드 upsert 가 null 로
  -- 되돌린다. (마이그레이션 alter 순서대로 끝)
  hidden_at          timestamptz,
  foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);

create index places_region_category_idx
  on public.places (tour_area_code, tour_sigungu_code, category);
create index places_unresolved_idx
  on public.places (region_source)
  where region_source = 'unresolved'::region_source_kind;
create index places_manual_idx
  on public.places (source)
  where source = 'manual'::place_source_kind;
-- 이름 검색용. ilike '%키워드%' 는 앞뒤가 열려 있어 B-tree 를 타지 못한다
create index places_name_trgm_idx on public.places using gin (name gin_trgm_ops);

create sequence public.manual_place_seq;

-- 지역 코드만 고쳐도 region_source 가 'manual' 로 바뀌게 한다. 관리자가 두
-- 가지를 기억해야 하는 구조는 언젠가 깨진다. 배치는
-- `set local app.region_batch = 'on'` 으로 이 트리거를 비껴간다.
create or replace function public.places_mark_region_manual()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.region_batch', true), '') <> 'on'
     and (new.tour_area_code    is distinct from old.tour_area_code
       or new.tour_sigungu_code is distinct from old.tour_sigungu_code)
  then
    new.region_source := 'manual';
    new.region_note   := null;
  end if;
  return new;
end;
$$;

create trigger places_region_manual
  before update on public.places
  for each row execute function public.places_mark_region_manual();

-- ── TRIP-02-01 / TRIP-02-02 여행 ─────────────────────────────────────
-- 컬럼 순서가 논리적 순서와 다른 이유: 이 파일은 마이그레이션을 전부 적용한
-- 결과의 스냅샷이고, 나중에 alter table 로 붙은 컬럼은 뒤에 쌓이기 때문이다.
-- 읽기 좋게 재배열하면 스냅샷이 실제 DB 와 어긋난다.
create table public.trips (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  title              text not null,
  -- 정의되지 않은 값이 들어가면 화면이 라벨을 찾지 못해 조용히 빈 칸이 된다.
  -- `<@` 는 포함 검사이고 빈 배열은 통과한다.
  companions         text[] not null default '{}'
    constraint trips_companions_valid
    check (companions <@ array['solo', 'couple', 'friends', 'family']::text[]),
  transport          transport_type not null default 'transit',
  created_at         timestamptz not null default now(),
  -- 당일치기 서비스이므로 기간이 아닌 날짜 하나를 갖는다
  trip_date          date not null,
  -- 하루 동선의 시작·종료 시각 (기본 09:00~20:00)
  start_time         time not null default '09:00',
  end_time           time not null default '20:00',
  tour_area_code     smallint not null references public.region_groups(tour_area_code),
  -- null 이면 '시/도 전체'. 사용자가 의도적으로 고른 값이지 '모름'이 아니다.
  -- (모름을 뜻하는 -1 은 places 에만 쓰이고 trips 에는 나타나지 않는다)
  tour_sigungu_code  smallint,
  -- 복합 FK 는 기본이 MATCH SIMPLE 이라 참조 컬럼 중 하나라도 null 이면 검사를
  -- 건너뛴다. 그래서 '전체' 선택은 통과하고 구를 지정한 경우에만 검증된다.
  constraint trips_region_fkey foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);
-- trips.source_plan_id 는 shared_plans 가 만들어진 뒤에 붙인다 (아래 SHARE-06 절).
-- 이 파일은 위에서 아래로 한 번에 적용되므로 순서가 곧 의존성이다.

create index trips_user_idx on public.trips (user_id, trip_date desc);

-- ── TRIP-03-01 타임라인 항목 (하루 안의 방문 순서) ───────────────────
create table public.trip_items (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips on delete cascade,
  place_id     text not null references public.places on delete cascade,
  sort_order   smallint not null default 0,
  planned_time time,
  status       trip_item_status not null default 'planned',
  created_at   timestamptz not null default now(),
  -- 방문 리뷰(소감 + 별점). 작성/수정만 있고 별도 이력은 남기지 않는다(덮어쓰기).
  -- 컬럼 순서가 created_at 뒤인 것은 나중에 alter 로 붙였기 때문이다.
  note         text,
  rating       smallint check (rating between 1 and 5)
);

create index trip_items_trip_idx on public.trip_items (trip_id, sort_order);
-- places 는 on delete cascade 로 참조된다. 인덱스가 없으면 장소를 한 행 지울
-- 때마다 이 테이블을 통째로 훑어 참조를 찾는다.
create index trip_items_place_idx on public.trip_items (place_id);

-- ── SHARE-06 공용 여행 플랜 ──────────────────────────────────────────
-- trips 에 is_public 플래그를 다는 방식을 쓰지 않는 이유는 둘이다.
--   · trip_date·companions·note·rating 이 통째로 따라 나간다. 공개하려는 건
--     동선이지 일기가 아니다.
--   · 운영자 플랜에는 애초에 원본 여행이 없다. 플래그 구조로는 표현할 수 없다.
create table public.shared_plans (
  id                 uuid primary key default gen_random_uuid(),
  origin             plan_origin not null,
  -- origin='admin' 이면 null 이고 화면은 '운영자'로 고정 표시한다
  author_user_id     uuid references auth.users on delete cascade,
  title              text not null check (char_length(title) between 2 and 60),
  -- 설명은 필수다. 운영자 큐레이션 플랜은 사실상 이 칸이 본체라 선택값으로
  -- 두면 빈 채로 올라간다.
  description        text not null check (char_length(description) between 5 and 500),
  tour_area_code     smallint not null references public.region_groups(tour_area_code),
  -- null 이면 '시/도 전체'. 미판정(-1)은 여기 오지 않는다 — 사람이 고른 값이다.
  tour_sigungu_code  smallint,
  transport          transport_type not null default 'transit',
  companions         text[] not null default '{}'
    constraint shared_plans_companions_valid
    check (companions <@ array['solo', 'couple', 'friends', 'family']::text[]),
  start_time         time not null default '09:00',
  end_time           time not null default '20:00',
  -- trip_date 대신 들어가는 값. 특정 날짜는 위치 이력이 된다.
  weekday            smallint check (weekday between 0 and 6),
  season             text check (season in ('spring', 'summer', 'autumn', 'winter')),
  place_count        smallint not null default 0 check (place_count >= 0),
  duration_minutes   integer,
  -- 원본 여행에 visited 항목이 있었는지. 스냅샷이라 올릴 때 한 번 계산해 넣는다.
  -- 나중에 원본을 조회해 알아낼 수는 없다 — 남의 trips 는 관리자도 못 읽는다.
  was_visited        boolean not null default false,
  clone_count        integer not null default 0 check (clone_count >= 0),
  is_hidden          boolean not null default false,
  hidden_reason      plan_hidden_reason,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- 만족도 집계(14-2). 평가가 없으면 0 이 아니라 null 이다 — 0 이면
  -- '평가 없음'과 '최하점'이 구분되지 않는다. places.source_rating(지금은
  -- 삭제)에서 이미 겪었다. (컬럼 순서가 끝인 것은 마이그레이션이 alter 로 붙였기
  --  때문이다. 이 파일은 적용 결과의 스냅샷이라 그 순서를 따른다)
  rating_avg         numeric(2,1),
  rating_count       integer not null default 0,

  constraint shared_plans_author_matches_origin check (
    (origin = 'admin' and author_user_id is null) or
    (origin = 'user'  and author_user_id is not null)
  ),
  constraint shared_plans_region_fkey foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);

create index shared_plans_browse_idx
  on public.shared_plans (tour_area_code, tour_sigungu_code, clone_count desc)
  where is_hidden = false;
create index shared_plans_recent_idx
  on public.shared_plans (created_at desc)
  where is_hidden = false;
create index shared_plans_author_idx on public.shared_plans (author_user_id);

-- trip_items 와 같은 모양이다. 개인 기록(status·note·rating)만 빠지고 공개용
-- 한 줄 팁이 들어간다. 같은 모양이라야 올리기/담기가 대칭 변환이 된다.
create table public.shared_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references public.shared_plans on delete cascade,
  place_id     text not null references public.places on delete cascade,
  sort_order   smallint not null default 0,
  planned_time time,
  tip          text check (tip is null or char_length(tip) <= 120),
  created_at   timestamptz not null default now()
);

create index shared_plan_items_plan_idx on public.shared_plan_items (plan_id, sort_order);
create index shared_plan_items_place_idx on public.shared_plan_items (place_id);

-- 담아 온 플랜. on delete set null 이라 플랜이 지워져도 여행은 남는다 —
-- 담기는 복제이지 참조가 아니다(7-D4). 이 값은 출처 표시와 '담은 사람만
-- 평가'(14-2) 판정에 쓴다. 없으면 누가 담았는지 알 수 없어 담지도 않은
-- 사람의 별점을 막을 방법이 없다.
alter table public.trips
  add column source_plan_id uuid references public.shared_plans on delete set null;
create index trips_source_plan_idx on public.trips (source_plan_id);

-- 이 여행을 공유해 만든 추천 코스 (Q23). 연결을 비공개 쪽(trips)에 둔다 —
-- 공개 행(shared_plans)에 개인 여행 id 를 싣지 않는다는 7-D1 원칙 때문에
-- 반대 방향 연결(source_trip_id)은 20261001010000 에서 뺐다. 코스가 지워지면
-- null 이 되어 '추천 코스 공유' 버튼이 다시 나타난다.
alter table public.trips
  add column published_plan_id uuid references public.shared_plans on delete set null;
create index trips_published_plan_idx on public.trips (published_plan_id);

-- ── SHARE-06-07 플랜 만족도 ─────────────────────────────────────────
create table public.plan_ratings (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.shared_plans on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  -- 한 줄 소감. 별점만 있으면 왜 그런지 다음 사람이 알 수 없다.
  comment    text check (comment is null or char_length(comment) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 한 사람이 한 플랜에 한 번. 여러 번 담아도 평가는 하나다.
  unique (plan_id, user_id)
);

create index plan_ratings_plan_idx on public.plan_ratings (plan_id);
create index plan_ratings_user_idx on public.plan_ratings (user_id);

-- security definer 여야 하는 이유: 평가자는 남의 shared_plans 행을 update 할
-- 권한이 없다. 호출자 권한으로 돌면 RLS 에 막혀 집계가 조용히 갱신되지
-- 않는다 — 오류도 나지 않아 한참 뒤에야 알게 된다.
create or replace function public.plan_ratings_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  update public.shared_plans p
     set rating_count = agg.n,
         -- 평가가 없으면 0 이 아니라 null 이다. 0 으로 두면 '평가 없음'과
         -- '최하점'이 구분되지 않는다 — places.source_rating 에서 이미 겪었다.
         rating_avg   = case when agg.n = 0 then null else round(agg.avg, 1) end,
         updated_at   = now()
    from (
      select count(*)::integer as n, avg(rating)::numeric as avg
        from public.plan_ratings where plan_id = v_plan
    ) agg
   where p.id = v_plan;
  return null;
end;
$$;

create trigger plan_ratings_refresh_trigger
  after insert or update or delete on public.plan_ratings
  for each row execute function public.plan_ratings_refresh();

-- ── 장소가 사라지면 그 플랜을 내린다 ────────────────────────────────
-- 항목만 조용히 지우면 3곳짜리 플랜이 2곳이 된 채 공개돼 있고 아무도 모른다.
-- 반대로 FK 를 restrict 로 걸면 재수집 배치가 장소를 못 지워 통째로 실패한다.
-- 카탈로그 갱신이 공유 기능 때문에 막히는 건 순서가 뒤바뀐 것이다.
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

create trigger shared_plan_items_place_removed
  after delete on public.shared_plan_items
  for each row execute function public.shared_plan_items_hide_parent();

-- ── 담기 (복제) ─────────────────────────────────────────────────────
-- 인기순 정렬에 clone_count 가 필요한데 RLS 아래에서 사용자는 남의 행을
-- update 할 수 없다. 클라이언트가 update 를 시도하다 조용히 실패하는 구조를
-- 만들지 않기 위해 담기와 카운트를 한 함수 안에서 처리한다.
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
     trip_date, start_time, end_time, companions, transport, source_plan_id)
  values
    (v_user, coalesce(p_title, v_plan.title), v_plan.tour_area_code,
     v_plan.tour_sigungu_code, p_trip_date, v_plan.start_time, v_plan.end_time,
     v_plan.companions, v_plan.transport, p_plan_id)
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

-- ── 관리자 직접 등록 ────────────────────────────────────────────────
-- 클라이언트가 id 를 만들게 두지 않는다. 'm-000001' 규약과 시퀀스의 주인이
-- 둘이 되면 번호가 어긋난다. 지금은 이 함수가 유일한 수동 등록 경로이지만,
-- manual_place_seq 를 함수 안에서만 돌리는 규약은 그대로 지킨다.
--
-- 지역 코드를 integer 로 받는 이유: PostgREST 는 JSON 숫자를 integer 로
-- 넘기므로 smallint 로 선언하면 함수를 찾지 못할 수 있다.
create or replace function public.admin_create_place(
  p_name              text,
  p_category          place_category,
  p_address           text,
  p_lat               double precision,
  p_lng               double precision,
  p_tour_area_code    integer,
  p_tour_sigungu_code integer,
  p_image_url         text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_place_id text;
begin
  if not public.is_admin() then
    raise exception '관리자만 장소를 등록할 수 있습니다' using errcode = '42501';
  end if;

  -- 미판정(-1)은 판정에 실패한 수집 행을 격리하는 자리다. 사람이 고른
  -- 지역에는 나타날 수 없다.
  if p_tour_sigungu_code < 0 then
    raise exception '시군구를 골라 주세요' using errcode = '22023';
  end if;

  v_place_id := 'm-' || lpad(nextval('public.manual_place_seq')::text, 6, '0');

  insert into public.places
    (id, name, category, tour_area_code, tour_sigungu_code, address, lat, lng,
     image_url, source, created_by, region_source)
  values
    (v_place_id, p_name, p_category, p_tour_area_code::smallint,
     p_tour_sigungu_code::smallint, p_address, p_lat, p_lng,
     p_image_url, 'manual', auth.uid(), 'manual');

  return v_place_id;
end;
$$;

revoke all on function public.admin_create_place(
  text, place_category, text, double precision, double precision, integer, integer, text
) from public;
grant execute on function public.admin_create_place(
  text, place_category, text, double precision, double precision, integer, integer, text
) to authenticated;

-- ── 장소 별점 · 홈 '하루에 다녀올 만한 곳' (플로챠트/홈.md) ──────────────
-- 마이그레이션 20261008010000 의 함수·트리거를 옮긴 것이다. 기존 리뷰를
-- 채워 넣는 백필은 데이터라 이 스냅샷에는 없다.

-- ── 2. 한 장소의 평균을 다시 계산한다 ──────────────────────────────
--
-- ❶ 사람당 한 표. 같은 사람이 같은 장소를 여러 번 리뷰했으면 가장 최근 여행의
-- 별점만 센다 — 한 사람이 같은 곳을 다섯 번 가서 ★5 를 주면 평균을 혼자 끌어
-- 올릴 수 있다. '최근'은 여행 날짜(trip_date)로 정하고, 같은 날이면 나중에
-- 만든 여행, 그래도 같으면 항목 id 로 가른다. trip_items 에는 수정 시각이
-- 없어서 여행 날짜가 가장 믿을 만한 기준이다.
--
-- security definer 여야 한다. 리뷰는 본인만 읽을 수 있어서(RLS), 저장한 사람의
-- 권한으로 돌면 그 사람 자신의 리뷰만으로 평균을 낸다 — 오류 없이 틀린 값이
-- 들어간다. places 쓰기도 운영자만 할 수 있어 같은 이유로 필요하다.
--
-- 직접 부르는 함수가 아니다. 트리거와 이 파일의 백필만 쓰므로 실행 권한을
-- 누구에게도 주지 않는다.
create or replace function public.place_rating_recompute(p_place_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  with latest as (
    select distinct on (t.user_id) ti.rating
      from public.trip_items ti
      join public.trips t on t.id = ti.trip_id
     where ti.place_id = p_place_id
       and ti.rating is not null
     order by t.user_id, t.trip_date desc, t.created_at desc, ti.id desc
  )
  update public.places p
     set rating_count = agg.n,
         rating_avg   = case when agg.n = 0 then null else round(agg.avg, 1) end
    from (select count(*)::integer as n, avg(rating)::numeric as avg from latest) agg
   where p.id = p_place_id;
$$;

revoke all on function public.place_rating_recompute(text) from public;


-- ── 3. 리뷰가 바뀌면 그 장소만 다시 계산한다 ──────────────────────
--
-- ❹ 트리거로 계산한다. 리뷰는 화면에서 지울 때만 사라지지 않는다 — 여행을
-- 지우면 함께 지워지고(cascade), 탈퇴하면 그 사람 것이 전부, 재수집으로 장소가
-- 빠져도 지워진다. 이런 삭제는 DB 안에서 일어나 앱 코드가 알 수 없지만 행 단위
-- 트리거는 cascade 삭제에도 불린다.
--
-- 별점이 없던 행끼리 바뀐 것은 무시한다. 장소를 옮긴 행이면 옛 장소와 새 장소를
-- 둘 다 다시 계산하고, 같은 장소면 한 번만 한다.
create or replace function public.trip_items_rating_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_new text;
begin
  if tg_op <> 'INSERT' and old.rating is not null then
    v_old := old.place_id;
  end if;
  if tg_op <> 'DELETE' and new.rating is not null then
    v_new := new.place_id;
  end if;

  if v_old is not null then
    perform public.place_rating_recompute(v_old);
  end if;
  if v_new is not null and v_new is distinct from v_old then
    perform public.place_rating_recompute(v_new);
  end if;
  return null;
end;
$$;

create trigger trip_items_rating_refresh_trigger
  after insert or delete or update of rating, place_id on public.trip_items
  for each row execute function public.trip_items_rating_refresh();


-- ── 4. 여행 날짜가 바뀌면 그 여행의 장소들을 다시 계산한다 ─────────
--
-- 사람당 한 표의 '최근'을 여행 날짜로 정했으므로, 날짜가 바뀌면 그 사람의 어느
-- 별점이 표가 되는지가 바뀔 수 있다.
create or replace function public.trips_rating_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select distinct ti.place_id
      from public.trip_items ti
     where ti.trip_id = new.id
       and ti.rating is not null
  loop
    perform public.place_rating_recompute(r.place_id);
  end loop;
  return null;
end;
$$;

create trigger trips_rating_refresh_trigger
  after update of trip_date on public.trips
  for each row
  when (old.trip_date is distinct from new.trip_date)
  execute function public.trips_rating_refresh();


-- ── 6. 두 지점 사이의 직선거리(km) ────────────────────────────────
--
-- 앱의 geo.ts distanceKm 과 같은 Haversine 이다.
create or replace function public.distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 6371 * 2 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  )));
$$;

-- home_picks() 가 호출자 권한으로 부르므로 쓸 역할에만 연다
revoke all on function public.distance_km(double precision, double precision, double precision, double precision) from public;
grant execute on function public.distance_km(double precision, double precision, double precision, double precision)
  to anon, authenticated;


-- ── 7. 홈 '하루에 다녀올 만한 곳' ─────────────────────────────────
--
-- 기준점(현재 위치, 없으면 서울 강남구 중심)에서 p_count 곳(앱은 10곳). 종류 비율 없이
-- 한 줄 순서로 고른다:
--   1) 하루 거리(직선 120km, 편도 2시간) 안에서 리뷰가 있는 곳 — 평균 높은 순,
--      같으면 리뷰 많은 순, 그다음 가까운 순.
--   2) 나머지 — 기준점에서 가까운 순(거리 제한 없음).
-- 후보는 미판정 · 숨긴 장소 · 술집을 뺀 곳. '더 보기'는 이미 보인 곳(p_exclude)을 빼고
-- 다음 p_count 곳 — 순서가 기준점 · 리뷰에 따라 바뀌므로 쪽 번호 대신 제외 목록으로 잇는다.
--
-- id 와 순서만 돌려준다. 이름·지역 이름은 화면이 평소 쓰는 장소 조회로 붙인다.
-- 기준점이 비어 오면 regions 의 (서울 1, 강남구 1) 중심을 쓴다 — 강남 좌표를 코드에 적지
-- 않는 것은, 수집 때 장소들의 평균 위치로 계산된 값이라 데이터를 따라가야 하기 때문이다.
-- security invoker — places 는 누구나 읽을 수 있고, 평균 칸만 읽으며 개별 리뷰(trip_items)는
-- 건드리지 않는다.
create function public.home_picks(
  p_lat     double precision,
  p_lng     double precision,
  p_count   integer default 10,
  p_exclude text[] default '{}'
)
returns table (place_id text, pick_order integer)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_lat    double precision := p_lat;
  v_lng    double precision := p_lng;
  v_count  integer := least(greatest(coalesce(p_count, 10), 1), 50);
  v_radius constant double precision := 120;  -- 편도 2시간 · 앱 DAY_TRIP_RADIUS_KM
begin
  if v_lat is null or v_lng is null then
    select r.lat, r.lng into v_lat, v_lng
      from public.regions r
     where r.tour_area_code = 1 and r.tour_sigungu_code = 1;
  end if;

  return query
  with cand as (
    select p.id, d.km,
           (p.rating_count > 0 and d.km <= v_radius) as reviewed,
           p.rating_avg, p.rating_count
      from public.places p
     cross join lateral (select public.distance_km(v_lat, v_lng, p.lat, p.lng) as km) d
     where p.tour_sigungu_code >= 0
       and p.category in ('spot', 'babzip', 'cafe')
       and p.hidden_at is null
       and not (p.id = any (coalesce(p_exclude, '{}')))
  ),
  ranked as (
    select c.id,
           (row_number() over (order by c.reviewed desc,
                                        case when c.reviewed then c.rating_avg end desc nulls last,
                                        case when c.reviewed then c.rating_count end desc nulls last,
                                        c.km, c.id))::integer as n
      from cand c
  )
  select x.id, x.n
    from ranked x
   where x.n <= v_count
   order by x.n;
end;
$$;

revoke all on function public.home_picks(double precision, double precision, integer, text[]) from public;
grant execute on function public.home_picks(double precision, double precision, integer, text[])
  to anon, authenticated;

-- ── 8. 지도 '내 위치 주변' — 가까운 순 N곳 ─────────────────────────
--
-- 내 위치에서 직선 p_max_km(기본 120 = 하루 거리) 안의 장소를 가까운 순으로 p_limit 곳
-- (기본 100, 최대 500). DB 가 거리를 재서 정렬하고 자른다 — API 는 계산한 거리로 정렬할
-- 수 없다. 숨긴 장소 · 미판정 장소는 뺀다. 장소 행 그대로(setof places) 돌려줘 앱이
-- select 로 지역 이름을 붙여 받는다. security invoker — places 의 RLS 를 그대로 탄다.
-- 위도 · 경도 범위로 먼저 좁혀 거리를 잴 행을 줄인다(위도 1도 ≈ 111km, 경도는 cos(위도)배).
create or replace function public.places_nearest(
  p_lat        double precision,
  p_lng        double precision,
  p_limit      integer default 100,
  p_max_km     double precision default 120,          -- 앱 DAY_TRIP_RADIUS_KM
  p_categories public.place_category[] default null    -- null 이면 전부
)
returns setof public.places
language sql
stable
set search_path = public, pg_temp
as $$
  select p.*
    from public.places p
   cross join lateral (select public.distance_km(p_lat, p_lng, p.lat, p.lng) as km) d
   where p.tour_sigungu_code >= 0
     and p.hidden_at is null
     and (p_categories is null or p.category = any (p_categories))
     and p.lat between p_lat - least(p_max_km, 500) / 111.0 * 1.05
                   and p_lat + least(p_max_km, 500) / 111.0 * 1.05
     and p.lng between p_lng - least(p_max_km, 500) / (111.0 * cos(radians(p_lat))) * 1.05
                   and p_lng + least(p_max_km, 500) / (111.0 * cos(radians(p_lat))) * 1.05
     and d.km <= least(p_max_km, 500)
   order by d.km, p.id
   -- API 상한(max_rows 1,000)보다 작게 묶는다
   limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

revoke all on function public.places_nearest(double precision, double precision, integer, double precision, public.place_category[]) from public;
grant execute on function public.places_nearest(double precision, double precision, integer, double precision, public.place_category[])
  to anon, authenticated;

-- ── 9. 추천 장소 — 서버가 별점으로 한 쪽만 ─────────────────────────
--
-- 고른 지역의 장소를 방문자 별점(베이지안 — 리뷰가 적을수록 3점 쪽으로)으로 매겨 한 쪽
-- (p_count, 앱은 10)을 고른다. 앱 recommend.ts 의 ratingScore() 와 같다(바꾸면 함께).
-- p_hour · p_weather · p_tags 는 받기만 하고 쓰지 않는다(20261017000000 — 예전엔 취향 태그 ·
-- 시간대 · 날씨도 더했다). 동점은 md5(p_seed || id) — 같은 씨앗이면 같은 순서. 한 쪽은 종류마다
-- 절반까지 먼저, 모자라면 점수순으로 채운다(앱 takePage() 와 같다). '더 보기'는 보인 곳
-- (p_exclude)을 빼고 다음 쪽. total 은 지역 후보 전체 수. 미판정 · 숨긴 장소 제외.
create or replace function public.recommend_places(
  p_area     integer,
  p_sigungu  integer default null,
  p_hour     integer default 12,
  p_weather  text default 'clear',
  p_tags     text[] default '{}',
  p_exclude  text[] default '{}',
  p_count    integer default 10,
  p_seed     text default ''
)
returns table (place_id text, pick_order integer, total integer)
language sql
stable
set search_path = public, pg_temp
as $$
  with cand as (
    select p.id, p.category,
           ( case when p.rating_avg is null or p.rating_count <= 0 then 0::float8
                  else ((p.rating_avg::float8 * p.rating_count + 3 * 2) / (p.rating_count + 2) - 3) * 2 end
           )::float8 as score,
           ('x' || substr(md5(coalesce(p_seed, '') || p.id), 1, 8))::bit(32)::bigint as tie,
           (p.id = any (coalesce(p_exclude, '{}'))) as shown
      from public.places p
     where p.tour_sigungu_code >= 0
       and p.hidden_at is null
       and p.tour_area_code = p_area
       and (p_sigungu is null or p.tour_sigungu_code = p_sigungu)
  ),
  params as (
    select least(greatest(coalesce(p_count, 10), 1), 50) as n,
           ceil(least(greatest(coalesce(p_count, 10), 1), 50) / 2.0)::integer as cap,
           (select count(*) from cand)::integer as total
  ),
  rest as (
    select c.*, row_number() over (partition by c.category order by c.score desc, c.tie, c.id) as rn
      from cand c
     where not c.shown
  ),
  first_pass as (
    select r.id, r.score, r.tie
      from rest r, params
     where r.rn <= params.cap
     order by r.score desc, r.tie, r.id
     limit (select n from params)
  ),
  fill as (
    select r.id, r.score, r.tie
      from rest r
     where r.id not in (select id from first_pass)
     order by r.score desc, r.tie, r.id
     limit greatest((select n from params) - (select count(*) from first_pass), 0)
  ),
  picked as (
    select * from first_pass
    union all
    select * from fill
  )
  select x.id,
         (row_number() over (order by x.score desc, x.tie, x.id))::integer,
         (select total from params)
    from picked x
   order by 2;
$$;

revoke all on function public.recommend_places(integer, integer, integer, text, text[], text[], integer, text) from public;
grant execute on function public.recommend_places(integer, integer, integer, text, text[], text[], integer, text)
  to anon, authenticated;

-- ── 프로필 생성 시점에 대하여 ────────────────────────────────────────
-- 가입 시 auth.users 트리거로 profiles 행을 자동 생성하지 않는다.
--
-- 앱은 'profiles 행의 부재'를 곧 '사용자 등록(SYS-01-02) 미완료' 신호로 사용해
-- 온보딩 화면으로 보낸다. 트리거로 행을 미리 만들면 가입 직후 필수 등록 절차가
-- 통째로 건너뛰어진다. 또한 소셜 계정 이름이 nickname 의 길이 제약(2~12자)을
-- 넘거나 이메일이 없는 provider 의 경우 트리거가 실패해 회원가입 자체가 막힌다.
--
-- 소셜 가입 시 닉네임 자동 연동(SYS-01-01)은 클라이언트가 담당한다:
-- lib/auth.tsx 가 user_metadata 의 full_name/name 을 읽어 온보딩 입력란에 채워 넣고,
-- 사용자가 확인·수정한 값을 저장하는 시점에 profiles 행이 생성된다.
-- 데모 모드와 Supabase 모드의 동작이 이 방식에서 정확히 일치한다.

-- ── 수집 원본 (tour 스키마) ─────────────────────────────────────────
-- TourAPI 에서 받은 원본과 수집 상태. 예전에는 수집 폴더의 raw/ 파일이었다
-- (intent/2026-10-09-서버-수집-검토/검토.md). 앱 API 에 열지 않는다 — config.toml 의
-- 노출 스키마에 없고, anon · authenticated 에 아무 권한도 주지 않는다. 수집 작업만
-- tour_collector 역할로 접속한다.
create schema tour;

-- 시/도 · 시군구 코드표 (raw/area-codes.json · sigungu-N.json)
create table tour.code_tables (
  name        text primary key,          -- 'area-codes' · 'sigungu-1' … (파일 이름에서 .json 뺀 것)
  data        jsonb not null,            -- 응답 항목 배열 그대로
  fetched_at  timestamptz not null default now()
);

-- 받은 목록 단위 (raw/places-시도-시군구-타입.json 이 있다는 사실)
-- 행이 있으면 그 시군구 × 타입의 목록은 받은 것이다 — 다시 받지 않고, 바뀐 장소는
-- 목록 갱신이 list_items 에 반영한다.
create table tour.list_fetches (
  area_code     smallint not null,
  sigungu_code  smallint not null,       -- 시군구가 없는 시/도는 0 (파일 이름 규칙 그대로)
  content_type  smallint not null,
  fetched_at    timestamptz not null default now(),
  primary key (area_code, sigungu_code, content_type)
);

-- 목록 항목 — 장소 하나에 한 행 (raw/places-*.json 의 항목 + hidden.json)
-- 표출 중단된 장소는 지우지 않고 hidden_at 을 채운다. 다시 표출되면 비운다.
create table tour.list_items (
  contentid     text primary key,
  content_type  smallint not null,
  area_code     smallint not null,
  sigungu_code  smallint not null,
  modified      text,                    -- 목록 modifiedtime (YYYYMMDDHHMMSS, 한국 시각)
  item          jsonb not null,          -- 목록 항목 원본
  hidden_at     timestamptz,             -- 표출 중단을 본 시각. null 이면 표출 중
  hidden_mt     text,                    -- 그때 동기화 목록의 수정일
  updated_at    timestamptz not null default now(),
  foreign key (area_code, sigungu_code, content_type)
    references tour.list_fetches (area_code, sigungu_code, content_type)
);

-- 목록 갱신이 타입별 수정일 순으로 훑는다
create index list_items_type_modified_idx on tour.list_items (content_type, modified);

-- 상세 — 장소 하나에 한 행 (raw/detail-*.json 의 항목)
-- mt 는 받을 때의 목록 수정일이다. list_items.modified 와 다르면 다시 받는다.
create table tour.details (
  contentid   text primary key references tour.list_items on delete cascade,
  common      jsonb,                     -- detailCommon2 첫 항목 (없으면 null)
  intro       jsonb,                     -- detailIntro2 첫 항목 (없으면 null)
  mt          text,
  fetched_at  timestamptz not null default now()
);

-- 수집 상태 (raw/sync-state.json) — 목록 갱신 기준 시각 · 사라진 장소 확인 날짜 등
create table tour.sync_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 실행 기록 (raw/logs/ · summary.txt)
create table tour.runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  host         text,                     -- 'mac' · 'github-actions' …
  calls        integer not null default 0,
  result       jsonb not null default '{}'::jsonb,
  error        text
);

-- 실행 한 번의 화면 출력 — 줄 하나에 한 행 (예전 raw/logs/*.log)
-- 수집 · 반영 스크립트가 찍는 줄을 몇 줄마다 바로 넣으므로, 실행 도중 죽어도 그때까지는
-- 남는다. 30일 지난 줄은 실행이 끝날 때마다 지운다(실행 요약 tour.runs 는 남긴다).
create table tour.run_logs (
  id         bigint generated always as identity primary key,
  run_id     bigint not null references tour.runs on delete cascade,
  seq        integer not null,               -- 그 실행 안에서의 줄 순서
  logged_at  timestamptz not null default now(),
  level      text not null check (level in ('info', 'error')),
  message    text not null
);

create index run_logs_run_idx on tour.run_logs (run_id, seq);
create index run_logs_logged_at_idx on tour.run_logs (logged_at);

-- 지난번 places 에 반영한 변환 결과의 지문 — 다음 반영 때 바뀐 장소만 고르는 데 쓴다
create table tour.place_out (
  id          text primary key,          -- places.id (= contentid)
  hash        text not null,
  applied_at  timestamptz not null default now()
);

-- 수집 작업 전용 역할. 로그인은 여기서 열지 않는다 — 비밀번호는 사람이 SQL 편집기에서
--   alter role tour_collector with login password '…';
-- 로 정한다(마이그레이션 · git 에 비밀번호를 남기지 않는다). 역할은 클러스터 단위라
-- 이미 있으면 그대로 쓴다.
do $$
begin
  create role tour_collector nologin;
exception when duplicate_object then null;
end
$$;

revoke all on schema tour from public;
-- Supabase 기본 권한이 새 스키마에 번지지 않게 한 번 더 걷는다(이미 없으면 아무 일도 안 함)
revoke all on all tables in schema tour from anon, authenticated;
grant usage on schema tour to tour_collector;
grant select, insert, update, delete on all tables in schema tour to tour_collector;
grant usage on all sequences in schema tour to tour_collector;

-- 수집 작업이 places · regions · region_groups 에 바로 쓴다 (seed.sql 을 거치지 않는다).
-- 지우는 권한은 없다. places 는 배치가 채우는 칸만 고칠 수 있다 — 별점 집계 ·
-- 등록자 · 출처(source)는 못 바꾼다. 행 단위로는 아래 RLS 정책이 source = 'tour' 로 묶는다.
grant usage on schema public to tour_collector;
grant select, insert, update on public.region_groups, public.regions to tour_collector;
grant select on public.places to tour_collector;
grant insert (id, name, category, tour_area_code, tour_sigungu_code, address, lat, lng,
              image_url, tags, content_type, summary, open_hours, phone,
              source_modified_at, region_source, region_note)
  on public.places to tour_collector;
grant update (name, category, tour_area_code, tour_sigungu_code, address, lat, lng,
              image_url, tags, content_type, summary, open_hours, phone,
              source_modified_at, region_source, region_note, hidden_at)
  on public.places to tour_collector;
-- places 의 관리자 정책이 is_admin() 을 부른다. 정책은 모두 평가되므로 이 역할도 실행
-- 권한이 있어야 한다(결과는 늘 false — 로그인 사용자가 아니다).
grant execute on function public.is_admin() to tour_collector;

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.region_groups enable row level security;
alter table public.regions      enable row level security;
alter table public.profiles     enable row level security;
alter table public.places       enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_items   enable row level security;
alter table public.shared_plans      enable row level security;
alter table public.shared_plan_items enable row level security;
alter table public.plan_ratings      enable row level security;

-- 지역·장소는 비로그인(Guest 모드)에서도 열람 가능해야 한다
create policy "region groups are readable by everyone"
  on public.region_groups for select
  using (true);

create policy "regions are readable by everyone"
  on public.regions for select
  using (true);

create policy "places are readable by everyone"
  on public.places for select
  using (true);

create policy "own profile"
  on public.profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "own trips"
  on public.trips for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 타임라인 항목은 소유한 여행에 속한 것만 접근 가능
create policy "own trip items"
  on public.trip_items for all
  using (
    exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.trips t where t.id = trip_id and t.user_id = auth.uid())
  );

-- trips·trip_items 의 정책은 관리자에게도 열지 않는다. 둘을 합치면 그 사람이
-- 언제 어디 있었는지의 기록이 되고, 한 번 열면 "관리자는 모든 여행을 볼 수
-- 있다"가 시스템의 성질이 된다. 좋은 동선을 큐레이션에 쓰고 싶으면 이미
-- 공용으로 올라온 플랜을 담아서 다듬은 뒤 origin='admin' 으로 다시 올린다.

-- ── SHARE-06 공용 플랜 ───────────────────────────────────────────────
-- 내려간 플랜은 작성자와 관리자에게만 보인다. 링크를 받은 비로그인 사용자도
-- 공개된 플랜은 그대로 볼 수 있어야 한다 — 로그인 벽을 먼저 만나면 공유가
-- 성립하지 않는다.
create policy "public plans are readable"
  on public.shared_plans for select
  using (
    is_hidden = false
    or author_user_id = auth.uid()
    or public.is_admin()
  );

create policy "authors and admins write plans"
  on public.shared_plans for insert
  with check (
    (origin = 'user'  and author_user_id = auth.uid())
    or (origin = 'admin' and public.is_admin())
  );

create policy "authors and admins update plans"
  on public.shared_plans for update
  using (author_user_id = auth.uid() or public.is_admin())
  with check (author_user_id = auth.uid() or public.is_admin());

create policy "authors and admins delete plans"
  on public.shared_plans for delete
  using (author_user_id = auth.uid() or public.is_admin());

-- 항목은 부모 플랜의 접근성을 따른다
create policy "plan items follow the plan"
  on public.shared_plan_items for select
  using (
    exists (
      select 1 from public.shared_plans p
       where p.id = plan_id
         and (p.is_hidden = false or p.author_user_id = auth.uid() or public.is_admin())
    )
  );

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

-- places 의 select 정책("places are readable by everyone")은 그대로 둔다.
create policy "admins write places"
  on public.places for insert
  with check (public.is_admin());

create policy "admins update places"
  on public.places for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "admins delete places"
  on public.places for delete
  using (public.is_admin());

-- 수집 작업(tour_collector)은 TourAPI 행만 넣고 고친다 — 관리자 등록 행(source = 'manual')은
-- 건드리지 못한다. 지역 코드표는 통째로 배치 몫이다.
create policy "collector inserts tour places"
  on public.places for insert to tour_collector
  with check (source = 'tour');

create policy "collector updates tour places"
  on public.places for update to tour_collector
  using (source = 'tour')
  with check (source = 'tour');

create policy "collector writes region groups"
  on public.region_groups for insert to tour_collector
  with check (true);

create policy "collector updates region groups"
  on public.region_groups for update to tour_collector
  using (true)
  with check (true);

create policy "collector writes regions"
  on public.regions for insert to tour_collector
  with check (true);

create policy "collector updates regions"
  on public.regions for update to tour_collector
  using (true)
  with check (true);

-- ── SHARE-06-07 만족도 ───────────────────────────────────────────────
-- 별점은 공개 정보다. 몇 점인지 모르면 고를 근거가 없다.
create policy "ratings are readable"
  on public.plan_ratings for select
  using (true);

-- 담은 적 있는 사람만 평가한다. 담지도 않은 사람의 점수가 섞이면 그 숫자는
-- 믿을 게 못 된다. 자기 플랜은 평가할 수 없다.
-- trips 를 참조하지만 재귀 위험은 없다 — 다른 테이블이고, 평가자는 자기
-- 여행만 보이므로 trips 의 RLS 를 그대로 통과한다.
create policy "rate what i cloned"
  on public.plan_ratings for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.trips t
       where t.source_plan_id = plan_id and t.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.shared_plans p
       where p.id = plan_id and p.author_user_id = auth.uid()
    )
  );

create policy "update my rating"
  on public.plan_ratings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "delete my rating"
  on public.plan_ratings for delete
  using (user_id = auth.uid());

-- =====================================================================
-- 실시간 구독
-- =====================================================================
alter publication supabase_realtime add table public.trip_items;
