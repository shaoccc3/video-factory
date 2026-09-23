#!/usr/bin/env bash
# guard.sh 自測：把命令包成 PreToolUse 的 JSON 餵給 guard.sh，檢查返回碼
# 樣例只作為字符串傳入，不會真的執行
set -u
cd "$(dirname "$0")" || exit 1

fail=0
check() {
  local expected=$1 cmd=$2 json rc
  json=$(python3 -c 'import json,sys; print(json.dumps({"tool_name":"Bash","tool_input":{"command":sys.argv[1]}}))' "$cmd")
  bash ./guard.sh <<<"$json" 2>/dev/null
  rc=$?
  if [ "$rc" -eq "$expected" ]; then
    echo "ok   ($rc) $cmd"
  else
    echo "FAIL (期望 $expected，實際 $rc) $cmd"
    fail=1
  fi
}

# 應攔截（返回 2）
check 2 'printenv'
check 2 'env | grep ARK'
check 2 'cat .env'
check 2 'cat backend/.env'
check 2 'echo $ARK_API_KEY'
check 2 'git add out/a.mp4'

# 應放行（返回 0）
check 0 'uv run pytest'
check 0 'cat .env.example'
check 0 'printenv PATH'
check 0 'git add src/a.py'

exit $fail
