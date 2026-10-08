-- 2026-10-08 운영 반영 점검 — Supabase SQL 편집기에서 ①~④ 를 하나씩 선택해 실행
-- (편집기는 여러 문장을 한꺼번에 돌리면 마지막 결과만 보여 준다)
-- 기대값: ① t · t · t · {planned,visited}  ② 어긋난_장소 0  ③ 5행(명소 3 · 밥집 1 · 카페 1)  ④ dash_dash 1(원문 오타) · 여러줄 약 3,000

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
