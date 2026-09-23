#!/usr/bin/env bash
# SessionStart：只在 Claude Code 雲端會話執行——啟動 Docker、同步項目依賴
# 標準輸出會作為上下文給 Claude，所以只在失敗時輸出
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
if ! docker info >/dev/null 2>&1; then
  setsid nohup dockerd >/tmp/dockerd.log 2>&1 < /dev/null &
fi
if [ -f backend/uv.lock ]; then
  (cd backend && uv sync --locked -q) || echo "SessionStart：backend 的 uv sync 失敗，先修依賴再做其他事"
fi
if [ -f frontend/pnpm-lock.yaml ]; then
  (cd frontend && pnpm install --frozen-lockfile --reporter=silent) || echo "SessionStart：frontend 的 pnpm install 失敗"
fi
exit 0
