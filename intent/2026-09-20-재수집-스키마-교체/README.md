# 장소 수집 · 반영 배치

TourAPI 에서 장소를 받아(`collect.mjs`) 운영 DB 에 반영합니다(`load.mjs`). **파일을 쓰지
않습니다**(2026-10-09~) — 원본 · 상태 · 실행 기록은 DB 의 `tour` 스키마에, 앱이 보는 장소는
`public.places` 에 있습니다. 테이블은 [`supabase/DATA-MODEL.md`](../../supabase/DATA-MODEL.md)
의 `tour.*` 절, 이렇게 바꾼 이유와 단계는
[`intent/2026-10-09-서버-수집-검토/검토.md`](../2026-10-09-서버-수집-검토/검토.md).

| 파일 | 하는 일 |
| --- | --- |
| `collect.mjs` | TourAPI → `tour.*` (코드표 · 목록 · 상세 · 목록 갱신 · 사라진 장소 · 실행 기록) |
| `load.mjs` | `tour.*` → 지역 판정 · 분류 · 태그 → **바뀐 장소만** `places` · `regions` · `region_groups` |
| `raw-source.mjs` | `load.mjs` 가 읽는 원본 — DB 행을 예전 파일 단위로 묶어 준다 |
| `db.mjs` | DB 접속 (`tour_collector` 역할) |
| `run-daily.sh` | `collect.mjs` → `load.mjs` 를 한 번 (launchd 가 매일 0시) |

## 실행

```bash
npm install                     # 저장소 루트에서 한 번 (pg)
./run-daily.sh                  # 수집 → 반영 한 번
./run-daily.sh --status         # 진행률 · 최근 실행 (= node collect.mjs --status)

node collect.mjs                # 수집만 — 목록 갱신 → 사라진 장소 → 목록 · 상세
node collect.mjs --area 1       # 특정 시/도만 (목록 갱신은 건너뜀)
node collect.mjs --skip-detail  # 목록만
node collect.mjs --detail-only  # 상세만
node collect.mjs --report-only  # 수집 리포트만 (호출 0)
node collect.mjs --sync-dry     # 목록 갱신 · 사라진 장소 미리보기 — DB 를 바꾸지 않음
node collect.mjs --no-sync      # 목록 갱신 · 사라진 장소 건너뛰기

node load.mjs                   # 반영만
node load.mjs --dry             # 무엇이 바뀔지만 — DB 를 바꾸지 않음
node load.mjs --demo            # 데모 모드 데이터 src/lib/seed.ts 도 다시 만든다
node load.mjs --force           # 안전 검사(장소 수 급감)를 무시하고 반영
```

**비밀값 — 둘 다 커밋하지 않습니다(`.gitignore`).**

- **API 키:** 환경 변수 `TOUR_API_KEY` → 이 폴더의 `.key` → 실행할 때 입력. 무인 실행은 `.key` 가 있어야 합니다.
- **DB 접속:** 환경 변수 `TOUR_DB_URL` → 이 폴더의 `.db-url`. Supabase 대시보드 **Connect → Session pooler** 의
  URI 에서 사용자 이름을 `tour_collector.<프로젝트 ref>` 로, 비밀번호를 SQL 편집기에서
  `alter role tour_collector with login password '…';` 로 정한 값으로 바꿔 넣습니다. 로컬이 아니면 늘 TLS 로
  접속하고, 이 폴더에 `.db-ca.crt`(대시보드에서 받는 CA 인증서)가 있으면 서버 인증서까지 검증합니다.
  비밀번호를 바꾼 직후엔 pooler 가 옛 비밀번호를 한동안 기억해 인증이 실패할 수 있습니다 — 더 바꾸지 말고
  30분쯤 기다립니다(겪은 일은 검토 문서).

## 매일 자동 실행

```bash
cp com.danyoh.oneday-trip.collect.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.danyoh.oneday-trip.collect.plist 2>/dev/null
launchctl load ~/Library/LaunchAgents/com.danyoh.oneday-trip.collect.plist
```

