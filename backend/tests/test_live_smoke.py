"""付費冒煙測試：用真實方舟 API 生成一條最便宜的 5 秒樣片。

只由 /live-smoke 觸發：uv run pytest -m live -k seedance -x
影片只存到 /tmp/live-smoke/，不進倉庫。不打印密鑰、請求頭或帶簽名的 URL。
"""

import os
import uuid
from pathlib import Path

import pytest

from app.core.models_config import load_models_config
from app.core.settings import Settings
from app.media.ffmpeg import probe
from app.providers.base import VideoRequest
from app.providers.gateway import CallContext
from app.providers.pricing import video_cost, video_tokens_for
from app.services.runtime import build_gateway, build_runtime

pytestmark = [pytest.mark.live, pytest.mark.anyio]
OUT = Path("/tmp/live-smoke")  # noqa: S108 - 冒煙測試輸出目錄，按規則不放倉庫


@pytest.mark.skipif(not os.environ.get("ARK_API_KEY"), reason="沒有 ARK_API_KEY")
async def test_seedance_live_smoke(tmp_path: Path) -> None:
    from app.models import Base

    settings = Settings(
        provider_mode="live",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'live.db'}",
        storage_backend="local",
        local_storage_dir=tmp_path / "storage",
        log_json=False,
    )
    config = load_models_config(settings.models_config_path)
    caps = config.video_caps("video_draft")
    resolution, duration = caps.resolutions[0], max(caps.min_duration_s, min(5, caps.max_duration_s))
    tokens = video_tokens_for(caps, resolution, "16:9", duration)
    _, est_cny = video_cost(config, "video_draft", tokens, settings.ark_region, resolution=resolution)
    budget = float(os.environ.get("LIVE_BUDGET_CNY", "5"))
    assert est_cny <= budget, f"預估 {est_cny:.2f} 元超過 LIVE_BUDGET_CNY={budget}"

    runtime = build_runtime(settings)
    async with runtime.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    gateway = build_gateway(runtime)
    OUT.mkdir(parents=True, exist_ok=True)
    run = await gateway.run_video(
        CallContext(job_id=None, user_id=None),
        "video_draft",
        VideoRequest(
            model_id=config.models.video_draft.id,
            prompt="清晨的茶園，鏡頭緩慢推進，露珠在茶葉上閃光",
            ratio="16:9",
            resolution=resolution,
            duration_s=duration,
            seed=42,
            generate_audio=False,
            safety_identifier=f"live-smoke-{uuid.uuid4().hex[:8]}",
        ),
        dest_dir=OUT,
    )
    info = await probe(run.outputs.video)
    print(
        f"task_id={run.task.id} duration={info.duration_s} size={info.width}x{info.height} "
        f"codec={info.video_codec} usage={run.task.completion_tokens} cost_cny={run.cost_cny:.4f} "
        f"estimate_cny={est_cny:.4f}"
    )
    assert info.duration_s and info.duration_s >= duration - 0.5
    await runtime.aclose()
