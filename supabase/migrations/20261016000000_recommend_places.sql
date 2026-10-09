-- 추천 장소 — 서버가 점수를 매겨 한 쪽(10곳)만 돌려준다
--
-- 예전: 고른 지역의 장소를 전부 받아(경기 3,357곳 · 1,000행씩 나눠) 브라우저가 점수를 매겼다.
-- 첫 화면이 지역 크기만큼 무거웠다. 이제 DB 가 같은 규칙으로 점수를 매기고 한 쪽만 고른다 —
-- 앱은 고른 장소 행과 근거 라벨만 붙인다. '더 보기'는 이미 보인 곳(p_exclude)을 빼고 다음 쪽.
--
-- 점수 — 앱 src/lib/recommend.ts 의 scorePlace() 와 같다(바꾸면 함께):
--   별점      리뷰가 있으면 ((평균 × n + 3 × 2) / (n + 2) − 3) × 2   (리뷰가 적을수록 3점 쪽으로)
--   취향 태그  프로필 태그 중 장소 태그에 있는 것마다 +3
--   시간대    11~14시 밥집 +4 · 17~21시 밥집 +4 · 14~18시 카페 +4 · 18시~ 술집 +4 · 9~17시 명소 +2
--   날씨      비 · 눈: 카페 +4, 명소 −3 · 맑음: 명소 +3
-- 시각 · 날씨 · 취향 태그는 앱이 넘긴다(시각은 사용자 기기 시각, 날씨는 open-meteo).
--
-- 동점 순서: md5(p_seed || id) — 같은 씨앗이면 늘 같은 순서라 쪽을 넘겨도 흔들리지 않고,
-- 앱이 화면을 열 때마다 씨앗을 바꿔 섞는다(리뷰가 거의 없는 지금은 대부분 동점이다).
--
-- 한 쪽(p_count) 고르기 — 앱 takePage() 와 같다: 종류마다 쪽의 절반(10 이면 5곳)까지 먼저
-- 점수순으로 넣고, 모자라면 남은 곳에서 점수순으로 채운다.
--
-- total 은 이 지역 후보 전체 수('추천 더 보기 · 10 / N곳'). 후보는 미판정 · 숨긴 장소 제외,
-- 술집 포함(추천 장소는 예전부터 술집도 후보). security invoker — places RLS(누구나 읽기).
create or replace function public.recommend_places(
  p_area     integer,
  p_sigungu  integer default null,
  p_hour     integer default 12,
  p_weather  text default 'clear',
  p_tags     text[] default '{}',
  p_exclude  text[] default '{}',
  p_count    integer default 10,
  p_seed     text default ''
)
returns table (place_id text, pick_order integer, total integer)
language sql
stable
set search_path = public, pg_temp
as $$
  with cand as (
    select p.id, p.category,
           ( case when p.rating_avg is null or p.rating_count <= 0 then 0::float8
                  else ((p.rating_avg::float8 * p.rating_count + 3 * 2) / (p.rating_count + 2) - 3) * 2 end
           + 3 * (select count(*) from unnest(coalesce(p_tags, '{}')) t where t = any (p.tags))
           + case when p_hour >= 11 and p_hour < 14 and p.category = 'babzip' then 4 else 0 end
           + case when p_hour >= 17 and p_hour < 21 and p.category = 'babzip' then 4 else 0 end
           + case when p_hour >= 14 and p_hour < 18 and p.category = 'cafe' then 4 else 0 end
           + case when p_hour >= 18 and p.category = 'sulzip' then 4 else 0 end
           + case when p_hour >= 9 and p_hour < 17 and p.category = 'spot' then 2 else 0 end
           + case when p_weather in ('rain', 'snow') and p.category = 'cafe' then 4
                  when p_weather in ('rain', 'snow') and p.category = 'spot' then -3
                  when p_weather = 'clear' and p.category = 'spot' then 3
                  else 0 end
           )::float8 as score,
           ('x' || substr(md5(coalesce(p_seed, '') || p.id), 1, 8))::bit(32)::bigint as tie,
           (p.id = any (coalesce(p_exclude, '{}'))) as shown
      from public.places p
     where p.tour_sigungu_code >= 0
       and p.hidden_at is null
       and p.tour_area_code = p_area
       and (p_sigungu is null or p.tour_sigungu_code = p_sigungu)
  ),
  params as (
    select least(greatest(coalesce(p_count, 10), 1), 50) as n,
           ceil(least(greatest(coalesce(p_count, 10), 1), 50) / 2.0)::integer as cap,
           (select count(*) from cand)::integer as total
  ),
  rest as (
    select c.*, row_number() over (partition by c.category order by c.score desc, c.tie, c.id) as rn
      from cand c
     where not c.shown
  ),
  first_pass as (
    select r.id, r.score, r.tie
      from rest r, params
     where r.rn <= params.cap
     order by r.score desc, r.tie, r.id
     limit (select n from params)
  ),
  fill as (
    select r.id, r.score, r.tie
      from rest r
     where r.id not in (select id from first_pass)
     order by r.score desc, r.tie, r.id
     limit greatest((select n from params) - (select count(*) from first_pass), 0)
  ),
  picked as (
    select * from first_pass
    union all
    select * from fill
  )
  select x.id,
         (row_number() over (order by x.score desc, x.tie, x.id))::integer,
         (select total from params)
    from picked x
   order by 2;
$$;

revoke all on function public.recommend_places(integer, integer, integer, text, text[], text[], integer, text) from public;
grant execute on function public.recommend_places(integer, integer, integer, text, text[], text[], integer, text)
  to anon, authenticated;
