"""真實 Provider（會產生費用）。只在 PROVIDER_MODE=live 時使用。"""

import base64
import json
import uuid
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, ValidationError

from app.media.ffmpeg import probe
from app.models.enums import ErrorKind
from app.providers.ark import ArkHttp, redact_urls
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
from app.providers.downloader import download
from app.providers.errors import ProviderError, classify_code

LLM_REPAIR_ATTEMPTS = 2


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("回應中沒有 JSON 物件")
    return json.loads(text[start : end + 1])


class ArkLLM:
    def __init__(self, http: ArkHttp) -> None:
        self._http = http

    async def chat_json[T: BaseModel](
        self,
        model_id: str,
        messages: list[ChatMessage],
        schema: type[T],
        *,
        safety_identifier: str | None = None,
    ) -> ChatResult[T]:
        convo = [{"role": m.role, "content": m.content} for m in messages]
        usage = LLMUsage()
        for attempt in range(1, LLM_REPAIR_ATTEMPTS + 2):
            data = await self._http.request(
                "POST",
                "/chat/completions",
                json={
                    "model": model_id,
                    "messages": convo,
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                    # 對話接口用 user 欄位傳終端用戶標識（等同 safety_identifier）
                    **({"user": safety_identifier} if safety_identifier else {}),
                },
            )
            u = data.get("usage") or {}
            usage = LLMUsage(
                usage.prompt_tokens + int(u.get("prompt_tokens", 0)),
                usage.completion_tokens + int(u.get("completion_tokens", 0)),
            )
            choice = (data.get("choices") or [{}])[0]
            if choice.get("finish_reason") == "content_filter":
                raise ProviderError(ErrorKind.MODERATION, "大模型輸出被內容審核攔截")
            content = str((choice.get("message") or {}).get("content") or "")
            try:
                value = schema.model_validate(_extract_json(content))
            except (ValueError, ValidationError) as exc:
                if attempt > LLM_REPAIR_ATTEMPTS:
                    # 不可重試：重試只會繼續花錢；已消耗的 token 由網關記賬
                    raise ProviderError(
                        ErrorKind.CLIENT,
                        "大模型輸出無法通過校驗",
                        code="llm_invalid_json",
                        billed_tokens=usage.total_tokens,
                        billed_completion_tokens=usage.completion_tokens,
                    ) from exc
                convo.append({"role": "assistant", "content": content})
                convo.append(
                    {
                        "role": "user",
                        "content": f"上面的 JSON 不符合要求：{str(exc)[:1500]}\n請只輸出修正後的完整 JSON。",
                    }
                )
                continue
            return ChatResult(value=value, usage=usage, attempts=attempt)
        raise AssertionError("unreachable")


class ArkSeedream:
    def __init__(
        self,
        http: ArkHttp,
        *,
        allowed_hosts: tuple[str, ...],
        max_bytes: int,
        watermark: bool,
    ) -> None:
        self._http = http
        self._allowed = allowed_hosts
        self._max = max_bytes
        self._watermark = watermark

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
        # 圖片接口（SDK 原碼）沒有 safety_identifier／user 欄位，不發送；由 generation_calls.user_id 追溯
        body: dict[str, Any] = {
            "model": model_id,
            "prompt": prompt,
            "size": size,
            "seed": seed,
            "watermark": self._watermark,
            "response_format": "url",
        }
        if ref_image_urls:
            body["image"] = list(ref_image_urls) if len(ref_image_urls) > 1 else ref_image_urls[0]
        data = await self._http.request("POST", "/images/generations", json=body)
        items = data.get("data") or []
        if not items:
            raise ProviderError(ErrorKind.SERVER, "Seedream 沒有返回圖片")
        first = items[0]
        if first.get("b64_json"):
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(base64.b64decode(first["b64_json"]))
        else:
            await download(
                self._http.downloader,
                str(first["url"]),
                dest,
                allowed_hosts=self._allowed,
                max_bytes=self._max,
            )
        generated = int((data.get("usage") or {}).get("generated_images", 1))
        return ImageResult(path=dest, generated_images=generated)


