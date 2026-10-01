#!/bin/bash
#
# 전국 수집을 매일 한 번 이어서 돌린다.
#
# collect.mjs 는 이미 받은 것을 건너뛰므로, 일일 호출 한도에 걸려 죽어도
# 다음 날 다시 실행하면 그 자리에서 이어진다. 이 스크립트는 그 "다음 날 다시"를
# 자동으로 해주는 껍데기일 뿐이다.
#
# 수동 실행:  ./run-daily.sh
# 진행 확인:  ./run-daily.sh --status
#
# 키는 같은 폴더의 .key 에서 읽는다. 대화형 입력은 무인 실행에서 쓸 수 없다.

set -u
cd "$(dirname "$0")" || exit 1

# launchd·cron 은 PATH 가 거의 비어 있다
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# PATH 만으로는 부족하다. node 를 nvm 으로 깔면 ~/.nvm 아래에 있는데 그 경로는
# 로그인 셸의 .zshrc 가 깔아주는 것이라 launchd 환경에는 없다. 2026-09-23 부터
# 2026-09-30 까지 예약 실행이 전부 "node: command not found"(종료코드 127) 로
# 죽은 원인이 이것이다. 그래서 여기서 직접 찾는다.
NODE=""
for cand in \
  "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  /usr/bin/node
do
  if [ -n "$cand" ] && [ -x "$cand" ]; then NODE="$cand"; break; fi
done
if [ -z "$NODE" ]; then
  # nvm: 가장 최신 버전을 고른다 (v10 < v9 로 정렬되지 않도록 -V 사용)
  NODE="$(ls -1d "$HOME"/.nvm/versions/node/v*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "node 를 찾지 못했습니다. run-daily.sh 의 NODE 탐색 목록에 경로를 추가하세요." >&2
  echo "  (터미널에서 'command -v node' 로 확인한 절대경로)" >&2
  exit 127
fi

LOG_DIR="raw/logs"
mkdir -p "$LOG_DIR"

progress() {
  "$NODE" -e '
const fs=require("fs");
const D="raw";
if(!fs.existsSync(D+"/area-codes.json")){ console.log("아직 시작 전"); process.exit(0); }
const areas=JSON.parse(fs.readFileSync(D+"/area-codes.json","utf8"));
let leaves=0, listDone=0, L=0, Dn=0;
const files=new Set(fs.readdirSync(D));
for(const a of areas){
  const sf=`sigungu-${a.code}.json`;
  if(!files.has(sf)) continue;
  const sgs=JSON.parse(fs.readFileSync(`${D}/${sf}`,"utf8"));
  const codes = sgs.length ? sgs.map(s=>s.code) : ["0"];
  for(const c of codes){
    leaves++;
    let all=true;
    for(const t of [39,12,14]){
      const lf=`places-${a.code}-${c}-${t}.json`;
      if(!files.has(lf)){ all=false; continue; }
      const n=JSON.parse(fs.readFileSync(`${D}/${lf}`,"utf8")).length; L+=n;
      const df=`detail-${a.code}-${c}-${t}.json`;
      Dn += files.has(df) ? Object.keys(JSON.parse(fs.readFileSync(`${D}/${df}`,"utf8"))).length : 0;
    }
    if(all) listDone++;
  }
}
const areasDone = areas.filter(a=>files.has(`sigungu-${a.code}.json`)).length;
const pct = L ? (Dn/L*100).toFixed(1) : "0.0";
console.log(`시/도 ${areasDone}/${areas.length} · 시군구 목록 ${listDone}/${leaves} · 장소 ${L}건 · 상세 ${Dn} (${pct}%)`);
console.log(`남은 상세 ${L-Dn}곳 = ${(L-Dn)*2}호출 (아직 목록을 안 받은 시군구는 제외)`);
'
}

if [ "${1:-}" = "--status" ]; then
  progress
  exit 0
fi

STAMP="$(date '+%Y%m%d-%H%M%S')"
LOG="$LOG_DIR/run-$STAMP.log"

{
  echo "=== 시작 $(date '+%Y-%m-%d %H:%M:%S') ==="
  echo "--- 실행 전 ---"
  progress
  echo
  "$NODE" collect.mjs
  CODE=$?
  echo
  echo "--- 실행 후 (종료코드 $CODE) ---"
  progress
  echo "=== 끝 $(date '+%Y-%m-%d %H:%M:%S') ==="
} >>"$LOG" 2>&1

# 마지막 실행 요약을 한곳에 모아 둔다 — 열흘치 로그를 다 열어보지 않아도 되게
{
  echo "[$(date '+%Y-%m-%d %H:%M')] $(progress | head -1)"
} >>"$LOG_DIR/summary.txt"

tail -25 "$LOG"
