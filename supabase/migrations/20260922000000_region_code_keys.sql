-- =====================================================================
-- 지역 키를 이름 문자열에서 TourAPI 코드 복합키로 전환 (REGION-07)
--
-- 근거: intent/2026-09-20-재수집-스키마-교체/intent.md
--
-- 왜 바꾸나
--   · regions.name 이 PK 라 '부산 서구'처럼 시/도 접두어를 붙여야 했다.
--     강서구·중구·서구는 여러 시/도에 중복되기 때문이다. 키가 코드가 되면
--     이름은 '서구' 그대로 저장하면 된다.
--   · trips.destination 은 regions.name 또는 region_groups.name 둘 중 하나를
--     담아 FK 를 걸 수 없었다. 코드 두 컬럼으로 나누면 sigungu 가 null 일 때
--     '시/도 전체'가 되고, Postgres 복합 FK 의 기본인 MATCH SIMPLE 이 그 경우
--     검사를 건너뛰므로 제약을 걸 수 있다.
--
-- 사용자 확인 사항
--   · 테스트 단계이므로 기존 여행·타임라인·예약을 전부 지운다. 방문 리뷰
--     (trip_items.note/rating)는 외부 출처가 없어 다시 만들 수 없지만,
--     보존하지 않기로 합의했다.
--   · profiles 와 auth.users 는 건드리지 않는다. 교체 후 사용자는 로그인은
--     되지만 '나의 여행'이 비어 있는 상태가 된다.
-- =====================================================================

-- ── 1. 자식 데이터부터 비운다 ────────────────────────────────────────
delete from public.reservations;
delete from public.trip_items;
delete from public.trips;

-- ── 2. 지역·장소 테이블을 통째로 교체한다 ────────────────────────────
-- places 를 cascade 로 지우면 trip_items·reservations 의 FK 제약도 함께
-- 사라진다. 아래 6번에서 다시 건다.
drop table if exists public.places cascade;
drop table if exists public.regions cascade;
drop table if exists public.region_groups cascade;

-- ── 3. 지역 (공개 읽기) ──────────────────────────────────────────────
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
  -- 100% 채워 보내므로 받아 둔다 — 나중에 다른 데이터 소스와 맞추는 열쇠다.
  ldong_cd           text,
  lat                double precision not null,
  lng                double precision not null,
  sort_order         smallint not null default 0,
  created_at         timestamptz not null default now(),
  primary key (tour_area_code, tour_sigungu_code),
  unique (tour_area_code, name)
);

create index regions_group_idx on public.regions (tour_area_code, sort_order);

-- ── 4. 지역 판정 출처 ────────────────────────────────────────────────
-- 어느 순위로 판정했는지를 행마다 남긴다. 실패한 행을 성공 경로로 적어 두면
-- 리포트의 성공률이 부풀려지므로 'unresolved' 를 따로 둔다.
create type region_source_kind as enum (
  'tour',        -- 1순위: 응답의 sigunguCode
  'addr',        -- 2순위: 주소에서 시군구명 매칭
  'geo',         -- 3순위: 좌표 → 행정구역 경계
  'manual',      -- 사람이 지정 — 재수집이 건드리지 않는다
  'unresolved'   -- 판정 실패 — 미판정 코드(-1)로 격리
);

-- ── 5. 장소 카탈로그 (공개 읽기) ─────────────────────────────────────
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
  on public.places (region_source) where region_source = 'unresolved';

-- ── 6. trip_items · reservations 의 FK 를 다시 건다 ──────────────────
alter table public.trip_items
  add constraint trip_items_place_id_fkey
  foreign key (place_id) references public.places on delete cascade;

alter table public.reservations
  add constraint reservations_place_id_fkey
  foreign key (place_id) references public.places on delete cascade;

-- ── 7. trips 의 목적지를 코드 두 컬럼으로 ────────────────────────────
alter table public.trips drop column destination;

alter table public.trips
  add column tour_area_code smallint not null
    references public.region_groups(tour_area_code),
  -- null 이면 '시/도 전체'. 사용자가 의도적으로 고른 값이지 '모름'이 아니다.
  -- (모름을 뜻하는 -1 은 places 에만 쓰이고 trips 에는 나타나지 않는다)
  add column tour_sigungu_code smallint;

-- 복합 FK 는 기본이 MATCH SIMPLE 이라 참조 컬럼 중 하나라도 null 이면 검사를
-- 건너뛴다. 그래서 '전체' 선택은 통과하고, 구를 지정한 경우에만 실재 여부를
-- 검증한다. 제약을 걸 수 없어 비워 두었던 자리가 없어진다.
alter table public.trips
  add constraint trips_region_fkey
  foreign key (tour_area_code, tour_sigungu_code)
    references public.regions (tour_area_code, tour_sigungu_code);

-- ── 8. 사람이 고친 지역을 재수집이 덮어쓰지 않게 ─────────────────────
-- 관리자가 미판정 장소의 코드만 update 해도 region_source 가 'manual' 로
-- 바뀌어야 한다. 두 가지를 기억해야 하는 구조는 언젠가 깨진다.
-- 배치는 `set local app.region_batch = 'on'` 으로 이 트리거를 비껴간다.
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

-- =====================================================================
-- Row Level Security — 테이블을 다시 만들면 정책도 함께 사라진다.
-- 특히 공개 읽기를 빠뜨리면 비로그인(Guest) 지도 탭이 통째로 빈다.
-- =====================================================================
alter table public.region_groups enable row level security;
alter table public.regions       enable row level security;
alter table public.places        enable row level security;

create policy "region groups are readable by everyone"
  on public.region_groups for select using (true);

create policy "regions are readable by everyone"
  on public.regions for select using (true);

create policy "places are readable by everyone"
  on public.places for select using (true);

-- =====================================================================
-- 이 마이그레이션은 구조만 만든다. region_groups·regions·places 의 내용은
-- intent/2026-09-20-재수집-스키마-교체/load.mjs 가 수집 원본에서 생성한다.
-- 미판정 센티넬 행 — region_groups(-1), regions(N,-1) 과 (-1,-1) — 도 거기서
-- 함께 만든다. 마이그레이션만 적용하면 지역이 비어 있는 것이 정상이다.
-- =====================================================================
