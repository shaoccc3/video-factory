#!/usr/bin/env bash
# 無 Docker 的本地開發／E2E 環境：SQLite + 本地文件存儲 + Celery（SQLite broker）+ MockProvider。
# 只用於開發與測試，不產生任何費用。正式部署請用 compose.yaml + compose.prod.yaml（見 docs/runbook.md）。
#
#   scripts/dev-local.sh start   啟動 API（:8000）、worker、前端（:5173），全部就緒才返回；失敗時印日誌並非零退出
#   scripts/dev-local.sh stop    停止（只停本 checkout 啟動的進程）
# 數據放在 VF_LOCAL_DIR（預設 /tmp/vf-local，所有 checkout 共用；同一時間只能跑一套）。
# 不同分支或 worktree 請各用自己的 VF_LOCAL_DIR：共用的 app.db 會帶著別的分支的遷移版本
# 前置：系統的 ffmpeg 與 fonts-noto-cjk、cd backend && uv sync、scripts/fetch_fonts.py、cd frontend && pnpm install
#   E2E：scripts/dev-local.sh start && (cd frontend && E2E_PASSWORD=admin-pass-123 pnpm e2e)
set -euo pipefail
# 用實際路徑（pwd -P）：uv、pnpm 啟動的進程命令列裡是解析過符號連結的路徑，stop 靠它辨認本 checkout
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
DATA="${VF_LOCAL_DIR:-/tmp/vf-local}"
PIDS="$DATA/pids"

export PROVIDER_MODE=mock
export DATABASE_URL="sqlite+aiosqlite:///$DATA/app.db"
export CELERY_BROKER_URL="sqla+sqlite:///$DATA/broker.db"
export CELERY_RESULT_BACKEND="db+sqlite:///$DATA/results.db"
export STORAGE_BACKEND=local
export LOCAL_STORAGE_DIR="$DATA/storage"
export WORK_DIR="$DATA/work"
export SEEDANCE_POLL_INITIAL_S=0.5
export SEEDANCE_POLL_MAX_S=1
export LOG_JSON=false
export SECRET_KEY="${SECRET_KEY:-local-dev-only}"

FONT="${FONTS_DIR:-$ROOT/assets/fonts}/${FONT_FILE:-NotoSansCJKtc-Regular.otf}"
READY_TIMEOUT_S="${READY_TIMEOUT_S:-90}"

# 三個服務的啟動參數；stop 用同一組字串辨認本腳本啟動的進程
API_ARGS="uvicorn --factory app.main:app_factory --port 8000"
WORKER_ARGS="celery -A app.workers worker -l info --concurrency 2"
WEB_ARGS="dev --port 5173 --strictPort"

# 本機請求一律不走代理（http_proxy 沒排除 localhost 時，代理的回應會被當成端口被佔用或服務就緒）
lcurl() { curl --noproxy '*' "$@"; }

# pgrep 在 C locale 下會把非 ASCII 路徑印成 ?，有 UTF-8 locale 時用它比對
UTF8_LOCALE="$(locale -a 2>/dev/null | grep -iE '^(c|en_us)\.utf-?8$' | head -n 1 || true)"
upgrep() {
  if [ -n "$UTF8_LOCALE" ]; then LC_ALL="$UTF8_LOCALE" pgrep "$@"; else pgrep "$@"; fi
}

# pid 目錄記錄的 checkout（沒有記錄時為空）
pid_owner() {
  if [ -f "$PIDS/root" ]; then cat "$PIDS/root"; fi
}

# 要停上一套時該執行的命令：記錄的 checkout 還在就指向它
stop_hint() {
  local owner
  owner="$(pid_owner)"
  if [ -n "$owner" ] && [ -d "$owner" ]; then echo "$owner/scripts/dev-local.sh stop"; else echo "$ROOT/scripts/dev-local.sh stop"; fi
}

# pid 文件記錄、仍在運行、且命令列和本腳本啟動的完全一致的進程（pid 可能被重用）
recorded_pids() {
  local name pid
  for name in web worker api; do
    [ -f "$PIDS/$name" ] || continue
    pid="$(cat "$PIDS/$name")"
    alive "$pid" || continue
    case "$(ps -o args= -p "$pid" 2>/dev/null || true)" in
      "uv run $API_ARGS" | "uv run $WORKER_ARGS" | *pnpm*" $WEB_ARGS") echo "$pid" ;;
    esac
  done
}

