# 建設提示詞（P0～P13）

摘自《Seedance 自動化影音平台建設手冊（Claude Code 版）》。每段開一個新會話，按順序使用；方括號與尖括號處改成實際值。

## P0 環境與連通性檢查

```text
這是新項目 video-factory（公司內部的自動化影音生成平台）。這一步只做環境檢查：不寫業務代碼、不安裝項目依賴、不列印任何環境變量或密鑰。依序完成並回報：

1. 執行 check-tools，再補查：python3.13 --version、uv --version、uv python find 3.13、node --version、pnpm --version、ffmpeg -version（只取第一行）、docker --version、docker compose version、ls /opt/pw-browsers。
   期望 Node 是 v24.x、uv 找得到 3.13。不符合就說明原因（例如 setup script 沒跑成功）；找不到 3.13 時提出替代方案（例如後端在 python:3.13 容器內運行），不要自行下載或安裝其他版本。
2. 在背景啟動 dockerd，等 docker info 成功後拉取 valkey/valkey:9，確認映像倉庫可達。
3. 寫 scripts/check_connectivity.py（只用 Python 標準庫），對每個地址發 GET，回報狀態碼、耗時與判讀：
   - 國內版：https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_size=1
   - 國際版：https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_size=1
   - 對照組：https://pypi.org、https://registry.npmjs.org、https://github.com
   方舟的兩個地址各發兩次：A 不帶 Authorization；B 帶 Authorization: Bearer <ARK_API_KEY 的值>（變量不存在就跳過 B）。
   判讀：403 且回應頭 x-deny-reason 為 host_not_allowed，或報 Tunnel connection failed: 403，都算被雲端網絡白名單攔截；401 代表已連到方舟但密鑰沒生效；其他 HTTP 狀態（例如 200、400）代表密鑰已生效。列出任務不產生費用。
   腳本只打印地址、狀態碼、耗時與判讀，不得打印密鑰、請求頭或響應內容。
4. 把結果寫成 docs/env-check.md：工具版本表、連通性表、結論。結論回答：
   - 哪個區域能在雲端直接聯調
   - 密鑰來源：A 成功代表代理注入（API credentials）生效；只有 B 成功代表密鑰來自環境變量；A 成功而 B 失敗，要記下「網關在代理注入模式下不能帶 Authorization 頭」
   - 被攔截的話，環境的 Allowed domains 要加哪些域名
   - Docker 能否用來跑 compose
5. 提交 scripts/check_connectivity.py 與 docs/env-check.md，推送分支。
```

## P1 項目規則與 Claude Code 設定

```text
這一步只建立項目規則與 Claude Code 設定，不寫業務代碼。
按下方內容原樣建立文件，每段開頭一行是文件路徑。內容與 docs/env-check.md 的實際情況矛盾時（例如版本、命令），先列出來問我，不要自行改寫。

完成後：
1. 建立 .python-version（內容 3.13）、.gitignore（排除 .env、.venv、node_modules、dist、生成的媒體文件）、docs/CHANGELOG.md（第一條：建立項目規則）
2. chmod +x .claude/hooks/*.sh
3. 寫 .claude/hooks/test_guard.sh 自測 guard.sh 並執行：
   應攔截（返回 2）：printenv、env | grep ARK、cat .env、cat backend/.env、echo $ARK_API_KEY、git add out/a.mp4
   應放行（返回 0）：uv run pytest、cat .env.example、printenv PATH、git add src/a.py
   測試樣例寫在腳本文件裡，不要直接在命令行執行這些命令
4. 提交並推送分支

（以下貼上「項目規則範本」一節的 8 段代碼，每段前加一行文件路徑；最後貼上「Claude Code 雲端環境設定」的 setup script，路徑為 scripts/cloud-setup.sh）
```

## P2 總體規格

```text
為 video-factory 寫第一版（公司內部工具）的總體規格，存成 docs/specs/00-overview.md。這一步只寫文件、不寫代碼；寫完提交推送並停下，等我確認。

背景：用火山方舟（或 BytePlus）的 API 自動生成影片。流水線：
選模板與輸入 → 大模型寫腳本與分鏡（JSON）→ 人工確認分鏡 → 可選 Seedream 關鍵幀
→ Seedance 按分鏡生成片段（非同步任務）→ TTS 配音或模型原生音頻 → 字幕
→ FFmpeg 合成（拼接、轉場、字幕、Logo、AI 生成標識）→ 審核 → 成片庫。

影片類型：行銷短影音（9:16，15～30 秒）、圖片或文字轉短片（單鏡頭、可批量）、
培訓講解片（16:9，1～3 分鐘，以旁白為主軸）。
使用者：內部員工約 [N] 人；角色為管理員、創作者、審核者。

規格要涵蓋：
- 數據模型：用戶、模板、任務、分鏡、素材、生成調用記錄、成本賬本、審核記錄、審計日誌
- 任務狀態機，每個狀態的進入條件與可重試點
- 後端 API 列表與前端頁面列表
- 成本控制：預估、單任務與每日預算、樣片模式
- 非功能需求：密鑰管理、限流、失敗重試、日誌、AI 生成內容標識、權限
- 後續階段劃分（對應本手冊 P3～P13）與每階段的交付物
- 驗收清單：三類影片各跑通一條
```

