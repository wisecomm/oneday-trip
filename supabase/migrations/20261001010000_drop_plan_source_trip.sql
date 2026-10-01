-- =====================================================================
-- shared_plans 에서 source_trip_id · source_updated_at 을 뺀다
--
-- 근거: intent/2026-09-20-플랜-공유/intent.md 7-D1
--
-- 두 컬럼은 "원본이 수정됨 · 다시 올리기" 배너를 위해 넣었는데, 실제로는
-- 제 몫을 하지 못했다.
--
--   · source_updated_at 은 쓰기만 하고 읽는 곳이 없다. 비교 대상인
--     trips.updated_at 이 아예 없어서 수정 여부를 알 방법 자체가 없다.
--   · source_trip_id 는 "원본 여행에서 다시 올리기" 링크 하나에만 쓰였는데,
--     publishFromTrip 이 항상 새로 insert 하므로 그 링크는 기존 플랜을
--     갱신하지 않고 같은 여행에서 나온 플랜을 하나 더 만든다.
--
-- 게다가 공개 테이블에 개인 여행의 id 를 실어 두는 것은 이 설계의 원칙과
-- 어긋난다. 7-D1 의 요지는 "공개하는 건 동선이지 일기가 아니다"인데, 남의
-- 비공개 여행 UUID 가 누구나 읽는 행에 들어 있었다. 내용은 RLS 가 막지만
-- 두 플랜이 같은 여행에서 나왔다는 사실은 밖에서 알 수 있다.
--
-- 운영자 플랜과 사용자 플랜의 구분은 origin 이 하므로 그 용도도 아니다.
--
-- 나중에 "다시 올리기"를 제대로 만들려면 trips.updated_at 을 추가하고
-- publishFromTrip 이 기존 플랜을 갱신하도록 고친 뒤, 그때 출처 컬럼을
-- 다시 넣으면 된다.
-- =====================================================================

alter table public.shared_plans drop column if exists source_trip_id;
alter table public.shared_plans drop column if exists source_updated_at;
