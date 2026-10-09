#!/usr/bin/env node
/**
 * TourAPI 장소 수집 — 원본을 DB(tour 스키마)에 쌓는다. 파일을 쓰지 않는다.
 *
 * 목록(areaBasedList2)과 상세(detailCommon2 + detailIntro2)를 원본 그대로 tour.* 에
 * 넣는다. 지역 판정 · 분류 · places 반영은 load.mjs 가 한다 — 판정 로직을 고칠 때
 * API 를 다시 부르지 않으려면 원본이 그대로 남아 있어야 한다.
 * (테이블: supabase/DATA-MODEL.md 'tour.*' · 검토: intent/2026-10-09-서버-수집-검토/검토.md)
 *
 * 사용법:
 *   node collect.mjs                # 전국 — 목록 갱신 → 사라진 장소 → 목록 · 상세
 *   node collect.mjs --area 1       # 특정 시/도만 (areaCode) · 목록 갱신은 건너뜀
 *   node collect.mjs --skip-detail  # 목록만
 *   node collect.mjs --detail-only  # 이미 받은 목록으로 상세만
 *   node collect.mjs --status       # 진행 상황 · 최근 실행만 보기 (API 호출 없음)
 *   node collect.mjs --report-only  # 수집 리포트만 (API 호출 없음)
 *   node collect.mjs --sync-dry     # 목록 갱신 · 사라진 장소 확인만 미리보기 — DB 를 바꾸지 않는다
 *   node collect.mjs --no-sync      # 목록 갱신 · 사라진 장소 확인을 건너뛴다
 *
 * 목록 갱신(syncLists): 매 실행 첫머리에 전국 목록을 수정일 순으로 받아, 마지막
 * 확인 이후 새로 생기거나 고쳐진 장소만 tour.list_items 에 반영한다. 그러면 상세
 * 단계가 mt 를 비교해 그 장소들의 상세만 다시 받는다.
 *
 * 사라진 장소 확인(syncHidden): 이어서 동기화 목록을 날짜별로 받아 표출 중단된 장소의
 * list_items.hidden_at 을 채운다(행은 지우지 않는다). load.mjs 가 그 장소를 숨긴다.
 *
 * 개발계정 일일 한도(약 2,000회)에 걸려 멈추면 다음 실행이 그 자리에서 이어서 받는다 —
 * 목록은 시군구 × 타입 단위(tour.list_fetches), 상세는 장소 단위로 바로 저장한다.
 * 실행마다 tour.runs 에 한 줄을 남긴다(시작 · 끝 · 호출 수 · 결과 · 오류).
 *
 * 비밀값: API 키는 환경 변수 TOUR_API_KEY → 이 폴더의 .key → 대화형 입력 순으로,
 * DB 접속 주소는 db.mjs 가 TOUR_DB_URL → .db-url 순으로 찾는다. 둘 다 커밋하지 않는다.
 */

import { readFile, access } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import os from 'node:os'
import path from 'node:path'
import { connect } from './db.mjs'

const BASE = 'https://apis.data.go.kr/B551011/KorService2'

/** 한 응답에 받는 건수. 기본값이 10이라 지정하지 않으면 호출이 10배로 늘어난다. */
const NUM_OF_ROWS = 100
/** 호출 사이 지연(ms) */
const DELAY_MS = 150
const MAX_RETRY = 5

/**
 * TourAPI 콘텐츠 타입 8개를 모두 받는다. 앱에 넣을지는 load.mjs 가 정한다.
 * group 은 받는 순서 — 하루 한도 안에서 앱에 보이는 타입이 먼저 끝나도록
 * 1 → 2 → 3 차례로 목록 · 상세를 받는다.
 *   1 지금 앱의 타입 · 2 명소에 더할 타입(기타) · 3 데이터만 받아 두는 타입
 */
const CONTENT_TYPES = [
  { id: 39, label: '음식점', group: 1 },
  { id: 12, label: '관광지', group: 1 },
  { id: 14, label: '문화시설', group: 1 },
  { id: 28, label: '레포츠', group: 2 },
  { id: 38, label: '쇼핑', group: 2 },
  { id: 32, label: '숙박', group: 2 },
  { id: 15, label: '축제공연행사', group: 3 },
  { id: 25, label: '여행코스', group: 3 },
]
const TYPE_LABEL = new Map(CONTENT_TYPES.map((t) => [t.id, t.label]))

let apiKey = ''
let calls = 0
/** @type {import('pg').Client} */
let db

/* ───────────────────────────── 유틸 ───────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

const KEY_FILE = path.join(import.meta.dirname, '.key')

/**
 * 키를 구한다. 환경 변수 TOUR_API_KEY(서버 — Secrets) → `.key` → 대화형 입력.
 * `.key` 는 빈 줄과 `#` 주석을 건너뛰고 첫 줄을 쓴다.
 */