## P3 項目骨架

```text
/spec 按 docs/specs/00-overview.md 搭建項目骨架。所有依賴用當前最新穩定版：安裝前先用 uv 與 pnpm 查最新版本，裝好後把實際版本寫進 docs/adr/0001-tech-stack.md。不要用 beta、rc 或已停止維護的組件。

後端（backend/）
- Python 3.13（依 .python-version，用映像預裝的 /usr/bin/python3.13），uv 管理依賴並提交 uv.lock；開發依賴放 [dependency-groups]
- FastAPI + Pydantic v2 + pydantic-settings；SQLAlchemy 2.0 非同步模式 + psycopg 3；Alembic 遷移（含一個初始遷移）
- structlog 輸出 JSON 日誌，每個請求帶 request_id
- /healthz 只回存活狀態；/readyz 檢查 PostgreSQL、Valkey、對象存儲是否可用
- 啟動時載入 config/models.yaml 並用 Pydantic 校驗，格式錯誤就啟動失敗並指出是哪一欄
- 品質工具：ruff（lint 與格式化）、mypy（strict）、pytest（非同步測試用 anyio）

Worker
- Celery 5.6，broker 與結果後端用 Valkey（Redis 協議相容）
- 一個示範任務 ping，返回 pong；單元測試用 eager 模式

前端（frontend/）
- Node 24；package.json 寫 engines 與 packageManager（pnpm 精確版本）
- React 19 + TypeScript 7 + Vite 8 + Ant Design 6 + React Router 8 + TanStack Query
- i18n 用 react-i18next，預設繁體中文（zh-TW），Ant Design 語系同步切換
- 頁面：登入頁、空的任務列表頁
- Lint 與格式化用 Biome，型別檢查用 tsc --noEmit，單元測試用 Vitest；不用 ESLint（typescript-eslint 目前只支援到 TypeScript 6.0）

基礎設施
- compose.yaml（不寫 version 欄位）：api、worker、postgres:18、valkey:9、seaweedfs（S3 相容，開發用，啟動時自動建 bucket）；不要用 MinIO（社區版已改為只提供源碼，不再發布映像）
- 每個服務都有 healthcheck；api 與 worker 用 depends_on 的 service_healthy 等依賴就緒
- backend 的 Dockerfile 用 uv 官方的 Python 3.13 slim 映像，映像內安裝 ffmpeg，以非 root 用戶運行
- .env.example 只列變量名不填值

CI（.github/workflows/ci.yml，各 action 用當前最新主版本）
- backend：uv sync --locked、ruff check、ruff format --check、mypy、pytest
- frontend：pnpm install --frozen-lockfile、biome ci、tsc --noEmit、vitest run、vite build
- smoke：docker compose up -d --wait 後請求 /healthz 與 /readyz

驗收
- 在本會話 docker compose up -d --wait 後，/healthz 與 /readyz 都回 200
- CLAUDE.md 的檢查命令全部通過；按實際情況更新 CLAUDE.md 的運行與檢查命令
- 推送後 CI 三個 job 全綠；推送 workflow 文件被 GitHub 拒絕時告訴我，由我在 GitHub 網頁提交
- 更新 docs/CHANGELOG.md
```

## P4 模型網關與 Seedance 封裝

