-- =====================================================================
-- 장소 이름 검색 인덱스 (pg_trgm)
--
-- 근거: intent/2026-09-23-디비-검토/intent.md 5번 (보류 → 해제)
--
-- 검토 문서가 제안했을 때는 보류했다. 이유는 "그 필터를 넘기는 화면이 하나도
-- 없다" 였다 — PlaceFilter.keyword 가 db.ts 에만 있고 값을 채우는 곳이 없어
-- Full Table Scan 이 일어날 자리 자체가 없었다. 확장과 인덱스는 공짜가 아니니
-- 검색 UI 를 만들 때 함께 넣기로 했고, 지금이 그때다.
--
-- ilike '%키워드%' 는 앞뒤가 모두 열려 있어 B-tree 를 타지 못한다. 그대로 두면
-- 15,518행을 매번 전부 훑는다. pg_trgm 의 삼중자(trigram) GIN 인덱스는 이
-- 패턴을 탈 수 있다.
--
-- gin_trgm_ops 를 쓰는 이유: gist 보다 조회가 빠르고, 장소 이름은 한 번 적재된
-- 뒤 거의 바뀌지 않아 갱신 비용이 문제가 되지 않는다.
--
-- ── 한글에는 로케일이 걸려 있다 (2026-10-02 실측) ──────────────────────
-- pg_trgm 은 로케일을 보고 글자를 가른다. DB 로케일이 'C' 면 한글에서
-- 삼중자가 **하나도** 안 나온다.
--
--   locale C     : select show_trgm('양산국밥') → {}
--   locale C.utf8: select show_trgm('양산국밥') → {0x87599f, 0xa6b13d, ...}
--
-- 삼중자가 없으면 인덱스는 걸리긴 해도 거르지를 못한다. 임시 Postgres 16 에
-- 장소 15,000건을 넣고 재현했다.
--
--   C      : Bitmap Index Scan → 15,001행 반환, 14,999행을 recheck 로 버림
--   C.utf8 : Bitmap Index Scan → 1행 반환, heap block 1개
--
-- 즉 이 인덱스의 값어치는 운영 DB 의 로케일에 달려 있다. 확인은 한 줄이다.
--
--   select datcollate, datctype from pg_database where datname = current_database();
--
-- **운영 DB 는 en_US.UTF-8 로 확인했다 (2026-10-02).** 한글 삼중자가 나오므로
-- 이 인덱스는 제 몫을 한다.
--
-- 만약 어떤 환경이 'C' 로 나온다면 거기서는 이 인덱스가 한글 검색에 도움이
-- 안 된다. 그때는 이름을 미리 쪼개 둔 검색용 컬럼을 두거나 전문 검색
-- (tsvector)으로 길을 바꿔야 한다 — 로케일은 DB 를 다시 만들지 않으면 못 바꾼다.
-- =====================================================================

create extension if not exists pg_trgm;

create index if not exists places_name_trgm_idx
  on public.places using gin (name gin_trgm_ops);
