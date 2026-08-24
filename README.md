# 하루트립 — 위치기반 여행 일정 및 맛집 지도 서비스

`travel-map-ia-menu-list.xlsx` 의 IA · 기능정의 리스트 10개 항목을 그대로 구현한
React + Supabase 웹 애플리케이션입니다.

## 실행

```bash
npm install && npm run dev
```

`.env` 없이 바로 실행됩니다. 이 경우 앱은 **데모 모드**로 동작하며,
Supabase 대신 localStorage 를, 카카오맵 대신 SVG 폴백 지도를 사용합니다.
모든 화면과 로직은 동일하게 작동합니다.

## 기능 코드 ↔ 구현 매핑

| 기능 코드 | 화면명 | 라우트 | 구현 파일 |
|---|---|---|---|
| SYS-01-01 | 소셜 로그인 | `/login` | [LoginPage.tsx](src/pages/LoginPage.tsx) |
| SYS-01-02 | 사용자 등록 | `/onboarding` | [ProfileSetupPage.tsx](src/pages/ProfileSetupPage.tsx) |
| TRIP-02-01 | 여행 일정 설정 | `/trips/new` | [TripCreatePage.tsx](src/pages/TripCreatePage.tsx) |
| TRIP-02-02 | 방문 제약 조건 지정 | `/trips/:id/rules` | [TripRulesPage.tsx](src/pages/TripRulesPage.tsx) |
| TRIP-03-01 | 일자별 여행 리스트 | `/trips/:id` | [TimelinePage.tsx](src/pages/TimelinePage.tsx) |
| TRIP-03-02 | 동선 최적화 지도 | `/trips/:id/route` | [RoutePage.tsx](src/pages/RoutePage.tsx) |
| MAP-04-01 | 실시간 지도 홈 | `/map` | [ExplorePage.tsx](src/pages/ExplorePage.tsx) |
| MAP-04-02 | 맥락 인지 추천 피드 | `/recommend` | [RecommendPage.tsx](src/pages/RecommendPage.tsx) |
| RSV-05-01 | 레스토랑 상세 및 예약 | `/places/:id` | [PlaceDetailPage.tsx](src/pages/PlaceDetailPage.tsx) |
| RSV-05-02 | 원격 줄서기 및 순서조절 | `/waiting` | [WaitingPage.tsx](src/pages/WaitingPage.tsx) |

### 기획 조건 반영 지점

- **Guest 모드** — 로그인 화면 하단 '가입 없이 서비스 둘러보기'. `/map`, `/places/:id` 는 비로그인 열람 가능
- **소셜 가입 시 닉네임 자동 연동** — [auth.tsx](src/lib/auth.tsx) 의 `suggestedNickname`, DB 측은 `handle_new_user()` 트리거
- **하루 최대 방문 개수 제약** — 기본값 3곳. 타임라인 추가와 AI 추천 저장 양쪽에서 한도를 검사
- **이동수단별 소요 시간** — [geo.ts](src/lib/geo.ts) `travelMinutes()`, 직선 거리에 1.3배 우회 계수 적용
- **동선 최적화** — 최근접 이웃 + 2-opt ([geo.ts](src/lib/geo.ts) `optimizeOrder()`). 순서 변경 시 요약이 즉시 재계산
- **예약/웨이팅 상태 배지 바인딩** — 타임라인 카드에 '예약 확정' / '웨이팅 중' 자동 표시
- **웨이팅 미루기** — 순서 변경이 아닌 **+30분 시간 수치**로 렌더링. 하루 최대 2회 (DB 제약으로도 강제)
- **홈 하단 플로팅 바** — 웨이팅 신청 시 '대기순서 확인' 바로 실시간 전이 ([AppLayout.tsx](src/components/AppLayout.tsx))

## Supabase 연결

