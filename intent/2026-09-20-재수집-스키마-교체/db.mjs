/**
 * 수집 DB(tour 스키마) 접속 — 수집 스크립트들이 같이 쓴다.
 *
 * 접속 주소는 이 순서로 찾는다.
 *   1. 환경 변수 TOUR_DB_URL   (GitHub Actions 등 서버 — Secrets 로 넣는다)
 *   2. 이 폴더의 .db-url        (Mac — .gitignore 에 있어 커밋되지 않는다)
 *
 * 운영 DB 는 Supabase 대시보드 Connect → Session pooler 의 URI 를 쓴다. 사용자 이름은
 * tour_collector.<프로젝트 ref>, 비밀번호는 SQL 편집기에서 직접 정한 값이다.
 * 주소에는 비밀번호가 들어 있으므로 이 모듈은 주소를 화면에 찍지 않는다 — 호스트만 보인다.
 *
 * 암호화: 로컬(유닉스 소켓 · localhost)이 아니면 항상 TLS 로 접속한다. 이 폴더에
 * .db-ca.crt(대시보드에서 받는 Supabase CA 인증서)가 있으면 서버 인증서까지 검증하고,
 * 없으면 암호화만 한다. 주소의 sslmode 는 무시한다 — 위 규칙이 정한다.
 */

import { readFile, access } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const HERE = import.meta.dirname
const URL_FILE = path.join(HERE, '.db-url')
const CA_FILE = path.join(HERE, '.db-ca.crt')

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  )

async function findUrl() {
  if (process.env.TOUR_DB_URL) return { url: process.env.TOUR_DB_URL.trim(), from: '환경 변수 TOUR_DB_URL' }
  if (await exists(URL_FILE)) {
    const line = (await readFile(URL_FILE, 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#'))
    if (line) return { url: line, from: '.db-url' }
  }
  throw new Error(
    'DB 접속 주소가 없습니다. 이 폴더에 .db-url 파일을 만들고 Supabase Session pooler 주소를 ' +
      '한 줄로 넣거나(사용자 이름 tour_collector.<ref>), 환경 변수 TOUR_DB_URL 을 정하세요.',
  )
}

/** 접속한 pg.Client 를 돌려준다. 다 쓰면 client.end() */
export async function connect() {
  const { url, from } = await findUrl()
  // 유닉스 소켓 주소(postgresql://user@/db?host=/소켓/폴더)는 URL 로 읽히지 않는다 — 그때는 그대로 쓴다
  let conn = url
  let host = ''
  try {
    const u = new URL(url)
    u.searchParams.delete('sslmode')
    host = u.searchParams.get('host') || u.hostname
    conn = u.toString()
  } catch {
    host = decodeURIComponent(/[?&]host=([^&]+)/.exec(url)?.[1] ?? '')
  }
  const local = !host || host.startsWith('/') || ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)

  let ssl = false
  let tls = '로컬 · 암호화 없음'
  if (!local) {
    if (await exists(CA_FILE)) {
      ssl = { ca: await readFile(CA_FILE, 'utf8') }
      tls = 'TLS · 인증서 검증'
    } else {
      ssl = { rejectUnauthorized: false }
      tls = 'TLS · 인증서 검증 안 함(.db-ca.crt 없음)'
    }
  }
  const client = new pg.Client({ connectionString: conn, ssl, application_name: 'oneday-trip-collect' })
  await client.connect()
  const { rows } = await client.query('select current_user as who')
  console.log(`DB: ${local ? '로컬' : host} · ${rows[0].who} · ${tls} (${from})`)
  return client
}
