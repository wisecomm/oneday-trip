-- =====================================================================
-- 당일치기 단일 날짜 모델로 전환
--
-- 서비스가 하루 단위 여행만 다루기로 확정되어, 기간(start_date ~ end_date)과
-- 일자 구분(trip_items.day_index)을 제거한다.
--   · trips.start_date / end_date  →  trips.trip_date
--   · trip_items.day_index         →  삭제 (방문 순서는 sort_order 만으로 관리)
--
-- 기존 데이터는 시작일을 여행 날짜로 삼아 보존한다. Day 2 이후에 담겨 있던
-- 항목이 있다면 하루 안의 순서로 이어 붙여 유실 없이 합친다.
-- =====================================================================

-- ── trips: 기간 → 단일 날짜 ──────────────────────────────────────────
alter table public.trips add column trip_date date;

update public.trips set trip_date = start_date;

alter table public.trips alter column trip_date set not null;

-- 기간 관련 제약과 인덱스를 먼저 정리한 뒤 컬럼을 제거한다
alter table public.trips drop constraint if exists trips_date_range;
drop index if exists public.trips_user_idx;

alter table public.trips drop column start_date;
alter table public.trips drop column end_date;

create index trips_user_idx on public.trips (user_id, trip_date desc);

-- ── trip_items: 일자 구분 제거 ───────────────────────────────────────
-- day_index 를 그냥 지우면 Day 2 이후 항목들의 sort_order 가 Day 1 과 겹쳐
-- 순서가 뒤섞인다. 먼저 (day_index, sort_order) 기준으로 하루 안에서
-- 연속된 순번을 다시 매긴 뒤에 컬럼을 제거한다.
with renumbered as (
  select
    id,
    row_number() over (
      partition by trip_id
      order by day_index, sort_order, created_at
    ) - 1 as new_order
  from public.trip_items
)
update public.trip_items t
set sort_order = r.new_order
from renumbered r
where t.id = r.id;

drop index if exists public.trip_items_trip_idx;

alter table public.trip_items drop column day_index;

create index trip_items_trip_idx on public.trip_items (trip_id, sort_order);
