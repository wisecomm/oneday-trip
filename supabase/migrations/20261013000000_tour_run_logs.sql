-- 연동 로그를 DB 에 — tour.run_logs (줄 단위 · 30일 보관)
--
-- 수집(collect.mjs) · 반영(load.mjs)이 화면에 찍는 줄을 실행(tour.runs)마다 남긴다.
-- 예전에는 Mac 의 raw/logs/*.log 파일, 파일을 없앤 뒤로는 /tmp 에만 있었다.

-- 실행 한 번의 화면 출력 — 줄 하나에 한 행 (예전 raw/logs/*.log)
-- 수집 · 반영 스크립트가 찍는 줄을 몇 줄마다 바로 넣으므로, 실행 도중 죽어도 그때까지는
-- 남는다. 30일 지난 줄은 실행이 끝날 때마다 지운다(실행 요약 tour.runs 는 남긴다).
create table tour.run_logs (
  id         bigint generated always as identity primary key,
  run_id     bigint not null references tour.runs on delete cascade,
  seq        integer not null,               -- 그 실행 안에서의 줄 순서
  logged_at  timestamptz not null default now(),
  level      text not null check (level in ('info', 'error')),
  message    text not null
);

create index run_logs_run_idx on tour.run_logs (run_id, seq);
create index run_logs_logged_at_idx on tour.run_logs (logged_at);

grant select, insert, update, delete on tour.run_logs to tour_collector;
grant usage on all sequences in schema tour to tour_collector;
