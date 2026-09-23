"""MockProvider：所有接口的假實現，不調用任何外部 API、不產生費用。

- 影片、圖片、語音用 ffmpeg 即時生成
- 任務 id 自帶請求參數，查詢時無需共享狀態（可跨 worker 進程）
- 可注入失敗，用於測試重試與內容審核分支
"""

import base64
import json
import math
import re
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.core.models_config import video_dimensions
from app.media.samples import extract_last_frame, make_test_audio, make_test_image, make_test_video
from app.models.enums import ErrorKind
from app.providers.base import (
    ChatMessage,
    ChatResult,
    ImageResult,
    LLMUsage,
    SpeechResult,
    VideoOutputs,
    VideoRequest,
    VideoTask,
)
from app.providers.errors import ProviderError
from app.providers.pricing import CHARS_PER_SECOND, video_tokens

CONSTRAINTS_RE = re.compile(r"<constraints>(.*?)</constraints>", re.S)


@dataclass
class FailurePlan:
    """按順序彈出的失敗；空了就成功。"""

    errors: deque[ProviderError] = field(default_factory=deque)

    def maybe_raise(self) -> None:
        if self.errors:
            raise self.errors.popleft()


class MockLLM:
    """讀取提示詞中的 <constraints> JSON，生成符合約束的分鏡。可用 scripted 覆蓋返回內容。"""

    def __init__(self) -> None:
        self.failures = FailurePlan()
        self.scripted: deque[dict[str, Any]] = deque()
        self.calls: list[list[ChatMessage]] = []
        self.safety_identifiers: list[str | None] = []

    async def chat_json[T: BaseModel](
        self,
        model_id: str,
        messages: list[ChatMessage],
        schema: type[T],
        *,
        safety_identifier: str | None = None,
    ) -> ChatResult[T]:
        self.calls.append(messages)
        self.safety_identifiers.append(safety_identifier)
        self.failures.maybe_raise()
        text = "\n".join(m.content for m in messages)
        payload = self.scripted.popleft() if self.scripted else self._storyboard(text)
        prompt_tokens = len(text) // 2
        return ChatResult(
            value=schema.model_validate(payload),
            usage=LLMUsage(prompt_tokens, 300),
            attempts=1,
        )

    @staticmethod
    def _storyboard(text: str) -> dict[str, Any]:
        blocks = CONSTRAINTS_RE.findall(text)
        c: dict[str, Any] = json.loads(blocks[-1]) if blocks else {}
        topic = str(c.get("topic", "示範主題"))
        video_type = c.get("video_type", "marketing")
        min_shots, max_shots = int(c.get("min_shots", 3)), int(c.get("max_shots", 4))
        clip_max = int(c.get("clip_max_duration_s", 10))
        clip_min = int(c.get("clip_min_duration_s", 2))
        target = float(c.get("target_duration_s") or c.get("max_duration_s", 20))
        shots = max(min_shots, min(max_shots, math.ceil(target / clip_max) if target else min_shots))
        per = max(clip_min, min(clip_max, round(target / shots)))
        scenes = []
        for i in range(shots):
            if video_type == "training":
                # 旁白字數對應鏡頭時長（每秒約 4.5 字），讓總長落在模板範圍內
                base = f"第{i + 1}部分：關於{topic}，我們先說明重點，再舉一個簡單的例子幫助理解。"
                filler = "接著看看實際工作中常見的情況，想一想該怎麼做。"
                narration = base
                while len(narration) < per * CHARS_PER_SECOND - len(filler) // 2:
                    narration += filler
            else:
                narration = f"{topic}，第{i + 1}個畫面，帶你感受不一樣的日常。"
            scenes.append(
                {
                    "narration": narration,
                    "visual_prompt": f"{topic}，鏡頭{i + 1}，柔和自然光，細節清晰",
                    "shot_type": ["遠景", "中景", "近景", "特寫"][i % 4],
                    "camera_move": ["緩慢推進", "水平橫移", "固定機位", "緩慢拉遠"][i % 4],
                    "duration_s": per,
                    "needs_first_frame": i == 0 and video_type == "marketing",
                    "screen_text": topic[:12] if i == 0 else "",
                }
            )
        return {"title": topic[:30], "scenes": scenes}