```text
/spec 實作 backend/app/providers 模型網關：
1. ArkBase：按 ARK_REGION 選擇 volcenginesdkarkruntime 或 byteplussdkarkruntime；
   超時、重試（只重試限流、超時、服務端錯誤）、按模型的令牌桶限速（讀 models.yaml 的 rpm 與 concurrency）。
   若 docs/env-check.md 記錄了「網關在代理注入模式下不能帶 Authorization 頭」，ARK_API_KEY 為 injected-by-proxy 時移除這個頭。
2. LLMProvider：chat(messages, schema) 返回校驗過的 Pydantic 物件，校驗失敗自動修復重試 2 次。
3. SeedreamProvider：generate(prompt, size, ref_images)，圖片存入對象存儲後返回內部 asset id。
4. SeedanceProvider：
   - create()：組裝 content（text、image_url 與 role）、ratio、duration、resolution、seed、
     generate_audio、return_last_frame、watermark、safety_identifier；role 取值與各參數範圍放進能力表，按模型校驗
   - poll()：指數退避 10→60 秒，總超時可配置，返回狀態與 error
   - 成功後立即下載 video_url 與 last_frame_url 到對象存儲
   - cancel()
5. TTSProvider：先定義接口，實作放到 P8。
6. 每次調用寫 cost_ledger（model、task_id、usage、估算金額）。
7. MockProvider：所有接口的假實現；樣例圖片與 3 秒樣例影片在測試時用 ffmpeg 即時生成，不提交二進制文件。
8. 單元測試：參數組裝、輪詢狀態轉換、重試判斷、預算超限、下載失敗重試。
9. live 冒煙測試（pytest -m live，預設跳過）：文生影片 5 秒、最低解析度、不生成音頻，下載後用 ffprobe 校驗。只寫好不執行，由我用 /live-smoke 觸發。
```

## P5 腳本與分鏡

```text
/spec 實作腳本與分鏡階段：
- 三種影片類型各一個提示詞模板（config/templates/，Jinja2），輸出符合 SceneList 的 JSON：
  每個分鏡含序號、旁白、畫面描述（給 Seedance 的提示詞）、鏡頭類型、運鏡、時長、是否需要首幀、屏幕文字
- 行銷短影音 3～6 個分鏡、總長 15～30 秒；培訓講解片按旁白字數估算時長
- 生成後進入 storyboard_ready，等待用戶在前端確認或修改；確認前不得調用 Seedance
- 成本預估：按分鏡數、時長與模型單價計算，顯示在確認頁
- 內容檢查：旁白與畫面描述出現真實人名、品牌、影視 IP 時標記警告
- 單元測試：用 mock 大模型返回的 JSON 跑通校驗與修復邏輯
```

## P6 素材庫與關鍵幀

```text
/spec 實作素材庫與關鍵幀：
- 素材庫：上傳品牌 Logo、商品圖、字體、背景音樂；按類型與標籤管理；校驗類型與大小並生成縮圖
- 對「需要首幀」的分鏡調用 SeedreamProvider；商品類分鏡可直接選素材庫的商品圖作首幀或參考圖
- 為 Seedance 生成對象存儲的預簽名 URL，有效期覆蓋排隊時間（可配置）
- 分鏡頁可預覽、替換、重新生成單張關鍵幀
- 雲端會話裡的 SeaweedFS 方舟拉不到，本階段測試一律用 MockProvider；圖生影片的真實聯調放到有公網對象存儲（TOS）的公司環境
```

## P7 分鏡影片生成

```text
/spec 實作分鏡影片生成：
- 每個分鏡一個 Celery 任務，調用 SeedanceProvider；同一任務的分鏡並行，受模型並發上限約束
- 鏡頭銜接：勾選「連續鏡頭」時，用上一段的 last_frame 作下一段首幀（此時改為串行）
- 一致性：同一任務共用 seed 與風格前綴，商品與角色用參考圖
- 樣片模式：模型支持 draft 參數時優先用官方樣片，否則用 video_draft 模型或較低解析度；用戶確認後再出正片
- 單分鏡重生成、取消、失敗原因展示（區分內容審核與系統錯誤）
- 進度用 SSE 推送到前端
```

## P8 配音、字幕與背景音樂

```text
/spec 實作配音、字幕與背景音樂：
- TTSProvider 接入豆包語音合成（TTS_APP_ID、TTS_TOKEN 從環境變量讀），按分鏡生成旁白並記錄時長
- 模板選擇模型原生音頻（generate_audio）時跳過 TTS，只做字幕
- 字幕：按旁白與音頻時長生成 SRT，中文每行不超過 16 字，按標點斷句
- 背景音樂從素材庫選，旁白出現時自動壓低
- 時長對齊：影片短於旁白時延長最後一幀或放慢，長於旁白時裁剪
- 單元測試：SRT 斷行與時間軸計算
```

## P9 FFmpeg 合成

```text
/spec 實作 backend/app/media 的 FFmpeg 合成：
- 所有片段統一解析度、幀率、像素格式，按順序拼接，支持淡入淡出轉場
- 燒錄字幕（用 assets/fonts/ 的思源黑體），疊加 Logo
- AI 生成標識：片頭 2 秒顯示「本影片由 AI 生成」，畫面角落常駐小字標識；
  元數據寫入內容編號、生成方式、平台名稱
- 音頻：混合旁白、原生音頻與背景音樂，響度標準化
- 輸出 H.264 + AAC 的 MP4 與一張封面圖
- FFmpeg 命令用構建器生成並寫單元測試；集成測試用 3 段 3 秒樣例影片（ffmpeg testsrc 即時生成）跑通
- 用 ffprobe 斷言輸出的解析度、時長、編碼與元數據標識
```

