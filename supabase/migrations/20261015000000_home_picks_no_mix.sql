-- 홈 '하루에 다녀올 만한 곳' — 종류 비율을 없애고 10곳씩 · 더 보기
--
-- 예전: 5곳을 명소 3 · 밥집 1 · 카페 1 로 나눠 골랐다(20261008020000).
-- 이제: 종류 비율 없이 한 줄 순서로 p_count 곳(앱은 10곳). '더 보기'는 이미 보인 곳(p_exclude)을
-- 빼고 다음 p_count 곳 — 같은 함수 하나로 처음과 더 보기를 함께 한다.
--
-- 순서(예전 종류 안 순서와 같다):
--   1) 하루 거리(직선 120km) 안에서 리뷰가 있는 곳 — 평균 높은 순 → 리뷰 많은 순 → 가까운 순
--   2) 나머지 — 기준점에서 가까운 순(거리 제한 없음)
-- 후보: 미판정 · 숨긴 장소 · 술집 제외(예전과 같다). 기준점이 비면 서울 강남구 중심.
--
-- 쪽 번호(offset) 대신 제외 목록을 받는 것은 순서가 기준점 · 리뷰에 따라 바뀌기 때문이다 —
-- 보인 곳을 빼고 고르면 빠짐 · 겹침 없이 이어진다.
--
-- 인자 이름 · 순서(p_lat, p_lng, p_count)는 예전 그대로 두고 p_exclude 를 뒤에 붙였다 —
-- DB 를 먼저 올려도 지금 배포된 앱(p_count 5 로 부름)이 그대로 돈다(비율 없이 5곳).
-- 인자 목록이 바뀌어 create or replace 로는 옛 함수가 남으므로 지우고 새로 만든다.
drop function if exists public.home_picks(double precision, double precision, integer);

create function public.home_picks(
  p_lat     double precision,
  p_lng     double precision,
  p_count   integer default 10,
  p_exclude text[] default '{}'
)
returns table (place_id text, pick_order integer)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_lat    double precision := p_lat;
  v_lng    double precision := p_lng;
  v_count  integer := least(greatest(coalesce(p_count, 10), 1), 50);
  v_radius constant double precision := 120;  -- 편도 2시간 · 앱 DAY_TRIP_RADIUS_KM
begin
  if v_lat is null or v_lng is null then
    select r.lat, r.lng into v_lat, v_lng
      from public.regions r
     where r.tour_area_code = 1 and r.tour_sigungu_code = 1;
  end if;

  return query
  with cand as (
    select p.id, d.km,
           (p.rating_count > 0 and d.km <= v_radius) as reviewed,
           p.rating_avg, p.rating_count
      from public.places p
     cross join lateral (select public.distance_km(v_lat, v_lng, p.lat, p.lng) as km) d
     where p.tour_sigungu_code >= 0
       and p.category in ('spot', 'babzip', 'cafe')
       and p.hidden_at is null
       and not (p.id = any (coalesce(p_exclude, '{}')))
  ),
  ranked as (
    select c.id,
           (row_number() over (order by c.reviewed desc,
                                        case when c.reviewed then c.rating_avg end desc nulls last,
                                        case when c.reviewed then c.rating_count end desc nulls last,
                                        c.km, c.id))::integer as n
      from cand c
  )
  select x.id, x.n
    from ranked x
   where x.n <= v_count
   order by x.n;
end;
$$;

revoke all on function public.home_picks(double precision, double precision, integer, text[]) from public;
grant execute on function public.home_picks(double precision, double precision, integer, text[])
  to anon, authenticated;
