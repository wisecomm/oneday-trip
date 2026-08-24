-- =====================================================================
-- 목적지 지역을 코드 상수에서 DB 테이블로 이관
--
-- 지금까지 지역 목록은 src/lib/seed.ts 의 DESTINATIONS 배열에 박혀 있어,
-- 지역 하나 추가하려면 코드 수정과 재배포가 필요했다. regions 테이블로
-- 옮기면 Supabase 대시보드(Table Editor)에서 행을 추가하는 것만으로
-- 새 지역이 앱에 반영된다.
--
-- places.region / trips.destination 은 이미 이 값들과 정확히 같은
-- 문자열을 쓰고 있음을 확인했다 (양쪽 다 '서울 성수'·'제주'·'부산'·'경주'
-- 4개뿐, 오타 없음). 그래서 데이터 변환 없이 regions.name 을 그대로
-- 참조 대상으로 삼아 FK 를 건다.
-- =====================================================================

create table public.regions (
  name        text primary key,
  -- 지도 초기 중심 좌표 — 해당 지역 등록 장소들의 대략적인 중심
  lat         double precision not null,
  lng         double precision not null,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.regions (name, lat, lng, sort_order) values
  ('서울 성수', 37.5449, 127.0504, 0),
  ('제주',      33.4257, 126.5857, 1),
  ('부산',      35.1239, 129.0716, 2),
  ('경주',      35.8288, 129.2361, 3);

alter table public.regions enable row level security;

-- 지역 목록은 비로그인(Guest 모드)에서도 필요하다 — places 와 동일한 정책
create policy "regions are readable by everyone"
  on public.regions for select
  using (true);

-- 기존 값이 regions.name 과 정확히 일치함을 사전에 확인했다.
-- (자유 텍스트였을 때의 오타 위험을 여기서부터 구조적으로 차단한다)
alter table public.places
  add constraint places_region_fkey
  foreign key (region) references public.regions(name);

alter table public.trips
  add constraint trips_destination_fkey
  foreign key (destination) references public.regions(name);

create index regions_sort_order_idx on public.regions (sort_order);
