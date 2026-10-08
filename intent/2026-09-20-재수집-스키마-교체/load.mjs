#!/usr/bin/env node
/**
 * 수집 원본(raw/) → 적재용 SQL.
 *
 * collect.mjs 가 받아 둔 목록·상세를 읽어 region_groups · regions · places 를
 * 만든다. 네트워크를 쓰지 않으므로 몇 번을 돌려도 결과가 같다.
 *
 *   node load.mjs                 # supabase/seed.sql 생성 + 리포트
 *   node load.mjs --dry           # 파일을 쓰지 않고 리포트만
 *   node load.mjs --out <path>    # 출력 위치 지정
 *   node load.mjs --demo          # src/lib/seed.ts (데모 모드 데이터) 도 함께 생성
 *
 * 판정 순위(intent.md 5번)를 여기서 구현한다.
 *   1 tour       응답의 sigunguCode
 *   2 addr       주소에서 시군구명 매칭 (시/도는 areaCode 로 이미 안다)
 *   3 geo        좌표 → 행정구역 경계 — 아직 쓰지 않는다 (Q8)
 *   4 unresolved 미판정 코드(-1)로 격리하고 사유를 region_note 에 남긴다
 */

import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const HERE = import.meta.dirname
const RAW = path.join(HERE, 'raw')
const DEFAULT_OUT = path.join(HERE, '..', '..', 'supabase', 'seed.sql')

const CONTENT_TYPES = [39, 12, 14]

/**
 * 시/도 이름 축약.
 * TourAPI 는 광역시는 축약형('서울')으로, 도는 정식 명칭('경기도')으로 준다.
 * 앱의 드롭다운에는 짧은 이름이 낫다.
 */
/**
 * 시군구 이름 바로잡기 — `${시/도 코드}|${TourAPI 이름}` → 우리가 쓸 이름.
 *
 * 행정구역이 바뀌었는데 TourAPI 의 sigunguCode 코드표가 따라오지 못한 경우를
 * 메운다. 2026-10-02 기준 인천이 그렇다. 7월 개편으로 중구·동구가 제물포구와
 * 영종구로, 서구가 서해구와 검단구로 재편됐는데 코드표에는 옛 셋만 있다.
 * 인천 장소 462곳의 주소를 세어 보면 중구·동구·서구가 **0건**이다 — 보강이
 * 아니라 대체다. 그대로 두면 앱이 없어진 구를 선택지로 내민다.
 *
 * 왜 이름만 고치고 장소를 옮기지는 않는가. 옮기려면 신설 구에 코드를 우리가
 * 지어내야 한다. 나중에 TourAPI 가 같은 번호를 다른 구에 주면 그 코드의 뜻이
 * 바뀌는데, `trips` 와 `shared_plans` 가 이 코드 쌍을 외래키로 들고 있어서
 * 사용자가 만든 여행의 목적지가 조용히 다른 구로 옮겨 간다. 이름은 바꿔도
 * 그런 일이 없다 — 키가 코드라서 이름 변경이 싸다는 것이 이 구조의 이점이고,
 * 여기가 그 이점을 쓰는 자리다.
 *
 * 괄호 안에 옛 이름을 남기는 이유는 둘이다. 중구와 동구가 둘 다 제물포구로
 * 들어가 이름만으로는 구별되지 않고, 왜 '제물포'가 둘인지 사용자가 납득할
 * 근거가 필요하다.
 *
 * 한 코드 안에 먼 곳이 섞이는 문제는 이름으로 풀리지 않는다. 옛 중구 코드
 * 안에서 영종구와 제물포구의 좌표 중앙값이 18.0 km 떨어져 있고 사이에
 * 영종대교가 있다. 코드표가 갱신되면 그때 갈라야 한다.
 */
const LEAF_NAME = {
  '2|중구': '제물포·영종(옛 중구)',
  '2|동구': '제물포(옛 동구)',
  '2|서구': '서해·검단(옛 서구)',
}

/**
 * 장소 하나하나의 지역 교정 — contentid → `${시/도 코드}|${시군구 이름}`.
 *
 * TourAPI 의 sigunguCode 가 주소와 다른 곳을 가리키는 행이 있다. 코드↔주소
 * 대조(아래 리포트)가 찾아낸 것을 사람이 보고 판단해 여기 적는다.
 *
 * 왜 운영 DB 에 update 를 치지 않는가. 그렇게 해도 region_source 가 manual 로
 * 바뀌어 재수집이 덮어쓰지는 않지만, 데이터베이스를 처음부터 다시 만들면
 * 교정이 사라진다. 생성하는 쪽에 두면 시드에 들어가고 재수집도 견딘다.
 *
 * 적는 기준은 하나다. **주소에 도로명과 건물번호까지 있어 가리키는 구가
 * 분명한 단일 지점만** 고친다. 여럿에 걸친 곳은 손대지 않는다 — 남해대교는
 * 남해군과 하동군을 잇는 다리이고, 서산A지구방조제는 서산과 홍성에,
 * 오서산은 보령과 홍성에 걸쳐 있다. 새만금무궁화공원은 매립지라 관할이
 * 정리되는 중이고, 북악산 숙정문은 종로·성북 경계의 성곽 문인데 주소가
 * '삼청동'까지뿐이며, 대구 신천물놀이장은 중구와 남구 사이를 흐르는 신천
 * 둔치 시설이다. 걸쳐 있는 것을 우리가 한쪽으로 정하는 것은 근거 없는
 * 판단이고, 하루 동선 관점에서도 어느 쪽이든 큰 차이가 없다. 그래서 그
 * 여섯은 TourAPI 가 준 대로 둔다 — 다음에 이 목록을 보는 사람이 같은 고민을
 * 되풀이하지 않도록 여기 적어 둔다.
 *
 * 고친 행은 region_source 를 manual 로 내보낸다. 사람이 정한 값이라는 뜻이고,
 * 적재 upsert 가 manual 행의 지역을 건드리지 않으므로 운영 DB 에서도 유지된다.
 */