# 缺前置條件時直接說明怎麼補，不要等到合成那一步才在 worker.log 裡報錯
preflight() {
  local missing="" cmd
  for cmd in uv pnpm curl ffmpeg ffprobe; do
    command -v "$cmd" >/dev/null 2>&1 || missing="$missing $cmd"
  done
  if [ -n "$missing" ]; then
    echo "缺少命令：${missing# }（ffmpeg／ffprobe 用系統套件安裝，例如 apt-get install ffmpeg）" >&2
    exit 1
  fi
  if [ ! -f "$FONT" ]; then
    echo "缺少字幕字體 $FONT" >&2
    echo "先安裝系統套件 fonts-noto-cjk，再執行：cd backend && uv run --with fonttools python ../scripts/fetch_fonts.py" >&2
    exit 1
  fi
  if [ ! -d "$ROOT/frontend/node_modules" ]; then
    echo "前端依賴未安裝，先執行：cd frontend && pnpm install" >&2
    exit 1
  fi
}

# 端口被任何程序佔用都算（curl 退出碼 7 表示連不上）
port_busy() {
  local rc=0
  lcurl -s -o /dev/null --max-time 2 "http://localhost:$1/" || rc=$?
  [ "$rc" -ne 7 ]
}

# 啟動失敗只停本次 start 啟動的進程（不讀共用的 pid 文件，也不做 stop 的兜底搜尋）
fail() {
  echo "啟動失敗：$1" >&2
  local name
  for name in ${2:-api worker web}; do
    echo "---- $DATA/$name.log（最後 30 行）" >&2
    tail -n 30 "$DATA/$name.log" >&2 2>/dev/null || true
  done
  # shellcheck disable=SC2086
  if [ -n "${STARTED// }" ]; then terminate_tree $STARTED; fi
  if [ "$(pid_owner)" = "$ROOT" ]; then rm -f "$PIDS/api" "$PIDS/worker" "$PIDS/web" "$PIDS/root"; fi
  exit 1
}

# 等 API（/readyz）、worker（celery ready）、前端都就緒；任一進程提前退出就立刻報錯
wait_ready() {
  local name var
  for _ in $(seq 1 "$READY_TIMEOUT_S"); do
    for name in api worker web; do
      var="PID_$name"
      alive "${!var}" || fail "$name 進程已退出" "$name"
    done
    if lcurl -sf http://localhost:8000/readyz >/dev/null 2>&1 &&
      grep -q " ready\." "$DATA/worker.log" 2>/dev/null &&
      lcurl -sf http://localhost:5173 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "/readyz：$(lcurl -s http://localhost:8000/readyz 2>/dev/null || echo 無回應)" >&2
  fail "等待 ${READY_TIMEOUT_S} 秒仍未就緒（機器較慢時可設 READY_TIMEOUT_S 調長）"
}

STARTED=""  # 本次 start 啟動的頂層進程

start() {
  local port running
  preflight
  # worker 不佔端口：上一套只剩 worker 時端口檢查看不出來
  running="$(recorded_pids | tr '\n' ' ')"
  if [ -n "${running// }" ]; then
    echo "上一次啟動的進程還在運行（pid ${running% }），先執行 $(stop_hint)" >&2
    exit 1
  fi
  for port in 8000 5173; do
    if port_busy "$port"; then
      echo "端口 $port 已被佔用：如果是上次沒停的本地全套，先執行 $(stop_hint)；否則先關掉佔用端口的程序" >&2
      exit 1
    fi
  done
  mkdir -p "$DATA" "$PIDS"
  cd "$ROOT/backend"
  if ! uv run alembic upgrade head; then
    echo "數據庫遷移失敗。如果 $DATA 是別的分支或 worktree 建立的，設 VF_LOCAL_DIR 用獨立目錄，或刪掉 $DATA/app.db" >&2
    exit 1
  fi
  uv run python -m app.cli sync-templates
  E2E_PASSWORD="${E2E_PASSWORD:-admin-pass-123}" uv run python -m app.cli create-user admin@example.com 管理員 \
    --roles admin,reviewer,creator --password-env E2E_PASSWORD
  # pid 目錄是共用的：記下是哪個 checkout 啟動的，別的 checkout 執行 stop 時不會動到
  printf '%s\n' "$ROOT" >"$PIDS/root"
  # shellcheck disable=SC2086 # 參數字串刻意按空白拆開
  nohup uv run $API_ARGS >"$DATA/api.log" 2>&1 &
  PID_api=$!
  # shellcheck disable=SC2086
  nohup uv run $WORKER_ARGS >"$DATA/worker.log" 2>&1 &
  PID_worker=$!
  cd "$ROOT/frontend"
  # shellcheck disable=SC2086
  nohup pnpm $WEB_ARGS >"$DATA/web.log" 2>&1 &
  PID_web=$!
  STARTED="$PID_api $PID_worker $PID_web"
  echo "$PID_api" >"$PIDS/api"
  echo "$PID_worker" >"$PIDS/worker"
  echo "$PID_web" >"$PIDS/web"
  wait_ready
  echo "API http://localhost:8000  前端 http://localhost:5173  日誌 $DATA/*.log"
  echo "登入：admin@example.com，密碼見 E2E_PASSWORD（未設定時為 admin-pass-123，只用於本地開發）"
}

