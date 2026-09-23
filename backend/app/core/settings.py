"""環境變量設定。密鑰只從環境讀取，不寫進代碼或日誌。"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    ark_region: Literal["volcengine", "byteplus"] = "byteplus"
    models_config_path: Path = REPO_ROOT / "config" / "models.yaml"

    database_url: str = (
        "postgresql+psycopg://video_factory:video_factory@localhost:5432/video_factory"
    )
    valkey_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str | None = "http://localhost:8333"
    s3_region: str = "us-east-1"
    s3_bucket: str = "video-factory"
    s3_access_key: SecretStr | None = None
    s3_secret_key: SecretStr | None = None

    log_level: str = "INFO"
    log_json: bool = True
    readiness_timeout_s: float = 3.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
