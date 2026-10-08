# 하루여행 — 위치기반 여행 일정 및 맛집 지도 서비스

`travel-map-ia-menu-list.xlsx` 의 IA · 기능정의 리스트 10개 항목을 그대로 구현한
React + Supabase 웹 애플리케이션입니다.

## 실행

```bash
npm install && npm run dev
```

`.env` 없이 바로 실행됩니다. 이 경우 앱은 **데모 모드**로 동작하며,
Supabase 대신 localStorage 를, 네이버 지도 대신 SVG 폴백 지도를 사용합니다.
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
| MAP-04-01 | 실시간 지도 홈 (장소 이름 검색 포함) | `/map` | [ExplorePage.tsx](src/pages/ExplorePage.tsx) |
| MAP-04-02 | 추천 장소 (맥락 인지 추천 피드) | `/recommend?tab=place` | [RecommendPage.tsx](src/pages/RecommendPage.tsx) |
| SHARE-06-01 | 추천 코스 목록 (공용 플랜) | `/recommend?tab=course` | [PlanListPage.tsx](src/pages/PlanListPage.tsx) |
| SHARE-06-02 | 코스 상세 · 내 여행으로 담기 | `/plans/:id` | [PlanDetailPage.tsx](src/pages/PlanDetailPage.tsx) |
| SHARE-06-03 | 내 여행을 추천 코스로 공유 | `/trips/:id/share` | [PlanPublishPage.tsx](src/pages/PlanPublishPage.tsx) |
| SHARE-06-04 | 내가 올린 코스 | `/me/plans` | [MyPlansPage.tsx](src/pages/MyPlansPage.tsx) |
| SHARE-06-06 | 운영자 코스 관리 | `/admin/plans` | [AdminPlansPage.tsx](src/pages/AdminPlansPage.tsx) |
| SHARE-06-07 | 코스 만족도 | `/plans/:id` 안 | [PlanDetailPage.tsx](src/pages/PlanDetailPage.tsx) |
| PLACE-07-01 | 운영자 장소 등록 | `/admin/places` | [AdminPlacesPage.tsx](src/pages/AdminPlacesPage.tsx) |

**추천 탭** ([RecommendHubPage.tsx](src/pages/RecommendHubPage.tsx))이 MAP-04-02 와 SHARE-06-01 을
'추천 장소' · '추천 코스' 하위 탭으로 함께 담습니다. 화면에서는 공용 플랜을 '코스'라고
부르고, 테이블·파일 이름(`shared_plans`, `PlanListPage`)은 그대로 둡니다. 예전 목록 주소
`/plans` 는 `/recommend?tab=course` 로 넘어갑니다.

기능 코드가 붙지 않은 화면도 있습니다 — 홈([HomePage.tsx](src/pages/HomePage.tsx) · '하루에 다녀올 만한 곳' 로직은 [README-플로챠트.md](README-플로챠트.md)),
내 여행 목록([TripListPage.tsx](src/pages/TripListPage.tsx)),
장소 상세([PlaceDetailPage.tsx](src/pages/PlaceDetailPage.tsx) · 예약 RSV-05-01 을 걷어낸 뒤 남은 화면),
마이페이지([MyPage.tsx](src/pages/MyPage.tsx)),
가입([SignupPage.tsx](src/pages/SignupPage.tsx)),
소셜 로그인 콜백([AuthCallbackPage.tsx](src/pages/AuthCallbackPage.tsx)),
계정 문제 안내([AccountHelpPage.tsx](src/pages/AccountHelpPage.tsx)).

### 기획 조건 반영 지점

