"""內容檢查：旁白與畫面描述出現真實人名、第三方品牌、影視 IP 時給出警告。"""

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import yaml


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    words: tuple[str, ...]


@lru_cache
def load_blocklist(path: Path) -> tuple[Category, ...]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return tuple(
        Category(key=key, label=str(value["label"]), words=tuple(str(w) for w in value["words"]))
        for key, value in data.items()
    )


def check_texts(texts: list[tuple[str, str]], blocklist: tuple[Category, ...]) -> list[str]:
    """texts：（位置描述, 文字）。返回去重後的警告。"""
    warnings: list[str] = []
    for where, text in texts:
        low = text.lower()
        for cat in blocklist:
            hits = [w for w in cat.words if w.lower() in low]
            if hits:
                msg = f"{where}可能包含{cat.label}：{'、'.join(sorted(set(hits)))}"
                if msg not in warnings:
                    warnings.append(msg)
    return warnings
