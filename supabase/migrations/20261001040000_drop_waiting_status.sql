-- =====================================================================
-- trip_item_status 에서 'waiting' 잔여값을 뺀다
--
-- 근거: intent/2026-09-23-디비-검토/intent.md 6번 (보류 → 해제)
--
-- 웨이팅 기능은 20260825040000_drop_waiting_feature.sql 로 제거됐는데 enum 에
-- 값만 남아 있었다. 그때 보류한 이유는 "해를 끼치지 않고, 빼려면 타입을 새로
-- 만들어 컬럼을 재캐스팅해야 해서 얻는 것에 비해 건드릴 면적이 크다" 였다.
--
-- 지금 푸는 이유는 그 면적을 오늘 이미 두 번 다뤘기 때문이다. plan_hidden_reason
-- 에서 'reported' 를 뺄 때(20261001020000) 같은 작업을 했고, 방법이 손에 있다.
-- 쓰지 않는 값이 enum 에 남아 있으면 이 상태가 무엇을 뜻하는지 다음 사람이
-- 코드에서 다시 찾아봐야 한다.
--
-- 남은 값 셋은 각각 쓰인다.
--   planned  — 담기만 한 상태 (기본값)
--   reserved — 예약이 걸린 상태
--   visited  — 리뷰를 쓴 상태. 플랜 올리기 조건이 이 값을 본다 (Q19)
--
-- 기존 행에 'waiting' 이 있으면 'planned' 로 되돌린다. 웨이팅은 "줄 서는 중"
-- 이었으니 기능이 사라진 지금은 '담아만 둔 상태' 가 가장 가깝다.
-- =====================================================================

update public.trip_items set status = 'planned' where status = 'waiting';

-- 기본값이 타입에 묶여 있어 먼저 떼어 둔다. 떼지 않으면 타입 변경이 막힌다.
alter table public.trip_items alter column status drop default;

alter type trip_item_status rename to trip_item_status_old;

create type trip_item_status as enum ('planned', 'reserved', 'visited');

alter table public.trip_items
  alter column status type trip_item_status
  using status::text::trip_item_status;

alter table public.trip_items alter column status set default 'planned';

drop type trip_item_status_old;