- **Guest 모드** — 로그인 화면 하단 '가입 없이 서비스 둘러보기'. `/map`, `/places/:id`, `/recommend`(추천 코스·추천 장소 둘 다), `/plans/:id` 는 비로그인 열람 가능. 보여 주고, 저장·담기처럼 내 데이터를 만드는 순간에만 로그인으로 보냅니다 — 공유 링크를 받은 사람이 로그인 벽을 먼저 만나면 공유가 성립하지 않습니다. 비회원의 추천 장소는 취향 태그 없이 시간대·날씨로만 매기고 '기본 추천'이라고 밝힙니다
- **소셜 가입 시 닉네임 자동 연동** — [auth.tsx](src/lib/auth.tsx) 의 `suggestedNickname`, DB 측은 `handle_new_user()` 트리거
- **이동수단별 소요 시간** — [geo.ts](src/lib/geo.ts) `travelMinutes()`, 직선 거리에 1.3배 우회 계수 적용
- **동선 최적화** — 최근접 이웃 + 2-opt ([geo.ts](src/lib/geo.ts) `optimizeOrder()`). 순서 변경 시 요약이 즉시 재계산
- **코스 작성자 표기** — 닉네임을 쓰지 않고 '운영자' 또는 '회원'으로만 표시합니다 ([types.ts](src/lib/types.ts) `planAuthorLabel()`)
- **순서 바꾸기** — 타임라인·동선 최적화·추천 코스 공유 세 화면 모두 드래그 핸들로 통일했습니다 (dnd-kit). 화살표 버튼은 쓰지 않습니다
- **장소 상세 전화 연결** — TourAPI 로 받아온 `places.phone` 이 있으면 상세 페이지에 `tel:` 링크 버튼으로 노출 ([PlaceDetailPage.tsx](src/pages/PlaceDetailPage.tsx))

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

**[supabase/DATA-MODEL.md](supabase/DATA-MODEL.md) 가 정본입니다.** 관계도, 테이블별
설계 근거, 화면→테이블 대응, RLS 가 실제로 막는 것이 거기 있습니다. 여기 표를 두면
스키마가 바뀔 때마다 두 곳이 어긋나므로 — 실제로 한동안 어긋나 있었습니다 —
방향만 적습니다.

테이블은 아홉 개입니다. 지역 둘(`region_groups` · `regions`), 장소 하나(`places`),
사용자 하나(`profiles`), 개인 여행 둘(`trips` · `trip_items`), 공용 플랜 셋
(`shared_plans` · `shared_plan_items` · `plan_ratings`).

**지역 키는 이름이 아니라 TourAPI 코드 복합키입니다.** `(tour_area_code,
tour_sigungu_code)` 로 `regions` 를 참조합니다. 이름으로 참조하던 옛 구조는
REGION-07 에서 걷어냈습니다 —
[intent/2026-09-20-재수집-스키마-교체/intent.md](intent/2026-09-20-재수집-스키마-교체/intent.md)
에 왜 그렇게 했는지가 있습니다.

RLS 는 전 테이블에 걸려 있습니다. 지역과 장소는 비로그인도 읽을 수 있고, 나머지는
자기 행만 읽고 씁니다. 공용 플랜은 올린 사람이 아니어도 읽을 수 있습니다.

### 장소 데이터 출처