스키마는 CLI 마이그레이션으로 관리합니다. `supabase/migrations/` 의 두 파일이
[schema.sql](supabase/schema.sql) · [seed.sql](supabase/seed.sql) 과 동일한 내용이며,
시드는 `on conflict do update` 로 작성되어 몇 번을 다시 적용해도 안전합니다.

```bash
npx supabase login                      # 브라우저 인증
npx supabase link --project-ref <ref>   # DB 비밀번호 입력
npx supabase db push                    # 스키마 + 시드 적용
```

그다음 `.env` 의 두 줄을 대시보드 **Project Settings > Data API** 값으로 채우고
개발 서버를 재시작하면 연결됩니다.

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

구글 로그인을 쓰려면 Authentication > Providers > Google 을 켜고,
Redirect URL 에 `http://localhost:5173/auth/callback` 을 등록하세요.

### 개발 중 이메일 인증 설정

Authentication > Sign In / Providers > Email 에 비슷한 토글이 나란히 있어 헷갈리기 쉽습니다.

| 토글 | 개발 중 권장 | 잘못 두면 |
|---|---|---|
| Enable email provider / Allow new users to sign up | **켜기** | `Email signups are disabled` |
| Confirm email | **끄기** | 확인 메일 발송 → 무료 플랜 SMTP 한도로 `email rate limit exceeded` |

또한 Supabase 는 MX 레코드가 없는 도메인을 거부하므로 `@example.com` 같은
가짜 주소로는 가입 테스트가 되지 않습니다. 실제 메일 도메인의 주소를 쓰세요
(Gmail plus-addressing 이 편합니다).

연결 상태는 앱의 **MY > 연동 상태** 화면에서 확인할 수 있습니다.

### 프로필 생성 시점

가입 시 `auth.users` 트리거로 `profiles` 행을 만들지 **않습니다**. 앱은 profiles 행의
부재를 '사용자 등록(SYS-01-02) 미완료' 신호로 사용하므로, 트리거로 행을 미리 만들면
필수 온보딩이 통째로 건너뛰어집니다. 소셜 계정 이름이 nickname 길이 제약(2~12자)을
넘는 경우 트리거가 실패해 회원가입 자체가 막히는 문제도 있습니다. 닉네임 자동 연동은
클라이언트가 `user_metadata` 에서 읽어 온보딩 입력란을 채우는 방식으로 처리합니다.

### 데이터 모델

| 테이블 | 용도 |
|---|---|
| `profiles` | 닉네임 · 취향 태그 · 웨이팅 성향 (SYS-01-02) |
| `region_groups` | 상위 목적지 지역(시/도). 비로그인 읽기 허용 |
| `regions` | 하위 목적지 지역(구/시). `group_name` 이 `region_groups.name` 을 참조. 비로그인 읽기 허용 |
| `places` | 장소 카탈로그. `region` 이 `regions.name`(하위 지역)을 참조. 비로그인 읽기 허용 |
| `trips` | 여행 날짜(당일치기) · 목적지 · 하루 최대 방문 수 · 이동수단. `destination` 이 `regions.name` 을 참조 |
| `trip_items` | 방문 순서 (`sort_order`) — 당일치기라 일자 구분이 없다 |
| `reservations` | 예약 (RSV-05-01) |
| `waitings` | 웨이팅. `delay_count ≤ 2` 체크 제약, 사용자당 진행 중 1건 유니크 인덱스 |

RLS 는 전 테이블에 적용되어 있고, 사용자는 자신의 행만 읽고 쓸 수 있습니다.

### 장소 데이터 출처