class ArkSeedance:
    def __init__(self, http: ArkHttp, *, allowed_hosts: tuple[str, ...], max_bytes: int) -> None:
        self._http = http
        self._allowed = allowed_hosts
        self._max = max_bytes

    async def create(self, request: VideoRequest) -> str:
        data = await self._http.request("POST", "/contents/generations/tasks", json=request.to_payload())
        task_id = data.get("id")
        if not task_id:
            raise ProviderError(ErrorKind.SERVER, "建立任務沒有返回 id")
        return str(task_id)

    async def get(self, task_id: str) -> VideoTask:
        data = await self._http.request("GET", f"/contents/generations/tasks/{task_id}")
        return parse_task(data)

    async def cancel(self, task_id: str) -> None:
        try:
            await self._http.request("DELETE", f"/contents/generations/tasks/{task_id}")
        except ProviderError as exc:
            if exc.status != 404:
                raise

    async def fetch_outputs(self, task: VideoTask, dest_dir: Path) -> VideoOutputs:
        if not task.video_url:
            raise ProviderError(ErrorKind.SERVER, "任務成功但沒有影片地址")
        video = await download(
            self._http.downloader,
            task.video_url,
            dest_dir / "clip.mp4",
            allowed_hosts=self._allowed,
            max_bytes=self._max,
        )
        last = None
        if task.last_frame_url:
            last = await download(
                self._http.downloader,
                task.last_frame_url,
                dest_dir / "last_frame.png",
                allowed_hosts=self._allowed,
                max_bytes=self._max,
            )
        return VideoOutputs(video=video, last_frame=last)


def parse_task(data: dict[str, Any]) -> VideoTask:
    status = str(data.get("status", "queued"))
    error = data.get("error") or {}
    if status == "expired":
        # 任務超過 execution_expires_after 被平台終止；按超時類錯誤處理
        status = "failed"
        error = {
            "code": error.get("code") or "TaskExpired",
            "message": error.get("message") or "影片生成任務已過期",
        }
    elif status not in ("queued", "running", "succeeded", "failed", "cancelled"):
        status = "running"
    content = data.get("content") or {}
    usage = data.get("usage") or {}
    keys = ("seed", "resolution", "ratio", "duration", "framespersecond")
    meta: dict[str, object] = {k: data[k] for k in keys if k in data}
    return VideoTask(
        id=str(data.get("id", "")),
        status=status,  # type: ignore[arg-type]
        video_url=content.get("video_url") or None,
        last_frame_url=content.get("last_frame_url") or None,
        completion_tokens=int(usage.get("completion_tokens") or 0),
        error_code=str(error["code"]) if error.get("code") else None,
        error_message=redact_urls(str(error["message"]))[:500] if error.get("message") else None,
        meta=meta,
    )


def task_error(task: VideoTask) -> ProviderError:
    kind = classify_code(task.error_code, ErrorKind.SERVER)
    return ProviderError(kind, task.error_message or "影片生成失敗", code=task.error_code)


class DoubaoTTS:
    """豆包語音合成 HTTP 接口（國內版）。國際版請按 BytePlus 產品目錄替換 endpoint。"""

    def __init__(
        self,
        *,
        endpoint: str,
        app_id: str,
        token: str,
        cluster: str,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._endpoint = endpoint
        self._app_id = app_id
        self._token = token
        self._cluster = cluster
        self._client = httpx.AsyncClient(timeout=60.0, transport=transport)

    async def synthesize(self, text: str, *, voice: str, user_id: str, dest: Path) -> SpeechResult:
        body = {
            "app": {"appid": self._app_id, "token": "access_token", "cluster": self._cluster},
            "user": {"uid": user_id},
            "audio": {"voice_type": voice, "encoding": "mp3", "speed_ratio": 1.0},
            "request": {"reqid": uuid.uuid4().hex, "text": text, "operation": "query"},
        }
        try:
            resp = await self._client.post(
                self._endpoint, json=body, headers={"Authorization": f"Bearer;{self._token}"}
            )
        except httpx.TimeoutException as exc:
            raise ProviderError(ErrorKind.TIMEOUT, "TTS 超時") from exc
        except httpx.TransportError as exc:
            raise ProviderError(ErrorKind.SERVER, "TTS 連線失敗") from exc
        if resp.status_code == 429:
            raise ProviderError(ErrorKind.RATE_LIMIT, "TTS 限流")
        if resp.status_code >= 500:
            raise ProviderError(ErrorKind.SERVER, f"TTS HTTP {resp.status_code}")
        data = resp.json()
        code = int(data.get("code", -1))
        if code != 3000 or not data.get("data"):
            kind = ErrorKind.MODERATION if code in (3010, 3011) else ErrorKind.CLIENT
            raise ProviderError(kind, str(data.get("message", "TTS 失敗"))[:300], code=str(code))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(base64.b64decode(data["data"]))
        info = await probe(dest)
        chars = sum(1 for ch in text if not ch.isspace())
        return SpeechResult(path=dest, duration_s=info.duration_s or 0.0, chars=chars)
