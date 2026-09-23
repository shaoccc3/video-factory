# 02 模型網關與 Seedance 封裝（P4）

狀態：已實作　日期：2026-09-23

## 目標
所有模型調用只經過 `backend/app/providers/`；統一限速、重試、預算、記帳；可在 Mock 與真實 API 之間切換。

## 設計
- `PROVIDER_MODE=mock|live`（預設 mock）。mock 不調任何外部 API。
- `ark.py`：`ArkHttp`（httpx）直接調方舟／BytePlus REST 接口，按 `ARK_REGION` 選 `models.yaml` 的 base_url。
  不用官方 SDK：BytePlus SDK 安裝後約 255 MB，且缺少依賴聲明（httpx、sniffio）；接口路徑與參數取自 SDK 原碼（見 ADR 0002）。
  `ARK_STRIP_AUTH_HEADER=true` 且密鑰為 `injected-by-proxy` 時不發 Authorization 頭。
- `live.py`：`ArkLLM`（`/chat/completions`，JSON 輸出，Pydantic 校驗失敗自動修復重試 2 次）、`ArkSeedream`（`/images/generations`）、
  `ArkSeedance`（`/contents/generations/tasks` 建立／查詢／刪除）、`DoubaoTTS`（豆包語音 HTTP 接口）。
- `mock.py`：所有接口的假實現；影片、圖片、語音用 ffmpeg 即時生成；可注入失敗與內容審核錯誤。
- `gateway.py`：業務唯一入口。每次調用：限速（`rpm`、`concurrency`，跨進程用 Valkey）→ 預算檢查 → 記錄 `generation_calls`
  → 調用（只重試限流、超時、服務端錯誤，指數退避）→ 寫 `cost_ledger` 並累加 `jobs.actual_cost_cny`。
- Seedance：建立後回調 `on_created` 保存遠端任務 id（續跑時沿用，不重複計費）；輪詢 10 秒起、翻倍、上限 60 秒，總超時可配置，
  超時或任務被取消時刪除遠端任務；成功後立即下載 `video_url`、`last_frame_url`（https + 域名白名單 + 大小上限）。
- 能力表：`models.yaml` 的 `video_draft`／`video_final.capabilities`（解析度、畫幅、時長範圍、fps、是否支援樣片與音頻、圖片 role）。
- 計價：影片 token ≈ 寬 × 高 × fps × 時長 / 1024；按幣種（BytePlus USD、方舟 CNY）與 `fx_to_cny` 換算。

## 驗收
- [x] 單元測試：參數組裝、輪詢狀態轉換、重試判斷、預算超限、下載失敗重試、HTTP 錯誤分類、LLM JSON 修復、白名單、限速
- [x] `pytest -m live` 冒煙測試已寫好，預設跳過，只由 /live-smoke 觸發