const PLACE_REGION_FIX = {
  130573: '1|용산구', // 갤러리에스피 — 서울 강남구로 들어가 있었다
  2856080: '1|강남구', // 스와니예 — 서초구
  2704340: '1|성동구', // 디뮤지엄 — 용산구
  130511: '1|성북구', // 간송미술관(서울 보화각) — 중구
  2873360: '2|미추홀구', // 만복짬뽕집 — 계양구
  2573888: '7|북구', // 정문식곱창구이 — 남구
  1116733: '33|충주시', // 오대호 아트팩토리 — 음성군
  // 시/도까지 어긋난 것. 이름에 속기 쉬우니 주소를 믿는다.
  2831661: '7|울주군', // 우산국초밥 — '우산국'이 울릉도의 옛 이름이라 경북 울릉군으로 들어갔다
  3454383: '34|홍성군', // 이응노의 집 — 전남 영암군으로 들어갔다
  // 좌표까지 주소를 편드는 경우. 가게 이름('부평남부역점')만 인천을 가리킨다.
  2833868: '32|태백시', // 모녀떡볶이 부평남부역점 — 인천 부평구로 들어갔다
}

/**
 * 보고 나서 그대로 두기로 한 행 — contentid → 이유.
 *
 * 코드↔주소 대조에 계속 뜨지만 고칠 것이 아니다. 목록에 남겨 두면 다음에
 * 보는 사람이 "아직 안 본 것"으로 오해해 같은 조사를 되풀이한다. 리포트가
 * 이것들을 따로 세서 '사람이 보고 두기로 한 것'으로 보고한다.
 */
const REGION_KEPT = {
  129500: '북악산 숙정문 — 종로·성북 경계의 성곽 문. 주소가 삼청동까지뿐이다',
  2993587: '대구 신천물놀이장 — 중구와 남구 사이를 흐르는 신천 둔치 시설',
  126746: '오서산 — 보령시와 홍성군에 걸친 산',
  1937809: '서산A지구방조제 — 서산시와 홍성군에 걸친 방조제',
  249950: '남해대교 — 남해군과 하동군을 잇는 다리',
  2743296: '새만금무궁화공원 — 새만금 매립지, 관할이 정리되는 중',
  2614852: '입석대(무등산권 국가지질공원) — 무등산 주상절리대가 광주와 화순에 걸쳐 있다',
}

/**
 * 좌표가 믿을 수 없는 행 — contentid → 사유.
 *
 * 한국 범위 밖은 `inKorea()` 가 이미 걸러낸다. 여기 적는 것은 범위 안이지만
 * 엉뚱한 곳을 가리키는 경우다. 코드와 주소는 서로 맞아서 코드↔주소 대조에
 * 걸리지 않고, 좌표만 틀렸다.
 *
 * 왜 서비스에서 빼는가. 지도에 잘못 찍히는 것으로 끝나지 않는다. 이 앱은
 * 하루 동선을 짜는 도구라, 안민고개를 창원 일정에 넣으면 동선이 170km 서쪽으로
 * 끌려간다. **틀린 좌표는 없는 장소보다 나쁘다.** 범위 밖 좌표를 미판정으로
 * 보내는 것과 같은 이유이고, 같은 길로 보낸다 — 데이터는 남으므로 좌표가
 * 고쳐지면 바로 돌아온다.
 *
 * 왜 자동 판정으로 하지 않는가. "자기 시군구에서 너무 멀다"를 규칙으로 걸면
 * 언젠가 멀쩡한 장소를 조용히 지운다 — 새로 생긴 섬의 가게 하나가 그 이유로
 * 사라지면 아무도 모른다. 사람이 보고 넣는 목록으로 두고, 적응형 검사는
 * 리포트에 남겨 새것이 생기면 알려 주는 파수꾼만 맡긴다 (아래 좌표 이상치).
 */
const COORD_SUSPECT = {
  1955582: '좌표가 포항 오천읍을 가리킨다 — TourAPI 에 포항·대구 두 건이 있는데 대구 쪽이 포항 좌표를 달고 있다',
  127384: '좌표의 경도가 128.7 이어야 할 자리에 126.7 이 들어가 광주 근처를 가리킨다',
  129216: '좌표가 충남 보령 근처를 가리킨다 — 영광 백수읍과 115km 떨어져 있다',
}

const AREA_NAME = {
  세종특별자치시: '세종',
  경기도: '경기',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  경상북도: '경북',
  경상남도: '경남',
  전북특별자치도: '전북',
  전라남도: '전남',
  제주특별자치도: '제주',
}

/** 드롭다운에 보이는 시/도 순서. 여기 없는 이름은 뒤에 붙는다. */
const AREA_ORDER = [
  '서울', '경기', '인천', '부산', '제주', '강원', '대구', '대전',
  '광주', '울산', '세종', '충북', '충남', '전북', '전남', '경북', '경남',
]

/** 미판정 센티넬 */
const NO_CODE = -1
const NO_NAME = '미판정'

/**
 * 대한민국 좌표 범위(본토·제주·울릉/독도까지).
 *
 * TourAPI 원본에 좌표가 통째로 잘못된 행이 섞여 있다 — 서울 장소 여러 건이
 * 19.694, 117.993(필리핀 앞바다)으로 들어온다. 그대로 두면 지도에 엉뚱한 곳에
 * 찍히고 거리·동선 계산이 망가지며, 지역 중심 좌표까지 끌어내린다.
 * 범위를 벗어난 행은 버리지 않고 미판정으로 격리해 수동 처리 대기열에 둔다.
 */
const KR_BOUNDS = { latMin: 33.0, latMax: 38.7, lngMin: 124.5, lngMax: 132.0 }
const inKorea = (lat, lng) =>
  lat >= KR_BOUNDS.latMin && lat <= KR_BOUNDS.latMax &&
  lng >= KR_BOUNDS.lngMin && lng <= KR_BOUNDS.lngMax

/**
 * 앱 카테고리 매핑 — 전국 실측 분포에 근거한다.
 *   술집: cat3 에는 주점 코드가 아예 없고 lclsSystm2 의 FD04 로만 잡힌다(전국 3건)
 *   카페: cat3 A05020900 (전국 1,850건)
 */
