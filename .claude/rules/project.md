# 項目規則

## 架構
- 所有模型調用只能經過 backend/app/providers/，業務代碼不得直接調 HTTP 或 SDK
- 模型 ID、單價、限速只從 config/models.yaml 讀取，禁止寫死
- 區域由環境變量 ARK_REGION 決定（volcengine 或 byteplus）
- 長任務一律走 Celery；API 請求內不得等待生成結果

## 密鑰與安全
- 密鑰只從環境變量讀取（ARK_API_KEY、TTS_APP_ID、TTS_TOKEN、S3_*），不得出現在代碼、日誌、前端、測試數據中
- 不要列印環境變量，也不要讀取 .env（hook 會攔截）
- 下載外部 URL 前檢查域名白名單與文件大小，防 SSRF
- 用戶上傳文件校驗類型與大小，文件名一律重新生成
- 開發會話運行在境外雲端：倉庫與會話只用測試素材，不放客戶數據與真人肖像

## 生成任務
- Seedance 任務建立後用指數退避輪詢（10 秒起、上限 60 秒），總超時可配置
- 任務成功後立即把 video_url 與 last_frame_url 下載到對象存儲
- 每次調用把 model、task_id、usage、估算金額寫入 cost_ledger 表
- 超出單任務或每日預算時停止後續步驟，狀態記為 budget_exceeded
- 只重試限流、超時、服務端錯誤；內容審核類錯誤直接回報給用戶
- 接口支援時（目前是 Seedance），調用時把平台內部用戶 ID 傳給 safety_identifier；不支援的接口（大模型、Seedream）由 generation_calls.user_id 追溯

## 媒體與合規
- 成片必須加 AI 生成顯式標識（片頭 + 畫面角落），並在文件元數據寫入隱式標識
- 字幕與疊字只用 assets/fonts/ 下的可商用字體
- 輸出 H.264 + AAC 的 MP4，響度統一
- 提示詞模板不得使用真實人名、明星、第三方品牌與影視 IP
- 生成的媒體文件不得提交到 Git；測試用樣例影片在測試時用 ffmpeg 即時生成

## 工程
- Python 3.13，類型註解完整，ruff 與 mypy（strict）通過；前端 TypeScript 嚴格模式，Biome 通過
- 每個新接口與流水線步驟都要有單元測試，外部調用全部 mock
- 數據庫變更只能新增 Alembic 遷移，不改已提交的遷移
- 界面文案預設繁體中文，集中放在 i18n 文件，方便切換簡體
