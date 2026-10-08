-- places.source_rating(출처 TourAPI 의 평점)을 지운다
--
-- TourAPI 는 평점을 주지 않아 15,518곳 전부 null 이었다. 화면 · 추천 점수에서
-- 이 칸을 읽던 곳은 오늘 모두 사용자 리뷰 평균(rating_avg · rating_count)으로
-- 바꿨다(0c65be9 · ff69408). 남은 사용처가 없다.
--
-- 이 칸이 남긴 교훈 — 평점이 없으면 0 이 아니라 null — 은 rating_avg 들이
-- 그대로 따른다. 다른 출처의 평점을 받게 되면 그때 다시 만든다.
alter table public.places drop column source_rating;
