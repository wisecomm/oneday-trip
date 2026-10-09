-- 수집 원본을 파일(raw/) 대신 DB 에 — tour 스키마 · tour_collector 역할
--
-- 검토: intent/2026-10-09-서버-수집-검토/검토.md (1단계)
--
-- 지금은 테이블만 만든다. 수집(collect.mjs) · 변환(load.mjs)은 아직 파일을 쓰고,
-- 다음 단계에서 지금 raw/ 를 이 테이블들에 한 번 적재한 뒤 읽고 쓰는 곳을 옮긴다.
-- places 에 쓰는 권한은 바로 반영 단계(5단계)에서 따로 준다.

-- ── 수집 원본 (tour 스키마) ─────────────────────────────────────────
-- TourAPI 에서 받은 원본과 수집 상태. 예전에는 수집 폴더의 raw/ 파일이었다
-- (intent/2026-10-09-서버-수집-검토/검토.md). 앱 API 에 열지 않는다 — config.toml 의
-- 노출 스키마에 없고, anon · authenticated 에 아무 권한도 주지 않는다. 수집 작업만
-- tour_collector 역할로 접속한다.
create schema tour;

-- 시/도 · 시군구 코드표 (raw/area-codes.json · sigungu-N.json)
create table tour.code_tables (
  name        text primary key,          -- 'area-codes' · 'sigungu-1' … (파일 이름에서 .json 뺀 것)
  data        jsonb not null,            -- 응답 항목 배열 그대로
  fetched_at  timestamptz not null default now()
);

-- 받은 목록 단위 (raw/places-시도-시군구-타입.json 이 있다는 사실)
-- 행이 있으면 그 시군구 × 타입의 목록은 받은 것이다 — 다시 받지 않고, 바뀐 장소는
-- 목록 갱신이 list_items 에 반영한다.
create table tour.list_fetches (
  area_code     smallint not null,
  sigungu_code  smallint not null,       -- 시군구가 없는 시/도는 0 (파일 이름 규칙 그대로)
  content_type  smallint not null,
  fetched_at    timestamptz not null default now(),
  primary key (area_code, sigungu_code, content_type)
);

-- 목록 항목 — 장소 하나에 한 행 (raw/places-*.json 의 항목 + hidden.json)
-- 표출 중단된 장소는 지우지 않고 hidden_at 을 채운다. 다시 표출되면 비운다.
create table tour.list_items (
  contentid     text primary key,
  content_type  smallint not null,
  area_code     smallint not null,
  sigungu_code  smallint not null,
  modified      text,                    -- 목록 modifiedtime (YYYYMMDDHHMMSS, 한국 시각)
  item          jsonb not null,          -- 목록 항목 원본
  hidden_at     timestamptz,             -- 표출 중단을 본 시각. null 이면 표출 중
  hidden_mt     text,                    -- 그때 동기화 목록의 수정일
  updated_at    timestamptz not null default now(),
  foreign key (area_code, sigungu_code, content_type)
    references tour.list_fetches (area_code, sigungu_code, content_type)
);

-- 목록 갱신이 타입별 수정일 순으로 훑는다
create index list_items_type_modified_idx on tour.list_items (content_type, modified);

-- 상세 — 장소 하나에 한 행 (raw/detail-*.json 의 항목)
-- mt 는 받을 때의 목록 수정일이다. list_items.modified 와 다르면 다시 받는다.
create table tour.details (
  contentid   text primary key references tour.list_items on delete cascade,
  common      jsonb,                     -- detailCommon2 첫 항목 (없으면 null)
  intro       jsonb,                     -- detailIntro2 첫 항목 (없으면 null)
  mt          text,
  fetched_at  timestamptz not null default now()
);

-- 수집 상태 (raw/sync-state.json) — 목록 갱신 기준 시각 · 사라진 장소 확인 날짜 등
create table tour.sync_state (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- 실행 기록 (raw/logs/ · summary.txt)
create table tour.runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  host         text,                     -- 'mac' · 'github-actions' …
  calls        integer not null default 0,
  result       jsonb not null default '{}'::jsonb,
  error        text
);

-- 지난번 places 에 반영한 변환 결과의 지문 — 다음 반영 때 바뀐 장소만 고르는 데 쓴다
create table tour.place_out (
  id          text primary key,          -- places.id (= contentid)
  hash        text not null,
  applied_at  timestamptz not null default now()
);

-- 수집 작업 전용 역할. 로그인은 여기서 열지 않는다 — 비밀번호는 사람이 SQL 편집기에서
--   alter role tour_collector with login password '…';
-- 로 정한다(마이그레이션 · git 에 비밀번호를 남기지 않는다). 역할은 클러스터 단위라
-- 이미 있으면 그대로 쓴다.
do $$
begin
  create role tour_collector nologin;
exception when duplicate_object then null;
end
$$;

revoke all on schema tour from public;
-- Supabase 기본 권한이 새 스키마에 번지지 않게 한 번 더 걷는다(이미 없으면 아무 일도 안 함)
revoke all on all tables in schema tour from anon, authenticated;
grant usage on schema tour to tour_collector;
grant select, insert, update, delete on all tables in schema tour to tour_collector;
grant usage on all sequences in schema tour to tour_collector;
