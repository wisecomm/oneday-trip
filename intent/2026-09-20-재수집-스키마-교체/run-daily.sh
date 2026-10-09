#!/bin/bash
#
# 매일 한 번: 수집(collect.mjs → DB tour.*) 다음 반영(load.mjs → 운영 places).
#
# collect.mjs 는 이미 받은 것을 건너뛰므로, 일일 호출 한도에 걸려 멈춰도 다음 날
# 그 자리에서 이어진다. 한도로 멈춘 날도 받은 만큼은 load.mjs 가 반영한다.
# 파일을 남기지 않는다 — 실행 기록은 DB 의 tour.runs 에 있다(collect.mjs --status).
#
# 수동 실행:  ./run-daily.sh
# 진행 확인:  ./run-daily.sh --status
#
# 비밀값은 같은 폴더의 .key(API 키) · .db-url(DB 접속)에서 읽는다(커밋되지 않음).
# 대화형 입력은 무인 실행에서 쓸 수 없다.

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

if [ "${1:-}" = "--status" ]; then
  exec "$NODE" collect.mjs --status
fi

echo "=== 시작 $(date '+%Y-%m-%d %H:%M:%S') ==="
"$NODE" collect.mjs
COLLECT=$?
echo
"$NODE" load.mjs
LOAD=$?
echo "=== 끝 $(date '+%Y-%m-%d %H:%M:%S') · 수집 종료코드 $COLLECT · 반영 종료코드 $LOAD ==="
[ "$COLLECT" -eq 0 ] && [ "$LOAD" -eq 0 ]
