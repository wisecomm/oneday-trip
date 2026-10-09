#!/usr/bin/env node
/**
 * TourAPI 장소 수집 배치 — 1회성.
 *
 * 목록(areaBasedList2)과 상세(detailCommon2 + detailIntro2)를 모두 받아 원본 그대로
 * 파일에 쌓는다. 좌표 역판정·구 확정·카테고리 매핑·DB 적재는 하지 않는다 — 판정
 * 로직을 나중에 고칠 때 API 를 다시 때리지 않으려면 원본이 그대로 남아 있어야 한다.
 *
 * 사용법:
 *   node collect.mjs                # 전국, 목록 + 상세
 *   node collect.mjs --area 1       # 특정 시/도만 (areaCode)
 *   node collect.mjs --skip-detail  # 목록만 (상세는 나중에)
 *   node collect.mjs --detail-only  # 이미 받은 목록으로 상세만
 *   node collect.mjs --report-only  # 이미 받은 파일로 리포트만 다시 출력
 *   node collect.mjs --backfill-mt  # 예전에 받은 상세에 modifiedtime 채우기 (호출 0회)
 *   node collect.mjs --sync-dry     # 목록 갱신 · 사라진 장소 확인만 미리보기 — 파일을 바꾸지 않는다
 *   node collect.mjs --no-sync      # 목록 갱신 · 사라진 장소 확인을 건너뛴다
 *
 * 목록 갱신(syncLists): 매 실행 첫머리에 전국 목록을 수정일 순으로 받아, 마지막
 * 확인 이후 새로 생기거나 고쳐진 장소만 시군구 목록 파일에 반영한다. 그러면 뒤의
 * 상세 단계가 mt 를 비교해 그 장소들의 상세만 다시 받는다. 목록 파일이 있으면
 * 건너뛰던 탓에 첫 수집 뒤 바뀐 장소를 알아채지 못하던 빈틈을 메운다.
 *
 * 사라진 장소 확인(syncHidden): 이어서 동기화 목록을 날짜별로 받아 표출 중단된 장소를
 * 목록 파일에서 빼고 raw/hidden.json 에 남긴다. load.mjs 가 그 장소를 숨긴다(hidden_at).
 *
 * 전국이면 호출이 6,700회쯤 된다. 개발계정 일일 한도(1,000건 수준)에 걸려 죽으면
 * 다음 날 그냥 다시 실행하면 이어서 받는다 — 장소 단위로 이미 받은 것을 건너뛴다.
 *
 * 키는 이 폴더의 `.key` 에서 읽는다. 없으면 실행할 때 입력받는다.
 * `.key` 는 .gitignore 에 있어 커밋되지 않는다 — 며칠에 걸쳐 여러 번 이어서
 * 실행해야 하므로, 매번 손으로 붙여 넣지 않아도 되게 해 둔다.
 *
 * 중단해도 안전하다. 시군구 × 콘텐츠타입 단위로 파일을 쓰고, 이미 있는 파일은
 * 건너뛴다. 공공데이터포털 일일 호출 한도에 걸리면 그냥 다시 실행하면 이어서 받는다.
 */

import { mkdir, readFile, writeFile, readdir, access, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'

const BASE = 'https://apis.data.go.kr/B551011/KorService2'
const OUT = path.join(import.meta.dirname, 'raw')

/** 한 응답에 받는 건수. 기본값이 10이라 지정하지 않으면 호출이 10배로 늘어난다. */
const NUM_OF_ROWS = 100
/** 호출 사이 지연(ms). 한 번 돌리고 끝나는 배치라 속도를 욕심낼 이유가 없다. */
const DELAY_MS = 150
const MAX_RETRY = 5

/**
 * 수집 대상 콘텐츠 타입.
 * 앱의 카테고리(밥집·카페·술집·명소)로 접는 일은 적재 단계에서 cat1/cat2/cat3 을 보고
 * 한다. 여기서 접어 버리면 분류 기준을 바꿀 때 다시 받아야 한다.
 */
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

let apiKey = ''
let calls = 0

/* ───────────────────────────── 유틸 ───────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

const KEY_FILE = path.join(import.meta.dirname, '.key')

/**
 * 키를 구한다. `.key` 우선, 없으면 대화형 입력.
 * `.key` 는 빈 줄과 `#` 주석을 건너뛰고 첫 줄을 쓴다.
 */
async function loadKey() {
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

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))
const writeJson = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n', 'utf8')

/* ───────────────────────────── 수집 ───────────────────────────── */

