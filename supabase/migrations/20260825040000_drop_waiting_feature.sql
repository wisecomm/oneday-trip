-- 원격 웨이팅(줄서기) 기능 제거.
-- places.phone 추가로 장소 상세에서 바로 전화 연결이 가능해져, 대신 쓰던
-- 원격 웨이팅 신청/대기 순번 기능을 걷어낸다. 실시간 예약(reservations)은 그대로 둔다.

drop table if exists public.waitings;
drop type if exists waiting_status;

alter table public.places drop column if exists waiting_count;
alter table public.profiles drop column if exists waiting_sensitivity;
