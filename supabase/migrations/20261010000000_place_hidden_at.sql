-- places.hidden_at — TourAPI 에서 표출 중단된 장소를 숨긴다 (README-플로챠트.md '사라진 장소 정리')
--
-- TourAPI 는 장소를 지우지 않고 표출 중단(showflag 0)으로 돌린다. 수집 배치가 동기화
-- 목록(areaBasedSyncList2)에서 그런 장소를 골라 시드 끝에서 이 칸을 채운다.
--
-- 행을 지우지 않는 이유: trip_items · shared_plan_items 가 places 를 on delete cascade 로
-- 참조한다. 지우면 그 장소를 담아 둔 사용자 타임라인 항목까지 함께 사라진다.
--
--   null      보임 — 지도 · 검색 · 추천 · 홈 후보에 나온다
--   시각      숨김 — 새로 고르는 화면에서만 빠진다. 이미 담긴 타임라인 · 공유 일정 ·
--             장소 상세는 그대로 열리고 '관광정보에서 내려간 장소' 안내가 붙는다
--
-- 표출이 재개되면 다음 시드 적재의 upsert 가 null 로 되돌린다. 관리자 등록 행
-- (source = 'manual')은 배치가 건드리지 않으므로 늘 null 이다.
alter table public.places add column hidden_at timestamptz;

-- 홈 후보에서 숨긴 장소를 뺀다 — 20261008020000 과 같고 조건 한 줄만 더했다.
create or replace function public.home_picks(
  p_lat   double precision,
  p_lng   double precision,
  p_count integer default 5
)
returns table (place_id text, pick_order integer)
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_lat    double precision := p_lat;
  v_lng    double precision := p_lng;
  -- 밥집 1 · 카페 1 에 명소가 최소 1곳은 들어가야 하므로 3 이상
  v_count  integer := least(greatest(coalesce(p_count, 5), 3), 20);
  v_radius constant double precision := 120;  -- 편도 2시간 · 앱 DAY_TRIP_RADIUS_KM
begin
  if v_lat is null or v_lng is null then
    select r.lat, r.lng into v_lat, v_lng
      from public.regions r
     where r.tour_area_code = 1 and r.tour_sigungu_code = 1;
  end if;

  return query
  with cand as (
    select p.id, p.category, p.rating_avg, p.rating_count, d.km,
           (p.rating_count > 0 and d.km <= v_radius) as reviewed
      from public.places p
     cross join lateral (select public.distance_km(v_lat, v_lng, p.lat, p.lng) as km) d
     where p.tour_sigungu_code >= 0
       and p.category in ('spot', 'babzip', 'cafe')
       and p.hidden_at is null
  ),
  ranked as (
    -- 평균·개수는 리뷰 묶음 안에서만 순서를 정한다. 나머지는 null 로 두어 거리만 본다.
    select c.id, c.category, c.reviewed, c.km,
           case when c.reviewed then c.rating_avg end as avg_key,
           case when c.reviewed then c.rating_count end as cnt_key
      from cand c
  ),
  per_cat as (
    select r.*,
           row_number() over (partition by r.category
                              order by r.reviewed desc, r.avg_key desc nulls last,
                                       r.cnt_key desc nulls last, r.km, r.id) as rn
      from ranked r
  )
  select x.id,
         (row_number() over (order by x.reviewed desc, x.avg_key desc nulls last,
                                      x.cnt_key desc nulls last, x.km, x.id))::integer
    from per_cat x
   where x.rn <= case x.category when 'spot' then v_count - 2 else 1 end
   order by 2;
end;
$$;

revoke all on function public.home_picks(double precision, double precision, integer) from public;
grant execute on function public.home_picks(double precision, double precision, integer)
  to anon, authenticated;