/** 시/도 코드표. 하드코딩하지 않는다 — 관광공사가 코드를 이관한 사례가 있다. */
async function collectAreaCodes() {
  const file = path.join(OUT, 'area-codes.json')
  if (await exists(file)) {
    console.log('시/도 코드표: 이미 있음 — 건너뜀')
    return readJson(file)
  }
  console.log('시/도 코드표 받는 중...')
  const { items } = await callAll('areaCode2', {})
  await writeJson(file, items)
  console.log(`  ${items.length}개`)
  return items
}

/** 시군구 코드표. sigunguCode 는 areaCode 안에서만 유일하므로 항상 쌍으로 다룬다. */
async function collectSigungu(areaCode, areaName) {
  const file = path.join(OUT, `sigungu-${areaCode}.json`)
  if (await exists(file)) return readJson(file)
  const { items } = await callAll('areaCode2', { areaCode })
  await writeJson(file, items)
  console.log(`  ${areaName}(${areaCode}): 시군구 ${items.length}개`)
  await sleep(DELAY_MS)
  return items
}

/** 시군구 × 콘텐츠타입 하나 = 파일 하나. 이게 재개 단위다. */
async function collectPlaces(areaCode, sigunguCode, type, label) {
  const file = path.join(OUT, `places-${areaCode}-${sigunguCode}-${type.id}.json`)
  if (await exists(file)) return null
  // sigunguCode '0' 은 "이 시/도에는 시군구 구분이 없다"는 우리 쪽 표시이므로
  // 파라미터로는 보내지 않는다 (보내면 TourAPI 가 빈 결과를 준다)
  const params = { areaCode, contentTypeId: type.id, arrange: 'Q' }
  if (sigunguCode !== '0') params.sigunguCode = sigunguCode
  const { items } = await callAll('areaBasedList2', params)
  await writeJson(file, items)
  console.log(`    ${label} / ${type.label}: ${items.length}건`)
  await sleep(DELAY_MS)
  return items
}

/**
 * 상세 수집. 파일 단위는 목록과 같게 두고(시군구 × 콘텐츠타입), 그 안에서
 * contentid 별로 기록한다. 한 곳을 받을 때마다 저장하므로 어느 지점에서 죽어도
 * 그때까지 받은 건 남는다 — 시군구당 200회를 다시 쓰는 일이 없다.
 *
 * 각 항목에 그때의 목록 `modifiedtime`(`mt`)을 같이 적어 둔다. 그래서 재수집은
 * **목록만 받아 mt 를 비교하고 바뀐 곳의 상세만 다시 받으면** 된다. 첫 수집에는
 * 전부 새 항목이라 동작이 같고, 2회차부터 호출이 한 자릿수 퍼센트로 줄어든다.
 */
async function collectDetail(areaCode, sigunguCode, type, label) {
  const listFile = path.join(OUT, `places-${areaCode}-${sigunguCode}-${type.id}.json`)
  if (!(await exists(listFile))) return
  const items = await readJson(listFile)
  if (items.length === 0) return

  const file = path.join(OUT, `detail-${areaCode}-${sigunguCode}-${type.id}.json`)
  const map = (await exists(file)) ? await readJson(file) : {}

  // mt 를 도입하기 전에 받아 둔 항목은 mt 가 없다. 그 상세는 지금 목록과 같은
  // 시점의 것이므로, 호출 없이 현재 mt 를 적어 넣으면 된다 — 다시 받을 이유가 없다.
  let backfilled = 0
  for (const it of items) {
    const e = map[it.contentid]
    if (e && e.mt === undefined) {
      e.mt = it.modifiedtime ?? null
      backfilled++
    }
  }
  if (backfilled) await writeJson(file, map)

  const todo = items.filter((it) => {
    if (!it.contentid) return false
    const e = map[it.contentid]
    if (!e) return true // 새 장소
    return e.mt !== (it.modifiedtime ?? null) // 수정된 장소
  })
  if (todo.length === 0) return

  const fresh = todo.filter((it) => !map[it.contentid]).length
  const changed = todo.length - fresh
  console.log(
    `    ${label} / ${type.label}: 상세 ${todo.length}곳` +
      (changed ? ` (새 ${fresh} · 수정됨 ${changed})` : '') +
      ` — 이미 ${Object.keys(map).length}곳`,
  )
  for (const it of todo) {
    const id = String(it.contentid)
    const [common] = (await call('detailCommon2', { contentId: id })).items
    await sleep(DELAY_MS)
    const [intro] = (await call('detailIntro2', { contentId: id, contentTypeId: type.id })).items
    await sleep(DELAY_MS)
    map[id] = { mt: it.modifiedtime ?? null, common: common ?? null, intro: intro ?? null }
    await writeJson(file, map) // 한 곳마다 저장 — 중단 손실을 0으로
  }
}

