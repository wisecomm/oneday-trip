-- =====================================================================
-- 신고 기능을 걷어낸다 (plan_reports · 자동 숨김)
--
-- 근거: intent/2026-09-20-플랜-공유/intent.md 13 Q16
--
-- 결정: 사용자가 공유하면 확인 없이 바로 목록에 뜨고, 신고 개념은 두지
-- 않는다. 공개 전 승인 단계는 애초에 없었으므로 그 부분은 바뀌는 것이
-- 없고, 사후 통제 수단인 신고만 사라진다.
--
-- 왜 테이블째 빼는가. 화면에서만 숨기면 쓰지 않는 테이블과 insert 트리거가
-- DB 에 남는다. 그 트리거는 security definer 로 돌면서 shared_plans 를
-- 갱신할 권한을 갖고 있어, 아무도 쓰지 않는 쓰기 경로가 계속 열려 있는
-- 셈이 된다. 되살릴 일이 생기면 그때 다시 만드는 편이 낫다.
--
-- 플랜을 숨기는 경로는 둘만 남는다.
--   · place_removed — 장소가 지워져 동선이 깨질 때. 트리거가 자동으로 건다.
--   · admin         — 관리자가 직접 내릴 때. 그대로 둔다.
-- 따라서 plan_hidden_reason 에서 'reported' 도 뺀다. Postgres 는 enum 값을
-- 지울 수 없어 타입을 새로 만들어 갈아 끼운다. 기존에 신고로 내려간 행이
-- 있으면 'admin' 으로 옮긴다 — 사람이 판단해 내린 것과 같은 상태로 본다.
-- =====================================================================

-- 1) 트리거와 함수
drop trigger if exists plan_reports_autohide_trigger on public.plan_reports;
drop function if exists public.plan_reports_autohide();

-- 2) 테이블 (딸린 인덱스·RLS 정책은 함께 사라진다)
drop table if exists public.plan_reports;

-- 3) hidden_reason 에서 'reported' 제거
update public.shared_plans
   set hidden_reason = 'admin'
 where hidden_reason = 'reported';

alter type plan_hidden_reason rename to plan_hidden_reason_old;

create type plan_hidden_reason as enum ('place_removed', 'admin');

alter table public.shared_plans
  alter column hidden_reason type plan_hidden_reason
  using hidden_reason::text::plan_hidden_reason;

drop type plan_hidden_reason_old;
