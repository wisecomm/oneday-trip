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
    const list = sgs.map((s) => ({ code: Number(s.code), name: s.name }))
    leavesOfArea.set(Number(a.code), list)
    for (const s of list) leaf.set(`${a.code}-${s.code}`, { areaCode: Number(a.code), ...s })
  }

  // 긴 이름부터 맞춘다 — '서구'가 '강서구'에 부분 문자열로 걸리는 걸 막는다
  for (const list of leavesOfArea.values()) list.sort((x, y) => y.name.length - x.name.length)

  // ── 장소 ─────────────────────────────────────────────────────────
  const places = []
  const stats = { tour: 0, addr: 0, unresolved: 0, noDetail: 0, dropped: 0, badCoord: 0 }
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
          const areaCode = Number(it.areacode) || Number(a.code)
          let sigungu = Number(it.sigungucode)
          let source = 'tour'
          let note = null

          // 좌표가 한국 범위 밖이면 다른 값이 멀쩡해도 서비스에 낼 수 없다.
          // 지역 판정보다 먼저 걸러 미판정으로 보낸다.
          if (!inKorea(lat, lng)) {
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
              note: `좌표가 한국 범위 밖(${lat}, ${lng}) — TourAPI 원본 오류. 주소로 좌표를 고쳐야 한다`,
            })
            continue
          }

          if (!Number.isFinite(sigungu) || !leaf.has(`${areaCode}-${sigungu}`)) {
            // 2순위 — 주소에서 시군구명 찾기. 후보가 그 시/도의 것으로 좁혀져 있다.
            const addr = String(it.addr1 ?? '')
            const hit = (leavesOfArea.get(areaCode) ?? []).find((s) => addr.includes(s.name))
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
  for (const k of ['tour', 'addr', 'unresolved']) {
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