`places` 는 [한국관광공사 TourAPI](https://www.data.go.kr)(KorService2)에서 가져온
**전국 15,518곳**입니다. 지역기반 목록(`areaBasedList2`) · 상세소개(`detailCommon2`) ·
영업시간(`detailIntro2`) 세 오퍼레이션을 조합해 이름·주소·좌표·사진·한 줄 소개·
영업시간·전화를 채웁니다.

**상세는 아직 채우는 중입니다.** 목록 수집은 전국 234개 시군구가 모두 끝났고,
장소별 상세는 일일 호출 한도(1,000건 수준) 때문에 하루 1,000곳씩 받습니다.
2026-10-02 기준 5,000곳(32.2%)입니다. 상세가 비어 있는 장소는 소개·영업시간·전화
칸이 화면에서 통째로 사라집니다 — 빈 제목만 남는 쪽이 더 나쁘다고 보았습니다.

수집은 매일 자정 launchd 로 자동 실행됩니다
([run-daily.sh](intent/2026-09-20-재수집-스키마-교체/run-daily.sh) ·
[plist](intent/2026-09-20-재수집-스키마-교체/com.danyoh.oneday-trip.collect.plist)).
한도에 걸려 죽어도 이미 받은 것은 건너뛰고 다음 날 그 자리에서 이어받습니다.
받은 결과를 앱이 쓰는 SQL 로 바꾸는 것은
[load.mjs](intent/2026-09-20-재수집-스키마-교체/load.mjs) 이고, 결과물이
`supabase/seed.sql` 입니다.

**TourAPI 가 주지 않는 값은 정직하게 비워 뒀습니다.**

- **평점 · 가격대** — TourAPI 는 둘 다 주지 않습니다. 근거 없이 채워 두던
  `source_rating`(전부 null) · `price_level`(전부 2) 칸은 지웠습니다
  (`20261008050000` · `20261008060000`). 화면의 ★ 는 사용자 리뷰 평균
  (`rating_avg`, 리뷰 3건 이상)입니다.
- `tags` — 취향 태그 11개 중 응답의 정해진 칸 · 메뉴 글자에서 확실히 나오는 다섯만
  채웁니다: 카페 · 주차가능 · 심야영업(자정 이후 마감 · 24시간 · 익일) · 오마카세 ·
  디저트(메뉴). 규칙은 `load.mjs` 의 `tagsOf()`. 소개 글로 추정해야 하는 노포 · 뷰맛집 ·
  비건과, 근거 값이 없는 가성비 · 로컬맛집 · 혼밥은 비워 둡니다(온보딩
  선택지에는 남아 있어 고를 수는 있습니다). 상세를 아직 받지 못한 장소는 '카페' 말고는
  비어 있고, 수집이 진행되면 채워집니다.
- **술집(`sulzip`) 카테고리가 희박합니다.** TourAPI 는 관광·가족 단위 콘텐츠 위주라
  주점 분류(FD04)가 원래 적습니다. 카카오 로컬 API 등 다른 소스로 보충하기 전까지는
  이 상태가 유지됩니다.

**판정하지 못한 장소는 버리지 않고 격리합니다.** 시군구를 정하지 못했거나 좌표를
믿을 수 없는 장소는 코드 `-1` 에 `region_source = 'unresolved'` 로 두고, 왜
그렇게 됐는지를 `region_note` 에 적습니다. 현재 33곳입니다 — 30곳은 좌표가 한국
범위 밖이고, 3곳은 범위 안이지만 주소와 수십~백수십 km 떨어진 곳을 가리킵니다.
틀린 좌표는 없는 장소보다 나쁩니다. 하루 동선을 짜는 도구에서 안민고개를 창원
일정에 넣으면 동선이 170km 서쪽으로 끌려갑니다.
이 장소들은 드롭다운·지도·추천 어디에도 나오지 않습니다 — 제외 조건은
[db.ts](src/lib/db.ts) 한 곳에만 있습니다. 코드를 손으로 고치면 `region_source` 가
`manual` 로 자동 전환되어 바로 서비스에 등장하고, 재수집을 다시 돌려도 그 값이
덮어써지지 않습니다.

**최근 행정구역 개편이 주소에는 들어와 있지만 지역 배정은 한 세대 뒤처져
있습니다.** 2026년 7월 인천에 제물포구·영종구·검단구·서해구가 생겼고, 같은 달
광주·전남이 '전남광주통합특별시'로 통합됐습니다. 둘 다 TourAPI 원본 주소 그대로이며
파싱 오류가 아닙니다.

문제는 주소와 코드가 따로 움직인다는 점입니다. **TourAPI 의 `sigunguCode` 코드표는
아직 옛 구만 담고 있어서, 영종구 주소를 가진 장소가 중구로, 검단구·서해구 주소를
가진 장소가 서구로 들어갑니다.** 인천 460곳 중 186곳이 그렇습니다. 사용자 눈에는
인천 중구를 고르면 영종도 장소가 섞여 나오고, 영종구는 선택지에 아예 없습니다.

**이름만 바로잡았습니다.** 인천 주소에 중구·동구·서구는 **0건**입니다 — 보강이 아니라
대체라, 그대로 두면 앱이 없어진 구를 선택지로 내밉니다. 그래서 `load.mjs` 의
`LEAF_NAME` 에서 이름을 고쳐 '제물포·영종(옛 중구)' · '제물포(옛 동구)' ·
'서해·검단(옛 서구)' 로 내보냅니다. 괄호 안에 옛 이름을 남기는 이유는 중구와 동구가
둘 다 제물포구로 들어가 이름만으로는 구별되지 않아서입니다.

**장소를 옮기지는 않습니다.** 옮기려면 신설 구에 코드를 우리가 지어내야 하는데,
나중에 TourAPI 가 같은 번호를 다른 구에 주면 그 코드의 뜻이 바뀝니다. `trips` 와
`shared_plans` 가 이 코드 쌍을 외래키로 들고 있어서, 사용자가 만든 여행의 목적지가
조용히 다른 구로 옮겨 갑니다. 이름은 바꿔도 그런 일이 없습니다 — 키가 코드라서 이름
변경이 싸다는 것이 이 구조의 이점이고, 여기가 그 이점을 쓰는 자리입니다.

**한 코드 안에 먼 곳이 섞이는 문제는 이름으로 풀리지 않습니다.** 옛 중구 코드 안에서
영종구와 제물포구의 좌표 중앙값이 18.0 km 떨어져 있고 사이에 영종대교가 있습니다.
하루 동선을 짜는 도구에서는 가벼운 문제가 아닙니다. 코드표가 갱신되면 그때 갈라야
하고, 그때까지 규모는 `load.mjs` 의 '코드 ↔ 주소 대조'가 매번 보고합니다 — 전체
목록은 `raw/addr-mismatch.json` 입니다.

광주·전남은 다릅니다. TourAPI 가 둘을 별개 코드로 내려 주고, 앱의 `region_groups`
도 '광주'·'전남'을 따로 유지합니다 — 행정구역상 통합됐어도 여행 목적지로서는
도심(광주)과 근교·해안(전남)이 여전히 다른 성격이라고 판단했습니다.

세종은 리프(구/시)를 나누지 않고 하나로 묶었습니다 — 세종 신도시 지역 주소가
행정동 없이 도로명으로 바로 시작하는 경우가 섞여 있어(예: '세종특별자치시
한누리대로 288'), 주소 2번째 토큰으로 구/읍/면을 파싱하는 방식이 도로명을
잘못 뽑아내는 문제가 있었습니다.

무엇을 왜 그렇게 수집하는지는
[intent.md](intent/2026-09-20-재수집-스키마-교체/intent.md) 에 있습니다.

### 목적지 지역 추가하기

지역은 상위(시/도) · 하위(구/시) 2단으로 관리합니다. 화면의 지역 선택도 이 순서로
두 단계 드롭다운입니다 — 첫 선택 시 하위는 항상 '전체'가 기본값이고, 시/도를 바꾸면
다시 '전체'로 돌아갑니다.

**키는 이름이 아니라 TourAPI 코드입니다.** 그래서 추가할 때 코드를 함께 정해야 하고,
대신 이름은 나중에 `update` 한 줄로 바꿀 수 있습니다.

기존 상위 지역에 하위 지역을 추가하는 경우 (예: 부산에 '동래구' 추가):

```sql
insert into public.regions
  (tour_area_code, tour_sigungu_code, name, ldong_cd, lat, lng, sort_order)
values (6, 12, '동래구', '2626000000', 35.2048, 129.0788, 12);
```

**이름에 시/도 접두어를 붙이지 마세요.** `'부산 동래구'` 가 아니라 `'동래구'` 입니다.
옛 구조에서는 이름이 키여서 서울 강서구와 부산 강서구를 구분하려고 접두어를 붙였지만,
지금은 `(tour_area_code, tour_sigungu_code)` 가 키라 같은 이름이 시/도마다 따로 있어도
됩니다. 접두어를 붙이면 화면에 '부산 부산 동래구'처럼 나옵니다.

`tour_sigungu_code` 는 그 시/도 안에서만 유일하면 됩니다. TourAPI 가 실제로 쓰는
코드를 넣는 것이 원칙입니다 — 손으로 지어낸 코드를 쓰면 다음 재수집 때 그 구의
장소가 들어오지 못합니다. 코드는 `sigunguCode2` 오퍼레이션으로 확인할 수 있고,
받아 둔 결과가
[raw/sigungu-*.json](intent/2026-09-20-재수집-스키마-교체/) 에 있습니다.

새 상위 지역(시/도)을 통째로 추가하는 경우엔 `region_groups` 에 먼저 넣습니다:

```sql
insert into public.region_groups (tour_area_code, name, lat, lng, sort_order)
values (32, '강원', 37.8228, 128.1555, 9);

insert into public.regions
  (tour_area_code, tour_sigungu_code, name, ldong_cd, lat, lng, sort_order)
values (32, 1, '강릉시', '5115000000', 37.7519, 128.8761, 1);
```

앱은 `regionGroups.list()` · `regions.list()` ([db.ts](src/lib/db.ts))로 두 테이블을
읽어 드롭다운을 채우므로, 새로고침만으로 반영됩니다. 음수 코드는 미판정 전용이라
목록에서 제외되니 쓰지 마세요.

보통은 이 SQL 을 직접 쓸 일이 없습니다. 지역은 `supabase/seed.sql` 이 통째로 관리하고,
그 파일은 `load.mjs` 가 수집 결과에서 생성합니다. 손으로 넣은 지역은 다음 재적재 때
이름·좌표가 수집값으로 덮어써집니다 — 수집에 없는 지역을 유지하려면 TourAPI 코드표에
있는 코드를 쓰는 것이 유일한 방법입니다.

데모 모드(Supabase 미연결)에서는 [seed.ts](src/lib/seed.ts) 의 `DEMO_REGION_GROUPS` ·
`DEMO_REGIONS` 를 대신 씁니다. 이 파일도 `load.mjs --demo` 가 생성하므로 손으로 고치지
말고 다시 생성하세요.

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

- **예약 · 결제** — 2026-10-08 에 걷어냈습니다. 실제 PG 연동 없이 UI 만 있던 기능이라 예약 화면 · 홈 '예약 확정' · 마이페이지 '예약 내역' · 타임라인 배지와 `reservations` 테이블을 모두 지웠습니다 (`20261008040000_drop_reservations.sql`).
- **카카오톡 공유** — Kakao SDK 대신 Web Share API(미지원 시 클립보드 복사)를 사용합니다. 템플릿 카드가 필요하면 Kakao JavaScript SDK 의 `Kakao.Share.sendDefault()` 로 교체하세요.
- **추천 장소와 추천 코스를 한 목록에 섞기** — 지금은 추천 탭 안에 하위 탭으로 나란히 둡니다. 한 목록에서 순위를 매기려면 장소 단위와 하루 단위를 같은 점수로 재야 하고, 담은 수(`clone_count`)가 쌓이기 전에는 그 점수의 재료가 없습니다.

### 만들었다가 닫은 것

되살리려다 같은 길을 다시 걷지 않도록 남깁니다. 셋 다 코드와 테이블을 통째로
걷어냈습니다 — 화면에서만 가리면 아무도 쓰지 않는 `security definer` 쓰기 경로가
DB 에 남기 때문입니다.

- **플랜 신고** — 공유하면 확인 없이 바로 목록에 뜨는 쪽을 택했습니다. 플랜을 내리는 길은 둘만 남습니다. 장소가 지워져 동선이 깨질 때 트리거가 자동으로 거는 것과, 운영자가 직접 내리는 것입니다.
- **사용자 장소 등록 요청** — 사용자가 올리고 운영자가 검수하는 흐름을 닫았습니다. 장소가 들어오는 길은 운영자 수동 등록(PLACE-07-01) 하나입니다.
- **닉네임 노출** — 플랜 작성자는 '운영자' 또는 '회원'으로만 표시합니다. 작성자를 조회하려고 열어 둔 `public_profiles` 뷰도 함께 걷어냈습니다.