/* ───────────────────────────── 목록 갱신 ───────────────────────────── */

const SYNC_STATE = path.join(OUT, 'sync-state.json')
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

/**
 * 마지막 확인 이후 바뀐 장소를 시군구 목록 파일에 반영한다.
 *
 * 전국 목록을 콘텐츠타입별로 수정일 순(arrange Q — 시군구 목록을 받을 때와 같은 정렬)
 * 으로 받아, 기준 시각보다 오래된 장소가 나오면 멈춘다. 처음 실행이면 기준은 목록
 * 파일들을 처음 받은 시각이다. 응답이 정말 수정일 내림차순인지 확인해서, 아니면
 * 아무것도 바꾸지 않는다 — 정렬을 믿을 수 없으면 '여기서 멈춰도 된다'는 판단이 틀린다.
 *
 * 반영 규칙
 *   · 같은 시군구 파일에 있으면 그 항목을 새 값으로 바꾼다
 *   · 다른 파일에 있으면(시군구가 바뀐 경우) 옛 파일에서 빼고 새 파일에 넣는다
 *   · 처음 보는 장소면 그 시군구 파일에 더한다
 *   · 시군구는 areacode · sigungucode 로, 비어 있으면 법정동 코드로 찾는다. 그래도 못
 *     찾으면 이미 있는 장소는 원래 파일에서 고치고, 처음 보는 장소는 건너뛰고 센다
 *   · 목록을 아직 한 번도 받지 않은 타입은 건너뛴다 — 나중에 통째로 받을 때 최신으로 온다
 *   · 받은 타입의 바뀐 장소를 하나도 잇지 못하면 기준 시각을 앞당기지 않는다
 *
 * 사라진 장소는 여기서 다루지 않는다 — 목록에 안 나오는 것과 지워진 것을 구별할 수 없다.
 */
