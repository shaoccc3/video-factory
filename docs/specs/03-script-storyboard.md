# 03 腳本與分鏡（P5）

狀態：已實作　日期：2026-09-23

- 模板：`config/templates/*.yaml`（元數據）+ `*.j2`（Jinja2 沙箱渲染）；`python -m app.cli sync-templates` 同步到數據庫，已存在的只在 `--force` 時覆蓋。
- 大模型輸出 `SceneList`（序號隱含於順序；旁白、畫面描述、景別、運鏡、時長、是否需要首幀、畫面標語），Pydantic 校驗；JSON 不合法時 LLMProvider 自動修復重試 2 次。
- 規則檢查（鏡頭數、總時長、單鏡頭時長範圍）不通過時，把問題回饋給大模型最多再修 2 輪；仍不合規則強制調整（截斷、夾緊、按比例縮放）。
- 培訓片按旁白字數估時長（約每秒 4.5 字）；quick 類型跳過大模型，直接由輸入生成單鏡頭，並自動確認。
- 生成後進入 `storyboard_ready`；**確認前不調用 Seedance**。確認頁顯示成本預估（關鍵幀、分鏡影片、樣片模式下的正片、TTS），超預算時確認返回 409。
- 內容檢查：`config/content_blocklist.yaml`（真人／明星、第三方品牌、影視 IP 樣例詞表），命中時寫入任務 `warnings`，不阻擋。

驗收：`tests/test_pipeline.py`（修正輪、強制調整、內容警告、三類影片流程）、`tests/test_api.py`（分鏡編輯與確認）。
