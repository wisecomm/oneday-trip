-- 추천 장소 — 방문자 별점만으로 고른다
--
-- 20261016000000 은 별점 + 취향 태그 + 시간대 + 날씨로 점수를 매겼다. 시각은 화면을 연 순간이라
-- 여행과 상관없었고, 시간대 · 날씨 가산은 종류 단위라 같은 종류 안에서는 순서를 바꾸지 못했다.
-- 이제 별점만 본다 — 앱 src/lib/recommend.ts 의 ratingScore() 와 같다(바꾸면 함께):
--   별점  리뷰가 있으면 ((평균 × n + 3 × 2) / (n + 2) − 3) × 2   (리뷰가 적을수록 3점 쪽으로), 없으면 0
--
-- 인자는 그대로 둔다 — p_hour · p_weather · p_tags 는 받기만 하고 쓰지 않는다(배포 전 앱이 넘겨도
-- 그대로 돈다). 동점 순서(md5(p_seed || id)), 한 쪽 고르기(종류마다 절반까지 먼저 · 모자라면
-- 점수순), total, 후보(미판정 · 숨긴 장소 제외, 술집 포함)는 20261016000000 과 같다.
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
