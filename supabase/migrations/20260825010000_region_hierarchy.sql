-- =====================================================================
-- 목적지 지역을 '시/도 → 구/시' 2단 계층으로 재구성
--
-- 지금까지 regions 는 '서울 성수'처럼 시와 동네가 한 문자열에 뒤섞인 평평한
-- 4행짜리 테이블이었다. 실제 주소 데이터를 보면 지역별 밀도가 크게 달라
-- (서울·경주는 구가 사실상 1개, 부산은 11개 구·군에 흩어짐), 이번에 상위
-- (시/도) · 하위(구/시) 2단 구조로 다시 짠다.
--
-- 리프(하위) 이름은 '부산 서구' 처럼 그룹명을 붙여 전역 유일성을 보장한다.
-- ('강서구' 안에 '서구' 가 부분 문자열로 들어있어 접두어 없이는 다른 도시의
--  같은 이름 구와 충돌할 여지가 있다.)
-- =====================================================================

create table public.region_groups (
  name        text primary key,
  lat         double precision not null,
  lng         double precision not null,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.region_groups (name, lat, lng, sort_order) values
  ('서울', 37.5449, 127.0504, 0),
  ('제주', 33.4257, 126.5857, 1),
  ('부산', 35.1239, 129.0716, 2),
  ('경북', 35.8288, 129.2361, 3);

alter table public.regions enable row level security;
alter table public.region_groups enable row level security;

create policy "region groups are readable by everyone"
  on public.region_groups for select
  using (true);

alter table public.regions add column group_name text references public.region_groups(name);
create index regions_group_name_idx on public.regions (group_name, sort_order);

-- 새 하위(구/시) 지역 15개를 추가한다 — 기존 4행과 잠시 공존시킨 뒤 아래에서 정리한다
insert into public.regions (name, lat, lng, sort_order, group_name) values
  ('서울 성동구', 37.5451, 127.0492, 0, '서울'),
  ('제주 제주시', 33.477, 126.6075, 0, '제주'),
  ('제주 서귀포시', 33.2896, 126.5884, 1, '제주'),
  ('부산 해운대구', 35.1649, 129.1677, 0, '부산'),
  ('부산 기장군', 35.2953, 129.1997, 1, '부산'),
  ('부산 부산진구', 35.1591, 129.0593, 2, '부산'),
  ('부산 수영구', 35.1608, 129.112, 3, '부산'),
  ('부산 서구', 35.0576, 129.0172, 4, '부산'),
  ('부산 중구', 35.1016, 129.0261, 5, '부산'),
  ('부산 사하구', 35.1004, 129.0048, 6, '부산'),
  ('부산 남구', 35.1505, 129.0898, 7, '부산'),
  ('부산 연제구', 35.1763, 129.0905, 8, '부산'),
  ('부산 강서구', 35.116, 128.8935, 9, '부산'),
  ('부산 금정구', 35.2539, 129.055, 10, '부산'),
  ('경북 경주시', 35.8349, 129.2747, 0, '경북');

-- 각 장소를 새 하위 지역으로 재태깅한다 (주소를 직접 파싱해 매핑했으므로 id 단위로 명시한다)
update public.places set region = '서울 성동구' where id = 'p-tour-2899749';
update public.places set region = '서울 성동구' where id = 'p-tour-2895145';
update public.places set region = '서울 성동구' where id = 'p-tour-2373394';
update public.places set region = '서울 성동구' where id = 'p-tour-2895179';
update public.places set region = '서울 성동구' where id = 'p-tour-2893900';
update public.places set region = '서울 성동구' where id = 'p-tour-2900742';
update public.places set region = '서울 성동구' where id = 'p-tour-2900388';
update public.places set region = '서울 성동구' where id = 'p-tour-2870210';
update public.places set region = '서울 성동구' where id = 'p-tour-2900881';
update public.places set region = '서울 성동구' where id = 'p-tour-2835889';
update public.places set region = '서울 성동구' where id = 'p-tour-2899351';
update public.places set region = '서울 성동구' where id = 'p-tour-2901160';
update public.places set region = '서울 성동구' where id = 'p-tour-2900760';
update public.places set region = '서울 성동구' where id = 'p-tour-822861';
update public.places set region = '서울 성동구' where id = 'p-tour-753994';
update public.places set region = '서울 성동구' where id = 'p-tour-2745594';
update public.places set region = '서울 성동구' where id = 'p-tour-309302';
update public.places set region = '서울 성동구' where id = 'p-tour-753989';
update public.places set region = '서울 성동구' where id = 'p-tour-2850614';
update public.places set region = '서울 성동구' where id = 'p-tour-2722936';
update public.places set region = '제주 제주시' where id = 'p-tour-2666735';
update public.places set region = '제주 제주시' where id = 'p-tour-2767638';
update public.places set region = '제주 제주시' where id = 'p-tour-1876994';
update public.places set region = '제주 제주시' where id = 'p-tour-2860639';
update public.places set region = '제주 제주시' where id = 'p-tour-2902758';
update public.places set region = '제주 제주시' where id = 'p-tour-2864237';
update public.places set region = '제주 제주시' where id = 'p-tour-2841345';
update public.places set region = '제주 제주시' where id = 'p-tour-2715354';
update public.places set region = '제주 서귀포시' where id = 'p-tour-2804378';
update public.places set region = '제주 서귀포시' where id = 'p-tour-2755445';
update public.places set region = '제주 제주시' where id = 'p-tour-2778916';
update public.places set region = '제주 서귀포시' where id = 'p-tour-2777791';
update public.places set region = '제주 서귀포시' where id = 'p-tour-2802732';
update public.places set region = '제주 서귀포시' where id = 'p-tour-126439';
update public.places set region = '제주 제주시' where id = 'p-tour-1884521';
update public.places set region = '제주 제주시' where id = 'p-tour-2791433';
update public.places set region = '제주 서귀포시' where id = 'p-tour-126441';
update public.places set region = '제주 제주시' where id = 'p-tour-2023328';
update public.places set region = '제주 제주시' where id = 'p-tour-2723542';
update public.places set region = '제주 서귀포시' where id = 'p-tour-138185';
update public.places set region = '부산 부산진구' where id = 'p-tour-841730';
update public.places set region = '부산 기장군' where id = 'p-tour-2872442';
update public.places set region = '부산 기장군' where id = 'p-tour-2872395';
update public.places set region = '부산 해운대구' where id = 'p-tour-843489';
update public.places set region = '부산 부산진구' where id = 'p-tour-2773623';
update public.places set region = '부산 중구' where id = 'p-tour-2726193';
update public.places set region = '부산 해운대구' where id = 'p-tour-2891868';
update public.places set region = '부산 기장군' where id = 'p-tour-2752996';
update public.places set region = '부산 사하구' where id = 'p-tour-2852408';
update public.places set region = '부산 남구' where id = 'p-tour-2891745';
update public.places set region = '부산 연제구' where id = 'p-tour-2759629';
update public.places set region = '부산 강서구' where id = 'p-tour-2756678';
update public.places set region = '부산 해운대구' where id = 'p-tour-2891887';
update public.places set region = '부산 금정구' where id = 'p-tour-298099';
update public.places set region = '부산 수영구' where id = 'p-tour-128134';
update public.places set region = '부산 수영구' where id = 'p-tour-129140';
update public.places set region = '부산 서구' where id = 'p-tour-2614716';
update public.places set region = '부산 해운대구' where id = 'p-tour-128810';
update public.places set region = '부산 서구' where id = 'p-tour-2614725';
update public.places set region = '부산 해운대구' where id = 'p-tour-2617724';
update public.places set region = '경북 경주시' where id = 'p-tour-133964';
update public.places set region = '경북 경주시' where id = 'p-tour-2876577';
update public.places set region = '경북 경주시' where id = 'p-tour-403847';
update public.places set region = '경북 경주시' where id = 'p-tour-2840527';
update public.places set region = '경북 경주시' where id = 'p-tour-2736719';
update public.places set region = '경북 경주시' where id = 'p-tour-2839097';
update public.places set region = '경북 경주시' where id = 'p-tour-2838704';
update public.places set region = '경북 경주시' where id = 'p-tour-3101705';
update public.places set region = '경북 경주시' where id = 'p-tour-2765063';
update public.places set region = '경북 경주시' where id = 'p-tour-2876473';
update public.places set region = '경북 경주시' where id = 'p-tour-2840968';
update public.places set region = '경북 경주시' where id = 'p-tour-2840841';
update public.places set region = '경북 경주시' where id = 'p-tour-136208';
update public.places set region = '경북 경주시' where id = 'p-tour-128430';
update public.places set region = '경북 경주시' where id = 'p-tour-1958111';
update public.places set region = '경북 경주시' where id = 'p-tour-1958053';
update public.places set region = '경북 경주시' where id = 'p-tour-590997';
update public.places set region = '경북 경주시' where id = 'p-tour-337505';
update public.places set region = '경북 경주시' where id = 'p-tour-319572';

-- 이제 참조하는 곳이 없는 옛 시/도 단위 4행을 지운다
delete from public.regions where name in ('서울 성수', '제주', '부산', '경주');