async function syncLists({ dry }) {
  const startedAt = new Date()
  const callsBefore = calls
  let state = (await exists(SYNC_STATE)) ? await readJson(SYNC_STATE) : null

  // 지금 있는 목록 파일 전부와 contentid → 파일 색인
  const files = (await readdir(OUT)).filter((f) => /^places-\d+-\d+-\d+\.json$/.test(f))
  if (files.length === 0) {
    console.log('목록 갱신: 목록 파일이 아직 없어 건너뜀 (첫 수집이 먼저)')
    return
  }
  const lists = new Map() // file → items
  const where = new Map() // contentid → file
  let oldest = Infinity
  for (const f of files) {
    const items = await readJson(path.join(OUT, f))
    lists.set(f, items)
    for (const it of items) where.set(String(it.contentid), f)
    oldest = Math.min(oldest, (await stat(path.join(OUT, f))).mtimeMs)
  }

  const base = state?.lastSyncStartedAt ? new Date(state.lastSyncStartedAt) : new Date(oldest)
  const cutoff = toKstStamp(new Date(base.getTime() - SYNC_OVERLAP_MS))
  console.log(`목록 갱신${dry ? ' (미리보기 — 파일을 바꾸지 않음)' : ''}: ${cutoff.slice(0, 8)} ${cutoff.slice(8, 10)}:${cutoff.slice(10, 12)} 이후 수정된 장소`)

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
          throw new Error(
            `${type.label} 목록이 수정일 내림차순이 아님 (${prev} 다음 ${mt}) — 갱신을 적용하지 않음`,
          )
        }
        prev = mt
        if (mt < cutoff) {
          reachedOld = true
          break
        }
        changed.push({ type, it })
        got++
      }
      if (reachedOld || items.length === 0 || pageNo * NUM_OF_ROWS >= totalCount) break
      if (pageNo === SYNC_MAX_PAGES) {
        throw new Error(`${type.label}: ${SYNC_MAX_PAGES}쪽을 넘겨도 기준 시각에 닿지 않음 — 갱신을 적용하지 않음`)
      }
    }
    console.log(`    ${type.label}: 바뀐 장소 ${got}곳`)
  }

  // 반영
  // 시군구 파일을 고르는 법: 목록 항목의 areacode · sigungucode 를 먼저 쓰고, 비어 있으면
  // 법정동 코드(lDongRegnCd · lDongSignguCd)를 지금 목록 파일들에서 가장 많이 짝지어진
  // 시군구로 바꿔 쓴다. 그래도 못 정하면 이미 있는 장소는 원래 파일에 그대로 고친다.
  const lDongVotes = new Map() // 'lDong시도-lDong시군구' → Map('area-sigungu' → 개수)
  for (const items of lists.values()) {
    for (const x of items) {
      if (!x.lDongRegnCd || !x.areacode) continue
      const k = `${x.lDongRegnCd}-${x.lDongSignguCd ?? ''}`
      const v = `${x.areacode}-${x.sigungucode || '0'}`
      const m = lDongVotes.get(k) ?? new Map()
      m.set(v, (m.get(v) ?? 0) + 1)
      lDongVotes.set(k, m)
    }
  }
  const areaKeyOf = (it) => {
    if (it.areacode) return `${it.areacode}-${it.sigungucode || '0'}`
    const m = lDongVotes.get(`${it.lDongRegnCd ?? ''}-${it.lDongSignguCd ?? ''}`)
    return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : null
  }
  const collectedTypes = new Set([...lists.keys()].map((f) => Number(f.split('-')[3].split('.')[0])))

  const touched = new Set()
  const stats = { updated: 0, moved: 0, added: 0, noFile: 0, notCollected: 0 }
  const samples = []
  const misses = []
  for (const { type, it } of changed) {
    // 아직 목록을 한 번도 받지 않은 타입은 나중에 목록을 통째로 받을 때 최신으로 온다
    if (!collectedTypes.has(type.id)) {
      stats.notCollected++
      continue
    }
    const id = String(it.contentid)
    const from = where.get(id)
    const key = areaKeyOf(it)
    let target = key ? `places-${key}-${type.id}.json` : null
    if (target && !lists.has(target)) target = null
    if (!target) target = from ?? null // 시군구를 못 정하면 있던 자리에서 고친다
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
    if (from && from !== target) {
      lists.set(from, lists.get(from).filter((x) => String(x.contentid) !== id))
      touched.add(from)
      stats.moved++
    }
    const arr = lists.get(target)
    const i = arr.findIndex((x) => String(x.contentid) === id)
    if (i >= 0) {
      arr[i] = it
      if (from === target) stats.updated++
    } else {
      arr.push(it)
      if (!from) stats.added++
    }
    where.set(id, target)
    touched.add(target)
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

  // 받은 목록 타입의 바뀐 장소를 하나도 반영하지 못했다면 규칙이 어긋난 것이다 — 기준 시각을
  // 앞당기지 않아야 고친 뒤 다음 실행이 같은 장소들을 다시 받는다.
  const applicable = changed.length - stats.notCollected
  const allMissed = applicable > 0 && stats.noFile === applicable
  if (allMissed) {
    console.log('    ✗ 바뀐 장소를 하나도 시군구 파일에 잇지 못함 — 기준 시각을 그대로 둠(다음 실행이 다시 받음)')
  }

  if (dry) return
  for (const f of touched) await writeJson(path.join(OUT, f), lists.get(f))
  if (allMissed) return
  await writeJson(SYNC_STATE, {
    ...((await exists(SYNC_STATE)) ? await readJson(SYNC_STATE) : {}),
    lastSyncStartedAt: startedAt.toISOString(),
    lastSyncStamp: toKstStamp(startedAt),
    lastResult: stats,
  })
}

/* ───────────────────────────── 사라진 장소 ───────────────────────────── */

const HIDDEN_FILE = path.join(OUT, 'hidden.json')
/** 한 날짜에서 최대 이만큼 쪽을 넘긴다 — 하루 수정이 수천 건이면 날짜 인자가 안 먹은 것이다 */
const HIDDEN_MAX_PAGES = 30

/** YYYYMMDD 에 하루를 더하거나 뺀다 */
function shiftDay(ymd, days) {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days))
  return d.toISOString().slice(0, 10).replaceAll('-', '')
}

