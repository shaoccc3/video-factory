"""按 PROVIDER_MODE 組裝 Provider。"""

import structlog

from app.core.models_config import ModelsConfig, VideoCapabilities, VideoModelKey
from app.core.settings import Settings
from app.providers.ark import ArkHttp
from app.providers.base import Providers
from app.providers.live import ArkLLM, ArkSeedance, ArkSeedream, DoubaoTTS
from app.providers.mock import MockLLM, MockSeedance, MockSeedream, MockTTS


class ProviderConfigError(RuntimeError):
    pass


def build_mock_providers(config: ModelsConfig | None = None) -> Providers:
    caps: dict[str, VideoCapabilities] = {}
    if config is not None:
        keys: tuple[VideoModelKey, ...] = ("video_draft", "video_final", "video_long")
        for key in keys:
            if config.models.has(key):
                caps[config.models.get(key).id] = config.video_caps(key)
    return Providers(
        mode="mock",
        llm=MockLLM(),
        seedream=MockSeedream(),
        seedance=MockSeedance(caps_by_model=caps),
        tts=MockTTS(),
    )


def build_live_providers(settings: Settings, config: ModelsConfig) -> Providers:
    if not settings.ark_api_key:
        raise ProviderConfigError("PROVIDER_MODE=live 需要設定 ARK_API_KEY")
    http = ArkHttp(
        config.base_url[settings.ark_region],
        settings.ark_api_key.get_secret_value(),
        strip_auth_header=settings.ark_strip_auth_header,
    )
    allowed, max_bytes = settings.download_allowed_hosts, settings.download_max_bytes
    if not (settings.tts_app_id and settings.tts_token):
        structlog.get_logger(__name__).warning(
            "tts_not_configured", detail="未設定 TTS_APP_ID／TTS_TOKEN，旁白將使用 Mock 提示音"
        )
    tts = (
        DoubaoTTS(
            endpoint=settings.tts_endpoint,
            app_id=settings.tts_app_id.get_secret_value(),
            token=settings.tts_token.get_secret_value(),
            cluster=settings.tts_cluster,
        )
        if settings.tts_app_id and settings.tts_token
        else MockTTS()  # 未配置 TTS 時退回 Mock（旁白為提示音），並在日誌警告
    )
    return Providers(
        mode="live",
        llm=ArkLLM(http),
        seedream=ArkSeedream(
            http, allowed_hosts=allowed, max_bytes=max_bytes, watermark=settings.model_watermark
        ),
        seedance=ArkSeedance(http, allowed_hosts=allowed, max_bytes=max_bytes),
        tts=tts,
    )


def build_providers(settings: Settings, config: ModelsConfig) -> Providers:
    if settings.provider_mode == "live":
        return build_live_providers(settings, config)
    return build_mock_providers(config)
