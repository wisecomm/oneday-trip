-- =====================================================================
-- 디비 검토 결과 반영 — 외래키 인덱스와 값 제약 (REVIEW-08)
--
-- 근거: intent/2026-09-23-디비-검토/intent.md
--
-- 검토에서 나온 다섯 항목 중 셋만 반영한다. 나머지 둘의 처리는 위 문서에 있다.
--   · 장소명 검색 인덱스(pg_trgm) — 그 필터를 넘기는 화면이 아직 없어 보류
--   · trip_item_status 의 'waiting' 잔여값 — 해가 없어 보류
-- =====================================================================

-- ── 1. 외래키 인덱스 ─────────────────────────────────────────────────
-- places 를 참조하는 두 컬럼은 on delete cascade 다. 인덱스가 없으면 장소를
-- 한 행 지울 때마다 Postgres 가 자식 테이블을 통째로 훑어 참조를 찾는다.
-- 재수집이 고아 장소를 정리하는 경로에서 바로 걸리는 비용이다.
create index if not exists trip_items_place_idx
  on public.trip_items (place_id);

create index if not exists reservations_place_idx
  on public.reservations (place_id);

-- on delete set null 도 같은 이유로 필요하다
create index if not exists reservations_trip_item_idx
  on public.reservations (trip_item_id);

-- ── 2. 예약금 음수 방지 ──────────────────────────────────────────────
-- 결제 연동이 아직 없어 지금은 앱이 음수를 넣지 않는다. 제약이 없는 채로
-- 연동을 붙이면 잘못된 값이 조용히 쌓인다.
alter table public.reservations
  drop constraint if exists reservations_deposit_non_negative;

alter table public.reservations
  add constraint reservations_deposit_non_negative check (deposit >= 0);

-- ── 3. 동행인 값 검증 ────────────────────────────────────────────────
-- companions 가 text[] 자유 입력이라 정의되지 않은 문자열이 들어갈 수 있다.
-- 들어가면 화면이 라벨을 찾지 못해 빈 칸이 되는데 오류 없이 지나간다.
-- `<@` 는 "왼쪽 배열이 오른쪽에 포함되는가" 이고, 빈 배열은 통과한다.
alter table public.trips
  drop constraint if exists trips_companions_valid;

alter table public.trips
  add constraint trips_companions_valid
  check (companions <@ array['solo', 'couple', 'friends', 'family', 'pet']::text[]);