# 進程還在（殭屍視同已退出）
alive() {
  local st
  st="$(ps -o stat= -p "$1" 2>/dev/null)" || return 1
  st="${st// /}"
  [ -n "$st" ] && [ "${st#Z}" = "$st" ]
}

descendants() {
  local c
  for c in $(pgrep -P "$1" 2>/dev/null || true); do
    echo "$c"
    descendants "$c"
  done
}

# wait_gone <秒> <pid>...：全部退出回 0
wait_gone() {
  local secs="$1" p left
  shift
  for _ in $(seq 1 "$secs"); do
    left=0
    for p in "$@"; do alive "$p" && left=1; done
    [ "$left" = 0 ] && return 0
    sleep 1
  done
  return 1
}

# 只對頂層進程送 TERM（uv 會轉給子進程，celery 主進程自己收 pool；直接 TERM pool 子進程會讓主進程重建 pool 而卡住），
# 等 15 秒後剩下的子孫再送 TERM，最後 kill -9
terminate_tree() {
  local all="" p
  for p in "$@"; do all="$all $p $(descendants "$p" | tr '\n' ' ')"; done
  kill "$@" 2>/dev/null || true
  wait_gone 15 $all && return 0
  kill $all 2>/dev/null || true
  wait_gone 5 $all && return 0
  kill -9 $all 2>/dev/null || true
}

# 停 pid 文件記錄的進程。另一個仍存在的 checkout 啟動的不處理（回 1）；
# 記錄的 checkout 已被刪除（例如移除了 worktree）時沒有別處能停，照 pid 文件清理
stop_own() {
  local owner pids
  owner="$(pid_owner)"
  if [ -n "$owner" ] && [ "$owner" != "$ROOT" ]; then
    if [ -d "$owner" ]; then
      echo "$PIDS 記錄的是另一個 checkout（$owner）啟動的進程，不處理；請執行 $owner/scripts/dev-local.sh stop" >&2
      return 1
    fi
    echo "$PIDS 記錄的 checkout（$owner）已不存在，清理它留下的進程" >&2
  fi
  pids="$(recorded_pids | tr '\n' ' ')"
  rm -f "$PIDS/api" "$PIDS/worker" "$PIDS/web" "$PIDS/root"
  # shellcheck disable=SC2086
  if [ -n "${pids// }" ]; then terminate_tree $pids; fi
  return 0
}

re_escape() { printf '%s' "$1" | sed 's/[][\.*^$+?(){}|]/\\&/g'; }

# pid 文件以外的殘留進程：命令列從開頭就要是本 checkout 的 .venv python／node_modules 的 vite，
# 參數也要和 start 的一致——不會碰到 Docker 容器、其他 checkout、手動啟動的服務或命令列提到這些路徑的 shell。
# 父進程也在名單裡的（celery pool 子進程）跳過，由主進程負責收
leftovers() {
  local root_re cands p ppid
  root_re="$(re_escape "$ROOT")"
  cands="$({
    # argv[0] 是 venv 的 python，或 macOS framework Python 的 .../Python.app/Contents/MacOS/Python
    upgrep -f "^($root_re/backend/\.venv/bin/python[0-9.]*|([^ ]*/)?[Pp]ython[0-9.]*) $root_re/backend/\.venv/bin/($(re_escape "$API_ARGS")|$(re_escape "$WORKER_ARGS"))( |\$)" || true
    upgrep -f "^([^ ]*/)?node $root_re/frontend/node_modules/[^ ]*/vite\.js $(re_escape "${WEB_ARGS#dev }")( |\$)" || true
  } | tr '\n' ' ')"
  for p in $cands; do
    ppid="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || true)"
    case " $cands " in *" $ppid "*) continue ;; esac
    echo "$p"
  done
}

stop() {
  local rest rc=0
  stop_own || rc=$?
  rest="$(leftovers | tr '\n' ' ')"
  # shellcheck disable=SC2086
  if [ -n "${rest// }" ]; then terminate_tree $rest; fi
  return "$rc"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *) echo "用法：$0 start|stop" >&2; exit 2 ;;
esac