async function loadKey() {
  if (process.env.TOUR_API_KEY) {
    console.log('키: 환경 변수 TOUR_API_KEY 에서 읽었습니다.')
    return process.env.TOUR_API_KEY.trim()
  }
  if (await exists(KEY_FILE)) {
    const line = (await readFile(KEY_FILE, 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'))
    if (line) {
      console.log('키: .key 에서 읽었습니다.')
      return line
    }
    console.log('.key 가 비어 있습니다 — 직접 입력받습니다.')
  }
  return promptKey()
}

/** 키를 가리고 입력받는다. */
function promptKey() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    process.stdout.write('공공데이터포털 서비스 키: ')
    const onData = (ch) => {
      // 입력 에코를 지운다 (개행은 그대로 흘려보낸다)
      if (ch.toString() !== '\n' && ch.toString() !== '\r' && ch.toString() !== '\r\n') {
        process.stdout.clearLine?.(0)
        process.stdout.cursorTo?.(0)
        process.stdout.write('공공데이터포털 서비스 키: ' + '*'.repeat(rl.line.length))
      }
    }
    process.stdin.on('data', onData)
    rl.question('', (answer) => {
      process.stdin.off('data', onData)
      process.stdout.write('\n')
      rl.close()
      resolve(answer.trim())
    })
  })
}

/**
 * 요청 URL 조립.
 *
 * 공공데이터포털은 키를 Encoding / Decoding 두 가지로 내려준다. Encoding 키(%2B 등이
 * 섞인 것)를 URLSearchParams 에 넣으면 이중 인코딩돼 SERVICE_KEY_IS_NOT_REGISTERED_ERROR
 * 가 난다 — 가장 흔한 첫 실패 원인이라 여기서 갈라 처리한다.
 */
function buildUrl(op, params) {
  const qs = new URLSearchParams({
    MobileOS: 'ETC',
    MobileApp: 'onedaytrip-collect',
    _type: 'json',
    ...params,
  })
  const keyPart = apiKey.includes('%')
    ? `serviceKey=${apiKey}` // 이미 인코딩된 키 — 그대로 붙인다
    : `serviceKey=${encodeURIComponent(apiKey)}`
  return `${BASE}/${op}?${keyPart}&${qs.toString()}`
}

/** 한 번 호출. 429·5xx 는 지수 백오프로 물러난다. */
async function call(op, params) {
  const url = buildUrl(op, params)
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    if (attempt > 0) {
      const wait = 1000 * 2 ** (attempt - 1)
      console.log(`      ↻ ${wait}ms 후 재시도 (${attempt}/${MAX_RETRY})`)
      await sleep(wait)
    }
    calls++
    let res
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    } catch (e) {
      console.log(`      ! 네트워크 오류: ${e.message}`)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      console.log(`      ! HTTP ${res.status}`)
      continue
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)

    // 한도 초과·키 오류는 JSON 이 아니라 XML 로 오는 경우가 있다
    if (!text.trimStart().startsWith('{')) {
      throw new Error(`JSON 이 아닌 응답 (키 오류 또는 일일 한도 초과일 수 있음):\n${text.slice(0, 500)}`)
    }
    const json = JSON.parse(text)
    const code = json?.response?.header?.resultCode
    if (code !== '0000') {
      const msg = json?.response?.header?.resultMsg ?? JSON.stringify(json).slice(0, 300)
      // 결과 없음은 정상 — 빈 목록으로 다룬다
      if (code === '0003') return { items: [], totalCount: 0 }
      throw new Error(`resultCode ${code}: ${msg}`)
    }
    const body = json?.response?.body ?? {}
    const raw = body.items
    // 결과가 없으면 items 가 빈 문자열로 온다
    const items = raw === '' || raw == null ? [] : [].concat(raw.item ?? [])
    return { items, totalCount: Number(body.totalCount ?? items.length) }
  }
  throw new Error(`${op} 재시도 ${MAX_RETRY}회 모두 실패`)
}

/** 페이지를 끝까지 돌며 모은다. */
async function callAll(op, params) {
  const all = []
  let pageNo = 1
  for (;;) {
    const { items, totalCount } = await call(op, { ...params, numOfRows: NUM_OF_ROWS, pageNo })
    all.push(...items)
    if (all.length >= totalCount || items.length === 0) return { items: all, totalCount }
    pageNo++
    await sleep(DELAY_MS)
  }
}

/* ───────────────────────────── DB 도우미 ───────────────────────────── */

const q = async (sql, params) => (await db.query(sql, params)).rows

/** 한 트랜잭션 안에서 fn 을 돌린다 */
async function tx(fn) {
  await db.query('begin')
  try {
    const r = await fn()
    await db.query('commit')
    return r
  } catch (e) {
    await db.query('rollback').catch(() => {})
    throw e
  }
}

async function getState(key) {
  const [r] = await q('select value from tour.sync_state where key = $1', [key])
  return r ? r.value : null
}

