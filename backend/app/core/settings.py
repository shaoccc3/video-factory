"""環境變量設定。密鑰只從環境讀取，不寫進代碼或日誌。"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # 區域與模型
    ark_region: Literal["volcengine", "byteplus"] = "byteplus"
    ark_api_key: SecretStr | None = None
    # mock：全部用 MockProvider（開發、測試、E2E）；live：調用真實 API（會計費）
    provider_mode: Literal["mock", "live"] = "mock"
    # 代理注入密鑰（Claude Code 雲端 API credentials）時，佔位密鑰不發 Authorization 頭
    ark_strip_auth_header: bool = False
    model_watermark: bool = True  # 模型輸出是否帶水印（watermark 參數）
    models_config_path: Path = REPO_ROOT / "config" / "models.yaml"
    templates_dir: Path = REPO_ROOT / "config" / "templates"
    content_blocklist_path: Path = REPO_ROOT / "config" / "content_blocklist.yaml"
    fonts_dir: Path = REPO_ROOT / "assets" / "fonts"
    font_family: str = "Noto Sans CJK TC"
    font_file: str = "NotoSansCJKtc-Regular.otf"

    # TTS（豆包語音）
    tts_app_id: SecretStr | None = None
    tts_token: SecretStr | None = None
    tts_cluster: str = "volcano_tts"
    tts_endpoint: str = "https://openspeech.bytedance.com/api/v1/tts"

    # 基礎設施
    database_url: str = "postgresql+psycopg://video_factory:video_factory@localhost:5432/video_factory"
    valkey_url: str = "redis://localhost:6379/0"
    celery_broker_url: str | None = None  # 預設用 valkey_url
    celery_result_backend: str | None = None

    storage_backend: Literal["s3", "local"] = "s3"
    local_storage_dir: Path = Path("/tmp/video-factory-storage")  # noqa: S108 - 僅開發用，生產設 LOCAL_STORAGE_DIR 或用 s3
    s3_endpoint_url: str | None = "http://localhost:8333"
    s3_public_endpoint_url: str | None = None  # 預簽名 URL 用的公網地址（給 Seedance 拉素材）
    s3_region: str = "us-east-1"
    s3_bucket: str = "video-factory"
    s3_access_key: SecretStr | None = None
    s3_secret_key: SecretStr | None = None
    presign_expires_s: int = 6 * 3600  # 覆蓋排隊時間

    # 生成任務
    seedance_poll_initial_s: float = 10.0
    seedance_poll_max_s: float = 60.0
    seedance_total_timeout_s: float = 30 * 60
    provider_max_attempts: int = 4
    provider_retry_base_s: float = 2.0
    download_allowed_hosts: tuple[str, ...] = (
        "*.volces.com",
        "*.bytepluses.com",
        "*.byteimg.com",
        "*.bytecdn.cn",
        "*.volccdn.com",
        "*.byteplusapi.com",
    )
    download_max_bytes: int = 500 * 1024 * 1024
    work_dir: Path = Path("/tmp/video-factory-work")  # noqa: S108 - worker 臨時工作目錄，可用 WORK_DIR 覆蓋

    # 上傳
    upload_max_image_bytes: int = 20 * 1024 * 1024
    upload_max_audio_bytes: int = 50 * 1024 * 1024
    upload_max_font_bytes: int = 40 * 1024 * 1024
    upload_max_csv_bytes: int = 2 * 1024 * 1024
    batch_max_items: int = 200

    # 認證
    secret_key: SecretStr = SecretStr("dev-only-change-me")
    session_max_age_s: int = 7 * 24 * 3600
    cookie_secure: bool = False

    # 其他
    platform_name: str = "video-factory"
    log_level: str = "INFO"
    log_json: bool = True
    readiness_timeout_s: float = 3.0

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.valkey_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.valkey_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
