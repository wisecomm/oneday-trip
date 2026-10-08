-- places.price_level(가격대)을 지운다
--
-- TourAPI 에 가격 정보가 없어 수집 스크립트가 모든 장소에 고정값 2를 넣어 왔다
-- (15,518곳 전부 2). 화면은 이를 '₩₩'로 보여 줘 '보통 가격'이라는 거짓 정보가
-- 됐고, 표시는 c047a37 에서 걷어냈다. 추천 · 정렬도 이 값을 쓰지 않는다.
-- 근거가 될 출처가 생기면 그때 다시 만든다.
alter table public.places drop column price_level;