async function setState(key, value) {
  await q(
    `insert into tour.sync_state (key, value) values ($1, $2::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  )
}

/** 목록 항목 한 줄을 넣거나 고친다 — 목록에 나왔다는 건 표출 중이라는 뜻이라 숨김을 푼다 */
async function upsertItem(it, area, sigungu, type) {
  await q(
    `insert into tour.list_items (contentid, content_type, area_code, sigungu_code, modified, item)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (contentid) do update set
       content_type = excluded.content_type, area_code = excluded.area_code,
       sigungu_code = excluded.sigungu_code, modified = excluded.modified, item = excluded.item,
       hidden_at = null, hidden_mt = null, updated_at = now()`,
    [String(it.contentid), type, area, sigungu, it.modifiedtime ?? null, JSON.stringify(it)],
  )
}

/** 지금 받아 둔 목록 단위 (a-s-t) 집합 */
async function fetchedKeys() {
  const rows = await q('select area_code, sigungu_code, content_type from tour.list_fetches')
  return new Set(rows.map((r) => `${r.area_code}-${r.sigungu_code}-${r.content_type}`))
}

/** 가장 먼저 받은 목록의 시각 — 상태가 비었을 때 기준으로 쓴다 */
async function firstFetchAt() {
  const [r] = await q('select min(fetched_at) as t from tour.list_fetches')
  return r?.t ? new Date(r.t) : null
}

/* ───────────────────────────── 수집 ───────────────────────────── */

/** 코드표 하나 — 있으면 DB 에서, 없으면 받아서 넣는다 */
async function codeTable(name, params, label) {
  const [r] = await q('select data from tour.code_tables where name = $1', [name])
  if (r) return r.data
  const { items } = await callAll('areaCode2', params)
  await q(
    `insert into tour.code_tables (name, data) values ($1, $2::jsonb)
     on conflict (name) do update set data = excluded.data, fetched_at = now()`,
    [name, JSON.stringify(items)],
  )
  console.log(`  ${label}: ${items.length}개 받음`)
  await sleep(DELAY_MS)
  return items
}

/** 시/도 코드표. 하드코딩하지 않는다 — 관광공사가 코드를 이관한 사례가 있다. */
const collectAreaCodes = () => codeTable('area-codes', {}, '시/도 코드표')

/** 시군구 코드표. sigunguCode 는 areaCode 안에서만 유일하므로 항상 쌍으로 다룬다. */
const collectSigungu = (areaCode, areaName) =>
  codeTable(`sigungu-${areaCode}`, { areaCode }, `${areaName}(${areaCode}) 시군구`)

/** 시군구 × 콘텐츠타입 하나 = 목록 단위 하나. 이게 재개 단위다. */
async function collectPlaces(areaCode, sigunguCode, type, label, done) {
  const key = `${areaCode}-${sigunguCode}-${type.id}`
  if (done.has(key)) return null
  // sigunguCode '0' 은 "이 시/도에는 시군구 구분이 없다"는 우리 쪽 표시이므로
  // 파라미터로는 보내지 않는다 (보내면 TourAPI 가 빈 결과를 준다)
  const params = { areaCode, contentTypeId: type.id, arrange: 'Q' }
  if (String(sigunguCode) !== '0') params.sigunguCode = sigunguCode
  const { items } = await callAll('areaBasedList2', params)
  await tx(async () => {
    await q(
      `insert into tour.list_fetches (area_code, sigungu_code, content_type) values ($1, $2, $3)
       on conflict (area_code, sigungu_code, content_type) do update set fetched_at = now()`,
      [Number(areaCode), Number(sigunguCode), type.id],
    )
    for (const it of items) {
      if (it.contentid) await upsertItem(it, Number(areaCode), Number(sigunguCode), type.id)
    }
  })
  done.add(key)
  console.log(`    ${label} / ${type.label}: ${items.length}건`)
  await sleep(DELAY_MS)
  return items
}

/**
 * 상세 수집. 목록 단위(시군구 × 콘텐츠타입)마다, 상세가 없거나 그때의 목록 수정일(mt)이
 * 지금 목록 수정일과 다른 장소만 받는다. 한 곳을 받을 때마다 저장하므로 어느 지점에서
 * 죽어도 그때까지 받은 건 남는다. 숨긴 장소는 받지 않는다.
 */
async function collectDetail(areaCode, sigunguCode, type, label, stats) {
  const todo = await q(
    `select li.contentid, li.modified, d.contentid is null as fresh
       from tour.list_items li
       left join tour.details d using (contentid)
      where li.area_code = $1 and li.sigungu_code = $2 and li.content_type = $3
        and li.hidden_at is null
        and (d.contentid is null or d.mt is distinct from li.modified)
      order by li.modified desc nulls last, li.contentid`,
    [Number(areaCode), Number(sigunguCode), type.id],
  )
  if (todo.length === 0) return

  const fresh = todo.filter((r) => r.fresh).length
  const changed = todo.length - fresh
  console.log(`    ${label} / ${type.label}: 상세 ${todo.length}곳` + (changed ? ` (새 ${fresh} · 수정됨 ${changed})` : ''))
  for (const r of todo) {
    const [common] = (await call('detailCommon2', { contentId: r.contentid })).items
    await sleep(DELAY_MS)
    const [intro] = (await call('detailIntro2', { contentId: r.contentid, contentTypeId: type.id })).items
    await sleep(DELAY_MS)
    await q(
      `insert into tour.details (contentid, common, intro, mt) values ($1, $2::jsonb, $3::jsonb, $4)
       on conflict (contentid) do update set
         common = excluded.common, intro = excluded.intro, mt = excluded.mt, fetched_at = now()`,
      [r.contentid, JSON.stringify(common ?? null), JSON.stringify(intro ?? null), r.modified],
    )
    stats.details++
  }
}

/* ───────────────────────────── 목록 갱신 ───────────────────────────── */

/** 마지막 확인 시각에서 이만큼 더 거슬러 받는다 — 겹치는 건 같은 값을 다시 쓸 뿐이라 해가 없다 */
const SYNC_OVERLAP_MS = 24 * 60 * 60 * 1000
/** 한 콘텐츠타입에서 최대 이만큼 쪽을 넘긴다 — 정렬이 기대와 달라 끝없이 도는 것을 막는다 */
const SYNC_MAX_PAGES = 30

/** Date → TourAPI modifiedtime 형식(한국 시각 YYYYMMDDHHMMSS) */
function toKstStamp(d) {
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const p = (n, w = 2) => String(n).padStart(w, '0')
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}${p(k.getUTCHours())}${p(k.getUTCMinutes())}${p(k.getUTCSeconds())}`
}

/** TourAPI 수정일(한국 시각) → ISO. 없으면 null */
function stampToIso(mt) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(mt ?? ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00` : null
}

/**
 * 마지막 확인 이후 바뀐 장소를 tour.list_items 에 반영한다.
 *
 * 전국 목록을 콘텐츠타입별로 수정일 순(arrange Q)으로 받아, 기준 시각보다 오래된 장소가
 * 나오면 멈춘다. 처음이면 기준은 목록을 처음 받은 시각이다. 응답이 정말 수정일
 * 내림차순인지 확인해서, 아니면 아무것도 바꾸지 않는다.
 *
 * 반영 규칙
 *   · 시군구는 areacode · sigungucode 로, 비어 있으면 법정동 코드를 지금 목록에서 가장 많이
 *     짝지어진 시군구로 바꿔 찾는다. 그 목록 단위를 받은 적이 없으면, 이미 있는 장소는
 *     있던 자리에서 고치고 처음 보는 장소는 건너뛰고 센다
 *   · 목록을 아직 한 번도 받지 않은 타입은 건너뛴다 — 나중에 통째로 받을 때 최신으로 온다
 *   · 받은 타입의 바뀐 장소를 하나도 잇지 못하면 기준 시각을 앞당기지 않는다
 *
 * 사라진 장소는 syncHidden 이 다룬다.
 */
async function syncLists({ dry }) {
  const startedAt = new Date()
  const callsBefore = calls

  const done = await fetchedKeys()
  if (done.size === 0) {
    console.log('목록 갱신: 받은 목록이 아직 없어 건너뜀 (첫 수집이 먼저)')
    return null
  }
  const last = await getState('lastSyncStartedAt')
  const base = last ? new Date(last) : await firstFetchAt()
  const cutoff = toKstStamp(new Date(base.getTime() - SYNC_OVERLAP_MS))
  console.log(`목록 갱신${dry ? ' (미리보기 — DB 를 바꾸지 않음)' : ''}: ${cutoff.slice(0, 8)} ${cutoff.slice(8, 10)}:${cutoff.slice(10, 12)} 이후 수정된 장소`)

  const changed = []
  for (const type of CONTENT_TYPES) {
    let prev = '99999999999999'
    let got = 0
    let reachedOld = false
    for (let pageNo = 1; pageNo <= SYNC_MAX_PAGES; pageNo++) {
      const { items, totalCount } = await call('areaBasedList2', {
        contentTypeId: type.id,
        arrange: 'Q',
        numOfRows: NUM_OF_ROWS,
        pageNo,
      })
      await sleep(DELAY_MS)
      for (const it of items) {
        const mt = String(it.modifiedtime ?? '')
        if (mt > prev) {
          throw new Error(`${type.label} 목록이 수정일 내림차순이 아님 (${prev} 다음 ${mt}) — 갱신을 적용하지 않음`)
        }
        prev = mt
        if (mt < cutoff) {
          reachedOld = true
          break
        }
        if (it.contentid) changed.push({ type, it })
        got++
      }
      if (reachedOld || items.length === 0 || pageNo * NUM_OF_ROWS >= totalCount) break
      if (pageNo === SYNC_MAX_PAGES) {
        throw new Error(`${type.label}: ${SYNC_MAX_PAGES}쪽을 넘겨도 기준 시각에 닿지 않음 — 갱신을 적용하지 않음`)
      }
    }
    console.log(`    ${type.label}: 바뀐 장소 ${got}곳`)
  }

  // 법정동 코드 → 시군구 (지금 목록에서 가장 많이 짝지어진 쪽)
  const votes = await q(
    `select item->>'lDongRegnCd' as r, coalesce(item->>'lDongSignguCd', '') as s,
            area_code, sigungu_code, count(*)::int as n
       from tour.list_items
      where item->>'lDongRegnCd' is not null
      group by 1, 2, 3, 4
      order by n desc, area_code, sigungu_code`,
  )
  const lDong = new Map()
  for (const v of votes) {
    const k = `${v.r}-${v.s}`
    if (!lDong.has(k)) lDong.set(k, `${v.area_code}-${v.sigungu_code}`)
  }
  const areaKeyOf = (it) =>
    it.areacode ? `${Number(it.areacode)}-${Number(it.sigungucode) || 0}` : (lDong.get(`${it.lDongRegnCd ?? ''}-${it.lDongSignguCd ?? ''}`) ?? null)

  const collectedTypes = new Set([...done].map((k) => Number(k.split('-')[2])))
  const ids = changed.map((c) => String(c.it.contentid))
  const where = new Map(
    (await q('select contentid, area_code, sigungu_code, content_type from tour.list_items where contentid = any($1)', [ids])).map(
      (r) => [r.contentid, `${r.area_code}-${r.sigungu_code}-${r.content_type}`],
    ),
  )

  const stats = { updated: 0, moved: 0, added: 0, noFile: 0, notCollected: 0 }
  const plan = []
  const samples = []
  const misses = []
  for (const { type, it } of changed) {
    if (!collectedTypes.has(type.id)) {
      stats.notCollected++
      continue
    }
    const id = String(it.contentid)
    const from = where.get(id) ?? null
    const ak = areaKeyOf(it)
    let target = ak ? `${ak}-${type.id}` : null
    if (target && !done.has(target)) target = null
    if (!target) target = from // 시군구를 못 정하면 있던 자리에서 고친다
    if (!target) {
      stats.noFile++
      if (misses.length < 3) {
        misses.push(
          `${it.title} — areacode=${it.areacode ?? '없음'} sigungucode=${it.sigungucode ?? '없음'} ` +
            `lDong=${it.lDongRegnCd ?? '없음'}-${it.lDongSignguCd ?? '없음'}`,
        )
      }
      continue
    }
    if (!from) stats.added++
    else if (from === target) stats.updated++
    else stats.moved++
    plan.push({ it, target })
    where.set(id, target)
    if (samples.length < 8) samples.push(`${from ? (from === target ? '수정' : '이동') : '새로'} · ${it.title} (${it.modifiedtime})`)
  }
  console.log(
    `    반영: 수정 ${stats.updated} · 새로 ${stats.added} · 시군구 이동 ${stats.moved}` +
      (stats.noFile ? ` · 시군구를 못 정함 ${stats.noFile}(건너뜀)` : '') +
      (stats.notCollected ? ` · 목록을 아직 안 받은 타입 ${stats.notCollected}(나중에 통째로 받음)` : '') +
      ` — 호출 ${calls - callsBefore}회`,
  )
  for (const x of samples) console.log(`      ${x}`)
  for (const x of misses) console.log(`      ? ${x}`)

  const applicable = changed.length - stats.notCollected
  const allMissed = applicable > 0 && stats.noFile === applicable
  if (allMissed) console.log('    ✗ 바뀐 장소를 하나도 잇지 못함 — 기준 시각을 그대로 둠(다음 실행이 다시 받음)')

  if (dry) return stats
  await tx(async () => {
    for (const { it, target } of plan) {
      const [a, s, t] = target.split('-').map(Number)
      await upsertItem(it, a, s, t)
    }
    if (!allMissed) {
      await setState('lastSyncStartedAt', startedAt.toISOString())
      await setState('lastSyncResult', stats)
    }
  })
  return stats
}

/* ───────────────────────────── 사라진 장소 ───────────────────────────── */

/** 한 날짜에서 최대 이만큼 쪽을 넘긴다 — 하루 수정이 수천 건이면 날짜 인자가 안 먹은 것이다 */
const HIDDEN_MAX_PAGES = 30

/** YYYYMMDD 에 하루를 더하거나 뺀다 */
function shiftDay(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days))
  return d.toISOString().slice(0, 10).replaceAll('-', '')
}

/**
 * TourAPI 에서 표출 중단(showflag 0)된 장소의 tour.list_items.hidden_at 을 채운다.
 * load.mjs 가 그 장소의 places.hidden_at 을 채운다 — 어디서도 행을 지우지 않는다.
 *
 * 표출 중단된 장소는 일반 목록에 나오지 않아 목록 갱신으로는 모른다. 동기화 목록
 * (areaBasedSyncList2)은 표출 여부(showflag)와 함께 나오므로 날짜(modifiedtime YYYYMMDD)
 * 마다 받아 본다. 같은 장소가 여러 날짜에 나오면 수정일이 가장 늦은 기록만 본다.
 *
 * 반영 규칙
 *   · 표출 중단 + 우리 목록에 있음 → hidden_at · hidden_mt 를 채운다 (상세는 남김)
 *   · 표출 중단 + 우리 목록에 없음 → 받은 적 없는 장소, 무시
 *   · 표출 중 + 숨겨 둔 장소 → 되살림 (새 기록으로 덮어 수정일이 바뀌게 — 상세를 다시 받는다)
 *
 * 안전장치 — 하나라도 걸리면 아무것도 바꾸지 않는다
 *   · 응답 장소의 수정일이 요청한 날짜가 아님 → 날짜 인자가 듣지 않는 것
 *   · 응답에 showflag 칸이 하나도 없음 → 무엇을 숨길지 알 수 없음
 */
async function syncHidden({ dry }) {
  const callsBefore = calls
  const first = await firstFetchAt()
  if (!first) return null

  const today = toKstStamp(new Date()).slice(0, 8)
  const from = shiftDay((await getState('hiddenCheckedDate')) ?? toKstStamp(first).slice(0, 8), -1)
  const dates = []
  for (let d = from; d <= today; d = shiftDay(d, 1)) dates.push(d)
  console.log(`사라진 장소 확인${dry ? ' (미리보기)' : ''}: ${from} ~ ${today} (${dates.length}일)`)

  const latest = new Map()
  for (const date of dates) {
    for (let pageNo = 1; pageNo <= HIDDEN_MAX_PAGES; pageNo++) {
      const { items, totalCount } = await call('areaBasedSyncList2', { modifiedtime: date, numOfRows: NUM_OF_ROWS, pageNo })
      await sleep(DELAY_MS)
      for (const it of items) {
        const mt = String(it.modifiedtime ?? '')
        if (!mt.startsWith(date)) {
          throw new Error(`${date} 를 물었는데 수정일 ${mt} 인 장소가 옴 — 날짜 인자가 듣지 않음, 적용하지 않음`)
        }
        const id = String(it.contentid)
        const prev = latest.get(id)
        if (!prev || String(prev.modifiedtime) <= mt) latest.set(id, it)
      }
      if (items.length === 0 || pageNo * NUM_OF_ROWS >= totalCount) break
      if (pageNo === HIDDEN_MAX_PAGES) throw new Error(`${date}: ${HIDDEN_MAX_PAGES}쪽을 넘김 — 적용하지 않음`)
    }
  }

  const records = [...latest.values()]
  const flagged = records.filter((it) => it.showflag !== undefined && it.showflag !== null && it.showflag !== '')
  if (records.length > 0 && flagged.length === 0) throw new Error(`기록 ${records.length}건에 showflag 칸이 없음 — 적용하지 않음`)

  const mine = new Map(
    (
      await q('select contentid, hidden_at is not null as hidden, item from tour.list_items where contentid = any($1)', [
        flagged.map((it) => String(it.contentid)),
      ])
    ).map((r) => [r.contentid, r]),
  )
  const stats = { records: records.length, off: 0, hidden: 0, unknown: 0, restored: 0 }
  const hide = []
  const restore = []
  const samples = []
  for (const it of flagged) {
    const id = String(it.contentid)
    const row = mine.get(id)
    if (String(it.showflag) === '0') {
      stats.off++
      if (!row) {
        stats.unknown++
        continue
      }
      if (row.hidden) continue
      hide.push({ id, mt: it.modifiedtime ?? null })
      stats.hidden++
      if (samples.length < 8) samples.push(`숨김 · ${row.item?.title ?? id} (${it.modifiedtime})`)
    } else if (row?.hidden) {
      restore.push({ id, item: { ...(row.item ?? {}), ...it } })
      stats.restored++
      if (samples.length < 8) samples.push(`되살림 · ${row.item?.title ?? id} (${it.modifiedtime})`)
    }
  }
  const [{ n: nowHidden }] = await q('select count(*)::int as n from tour.list_items where hidden_at is not null')
  console.log(
    `    바뀐 기록 ${stats.records} · 표출 중단 ${stats.off} → 숨김 ${stats.hidden}` +
      (stats.unknown ? ` (받은 적 없는 장소 ${stats.unknown})` : '') +
      ` · 되살림 ${stats.restored} · 숨긴 장소 ${nowHidden + stats.hidden - stats.restored}` +
      ` — 호출 ${calls - callsBefore}회`,
  )
  for (const x of samples) console.log(`      ${x}`)

  if (dry) return stats
  await tx(async () => {
    for (const h of hide) {
      await q(
        `update tour.list_items set hidden_at = coalesce($2::timestamptz, now()), hidden_mt = $3, updated_at = now()
          where contentid = $1`,
        [h.id, stampToIso(h.mt), h.mt],
      )
    }
    for (const r of restore) {
      await q(
        `update tour.list_items set hidden_at = null, hidden_mt = null, item = $2::jsonb,
                modified = $3, updated_at = now()
          where contentid = $1`,
        [r.id, JSON.stringify(r.item), r.item.modifiedtime ?? null],
      )
    }
    await setState('hiddenCheckedDate', today)
    await setState('hiddenLastResult', stats)
  })
  return stats
}

/* ───────────────────────────── 진행 · 리포트 ───────────────────────────── */

/** 타입별 진행 — 목록 단위 · 장소 · 상세 */
async function progressRows() {
  return q(
    `select li.content_type as t,
            count(*) filter (where li.hidden_at is null)::int as items,
            count(*) filter (where li.hidden_at is not null)::int as hidden,
            count(d.contentid) filter (where li.hidden_at is null)::int as details,
            count(d.contentid) filter (where li.hidden_at is null and d.mt is distinct from li.modified)::int as stale
       from tour.list_items li
       left join tour.details d using (contentid)
      group by 1 order by 1`,
  )
}

async function printProgress() {
  const rows = new Map((await progressRows()).map((r) => [r.t, r]))
  const unitsOf = new Map(
    (await q('select content_type as t, count(*)::int as n from tour.list_fetches group by 1')).map((r) => [r.t, r.n]),
  )
  const units = [...unitsOf.values()].reduce((a, b) => a + b, 0)
  const [{ n: areas }] = await q("select count(*)::int as n from tour.code_tables where name like 'sigungu-%'")
  console.log(`목록 단위 ${units}개 (시/도 코드표 ${areas}개)`)
  let todo = 0
  for (const t of CONTENT_TYPES) {
    const r = rows.get(t.id)
    if (!r) {
      console.log(`  ${t.label}(${t.id}): ${unitsOf.get(t.id) ? `목록 단위 ${unitsOf.get(t.id)} · 장소 0` : '목록 아직'}`)
      continue
    }
    const left = r.items - r.details + r.stale
    todo += left
    const pct = r.items ? ((r.details / r.items) * 100).toFixed(1) : '0.0'
    console.log(
      `  ${t.label}(${t.id}): 장소 ${r.items}` + (r.hidden ? ` (+숨김 ${r.hidden})` : '') +
        ` · 상세 ${r.details} (${pct}%)` + (left ? ` · 남음 ${left}` : ''),
    )
  }
  console.log(`남은 상세 ${todo}곳 = ${todo * 2}호출 (아직 목록을 안 받은 시군구 · 타입은 제외)`)
  return todo
}

async function printRuns(limit = 5) {
  const runs = await q(
    `select id, host, started_at, finished_at, calls, error, result
       from tour.runs order by id desc limit $1`,
    [limit],
  )
  console.log('최근 실행:')
  for (const r of runs) {
    const t = new Date(r.started_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
    const state = r.error ? `✗ ${r.error.split('\n')[0].slice(0, 80)}` : r.finished_at ? '끝' : '진행 중 또는 끊김'
    console.log(`  #${r.id} ${t} · ${r.host ?? '-'} · 호출 ${r.calls} · ${state}`)
  }
}

