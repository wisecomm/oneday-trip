-- distance_km() 실행 권한을 명시한다
--
-- home_picks() 는 security invoker 라 호출한 사람(anon · authenticated)의 권한으로
-- distance_km() 를 부른다. 지금은 Postgres 기본값(새 함수는 PUBLIC 실행 가능)에 기대어
-- 돌고 있는데, Supabase 가 새로 만든 객체를 API 역할에 자동으로 열지 않는 쪽으로
-- 바뀌는 중이다(config.toml 의 auto_expose_new_tables 주석). 다른 함수들처럼
-- PUBLIC 을 걷고 쓸 역할에만 준다.
revoke all on function public.distance_km(double precision, double precision, double precision, double precision) from public;
grant execute on function public.distance_km(double precision, double precision, double precision, double precision)
  to anon, authenticated;
