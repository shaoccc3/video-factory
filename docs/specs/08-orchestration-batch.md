# 08 流水線編排與批量（P10）

狀態：已實作　日期：2026-09-23

- 狀態機：draft → scripting → storyboard_ready → generating → composing → in_review → approved／rejected，另有 failed、cancelled、budget_exceeded（轉換表見 `app/pipeline/state.py`）。
- 事件驅動：每個步驟結束調用 `advance()`；狀態轉換與分鏡認領都用條件更新（`WHERE status IN ...`），並發時只成功一次。
- 冪等與續跑：已成功的分鏡不重做；`resume` 按情況回到腳本、分鏡或合成。
- 取消：任務與排隊中的分鏡標記 cancelled，刪除遠端 Seedance 任務；輪詢中的分鏡發現任務已取消會自行停止。
- 預算：每次調用前檢查單任務與每人每日上限（賬本實際金額 + 本次預估），超限時任務 `budget_exceeded`；管理員可在管理頁調整預算後續跑。預估達 80% 時提示。
- 批量：CSV（`title,topic,extra`）或多張圖片（每張一個 quick 任務），按 `max_parallel` 提交；非 quick 類型停在分鏡確認。
- 管理頁可看每個任務的調用記錄、耗時與成本（`GET /jobs/{id}/calls`）。
