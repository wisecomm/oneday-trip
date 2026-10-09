-- 지도 '↻ 내 위치 다시 찾기' — 내 위치에서 가까운 순 N곳을 한 번에
--
-- 앱이 하던 방식: 반경을 2 → 5 → 10 … 120km 로 넓혀 가며 places 를 받아 보고 N곳이 차면
-- 멈춘 뒤 브라우저에서 거리순으로 잘랐다. 시골은 일곱 번까지 묻고, 넓힐수록 버릴 행을
-- 더 받는다. API(PostgREST)는 계산한 거리로 정렬할 수 없어서였다.
--
-- 이제 DB 가 거리를 재서 정렬하고 자른다 — 한 번 묻고 N곳만 받는다. 거리는 home_picks() 와
-- 같은 distance_km()(하버사인, 앱 distanceKm() 와 같은 식).
--
-- 장소 행 그대로(setof places)를 돌려줘서 앱이 평소처럼 select 로 지역 이름을 붙여 받는다.
-- security invoker — places 의 RLS(누구나 읽기)를 그대로 탄다.
-- 15,518곳 전체에 거리를 재도 수 ms 라 색인은 두지 않는다. 위도 · 경도 범위로 먼저 좁혀
-- 계산할 행을 줄인다(위도 1도 ≈ 111km, 경도 1도는 cos(위도) 만큼 짧다).
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