매일 00:00 에 `run-daily.sh` 가 돕니다. 맥북이 잠들어 있었다면 깨어날 때 돕니다(cron 은 그날을
건너뜁니다). 화면 출력은 `/tmp/oneday-trip-collect.out` · `.err` 에만 남고, 실행 기록은 DB 의
`tour.runs` 에 있습니다 — `./run-daily.sh --status` 나 SQL 편집기에서
`select * from tour.runs order by id desc limit 10;`.

## 수집 — `collect.mjs`

`areaCode2` 로 시/도 · 시군구 코드표를, 시군구 × 콘텐츠 타입마다 `areaBasedList2`(목록)를,
장소마다 `detailCommon2`(소개) + `detailIntro2`(영업시간 · 전화)를 받아 **원본 그대로**
`tour.*` 에 넣습니다. 지역 판정 · 분류는 하지 않습니다 — 판정 로직을 고칠 때 API 를 다시 부르지
않으려면 원본이 남아 있어야 합니다.

**중단해도 안전합니다.** 목록은 시군구 × 타입 단위(`tour.list_fetches`)로, 상세는 한 곳마다
바로 저장합니다. 일일 호출 한도(약 2,000회)에 걸리면 멈추고(종료코드 1), 다음 실행이 그
자리에서 이어서 받습니다. 한도로 멈춘 날도 받은 만큼은 `load.mjs` 가 반영합니다.

**바뀐 것만 받습니다.** 상세마다 그때의 목록 수정일을 `mt` 로 같이 저장해, 상세가 없거나
`mt` 가 지금 목록 수정일과 다른 장소만 받습니다.

**콘텐츠 타입 8개를 받습니다.** 하루 한도 안에서 앱에 보이는 타입이 먼저 끝나도록 묶음
1(39 음식점 · 12 관광지 · 14 문화시설) → 2(28 레포츠 · 38 쇼핑 · 32 숙박) → 3(15 축제 · 25 여행코스)
차례로, 묶음마다 목록 → 상세를 받습니다. 앱에 넣을지는 `load.mjs` 의 `CONTENT_TYPES` 가 정합니다
(15 · 25 는 받아만 둠). 원래 타입은 `places.content_type` 에 남습니다.

**목록 갱신(`syncLists`).** 시군구 목록은 한 번 받으면 다시 받지 않으므로, 매 실행 첫머리에
타입별 **전국 목록을 수정일 순**(`arrange=Q`)으로 받다가 기준 시각보다 오래된 장소가 나오면
멈춥니다(바뀐 게 없으면 타입당 1호출).

1. 기준 시각은 `tour.sync_state.lastSyncStartedAt` 에서 하루를 더 거슬러 올라간 시점입니다
   (처음이면 목록을 처음 받은 시각). 겹쳐 받은 것은 같은 값을 다시 쓸 뿐입니다.
2. 시군구는 `areacode` · `sigungucode` 로, 비어 있으면 법정동 코드(`lDongRegnCd` · `lDongSignguCd`)
   를 지금 목록에서 가장 많이 짝지어진 시군구로 바꿔 찾습니다. 그 목록 단위를 받은 적이 없으면
   이미 있는 장소는 있던 자리에서 고치고, 처음 보는 장소는 건너뛰고 로그에 `?` 줄로 코드를 남깁니다.
   목록을 아직 안 받은 타입은 건너뜁니다(나중에 통째로 받을 때 최신으로 옴).
3. 응답이 수정일 내림차순이 아니면 아무것도 바꾸지 않습니다. 받은 타입의 바뀐 장소를 **하나도**
   잇지 못하면 기준 시각을 앞당기지 않습니다(첫 실행 10/9 가 그랬다 — 2,624곳 중 0곳).
   갱신이 실패해도 그날의 상세 수집은 계속합니다.

**사라진 장소(`syncHidden`).** TourAPI 는 장소를 지우지 않고 표출 중단(`showflag 0`)으로 돌리는데,
그런 장소는 일반 목록에 안 나옵니다. 그래서 **동기화 목록**(`areaBasedSyncList2`)을 날짜
(`modifiedtime=YYYYMMDD`)마다 받아:

