-- 여행 일정 설정 화면에 하루 동선의 시작·종료 시각 입력을 추가한다.
-- 기본값 09:00~20:00 — 당일치기 서비스에서 흔히 쓰는 활동 시간대.
alter table public.trips add column if not exists start_time time not null default '09:00';
alter table public.trips add column if not exists end_time   time not null default '20:00';
