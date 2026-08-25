-- =====================================================================
-- 위치기반 여행 일정 및 맛집 지도 서비스 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 실행하세요.
-- =====================================================================

-- ── 열거형 ───────────────────────────────────────────────────────────
create type place_category   as enum ('babzip', 'cafe', 'sulzip', 'spot');
create type transport_type   as enum ('walk', 'transit', 'car');
create type trip_item_status as enum ('planned', 'reserved', 'waiting', 'visited');
create type reservation_status as enum ('confirmed', 'cancelled');

-- ── SYS-01-02 사용자 프로필 ──────────────────────────────────────────
create table public.profiles (
  id                  uuid primary key references auth.users on delete cascade,
  nickname            text not null check (char_length(nickname) between 2 and 12),
  taste_tags          text[] not null default '{}',
  created_at          timestamptz not null default now()
);

-- ── 목적지 지역 (공개 읽기) ───────────────────────────────────────────
-- 코드 상수가 아니라 테이블로 관리해, 대시보드에서 행을 추가하는 것만으로
-- 새 지역이 반영되게 한다. 상위(시/도) · 하위(구/시) 2단 구조다.
create table public.region_groups (
  name        text primary key,
  lat         double precision not null,
  lng         double precision not null,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

create table public.regions (
  name        text primary key,
  -- '부산 서구'처럼 그룹명을 붙여 전역 유일성을 보장한다 — '강서구'처럼
  -- 다른 구 이름을 부분 문자열로 포함하는 경우가 있어 접두어 없이는 위험하다
  group_name  text not null references public.region_groups(name),
  -- 지도 초기 중심 좌표 — 해당 지역 등록 장소들의 대략적인 중심
  lat         double precision not null,
  lng         double precision not null,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

create index regions_group_name_idx on public.regions (group_name, sort_order);

-- ── MAP-04-01 장소 카탈로그 (공개 읽기) ──────────────────────────────
create table public.places (
  id            text primary key,
  name          text not null,
  category      place_category not null,
  region        text not null references public.regions(name),
  address       text not null,
  lat           double precision not null,
  lng           double precision not null,
  image_url     text,
  rating        numeric(2,1) not null default 0 check (rating between 0 and 5),
  price_level   smallint not null default 2 check (price_level between 1 and 4),
  tags          text[] not null default '{}',
  summary       text not null default '',
  open_hours    text not null default '',
  phone         text
);

create index places_region_category_idx on public.places (region, category);

-- ── TRIP-02-01 / TRIP-02-02 여행 ─────────────────────────────────────
create table public.trips (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users on delete cascade,
  title              text not null,
  -- regions.name(leaf) 또는 region_groups.name('전체' 선택 시) 둘 중 하나를
  -- 담는다 — 두 테이블 중 하나를 가리키는 FK 는 표현할 수 없어 제약 없이 둔다
  destination        text not null,
  -- 당일치기 서비스이므로 기간이 아닌 날짜 하나를 갖는다
  trip_date          date not null,
  -- 하루 동선의 시작·종료 시각 (기본 09:00~20:00)
  start_time         time not null default '09:00',
  end_time           time not null default '20:00',
  companions         text[] not null default '{}',
  transport          transport_type not null default 'transit',
  created_at         timestamptz not null default now()
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
  created_at   timestamptz not null default now()
);

create index trip_items_trip_idx on public.trip_items (trip_id, sort_order);

-- ── RSV-05-01 예약 ───────────────────────────────────────────────────
create table public.reservations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  place_id     text not null references public.places on delete cascade,
  trip_item_id uuid references public.trip_items on delete set null,
  reserved_at  timestamptz not null,
  party_size   smallint not null check (party_size between 1 and 12),
  deposit      integer not null default 0,
  status       reservation_status not null default 'confirmed',
  created_at   timestamptz not null default now()
);

create index reservations_user_idx on public.reservations (user_id, reserved_at);

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
