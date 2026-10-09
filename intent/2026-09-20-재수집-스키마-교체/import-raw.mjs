#!/usr/bin/env node
/**
 * raw/ 파일을 DB 의 tour 스키마에 옮긴다 — 한 번 쓰는 이전 도구
 * (intent/2026-10-09-서버-수집-검토/검토.md 2단계).
 *
 *   node import-raw.mjs --dry      # 파일만 읽어 개수 · 중복 · 문제를 보고 (DB 접속 안 함)
 *   node import-raw.mjs            # 한 트랜잭션으로 적재 → 되읽어 파일과 대조
 *   node import-raw.mjs --verify   # 적재 없이 대조만
 *
 * 여러 번 돌려도 결과가 같다(upsert). 파일은 지우지 않는다 — 대조가 끝나고 수집이
 * DB 로 옮겨 간 뒤에도 한동안 보관한다.
 *
 * 옮기는 것
 *   area-codes.json · sigungu-N.json   → tour.code_tables
 *   places-시도-시군구-타입.json        → tour.list_fetches (파일 하나) + tour.list_items (항목 하나)
 *   hidden.json                         → tour.list_items (hidden_at 을 채운 행)
 *   detail-*.json                       → tour.details
 *   sync-state.json                     → tour.sync_state (최상위 키 하나에 한 행 · 값이 null 인 키는 뺌)
 * 옮기지 않는 것: logs/ · report.json · addr-mismatch.json (load.mjs 의 산출물)
 *
 * 파일 사이의 겹침은 이렇게 푼다
 *   · 같은 장소가 목록 파일 두 곳에 있으면 수정일이 늦은 쪽 (시군구 이동의 흔적)
 *   · 같은 장소의 상세가 두 곳에 있으면 mt 가 늦은 쪽
 *   · 목록에 없는 장소의 상세는 옮기지 않는다 (옛 시군구 파일에 남은 것)
 *   · hidden.json 과 목록에 다 있으면 목록 (load.mjs 와 같은 규칙 — 다시 표출된 것)
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const RAW = path.join(import.meta.dirname, 'raw')
const CHUNK = 1000

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const verifyOnly = args.includes('--verify')

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

/** 키를 정렬해 직렬화 — jsonb 는 키 순서를 바꾸므로 대조에 쓴다 */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

/** jsonb 에 넣을 수 없는 NUL 문자를 지우고 센다 */
let nulFixed = 0
function clean(v) {
  if (typeof v === 'string') {
    if (v.includes('\u0000')) {
      nulFixed++
      return v.replaceAll('\u0000', '')
    }
    return v
  }
  if (Array.isArray(v)) return v.map(clean)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]))
  return v
}

