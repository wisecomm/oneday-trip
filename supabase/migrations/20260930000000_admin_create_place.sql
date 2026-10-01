-- =====================================================================
-- 관리자 직접 장소 등록 (PLACE-07-01)
--
-- 근거: intent/2026-09-20-플랜-공유/intent.md 4-3
--   관리자는 places 에 바로, 사용자는 place_requests 를 거쳐 승인된 뒤에.
--
-- 앞선 마이그레이션은 사용자 경로(approve_place_request)만 만들었다.
-- 관리자 경로가 비어 있어 여기서 채운다.
-- =====================================================================

-- 클라이언트가 id 를 만들게 두지 않는다. 'm-000001' 규약과 시퀀스의 주인이
-- 둘이 되면 approve_place_request 가 매기는 번호와 어긋나고, 결국 규약이
-- 지켜지는지 아무도 모르게 된다. 두 경로가 같은 시퀀스를 쓴다.
--
-- 파라미터의 지역 코드를 integer 로 받는 이유: PostgREST 는 JSON 숫자를
-- integer 로 넘기므로 smallint 로 선언하면 함수를 찾지 못할 수 있다.
create or replace function public.admin_create_place(
  p_name              text,
  p_category          place_category,
  p_address           text,
  p_lat               double precision,
  p_lng               double precision,
  p_tour_area_code    integer,
  p_tour_sigungu_code integer,
  p_image_url         text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_place_id text;
begin
  if not public.is_admin() then
    raise exception '관리자만 장소를 등록할 수 있습니다' using errcode = '42501';
  end if;

  -- 미판정(-1)은 판정에 실패한 수집 행을 격리하는 자리다. 사람이 고른
  -- 지역에는 나타날 수 없다.
  if p_tour_sigungu_code < 0 then
    raise exception '시군구를 골라 주세요' using errcode = '22023';
  end if;

  v_place_id := 'm-' || lpad(nextval('public.manual_place_seq')::text, 6, '0');

  insert into public.places
    (id, name, category, tour_area_code, tour_sigungu_code, address, lat, lng,
     image_url, source, created_by, region_source)
  values
    (v_place_id, p_name, p_category, p_tour_area_code::smallint,
     p_tour_sigungu_code::smallint, p_address, p_lat, p_lng,
     p_image_url, 'manual', auth.uid(), 'manual');

  return v_place_id;
end;
$$;

revoke all on function public.admin_create_place(
  text, place_category, text, double precision, double precision, integer, integer, text
) from public;
grant execute on function public.admin_create_place(
  text, place_category, text, double precision, double precision, integer, integer, text
) to authenticated;
