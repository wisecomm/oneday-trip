-- 수집 작업이 운영 DB 에 바로 반영한다 — tour_collector 에 places · regions 쓰기 권한
--
-- 검토: intent/2026-10-09-서버-수집-검토/검토.md (5단계)
--
-- 지금까지는 load.mjs 가 seed.sql 을 만들고 사람이 db push --include-seed 로 넣었다.
-- 이제 load.mjs 가 tour_collector 로 접속해 바뀐 장소만 places 에 바로 쓴다.
-- seed.sql 은 없앤다.

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
