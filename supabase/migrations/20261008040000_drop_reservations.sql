-- =====================================================================
-- 예약 기능(RSV-05-01)을 걷어낸다
--
-- 앱에서 예약 화면 · 홈 '예약 확정' · 마이페이지 '예약 내역' · 타임라인 '예약
-- 확정' 배지를 모두 뺐다. 실제 결제(PG) 연동 없이 UI 만 있던 기능이라 쌓인
-- 예약 행은 실제 예약이 아니다. 테이블째 지운다 — 되돌릴 수 없다.
--
-- 함께 정리하는 것
--   · reservation_status enum — 이 테이블만 썼다.
--   · trip_item_status 의 'reserved' — "예약이 걸린 상태"라는 뜻으로 남아 있었는데
--     앱이 이 값을 쓴 적이 없다. 'waiting' 을 뺄 때(20261001040000)와 같은 방법으로
--     타입을 새로 만든다. 혹시 있는 행은 'planned'(담기만 한 상태)로 되돌린다.
--
-- 정책 · 인덱스 · 외래키는 테이블과 함께 사라진다.
-- =====================================================================

drop table public.reservations;
drop type reservation_status;

update public.trip_items set status = 'planned' where status = 'reserved';

-- 기본값이 타입에 묶여 있어 먼저 떼어 둔다. 떼지 않으면 타입 변경이 막힌다.
alter table public.trip_items alter column status drop default;

alter type trip_item_status rename to trip_item_status_old;

create type trip_item_status as enum ('planned', 'visited');

alter table public.trip_items
  alter column status type trip_item_status
  using status::text::trip_item_status;

alter table public.trip_items alter column status set default 'planned';

drop type trip_item_status_old;