function toCategory(it) {
  const type = String(it.contenttypeid ?? '')
  if (type === '12' || type === '14') return 'spot'
  if (it.lclsSystm2 === 'FD04') return 'sulzip'
  if (it.cat3 === 'A05020900') return 'cafe'
  return 'babzip'
}

/* ───────────────────────── 텍스트 정리 ───────────────────────── */

const stripHtml = (s) =>
  String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' - ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/** 소개는 첫 문장만. 카드와 상세에 한 줄로 들어간다. */
function toSummary(overview) {
  const t = stripHtml(overview)
  if (!t) return ''
  const m = t.match(/^.{10,200}?(?:다\.|요\.|음\.|\.)/)
  const first = m ? m[0] : t.slice(0, 200)
  return first.replace(/\.$/, '').trim()
}

/** detailIntro2 는 콘텐츠타입마다 필드 이름이 다르다. */
const pick = (o, ...keys) => {
  for (const k of keys) {
    const v = o?.[k]
    if (typeof v === 'string' && v.trim()) return stripHtml(v)
  }
  return ''
}
const openHoursOf = (intro) => pick(intro, 'opentimefood', 'usetime', 'usetimeculture')
const phoneOf = (intro, common) =>
  pick(intro, 'infocenterfood', 'infocenter', 'infocenterculture') || pick(common, 'tel')

/* ───────────────────────── SQL ───────────────────────── */

const q = (v) => (v === null || v === undefined || v === '' ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const qs = (v) => `'${String(v ?? '').replace(/'/g, "''")}'` // not null 컬럼용 (빈 문자열 허용)
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? 'null' : String(v))

