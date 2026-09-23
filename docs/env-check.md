# 環境檢查報告（P0）

檢查日期：2026-09-23。檢查環境：本會話所在的 Claude Code 雲端環境（**不是**手冊要求的 `video-factory-dev` 環境——Node 未升級到 24、無 ARK_API_KEY、網絡未放行方舟）。

## 工具版本

| 工具 | 版本 / 結果 | 期望 | 是否符合 |
|---|---|---|---|
| python3.13 | Python 3.13.12（/usr/bin/python3.13） | 3.13 | ✅ |
| uv | 0.8.17；`uv python find 3.13` → /usr/bin/python3.13 | 找得到 3.13 | ✅ |
| node | v22.22.2 | v24.x | ❌ setup script 未在本環境執行 |
| pnpm | 10.33.0 | 有 | ✅ |
| ffmpeg | 系統未安裝（僅 /opt/pw-browsers/ffmpeg-1011，為 Playwright 專用精簡版） | 系統 ffmpeg | ❌ 與手冊「映像已預裝」不符 |
| docker | 29.3.1；Docker Compose v5.1.1 | 有 | ✅ |
| /opt/pw-browsers | chromium、chromium-1194、chromium_headless_shell-1194、ffmpeg-1011 | 有 Chromium | ✅ |

## Docker

`dockerd` 可在背景啟動，`docker info` 成功。`docker pull valkey/valkey:9` **失敗**：映像層從 `production.cloudfront.docker.com` 下載時被代理拒絕（Forbidden）。本環境無法拉映像，`docker compose up` 不可用。

## 連通性（scripts/check_connectivity.py）

| 項目 | 地址 | 狀態碼 | 判讀 |
|---|---|---|---|
| volcengine A 無 Authorization | ark.cn-beijing.volces.com | ERR | 被雲端網絡白名單攔截（CONNECT 被拒） |
| volcengine B 帶 Authorization | 同上 | SKIP | ARK_API_KEY 不存在 |
| byteplus A 無 Authorization | ark.ap-southeast.bytepluses.com | ERR | 被雲端網絡白名單攔截（CONNECT 被拒） |
| byteplus B 帶 Authorization | 同上 | SKIP | ARK_API_KEY 不存在 |
| 對照組 | pypi.org | 200 | 可達 |
| 對照組 | registry.npmjs.org | 200 | 可達 |
| 對照組 | github.com | 400 | 可達 |

備註：Python 3.13 預設開啟 `VERIFY_X509_STRICT`，雲端代理的 CA 證書不符合，腳本只關掉此旗標（仍驗證證書）。後端代碼若經代理訪問外網也需同樣處理，或改用代理提供的 CA bundle。

## 結論

- **哪個區域能在雲端直接聯調**：目前兩個都不能。預設區域定為 **byteplus（國際版）**。
- **密鑰來源**：A、B 都未連到方舟，無法判斷。環境中沒有 ARK_API_KEY。
- **Allowed domains 要加**：建立 `video-factory-dev` 環境，Network access 選 Custom、勾選默認清單，加入：
  - `*.bytepluses.com`（國際版，預設）
  - `*.volces.com`（國內版，備用）
  - `openspeech.bytedance.com`（豆包語音；國際版 TTS 按實際域名補充）
  - Docker 映像層：`production.cloudfront.docker.com`（本次被攔截，否則 compose 無法拉映像）
- **Docker 能否跑 compose**：dockerd 可用，但映像拉不下來，目前**不能**。修好白名單並讓 setup script 預拉映像後重跑 P0。
- **其他**：setup script（scripts/cloud-setup.sh）需要貼進環境設定，才能裝上 Node 24；系統 ffmpeg 需另裝（建議在 setup script 加 `apt-get install -y ffmpeg`，或 P3 起在 Docker 映像內使用）。

在 `video-factory-dev` 環境建好後，重跑 `python3.13 scripts/check_connectivity.py` 並更新本文件。