/** TourAPI 수정일(한국 시각 YYYYMMDDHHMMSS) → ISO. 없으면 null */
function stampToIso(mt) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(mt ?? ''))
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00` : null
}

const LIST_RE = /^places-(\d+)-(\d+)-(\d+)\.json$/
const DETAIL_RE = /^detail-(\d+)-(\d+)-(\d+)\.json$/

/* ───────────────────────────── 파일 읽기 ───────────────────────────── */

async function readRaw() {
  const names = (await readdir(RAW)).sort()
  const notes = { listDup: 0, detailDup: 0, detailOrphan: 0, hiddenInList: 0, hiddenNoItem: 0 }

  const codeTables = []
  for (const f of names.filter((n) => n === 'area-codes.json' || /^sigungu-\d+\.json$/.test(n))) {
    codeTables.push({
      name: f.replace(/\.json$/, ''),
      data: clean(await readJson(path.join(RAW, f))),
      fetched_at: (await stat(path.join(RAW, f))).mtime.toISOString(),
    })
  }

  const fetches = []
  const items = new Map() // contentid → 행
  for (const f of names.filter((n) => LIST_RE.test(n))) {
    const [, a, s, t] = LIST_RE.exec(f).map(Number)
    fetches.push({
      area_code: a,
      sigungu_code: s,
      content_type: t,
      fetched_at: (await stat(path.join(RAW, f))).mtime.toISOString(),
    })
    for (const it of await readJson(path.join(RAW, f))) {
      const id = String(it.contentid)
      const row = {
        contentid: id,
        content_type: t,
        area_code: a,
        sigungu_code: s,
        modified: it.modifiedtime ?? null,
        item: clean(it),
        hidden_at: null,
        hidden_mt: null,
      }
      const prev = items.get(id)
      if (prev) {
        notes.listDup++
        if (String(prev.modified ?? '') >= String(row.modified ?? '')) continue
      }
      items.set(id, row)
    }
  }

  if (names.includes('hidden.json')) {
    const hidden = await readJson(path.join(RAW, 'hidden.json'))
    for (const [id, h] of Object.entries(hidden)) {
      if (items.has(id)) {
        notes.hiddenInList++
        continue
      }
      const m = LIST_RE.exec(h.file ?? '')
      if (!m) {
        notes.hiddenNoItem++
        continue
      }
      const [, a, s, t] = m.map(Number)
      if (!fetches.some((x) => x.area_code === a && x.sigungu_code === s && x.content_type === t)) {
        notes.hiddenNoItem++
        continue
      }
      items.set(id, {
        contentid: id,
        content_type: t,
        area_code: a,
        sigungu_code: s,
        modified: h.item?.modifiedtime ?? null,
        item: clean(h.item ?? { contentid: id, title: h.title ?? '' }),
        hidden_at: stampToIso(h.mt) ?? new Date().toISOString(),
        hidden_mt: h.mt ?? null,
      })
    }
  }

  const details = new Map()
  for (const f of names.filter((n) => DETAIL_RE.test(n))) {
    const map = await readJson(path.join(RAW, f))
    for (const [id, d] of Object.entries(map)) {
      if (!items.has(id)) {
        notes.detailOrphan++
        continue
      }
      const row = { contentid: id, common: clean(d.common ?? null), intro: clean(d.intro ?? null), mt: d.mt ?? null }
      const prev = details.get(id)
      if (prev) {
        notes.detailDup++
        if (String(prev.mt ?? '') >= String(row.mt ?? '')) continue
      }
      details.set(id, row)
    }
  }

  const syncState = names.includes('sync-state.json')
    ? Object.entries(await readJson(path.join(RAW, 'sync-state.json')))
        // 값이 null 인 키는 '아직 없음'과 같다 — 행을 만들지 않는다(value 는 not null)
        .filter(([, value]) => value !== null)
        .map(([key, value]) => ({ key, value: clean(value) }))
    : []

  return { codeTables, fetches, items: [...items.values()], details: [...details.values()], syncState, notes }
}

/* ───────────────────────────── 적재 ───────────────────────────── */

/** rows 를 CHUNK 개씩 jsonb 배열 하나로 넘겨 upsert 한다 */
async function upsert(db, rows, sql) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.query(sql, [JSON.stringify(rows.slice(i, i + CHUNK))])
  }
}

async function load(db, raw) {
  await db.query('begin')
  try {
    await upsert(
      db,
      raw.codeTables,
      `insert into tour.code_tables (name, data, fetched_at)
       select * from jsonb_to_recordset($1::jsonb) as x(name text, data jsonb, fetched_at timestamptz)
       on conflict (name) do update set data = excluded.data, fetched_at = excluded.fetched_at`,
    )
    await upsert(
      db,
      raw.fetches,
      `insert into tour.list_fetches (area_code, sigungu_code, content_type, fetched_at)
       select * from jsonb_to_recordset($1::jsonb)
         as x(area_code smallint, sigungu_code smallint, content_type smallint, fetched_at timestamptz)
       on conflict (area_code, sigungu_code, content_type) do update set fetched_at = excluded.fetched_at`,
    )
    await upsert(
      db,
      raw.items,
      `insert into tour.list_items (contentid, content_type, area_code, sigungu_code, modified, item, hidden_at, hidden_mt)
       select * from jsonb_to_recordset($1::jsonb)
         as x(contentid text, content_type smallint, area_code smallint, sigungu_code smallint,
              modified text, item jsonb, hidden_at timestamptz, hidden_mt text)
       on conflict (contentid) do update set
         content_type = excluded.content_type, area_code = excluded.area_code,
         sigungu_code = excluded.sigungu_code, modified = excluded.modified, item = excluded.item,
         hidden_at = excluded.hidden_at, hidden_mt = excluded.hidden_mt, updated_at = now()`,
    )
    await upsert(
      db,
      raw.details,
      `insert into tour.details (contentid, common, intro, mt)
       select * from jsonb_to_recordset($1::jsonb) as x(contentid text, common jsonb, intro jsonb, mt text)
       on conflict (contentid) do update set
         common = excluded.common, intro = excluded.intro, mt = excluded.mt, fetched_at = now()`,
    )
    await upsert(
      db,
      raw.syncState,
      `insert into tour.sync_state (key, value)
       select * from jsonb_to_recordset($1::jsonb) as x(key text, value jsonb)
       on conflict (key) do update set value = excluded.value, updated_at = now()`,
    )
    await db.query(
      `insert into tour.runs (host, finished_at, result) values ('import-raw', now(), $1::jsonb)`,
      [JSON.stringify(summary(raw))],
    )
    await db.query('commit')
  } catch (e) {
    await db.query('rollback')
    throw e
  }
}

/* ───────────────────────────── 대조 ───────────────────────────── */

async function verify(db, raw) {
  const problems = []
  const check = (label, fileRows, dbRows, keyOf, valOf) => {
    const want = new Map(fileRows.map((r) => [keyOf(r), canon(valOf(r))]))
    const got = new Map(dbRows.map((r) => [keyOf(r), canon(valOf(r))]))
    let missing = 0,
      extra = 0,
      diff = 0
    const samples = []
    for (const [k, v] of want) {
      if (!got.has(k)) {
        missing++
        if (samples.length < 3) samples.push(`없음 ${k}`)
      } else if (got.get(k) !== v) {
        diff++
        if (samples.length < 3) samples.push(`다름 ${k}`)
      }
    }
    for (const k of got.keys()) if (!want.has(k)) extra++
    const ok = !missing && !extra && !diff
    console.log(
      `  ${ok ? '✓' : '✗'} ${label}: 파일 ${want.size} · DB ${got.size}` +
        (ok ? '' : ` — 없음 ${missing} · 남음 ${extra} · 다름 ${diff}`),
    )
    for (const s of samples) console.log(`      ${s}`)
    if (!ok) problems.push(label)
  }

  const q = async (sql) => (await db.query(sql)).rows
  check('코드표', raw.codeTables, await q('select name, data from tour.code_tables'), (r) => r.name, (r) => r.data)
  check(
    '받은 목록 단위',
    raw.fetches,
    await q('select area_code, sigungu_code, content_type from tour.list_fetches'),
    (r) => `${r.area_code}-${r.sigungu_code}-${r.content_type}`,
    () => 1,
  )
  check(
    '목록 항목',
    raw.items,
    await q('select contentid, content_type, area_code, sigungu_code, modified, item, hidden_mt, hidden_at is not null as h from tour.list_items'),
    (r) => r.contentid,
    (r) => [r.content_type, r.area_code, r.sigungu_code, r.modified, r.item, r.hidden_mt, r.h ?? r.hidden_at !== null],
  )
  check(
    '상세',
    raw.details,
    await q('select contentid, common, intro, mt from tour.details'),
    (r) => r.contentid,
    (r) => [r.common, r.intro, r.mt],
  )
  check('수집 상태', raw.syncState, await q('select key, value from tour.sync_state'), (r) => r.key, (r) => r.value)
  return problems
}

function summary(raw) {
  return {
    codeTables: raw.codeTables.length,
    listFetches: raw.fetches.length,
    listItems: raw.items.length,
    hidden: raw.items.filter((r) => r.hidden_at).length,
    details: raw.details.length,
    syncState: raw.syncState.length,
    ...raw.notes,
    nulFixed,
  }
}

/* ───────────────────────────── 진입점 ───────────────────────────── */

async function main() {
  const raw = await readRaw()
  const s = summary(raw)
  console.log('raw/ 읽음')
  console.log(`  코드표 ${s.codeTables} · 목록 파일 ${s.listFetches} · 장소 ${s.listItems}(숨김 ${s.hidden}) · 상세 ${s.details} · 상태 ${s.syncState}`)
  console.log(
    `  겹침: 목록 ${s.listDup} · 상세 ${s.detailDup} · 목록에 없는 장소의 상세 ${s.detailOrphan}` +
      ` · 목록에도 있는 숨김 ${s.hiddenInList} · 자리를 못 찾은 숨김 ${s.hiddenNoItem}` +
      (s.nulFixed ? ` · NUL 문자 지움 ${s.nulFixed}` : ''),
  )
  if (dry) return

  // DB 모듈(pg)은 실제로 접속할 때만 불러온다 — --dry 는 pg 없이도 돈다
  const { connect } = await import('./db.mjs')
  const db = await connect()
  try {
    if (!verifyOnly) {
      const t0 = Date.now()
      await load(db, raw)
      console.log(`적재 끝 (${((Date.now() - t0) / 1000).toFixed(1)}초)`)
    }
    console.log('대조')
    const problems = await verify(db, raw)
    if (problems.length) {
      console.log(`✗ 맞지 않음: ${problems.join(' · ')}`)
      process.exitCode = 1
    } else {
      console.log('✓ 파일과 DB 가 같습니다')
    }
  } finally {
    await db.end()
  }
}

main().catch((e) => {
  console.error(`✗ ${e.message}`)
  process.exit(1)
})
