---
name: spec
description: 規格先行：先寫 docs/specs/ 的規格與驗收清單，等使用者確認後再實作。只由使用者用 /spec 觸發。
disable-model-invocation: true
argument-hint: [需求描述]
---

需求如下：

$ARGUMENTS

## 第一階段：只寫規格，不改代碼
1. 讀 CLAUDE.md、.claude/rules/project.md、docs/specs/ 的既有規格與相關代碼
2. 新建 docs/specs/NN-<英文短名>.md（NN 接續現有最大編號），包含：
   - 目標、範圍、不做的事
   - 設計：數據模型、接口、狀態變化、錯誤處理、配置項
   - 任務清單（- [ ]，每項可獨立提交）
   - 驗收清單（- [ ]，每項寫可執行的命令與預期結果）
   - 風險與待確認問題
3. 提交並推送，回覆規格摘要與待確認問題，然後停下，等我回覆「確認」或修改意見

## 第二階段：我確認後才開始
- 按任務清單逐項實作，每完成一項就勾選並提交
- 跑 CLAUDE.md 的全部檢查，失敗就修到通過
- 更新 docs/CHANGELOG.md，最後逐條回報驗收清單結果（通過／未通過與原因）