/**
 * TourAPI 에서 표출 중단(showflag 0)된 장소를 목록 파일에서 빼고 raw/hidden.json 에 남긴다.
 * load.mjs 가 그 장소의 hidden_at 을 채운다 — DB 행은 지우지 않는다 (README-플로챠트.md).
 *
 * 표출 중단된 장소는 일반 목록(areaBasedList2)에 나오지 않아 목록 갱신으로는 모른다.
 * 동기화 목록(areaBasedSyncList2)은 표출 여부(showflag)와 함께 나오므로 날짜(modifiedtime
 * YYYYMMDD)마다 받아 본다. 같은 장소가 여러 날짜에 나오면 수정일이 가장 늦은 기록만 본다.
 *
 * 반영 규칙
 *   · 표출 중단 + 우리 목록에 있음 → 목록 파일에서 빼고 hidden.json 에 기록(상세는 남김)
 *   · 표출 중단 + 우리 목록에 없음 → 받은 적 없는 장소, 무시
 *   · 표출 중 + hidden.json 에 있음 → 되살림(목록 파일에 새 기록으로 되돌리고 hidden 에서 뺌)
 *
 * 안전장치 — 하나라도 걸리면 아무것도 바꾸지 않는다
 *   · 응답 장소의 수정일이 요청한 날짜가 아님 → 날짜 인자가 듣지 않는 것
 *   · 응답에 showflag 칸이 하나도 없음 → 무엇을 숨길지 알 수 없음
 */
async function syncHidden({ dry }) {
  const callsBefore = calls
  const state = (await exists(SYNC_STATE)) ? await readJson(SYNC_STATE) : {}

  const files = (await readdir(OUT)).filter((f) => /^places-\d+-\d+-\d+\.json$/.test(f))
  if (files.length === 0) return
  const lists = new Map()
  const where = new Map()
  let oldest = Infinity
  for (const f of files) {
    const items = await readJson(path.join(OUT, f))
    lists.set(f, items)
    for (const it of items) where.set(String(it.contentid), f)
    oldest = Math.min(oldest, (await stat(path.join(OUT, f))).mtimeMs)
  }

  const today = toKstStamp(new Date()).slice(0, 8)
  const from = shiftDay(state.hiddenCheckedDate ?? toKstStamp(new Date(oldest)).slice(0, 8), -1)
  const dates = []
  for (let d = from; d <= today; d = shiftDay(d, 1)) dates.push(d)
  console.log(`사라진 장소 확인${dry ? ' (미리보기)' : ''}: ${from} ~ ${today} (${dates.length}일)`)

  const latest = new Map() // contentid → 가장 늦은 기록
  for (const date of dates) {
    for (let pageNo = 1; pageNo <= HIDDEN_MAX_PAGES; pageNo++) {
      const { items, totalCount } = await call('areaBasedSyncList2', {
        modifiedtime: date,
        numOfRows: NUM_OF_ROWS,
        pageNo,
      })
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
      if (pageNo === HIDDEN_MAX_PAGES) {
        throw new Error(`${date}: ${HIDDEN_MAX_PAGES}쪽을 넘김 — 적용하지 않음`)
      }
    }
  }

  const records = [...latest.values()]
  const flagged = records.filter((it) => it.showflag !== undefined && it.showflag !== null && it.showflag !== '')
  if (records.length > 0 && flagged.length === 0) {
    throw new Error(`기록 ${records.length}건에 showflag 칸이 없음 — 적용하지 않음`)
  }

  const hidden = (await exists(HIDDEN_FILE)) ? await readJson(HIDDEN_FILE) : {}
  const touched = new Set()
  const stats = { records: records.length, off: 0, hidden: 0, unknown: 0, restored: 0 }
  const samples = []
  for (const it of flagged) {
    const id = String(it.contentid)
    if (String(it.showflag) === '0') {
      stats.off++
      const f = where.get(id)
      if (!f) {
        if (!hidden[id]) stats.unknown++
        continue
      }
      const old = lists.get(f).find((x) => String(x.contentid) === id)
      lists.set(f, lists.get(f).filter((x) => String(x.contentid) !== id))
      where.delete(id)
      touched.add(f)
      hidden[id] = { mt: it.modifiedtime ?? null, title: old?.title ?? it.title ?? '', file: f, item: old ?? null }
      stats.hidden++
      if (samples.length < 8) samples.push(`숨김 · ${hidden[id].title} (${it.modifiedtime})`)
    } else if (hidden[id]) {
      const h = hidden[id]
      if (!where.has(id) && h.file && lists.has(h.file)) {
        // 새 기록을 덮어 수정일이 바뀌게 한다 — 상세 단계가 그 장소를 다시 받는다
        lists.get(h.file).push({ ...(h.item ?? {}), ...it })
        where.set(id, h.file)
        touched.add(h.file)
      }
      delete hidden[id]
      stats.restored++
      if (samples.length < 8) samples.push(`되살림 · ${h.title} (${it.modifiedtime})`)
    }
  }
  console.log(
    `    바뀐 기록 ${stats.records} · 표출 중단 ${stats.off} → 숨김 ${stats.hidden}` +
      (stats.unknown ? ` (받은 적 없는 장소 ${stats.unknown})` : '') +
      ` · 되살림 ${stats.restored} · 지금 숨긴 장소 ${Object.keys(hidden).length} — 호출 ${calls - callsBefore}회`,
  )
  for (const x of samples) console.log(`      ${x}`)

  if (dry) return
  for (const f of touched) await writeJson(path.join(OUT, f), lists.get(f))
  await writeJson(HIDDEN_FILE, hidden)
  await writeJson(SYNC_STATE, {
    ...((await exists(SYNC_STATE)) ? await readJson(SYNC_STATE) : {}),
    hiddenCheckedDate: today,
    hiddenLastResult: stats,
  })
}