- 표출 중단 + 우리 목록에 있음 → `tour.list_items.hidden_at` 을 채웁니다(행 · 상세는 남김).
- 다시 표출 → `hidden_at` 을 비우고 새 기록으로 덮어 상세를 다시 받게 합니다.
- 날짜는 `sync_state.hiddenCheckedDate` 하루 전부터 오늘까지 — 평소 2~3호출.
- 응답 수정일이 물은 날짜가 아니거나 `showflag` 칸이 없으면 아무것도 바꾸지 않습니다.

완전히 지워져 동기화 목록에도 안 나오는 장소는 여전히 모릅니다.

## 반영 — `load.mjs`

`tour.*` 를 읽어 지역 판정(응답의 시군구 코드 → 주소의 시군구 이름 → 미판정 `-1`) · 분류 ·
소개 · 영업시간 · 전화 · 태그를 만들고, **한 트랜잭션으로** 운영 DB 에 씁니다.

- **바뀐 장소만:** 장소마다 변환 결과의 지문(hash)을 만들어 지난번 반영한 지문(`tour.place_out`)과
  비교합니다. 평소엔 하루 수십 곳입니다. 지역 · 시/도는 매번 통째로(265행).
- **덮지 않는 것:** 관리자 등록 장소(`source = 'manual'`) · 사람이 고친 지역(`region_source = 'manual'`) ·
  별점 칸. `tour_collector` 역할의 권한과 RLS 정책도 그렇게 묶여 있습니다(지우는 권한 없음).
- **숨김:** `tour.list_items.hidden_at` 이 찬 장소는 `places.hidden_at` 을 채웁니다(행은 지우지 않음 —
  지우면 그 장소를 담은 타임라인 항목이 cascade 로 사라진다). 다시 표출되면 upsert 가 비웁니다.
- **안전 검사:** 반영할 장소 수가 지금 `places` 의 90% 보다 적으면 반영하지 않고 실패로 남깁니다
  (`--force` 로 무시).
- **기록:** 실행마다 `tour.runs` 에 한 줄(바뀐 수 · 숨김 수 · 주소 대조 결과 — 예전 `addr-mismatch.json`).
- **목록 순서**는 수정일 내림차순 → contentid 로 고정합니다 — DB 는 순서를 보장하지 않아서,
  그대로 두면 같은 데이터에서 데모 장소 고르기가 달라집니다.

`seed.sql` 은 없앴습니다. 로컬 `supabase db reset` 은 장소 없이 시작하고(`config.toml` 의
`[db.seed]` 꺼 둠), 앱을 장소와 함께 보려면 데모 모드(`.env` 없이)를 씁니다.

## 얼마나 걸리나

**실측(2026-09-22): 전국 목록은 234개 시군구 15,518곳**(타입 3개 기준)입니다. 호출은 코드표 18 +
목록 약 700 + 상세 약 31,000 이고 상세가 98% 입니다. **일일 한도는 약 2,000 호출** — 하루 상세
1,000곳입니다. 이 규모면 운영계정 전환(같은 키의 한도를 올리는 절차)이 사실상 필요합니다.

## 알아두기

- 공공데이터포털 키는 Encoding / Decoding 두 가지입니다. 스크립트가 `%` 포함 여부로 갈라 처리하지만,
  `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` 가 나면 다른 쪽 키로 바꿔 보세요.
- TourAPI 가 소개 · 영업시간 · 전화를 **주지 않는 장소가 섞여 있습니다.** 화면은 빈 영역을 숨깁니다.
  충족 비율은 `node collect.mjs --report-only`.
- `detailIntro2` 는 타입마다 필드 이름이 다릅니다(음식점 `opentimefood`, 관광지 `usetime`, 문화시설
  `usetimeculture` …). 원본을 그대로 저장하고, 이름을 맞추는 일은 `load.mjs` 가 합니다.
- 예전 `raw/` 폴더(파일 시절의 원본)는 DB 로 옮겼습니다(10/9, 파일과 전부 대조). 전환을 확인한 뒤
  압축 백업 하나만 남기고 지웁니다.
