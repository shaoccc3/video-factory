"""成本估算與計價。單價與幣種來自 models.yaml。"""

import math

from app.core.models_config import ModelKey, ModelsConfig, Region, VideoCapabilities

# 中文旁白語速（字／秒），用於從旁白估時長
CHARS_PER_SECOND = 4.5


def video_tokens(width: int, height: int, fps: int, duration_s: float) -> int:
    """Seedance 的 token 用量約為 寬 × 高 × 幀率 × 時長 / 1024。"""
    return math.ceil(width * height * fps * duration_s / 1024)


def video_tokens_for(caps: VideoCapabilities, resolution: str, ratio: str, duration_s: float) -> int:
    """按模型的官方寬高表估算 token（實際以任務返回的 usage.completion_tokens 為準）。"""
    width, height = caps.dimensions_for(resolution, ratio)
    return video_tokens(width, height, caps.fps, duration_s)


def video_unit_price(cfg: ModelsConfig, key: ModelKey, resolution: str, *, audio: bool = False) -> float:
    """影片單價（每百萬 token）：按解析度覆蓋 → 有聲單價（若有配置）→ price_per_mtok。"""
    entry = cfg.models.get(key)
    by_resolution = entry.price_per_mtok_by_resolution or {}
    if resolution in by_resolution:
        return by_resolution[resolution]
    if audio and entry.price_per_mtok_audio is not None:
        return entry.price_per_mtok_audio
    return entry.price_per_mtok or 0.0


def video_cost(
    cfg: ModelsConfig, key: ModelKey, tokens: int, region: Region, *, resolution: str, audio: bool = False
) -> tuple[float, float]:
    """返回（原幣金額、CNY 金額）。"""
    amount = tokens / 1_000_000 * video_unit_price(cfg, key, resolution, audio=audio)
    return amount, cfg.to_cny(amount, region)


def llm_unit_prices(cfg: ModelsConfig) -> tuple[float, float]:
    """大模型（輸入、輸出）每百萬 token 單價；未分價時兩者都用 price_per_mtok。"""
    entry = cfg.models.script_llm
    if entry.price_per_mtok_input is not None and entry.price_per_mtok_output is not None:
        return entry.price_per_mtok_input, entry.price_per_mtok_output
    price = entry.price_per_mtok or 0.0
    return price, price


def llm_cost(
    cfg: ModelsConfig, prompt_tokens: int, completion_tokens: int, region: Region
) -> tuple[float, float]:
    """返回（原幣金額、CNY 金額）。輸出 token 含思維鏈。"""
    price_in, price_out = llm_unit_prices(cfg)
    amount = (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000
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
