"""規格 13：官方價格與寬高表的計價。"""

import math

import pytest

from app.core.models_config import load_models_config
from app.core.settings import REPO_ROOT
from app.providers.pricing import llm_cost, video_cost, video_tokens_for, video_unit_price

CONFIG = load_models_config(REPO_ROOT / "config" / "models.yaml")


def test_pricing_seedance_2_5_marketing_estimate() -> None:
    caps = CONFIG.video_caps("video_long")
    tokens = video_tokens_for(caps, "720p", "9:16", 30)
    assert tokens == 648_000
    amount, cny = video_cost(CONFIG, "video_long", tokens, "byteplus", resolution="720p", audio=True)
    assert amount == pytest.approx(648_000 / 1e6 * 10.70)
    assert cny == pytest.approx(49.2, abs=0.05)


def test_pricing_by_resolution() -> None:
    assert video_unit_price(CONFIG, "video_final", "1080p") == 7.7
    assert video_unit_price(CONFIG, "video_final", "720p") == 7.0
    assert video_unit_price(CONFIG, "video_final", "480p", audio=True) == 7.0  # 2.x 有聲無聲同價
    assert video_unit_price(CONFIG, "video_long", "1080p") == 11.7
    assert video_unit_price(CONFIG, "video_draft", "480p") == 5.6


def test_pricing_uses_official_dimensions() -> None:
    caps = CONFIG.video_caps("video_final")
    assert video_tokens_for(caps, "720p", "1:1", 10) == 960 * 960 * 24 * 10 // 1024
    assert video_tokens_for(caps, "480p", "16:9", 5) == 864 * 496 * 24 * 5 // 1024
    # 2.5 的 480p 16:9 與 2.0 不同
    assert video_tokens_for(CONFIG.video_caps("video_long"), "480p", "16:9", 5) == math.ceil(
        854 * 480 * 24 * 5 / 1024
    )


def test_pricing_llm_input_output() -> None:
    amount, cny = llm_cost(CONFIG, 10_000, 3_000, "byteplus")
    assert amount == pytest.approx(0.0085)
    assert cny == pytest.approx(0.0085 * 7.1)