class MockSeedream:
    def __init__(self) -> None:
        self.failures = FailurePlan()
        self.calls = 0
        self.safety_identifiers: list[str | None] = []

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
    ) -> ImageResult:
        self.calls += 1
        self.safety_identifiers.append(safety_identifier)
        self.failures.maybe_raise()
        width, height = (int(v) for v in size.lower().split("x"))
        color = f"0x{(seed * 2654435761) % 0xFFFFFF:06x}"
        await make_test_image(dest, width=width, height=height, color=color)
        return ImageResult(path=dest)


class MockSeedance:
    """建立的任務在第 running_polls 次查詢後成功（預設第一次就成功）。"""

    def __init__(self, *, running_polls: int = 0) -> None:
        self.failures = FailurePlan()
        self.task_failures: dict[int, tuple[str, str]] = {}  # 第 N 個任務 → (error_code, message)
        self.running_polls = running_polls
        self.created: list[VideoRequest] = []
        self.cancelled: list[str] = []
        self._polls: dict[str, int] = {}

    async def create(self, request: VideoRequest) -> str:
        self.failures.maybe_raise()
        self.created.append(request)
        spec = {
            "n": len(self.created),
            "ratio": request.ratio,
            "resolution": request.resolution,
            "duration": request.duration_s,
            "audio": request.generate_audio,
            "seed": request.seed,
            "fps": 24,
        }
        token = base64.urlsafe_b64encode(json.dumps(spec).encode()).decode().rstrip("=")
        return f"mock-{token}"

    @staticmethod
    def decode(task_id: str) -> dict[str, Any]:
        token = task_id.removeprefix("mock-")
        spec: dict[str, Any] = json.loads(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4)))
        return spec

    async def get(self, task_id: str) -> VideoTask:
        spec = self.decode(task_id)
        polls = self._polls.get(task_id, 0) + 1
        self._polls[task_id] = polls
        if polls <= self.running_polls:
            return VideoTask(id=task_id, status="running")
        failure = self.task_failures.get(int(spec["n"]))
        if failure:
            return VideoTask(id=task_id, status="failed", error_code=failure[0], error_message=failure[1])
        width, height = video_dimensions(spec["resolution"], spec["ratio"])
        tokens = video_tokens(width, height, spec["fps"], spec["duration"])
        return VideoTask(
            id=task_id,
            status="succeeded",
            video_url=f"mock://{task_id}/video.mp4",
            last_frame_url=f"mock://{task_id}/last.png",
            completion_tokens=tokens,
            meta={"seed": spec["seed"], "duration": spec["duration"], "framespersecond": spec["fps"]},
        )

    async def cancel(self, task_id: str) -> None:
        self.cancelled.append(task_id)

    async def fetch_outputs(self, task: VideoTask, dest_dir: Path) -> VideoOutputs:
        spec = self.decode(task.id)
        width, height = video_dimensions(spec["resolution"], spec["ratio"])
        # Mock 影片用較低解析度生成以節省時間，合成時會統一縮放
        scale = max(1, max(width, height) // 640)
        video = await make_test_video(
            dest_dir / "clip.mp4",
            width=width // scale // 2 * 2,
            height=height // scale // 2 * 2,
            duration_s=float(spec["duration"]),
            fps=spec["fps"],
            with_audio=bool(spec["audio"]),
        )
        last = await extract_last_frame(video, dest_dir / "last_frame.png")
        return VideoOutputs(video=video, last_frame=last)


class MockTTS:
    def __init__(self) -> None:
        self.failures = FailurePlan()
        self.calls = 0

    async def synthesize(self, text: str, *, voice: str, user_id: str, dest: Path) -> SpeechResult:
        self.calls += 1
        self.failures.maybe_raise()
        chars = sum(1 for ch in text if not ch.isspace())
        duration = max(1.0, round(chars / CHARS_PER_SECOND, 2))
        await make_test_audio(dest, duration_s=duration, frequency=330 + (self.calls % 5) * 60)
        return SpeechResult(path=dest, duration_s=duration, chars=chars)


def moderation_error() -> ProviderError:
    return ProviderError(ErrorKind.MODERATION, "輸入內容未通過審核", code="InputTextSensitiveContentDetected")
