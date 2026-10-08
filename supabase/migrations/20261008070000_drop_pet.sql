-- 반려견 관련 값을 모두 지운다 — 동행인 'pet' · 취향 태그 '반려견 동반'
--
-- 반려견 동반 여부를 판단할 근거가 수집 데이터에 없다(TourAPI 의 반려동물 정보는
-- 별도 서비스라 받지 않는다). 고를 수는 있는데 어디에도 반영되지 않는 선택지라
-- 화면에서 뺐고, 저장된 값도 함께 정리한다.
--
--   · trips · shared_plans 의 companions 에서 'pet' 을 뺀다. 'pet' 하나만 있던 행은
--     빈 배열이 된다 — 동행인은 고르지 않아도 되는 값이다(기본값 '{}').
--   · profiles.taste_tags 에서 '반려견 동반' 을 뺀다.
--   · 동행인 값 검사(REVIEW-08, 20260923000000)를 'pet' 없이 다시 건다.
--     값을 먼저 정리해야 새 제약이 걸린다.

update public.trips
   set companions = array_remove(companions, 'pet')
 where 'pet' = any(companions);

update public.shared_plans
   set companions = array_remove(companions, 'pet')
 where 'pet' = any(companions);

update public.profiles
   set taste_tags = array_remove(taste_tags, '반려견 동반')
 where '반려견 동반' = any(taste_tags);

alter table public.trips drop constraint trips_companions_valid;
alter table public.trips add constraint trips_companions_valid
  check (companions <@ array['solo', 'couple', 'friends', 'family']::text[]);

alter table public.shared_plans drop constraint shared_plans_companions_valid;
alter table public.shared_plans add constraint shared_plans_companions_valid
  check (companions <@ array['solo', 'couple', 'friends', 'family']::text[]);
