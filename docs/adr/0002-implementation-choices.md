# ADR 0002：實作選擇

日期：2026-09-23　狀態：已採用

1. **直接用 httpx 調方舟／BytePlus REST 接口，不用官方 SDK。** byteplus-python-sdk-v2 安裝後約 255 MB，且 ark 運行時缺少依賴聲明（httpx、sniffio 需自行補）。接口路徑與參數取自 SDK 原碼，兩個區域只差基礎地址。
2. **事件驅動編排，而不是 Celery chord。** 每個步驟結束調用 `advance()`，用條件更新保證狀態轉換只發生一次；不依賴結果後端，續跑與重做都是同一套邏輯。
3. **SSE 以輪詢數據庫實現。** 內部 10 人以內，1.5 秒輪詢足夠，省去 pub/sub 基礎設施。
4. **字體不進 Git。** 思源黑體繁中約 16 MB，由 `scripts/fetch_fonts.py` 從 `fonts-noto-cjk` 抽取，Dockerfile、CI、雲端 setup 都會執行。
5. **已提交的遷移不參與 ruff format。** 規則要求不改已提交的遷移（包括格式）。
6. **本地無 Docker 環境。** `scripts/dev-local.sh` 用 SQLite + 本地存儲 + Celery（SQLite broker），供雲端開發會話與 CI 的 E2E 使用；正式環境一律 compose（PostgreSQL 18、Valkey 9）。
7. **預設 `PROVIDER_MODE=mock`。** 只有 compose.prod.yaml 預設 live，開發不會意外產生費用。

## 審查後補充（2026-09-23）

8. **下載生成結果用不帶認證頭的 HTTP client**，方舟密鑰只發往方舟 API 域名；錯誤訊息裡的 URL 去掉查詢串（可能帶簽名）。
9. **safety_identifier**：Seedance 傳 `safety_identifier`，對話接口傳 `user`（OpenAI 相容欄位），TTS 傳 `uid`。
   Seedream 圖片接口（SDK 原碼）沒有對應欄位，不發送，靠 `generation_calls.user_id` 追溯。
10. **失敗的調用照樣記賬**：Seedance 任務成功後先記賬再下載；大模型修復多次仍失敗時按已消耗 token 記賬，且不再重試。
    續跑沿用遠端任務時按 remote_task_id 去重，不重複記賬。
11. **暫不處理（第一版可接受，已記錄）**：
    - 並行分鏡同時做預算檢查可能略超上限（10 人內部使用，超出幅度最多一輪並發的預估額）；若要嚴格，改為預留額度。
    - 允許審核自己的任務（小團隊常由同一人兼任；E2E 也用同一帳號）；需要職責分離時在審核接口加 `reviewer_id != owner_id`。
    - 單價與模型 ID 未按區域分開配置：切換 `ARK_REGION` 時要同時改 `config/models.yaml`（runbook 第 4 節）。
