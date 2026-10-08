-- 홈 '하루에 다녀올 만한 곳' — 가까운 순 · 명소 3 · 밥집 1 · 카페 1 (README-플로챠트.md)
--
-- 바뀐 것
--   종류별 개수  명소(spot) = 개수 − 2, 밥집(babzip) 1, 카페(cafe) 1. 술집은 뺀다.
--                가까운 순으로만 고르면 반경 수백 m 안의 식당·카페만 나와 '하루에
--                다녀올 만한 곳'이 동네 맛집 목록이 됐다.
--   종류 안 순서 1) 하루 거리(직선 120km) 안에서 리뷰가 있는 곳 — 평균 높은 순,
--                   같으면 리뷰 많은 순, 그다음 가까운 순.
--                2) 나머지 — 기준점에서 가까운 순(처음 설계의 지역 무작위를 뺐다).
--   카드 순서    고른 다섯 곳을 같은 규칙(리뷰 묶음 먼저, 그다음 가까운 순)으로 줄 세운다.
--
-- 반경 2배(240km) 확장과 전국 채우기 단계는 없앴다. 무작위로 고를 때는 후보
-- 묶음이 필요해 반경 안이 모자라면 넓혔지만, 가까운 순이면 다음으로 가까운 곳이
-- 저절로 이어서 들어온다.
--
-- 같은 기준점이면 늘 같은 다섯 곳이 나온다(리뷰가 바뀌기 전까지). 의도한 동작이다.
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