/** detailIntro2 는 콘텐츠타입마다 필드 이름이 다르다 */
const HOURS_KEYS = ['opentimefood', 'usetime', 'usetimeculture', 'usetimeleports', 'opentime', 'checkintime']
const TEL_KEYS = ['infocenterfood', 'infocenter', 'infocenterculture', 'infocenterleports', 'infocentershopping', 'infocenterlodging']
const anyField = (col, keys) => '(' + keys.map((k) => `coalesce(trim(d.${col}->>'${k}'), '') <> ''`).join(' or ') + ')'

/** 수집 리포트 — 콘솔에 찍고 결과를 돌려준다(실행 기록에 남긴다) */
async function report() {
  const line = (s) => console.log(s)
  const [tot] = await q(
    `select count(*)::int as places,
            count(*) filter (where coalesce(item->>'areacode', '') = '')::int as no_area,
            count(*) filter (where coalesce(item->>'sigungucode', '') = '')::int as no_sigungu,
            count(*) filter (where coalesce(item->>'mapx', '') = '' or coalesce(item->>'mapy', '') = '')::int as no_coord
       from tour.list_items where hidden_at is null`,
  )
  const [det] = await q(
    `select count(*)::int as got,
            count(*) filter (where coalesce(trim(d.common->>'overview'), '') <> '')::int as overview,
            count(*) filter (where ${anyField('intro', HOURS_KEYS)})::int as hours,
            count(*) filter (where ${anyField('intro', TEL_KEYS)} or coalesce(trim(d.common->>'tel'), '') <> '')::int as tel
       from tour.details d join tour.list_items li using (contentid)
      where li.hidden_at is null`,
  )
  const perType = await progressRows()
  const pct = (n) => (det.got ? `${((n / det.got) * 100).toFixed(1)}%` : '-')

  line('')
  line('══════════════════ 수집 리포트 ══════════════════')
  line(`장소 ${tot.places}건 · 상세 ${det.got} (${tot.places ? ((det.got / tot.places) * 100).toFixed(1) : '0.0'}%) · 이번 실행 호출 ${calls}회`)
  line(`  소개 있음 ${det.overview} (${pct(det.overview)}) · 영업시간 있음 ${det.hours} (${pct(det.hours)}) · 전화 있음 ${det.tel} (${pct(det.tel)})`)
  line(`  판정에 쓸 값이 빈 항목: areacode ${tot.no_area} · sigungucode ${tot.no_sigungu} · 좌표 ${tot.no_coord}`)
  line('── 타입별 ──')
  for (const r of perType) line(`  ${TYPE_LABEL.get(r.t) ?? r.t}(${r.t}): 장소 ${r.items} · 상세 ${r.details}` + (r.hidden ? ` · 숨김 ${r.hidden}` : ''))
  line('═════════════════════════════════════════════════')
  return {
    places: tot.places,
    missing: { areacode: tot.no_area, sigungucode: tot.no_sigungu, coord: tot.no_coord },
    detail: det,
    perType,
  }
}

