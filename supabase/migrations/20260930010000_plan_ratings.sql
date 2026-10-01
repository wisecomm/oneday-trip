-- =====================================================================
-- 플랜 만족도 (SHARE-06-07)
--
-- 근거: intent/2026-09-20-플랜-공유/intent.md 17번
--
-- 7-D5 에 "장소 평점이 전부 null 이라 담은 수가 첫 번째 인기 신호"라고 적어
-- 두었다. 담은 수는 '고르게 만드는 힘'은 재지만 '실제로 좋았는지'는 재지
-- 못한다. 만족도가 두 번째이자 더 나은 신호다.
--
-- 그러려면 먼저 "이 여행이 어느 플랜에서 왔는지"를 알아야 한다. 지금은
-- clone_shared_plan 이 여행을 만들기만 하고 출처를 남기지 않아, 누가 담았는지
-- 알 수 없다 — 담지도 않은 사람의 별점을 막을 방법이 없다는 뜻이다.
-- =====================================================================

-- ── 1. 담아 간 여행의 출처 ───────────────────────────────────────────
-- on delete set null: 플랜이 지워져도 이미 담아 간 여행은 그대로 남는다.
-- 담기는 복제이지 참조가 아니다 (7-D4).
alter table public.trips
  add column if not exists source_plan_id uuid references public.shared_plans on delete set null;

create index if not exists trips_source_plan_idx on public.trips (source_plan_id);

-- ── 2. 집계 컬럼 ─────────────────────────────────────────────────────
-- 정렬에 쓰려고 비정규화한다. 목록마다 평균을 다시 세면 플랜이 늘수록 느려진다.
alter table public.shared_plans
  add column if not exists rating_avg numeric(2,1);

alter table public.shared_plans
  add column if not exists rating_count integer not null default 0;

-- ── 3. 만족도 ────────────────────────────────────────────────────────
create table if not exists public.plan_ratings (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.shared_plans on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  -- 한 줄 소감. 별점만 있으면 왜 그런지 다음 사람이 알 수 없다.
  comment    text check (comment is null or char_length(comment) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 한 사람이 한 플랜에 한 번. 여러 번 담아도 평가는 하나다.
  unique (plan_id, user_id)
);

create index if not exists plan_ratings_plan_idx on public.plan_ratings (plan_id);
create index if not exists plan_ratings_user_idx on public.plan_ratings (user_id);

-- ── 4. 집계 갱신 ─────────────────────────────────────────────────────
-- security definer 여야 하는 이유: 평가자는 남의 shared_plans 행을 update 할
-- 권한이 없다. 트리거가 호출자 권한으로 돌면 RLS 에 막혀 집계가 조용히
-- 갱신되지 않는다 — 오류도 나지 않아 한참 뒤에야 알게 된다.
create or replace function public.plan_ratings_refresh()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  update public.shared_plans p
     set rating_count = agg.n,
         -- 평가가 없으면 0 이 아니라 null 이다. 0 으로 두면 '평가 없음'과
         -- '최하점'이 구분되지 않는다 — places.source_rating 에서 이미 겪었다.
         rating_avg   = case when agg.n = 0 then null else round(agg.avg, 1) end,
         updated_at   = now()
    from (
      select count(*)::integer as n, avg(rating)::numeric as avg
        from public.plan_ratings where plan_id = v_plan
    ) agg
   where p.id = v_plan;
  return null;
end;
$$;

drop trigger if exists plan_ratings_refresh_trigger on public.plan_ratings;
create trigger plan_ratings_refresh_trigger
  after insert or update or delete on public.plan_ratings
  for each row execute function public.plan_ratings_refresh();

-- ── 5. 담기가 출처를 남기도록 ────────────────────────────────────────
create or replace function public.clone_shared_plan(
  p_plan_id   uuid,
  p_trip_date date,
  p_title     text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan  public.shared_plans%rowtype;
  v_trip  uuid;
  v_user  uuid := auth.uid();
begin
  if v_user is null then
    raise exception '로그인이 필요합니다' using errcode = '42501';
  end if;

  select * into v_plan from public.shared_plans
   where id = p_plan_id and is_hidden = false;

  if not found then
    raise exception '플랜을 찾을 수 없습니다' using errcode = 'P0002';
  end if;

  insert into public.trips
    (user_id, title, tour_area_code, tour_sigungu_code,
     trip_date, start_time, end_time, companions, transport, source_plan_id)
  values
    (v_user, coalesce(p_title, v_plan.title), v_plan.tour_area_code,
     v_plan.tour_sigungu_code, p_trip_date, v_plan.start_time, v_plan.end_time,
     v_plan.companions, v_plan.transport, p_plan_id)
  returning id into v_trip;

  -- status 는 전부 planned 로, note·rating 은 비운 채로 들어간다.
  -- 여행의 시작 시각을 플랜과 같게 잡았으므로 planned_time 은 그대로 옮긴다.
  insert into public.trip_items (trip_id, place_id, sort_order, planned_time)
  select v_trip, i.place_id, i.sort_order, i.planned_time
    from public.shared_plan_items i
   where i.plan_id = p_plan_id
   order by i.sort_order;

  update public.shared_plans
     set clone_count = clone_count + 1
   where id = p_plan_id;

  return v_trip;
end;
$$;

-- ── 6. RLS ───────────────────────────────────────────────────────────
alter table public.plan_ratings enable row level security;

-- 별점은 공개 정보다. 몇 점인지 모르면 고를 근거가 없다.
drop policy if exists "ratings are readable" on public.plan_ratings;
create policy "ratings are readable"
  on public.plan_ratings for select
  using (true);

-- 담은 적 있는 사람만 평가한다. 담지도 않은 사람의 점수가 섞이면 그 숫자는
-- 믿을 게 못 된다. 자기 플랜은 평가할 수 없다.
--
-- trips 를 참조하지만 재귀 위험은 없다 — 다른 테이블이고, 평가자는 자기
-- 여행만 보이므로 trips 의 RLS 를 그대로 통과한다.
drop policy if exists "rate what i cloned" on public.plan_ratings;
create policy "rate what i cloned"
  on public.plan_ratings for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.trips t
       where t.source_plan_id = plan_id and t.user_id = auth.uid()
    )
    and not exists (
      select 1 from public.shared_plans p
       where p.id = plan_id and p.author_user_id = auth.uid()
    )
  );

drop policy if exists "update my rating" on public.plan_ratings;
create policy "update my rating"
  on public.plan_ratings for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "delete my rating" on public.plan_ratings;
create policy "delete my rating"
  on public.plan_ratings for delete
  using (user_id = auth.uid());
