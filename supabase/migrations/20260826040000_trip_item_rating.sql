-- 방문 리뷰에 별점(1~5)을 추가한다. 소감 텍스트(note)와 함께 한 번에 저장·수정된다.
alter table public.trip_items add column if not exists rating smallint check (rating between 1 and 5);
