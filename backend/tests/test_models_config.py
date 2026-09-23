from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.models_config import ModelEntry, ModelsConfigError, VideoCapabilities, load_models_config
from app.core.settings import REPO_ROOT, Settings
from app.main import create_app

REPO_CONFIG = REPO_ROOT / "config" / "models.yaml"


def test_repo_config_is_valid() -> None:
    cfg = load_models_config(REPO_CONFIG)
    assert cfg.region in ("volcengine", "byteplus")
    assert cfg.models.video_final.concurrency is not None
    assert set(cfg.base_url) == {"volcengine", "byteplus"}


def test_missing_field_names_the_path(tmp_path: Path) -> None:
    text = REPO_CONFIG.read_text(encoding="utf-8").replace("per_job_cny: 50", "")
    path = tmp_path / "models.yaml"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ModelsConfigError, match=r"budget\.per_job_cny"):
        load_models_config(path)


def test_invalid_region(tmp_path: Path) -> None:
    text = REPO_CONFIG.read_text(encoding="utf-8").replace("region: byteplus", "region: mars")
    path = tmp_path / "models.yaml"
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ModelsConfigError, match=r"region"):
        load_models_config(path)


def test_invalid_yaml(tmp_path: Path) -> None:
    path = tmp_path / "models.yaml"
    path.write_text("region: [unclosed", encoding="utf-8")
    with pytest.raises(ModelsConfigError, match="YAML"):
        load_models_config(path)


def test_app_refuses_to_start_with_bad_config(tmp_path: Path) -> None:
    path = tmp_path / "models.yaml"
    path.write_text("region: byteplus\n", encoding="utf-8")
    with pytest.raises(ModelsConfigError, match=r"models"):
        create_app(
            Settings(
                models_config_path=path, log_json=False, storage_backend="local", local_storage_dir=tmp_path
            )
        )


# ---- 規格 13：官方寬高表、分價欄位 -------------------------------------------

_CAPS = {
    "resolutions": ["480p", "720p"],
    "ratios": ["16:9", "1:1"],
    "min_duration_s": 4,
    "max_duration_s": 15,
    "fps": 24,
}


def test_dimensions_table_and_fallback() -> None:
    caps = VideoCapabilities.model_validate(
        {
            **_CAPS,
            "dimensions": {
                "480p": {"16:9": "864x496", "1:1": "640x640"},
                "720p": {"16:9": "1280x720", "1:1": "960x960"},
            },
        }
    )
    assert caps.dimensions_for("720p", "1:1") == (960, 960)
    assert caps.dimensions_for("480p", "16:9") == (864, 496)
    # 沒有表時按短邊推算
    assert VideoCapabilities.model_validate(_CAPS).dimensions_for("720p", "1:1") == (720, 720)


def test_dimensions_must_cover_every_ratio() -> None:
    with pytest.raises(ValidationError, match=r"dimensions 缺少 720p"):
        VideoCapabilities.model_validate(
            {
                **_CAPS,
                "dimensions": {"480p": {"16:9": "864x496", "1:1": "640x640"}, "720p": {"16:9": "1280x720"}},
            }
        )


def test_dimensions_size_format() -> None:
    table = {"16:9": "864*496", "1:1": "640x640"}
    with pytest.raises(ValidationError, match="寬x高"):
        VideoCapabilities.model_validate({**_CAPS, "dimensions": {"480p": table, "720p": table}})


def test_price_by_resolution_must_be_supported() -> None:
    with pytest.raises(ValidationError, match=r"未支援的解析度"):
        ModelEntry.model_validate(
            {
                "id": "m",
                "price_per_mtok": 7.0,
                "price_per_mtok_by_resolution": {"1080p": 7.7},
                "capabilities": _CAPS,
            }
        )


def test_llm_prices_come_in_pairs() -> None:
    with pytest.raises(ValidationError, match="要一起填"):
        ModelEntry.model_validate({"id": "m", "price_per_mtok_input": 0.25})


def test_image_sizes_format() -> None:
    with pytest.raises(ValidationError, match="寬x高"):
        ModelEntry.model_validate({"id": "m", "price_per_image": 0.035, "image_sizes": {"9:16": "big"}})
