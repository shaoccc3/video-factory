"""成本估算與計價。單價與幣種來自 models.yaml。"""

import math

from app.core.models_config import ModelKey, ModelsConfig, Region

# 中文旁白語速（字／秒），用於從旁白估時長
CHARS_PER_SECOND = 4.5


def video_tokens(width: int, height: int, fps: int, duration_s: float) -> int:
    """Seedance 的 token 用量約為 寬 × 高 × 幀率 × 時長 / 1024。"""
    return math.ceil(width * height * fps * duration_s / 1024)


def cost_per_mtok(cfg: ModelsConfig, key: ModelKey, tokens: int, region: Region) -> tuple[float, float]:
    """返回（原幣金額、CNY 金額）。"""
    price = cfg.models.get(key).price_per_mtok or 0.0
    amount = tokens / 1_000_000 * price
    return amount, cfg.to_cny(amount, region)


def cost_per_image(cfg: ModelsConfig, images: int, region: Region) -> tuple[float, float]:
    price = cfg.models.keyframe.price_per_image or 0.0
    amount = images * price
    return amount, cfg.to_cny(amount, region)


def cost_per_kchar(cfg: ModelsConfig, chars: int, region: Region) -> tuple[float, float]:
    price = cfg.models.tts.price_per_kchar or 0.0
    amount = chars / 1000 * price
    return amount, cfg.to_cny(amount, region)


def narration_seconds(text: str) -> float:
    chars = sum(1 for ch in text if not ch.isspace())
    return chars / CHARS_PER_SECOND
