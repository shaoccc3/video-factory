# 07 FFmpeg 合成（P9）

狀態：已實作　日期：2026-09-23

- 構建器（`app/media/compose.py`）全是純函數，單元測試斷言濾鏡圖；`run_compose` 依次執行。
- 片段統一解析度（等比縮放 + 補黑邊）、30 fps、yuv420p；相鄰片段 0.5 秒淡入淡出（xfade）。
- 片頭 2 秒：標題 +「本影片由 AI 生成」；畫面左下角常駐「AI 生成」；右上角 Logo。
- 字幕用 libass 燒錄，字體 `assets/fonts/NotoSansCJKtc-Regular.otf`（思源黑體繁中，SIL OFL）。
- 音頻：旁白、原生音頻、背景音樂混音，loudnorm -14 LUFS；輸出 H.264 + AAC MP4（faststart）與封面 JPG。
- 隱式標識：mp4 元數據 `aigc_label`、`aigc_producer`、`aigc_content_id`（任務 id）、`aigc_method`、`comment`；合成後用 ffprobe 校驗，缺少標識或編碼不符則任務失敗。
- 集成測試：3 段 3 秒 testsrc 樣例影片即時生成，斷言解析度、時長、編碼、幀率、元數據。