/**
 * mt 도입 전에 받아 둔 상세에 목록의 modifiedtime 을 채워 넣는다. 네트워크를 쓰지
 * 않는다 — 이미 받은 상세는 지금 목록과 같은 시점의 것이므로 다시 받을 이유가 없다.
 */
async function backfillMt() {
  const files = await readdir(OUT)
  let touched = 0,
    filled = 0
  for (const lf of files.filter((f) => f.startsWith('places-'))) {
    const df = lf.replace('places-', 'detail-')
    if (!(await exists(path.join(OUT, df)))) continue
    const items = await readJson(path.join(OUT, lf))
    const map = await readJson(path.join(OUT, df))
    let dirty = false
    for (const it of items) {
      const e = map[it.contentid]
      if (e && e.mt === undefined) {
        e.mt = it.modifiedtime ?? null
        dirty = true
        filled++
      }
    }
    if (dirty) {
      await writeJson(path.join(OUT, df), map)
      touched++
    }
  }
  console.log(`mt 채움: ${filled}곳 (파일 ${touched}개). 호출 0회.`)
}

/** detailIntro2 는 콘텐츠타입마다 필드 이름이 다르다. 리포트에서만 쓰는 헬퍼다. */
function pickField(obj, ...keys) {
  if (!obj) return ''
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

/* ───────────────────────────── 리포트 ───────────────────────────── */

async function report() {
  const files = await readdir(OUT)
  const areas = (await exists(path.join(OUT, 'area-codes.json')))
    ? await readJson(path.join(OUT, 'area-codes.json'))
    : []
  const areaName = new Map(areas.map((a) => [String(a.code), a.name]))

  const sigunguName = new Map()
  for (const f of files.filter((f) => f.startsWith('sigungu-'))) {
    const areaCode = f.slice('sigungu-'.length, -'.json'.length)
    for (const s of await readJson(path.join(OUT, f))) {
      sigunguName.set(`${areaCode}-${s.code}`, s.name)
    }
  }

  const perLeaf = new Map() // "area-sigungu" → 건수
  const perType = new Map()
  let total = 0
  let missingArea = 0
  let missingSigungu = 0
  let missingCoord = 0
  const samplesMissing = []

  for (const f of files.filter((f) => f.startsWith('places-'))) {
    const [, areaCode, sigunguCode, typeId] = f.replace('.json', '').split('-')
    const items = await readJson(path.join(OUT, f))
    const key = `${areaCode}-${sigunguCode}`
    perLeaf.set(key, (perLeaf.get(key) ?? 0) + items.length)
    perType.set(typeId, (perType.get(typeId) ?? 0) + items.length)
    total += items.length
    for (const it of items) {
      const noArea = !it.areacode && !it.areaCode
      const noSigungu = !it.sigungucode && !it.sigunguCode
      const noCoord = !it.mapx || !it.mapy
      if (noArea) missingArea++
      if (noSigungu) missingSigungu++
      if (noCoord) missingCoord++
      if ((noArea || noSigungu || noCoord) && samplesMissing.length < 10) {
        samplesMissing.push({
          title: it.title,
          addr: it.addr1,
          areacode: it.areacode ?? null,
          sigungucode: it.sigungucode ?? null,
          mapx: it.mapx ?? null,
          mapy: it.mapy ?? null,
        })
      }
    }
  }

  // 상세 통계
  let detailGot = 0
  let hasMt = 0
  let hasOverview = 0
  let hasHours = 0
  let hasTel = 0
  for (const f of files.filter((f) => f.startsWith('detail-'))) {
    const map = await readJson(path.join(OUT, f))
    for (const v of Object.values(map)) {
      detailGot++
      if (v.mt !== undefined) hasMt++
      if (pickField(v.common, 'overview')) hasOverview++
      if (pickField(v.intro, 'opentimefood', 'usetime', 'usetimeculture', 'usetimeleports', 'opentime', 'checkintime')) hasHours++
      if (
        pickField(v.intro, 'infocenterfood', 'infocenter', 'infocenterculture', 'infocenterleports', 'infocentershopping', 'infocenterlodging') ||
        pickField(v.common, 'tel')
      )
        hasTel++
    }
  }

  const line = (s) => console.log(s)
  const pct = (n) => (detailGot ? `${((n / detailGot) * 100).toFixed(1)}%` : '-')
  line('')
  line('══════════════════ 수집 리포트 ══════════════════')
  line(`시/도 ${areas.length}개 · 시군구 ${sigunguName.size}개 · 장소 ${total}건`)
  line(`호출 수(이번 실행) ${calls}회`)
  line('')

  line('── 시/도 이름 원문 (표기 확인 · 광주·전남 통합 여부) ──')
  line(areas.map((a) => `${a.code}=${a.name}`).join('  '))
  line('')

  line('── 상세 수집 상황 ──')
  line(`  상세 받은 장소: ${detailGot} / ${total}${total ? ` (${((detailGot / total) * 100).toFixed(1)}%)` : ''}`)
  line(`  소개(overview) 있음:  ${hasOverview} (${pct(hasOverview)})`)
  line(`  영업시간 있음:        ${hasHours} (${pct(hasHours)})`)
  line(`  전화번호 있음:        ${hasTel} (${pct(hasTel)})`)
  line(`  수정시각(mt) 기록됨:  ${hasMt} (${pct(hasMt)}) — 재수집 증분 갱신의 근거`)
  line('  → 비어 있는 비율만큼 화면에서 그 영역을 숨겨야 합니다 (intent.md 8번)')
  line('')

  line('── 콘텐츠타입별 건수 ──')
  for (const t of CONTENT_TYPES) {
    line(`  ${t.label}(${t.id}): ${perType.get(String(t.id)) ?? 0}건`)
  }
  line('')

  line('── 판정에 쓸 값이 빈 항목 (미판정 예상 규모) ──')
  line(`  areacode 없음:    ${missingArea}건`)
  line(`  sigungucode 없음: ${missingSigungu}건`)
  line(`  좌표 없음:        ${missingCoord}건`)
  if (samplesMissing.length) {
    line('  예시:')
    for (const s of samplesMissing) {
      line(`    · ${s.title} | ${s.addr ?? '주소없음'} | area=${s.areacode} sigungu=${s.sigungucode} xy=${s.mapx},${s.mapy}`)
    }
  }
  line('')

  line('── 시군구별 장소 수 (구 단위로 플랜이 성립하는지) ──')
  const rows = [...perLeaf.entries()]
    .map(([k, n]) => {
      const [a, s] = k.split('-')
      const leafLabel = s === '0' ? '(시군구 없음)' : (sigunguName.get(k) ?? s)
      return { name: `${areaName.get(a) ?? a} ${leafLabel}`, n }
    })
    .sort((x, y) => y.n - x.n)
  const buckets = { '0': 0, '1-4': 0, '5-9': 0, '10-19': 0, '20+': 0 }
  for (const r of rows) {
    if (r.n === 0) buckets['0']++
    else if (r.n < 5) buckets['1-4']++
    else if (r.n < 10) buckets['5-9']++
    else if (r.n < 20) buckets['10-19']++
    else buckets['20+']++
  }
  for (const [k, v] of Object.entries(buckets)) line(`  ${k.padEnd(6)}곳: ${v}개 시군구`)
  line('')
  line('  상위 15개:')
  for (const r of rows.slice(0, 15)) line(`    ${r.name}: ${r.n}`)
  line('  하위 15개:')
  for (const r of rows.slice(-15)) line(`    ${r.name}: ${r.n}`)
  line('')
  line('═════════════════════════════════════════════════')

  await writeJson(path.join(OUT, 'report.json'), {
    generatedAt: new Date().toISOString(),
    totals: { areas: areas.length, sigungu: sigunguName.size, places: total },
    areaNames: areas.map((a) => ({ code: a.code, name: a.name })),
    perContentType: Object.fromEntries(perType),
    missing: { areacode: missingArea, sigungucode: missingSigungu, coord: missingCoord },
    detail: { collected: detailGot, withMt: hasMt, overview: hasOverview, hours: hasHours, tel: hasTel },
    missingSamples: samplesMissing,
    perLeaf: rows,
    buckets,
  })
  line('raw/report.json 에 저장했습니다.')
}

/* ───────────────────────────── 진입점 ───────────────────────────── */

async function main() {
  const args = process.argv.slice(2)
  const reportOnly = args.includes('--report-only')
  const skipDetail = args.includes('--skip-detail')
  const detailOnly = args.includes('--detail-only')
  const areaFilter = args.includes('--area') ? args[args.indexOf('--area') + 1] : null

  await mkdir(OUT, { recursive: true })

  if (args.includes('--backfill-mt')) {
    await backfillMt()
    await report()
    return
  }

  if (reportOnly) {
    await report()
    return
  }

  apiKey = await loadKey()
  if (!apiKey) {
    console.error('키가 비어 있습니다. .key 에 넣거나 실행 시 입력하세요.')
    process.exit(1)
  }

  // 목록 갱신 — 실패해도 상세 수집은 계속한다(오늘 몫의 상세를 잃지 않게)
  if (!args.includes('--no-sync') && !areaFilter) {
    try {
      await syncLists({ dry: args.includes('--sync-dry') })
    } catch (e) {
      console.error(`    ✗ 목록 갱신 건너뜀: ${e.message}`)
    }
    try {
      await syncHidden({ dry: args.includes('--sync-dry') })
    } catch (e) {
      console.error(`    ✗ 사라진 장소 확인 건너뜀: ${e.message}`)
    }
    console.log('')
    if (args.includes('--sync-dry')) return
  }

  const areas = await collectAreaCodes()
  const targets = areaFilter ? areas.filter((a) => String(a.code) === areaFilter) : areas
  if (!targets.length) {
    console.error(`areaCode ${areaFilter} 를 코드표에서 찾지 못했습니다.`)
    process.exit(1)
  }

  console.log('')
  console.log('시군구 코드표 받는 중...')
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

  const bail = async (what, e) => {
    console.log('')
    console.error(`    ✗ ${what}: ${e.message}`)
    console.error('')
    console.error('중단합니다. 받은 파일은 그대로 남아 있으니 다시 실행하면 이어서 받습니다.')
    console.error('(일일 호출 한도라면 다음 날 다시 실행하세요.)')
    console.error(`이번 실행 호출 수: ${calls}`)
    await report()
    process.exit(1)
  }

  // 타입 묶음(group)마다 목록 → 상세를 끝내고 다음 묶음으로 — 한도에 걸리면 앞 묶음부터 채워진다
  for (const group of [...new Set(CONTENT_TYPES.map((t) => t.group))]) {
    const types = CONTENT_TYPES.filter((t) => t.group === group)
    const names = types.map((t) => t.label).join(' · ')

    if (!detailOnly) {
      console.log('')
      console.log(`[${group}] 목록 받는 중 — ${names} · 시군구 ${leaves.length}개`)
      let done = 0
      for (const leaf of leaves) {
        const label = `${leaf.areaName} ${leaf.sigunguName}`
        for (const type of types) {
          try {
            const got = await collectPlaces(leaf.areaCode, leaf.sigunguCode, type, label)
            if (got === null) process.stdout.write(`\r    건너뜀: ${label} / ${type.label}          `)
          } catch (e) {
            await bail(`${label} / ${type.label} 목록`, e)
          }
        }
        done++
        if (done % 10 === 0) console.log(`  … ${done}/${leaves.length} 시군구`)
      }
      console.log('')
      console.log(`[${group}] 목록 완료.`)
    }

    if (!skipDetail) {
      console.log('')
      console.log(`[${group}] 상세 받는 중 — ${names} · 장소당 2회 호출`)
      let done = 0
      for (const leaf of leaves) {
        const label = `${leaf.areaName} ${leaf.sigunguName}`
        for (const type of types) {
          try {
            await collectDetail(leaf.areaCode, leaf.sigunguCode, type, label)
          } catch (e) {
            await bail(`${label} / ${type.label} 상세`, e)
          }
        }
        done++
        if (done % 10 === 0) console.log(`  … ${done}/${leaves.length} 시군구`)
      }
      console.log('')
      console.log(`[${group}] 상세 완료.`)
    }
  }

  await report()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
