#!/usr/bin/env bash
# 無 Docker 的本地開發／E2E 環境：SQLite + 本地文件存儲 + Celery（SQLite broker）+ MockProvider。
# 只用於開發與測試，不產生任何費用。正式部署請用 compose.yaml。
#
#   scripts/dev-local.sh start   啟動 API（:8000）、worker、前端（:5173）
#   scripts/dev-local.sh stop    停止
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

start() {
  if curl -sf http://localhost:8000/healthz >/dev/null 2>&1; then
    echo "端口 8000 已被佔用，先執行 $0 stop" >&2
    exit 1
  fi
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
  for _ in $(seq 1 60); do
    curl -sf http://localhost:8000/healthz >/dev/null && curl -sf http://localhost:5173 >/dev/null && break
    sleep 1
  done
  echo "API http://localhost:8000  前端 http://localhost:5173  日誌 $DATA/*.log"
}

stop() {
  local pids=""
  for name in web worker api; do
    [ -f "$PIDS/$name" ] && pids="$pids $(cat "$PIDS/$name")"
    rm -f "$PIDS/$name"
  done
  # 兜底：pid 文件以外的殘留進程（方括號避免匹配到 pgrep 自己）
  pids="$pids $(pgrep -f '[u]vicorn --factory app.main:app_factory' || true)"
  pids="$pids $(pgrep -f '[c]elery -A app.workers worker' || true)"
  pids="$pids $(pgrep -f '[v]ite.js --port 5173' || true)"
  [ -n "${pids// }" ] || return 0
  kill $pids 2>/dev/null || true
  for _ in $(seq 1 15); do
    alive=""
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
    [ -z "$alive" ] && return 0
    sleep 1
  done
  kill -9 $alive 2>/dev/null || true
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  *) echo "用法：$0 start|stop" >&2; exit 2 ;;
esac
