from pathlib import Path

import pytest

from app.core.models_config import ModelsConfigError, load_models_config
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
        create_app(Settings(models_config_path=path, log_json=False))
