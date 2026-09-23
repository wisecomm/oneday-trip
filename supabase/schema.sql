-- =====================================================================
-- 위치기반 여행 일정 및 맛집 지도 서비스 — Supabase 스키마
--
-- 이 파일은 supabase/migrations/ 를 전부 적용한 결과의 스냅샷이다.
-- 스키마를 바꿀 때는 migrations/ 에 타임스탬프 파일을 추가하고 이 파일도
-- 같은 내용으로 갱신한다.
-- =====================================================================

-- ── 열거형 ───────────────────────────────────────────────────────────
create type place_category   as enum ('babzip', 'cafe', 'sulzip', 'spot');
create type transport_type   as enum ('walk', 'transit', 'car');
create type trip_item_status as enum ('planned', 'reserved', 'waiting', 'visited');
create type reservation_status as enum ('confirmed', 'cancelled');

-- 장소의 지역을 어느 순위로 판정했는지. 실패한 행을 성공 경로로 적어 두면
-- 리포트의 성공률이 부풀려지므로 'unresolved' 를 따로 둔다.
create type region_source_kind as enum (
  'tour',        -- 1순위: TourAPI 응답의 sigunguCode
  'addr',        -- 2순위: 주소에서 시군구명 매칭
  'geo',         -- 3순위: 좌표 → 행정구역 경계
  'manual',      -- 사람이 지정 — 재수집이 건드리지 않는다
  'unresolved'   -- 판정 실패 — 미판정 코드(-1)로 격리
);

-- ── SYS-01-02 사용자 프로필 ──────────────────────────────────────────
create table public.profiles (
  id                  uuid primary key references auth.users on delete cascade,
  nickname            text not null check (char_length(nickname) between 2 and 12),
  taste_tags          text[] not null default '{}',
  created_at          timestamptz not null default now()
);

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
  -- 외부(TourAPI)가 준 평점. 주지 않으면 null 이다 — 0 이 아니다.
  -- 0 으로 두면 '평점 없음'과 '0점'이 구분되지 않아 모든 장소가 ★ 0.0 으로 보인다.
  -- 사용자 리뷰를 집계한 내부 평점은 별도 과제로 다룬다.
  source_rating      numeric(2,1) check (source_rating between 0 and 5),
  price_level        smallint not null default 2 check (price_level between 1 and 4),
  tags               text[] not null default '{}',
  summary            text not null default '',
  open_hours         text not null default '',
  phone              text,
  -- TourAPI 목록의 modifiedtime. 재수집 때 "바뀐 것만 상세를 다시 받는" 근거다.
  source_modified_at text,
  region_source      region_source_kind not null default 'tour',
  region_note        text,                      -- 미판정 사유 한 줄
  created_at         timestamptz not null default now(),
  foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);

create index places_region_category_idx
  on public.places (tour_area_code, tour_sigungu_code, category);
create index places_unresolved_idx
  on public.places (region_source)
  where region_source = 'unresolved'::region_source_kind;

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
create table public.trips (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  title              text not null,
  tour_area_code     smallint not null references public.region_groups(tour_area_code),
  -- null 이면 '시/도 전체'. 사용자가 의도적으로 고른 값이지 '모름'이 아니다.
  -- (모름을 뜻하는 -1 은 places 에만 쓰이고 trips 에는 나타나지 않는다)
  tour_sigungu_code  smallint,
  -- 당일치기 서비스이므로 기간이 아닌 날짜 하나를 갖는다
  trip_date          date not null,
  -- 하루 동선의 시작·종료 시각 (기본 09:00~20:00)
  start_time         time not null default '09:00',
  end_time           time not null default '20:00',
  -- 정의되지 않은 값이 들어가면 화면이 라벨을 찾지 못해 조용히 빈 칸이 된다.
  -- `<@` 는 포함 검사이고 빈 배열은 통과한다.
  companions         text[] not null default '{}'
    constraint trips_companions_valid
    check (companions <@ array['solo', 'couple', 'friends', 'family', 'pet']::text[]),
  transport          transport_type not null default 'transit',
  created_at         timestamptz not null default now(),
  -- 복합 FK 는 기본이 MATCH SIMPLE 이라 참조 컬럼 중 하나라도 null 이면 검사를
  -- 건너뛴다. 그래서 '전체' 선택은 통과하고 구를 지정한 경우에만 검증된다.
  constraint trips_region_fkey foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code)
);

create index trips_user_idx on public.trips (user_id, trip_date desc);

-- ── TRIP-03-01 타임라인 항목 (하루 안의 방문 순서) ───────────────────
create table public.trip_items (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips on delete cascade,
  place_id     text not null references public.places on delete cascade,
  sort_order   smallint not null default 0,
  planned_time time,
  status       trip_item_status not null default 'planned',
  -- 방문 리뷰(소감 + 별점). 작성/수정만 있고 별도 이력은 남기지 않는다(덮어쓰기)
  note         text,
  rating       smallint check (rating between 1 and 5),
  created_at   timestamptz not null default now()
);

create index trip_items_trip_idx on public.trip_items (trip_id, sort_order);
-- places 는 on delete cascade 로 참조된다. 인덱스가 없으면 장소를 한 행 지울
-- 때마다 이 테이블을 통째로 훑어 참조를 찾는다.
create index trip_items_place_idx on public.trip_items (place_id);

-- ── RSV-05-01 예약 ───────────────────────────────────────────────────
create table public.reservations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  place_id     text not null references public.places on delete cascade,
  trip_item_id uuid references public.trip_items on delete set null,
  reserved_at  timestamptz not null,
  party_size   smallint not null check (party_size between 1 and 12),
  deposit      integer not null default 0
    constraint reservations_deposit_non_negative check (deposit >= 0),
  status       reservation_status not null default 'confirmed',
  created_at   timestamptz not null default now()
);

create index reservations_user_idx on public.reservations (user_id, reserved_at);
create index reservations_place_idx on public.reservations (place_id);
create index reservations_trip_item_idx on public.reservations (trip_item_id);

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

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.region_groups enable row level security;
alter table public.regions      enable row level security;
alter table public.profiles     enable row level security;
alter table public.places       enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_items   enable row level security;
alter table public.reservations enable row level security;

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

create policy "own reservations"
  on public.reservations for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================================
-- 실시간 구독
-- =====================================================================
alter publication supabase_realtime add table public.trip_items;