/* ───────────────────────── 적재 ───────────────────────── */

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : DEFAULT_OUT

  const files = new Set(await readdir(RAW))
  if (!files.has('area-codes.json')) {
    console.error('raw/area-codes.json 이 없습니다. 먼저 collect.mjs 를 돌리세요.')
    process.exit(1)
  }

  const areas = await readJson(path.join(RAW, 'area-codes.json'))

  // ── 시군구 코드표 ────────────────────────────────────────────────
  /** `${area}-${sigungu}` → { areaCode, code, name } */
  const leaf = new Map()
  /** areaCode → [{code, name}] — 주소 매칭 후보 */
  const leavesOfArea = new Map()
  for (const a of areas) {
    const f = `sigungu-${a.code}.json`
    if (!files.has(f)) continue
    const sgs = await readJson(path.join(RAW, f))
    // name 은 화면·DB 에 쓸 이름, match 는 TourAPI 원본 이름이다. 주소 매칭과
    // 코드↔주소 대조는 원본 이름으로 해야 한다 — 고친 이름으로 주소를 뒤지면
    // '제물포·영종(옛 중구)' 같은 문자열을 찾게 되어 아무것도 맞지 않는다.
    const list = sgs.map((s) => ({
      code: Number(s.code),
      name: LEAF_NAME[`${a.code}|${s.name}`] ?? s.name,
      match: s.name,
    }))
    leavesOfArea.set(Number(a.code), list)
    for (const s of list) leaf.set(`${a.code}-${s.code}`, { areaCode: Number(a.code), ...s })
  }

  // 긴 이름부터 맞춘다 — '서구'가 '강서구'에 부분 문자열로 걸리는 걸 막는다.
  // 매칭에 쓰는 이름(match) 기준이다.
  for (const list of leavesOfArea.values()) list.sort((x, y) => y.match.length - x.match.length)

  // ── 장소 ─────────────────────────────────────────────────────────
  const places = []
  const stats = { tour: 0, addr: 0, manual: 0, unresolved: 0, noDetail: 0, dropped: 0, badCoord: 0 }
  const fixMisses = []
  const unresolvedSamples = []
  const badCoordSamples = []
  /** `${area}-${sigungu}` → {lat,lng,n, ldong:{}} */
  const agg = new Map()

  for (const a of areas) {
    const codes = (leavesOfArea.get(Number(a.code)) ?? []).map((s) => s.code)
    const leafCodes = codes.length ? codes : [0]
    for (const c of leafCodes) {
      for (const t of CONTENT_TYPES) {
        const lf = `places-${a.code}-${c}-${t}.json`
        if (!files.has(lf)) continue
        const items = await readJson(path.join(RAW, lf))
        const df = `detail-${a.code}-${c}-${t}.json`
        const detail = files.has(df) ? await readJson(path.join(RAW, df)) : {}

        for (const it of items) {
          const lat = Number(it.mapy)
          const lng = Number(it.mapx)
          if (!it.contentid || !it.title || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            stats.dropped++
            continue
          }

          // ── 지역 판정 ──
          let areaCode = Number(it.areacode) || Number(a.code)
          let sigungu = Number(it.sigungucode)
          let source = 'tour'
          let note = null

          // 좌표를 믿을 수 없으면 다른 값이 멀쩡해도 서비스에 낼 수 없다.
          // 지역 판정보다 먼저 걸러 미판정으로 보낸다. 여기서 빼므로 지역
          // 중심 좌표 누적에도 들어가지 않는다 — 안 그러면 174km 떨어진 한
          // 점이 그 시군구의 중심을 끌고 간다.
          const suspect = COORD_SUSPECT[it.contentid]
          if (!inKorea(lat, lng) || suspect) {
            const d0 = detail[it.contentid]
            stats.badCoord++
            stats.unresolved++
            if (badCoordSamples.length < 8)
              badCoordSamples.push(`${it.title} (${lat}, ${lng}) | ${it.addr1 ?? ''}`)
            places.push({
              id: String(it.contentid),
              name: it.title,
              category: toCategory(it),
              area: areaCode,
              sigungu: NO_CODE,
              address: it.addr1 ?? '',
              lat,
              lng,
              image: it.firstimage || it.firstimage2 || null,
              summary: toSummary(d0?.common?.overview),
              open_hours: openHoursOf(d0?.intro),
              phone: phoneOf(d0?.intro, d0?.common) || null,
              modified: it.modifiedtime ?? null,
              source: 'unresolved',
              note: suspect
                ? `${suspect} (${lat}, ${lng}) — 주소로 좌표를 고쳐야 한다`
                : `좌표가 한국 범위 밖(${lat}, ${lng}) — TourAPI 원본 오류. 주소로 좌표를 고쳐야 한다`,
            })
            continue
          }

          if (!Number.isFinite(sigungu) || !leaf.has(`${areaCode}-${sigungu}`)) {
            // 2순위 — 주소에서 시군구명 찾기. 후보가 그 시/도의 것으로 좁혀져 있다.
            const addr = String(it.addr1 ?? '')
            const hit = (leavesOfArea.get(areaCode) ?? []).find((s) => addr.includes(s.match))
            if (hit) {
              sigungu = hit.code
              source = 'addr'
            } else {
              sigungu = NO_CODE
              source = 'unresolved'
              note = `sigunguCode ${it.sigungucode ? `'${it.sigungucode}' 가 코드표에 없음` : '없음'}, 주소에서도 시군구명을 찾지 못함 (${addr || '주소 없음'})`
              if (unresolvedSamples.length < 10) unresolvedSamples.push(`${it.title} | ${addr}`)
            }
          }

          // 사람이 정한 교정이 있으면 판정 결과를 덮는다 (PLACE_REGION_FIX)
          const fix = PLACE_REGION_FIX[it.contentid]
          if (fix) {
            const [fa, fname] = fix.split('|')
            const target = (leavesOfArea.get(Number(fa)) ?? []).find((x) => x.match === fname)
            if (target) {
              areaCode = Number(fa)
              sigungu = target.code
              source = 'manual'
              note = `주소가 ${fname} 를 가리켜 사람이 옮김 — TourAPI sigunguCode '${it.sigungucode}' 는 다른 구였다`
            } else {
              // 코드표가 바뀌어 교정이 가리키는 구가 사라진 경우. 조용히 넘기면
              // 교정이 죽은 줄도 모르므로 리포트에 올린다.
              fixMisses.push(`${it.contentid} ${it.title} → ${fix} (코드표에 없음)`)
            }
          }
          stats[source]++

          const d = detail[it.contentid]
          if (!d) stats.noDetail++

          places.push({
            id: String(it.contentid),
            name: it.title,
            category: toCategory(it),
            area: areaCode,
            sigungu,
            address: it.addr1 ?? '',
            lat,
            lng,
            image: it.firstimage || it.firstimage2 || null,
            summary: toSummary(d?.common?.overview),
            open_hours: openHoursOf(d?.intro),
            phone: phoneOf(d?.intro, d?.common) || null,
            modified: it.modifiedtime ?? null,
            source,
            note,
          })

          // 지역 중심 좌표와 법정동코드는 그 지역 장소들에서 얻는다
          if (source !== 'unresolved') {
            const k = `${areaCode}-${sigungu}`
            const e = agg.get(k) ?? { lat: 0, lng: 0, n: 0, ldong: {} }
            e.lat += lat
            e.lng += lng
            e.n++
            if (it.lDongRegnCd && it.lDongSignguCd) {
              const cd = `${it.lDongRegnCd}${it.lDongSignguCd}`
              e.ldong[cd] = (e.ldong[cd] ?? 0) + 1
            }
            agg.set(k, e)
          }
        }
      }
    }
  }

  // ── 지역 행 만들기 ────────────────────────────────────────────────
  const center = (k, fallback) => {
    const e = agg.get(k)
    return e && e.n ? { lat: +(e.lat / e.n).toFixed(6), lng: +(e.lng / e.n).toFixed(6) } : fallback
  }
  const KR = { lat: 36.5, lng: 127.8 }

  const groupRows = []
  const regionRows = []
  /** 장소가 한 곳도 없어 적재하지 않은 시군구 — 리포트에 남긴다 */
  const emptyLeaves = []
  const orderOf = (n) => {
    const i = AREA_ORDER.indexOf(n)
    return i < 0 ? AREA_ORDER.length : i
  }

  for (const a of areas) {
    const code = Number(a.code)
    const name = AREA_NAME[a.name] ?? a.name
    const list = leavesOfArea.get(code) ?? []
    // 시/도 중심 = 그 시/도 장소들의 평균
    let sum = { lat: 0, lng: 0, n: 0 }
    for (const s of list.length ? list : [{ code: 0 }]) {
      const e = agg.get(`${code}-${s.code}`)
      if (e) {
        sum.lat += e.lat
        sum.lng += e.lng
        sum.n += e.n
      }
    }
    const gc = sum.n ? { lat: +(sum.lat / sum.n).toFixed(6), lng: +(sum.lng / sum.n).toFixed(6) } : KR
    groupRows.push({ code, name, ...gc, order: orderOf(name) })

    // 장소가 한 곳도 없는 시군구는 넣지 않는다.
    //
    // TourAPI 코드표에는 오래전에 없어진 행정구역이 남아 있다 — 진해시·마산시
    // (2010년 창원시 통합), 남제주군·북제주군(2006년 폐지), 청원군(2014년 청주시
    // 통합). 그대로 적재하면 드롭다운에 뜨고, 고르면 빈 화면이 된다.
    //
    // 버리는 게 아니라 '이번 수집분에 장소가 없어서 넣지 않는' 것이다. 나중에
    // 장소가 생기면 재적재 때 자동으로 들어온다.
    const withPlaces = list.filter((s) => (agg.get(`${code}-${s.code}`)?.n ?? 0) > 0)
    for (const s of list) {
      if (!withPlaces.includes(s)) emptyLeaves.push(`${name} ${s.name}`)
    }

    // 시군구는 가나다순 — 스물몇 개를 훑을 때 예측 가능한 게 낫다
    const byName = [...withPlaces].sort((x, y) => x.name.localeCompare(y.name, 'ko'))
    byName.forEach((s, i) => {
      const k = `${code}-${s.code}`
      const c = center(k, gc)
      const ld = agg.get(k)?.ldong ?? {}
      const top = Object.entries(ld).sort((x, y) => y[1] - x[1])[0]
      regionRows.push({ area: code, code: s.code, name: s.name, ldong: top?.[0] ?? null, ...c, order: i })
    })
    // 시/도마다 미판정 리프를 둔다
    regionRows.push({ area: code, code: NO_CODE, name: NO_NAME, ldong: null, ...gc, order: 999 })
  }

  // 시/도조차 모를 때
  groupRows.push({ code: NO_CODE, name: NO_NAME, ...KR, order: 999 })
  regionRows.push({ area: NO_CODE, code: NO_CODE, name: NO_NAME, ldong: null, ...KR, order: 999 })

  // ── SQL ──────────────────────────────────────────────────────────
  const L = []
  L.push('-- =====================================================================')
  L.push('-- 지역 + 장소 카탈로그 — intent/2026-09-20-재수집-스키마-교체/load.mjs 가 생성')
  L.push(`-- 생성: ${new Date().toISOString()}`)
  L.push(`-- 시/도 ${groupRows.length} · 시군구 ${regionRows.length} · 장소 ${places.length}`)
  L.push('--')
  L.push('-- 손으로 고치지 마세요. 수집 원본(raw/)을 고치고 load.mjs 를 다시 돌리세요.')
  L.push('-- =====================================================================')
  L.push('')
  L.push('-- 한 트랜잭션으로 넣는다. `set local` 은 트랜잭션 안에서만 듣기 때문에,')
  L.push('-- 감싸지 않으면 재적재 때 지역 변경 트리거가 region_source 를 manual 로')
  L.push('-- 바꿔 버려 다음 적재가 그 행을 영영 갱신하지 못한다.')
  L.push('begin;')
  L.push("set local app.region_batch = 'on';")
  L.push('')

  L.push('insert into public.region_groups (tour_area_code, name, lat, lng, sort_order) values')
  L.push(
    groupRows
      .map((g) => `  (${g.code}, ${qs(g.name)}, ${num(g.lat)}, ${num(g.lng)}, ${g.order})`)
      .join(',\n') + '\non conflict (tour_area_code) do update set',
  )
  L.push('  name = excluded.name, lat = excluded.lat, lng = excluded.lng, sort_order = excluded.sort_order;')
  L.push('')

  L.push('insert into public.regions (tour_area_code, tour_sigungu_code, name, ldong_cd, lat, lng, sort_order) values')
  L.push(
    regionRows
      .map((r) => `  (${r.area}, ${r.code}, ${qs(r.name)}, ${q(r.ldong)}, ${num(r.lat)}, ${num(r.lng)}, ${r.order})`)
      .join(',\n') + '\non conflict (tour_area_code, tour_sigungu_code) do update set',
  )
  L.push('  name = excluded.name, ldong_cd = excluded.ldong_cd, lat = excluded.lat,')
  L.push('  lng = excluded.lng, sort_order = excluded.sort_order;')
  L.push('')

  // 장소는 덩어리로 나눠 넣는다 — 한 문장이 지나치게 길면 편집기가 버거워진다
  const CHUNK = 500
  for (let i = 0; i < places.length; i += CHUNK) {
    const part = places.slice(i, i + CHUNK)
    L.push(
      'insert into public.places (id, name, category, tour_area_code, tour_sigungu_code,' +
        ' address, lat, lng, image_url, source_rating, price_level, tags, summary, open_hours,' +
        ' phone, source_modified_at, region_source, region_note) values',
    )
    L.push(
      part
        .map(
          (p) =>
            `  (${q(p.id)}, ${qs(p.name)}, '${p.category}', ${p.area}, ${p.sigungu}, ${qs(p.address)},` +
            ` ${num(p.lat)}, ${num(p.lng)}, ${q(p.image)}, null, 2, '{}'::text[], ${qs(p.summary)},` +
            ` ${qs(p.open_hours)}, ${q(p.phone)}, ${q(p.modified)}, '${p.source}', ${q(p.note)})`,
        )
        .join(',\n') + '\non conflict (id) do update set',
    )
    L.push('  name = excluded.name, category = excluded.category,')
    L.push('  address = excluded.address, lat = excluded.lat, lng = excluded.lng,')
    L.push('  image_url = excluded.image_url, summary = excluded.summary,')
    L.push('  open_hours = excluded.open_hours, phone = excluded.phone,')
    L.push('  source_modified_at = excluded.source_modified_at,')
    // 사람이 고친 지역은 재적재가 덮지 않는다
    L.push("  tour_area_code = case when public.places.region_source = 'manual'")
    L.push('    then public.places.tour_area_code else excluded.tour_area_code end,')
    L.push("  tour_sigungu_code = case when public.places.region_source = 'manual'")
    L.push('    then public.places.tour_sigungu_code else excluded.tour_sigungu_code end,')
    L.push("  region_source = case when public.places.region_source = 'manual'")
    L.push("    then 'manual'::region_source_kind else excluded.region_source end,")
    L.push("  region_note = case when public.places.region_source = 'manual'")
    L.push('    then public.places.region_note else excluded.region_note end')
    // 수동 등록 행(source='manual')은 배치가 건드리지 않는다. id 접두사 'm-' 가
    // TourAPI contentid(6~7자리 숫자)와 겹칠 수 없어 여기 걸릴 일은 없지만,
    // 안전장치가 접두사 규약 하나에만 걸려 있지 않게 조건을 박아 둔다.
    L.push("  where public.places.source = 'tour';")
    L.push('')
  }

  L.push('commit;')
  const sql = L.join('\n')

  // ── 좌표 이상치 파수꾼 ───────────────────────────────────────────
  //
  // 코드와 주소가 서로 맞으면 코드↔주소 대조는 통과한다. 그래서 **좌표만
  // 틀린 경우**는 그 다리로 잡히지 않는다. 경계 데이터로 역지오코딩을 하는
  // 것이 정석이지만 그 데이터가 2026년 7월 개편을 반영하지 못했다(Q8).
  //
  // 대신 장소들이 모여 있는 모양을 쓴다. 각 시군구가 자기 장소들로 중앙값과
  // p90 퍼짐을 내고, 그 5배이자 20km 를 넘는 점만 본다. 섬이 흩어진 곳은
  // p90 자체가 커서 걸리지 않는다 — 옹진군은 백령도까지 170km 뻗어 있고
  // 신안군도 마찬가지다. 고정 거리(30km)로 재면 231건이 나오는데 대부분
  // 지리적 사실이고, 시/도 중심과 견주면 85건이 나오는데 문경·상주가 경북
  // 중심보다 충북 중심에 가까운 것도 사실이다. 그래서 상대 기준이 맞다.
  //
  // 여기서 걸린 것을 자동으로 빼지는 않는다. 사람이 보고 COORD_SUSPECT 에
  // 넣는다 — 그 이유는 그 상수 주석에 있다.
  const medOf = (xs) => {
    const a = [...xs].sort((x, y) => x - y)
    return a[Math.floor(a.length / 2)]
  }
  const qOf = (xs, p) => {
    const a = [...xs].sort((x, y) => x - y)
    return a[Math.min(a.length - 1, Math.floor(a.length * p))]
  }
  const haversineKm = (a, b) => {
    const R = 6371
    const rad = (x) => (x * Math.PI) / 180
    const dLat = rad(b[0] - a[0])
    const dLng = rad(b[1] - a[1])
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
    return 2 * R * Math.asin(Math.sqrt(h))
  }

  const placesByLeaf = new Map()
  for (const p of places) {
    if (p.source === 'unresolved') continue
    const k = `${p.area}-${p.sigungu}`
    ;(placesByLeaf.get(k) ?? placesByLeaf.set(k, []).get(k)).push(p)
  }
  const coordOutliers = []
  for (const [k, ps] of placesByLeaf) {
    if (ps.length < 8) continue // 표본이 적으면 중앙값도 퍼짐도 믿을 수 없다
    const c = [medOf(ps.map((p) => p.lat)), medOf(ps.map((p) => p.lng))]
    const ds = ps.map((p) => haversineKm(c, [p.lat, p.lng]))
    const limit = Math.max(20, qOf(ds, 0.9) * 5)
    ps.forEach((p, i) => {
      if (ds[i] > limit) {
        coordOutliers.push({
          id: p.id,
          name: p.name,
          leaf: k,
          km: Math.round(ds[i]),
          limitKm: Math.round(limit),
          address: p.address,
        })
      }
    })
  }
  coordOutliers.sort((a, b) => b.km / b.limitKm - a.km / a.limitKm)

  // ── 코드 ↔ 주소 대조 ─────────────────────────────────────────────
  //
  // 1순위(sigunguCode)가 코드표에 있으면 거기서 판정을 끝낸다. 빠르고 대개
  // 맞지만, 1순위가 **틀렸을 때 아무도 모른다**는 구멍이 있다. 주소는 이미
  // 손에 있으니, 배정한 구의 이름이 주소에 들어 있는지만 봐도 그 구멍이
  // 상당 부분 메워진다. 좌표까지 넣는 3자 대조는 역지오코딩 경계 데이터가
  // 필요하고 그 데이터가 2026년 7월 행정구역 개편을 반영하지 못해 미룬다.
  //
  // 어긋나는 경우가 두 종류라 나눠 센다.
  //
  //   · 코드표에 아예 없는 구 — 행정구역이 바뀌었는데 TourAPI 코드표가
  //     따라오지 못한 경우다. 2026-10-02 기준 인천이 그렇다. 주소는
  //     영종구·제물포구·검단구·서해구인데 코드표에는 옛 중구·동구·서구뿐이라
  //     186곳이 옛 구로 들어간다. 우리가 고칠 수 있는 것이 아니므로 규모만
  //     보고한다.
  //   · 코드표에 있는 다른 구 — TourAPI 원본의 코드 오류이거나, 남해대교처럼
  //     두 시군에 걸친 명소다. 사람이 하나씩 보고 판단할 대상이다.
  //
  // 전체 목록은 raw/addr-mismatch.json 에 남긴다. 예시만 콘솔에 띄우면
  // "쌓이는 걸 아무도 모른다"는 14번의 문제가 그대로 되풀이된다.
  const leafOf = new Map()
  const matchNamesOfArea = new Map()
  for (const [areaCode, list] of leavesOfArea) {
    matchNamesOfArea.set(areaCode, list.map((s) => s.match))
    for (const s of list) leafOf.set(`${areaCode}-${s.code}`, s)
  }
  const areaNameOf = new Map(groupRows.map((g) => [g.code, g.name]))
  // 주소 앞머리와 맞춰 볼 TourAPI 원본 시/도 이름 ('울산'은 '울산광역시'의
  // 앞머리라 그대로 맞는다. '전라남도'는 '전남광주통합특별시'와 맞지 않아
  // 걸러지지 않는데, 그건 통합 자체가 코드표에 없는 경우라 맞는 분류다)
  const rawAreaName = new Map(areas.map((a) => [Number(a.code), a.name]))

  const mismatches = []
  let noAddr = 0
  for (const p of places) {
    if (p.source !== 'tour') continue
    const lf = leafOf.get(`${p.area}-${p.sigungu}`)
    if (!lf) continue
    if (!p.address) {
      noAddr++
      continue
    }
    if (p.address.includes(lf.match)) continue
    // 주소가 가리키는 구가 코드표에 있는가
    const inTable = (matchNamesOfArea.get(p.area) ?? []).find((n) => p.address.includes(n)) ?? null
    // 시/도까지 어긋난 경우를 따로 가른다. 같은 시/도 안에서만 찾으면 이런
    // 행이 '코드표에 없는 구'로 분류돼 인천 개편 건과 뒤섞인다 — 성격이
    // 전혀 다른데도 한 덩어리로 보이면 아무도 손대지 않는다.
    let wrongArea = null
    if (!inTable) {
      for (const [ac, raw] of rawAreaName) {
        if (ac === p.area || !p.address.startsWith(raw)) continue
        const hit = (matchNamesOfArea.get(ac) ?? []).find((n) => p.address.includes(n))
        if (hit) {
          wrongArea = `${raw} ${hit}`
          break
        }
      }
    }
    const kept = REGION_KEPT[p.id]
    mismatches.push({
      id: p.id,
      name: p.name,
      area: areaNameOf.get(p.area) ?? String(p.area),
      assigned: lf.name,
      assignedMatch: lf.match,
      address: p.address,
      kind: kept ? 'kept' : inTable ? 'wrong-code' : wrongArea ? 'wrong-area' : 'not-in-table',
      addressLeaf: inTable ?? wrongArea,
      keptReason: kept ?? null,
    })
  }

  const byKind = { 'not-in-table': 0, 'wrong-code': 0, 'wrong-area': 0, kept: 0 }
  const byArea = {}
  for (const m of mismatches) {
    byKind[m.kind]++
    byArea[m.area] = (byArea[m.area] ?? 0) + 1
  }
  if (!dry) {
    await writeFile(
      path.join(RAW, 'addr-mismatch.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          checked: stats.tour,
          noAddress: noAddr,
          byKind,
          byArea,
          rows: mismatches,
          coordOutliers,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
  }

  // ── 리포트 ───────────────────────────────────────────────────────
  const byCat = {}
  const byLeaf = new Map()
  for (const p of places) {
    byCat[p.category] = (byCat[p.category] ?? 0) + 1
    const k = `${p.area}-${p.sigungu}`
    byLeaf.set(k, (byLeaf.get(k) ?? 0) + 1)
  }
  const buckets = { '1-4': 0, '5-9': 0, '10-19': 0, '20+': 0 }
  for (const n of byLeaf.values()) {
    if (n < 5) buckets['1-4']++
    else if (n < 10) buckets['5-9']++
    else if (n < 20) buckets['10-19']++
    else buckets['20+']++
  }

  console.log('══════════════════ 적재 리포트 ══════════════════')
  console.log(`시/도 ${groupRows.length}(미판정 1 포함) · 시군구 ${regionRows.length}(미판정 ${areas.length + 1} 포함)`)
  console.log(`장소 ${places.length}건 · 버린 행 ${stats.dropped}건(필수 값 없음)`)
  console.log('')
  console.log('── 지역 판정 경로 ──')
  const tot = places.length || 1
  for (const k of ['tour', 'addr', 'manual', 'unresolved']) {
    console.log(`  ${k.padEnd(11)} ${String(stats[k]).padStart(6)} (${((stats[k] / tot) * 100).toFixed(2)}%)`)
  }
  console.log(`  그중 좌표 오류로 격리: ${stats.badCoord}건`)
  if (badCoordSamples.length) {
    console.log('  좌표 오류 예시:')
    for (const s of badCoordSamples) console.log(`    · ${s}`)
  }
  if (unresolvedSamples.length) {
    console.log('  시군구 판정 실패 예시:')
    for (const s of unresolvedSamples) console.log(`    · ${s}`)
  }
  console.log('')
  console.log('── 카테고리 ──')
  for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(7)} ${v}`)
  console.log('')
  if (fixMisses.length) {
    console.log(`  ⚠ PLACE_REGION_FIX ${fixMisses.length}건이 적용되지 않았습니다 — 코드표를 확인하세요`)
    for (const m of fixMisses) console.log(`    · ${m}`)
  }
  console.log('── 좌표 이상치 ──')
  if (!coordOutliers.length) {
    console.log('  자기 시군구의 평소 퍼짐을 크게 벗어난 좌표: 없음')
  } else {
    console.log(`  ⚠ ${coordOutliers.length}건 — 보고 나서 COORD_SUSPECT 에 넣을지 판단하세요`)
    for (const o of coordOutliers.slice(0, 10)) {
      console.log(`    · ${o.name} — 자기 시군구 중심에서 ${o.km}km (한계 ${o.limitKm}km) | ${o.address}`)
    }
  }
  console.log('')
  console.log('── 코드 ↔ 주소 대조 ──')
  const mtot = mismatches.length
  console.log(
    `  1순위로 판정한 ${stats.tour}곳 중 ${mtot}곳(${((mtot / (stats.tour || 1)) * 100).toFixed(2)}%)이 주소와 어긋남` +
      (noAddr ? ` · 주소가 없어 대조 못한 곳 ${noAddr}` : ''),
  )
  console.log(`    코드표에 없는 구: ${byKind['not-in-table']}건 (행정구역 개편을 TourAPI 가 못 따라온 경우)`)
  console.log(`    코드표의 다른 구: ${byKind['wrong-code']}건 (원본 오류 — 사람이 볼 대상)`)
  console.log(`    시/도까지 다름: ${byKind['wrong-area']}건 (원본 오류 — 사람이 볼 대상)`)
  console.log(`    보고 나서 둔 것: ${byKind.kept}건 (여럿에 걸쳐 어느 쪽도 맞다 하기 어려운 곳)`)
  for (const [a, n] of Object.entries(byArea).sort((x, y) => y[1] - x[1]).slice(0, 5)) {
    console.log(`    ${a.padEnd(6)} ${n}`)
  }
  for (const m of mismatches.filter((x) => x.kind === 'wrong-code' || x.kind === 'wrong-area').slice(0, 5)) {
    console.log(`    · ${m.name} — ${m.area} ${m.assigned} 로 들어감 | ${m.address}`)
  }
  console.log('  전체 목록: raw/addr-mismatch.json')
  console.log('')
  console.log(`── 상세 없는 장소: ${stats.noDetail}건 (${((stats.noDetail / tot) * 100).toFixed(1)}%) ──`)
  console.log('   소개·영업시간·전화가 빈 채로 적재됩니다. 수집이 끝나면 다시 돌리세요.')
  console.log('')
  if (emptyLeaves.length) {
    console.log(`── 장소가 없어 적재하지 않은 시군구: ${emptyLeaves.length}개 ──`)
    console.log('   대개 폐지된 행정구역이 TourAPI 코드표에 남아 있는 경우다.')
    for (const n of emptyLeaves) console.log(`     · ${n}`)
    console.log('')
  }

  console.log('── 시군구별 장소 수 (미판정 제외) ──')
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(6)}곳: ${v}개`)
  console.log('')

  if (dry) {
    console.log(`--dry 이므로 파일을 쓰지 않았습니다. (SQL ${(sql.length / 1024 / 1024).toFixed(1)}MB 예상)`)
    return
  }
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, sql + '\n', 'utf8')
  console.log(`${path.relative(process.cwd(), out)} 에 썼습니다 — ${(sql.length / 1024 / 1024).toFixed(1)}MB`)

  if (args.includes('--demo')) await writeDemo(groupRows, regionRows, places)
}

