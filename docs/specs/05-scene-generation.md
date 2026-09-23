# 05 分鏡影片生成（P7）

狀態：已實作　日期：2026-09-23

- 每個分鏡一個 Celery 任務（`video_factory.scene`）；並行數受模型 `concurrency` 與 `rpm` 限制（跨 worker 用 Valkey 計數）。
- 連續鏡頭：一次只派發下一個分鏡，用上一段 `last_frame` 作首幀。
- 一致性：同一任務共用 seed 與模板風格前綴；商品圖作參考圖。
- 樣片模式：用 `video_draft` 模型、能力表允許時傳 `draft=true`、最低解析度；成片 `in_review`（phase=draft）後「出正片」用 `video_final` 全部重做。
- 單分鏡重做（影片或關鍵幀）、取消（刪除遠端任務）、失敗原因區分內容審核與系統錯誤。
- 續跑：已建立的遠端任務 id 存在分鏡上，續跑時沿用，不重複計費。
- 進度：`GET /jobs/{id}/events`（SSE，1.5 秒輪詢數據庫，有變化才推送）。