## P10 流水線編排與批量

```text
/spec 把各階段串成完整流水線：
- 狀態機：draft → scripting → storyboard_ready → generating → composing → in_review → approved 或 rejected，
  另有 failed、cancelled、budget_exceeded
- 每個步驟冪等、可從失敗點續跑；取消時同步取消未完成的 Seedance 任務
- 預算控制：單任務與每人每日上限，接近上限時提示
- 批量：上傳 CSV（每行一條任務的變量），按模板批量建立，限制同時運行數量
- 管理頁可看每個任務的調用記錄、耗時與成本
```

## P11 前端與 E2E

```text
/spec 完成前端（繁體中文界面）與端到端測試：
- 新建任務精靈：選模板 → 填主題、上傳或選素材 → 設畫幅、時長、音頻方式 → 提交
- 分鏡確認頁：逐條編輯旁白與畫面描述、替換首幀、看成本預估，確認後才開始生成
- 任務詳情：分鏡進度、單鏡頭預覽與重生成、成片預覽
- 成片庫：搜尋、篩選、下載（審核通過才可下載）
- 素材庫、模板管理（管理員）、審核台、用量與成本看板
- E2E 用 @playwright/test：雲端會話用預裝 Chromium（launchOptions.executablePath 讀環境變量 PW_CHROMIUM，預設 /opt/pw-browsers/chromium），不要執行 playwright install；CI 用 playwright install --with-deps chromium
```

## P11 補充：E2E 驗證會話

```text
用 docker compose 起全套，後端切到 MockProvider，再用 Playwright 走一遍「新建行銷短影音 → 確認分鏡 → 生成 → 成片預覽」。每步截圖存到 /tmp/e2e/，逐張查看後回報問題與修復建議，先不要改代碼。
```

## P12 權限、審核與審計

```text
/spec 實作權限、審核與審計：
- 角色：管理員（配置模型、模板、預算）、創作者（建任務）、審核者（審核成片）
- 審核清單：AI 標識存在、無未授權真人肖像、無第三方品牌或影視 IP、品牌規範、字幕錯字
- 審核通過才可下載；退回要填原因，可回到分鏡階段修改
- 審計日誌：登入、建任務、審核、下載、配置變更
- 帳號先用本地帳號密碼，預留飛書或企業微信 OAuth 接口
```

## P13 測試與部署

```text
/spec 準備上線（部署到公司服務器，不在 Claude Code 雲端運行）：
- 補齊 API、流水線、FFmpeg 構建器的測試與覆蓋率報告
- 安全：依賴漏洞掃描、密鑰掃描、上傳文件校驗、外部 URL 下載白名單
- Dockerfile：backend 與 worker 映像內安裝 ffmpeg 與字體；前端構建成靜態文件由 Nginx 提供
- compose.prod.yaml：資源限制、日誌輪轉、數據卷、健康檢查
- docs/runbook.md：部署、配置、備份恢復、更換模型版本、常見錯誤處理，以及新同事如何按 scripts/cloud-setup.sh 建立 Claude Code 雲端環境
- 更新 CLAUDE.md 與 docs/CHANGELOG.md
```

## 日常維護常用提示詞

```text
# 換模型版本（先切到 Plan 模式）
把 video_final 換成 <新 Seedance 模型 ID>：更新 models.yaml，對照文檔檢查新模型的解析度、時長、音頻參數差異，登記到能力表。完成後我會用 /live-smoke 驗證。

# 排查失敗任務（先切到 Plan 模式）
任務 <id> 失敗了，日誌如下：<貼上日誌，先刪掉密鑰與帶簽名的 URL>。判斷是內容審核、限流、超時還是代碼錯誤，先給修復方案，不要改代碼。

# 新增模板
/spec 新增影片模板「<名稱>」：<畫幅、時長、鏡頭數、音頻方式>。只改 config/templates/ 與必要的前端選項，補對應測試。

# 每週依賴更新（在 claude.ai/code/routines 建成每週一次的排程，環境選 video-factory-dev）
檢查 backend 與 frontend 依賴的新版本：補丁與次版本直接升級，跑 CLAUDE.md 的全部檢查，通過就開 PR；主版本升級只在 PR 描述裡列出清單與影響，不要升級。
```
