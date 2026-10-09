/**
 * 연동 로그를 DB 에 — 화면에 찍는 줄을 그대로 tour.run_logs 에도 남긴다.
 *
 * console.log · console.error · console.warn 을 감싸 화면 출력은 그대로 두고, 줄마다
 * (실행 번호, 순서, 시각, 수준, 내용)을 모아 둔다. 실행(tour.runs) 번호가 정해지면
 * 50줄마다 · 5초마다 · 끝날 때 넣는다 — 실행 도중 죽어도 그때까지는 남는다.
 *
 * 접속은 따로 하나 연다. 스크립트 본체가 트랜잭션을 여는 동안 같은 접속으로 넣으면
 * 로그가 그 트랜잭션에 섞여, 되돌릴 때 함께 사라진다.
 *
 * 로그를 넣지 못해도 수집 · 반영은 멈추지 않는다 — 화면에 한 줄 알리고 그 뒤로는 넣지 않는다.
 * 실행이 끝날 때 KEEP_DAYS 지난 줄을 지운다(실행 요약 tour.runs 는 남긴다).
 */

import { connect } from './db.mjs'

const KEEP_DAYS = 30
const FLUSH_LINES = 50
const FLUSH_MS = 5000

const toText = (a) => {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack ?? a.message
  try {
    return JSON.stringify(a)
  } catch {
    return String(a)
  }
}

/** 지금부터 콘솔 출력을 모은다. attach(runId) 전까지는 모으기만 한다 */
export function captureConsole() {
  const orig = { log: console.log, error: console.error, warn: console.warn }
  const pending = []
  let seq = 0
  let runId = null
  let db = null
  let timer = null
  let failed = false
  let chain = Promise.resolve()

  const push = (level, args) => {
    const text = args.map(toText).join(' ')
    const at = new Date().toISOString()
    for (const line of text.split('\n')) pending.push({ seq: ++seq, at, level, message: line })
    if (runId && pending.length >= FLUSH_LINES) flush()
  }
  console.log = (...a) => {
    orig.log(...a)
    push('info', a)
  }
  console.error = (...a) => {
    orig.error(...a)
    push('error', a)
  }
  console.warn = (...a) => {
    orig.warn(...a)
    push('error', a)
  }

  function flush() {
    if (!db || failed || pending.length === 0) return chain
    const batch = pending.splice(0)
    chain = chain
      .then(() =>
        db.query(
          `insert into tour.run_logs (run_id, seq, logged_at, level, message)
           select $1, x.seq, x.at, x.level, x.message
             from jsonb_to_recordset($2::jsonb) as x(seq int, at timestamptz, level text, message text)`,
          [runId, JSON.stringify(batch)],
        ),
      )
      .catch((e) => {
        failed = true
        orig.error(`(연동 로그를 DB 에 남기지 못함 — 이후 줄은 화면에만: ${e.message})`)
      })
    return chain
  }

  return {
    /** 실행 번호가 정해지면 로그 접속을 열고 그동안 모은 줄부터 넣는다 */
    async attach(id) {
      runId = id
      try {
        db = await connect({ quiet: true })
      } catch (e) {
        failed = true
        orig.error(`(연동 로그 접속 실패 — 화면에만 남습니다: ${e.message})`)
        return
      }
      timer = setInterval(flush, FLUSH_MS)
      timer.unref?.()
      await flush()
    },
    /** 남은 줄을 넣고, 오래된 줄을 지우고, 콘솔을 되돌린다 */
    async stop() {
      clearInterval(timer)
      await flush()
      if (db && !failed) {
        await db
          .query(`delete from tour.run_logs where logged_at < now() - make_interval(days => $1)`, [KEEP_DAYS])
          .catch(() => {})
      }
      await db?.end().catch(() => {})
      Object.assign(console, orig)
    },
  }
}

/** 실행 하나의 로그를 화면에 다시 찍는다 — runId 가 없으면 마지막 실행 */
export async function printRunLog(db, runId) {
  const [run] = (
    await db.query(
      runId
        ? 'select id, host, started_at, finished_at, error from tour.runs where id = $1'
        : 'select id, host, started_at, finished_at, error from tour.runs order by id desc limit 1',
      runId ? [Number(runId)] : [],
    )
  ).rows
  if (!run) {
    console.log(runId ? `실행 #${runId} 이 없습니다.` : '실행 기록이 아직 없습니다.')
    return
  }
  const kst = (t) => (t ? new Date(t).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-')
  console.log(`── 실행 #${run.id} · ${run.host ?? '-'} · ${kst(run.started_at)} ~ ${kst(run.finished_at)}${run.error ? ' · ✗' : ''}`)
  const { rows } = await db.query('select level, message from tour.run_logs where run_id = $1 order by seq', [run.id])
  if (rows.length === 0) console.log('(남은 로그 줄 없음 — 30일이 지났거나 로그를 남기기 전 실행)')
  for (const r of rows) (r.level === 'error' ? console.error : console.log)(r.message)
}
