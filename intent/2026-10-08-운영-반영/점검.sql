-- 2026-10-08 운영 반영 점검 — Supabase SQL 편집기에서 ①~⑩ 을 하나씩 선택해 실행
-- (편집기는 여러 문장을 한꺼번에 돌리면 마지막 결과만 보여 준다)
-- 기대값: ① t · t · t · {planned,visited}  ② 어긋난_장소 0  ③ 5행(명소 3 · 밥집 1 · 카페 1)  ④ dash_dash 1(원문 오타) · 여러줄 약 3,000  ⑤ 0 · 0 · 0
--         ⑥ 전부 t  ⑦ 6행  ⑧ 첫 반영 뒤 반영_지문 = 앱_장소  ⑨ 매일 수집 · 반영 두 줄, 오류 비어 있음(한도로 멈춘 수집은 오류가 정상)  ⑩ 한도 메시지 말고는 없음

-- ① 지운 것 · 새로 생긴 것
select
  to_regclass('public.reservations') is null as reservations_삭제됨,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'places'
                 and column_name in ('price_level', 'source_rating')) as 가격_평점칸_삭제됨,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'places'
             and column_name = 'rating_avg') as rating_avg_있음,
  enum_range(null::trip_item_status)::text as 항목상태;

-- ② 장소 별점 집계가 실제 리뷰와 맞는지 (백필 · 트리거)
with latest as (
  select distinct on (t.user_id, ti.place_id) ti.place_id, ti.rating
    from public.trip_items ti join public.trips t on t.id = ti.trip_id
   where ti.rating is not null
   order by t.user_id, ti.place_id, t.trip_date desc, t.created_at desc, ti.id desc
), agg as (
  select place_id, count(*) n, round(avg(rating), 1) a from latest group by place_id
)
select (select count(*) from public.places where rating_count > 0) as 별점있는_장소,
       (select count(*) from agg x join public.places p on p.id = x.place_id
         where p.rating_count <> x.n or p.rating_avg <> x.a)
     + (select count(*) from public.places p
         where p.rating_count > 0 and not exists (select 1 from agg x where x.place_id = p.id)) as 어긋난_장소;

-- ③ 홈 함수가 비회원 권한으로 도는지 — 이 블록만 따로 실행하고, 뒤에 rollback; 을 실행한다
begin;
set local role anon;
select h.pick_order, p.name, p.category
  from public.home_picks(null, null, 5) h join public.places p on p.id = h.place_id
 order by 1;

-- ④ (시드 새로고침 뒤) 영업시간 정리
select count(*) filter (where open_hours like '%- -%') as dash_dash,
       count(*) filter (where position(E'\n' in open_hours) > 0) as 여러줄
  from public.places;

-- ⑤ 반려견 · 옛 취향 태그 정리(20261008070000 · 20261008080000) — 기대: 0 · 0 · 0
select
  (select count(*) from public.trips where 'pet' = any(companions)) as 여행_pet,
  (select count(*) from public.shared_plans where 'pet' = any(companions)) as 코스_pet,
  (select count(*) from public.profiles
    where taste_tags && array['반려견 동반','비건','노포','뷰맛집','가성비','혼밥','로컬맛집']) as 옛_취향태그;

-- ⑥ (2026-10-09) 수집 · 반영 DB 전환 마이그레이션이 다 들어갔는지 — 기대: 전부 t
--    20261009000000 content_type · 20261010000000 hidden_at · 20261011000000 tour 스키마
--    20261012000000 tour_collector 쓰기 권한 · 20261013000000 run_logs
select
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'places' and column_name = 'content_type') as content_type_칸,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'places' and column_name = 'hidden_at') as hidden_at_칸,
  to_regclass('tour.list_items') is not null as tour_스키마,
  to_regclass('tour.run_logs') is not null as 로그_표,
  (select rolcanlogin from pg_roles where rolname = 'tour_collector') as 수집역할_로그인,
  has_table_privilege('tour_collector', 'public.regions', 'insert') as 지역_쓰기,
  has_column_privilege('tour_collector', 'public.places', 'hidden_at', 'update') as 장소_숨김_쓰기,
  not has_column_privilege('tour_collector', 'public.places', 'rating_avg', 'update') as 별점_못고침,
  not has_table_privilege('tour_collector', 'public.places', 'delete') as 장소_못지움,
  has_function_privilege('tour_collector', 'public.is_admin()', 'execute') as is_admin_실행,
  not has_schema_privilege('anon', 'tour', 'usage') as 비회원_tour_못봄;

-- ⑦ 수집 역할의 RLS 정책 — 기대: 6행 (places 넣기 · 고치기, regions · region_groups 각 넣기 · 고치기)
select tablename, policyname, cmd, coalesce(qual, '') as 조건, coalesce(with_check, '') as 검사
  from pg_policies
 where 'tour_collector' = any(roles)
 order by 1, 3;

-- ⑧ 수집 원본 현황 — 장소 · 상세 · 숨김 · 반영 지문 · 실행 · 로그 줄
select
  (select count(*) from tour.list_fetches) as 목록_단위,
  (select count(*) from tour.list_items where hidden_at is null) as 장소,
  (select count(*) from tour.list_items where hidden_at is not null) as 숨김,
  (select count(*) from tour.details) as 상세,
  (select count(*) from tour.place_out) as 반영_지문,
  (select count(*) from public.places where source = 'tour' and hidden_at is null) as 앱_장소,
  (select count(*) from tour.runs) as 실행,
  (select count(*) from tour.run_logs) as 로그_줄;

-- ⑨ 최근 실행 — 수집(호스트 이름) · 반영(load@…) · 끝 시각이 비면 진행 중 또는 끊김
--    멈춤 '하루 한도 도달'은 정상(다음 실행이 이어 받음) — 오류 칸이 비어 있다
select r.id, r.host,
       to_char(r.started_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as 시작,
       to_char(r.finished_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI') as 끝,
       r.calls as 호출, r.result->>'details' as 상세_받음, r.result->>'changed' as 반영_장소,
       case when r.result->>'stopped' = 'quota' then '하루 한도 도달' end as 멈춤,
       left(split_part(coalesce(r.error, ''), E'\n', 1), 80) as 오류,
       (select count(*) from tour.run_logs l where l.run_id = r.id) as 로그_줄
  from tour.runs r
 order by r.id desc
 limit 10;

-- ⑩ 최근 하루 오류 줄
select r.id, r.host, to_char(l.logged_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI:SS') as 시각, l.message
  from tour.run_logs l join tour.runs r on r.id = l.run_id
 where l.level = 'error' and l.logged_at > now() - interval '1 day'
 order by l.logged_at;

-- ⑪ 앱이 부르는 DB 함수가 들어갔는지 — db push 뒤에 본다
--    home_picks 는 인자 4개(위도, 경도, 개수, 보인 id 들) 하나만, places_nearest 는 5개,
--    recommend_places 는 8개(20261016000000).
--    home_picks 가 2줄이면 옛 함수(3개)가 남은 것 — 20261015000000 이 안 들어갔다.
select p.proname as 함수, pg_get_function_identity_arguments(p.oid) as 인자,
       has_function_privilege('anon', p.oid, 'execute') as 비회원_실행
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('home_picks', 'places_nearest', 'recommend_places', 'distance_km')
 order by 1;
