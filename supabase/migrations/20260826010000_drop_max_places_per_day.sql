-- 하루 최대 방문 리스트(1~5곳 제한) 기능 제거.
-- 동선 피로도 제약이 실제 사용에는 방해만 됐고, 담는 개수는 사용자 판단에
-- 맡기는 편이 낫다고 판단했다. AI 추천 자동 담기 개수는 앱 코드에서 상수(3)로
-- 고정한다.
alter table public.trips drop column if exists max_places_per_day;
