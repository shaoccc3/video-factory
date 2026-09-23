#!/usr/bin/env bash
# PreToolUse(Bash)：攔截會洩露密鑰、或把生成媒體提交進 Git 的命令
# exit 2 = 攔截，stderr 的說明會回饋給 Claude；exit 0 = 照常走權限流程
cmd=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')
deny() { echo "已攔截：$1" >&2; exit 2; }
S='[[:space:]]'
grep -Eq "(^|[;&|(]|$S)(printenv|env|set|export$S+-p)$S*(\$|[;&|)])" <<<"$cmd" \
  && deny "不要列印環境變量（可能含密鑰）"
grep -Eq '\$\{?(ARK_API_KEY|TTS_TOKEN|TTS_APP_ID|S3_ACCESS_KEY|S3_SECRET_KEY)([^A-Za-z0-9_]|$)' <<<"$cmd" \
  && deny "不要在命令行展開密鑰變量，讓程式自己從環境讀取"
grep -Eq "(^|[;&|]|$S)(cat|less|more|head|tail|bat|grep|sed|awk|cp)$S([^;&|]*[/[:space:]])?\.env($S|\$|[;&|])" <<<"$cmd" \
  && deny "不要讀取或複製 .env"
grep -Eiq "git$S+add$S[^;&|]*\.(mp4|mov|mkv|webm|wav|mp3|m4a|aac)($S|\$|[;&|])" <<<"$cmd" \
  && deny "生成的媒體文件不得提交到 Git"
exit 0
