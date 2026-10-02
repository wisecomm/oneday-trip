-- =====================================================================
-- 사용자 장소 등록을 걷어낸다 (PLACE-07-02·03 종료)
--
-- 근거: intent/2026-09-20-플랜-공유/intent.md 4번 · 13 Q21
--
-- 결정: 사용자가 장소를 요청하는 길은 만들지 않는다. 카탈로그에 없는 가게는
-- 관리자가 직접 등록한다(PLACE-07-01, admin_create_place).
--
-- 화면을 안 만든 채 DB 만 남겨 두는 상태가 2026-09-20 부터 이어졌는데, 그때는
-- "나중에 열 수도 있으니 빈 테이블 하나의 비용은 거의 없다"였다. 지금은 열지
-- 않기로 정했으므로 남겨 둘 이유가 사라졌다. 보류와 종료는 다르다.
--
-- 쓰지 않는 쓰기 경로를 열어 두지 않는 것이 핵심이다. place_requests 에는
-- "로그인한 누구나 자기 이름으로 insert" 정책이 걸려 있었고, approve 함수는
-- security definer 로 places 에 쓸 권한을 갖고 있었다. 아무도 쓰지 않는
-- 경로지만 열려 있기는 했다. 2026-10-01 에 신고 기능을 걷어낸 것과 같은
-- 이유다.
--
-- manual_place_seq 는 남긴다 — 관리자 직접 등록(admin_create_place)이 같은
-- 시퀀스로 m- 번호를 매긴다. 이걸 지우면 id 가 m-000001 부터 다시 시작해
-- 기존 행과 충돌한다.
--
-- places.created_by 도 남긴다. 지금은 관리자만 채우지만 "누가 넣었는가"는
-- 등록 경로와 무관하게 쓸모가 있다.
-- =====================================================================

-- 승인·반려 함수 (테이블보다 먼저 — 테이블을 참조한다)
drop function if exists public.approve_place_request(uuid);
drop function if exists public.reject_place_request(uuid, text);

-- 테이블 (딸린 인덱스·RLS 정책은 함께 사라진다)
drop table if exists public.place_requests;

-- 이 enum 을 쓰는 곳이 더는 없다
drop type if exists place_request_status;
