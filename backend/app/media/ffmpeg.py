"""FFmpeg / ffprobe 的執行封裝。命令以參數列表構建，不經 shell。"""

import asyncio
import json
import shutil
from dataclasses import dataclass
from pathlib import Path

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"


class FFmpegError(RuntimeError):
    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


@dataclass(frozen=True)
class MediaInfo:
    duration_s: float | None
    width: int | None
    height: int | None
    fps: float | None
    video_codec: str | None
    audio_codec: str | None
    has_audio: bool
    format_name: str
    tags: dict[str, str]


async def run_ffmpeg(args: list[str], *, timeout_s: float = 1800) -> None:
    cmd = [FFMPEG, "-hide_banner", "-nostdin", "-loglevel", "error", "-y", *args]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE
    )
    try:
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_s)
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise FFmpegError("ffmpeg 執行超時") from exc
    if proc.returncode != 0:
        text = stderr.decode("utf-8", "replace")[-4000:]
        raise FFmpegError(f"ffmpeg 失敗（返回碼 {proc.returncode}）", text)


def _ratio_to_float(value: str | None) -> float | None:
    if not value or value in ("0/0", "0"):
        return None
    if "/" in value:
        num, den = value.split("/", 1)
        return float(num) / float(den) if float(den) else None
    return float(value)


async def probe(path: Path) -> MediaInfo:
    cmd = [
        FFPROBE,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise FFmpegError("ffprobe 失敗", stderr.decode("utf-8", "replace")[-2000:])
    data = json.loads(stdout or b"{}")
    streams = data.get("streams", [])
    fmt = data.get("format", {})
    video = next(
        (
            s
            for s in streams
            if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    duration = fmt.get("duration") or (video or {}).get("duration")
    return MediaInfo(
        duration_s=float(duration) if duration not in (None, "N/A") else None,
        width=int(video["width"]) if video and "width" in video else None,
        height=int(video["height"]) if video and "height" in video else None,
        fps=_ratio_to_float((video or {}).get("avg_frame_rate")),
        video_codec=(video or {}).get("codec_name"),
        audio_codec=(audio or {}).get("codec_name"),
        has_audio=audio is not None,
        format_name=str(fmt.get("format_name", "")),
        tags={str(k).lower(): str(v) for k, v in (fmt.get("tags") or {}).items()},
    )