/**
 * 데모 모드(.env 없이 실행) 데이터.
 *
 * 지역은 전량 넣는다 — 252행뿐이고, 일부만 넣으면 드롭다운에서 어떤 시/도는
 * 구가 비어 보인다. 장소는 몇 개 시군구만 골라 넣는다. 상세가 채워진 서울 구와
 * 아직 안 채워진 부산·제주를 섞어, 빈 소개·영업시간을 숨기는 처리까지 데모에서
 * 확인되게 한다.
 */
async function writeDemo(groupRows, regionRows, places) {
  const PICK = [
    [1, '강남구'], [1, '성동구'], [1, '마포구'], [1, '서초구'],
    [6, '해운대구'], [39, '제주시'],
  ]
  const PER_LEAF = 20

  const nameOfArea = new Map(groupRows.map((g) => [g.code, g.name]))
  const leafByName = new Map(regionRows.map((r) => [`${r.area}|${r.name}`, r]))

  // 카테고리별로 골고루 뽑는다. 그냥 앞에서 자르면 수집 순서상 음식점만 담겨
  // 데모에서 명소 필터가 빈 화면이 된다.
  const QUOTA = { babzip: 8, cafe: 4, spot: 8, sulzip: 2 }
  const picked = []
  for (const [area, leafName] of PICK) {
    const r = leafByName.get(`${area}|${leafName}`)
    if (!r) continue
    const mine = places.filter((p) => p.area === area && p.sigungu === r.code)
    // 사진이 있는 것 먼저 — 데모 화면이 허전해 보이지 않게
    mine.sort((a, b) => (b.image ? 1 : 0) - (a.image ? 1 : 0))
    let taken = 0
    for (const [cat, n] of Object.entries(QUOTA)) {
      const part = mine.filter((p) => p.category === cat).slice(0, n)
      picked.push(...part)
      taken += part.length
    }
    // 할당량을 못 채웠으면 남은 것으로 메운다
    if (taken < PER_LEAF) {
      const already = new Set(picked.map((p) => p.id))
      picked.push(...mine.filter((p) => !already.has(p.id)).slice(0, PER_LEAF - taken))
    }
  }

  const t = (v) => (v === null || v === undefined ? 'null' : JSON.stringify(v))
  const L = []
  L.push("import type { Place, Region, RegionGroup } from './types'")
  L.push('')
  L.push('/**')
  L.push(' * 데모 모드(Supabase 미연결) 데이터 — load.mjs --demo 가 생성한다.')
  L.push(' * 손으로 고치지 말고 수집 원본에서 다시 생성하세요.')
  L.push(' *')
  L.push(` * 생성: ${new Date().toISOString()}`)
  L.push(' * 지역은 전량, 장소는 몇 개 시군구만 골라 담았다. 상세가 채워진 서울 구와')
  L.push(' * 아직 비어 있는 부산·제주를 섞어, 빈 값을 숨기는 처리도 데모에서 확인된다.')
  L.push(' */')
  L.push('')
  L.push('export const DEMO_REGION_GROUPS: RegionGroup[] = [')
  for (const g of groupRows) {
    L.push(
      `  { tour_area_code: ${g.code}, name: ${t(g.name)}, lat: ${g.lat}, lng: ${g.lng}, sort_order: ${g.order} },`,
    )
  }
  L.push(']')
  L.push('')
  L.push('export const DEMO_REGIONS: Region[] = [')
  for (const r of regionRows) {
    L.push(
      `  { tour_area_code: ${r.area}, tour_sigungu_code: ${r.code}, name: ${t(r.name)},` +
        ` ldong_cd: ${t(r.ldong)}, lat: ${r.lat}, lng: ${r.lng}, sort_order: ${r.order} },`,
    )
  }
  L.push(']')
  L.push('')
  L.push('export const SEED_PLACES: Place[] = [')
  for (const p of picked) {
    const leafName = leafByName.get(`${p.area}|__none__`) // placeholder, 아래에서 실제 이름 사용
    void leafName
    const region = regionRows.find((r) => r.area === p.area && r.code === p.sigungu)
    L.push('  {')
    L.push(`    id: ${t(p.id)}, name: ${t(p.name)}, category: ${t(p.category)},`)
    L.push(
      `    tour_area_code: ${p.area}, tour_sigungu_code: ${p.sigungu},` +
        ` group_name: ${t(nameOfArea.get(p.area) ?? '')}, region_name: ${t(region?.name ?? '')},`,
    )
    L.push(`    address: ${t(p.address)}, lat: ${p.lat}, lng: ${p.lng},`)
    L.push(`    image_url: ${t(p.image)}, source_rating: null, price_level: 2, tags: [],`)
    L.push(`    summary: ${t(p.summary)},`)
    L.push(`    open_hours: ${t(p.open_hours)}, phone: ${t(p.phone)},`)
    L.push(
      `    source_modified_at: ${t(p.modified)}, region_source: ${t(p.source)}, region_note: ${t(p.note)},`,
    )
    // 데모 카탈로그는 전부 TourAPI 에서 온 행이다. 수동 등록 행은 여기 오지 않는다.
    L.push(`    source: 'tour', created_by: null, rating_avg: null, rating_count: 0,`)
    L.push('  },')
  }
  L.push(']')

  const outTs = path.join(HERE, '..', '..', 'src', 'lib', 'seed.ts')
  await writeFile(outTs, L.join('\n') + '\n', 'utf8')
  console.log(
    `src/lib/seed.ts 에 썼습니다 — 지역 ${groupRows.length}+${regionRows.length}, 장소 ${picked.length}곳`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
