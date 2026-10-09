/**
 * load.mjs 가 읽는 수집 원본 — DB(tour 스키마).
 *
 * 테이블 행을 예전 raw/ 파일 단위로 다시 묶어 돌려준다: 이름 목록(names)과 이름으로
 * 읽기(read). 파일로 쌓던 시절의 판정 · 변환 코드(load.mjs)를 건드리지 않고 읽는 곳만
 * 바꾸기 위해서다 (intent/2026-10-09-서버-수집-검토/검토.md). 아래 이름은 **메모리 안의
 * 묶음 이름**일 뿐 — 디스크에 파일을 만들거나 읽지 않는다.
 *
 *   area-codes.json · sigungu-N.json   ← tour.code_tables
 *   places-시도-시군구-타입.json        ← tour.list_fetches + 숨기지 않은 tour.list_items
 *   detail-시도-시군구-타입.json        ← tour.details (그 목록에 든 장소의 것)
 *   hidden.json                         ← 숨긴(hidden_at) tour.list_items
 *
 * 목록 항목 순서는 **수정일 내림차순, 같으면 contentid 순**으로 고정한다 — DB 는 순서를
 * 보장하지 않아서, 그대로 두면 같은 데이터에서 다른 결과(데모 장소 고르기 등)가 나온다.
 */

const LIST_RE = /^places-(\d+)-(\d+)-(\d+)\.json$/

/** 수정일 내림차순 → contentid 순 */
export function byModifiedDesc(x, y) {
  const a = String(x.modifiedtime ?? '')
  const b = String(y.modifiedtime ?? '')
  if (a !== b) return a < b ? 1 : -1
  const i = String(x.contentid)
  const j = String(y.contentid)
  return i < j ? -1 : i > j ? 1 : 0
}

/**
 * @param {import('pg').Client} db
 * @returns {Promise<{ label: string, names: Set<string>, read: (name: string) => Promise<any> }>}
 */
export async function readTour(db) {
  const files = new Map() // 이름 → 내용

  for (const r of (await db.query('select name, data from tour.code_tables')).rows) {
    files.set(`${r.name}.json`, r.data)
  }

  const key = (r) => `${r.area_code}-${r.sigungu_code}-${r.content_type}`
  for (const r of (await db.query('select area_code, sigungu_code, content_type from tour.list_fetches')).rows) {
    files.set(`places-${key(r)}.json`, [])
  }

  const fileOf = new Map() // contentid → 그 장소의 목록 묶음 키
  const hidden = {}
  const items = await db.query(
    'select contentid, area_code, sigungu_code, content_type, item, hidden_at, hidden_mt from tour.list_items',
  )
  for (const r of items.rows) {
    if (r.hidden_at) {
      hidden[r.contentid] = { mt: r.hidden_mt, title: r.item?.title ?? '', file: `places-${key(r)}.json`, item: r.item }
      continue
    }
    files.get(`places-${key(r)}.json`).push(r.item)
    fileOf.set(r.contentid, key(r))
  }
  for (const [name, v] of files) if (LIST_RE.test(name)) v.sort(byModifiedDesc)
  if (Object.keys(hidden).length) files.set('hidden.json', hidden)

  for (const r of (await db.query('select contentid, common, intro, mt from tour.details')).rows) {
    const k = fileOf.get(r.contentid)
    if (!k) continue // 숨긴 장소의 상세 — 목록에 없으니 쓰지 않는다
    const name = `detail-${k}.json`
    if (!files.has(name)) files.set(name, {})
    files.get(name)[r.contentid] = { mt: r.mt, common: r.common, intro: r.intro }
  }

  return {
    label: 'DB tour.*',
    names: new Set(files.keys()),
    read: async (name) => {
      if (!files.has(name)) throw new Error(`DB 에 ${name} 에 해당하는 원본이 없음`)
      return files.get(name)
    },
  }
}
