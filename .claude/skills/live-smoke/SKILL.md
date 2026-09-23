---
name: live-smoke
description: 用真實方舟 API 生成一條最便宜的 5 秒樣片並下載，驗證 Seedance 調用鏈。會產生費用，只由使用者用 /live-smoke 觸發。
disable-model-invocation: true
argument-hint: [volcengine|byteplus]
---

這是付費操作。區域：$ARGUMENTS（留空則用環境變量 ARK_REGION）。

1. 讀 config/models.yaml 的 video_draft 模型與單價，按最低解析度、5 秒、不生成音頻估算費用；超過 LIVE_BUDGET_CNY 就停下問我
2. 執行 cd backend && uv run pytest -m live -k seedance -x
3. 影片只存到 /tmp/live-smoke/，不得放進倉庫
4. 用 ffprobe 回報時長、解析度、編碼，以及 task_id、usage 與實際費用
5. 不要打印密鑰、請求頭或帶簽名的 URL
