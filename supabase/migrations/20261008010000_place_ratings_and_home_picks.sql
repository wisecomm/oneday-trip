-- =====================================================================
-- 장소 별점(사용자 리뷰 평균)과 홈 '하루에 다녀올 만한 곳' 선택
--
-- 근거: README-플로챠트.md — 결정 ❶ 사람당 한 표 · ❷ 하루 거리 120km ·
--       ❸ ★ 표시는 리뷰 3건 이상(화면 몫) · ❹ 트리거로 계산
--
-- 홈의 '지금 인기 있는 곳'에는 인기 순위가 없었다. TourAPI 는 평점을 주지
-- 않아 source_rating 이 전부 null 이고, 화면은 장소 전체를 이름순으로 받아
-- (API 상한 1,000행에서 잘린 채) 앞쪽 다섯 지역에서만 무작위로 골랐다.
--
-- 이 마이그레이션은 두 가지를 넣는다.
--   1) places.rating_avg · rating_count — 사용자 리뷰 별점의 평균과 개수.
--      리뷰(trip_items.rating)가 바뀔 때마다 트리거가 그 장소만 다시 계산한다.
--   2) home_picks() — 기준점에서 하루 거리 안의 장소를 별점 순으로 먼저,
--      나머지는 지역을 고르게 섞어 고른다. DB 가 다섯 곳만 돌려준다.
-- =====================================================================


-- ── 1. 장소에 사용자 평균 칸 ────────────────────────────────────────
--
-- source_rating 에 넣지 않는다. 그 칸은 "출처(TourAPI)의 평점"이라는 뜻이다.
-- 평가가 없으면 rating_avg 는 0 이 아니라 null 이다 — 0 이면 '평가 없음'과
-- '최하점'이 구분되지 않는다. shared_plans.rating_avg 와 같은 규칙이다.
--
-- 장소 적재(seed.sql)의 upsert 는 이 두 칸을 건드리지 않는다. 재수집해도
-- 평균이 사라지지 않는다.
alter table public.places
  add column rating_avg   numeric(2,1) check (rating_avg between 1 and 5),
  add column rating_count integer not null default 0 check (rating_count >= 0);


