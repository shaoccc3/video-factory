"""Provider 接口與數據結構。業務代碼只經過 gateway 使用這些接口。"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel

TaskStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
TERMINAL: frozenset[str] = frozenset({"succeeded", "failed", "cancelled"})


@dataclass(frozen=True)
class ChatMessage:
    role: Literal["system", "user", "assistant"]
    content: str


@dataclass(frozen=True)
class LLMUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(frozen=True)
class ChatResult[T: BaseModel]:
    value: T
    usage: LLMUsage
    attempts: int


@dataclass(frozen=True)
class ImageResult:
    path: Path
    generated_images: int = 1


@dataclass(frozen=True)
class VideoImageInput:
    url: str  # 公網可訪問（預簽名）URL；Mock 模式可用 "asset://<id>"
    role: str  # first_frame、last_frame、reference_image


@dataclass(frozen=True)
class VideoRequest:
    model_id: str
    prompt: str
    ratio: str
    resolution: str
    duration_s: int
    seed: int
    images: tuple[VideoImageInput, ...] = ()
    audios: tuple[VideoImageInput, ...] = ()  # 參考音頻（例如 role=reference_audio，用來保持聲音一致）
    generate_audio: bool = False
    return_last_frame: bool = True
    watermark: bool = True
    draft: bool = False
    camera_fixed: bool | None = None
    safety_identifier: str | None = None

    def to_payload(self) -> dict[str, object]:
        content: list[dict[str, object]] = [{"type": "text", "text": self.prompt}]
        for img in self.images:
            content.append({"type": "image_url", "image_url": {"url": img.url}, "role": img.role})
        for audio in self.audios:
            content.append({"type": "audio_url", "audio_url": {"url": audio.url}, "role": audio.role})
        payload: dict[str, object] = {
            "model": self.model_id,
            "content": content,
            "ratio": self.ratio,
            "resolution": self.resolution,
            "duration": self.duration_s,
            "seed": self.seed,
            "generate_audio": self.generate_audio,
            "return_last_frame": self.return_last_frame,
            "watermark": self.watermark,
        }
        if self.draft:
            payload["draft"] = True
        if self.camera_fixed is not None:
            payload["camera_fixed"] = self.camera_fixed
        if self.safety_identifier:
            payload["safety_identifier"] = self.safety_identifier
        return payload


@dataclass(frozen=True)
class VideoTask:
    id: str
    status: TaskStatus
    video_url: str | None = None
    last_frame_url: str | None = None
    completion_tokens: int = 0
    error_code: str | None = None
    error_message: str | None = None
    meta: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class VideoOutputs:
    video: Path
    last_frame: Path | None


@dataclass(frozen=True)
class SpeechResult:
    path: Path
    duration_s: float
    chars: int


class LLMProvider(Protocol):
    async def chat_json[T: BaseModel](
        self,
        model_id: str,
        messages: list[ChatMessage],
        schema: type[T],
        *,
        safety_identifier: str | None = None,
    ) -> ChatResult[T]: ...


class SeedreamProvider(Protocol):
    async def generate(
        self,
        model_id: str,
        prompt: str,
        *,
        size: str,
        seed: int,
        ref_image_urls: tuple[str, ...],
        dest: Path,
        safety_identifier: str | None = None,
    ) -> ImageResult: ...


class SeedanceProvider(Protocol):
    async def create(self, request: VideoRequest) -> str: ...
    async def get(self, task_id: str) -> VideoTask: ...
    async def cancel(self, task_id: str) -> None: ...
    async def fetch_outputs(self, task: VideoTask, dest_dir: Path) -> VideoOutputs: ...


class TTSProvider(Protocol):
    async def synthesize(self, text: str, *, voice: str, user_id: str, dest: Path) -> SpeechResult: ...


@dataclass(frozen=True)
class Providers:
    mode: Literal["mock", "live"]
    llm: LLMProvider
    seedream: SeedreamProvider
    seedance: SeedanceProvider
    tts: TTSProvider
