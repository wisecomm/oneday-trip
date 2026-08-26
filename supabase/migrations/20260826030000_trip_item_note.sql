-- 방문 완료·소감 작성·SNS 포스팅을 하나의 버튼에서 분리하면서, 소감을 저장할
-- 자리가 필요해졌다. 작성/수정만 하는 단일 텍스트라 이력 테이블 없이 컬럼 하나로 둔다.
alter table public.trip_items add column if not exists note text;
