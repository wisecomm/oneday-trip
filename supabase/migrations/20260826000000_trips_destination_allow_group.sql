-- trips.destination 이 leaf 지역(regions.name)만 가리킬 수 있었는데,
-- 여행 생성 화면에 '전체'(상위 지역 전체) 옵션이 추가되면서 destination 에
-- region_groups.name(그룹명)도 저장될 수 있게 됐다. 두 테이블 중 하나를
-- 가리키는 FK 는 Postgres 에서 표현할 수 없으므로 제약을 없애고, 어느 쪽인지는
-- 클라이언트가 regions/region_groups 목록에서 조회해 구분한다.
alter table public.trips drop constraint if exists trips_destination_fkey;