/* ───────────────────────────── 진입점 ───────────────────────────── */

async function main() {
  const args = process.argv.slice(2)
  const skipDetail = args.includes('--skip-detail')
  const detailOnly = args.includes('--detail-only')
  const areaFilter = args.includes('--area') ? args[args.indexOf('--area') + 1] : null

  db = await connect()

  if (args.includes('--status')) {
    await printProgress()
    await printRuns()
    return
  }
  if (args.includes('--report-only')) {
    await report()
    return
  }

  apiKey = await loadKey()
  if (!apiKey) {
    console.error('키가 비어 있습니다. TOUR_API_KEY 나 .key 에 넣거나 실행 시 입력하세요.')
    process.exitCode = 1
    return
  }

  const dry = args.includes('--sync-dry')
  const result = { sync: null, hidden: null, details: 0, syncError: null, hiddenError: null }
  const [run] = dry
    ? [null]
    : await q(`insert into tour.runs (host) values ($1) returning id`, [process.env.TOUR_HOST || os.hostname()])
  const finish = async (error) => {
    if (!run) return
    try {
      result.report = await report()
    } catch (e) {
      result.reportError = e.message
    }
    await q(`update tour.runs set finished_at = now(), calls = $2, result = $3::jsonb, error = $4 where id = $1`, [
      run.id,
      calls,
      JSON.stringify(result),
      error ?? null,
    ])
  }

  // 목록 갱신 · 사라진 장소 — 실패해도 상세 수집은 계속한다(오늘 몫의 상세를 잃지 않게)
  if (!args.includes('--no-sync') && !areaFilter) {
    try {
      result.sync = await syncLists({ dry })
    } catch (e) {
      result.syncError = e.message
      console.error(`    ✗ 목록 갱신 건너뜀: ${e.message}`)
    }
    try {
      result.hidden = await syncHidden({ dry })
    } catch (e) {
      result.hiddenError = e.message
      console.error(`    ✗ 사라진 장소 확인 건너뜀: ${e.message}`)
    }
    console.log('')
    if (dry) return
  }

  try {
    console.log('코드표 확인...')
    const areas = await collectAreaCodes()
    const targets = areaFilter ? areas.filter((a) => String(a.code) === areaFilter) : areas
    if (!targets.length) throw new Error(`areaCode ${areaFilter} 를 코드표에서 찾지 못했습니다.`)

    const leaves = []
    for (const a of targets) {
      const sigungus = await collectSigungu(a.code, a.name)
      for (const s of sigungus) {
        leaves.push({ areaCode: a.code, areaName: a.name, sigunguCode: s.code, sigunguName: s.name })
      }
      // 시군구가 없는 시/도(세종 등)도 장소는 있을 수 있어 시/도 단위로 한 번 받는다
      if (sigungus.length === 0) {
        leaves.push({ areaCode: a.code, areaName: a.name, sigunguCode: '0', sigunguName: '(시군구 없음)' })
      }
    }

    const done = await fetchedKeys()
    // 타입 묶음(group)마다 목록 → 상세를 끝내고 다음 묶음으로 — 한도에 걸리면 앞 묶음부터 채워진다
    for (const group of [...new Set(CONTENT_TYPES.map((t) => t.group))]) {
      const types = CONTENT_TYPES.filter((t) => t.group === group)
      const names = types.map((t) => t.label).join(' · ')

      if (!detailOnly) {
        let fetched = 0
        for (const leaf of leaves) {
          for (const type of types) {
            const label = `${leaf.areaName} ${leaf.sigunguName}`
            const got = await collectPlaces(leaf.areaCode, leaf.sigunguCode, type, label, done).catch((e) => {
              throw new Error(`${label} / ${type.label} 목록: ${e.message}`)
            })
            if (got) fetched++
          }
        }
        console.log(`[${group}] 목록 — ${names}: ${fetched ? `새로 받은 목록 단위 ${fetched}개` : '모두 받아 둠'}`)
      }

      if (!skipDetail) {
        console.log(`[${group}] 상세 — ${names} · 장소당 2회 호출`)
        const stats = { details: 0 }
        for (const leaf of leaves) {
          for (const type of types) {
            const label = `${leaf.areaName} ${leaf.sigunguName}`
            await collectDetail(leaf.areaCode, leaf.sigunguCode, type, label, stats).catch((e) => {
              result.details += stats.details
              stats.details = 0
              throw new Error(`${label} / ${type.label} 상세: ${e.message}`)
            })
          }
        }
        result.details += stats.details
        console.log(`[${group}] 상세 완료 — 이번에 ${stats.details}곳`)
      }
    }
  } catch (e) {
    console.log('')
    console.error(`✗ ${e.message}`)
    console.error('중단합니다. 받은 것은 DB 에 남아 있으니 다시 실행하면 이어서 받습니다.')
    console.error('(일일 호출 한도라면 다음 날 다시 실행하세요.)')
    await finish(e.message)
    await printProgress().catch(() => {})
    process.exitCode = 1
    return
  }

  await finish(null)
  console.log('')
  await printProgress()
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db?.end().catch(() => {}))
