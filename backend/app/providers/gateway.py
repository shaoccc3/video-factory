"""模型網關：業務代碼調用模型的唯一入口。

每次調用都會：限速 → 預算檢查 → 記錄 generation_calls → 調用（只重試可重試錯誤）→ 寫 cost_ledger。
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from time import monotonic

import structlog
from pydantic import BaseModel

from app.core.models_config import ModelKey, ModelsConfig, Region, video_dimensions
from app.core.settings import Settings
from app.models.enums import ErrorKind, ProviderName
from app.providers.base import (
    TERMINAL,
    ChatMessage,
    ImageResult,
    Providers,
    SpeechResult,
    VideoOutputs,
    VideoRequest,
    VideoTask,
)
from app.providers.errors import ProviderError, with_retries
from app.providers.live import task_error
from app.providers.pricing import cost_per_image, cost_per_kchar, cost_per_mtok, video_tokens
from app.providers.ratelimit import Limit, RateLimiter
from app.services.budget import BudgetGuard
from app.services.recorder import CallRecorder, Charge

log = structlog.get_logger(__name__)


class JobCancelledError(Exception):
    cancelled = True


@dataclass(frozen=True)
class CallContext:
    job_id: uuid.UUID | None
    user_id: uuid.UUID | None
    scene_id: uuid.UUID | None = None
    # 返回 True 表示任務已取消，輪詢會停止並取消遠端任務
    is_cancelled: Callable[[], Awaitable[bool]] | None = None

    @property
    def safety_identifier(self) -> str | None:
        return str(self.user_id) if self.user_id else None


@dataclass(frozen=True)
class VideoRun:
    outputs: VideoOutputs
    task: VideoTask
    cost_cny: float


class Gateway:
    def __init__(
        self,
        *,
        settings: Settings,
        config: ModelsConfig,
        providers: Providers,
        limiter: RateLimiter,
        recorder: CallRecorder,
        budget: BudgetGuard,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.settings = settings
        self.config = config
        self.providers = providers
        self.limiter = limiter
        self.recorder = recorder
        self.budget = budget
        self._sleep = sleep

    @property
    def region(self) -> Region:
        return self.settings.ark_region

    def _limit(self, key: ModelKey) -> Limit:
        entry = self.config.models.get(key)
        return Limit(rpm=entry.rpm, concurrency=entry.concurrency)

    def _currency(self) -> str:
        return self.config.currency[self.region]

    async def _retry[T](self, fn: Callable[[], Awaitable[T]], what: str) -> T:
        return await with_retries(
            fn,
            attempts=self.settings.provider_max_attempts,
            base_s=self.settings.provider_retry_base_s,
            what=what,
            sleep=self._sleep,
        )

    # ---- 大模型 -------------------------------------------------------------

    async def chat_json[T: BaseModel](
        self, ctx: CallContext, messages: list[ChatMessage], schema: type[T]
    ) -> T:
        key: ModelKey = "script_llm"
        model_id = self.config.models.script_llm.id
        est_tokens = sum(len(m.content) for m in messages) + 2000
        await self.budget.check(
            job_id=ctx.job_id,
            user_id=ctx.user_id,
            add_cny=cost_per_mtok(self.config, key, est_tokens, self.region)[1],
        )
        async with self.limiter.slot(key, self._limit(key)):
            call_id = await self.recorder.start(
                job_id=ctx.job_id,
                scene_id=ctx.scene_id,
                user_id=ctx.user_id,
                provider=ProviderName.LLM,
                model_key=key,
                model_id=model_id,
                summary={"messages": len(messages), "schema": schema.__name__},
            )
            try:
                result = await self._retry(
                    lambda: self.providers.llm.chat_json(model_id, messages, schema), "llm"
                )
            except BaseException as exc:
                await self.recorder.fail(call_id, exc)
                raise
            tokens = result.usage.total_tokens
            amount, cny = cost_per_mtok(self.config, key, tokens, self.region)
            await self.recorder.succeed(
                call_id,
                Charge(
                    usage={
                        "prompt_tokens": result.usage.prompt_tokens,
                        "completion_tokens": result.usage.completion_tokens,
                        "attempts": result.attempts,
                    },
                    unit_price=self.config.models.script_llm.price_per_mtok or 0.0,
                    currency=self._currency(),
                    amount=amount,
                    amount_cny=cny,
                ),
            )
            return result.value

    # ---- 關鍵幀 -------------------------------------------------------------

    async def generate_image(
        self,
        ctx: CallContext,
        *,
        prompt: str,
        size: str,
        seed: int,
        ref_image_urls: tuple[str, ...],
        dest: Path,
    ) -> ImageResult:
        key: ModelKey = "keyframe"
        model_id = self.config.models.keyframe.id
        await self.budget.check(
            job_id=ctx.job_id,
            user_id=ctx.user_id,
            add_cny=cost_per_image(self.config, 1, self.region)[1],
        )
        async with self.limiter.slot(key, self._limit(key)):
            call_id = await self.recorder.start(
                job_id=ctx.job_id,
                scene_id=ctx.scene_id,
                user_id=ctx.user_id,
                provider=ProviderName.SEEDREAM,
                model_key=key,
                model_id=model_id,
                summary={"prompt": prompt[:500], "size": size, "seed": seed, "refs": len(ref_image_urls)},
            )
            try:
                result = await self._retry(
                    lambda: self.providers.seedream.generate(
                        model_id, prompt, size=size, seed=seed, ref_image_urls=ref_image_urls, dest=dest
                    ),
                    "seedream",
                )
            except BaseException as exc:
                await self.recorder.fail(call_id, exc)
                raise
            amount, cny = cost_per_image(self.config, result.generated_images, self.region)
            await self.recorder.succeed(
                call_id,
                Charge(
                    usage={"generated_images": result.generated_images},
                    unit_price=self.config.models.keyframe.price_per_image or 0.0,
                    currency=self._currency(),
                    amount=amount,
                    amount_cny=cny,
                ),
            )
            return result

    # ---- 影片 ---------------------------------------------------------------

    def estimate_video_cny(self, key: ModelKey, *, resolution: str, ratio: str, duration_s: float) -> float:
        caps = self.config.video_caps(key)
        width, height = video_dimensions(resolution, ratio)
        tokens = video_tokens(width, height, caps.fps, duration_s)
        return cost_per_mtok(self.config, key, tokens, self.region)[1]

    async def run_video(
        self,
        ctx: CallContext,
        key: ModelKey,
        request: VideoRequest,
        *,
        dest_dir: Path,
        existing_task_id: str | None = None,
        on_created: Callable[[str], Awaitable[None]] | None = None,
    ) -> VideoRun:
        """建立（或沿用已建立的）Seedance 任務，輪詢到結束，下載結果。"""
        if existing_task_id is None:
            await self.budget.check(
                job_id=ctx.job_id,
                user_id=ctx.user_id,
                add_cny=self.estimate_video_cny(
                    key, resolution=request.resolution, ratio=request.ratio, duration_s=request.duration_s
                ),
            )
        async with self.limiter.slot(key, self._limit(key)):
            call_id = await self.recorder.start(
                job_id=ctx.job_id,
                scene_id=ctx.scene_id,
                user_id=ctx.user_id,
                provider=ProviderName.SEEDANCE,
                model_key=key,
                model_id=request.model_id,
                summary={
                    "prompt": request.prompt[:500],
                    "ratio": request.ratio,
                    "resolution": request.resolution,
                    "duration": request.duration_s,
                    "seed": request.seed,
                    "images": [img.role for img in request.images],
                    "generate_audio": request.generate_audio,
                    "draft": request.draft,
                    "resumed": existing_task_id is not None,
                },
            )
            try:
                if existing_task_id is not None:
                    task_id = existing_task_id
                else:
                    task_id = await self._retry(
                        lambda: self.providers.seedance.create(request), "seedance.create"
                    )
                await self.recorder.set_remote(call_id, task_id)
                if on_created is not None and existing_task_id is None:
                    await on_created(task_id)
                task = await self._poll(ctx, task_id)
                if task.status == "cancelled":
                    raise JobCancelledError()
                if task.status == "failed":
                    raise task_error(task)
                outputs = await self._retry(
                    lambda: self.providers.seedance.fetch_outputs(task, dest_dir), "seedance.download"
                )
            except BaseException as exc:
                await self.recorder.fail(call_id, exc)
                raise
            amount, cny = cost_per_mtok(self.config, key, task.completion_tokens, self.region)
            await self.recorder.succeed(
                call_id,
                Charge(
                    usage={"completion_tokens": task.completion_tokens, **task.meta},
                    unit_price=self.config.models.get(key).price_per_mtok or 0.0,
                    currency=self._currency(),
                    amount=amount,
                    amount_cny=cny,
                ),
            )
            return VideoRun(outputs=outputs, task=task, cost_cny=cny)

    async def _poll(self, ctx: CallContext, task_id: str) -> VideoTask:
        delay = self.settings.seedance_poll_initial_s
        deadline = monotonic() + self.settings.seedance_total_timeout_s
        while True:
            task = await self._retry(lambda: self.providers.seedance.get(task_id), "seedance.get")
            if task.status in TERMINAL:
                return task
            if ctx.is_cancelled is not None and await ctx.is_cancelled():
                await self.cancel_video(task_id)
                raise JobCancelledError()
            if monotonic() + delay > deadline:
                await self.cancel_video(task_id)
                raise ProviderError(ErrorKind.TIMEOUT, "影片生成超過總時限", code="poll_timeout")
            await self._sleep(delay)
            delay = min(delay * 2, self.settings.seedance_poll_max_s)

    async def cancel_video(self, task_id: str) -> None:
        try:
            await self.providers.seedance.cancel(task_id)
        except ProviderError as exc:
            log.warning("seedance_cancel_failed", kind=exc.kind, code=exc.code)

    # ---- 語音 ---------------------------------------------------------------

    async def synthesize(self, ctx: CallContext, text: str, *, dest: Path) -> SpeechResult:
        key: ModelKey = "tts"
        voice = self.config.models.tts.id
        chars = sum(1 for ch in text if not ch.isspace())
        await self.budget.check(
            job_id=ctx.job_id,
            user_id=ctx.user_id,
            add_cny=cost_per_kchar(self.config, chars, self.region)[1],
        )
        async with self.limiter.slot(key, self._limit(key)):
            call_id = await self.recorder.start(
                job_id=ctx.job_id,
                scene_id=ctx.scene_id,
                user_id=ctx.user_id,
                provider=ProviderName.TTS,
                model_key=key,
                model_id=voice,
                summary={"chars": chars},
            )
            try:
                result = await self._retry(
                    lambda: self.providers.tts.synthesize(
                        text, voice=voice, user_id=ctx.safety_identifier or "anonymous", dest=dest
                    ),
                    "tts",
                )
            except BaseException as exc:
                await self.recorder.fail(call_id, exc)
                raise
            amount, cny = cost_per_kchar(self.config, result.chars, self.region)
            await self.recorder.succeed(
                call_id,
                Charge(
                    usage={"chars": result.chars, "duration_s": result.duration_s},
                    unit_price=self.config.models.tts.price_per_kchar or 0.0,
                    currency=self._currency(),
                    amount=amount,
                    amount_cny=cny,
                ),
            )
            return result