-- ── 2. 한 장소의 평균을 다시 계산한다 ──────────────────────────────
--
-- ❶ 사람당 한 표. 같은 사람이 같은 장소를 여러 번 리뷰했으면 가장 최근 여행의
-- 별점만 센다 — 한 사람이 같은 곳을 다섯 번 가서 ★5 를 주면 평균을 혼자 끌어
-- 올릴 수 있다. '최근'은 여행 날짜(trip_date)로 정하고, 같은 날이면 나중에
-- 만든 여행, 그래도 같으면 항목 id 로 가른다. trip_items 에는 수정 시각이
-- 없어서 여행 날짜가 가장 믿을 만한 기준이다.
--
-- security definer 여야 한다. 리뷰는 본인만 읽을 수 있어서(RLS), 저장한 사람의
-- 권한으로 돌면 그 사람 자신의 리뷰만으로 평균을 낸다 — 오류 없이 틀린 값이
-- 들어간다. places 쓰기도 운영자만 할 수 있어 같은 이유로 필요하다.
--
-- 직접 부르는 함수가 아니다. 트리거와 이 파일의 백필만 쓰므로 실행 권한을
-- 누구에게도 주지 않는다.
create or replace function public.place_rating_recompute(p_place_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  with latest as (
    select distinct on (t.user_id) ti.rating
      from public.trip_items ti
      join public.trips t on t.id = ti.trip_id
     where ti.place_id = p_place_id
       and ti.rating is not null
     order by t.user_id, t.trip_date desc, t.created_at desc, ti.id desc
  )
  update public.places p
     set rating_count = agg.n,
         rating_avg   = case when agg.n = 0 then null else round(agg.avg, 1) end
    from (select count(*)::integer as n, avg(rating)::numeric as avg from latest) agg
   where p.id = p_place_id;
$$;

revoke all on function public.place_rating_recompute(text) from public;


-- ── 3. 리뷰가 바뀌면 그 장소만 다시 계산한다 ──────────────────────
--
-- ❹ 트리거로 계산한다. 리뷰는 화면에서 지울 때만 사라지지 않는다 — 여행을
-- 지우면 함께 지워지고(cascade), 탈퇴하면 그 사람 것이 전부, 재수집으로 장소가
-- 빠져도 지워진다. 이런 삭제는 DB 안에서 일어나 앱 코드가 알 수 없지만 행 단위
-- 트리거는 cascade 삭제에도 불린다.
--
-- 별점이 없던 행끼리 바뀐 것은 무시한다. 장소를 옮긴 행이면 옛 장소와 새 장소를
-- 둘 다 다시 계산하고, 같은 장소면 한 번만 한다.
create or replace function public.trip_items_rating_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
  v_new text;
begin
  if tg_op <> 'INSERT' and old.rating is not null then
    v_old := old.place_id;
  end if;
  if tg_op <> 'DELETE' and new.rating is not null then
    v_new := new.place_id;
  end if;

  if v_old is not null then
    perform public.place_rating_recompute(v_old);
  end if;
  if v_new is not null and v_new is distinct from v_old then
    perform public.place_rating_recompute(v_new);
  end if;
  return null;
end;
$$;

create trigger trip_items_rating_refresh_trigger
  after insert or delete or update of rating, place_id on public.trip_items
  for each row execute function public.trip_items_rating_refresh();


-- ── 4. 여행 날짜가 바뀌면 그 여행의 장소들을 다시 계산한다 ─────────
--
-- 사람당 한 표의 '최근'을 여행 날짜로 정했으므로, 날짜가 바뀌면 그 사람의 어느
-- 별점이 표가 되는지가 바뀔 수 있다.
create or replace function public.trips_rating_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select distinct ti.place_id
      from public.trip_items ti
     where ti.trip_id = new.id
       and ti.rating is not null
  loop
    perform public.place_rating_recompute(r.place_id);
  end loop;
  return null;
end;
$$;

create trigger trips_rating_refresh_trigger
  after update of trip_date on public.trips
  for each row
  when (old.trip_date is distinct from new.trip_date)
  execute function public.trips_rating_refresh();


-- ── 5. 이미 남긴 리뷰로 한 번 채운다 ──────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select distinct place_id from public.trip_items where rating is not null
  loop
    perform public.place_rating_recompute(r.place_id);
  end loop;
end
$$;


-- ── 6. 두 지점 사이의 직선거리(km) ────────────────────────────────
--
-- 앱의 geo.ts distanceKm 과 같은 Haversine 이다.
create or replace function public.distance_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 6371 * 2 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  )));
$$;


-- ── 7. 홈 '하루에 다녀올 만한 곳' ─────────────────────────────────
--
-- 기준점(현재 위치, 없으면 서울 강남구 중심)에서 하루 거리 안의 장소를 고른다.
--
--   ❷ 반경 120km(편도 2시간). 미판정 장소를 빼고 5곳이 안 되면 240km 로
--      한 번 넓힌다.
--   1순위  반경 안에서 리뷰가 있는 곳 — 평균 높은 순, 같으면 리뷰 많은 순.
--          5곳 이하면 전부 들어가고, 6곳 이상이면 위에서부터 자른다.
--   2순위  반경 안에서 리뷰가 없는 곳 — 지역을 고르게 섞는다. 각 지역의 첫
--          후보를 무작위 순서로 한 바퀴, 다음 후보로 또 한 바퀴. 가까운 순으로
--          고르면 매번 같은 곳만 나와서 반경 안에서는 무작위다.
--   3순위  반경을 넓혀도 모자라면 반경 밖 전국에서 같은 방식으로 채운다.
--
-- 다섯 곳의 id 와 순서만 돌려준다. 이름·지역 이름은 화면이 평소 쓰는 장소
-- 조회로 붙인다 — 여기서 그 조인을 다시 쓰면 장소 조회가 두 군데가 된다.
--
-- 기준점이 비어 오면 regions 의 (서울 1, 강남구 1) 중심을 쓴다. 강남 좌표를
-- 코드에 적지 않는 것은, 수집 때 장소들의 평균 위치로 계산된 값이라 데이터를
-- 따라가야 하기 때문이다.
--
-- security invoker 다. places 는 누구나 읽을 수 있고, 평균 칸만 읽으며 개별
-- 리뷰(trip_items)는 건드리지 않는다.
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
  v_count  integer := least(greatest(coalesce(p_count, 5), 1), 20);
  v_radius double precision := 120;
  v_near   integer;
  v_fill   boolean;  -- 반경을 넓혀도 모자라 전국에서 채워야 하는가
