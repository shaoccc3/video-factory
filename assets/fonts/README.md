# 字體

字幕與疊字只用本目錄下的可商用字體。

- 思源黑體繁中（Noto Sans CJK TC，Regular／Bold），授權 SIL Open Font License 1.1，可商用、可隨軟體分發。
- 字體文件約 16 MB，不提交到 Git，由 `scripts/fetch_fonts.py` 從 `fonts-noto-cjk` 套件抽取生成：
  `cd backend && uv run --with fonttools python ../scripts/fetch_fonts.py`
- Dockerfile、CI、雲端 setup script 都會執行這一步。
