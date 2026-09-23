#!/usr/bin/env python3
"""準備字幕字體：從 Noto Sans CJK 字體集（SIL OFL 1.1）抽出繁中字面到 assets/fonts/。

字體文件較大（約 16 MB），不提交到 Git；Dockerfile、CI、雲端 setup script 會執行本腳本。
來源：Debian/Ubuntu 套件 fonts-noto-cjk（/usr/share/fonts/opentype/noto/）。
用法：uv run --with fonttools python scripts/fetch_fonts.py [--src DIR] [--dest DIR]
"""

import argparse
import sys
from pathlib import Path

from fontTools.ttLib import TTCollection

FACES = {
    "NotoSansCJK-Regular.ttc": "NotoSansCJKtc-Regular.otf",
    "NotoSansCJK-Bold.ttc": "NotoSansCJKtc-Bold.otf",
}
FAMILY = "Noto Sans CJK TC"


def family_name(font) -> str:  # type: ignore[no-untyped-def]
    name = font["name"].getName(1, 3, 1, 0x409) or font["name"].getName(1, 1, 0, 0)
    return str(name) if name else ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=Path, default=Path("/usr/share/fonts/opentype/noto"))
    parser.add_argument("--dest", type=Path, default=Path(__file__).resolve().parents[1] / "assets" / "fonts")
    args = parser.parse_args()
    args.dest.mkdir(parents=True, exist_ok=True)
    for src_name, dest_name in FACES.items():
        dest = args.dest / dest_name
        if dest.exists():
            print(f"已存在：{dest}")
            continue
        src = args.src / src_name
        if not src.exists():
            print(f"找不到 {src}，請先安裝 fonts-noto-cjk", file=sys.stderr)
            return 1
        collection = TTCollection(str(src))
        for font in collection.fonts:
            if family_name(font) == FAMILY:
                font.save(str(dest))
                print(f"已生成：{dest}")
                break
        else:
            print(f"{src} 裡沒有 {FAMILY}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
