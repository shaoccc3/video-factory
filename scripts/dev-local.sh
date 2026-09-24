#!/usr/bin/env bash
# 無 Docker 的本地開發／E2E 環境：SQLite + 本地文件存儲 + Celery（SQLite broker）+ MockProvider。
# 只用於開發與測試，不產生任何費用。正式部署請用 compose.yaml + compose.prod.yaml（見 docs/runbook.md）。
#
#   scripts/dev-local.sh start   啟動 API（:8000）、worker、前端（:5173），全部就緒才返回；失敗時印日誌並非零退出
#   scripts/dev-local.sh stop    停止（只停本 checkout 啟動的進程）
# 前置：系統的 ffmpeg 與 fonts-noto-cjk、cd backend && uv sync、scripts/fetch_fonts.py、cd frontend && pnpm install
#   E2E：scripts/dev-local.sh start && (cd frontend && E2E_PASSWORD=admin-pass-123 pnpm e2e)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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
  curl -s -o /dev/null --max-time 2 "http://localhost:$1/" || rc=$?
  [ "$rc" -ne 7 ]
}

# 啟動失敗只停本次啟動的進程，不做 stop 的兜底搜尋
fail() {
  echo "啟動失敗：$1" >&2
  local name
  for name in ${2:-api worker web}; do
    echo "---- $DATA/$name.log（最後 30 行）" >&2
    tail -n 30 "$DATA/$name.log" >&2 2>/dev/null || true
  done
  stop_own
  exit 1
}

# 等 API（/readyz）、worker（celery ready）、前端都就緒；任一進程提前退出就立刻報錯
wait_ready() {
  local name pid
  for _ in $(seq 1 "$READY_TIMEOUT_S"); do
    for name in api worker web; do
      pid="$(cat "$PIDS/$name")"
      kill -0 "$pid" 2>/dev/null || fail "$name 進程已退出" "$name"
    done
    if curl -sf http://localhost:8000/readyz >/dev/null 2>&1 &&
      grep -q " ready\." "$DATA/worker.log" 2>/dev/null &&
      curl -sf http://localhost:5173 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "/readyz：$(curl -s http://localhost:8000/readyz 2>/dev/null || echo 無回應)" >&2
  fail "等待 ${READY_TIMEOUT_S} 秒仍未就緒（機器較慢時可設 READY_TIMEOUT_S 調長）"
}

start() {
  local port
  for port in 8000 5173; do
    if port_busy "$port"; then
      echo "端口 $port 已被佔用：如果是上次沒停的本地全套，先執行 $0 stop；否則先關掉佔用端口的程序" >&2
      exit 1
    fi
  done
  preflight
  mkdir -p "$DATA" "$PIDS"
  cd "$ROOT/backend"
  uv run alembic upgrade head
  uv run python -m app.cli sync-templates
  E2E_PASSWORD="${E2E_PASSWORD:-admin-pass-123}" uv run python -m app.cli create-user admin@example.com 管理員 \
    --roles admin,reviewer,creator --password-env E2E_PASSWORD
  nohup uv run uvicorn --factory app.main:app_factory --port 8000 >"$DATA/api.log" 2>&1 &
  echo $! >"$PIDS/api"
  nohup uv run celery -A app.workers worker -l info --concurrency 2 >"$DATA/worker.log" 2>&1 &
  echo $! >"$PIDS/worker"
  cd "$ROOT/frontend"
  nohup pnpm dev --port 5173 --strictPort >"$DATA/web.log" 2>&1 &
  echo $! >"$PIDS/web"
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

# 停 pid 文件記錄的進程
stop_own() {
  local name pid tops=""
  for name in web worker api; do
    [ -f "$PIDS/$name" ] || continue
    pid="$(cat "$PIDS/$name")"
    rm -f "$PIDS/$name"
    # pid 文件可能過期（重開機後 pid 被重用）：只處理命令列看得出是本腳本啟動的進程
    case "$(ps -o args= -p "$pid" 2>/dev/null || true)" in
      *uvicorn* | *celery* | *pnpm* | *vite*) tops="$tops $pid" ;;
    esac
  done
  if [ -n "${tops// }" ]; then terminate_tree $tops; fi
  return 0
}

# pid 文件以外的殘留進程：只找本 checkout 的 .venv／node_modules 啟動的，不會碰到 Docker 容器或其他 checkout；
# 父進程也在名單裡的（celery pool 子進程）跳過，由主進程負責收
leftovers() {
  local root_re cands p ppid
  root_re="$(printf '%s' "$ROOT" | sed 's/[][\.*^$+?(){}|]/\\&/g')"
  cands="$({
    pgrep -f "$root_re/backend/\.venv/bin/(uvicorn|celery) " || true
    pgrep -f "$root_re/frontend/node_modules/.*vite\.js" || true
  } | tr '\n' ' ')"
  for p in $cands; do
    ppid="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ' || true)"
    case " $cands " in *" $ppid "*) continue ;; esac
    echo "$p"
  done
}

stop() {
  stop_own
  local rest
  rest="$(leftovers | tr '\n' ' ')"
  if [ -n "${rest// }" ]; then terminate_tree $rest; fi
  return 0
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *) echo "用法：$0 start|stop" >&2; exit 2 ;;
esac
