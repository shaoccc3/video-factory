# ADR 0002：實作選擇

日期：2026-09-23　狀態：已採用

1. **直接用 httpx 調方舟／BytePlus REST 接口，不用官方 SDK。** byteplus-python-sdk-v2 安裝後約 255 MB，且 ark 運行時缺少依賴聲明（httpx、sniffio 需自行補）。接口路徑與參數取自 SDK 原碼，兩個區域只差基礎地址。
2. **事件驅動編排，而不是 Celery chord。** 每個步驟結束調用 `advance()`，用條件更新保證狀態轉換只發生一次；不依賴結果後端，續跑與重做都是同一套邏輯。
3. **SSE 以輪詢數據庫實現。** 內部 10 人以內，1.5 秒輪詢足夠，省去 pub/sub 基礎設施。
4. **字體不進 Git。** 思源黑體繁中約 16 MB，由 `scripts/fetch_fonts.py` 從 `fonts-noto-cjk` 抽取，Dockerfile、CI、雲端 setup 都會執行。
5. **已提交的遷移不參與 ruff format。** 規則要求不改已提交的遷移（包括格式）。
6. **本地無 Docker 環境。** `scripts/dev-local.sh` 用 SQLite + 本地存儲 + Celery（SQLite broker），供雲端開發會話與 CI 的 E2E 使用；正式環境一律 compose（PostgreSQL 18、Valkey 9）。
7. **預設 `PROVIDER_MODE=mock`。** 只有 compose.prod.yaml 預設 live，開發不會意外產生費用。