`places` 시드 339곳(전국 17개 시/도)은 [한국관광공사 TourAPI](https://www.data.go.kr)
(KorService2)에서 가져왔습니다. 지역기반 목록(`areaBasedList2`) · 상세소개
(`detailCommon2`) · 영업시간(`detailIntro2`) 세 오퍼레이션을 조합해 이름·주소·좌표·
사진·한 줄 소개·영업시간을 채웠습니다.

첫 4개 지역(서울·제주·부산·경북, 79곳)을 지역당 20~30곳 규모로 수집한 뒤, 나머지
13개 시/도를 지역당 20곳씩 추가했습니다(`20260825000000_tourapi_places.sql` →
`20260825020000_nationwide_regions.sql`).

**TourAPI 가 주지 않는 값은 정직하게 비워 뒀습니다.**

- `rating` — 전부 0. TourAPI 는 평점을 제공하지 않는 공공데이터라 리뷰 기반 점수가 없습니다.
  AI 추천(MAP-04-02) 점수식이 `rating × 2` 를 기본 점수로 쓰므로, 이 장소들은 취향 태그
  매칭·시간대/날씨 보너스에만 의존해 추천됩니다.
- `tags` — 전부 빈 배열. TASTE_TAGS 와 매칭할 신뢰할 만한 원천이 없어 추측해 채우지
  않았습니다.
- **술집(`sulzip`) 카테고리는 전국에 4곳뿐입니다.** TourAPI 는 관광·가족 단위 콘텐츠
  위주라 주점 분류(FD04)가 원래 희박합니다(전국 조회 결과 총 7건, 사진 있는 것만
  4건). 카카오 로컬 API 등 다른 소스로 보충하기 전까지는 이 상태가 유지됩니다.

**수집 중 발견한, 최근 실제 행정구역 개편도 데이터에 반영돼 있습니다.**
2026년 7월 인천에 제물포구·영종구·검단구가 신설됐고, 같은 달 광주·전남이
'전남광주통합특별시'로 통합됐습니다 — 둘 다 TourAPI 원본 주소 그대로이며 파싱
오류가 아닙니다. 다만 앱의 `region_groups` 는 사용자에게 익숙한 '광주'·'전남'을
별도 그룹으로 유지합니다 — 행정구역상 통합됐어도 여행 목적지로서는 도심(광주)과
근교·해안(전남)이 여전히 다른 성격이라고 판단했습니다.

세종은 리프(구/시)를 나누지 않고 하나로 묶었습니다 — 세종 신도시 지역 주소가
행정동 없이 도로명으로 바로 시작하는 경우가 섞여 있어(예: '세종특별자치시
한누리대로 288'), 주소 2번째 토큰으로 구/읍/면을 파싱하는 방식이 도로명을
잘못 뽑아내는 문제가 있었습니다.

수집 스크립트는 저장소에 포함돼 있지 않습니다(1회성 배치 작업). 재수집이 필요하면
`supabase/migrations/` 의 두 마이그레이션을 참고해 같은 방식으로 다시 만들 수
있습니다.

### 목적지 지역 추가하기

지역은 상위(시/도) · 하위(구/시) 2단으로 관리합니다. 화면의 지역 선택도 이 순서로
두 단계 드롭다운입니다 — 첫 선택 시 하위는 항상 '전체'가 기본값이고, 시/도를 바꾸면
다시 '전체'로 돌아갑니다.

**기존 상위 지역에 하위 지역을 추가하는 경우** (예: 부산에 '동래구' 추가):

```sql
insert into public.regions (name, lat, lng, sort_order, group_name)
values ('부산 동래구', 35.2048, 129.0788, 11, '부산');
```

하위 지역 이름은 `'부산 동래구'`처럼 상위 지역명을 접두어로 붙입니다 — 접두어 없이
'서구'만 쓰면 '강서구'처럼 다른 구 이름에 부분 문자열로 포함된 이름과 뒤섞일 수 있어서입니다.

**새 상위 지역(시/도)을 통째로 추가하는 경우**엔 `region_groups` 에도 행을 먼저 넣어야
합니다:

```sql
insert into public.region_groups (name, lat, lng, sort_order) values ('강원', 37.8228, 128.1555, 4);
insert into public.regions (name, lat, lng, sort_order, group_name) values ('강원 강릉시', 37.7519, 128.8761, 0, '강원');
```

앱은 `regionGroups.list()` · `regions.list()` ([db.ts](src/lib/db.ts))로 두 테이블을
읽어 드롭다운을 채우므로, 새로고침만으로 반영됩니다. `places.region` 과
`trips.destination` 이 `regions.name`(하위 지역)을 외래키로 참조하므로, 장소나 여행에
쓸 지역명은 여기 등록된 이름과 정확히 일치해야 합니다.

데모 모드(Supabase 미연결)에서는 [seed.ts](src/lib/seed.ts) 의 `DEMO_REGION_GROUPS` ·
`DEMO_REGIONS` 를 대신 씁니다 — 지역을 추가했다면 데모 모드에서도 보이게 하고 싶은 경우
이 배열들도 함께 갱신하세요.

## 네이버 지도 연결

[console.ncloud.com](https://console.ncloud.com) > **AI·NAVER API > Application** 에서
Application 을 등록하고 인증 정보의 **Client ID** 를 `.env` 에 넣으면
[MapView.tsx](src/components/MapView.tsx) 가 실제 SDK 로 전환됩니다.

**Web 서비스 URL 은 포트를 빼고 호스트 도메인만 등록합니다.** 개발 환경이 5173 포트라도
`http://localhost:5173` 이 아니라 `http://localhost` 로 넣어야 합니다. 포트를 붙이면
매칭에 실패해 `200 / Authentication Failed` 가 납니다.

인증 정보 팝업에는 Client ID 와 Client Secret 이 함께 있습니다. SDK 에 넣는 값은
**Client ID** 이고, Secret 은 브라우저에 노출되면 안 됩니다. 재발급 버튼이 붙어 있는
쪽이 Secret 입니다.

```
VITE_NAVER_MAP_CLIENT_ID=<Key ID 또는 Client ID>
VITE_NAVER_MAP_AUTH_PARAM=ncpKeyId
```

마커는 `naver.maps.Marker` 의 커스텀 아이콘, 경로는 `naver.maps.Polyline` 으로 그리며,
여러 장소가 있으면 `fitBounds` 로 화면에 모두 담습니다.

**인증 파라미터 이름이 콘솔 세대에 따라 다릅니다.** 신규 NCP 콘솔은 `ncpKeyId`,
구 콘솔은 `ncpClientId` 를 씁니다. 지도가 뜨지 않으면 `VITE_NAVER_MAP_AUTH_PARAM` 을
반대쪽 값으로 바꿔 보세요. 인증 실패는 스크립트 로드 오류가 아니라 네이버가 호출하는
전역 훅(`navermap_authFailure`)으로 통지되므로, [naver.ts](src/lib/naver.ts) 에서 이를 받아
SVG 폴백으로 전환하고 콘솔에 원인을 남깁니다.

키가 없거나 SDK 로드·인증에 실패하면 동일한 인터랙션의 SVG 지도로 자동 폴백합니다.

## 기술 스택

React 18 · TypeScript · Vite · React Router · Tailwind CSS v4 · dnd-kit · Supabase JS ·
Open-Meteo (날씨, 인증 불필요)

## 구현되지 않은 것

- **결제** — 예약금 결제는 UI 만 있고 실제 PG 연동은 없습니다. [PlaceDetailPage.tsx](src/pages/PlaceDetailPage.tsx) 의 예약 시트에 연동 위치를 표시해 두었습니다.
- **카카오톡 공유** — Kakao SDK 대신 Web Share API(미지원 시 클립보드 복사)를 사용합니다. 템플릿 카드가 필요하면 Kakao JavaScript SDK 의 `Kakao.Share.sendDefault()` 로 교체하세요.
- **푸시 알림** — 웨이팅 호출 알림은 화면 내 표시까지만 구현되어 있습니다.
- **실시간 대기 인원** — `places.waiting_count` 는 정적 시드 값입니다. 운영 시 매장 POS 연동 또는 Supabase Realtime 으로 갱신해야 합니다.