begin
  if v_lat is null or v_lng is null then
    select r.lat, r.lng into v_lat, v_lng
      from public.regions r
     where r.tour_area_code = 1 and r.tour_sigungu_code = 1;
  end if;

  select count(*) into v_near
    from public.places p
   where p.tour_sigungu_code >= 0
     and public.distance_km(v_lat, v_lng, p.lat, p.lng) <= v_radius;
  if v_near < v_count then
    v_radius := v_radius * 2;
    select count(*) into v_near
      from public.places p
     where p.tour_sigungu_code >= 0
       and public.distance_km(v_lat, v_lng, p.lat, p.lng) <= v_radius;
  end if;
  -- 반경 안에서 다 채워지면 전국 후보는 섞지 않는다. 늘 섞으면 쓰지도 않을 1만여
  -- 곳에 매번 난수를 매기고 정렬하느라 호출이 몇 배 느려진다.
  v_fill := v_near < v_count;

  return query
  with cand as (
    -- 장소마다 난수 하나(r). 아래에서 지역 안 순서와 별점 동점 처리에만 쓴다.
    select p.id, p.tour_area_code as a, p.tour_sigungu_code as s,
           p.rating_avg, p.rating_count, random() as r,
           public.distance_km(v_lat, v_lng, p.lat, p.lng) <= v_radius as near
      from public.places p
     where p.tour_sigungu_code >= 0
  ),
  -- 지역마다 따로 난수 열쇠(k)를 준다. 지역 순서는 이 열쇠로만 정한다.
  --
  -- 처음에는 지역 안 순서(order by random())와 지역 사이 순서(random() as rnd)에
  -- 난수를 각각 썼는데, Postgres 가 두 random() 을 같은 식으로 보고 한 값을 함께
  -- 썼다. 그러면 각 지역의 1순위가 그 지역에서 가장 작은 난수를 가진 장소가 되고,
  -- 지역 순서도 그 값으로 정해져 장소가 많은 지역일수록 앞에 왔다 — 400번 돌려
  -- 보니 경기가 22%(지역 수로는 13.5%)였다. 열쇠를 지역 단위로 따로 뽑아 끊는다.
  region_keys as (
    select d.a, d.s, random() as k
      from (select distinct c.a, c.s from cand c) d
  ),
  reviewed as (
    select c.id, 1 as tier,
           row_number() over (order by c.rating_avg desc, c.rating_count desc, c.r) as rk
      from cand c
     where c.near and c.rating_count > 0
  ),
  spread_near as (
    select x.id, 2 as tier, row_number() over (order by x.rn, x.k) as rk
      from (select c.id, rk.k,
                   row_number() over (partition by c.a, c.s order by c.r) as rn
              from cand c
              join region_keys rk on rk.a = c.a and rk.s = c.s
             where c.near and c.rating_count = 0) x
  ),
  spread_far as (
    select x.id, 3 as tier, row_number() over (order by x.rn, x.k) as rk
      from (select c.id, rk.k,
                   row_number() over (partition by c.a, c.s order by c.r) as rn
              from cand c
              join region_keys rk on rk.a = c.a and rk.s = c.s
             where v_fill and not c.near) x
  ),
  picked as (
    select u.id, u.tier, u.rk
      from (select * from reviewed
            union all select * from spread_near
            union all select * from spread_far) u
     order by u.tier, u.rk
     limit v_count
  )
  select pk.id, (row_number() over (order by pk.tier, pk.rk))::integer
    from picked pk
   order by pk.tier, pk.rk;
end;
$$;

revoke all on function public.home_picks(double precision, double precision, integer) from public;
grant execute on function public.home_picks(double precision, double precision, integer)
  to anon, authenticated;
