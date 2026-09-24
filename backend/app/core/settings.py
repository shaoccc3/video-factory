"""環境變量設定。密鑰只從環境讀取，不寫進代碼或日誌。"""

import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
DEV_SECRET_KEY = "dev-only-change-me"  # noqa: S105 - 僅開發預設值，正式環境啟動時會拒絕
# 下載白名單的一項：完整域名（至少兩段、頂級域以字母開頭，排除 IP 與 localhost），可帶開頭的「*.」
_ALLOWED_HOST = re.compile(
    r"(\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?", re.IGNORECASE
)
# 會解析到內網、本機或任意 IP 的名稱（內部域、通配 DNS 服務），不能出現在白名單
_INTERNAL_SUFFIXES = (
    "localhost",
    "local",
    "internal",
    "localdomain",
    "home.arpa",
    "nip.io",
    "sslip.io",
    "xip.io",
    "localtest.me",
    "lvh.me",
)
# 任何人都能註冊子域名的常見公共後綴，不能用「*.」整個放行（只擋常見的，不是完整的公共後綴清單）
_PUBLIC_SUFFIXES = frozenset(
    {
        "com.cn",
        "net.cn",
        "org.cn",
        "com.hk",
        "com.tw",
        "com.sg",
        "com.au",
        "co.uk",
        "co.jp",
        "amazonaws.com",
        "s3.amazonaws.com",
        "cloudfront.net",
        "aliyuncs.com",
        "myqcloud.com",
        "github.io",
        "githubusercontent.com",
        "azurewebsites.net",
        "blob.core.windows.net",
        "herokuapp.com",
        "appspot.com",
        "vercel.app",
        "netlify.app",
        "pages.dev",
        "workers.dev",
    }
)


def _bad_allowed_host(host: str) -> bool:
    if not _ALLOWED_HOST.fullmatch(host):
        return True
    domain = host.lower().removeprefix("*.")
    if "localhost" in domain.split(".") or any(
        domain == suffix or domain.endswith("." + suffix) for suffix in _INTERNAL_SUFFIXES
    ):
        return True
    return host.startswith("*.") and domain in _PUBLIC_SUFFIXES


class Settings(BaseSettings):
    # 空字串視同未設定：compose 以 ${VAR:-} 轉發選填變量，沒填時沿用這裡的預設值
    model_config = SettingsConfigDict(extra="ignore", env_ignore_empty=True)

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
    presign_expires_s: int = Field(
        default=6 * 3600, gt=0, le=7 * 24 * 3600
    )  # 覆蓋排隊時間；S3 預簽名最長 7 天

    # 生成任務
    seedance_poll_initial_s: float = 10.0
    seedance_poll_max_s: float = 60.0
    seedance_total_timeout_s: float = Field(default=30 * 60, gt=0)
    provider_max_attempts: int = 4
    provider_retry_base_s: float = 2.0
    # 可用 DOWNLOAD_ALLOWED_HOSTS（JSON 陣列）整個取代；不能是空清單
    download_allowed_hosts: tuple[str, ...] = Field(
        min_length=1,
        default=(
            "*.volces.com",
            "*.bytepluses.com",
            "*.byteimg.com",
            "*.bytecdn.cn",
            "*.volccdn.com",
            "*.byteplusapi.com",
        ),
    )
    download_max_bytes: int = Field(default=500 * 1024 * 1024, gt=0)
    work_dir: Path = Path("/tmp/video-factory-work")  # noqa: S108 - worker 臨時工作目錄，可用 WORK_DIR 覆蓋

    # 上傳
    upload_max_image_bytes: int = 20 * 1024 * 1024
    upload_max_audio_bytes: int = 50 * 1024 * 1024
    upload_max_font_bytes: int = 40 * 1024 * 1024
    upload_max_csv_bytes: int = 2 * 1024 * 1024
    batch_max_items: int = 200

    # 認證
    secret_key: SecretStr = SecretStr(DEV_SECRET_KEY)
    session_max_age_s: int = 7 * 24 * 3600
    cookie_secure: bool = False

    # 其他
    platform_name: str = "video-factory"
    log_level: str = "INFO"
    log_json: bool = True
    readiness_timeout_s: float = 3.0

    @field_validator("download_allowed_hosts")
    @classmethod
    def _check_allowed_hosts(cls, hosts: tuple[str, ...]) -> tuple[str, ...]:
        """防 SSRF：拒絕「*」「*.com」「*.co.uk」、IP、localhost、內部域與通配 DNS 等會讓白名單形同虛設的寫法。"""
        bad = [h for h in hosts if _bad_allowed_host(h)]
        if bad:
            raise ValueError(f"只接受域名或 *.域名（至少兩段）：{', '.join(bad)}")
        return hosts

    @property
    def broker_url(self) -> str:
        return self.celery_broker_url or self.valkey_url

    @property
    def result_backend(self) -> str:
        return self.celery_result_backend or self.valkey_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
